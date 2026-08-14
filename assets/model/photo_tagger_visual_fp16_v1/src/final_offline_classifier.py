"""Production offline image classifier with explicit task routing.

The runtime owns image encoding, trained-head inference, conditional label
decoding, and the isolated fine-tuned view branch. All model paths are resolved
inside a release directory and Hugging Face network access is disabled.
"""

from __future__ import annotations

import json
import os
import copy
import tempfile
from contextlib import nullcontext
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from PIL import Image

from .multilabel_geometry import MultiLabelGeometryClassifier
from .optimized_classifier import load_optimized_classifier
from .person_crop_geometry import PersonCropGeometryClassifier
from .person_crop_residual import PersonCropResidualClassifier
from .spatial_geometry import SpatialGeometryClassifier


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def _feature_tensor(raw):
    if torch.is_tensor(raw):
        return raw
    pooled = getattr(raw, "pooler_output", None)
    if pooled is not None:
        return pooled
    raise TypeError(f"Unexpected image feature return type: {type(raw)!r}")


def _calibration_features(probability: np.ndarray) -> np.ndarray:
    probability = np.clip(probability, 1e-6, 1.0)
    logp = np.log(probability)
    return np.column_stack((
        logp,
        logp[:, 0] - logp[:, 1],
        logp[:, 0] - logp[:, 2],
        logp[:, 1] - logp[:, 2],
    ))


