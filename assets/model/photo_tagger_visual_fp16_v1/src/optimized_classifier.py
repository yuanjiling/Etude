"""Final routed classifier with spatial-geometry fold ensemble."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch

from .routed_classifier import load_routed_classifier
from .spatial_geometry import SpatialGeometryClassifier


GEOMETRY_TASKS = ("pose_base", "perspective", "view")


class OptimizedClassifier:
    def __init__(self, routed, spatial_models, spatial_checkpoint, geometry_routing, device):
        self.routed = routed
        self.spatial_models = spatial_models
        self.checkpoint = spatial_checkpoint
        self.geometry_routing = geometry_routing
        self.device = torch.device(device)

    @torch.inference_mode()
    def probabilities(
        self, pooled: torch.Tensor, tokens: torch.Tensor
    ) -> dict[str, torch.Tensor]:
        pooled = pooled.to(self.device)
        tokens = tokens.to(self.device)
        output = self.routed.probabilities(pooled)
        spatial = {task: [] for task in GEOMETRY_TASKS}
        for model in self.spatial_models:
            prediction = model(tokens, pooled)
            for task in GEOMETRY_TASKS:
                spatial[task].append(prediction[task]["logits"].softmax(1))
        for task in GEOMETRY_TASKS:
            spatial_probability = torch.stack(spatial[task]).mean(0)
            logistic = self.checkpoint["pooled_logistic"][task]
            coefficient = torch.tensor(logistic["coef"], device=self.device)
            intercept = torch.tensor(logistic["intercept"], device=self.device)
            pooled_probability = (pooled @ coefficient.T + intercept).softmax(1)
            routing = self.geometry_routing[task]
            output[task] = (
                routing["pooled_logistic_weight"] * pooled_probability
                + routing["spatial_ensemble_weight"] * spatial_probability
            )
        return output

    def selective_acceptance(
        self, probabilities: dict[str, torch.Tensor]
    ) -> dict[str, torch.Tensor]:
        accepted = {}
        thresholds = self.checkpoint["selective_thresholds"]
        for task in GEOMETRY_TASKS:
            confidence, prediction = probabilities[task].max(1)
            mask = torch.zeros_like(prediction, dtype=torch.bool)
            for label, config in thresholds[task].items():
                if config is not None:
                    mask |= ((prediction == int(label)) &
                             (confidence >= float(config["threshold"])))
            accepted[task] = mask
        return accepted


def load_optimized_classifier(root: Path | str, device="cpu"):
    root = Path(root)
    routed, metadata = load_routed_classifier(
        root / "training_artifacts" / "linear_probe" / "multi_head_linear.pt",
        root / "training_artifacts" / "structured_probe" / "structured_heads.pt",
        root / "config" / "optimized_head_routing.json",
        device,
    )
    checkpoint = torch.load(
        root / "training_artifacts" / "spatial_geometry" / "spatial_geometry.pt",
        map_location=device, weights_only=True,
    )
    models = []
    for state in checkpoint["fold_state_dicts"]:
        model = SpatialGeometryClassifier(
            checkpoint["token_dim"], checkpoint["pooled_dim"], checkpoint["grid_size"],
            checkpoint["hidden_dim"], checkpoint["dropout"],
        ).to(device)
        model.load_state_dict(state)
        models.append(model.eval())
    geometry_routing = json.loads(
        (root / "config" / "optimized_geometry_routing.json").read_text(encoding="utf-8")
    )
    classifier = OptimizedClassifier(
        routed, models, checkpoint, geometry_routing, device
    )
    metadata.update({
        "geometry_routing": geometry_routing,
        "geometry_fold_models": len(models),
        "selective_thresholds": checkpoint["selective_thresholds"],
        "spatial_encoder_frozen": checkpoint["encoder_frozen"],
    })
    return classifier, metadata
