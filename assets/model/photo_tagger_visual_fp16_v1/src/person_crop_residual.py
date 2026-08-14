"""Zero-initialized person-crop residuals on top of a frozen full-image model."""

from __future__ import annotations

import torch
from torch import nn

from src.multilabel_geometry import MultiLabelGeometryClassifier


class CropResidualAdapter(nn.Module):
    def __init__(self, crop_dim: int, classes: int, hidden_dim: int = 128, dropout: float = 0.25):
        super().__init__()
        self.crop_projection = nn.Sequential(
            nn.LayerNorm(crop_dim), nn.Linear(crop_dim, hidden_dim), nn.GELU(),
        )
        self.box_projection = nn.Sequential(
            nn.Linear(4, hidden_dim), nn.GELU(), nn.Linear(hidden_dim, hidden_dim),
        )
        self.attention_score = nn.Linear(hidden_dim, 1)
        self.residual = nn.Sequential(
            nn.LayerNorm(hidden_dim * 3 + classes + 1),
            nn.Linear(hidden_dim * 3 + classes + 1, hidden_dim),
            nn.GELU(), nn.Dropout(dropout), nn.Linear(hidden_dim, classes),
        )
        # The first prediction is exactly the frozen full-image prediction.
        nn.init.zeros_(self.residual[-1].weight)
        nn.init.zeros_(self.residual[-1].bias)

    def forward(self, crops, crop_mask, boxes, base_logits):
        valid = crop_mask.bool()
        person = self.crop_projection(crops) + self.box_projection(boxes)
        scores = self.attention_score(person).squeeze(-1).masked_fill(~valid, -1e4)
        attention = scores.softmax(1) * valid.float()
        attention = attention / attention.sum(1, keepdim=True).clamp_min(1e-6)
        attended = (person * attention.unsqueeze(-1)).sum(1)
        denominator = valid.sum(1, keepdim=True).clamp_min(1).float()
        mean = (person * valid.unsqueeze(-1)).sum(1) / denominator
        maximum = person.masked_fill(~valid.unsqueeze(-1), -1e4).max(1).values
        maximum = torch.where(valid.any(1, keepdim=True), maximum, torch.zeros_like(maximum))
        count = valid.sum(1, keepdim=True).float() / crop_mask.shape[1]
        residual = self.residual(torch.cat((attended, mean, maximum, base_logits.detach(), count), 1))
        # Empty detections have no crop evidence and must preserve the base output.
        residual = residual * valid.any(1, keepdim=True).float()
        return residual, attention


class PersonCropResidualClassifier(nn.Module):
    TASK_CLASSES = {"pose_base": 5, "view": 3}

    def __init__(
        self, token_dim=768, pooled_dim=768, crop_dim=768, grid_size=14,
        hidden_dim=128, dropout=0.25,
    ):
        super().__init__()
        self.base = MultiLabelGeometryClassifier(
            token_dim, pooled_dim, grid_size, hidden_dim, dropout
        )
        self.base.requires_grad_(False)
        self.adapters = nn.ModuleDict({
            task: CropResidualAdapter(crop_dim, classes, hidden_dim, dropout)
            for task, classes in self.TASK_CLASSES.items()
        })

    def load_base_state_dict(self, state_dict):
        self.base.load_state_dict(state_dict)
        self.base.eval().requires_grad_(False)

    def train(self, mode: bool = True):
        super().train(mode)
        self.base.eval()
        return self

    def forward(self, tokens, pooled, crops, crop_mask, boxes):
        with torch.no_grad():
            base_output = self.base(tokens, pooled)
        output = {}
        for task, adapter in self.adapters.items():
            base_logits = base_output[task]["logits"]
            residual, person_attention = adapter(crops, crop_mask, boxes, base_logits)
            output[task] = {
                "logits": base_logits + residual,
                "base_logits": base_logits,
                "residual_logits": residual,
                "attention": base_output[task]["attention"],
                "person_attention": person_attention,
            }
        return output