class _LogisticCalibrator:
    """Small inference-only replacement for sklearn's LogisticRegression."""

    def __init__(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.coefficient = np.asarray(payload["coefficient"], dtype=np.float32)
        self.intercept = np.asarray(payload["intercept"], dtype=np.float32)

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        logits = np.asarray(features, dtype=np.float32) @ self.coefficient.T + self.intercept
        logits -= logits.max(axis=1, keepdims=True)
        exponential = np.exp(logits)
        return exponential / exponential.sum(axis=1, keepdims=True)

    def predict(self, features: np.ndarray) -> np.ndarray:
        return self.predict_proba(features).argmax(axis=1)


def _load_multilabel_folds(path: Path, device: torch.device):
    checkpoint = torch.load(path, map_location=device, weights_only=True)
    models = []
    for state in checkpoint["fold_state_dicts"]:
        model = MultiLabelGeometryClassifier(
            checkpoint["token_dim"], checkpoint["pooled_dim"], checkpoint["grid_size"],
            checkpoint["hidden_dim"], checkpoint["dropout"],
        ).to(device)
        model.load_state_dict(state)
        models.append(model.eval())
    return models, checkpoint


def _load_crop_folds(paths: list[Path], model_type, device: torch.device):
    models = []
    checkpoints = []
    for path in paths:
        checkpoint = torch.load(path, map_location=device, weights_only=True)
        checkpoints.append(checkpoint)
        for state in checkpoint["fold_state_dicts"]:
            model = model_type(
                checkpoint["token_dim"], checkpoint["pooled_dim"], 768,
                checkpoint["grid_size"], checkpoint["hidden_dim"], checkpoint["dropout"],
            ).to(device)
            model.load_state_dict(state)
            models.append(model.eval())
    return models, checkpoints


class FinalOfflineClassifier:
    """Load and run the complete release package without network access."""

    def __init__(
        self, release_root: Path | str, device: str = "auto",
        encoder_path: Path | str | None = None,
    ) -> None:
        self.root = Path(release_root).resolve()
        self.manifest = json.loads((self.root / "manifest.json").read_text(encoding="utf-8"))
        if self.manifest.get("offline_only") is not True:
            raise ValueError("Release manifest must declare offline_only=true")
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_DATASETS_OFFLINE"] = "1"
        self.device = torch.device(
            "cuda" if device == "auto" and torch.cuda.is_available() else
            "cpu" if device == "auto" else device
        )
        from transformers import AutoImageProcessor, AutoModel

        packaged_encoder = self.manifest["assets"].get("encoder")
        if encoder_path is None and packaged_encoder:
            encoder_path = self.root / packaged_encoder
        if encoder_path is None:
            raise ValueError("This weights-only package requires encoder_path pointing to a local SigLIP2 directory")
        encoder_path = Path(encoder_path).resolve()
        self.processor = AutoImageProcessor.from_pretrained(encoder_path, local_files_only=True)
        self.encoder = AutoModel.from_pretrained(encoder_path, local_files_only=True).to(self.device)
        if self.device.type == "cpu" and next(self.encoder.parameters()).dtype == torch.float16:
            self.encoder.float()
        self.encoder.eval().requires_grad_(False)
        self.vision = getattr(self.encoder, "vision_model", self.encoder)
        self.original_block11 = self.vision.encoder.layers[-1]

        # The optimized head loader expects this stable internal tree.
        self.general, self.general_metadata = load_optimized_classifier(self.root, self.device)
        self.head_spaces = self.general_metadata["head_spaces"]

        hybrid_path = self.root / self.manifest["assets"]["single_pose"]
        self.single_geometry, self.single_geometry_checkpoint = _load_multilabel_folds(hybrid_path, self.device)

        view_checkpoint = torch.load(
            self.root / self.manifest["assets"]["single_view"],
            map_location=self.device, weights_only=False,
        )
        self.view_block11 = copy.deepcopy(self.original_block11).to(self.device)
        self.view_block11.load_state_dict(view_checkpoint["block11_state"])
        self.view_block11.eval().requires_grad_(False)
        self.single_view_models = []
        for state in view_checkpoint["fold_view_adapter_states"]:
            model = SpatialGeometryClassifier(
                self.single_geometry_checkpoint["token_dim"],
                self.single_geometry_checkpoint["pooled_dim"],
                self.single_geometry_checkpoint["grid_size"],
                self.single_geometry_checkpoint["hidden_dim"],
                self.single_geometry_checkpoint["dropout"],
            ).to(self.device)
            model.adapters["view"].load_state_dict(state)
            self.single_view_models.append(model.eval())
        self.view_calibrator = _LogisticCalibrator(
            self.root / self.manifest["assets"]["view_calibrator"]
        )
        self.single_view_policy = self.manifest.get("single_view_policy", {})

        self.compact_multi = bool(self.manifest.get("compact_multi", False))
        if self.compact_multi:
            self.multi_pose_models = self.multi_view_models = []
        else:
            pose_paths = [self.root / path for path in self.manifest["assets"]["multi_pose"]]
            view_paths = [self.root / path for path in self.manifest["assets"]["multi_view"]]
            self.multi_pose_models, _ = _load_crop_folds(pose_paths, PersonCropGeometryClassifier, self.device)
            self.multi_view_models, _ = _load_crop_folds(view_paths, PersonCropResidualClassifier, self.device)
        self.multi_thresholds = self.manifest["multi_thresholds"]
        self.detector = None
        detector_asset = self.manifest["assets"].get("detector")
        self.detector_path = self.root / detector_asset if detector_asset else None
        self.max_people = int(self.manifest["person_detection"]["max_people"])
        self.detection_confidence = float(self.manifest["person_detection"]["confidence"])
        self.crop_padding = float(self.manifest["person_detection"]["padding"])

    def _amp(self):
        return torch.autocast("cuda", dtype=torch.float16) if self.device.type == "cuda" else nullcontext()

    @torch.inference_mode()
    def _encode_full(self, image: Image.Image):
        encoder_dtype = next(self.vision.parameters()).dtype
        pixels = self.processor(images=[image], return_tensors="pt")["pixel_values"].to(self.device, dtype=encoder_dtype)
        with self._amp():
            hidden = self.vision.embeddings(pixels)
            frozen = []
            for index, layer in enumerate(self.vision.encoder.layers[:11]):
                hidden = layer(hidden, attention_mask=None)
                if index in (8, 9, 10):
                    frozen.append(hidden)
            original_hidden = self.original_block11(hidden, attention_mask=None)
            original_tokens = (torch.stack(frozen).sum(0) + original_hidden) / 4
            original_pooled = self.vision.head(self.vision.post_layernorm(original_hidden))
            original_pooled = torch.nn.functional.normalize(original_pooled.float(), dim=-1)
            view_hidden = self.view_block11(hidden, attention_mask=None)
            view_tokens = (torch.stack(frozen).sum(0) + view_hidden) / 4
            view_pooled = self.vision.head(self.vision.post_layernorm(view_hidden))
            view_pooled = torch.nn.functional.normalize(view_pooled.float(), dim=-1)
        return original_pooled.float(), original_tokens.float(), view_pooled.float(), view_tokens.float()

    def _load_detector(self):
        if self.detector is None:
            runtime_root = Path(os.environ.get(
                "PHOTO_TAGGER_RUNTIME_DIR",
                Path(tempfile.gettempdir()) / "photo_tagger_offline",
            ))
            yolo_root = runtime_root / "yolo"
            yolo_root.mkdir(parents=True, exist_ok=True)
            os.environ["YOLO_CONFIG_DIR"] = str(yolo_root.resolve())
            from ultralytics import YOLO
            self.detector = YOLO(str(self.detector_path))
        return self.detector

    @torch.inference_mode()
    def _person_features(self, image: Image.Image):
        detector = self._load_detector()
        result = detector.predict(
            source=image, conf=self.detection_confidence,
            device=0 if self.device.type == "cuda" else "cpu", verbose=False,
        )[0]
        crops = torch.zeros((1, self.max_people, 768), device=self.device)
        boxes = torch.zeros((1, self.max_people, 4), device=self.device)
        mask = torch.zeros((1, self.max_people), dtype=torch.bool, device=self.device)
        if result.boxes is None or len(result.boxes) == 0:
            return crops, mask, boxes
        xyxy = result.boxes.xyxy.detach().cpu().numpy()
        confidence = result.boxes.conf.detach().cpu().numpy()
        rank = np.argsort(-((xyxy[:, 2] - xyxy[:, 0]) * (xyxy[:, 3] - xyxy[:, 1]) * confidence))
        width, height = image.size
        crop_images, slots = [], []
        for slot, detection_index in enumerate(rank[:self.max_people]):
            x1, y1, x2, y2 = xyxy[detection_index]
            pad_x, pad_y = (x2 - x1) * self.crop_padding, (y2 - y1) * self.crop_padding
            x1, x2 = max(0, x1 - pad_x), min(width, x2 + pad_x)
            y1, y2 = max(0, y1 - pad_y), min(height, y2 + pad_y)
            if x2 - x1 < 2 or y2 - y1 < 2:
                continue
            crop_images.append(image.crop((round(x1), round(y1), round(x2), round(y2))))
            slots.append(slot)
            boxes[0, slot] = torch.tensor((x1 / width, y1 / height, x2 / width, y2 / height), device=self.device)
            mask[0, slot] = True
        if crop_images:
            pixels = self.processor(images=crop_images, return_tensors="pt")["pixel_values"].to(self.device)
            with self._amp():
                encoded = _feature_tensor(self.encoder.get_image_features(pixel_values=pixels))
                encoded = torch.nn.functional.normalize(encoded.float(), dim=-1)
            for source_index, slot in enumerate(slots):
                crops[0, slot] = encoded[source_index]
        return crops, mask, boxes

    @staticmethod
    def _mean_probability(models, task, *inputs, activation="sigmoid"):
        logits = torch.stack([model(*inputs)[task]["logits"] for model in models])
        values = logits.sigmoid() if activation == "sigmoid" else logits.softmax(2)
        return values.mean(0)

    @staticmethod
    def _decode_multilabel(probability, labels, thresholds):
        values = probability.detach().cpu().numpy()[0]
        selected = [label for label, value, threshold in zip(labels, values, thresholds) if value >= threshold]
        if not selected:
            selected = [labels[int(values.argmax())]]
        return selected

    @torch.inference_mode()
    def classify(self, image: Path | str | Image.Image) -> dict:
        source_path = None
        if isinstance(image, (str, Path)):
            source_path = str(Path(image).resolve())
            with Image.open(image) as opened:
                rgb = opened.convert("RGB").copy()
        else:
            rgb = image.convert("RGB")
        pooled, tokens, view_pooled, view_tokens = self._encode_full(rgb)
        probabilities = self.general.probabilities(pooled, tokens)
        labels = {head: self.head_spaces[head][int(value.argmax(1).item())] for head, value in probabilities.items()}
        people = labels["people"]
        routes = {"general": "frozen_siglip2_trained_heads"}

        # Stable single-image geometry overrides.
        perspective = probabilities["perspective"]
        probabilities["pose_base"] = self._mean_probability(self.single_geometry, "pose_base", tokens, pooled)
        probabilities["perspective"] = perspective
        if people == "single":
            raw_view = self._mean_probability(self.single_view_models, "view", view_tokens, view_pooled)
            calibrated_index = int(self.view_calibrator.predict(_calibration_features(raw_view.cpu().numpy()))[0])
            calibrated_distribution = self.view_calibrator.predict_proba(_calibration_features(raw_view.cpu().numpy()))
            probabilities["view"] = torch.from_numpy(calibrated_distribution).to(self.device, dtype=torch.float32)
            policy_applied = None
            if calibrated_index == 2 and self.single_view_policy.get("mode") == "front_oblique_override":
                side_max = float(self.single_view_policy["side_max"])
                front_min = float(self.single_view_policy["front_min"])
                if calibrated_distribution[0, 2] < side_max and calibrated_distribution[0, 0] >= front_min:
                    calibrated_index = 0
                    policy_applied = "side_to_front_oblique"
            labels["pose_base"] = self.head_spaces["pose_base"][int(probabilities["pose_base"].argmax(1).item())]
            labels["view"] = self.head_spaces["view"][calibrated_index]
            routes.update({"pose_base": "single_frozen_spatial", "view": "single_finetuned_block11_calibrated"})
            if policy_applied:
                routes["view_policy"] = policy_applied
        else:
            if self.compact_multi:
                multi_pose = self._mean_probability(self.single_geometry, "pose_base", tokens, pooled)
                multi_view = self._mean_probability(self.single_geometry, "view", tokens, pooled)
                pose_route = view_route = "compact_full_image_multilabel"
            else:
                crops, crop_mask, boxes = self._person_features(rgb)
                multi_pose = self._mean_probability(self.multi_pose_models, "pose_base", tokens, pooled, crops, crop_mask, boxes)
                multi_view = self._mean_probability(self.multi_view_models, "view", tokens, pooled, crops, crop_mask, boxes)
                pose_route, view_route = "multi_person_crop_ensemble", "multi_person_crop_residual_ensemble"
            probabilities["pose_base"], probabilities["view"] = multi_pose, multi_view
            labels["pose_base"] = "|".join(self._decode_multilabel(
                multi_pose, self.head_spaces["pose_base"], self.multi_thresholds["pose_base"]
            ))
            labels["view"] = "|".join(self._decode_multilabel(
                multi_view, self.head_spaces["view"], self.multi_thresholds["view"]
            ))
            routes.update({"pose_base": pose_route, "view": view_route})
        labels["perspective"] = self.head_spaces["perspective"][int(probabilities["perspective"].argmax(1).item())]
        routes["perspective"] = "frozen_spatial_blend"

        # Conditional heads remain explicit for product integration.
        if labels["content_scope"] == "figure":
            labels["primary_body_part"] = None
        if people == "single":
            labels["gender_multi"] = None
        else:
            labels["gender_single"] = None
        serializable_probabilities = {
            head: {label: float(value) for label, value in zip(self.head_spaces[head], tensor[0].detach().cpu())}
            for head, tensor in probabilities.items()
        }
        return {
            "source": source_path,
            "labels": labels,
            "probabilities": serializable_probabilities,
            "routes": routes,
            "offline": True,
            "model_version": self.manifest["model_version"],
        }

    def classify_many(self, paths: Iterable[Path | str]):
        return [self.classify(path) for path in paths]


def discover_images(path: Path | str, recursive: bool = True) -> list[Path]:
    source = Path(path)
    if source.is_file():
        if source.suffix.lower() not in IMAGE_SUFFIXES:
            raise ValueError(f"Unsupported image extension: {source.suffix}")
        return [source]
    pattern = "**/*" if recursive else "*"
    return sorted(item for item in source.glob(pattern) if item.is_file() and item.suffix.lower() in IMAGE_SUFFIXES)
