"""Small offline CLI for the quantized ONNX photo tagger."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True

import numpy as np
import onnxruntime as ort
from PIL import Image


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
OUTPUT_NAMES = [
    "content_scope", "primary_body_part", "people", "gender_single", "gender_multi",
    "clothing", "framing", "pose_base", "action_level", "handheld_prop",
    "perspective", "view_single", "view_multi",
]
HEAD_SPACES = {
    "content_scope": ["figure", "body_detail"],
    "primary_body_part": ["hand", "foot", "arm", "leg", "torso", "head_face", "pelvis_hip"],
    "people": ["single", "two_people", "group"],
    "gender_single": ["male", "female"],
    "gender_multi": ["male_only", "female_only", "mixed"],
    "clothing": ["nude", "partially_clothed", "clothed"],
    "framing": ["full_body", "body_crop", "portrait"],
    "pose_base": ["standing", "sitting", "kneeling", "crouching", "lying"],
    "action_level": ["static", "active"],
    "handheld_prop": ["no_props", "props"],
    "perspective": ["eye_level", "high_angle", "low_angle"],
    "view": ["front", "back", "side"],
}


def discover_images(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() in IMAGE_SUFFIXES else []
    return sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in IMAGE_SUFFIXES)


def preprocess(path: Path) -> np.ndarray:
    with Image.open(path) as opened:
        image = opened.convert("RGB").resize((224, 224), resample=Image.Resampling.BILINEAR)
    pixels = np.asarray(image, dtype=np.float32) / 255.0
    pixels = (pixels - 0.5) / 0.5
    return np.transpose(pixels, (2, 0, 1))[None, ...]


def decode_multilabel(values: np.ndarray, labels: list[str], thresholds: list[float]) -> str:
    selected = [label for label, value, threshold in zip(labels, values, thresholds) if value >= threshold]
    return "|".join(selected or [labels[int(values.argmax())]])


class OnnxTagger:
    def __init__(self, root: Path, prefer_gpu: bool, cpu_threads: int) -> None:
        self.root = root
        self.manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        self.cpu_threads = max(0, cpu_threads)
        self.provider = "CPUExecutionProvider"
        self.fallback_reason: str | None = None
        self._runtime_notice_pending = True
        self.session = self._create_session(prefer_gpu)
        self.input_dtype = (
            np.float16 if self.session.get_inputs()[0].type == "tensor(float16)" else np.float32
        )

    def _session_options(self, provider: str) -> ort.SessionOptions:
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.intra_op_num_threads = self.cpu_threads
        options.log_severity_level = 3
        if provider == "DmlExecutionProvider":
            options.enable_mem_pattern = False
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        return options

    def _open_session(self, provider: str) -> ort.InferenceSession:
        providers = [provider]
        if provider != "CPUExecutionProvider":
            providers.append("CPUExecutionProvider")
        return ort.InferenceSession(
            self.root / self.manifest["assets"]["onnx_model"],
            sess_options=self._session_options(provider),
            providers=providers,
        )

    def _create_session(self, prefer_gpu: bool) -> ort.InferenceSession:
        available = set(ort.get_available_providers())
        gpu_provider = next((provider for provider in (
            "CUDAExecutionProvider", "DmlExecutionProvider", "CoreMLExecutionProvider"
        ) if provider in available), None)
        if prefer_gpu and gpu_provider:
            try:
                self.provider = gpu_provider
                return self._open_session(gpu_provider)
            except Exception as error:
                self.fallback_reason = f"GPU 初始化失败：{error}"
        elif prefer_gpu:
            self.fallback_reason = "当前 ONNX Runtime 未提供可用的 GPU 执行器"
        self.provider = "CPUExecutionProvider"
        return self._open_session(self.provider)

    def runtime_notice(self) -> dict | None:
        if not self._runtime_notice_pending:
            return None
        self._runtime_notice_pending = False
        return {
            "type": "runtime",
            "provider": self.provider,
            "gpuFallback": self.fallback_reason,
            "cpuThreads": self.cpu_threads,
        }

    def classify(self, path: Path) -> dict:
        inputs = {"pixel_values": preprocess(path).astype(self.input_dtype, copy=False)}
        try:
            outputs = self.session.run(OUTPUT_NAMES, inputs)
        except Exception as error:
            if self.provider == "CPUExecutionProvider":
                raise
            self.fallback_reason = f"GPU 执行失败：{error}"
            self.provider = "CPUExecutionProvider"
            self._runtime_notice_pending = True
            self.session = self._open_session(self.provider)
            outputs = self.session.run(OUTPUT_NAMES, inputs)
        values = {name: output[0] for name, output in zip(OUTPUT_NAMES, outputs)}
        people = HEAD_SPACES["people"][int(values["people"].argmax())]
        view_values = values["view_single"] if people == "single" else values["view_multi"]
        probabilities = {
            head: {label: float(value) for label, value in zip(labels, values[head])}
            for head, labels in HEAD_SPACES.items()
            if head != "view"
        }
        probabilities["view"] = {
            label: float(value) for label, value in zip(HEAD_SPACES["view"], view_values)
        }
        labels = {
            head: choices[int(np.asarray(list(probabilities[head].values())).argmax())]
            for head, choices in HEAD_SPACES.items()
        }
        routes = {"general": "quantized_onnx_siglip2", "perspective": "frozen_spatial_blend"}
        if people == "single":
            labels["gender_multi"] = None
            calibrated_index = int(view_values.argmax())
            policy = self.manifest.get("single_view_policy", {})
            if (
                calibrated_index == 2
                and policy.get("mode") == "front_oblique_override"
                and float(view_values[2]) < float(policy["side_max"])
                and float(view_values[0]) >= float(policy["front_min"])
            ):
                labels["view"] = "front"
                routes["view_policy"] = "side_to_front_oblique"
            routes.update({"pose_base": "single_frozen_spatial", "view": "single_finetuned_block11_calibrated"})
        else:
            labels["gender_single"] = None
            labels["pose_base"] = decode_multilabel(
                values["pose_base"], HEAD_SPACES["pose_base"], self.manifest["multi_thresholds"]["pose_base"]
            )
            labels["view"] = decode_multilabel(
                view_values, HEAD_SPACES["view"], self.manifest["multi_thresholds"]["view"]
            )
            routes.update({"pose_base": "compact_full_image_multilabel", "view": "compact_full_image_multilabel"})
        if labels["content_scope"] == "figure":
            labels["primary_body_part"] = None
        return {
            "source": str(path.resolve()), "labels": labels, "probabilities": probabilities,
            "routes": routes, "offline": True, "model_version": self.manifest["model_version"],
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prefer-gpu", action="store_true")
    parser.add_argument("--cpu-threads", type=int, default=0)
    parser.add_argument("--inter-image-delay-ms", type=int, default=0)
    args = parser.parse_args()
    tagger = OnnxTagger(args.model_dir.resolve(), args.prefer_gpu, args.cpu_threads)
    paths = discover_images(args.input)
    notice = tagger.runtime_notice()
    if notice:
        print(json.dumps(notice, ensure_ascii=False), flush=True)
    print(json.dumps({"type": "progress", "total": len(paths), "current": 0}), flush=True)
    results = []
    for index, path in enumerate(paths, 1):
        result = tagger.classify(path)
        notice = tagger.runtime_notice()
        if notice:
            print(json.dumps(notice, ensure_ascii=False), flush=True)
        results.append(result)
        print(json.dumps({"type": "progress", "total": len(paths), "current": index, "result": result}, ensure_ascii=False), flush=True)
        if args.inter_image_delay_ms > 0 and index < len(paths):
            time.sleep(args.inter_image_delay_ms / 1000)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    fields = ["source", *HEAD_SPACES]
    with (args.output / "results.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for result in results:
            writer.writerow({"source": result["source"], **result["labels"]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
