"""Export the complete photo tagging inference graph to a single ONNX model."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from torch import nn


OUTPUT_NAMES = [
    "content_scope",
    "primary_body_part",
    "people",
    "gender_single",
    "gender_multi",
    "clothing",
    "framing",
    "pose_base",
    "action_level",
    "handheld_prop",
    "perspective",
    "view_single",
    "view_multi",
]


class TaggerGraph(nn.Module):
    def __init__(self, classifier) -> None:
        super().__init__()
        self.vision = classifier.vision
        self.original_block11 = classifier.original_block11
        self.view_block11 = classifier.view_block11
        self.routed = classifier.general.routed
        self.general_spatial = nn.ModuleList(classifier.general.spatial_models)
        self.single_geometry = nn.ModuleList(classifier.single_geometry)
        self.single_view = nn.ModuleList(classifier.single_view_models)
        self.geometry_routing = classifier.general.geometry_routing

        checkpoint = classifier.general.checkpoint
        for task in ("pose_base", "perspective", "view"):
            logistic = checkpoint["pooled_logistic"][task]
            self.register_buffer(f"{task}_coefficient", torch.tensor(logistic["coef"]))
            self.register_buffer(f"{task}_intercept", torch.tensor(logistic["intercept"]))

        calibration = json.loads(
            (classifier.root / classifier.manifest["assets"]["view_calibrator"]).read_text(encoding="utf-8")
        )
        self.register_buffer("calibration_coefficient", torch.tensor(calibration["coefficient"]))
        self.register_buffer("calibration_intercept", torch.tensor(calibration["intercept"]))

    @staticmethod
    def _mean(models: nn.ModuleList, task: str, tokens, pooled):
        logits = torch.stack([model(tokens, pooled)[task]["logits"] for model in models])
        return logits.sigmoid().mean(0)

    def forward(self, pixels: torch.Tensor):
        hidden = self.vision.embeddings(pixels)
        frozen = []
        for index, layer in enumerate(self.vision.encoder.layers[:11]):
            hidden = layer(hidden, attention_mask=None)
            if index in (8, 9, 10):
                frozen.append(hidden)

        original_hidden = self.original_block11(hidden, attention_mask=None)
        tokens = (torch.stack(frozen).sum(0) + original_hidden) / 4
        pooled = self.vision.head(self.vision.post_layernorm(original_hidden))
        pooled = torch.nn.functional.normalize(pooled, dim=-1)

        view_hidden = self.view_block11(hidden, attention_mask=None)
        view_tokens = (torch.stack(frozen).sum(0) + view_hidden) / 4
        view_pooled = self.vision.head(self.vision.post_layernorm(view_hidden))
        view_pooled = torch.nn.functional.normalize(view_pooled, dim=-1)

        output = self.routed.probabilities(pooled)
        for task in ("pose_base", "perspective", "view"):
            spatial = torch.stack([
                model(tokens, pooled)[task]["logits"].softmax(1)
                for model in self.general_spatial
            ]).mean(0)
            coefficient = getattr(self, f"{task}_coefficient")
            intercept = getattr(self, f"{task}_intercept")
            logistic = (pooled @ coefficient.T + intercept).softmax(1)
            routing = self.geometry_routing[task]
            output[task] = (
                routing["pooled_logistic_weight"] * logistic
                + routing["spatial_ensemble_weight"] * spatial
            )

        output["pose_base"] = self._mean(self.single_geometry, "pose_base", tokens, pooled)
        view_multi = self._mean(self.single_geometry, "view", tokens, pooled)
        raw_view = self._mean(self.single_view, "view", view_tokens, view_pooled).clamp(1e-6, 1.0)
        logp = raw_view.log()
        calibration_features = torch.cat((
            logp,
            logp[:, 0:1] - logp[:, 1:2],
            logp[:, 0:1] - logp[:, 2:3],
            logp[:, 1:2] - logp[:, 2:3],
        ), dim=1)
        view_single = (
            calibration_features @ self.calibration_coefficient.T
            + self.calibration_intercept
        ).softmax(1)

        return (
            output["content_scope"], output["primary_body_part"], output["people"],
            output["gender_single"], output["gender_multi"], output["clothing"],
            output["framing"], output["pose_base"], output["action_level"],
            output["handheld_prop"], output["perspective"], view_single, view_multi,
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fp16", action="store_true")
    args = parser.parse_args()
    model_dir = args.model_dir.resolve()
    sys.path.insert(0, str(model_dir))
    from src.final_offline_classifier import FinalOfflineClassifier

    classifier = FinalOfflineClassifier(model_dir, device="cpu")
    graph = TaggerGraph(classifier).eval().requires_grad_(False)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.fp16:
        graph = graph.half()
    example = torch.zeros(
        (1, 3, 224, 224),
        dtype=torch.float16 if args.fp16 else torch.float32,
    )
    with torch.inference_mode():
        torch.onnx.export(
            graph,
            example,
            args.output,
            input_names=["pixel_values"],
            output_names=OUTPUT_NAMES,
            opset_version=18,
            do_constant_folding=True,
            dynamo=False,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
