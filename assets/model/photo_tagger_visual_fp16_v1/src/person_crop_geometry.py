"""Pose/view classifier combining full-image spatial features and person crop sets."""

from __future__ import annotations

import torch
from torch import nn


class PersonCropTaskAdapter(nn.Module):
    def __init__(self, token_dim, pooled_dim, crop_dim, classes, grid_size, hidden_dim=128, dropout=0.25):
        super().__init__()
        self.grid_size = grid_size
        self.token_norm = nn.LayerNorm(token_dim)
        self.token_projection = nn.Linear(token_dim, hidden_dim)
        self.token_score = nn.Linear(hidden_dim, 1)
        self.pooled_projection = nn.Sequential(nn.LayerNorm(pooled_dim), nn.Linear(pooled_dim, hidden_dim), nn.GELU())
        self.crop_projection = nn.Sequential(nn.LayerNorm(crop_dim), nn.Linear(crop_dim, hidden_dim), nn.GELU())
        self.box_projection = nn.Sequential(nn.Linear(4, hidden_dim), nn.GELU(), nn.Linear(hidden_dim, hidden_dim))
        self.crop_score = nn.Linear(hidden_dim, 1)
        self.fusion = nn.Sequential(
            nn.LayerNorm(hidden_dim * 9 + 1), nn.Linear(hidden_dim * 9 + 1, hidden_dim),
            nn.GELU(), nn.Dropout(dropout), nn.Linear(hidden_dim, classes),
        )

    def forward(self, tokens, pooled, crops, crop_mask, boxes):
        projected = torch.nn.functional.gelu(self.token_projection(self.token_norm(tokens)))
        token_attention = self.token_score(projected).squeeze(-1).softmax(1)
        attended = (projected * token_attention.unsqueeze(-1)).sum(1)
        batch, count, hidden = projected.shape
        if count != self.grid_size ** 2:
            raise ValueError(f"Expected {self.grid_size ** 2} tokens, got {count}")
        grid = projected.reshape(batch, self.grid_size, self.grid_size, hidden)
        mid = self.grid_size // 2
        quadrants = [
            grid[:, :mid, :mid].mean((1, 2)), grid[:, :mid, mid:].mean((1, 2)),
            grid[:, mid:, :mid].mean((1, 2)), grid[:, mid:, mid:].mean((1, 2)),
        ]
        global_feature = self.pooled_projection(pooled)

        person = self.crop_projection(crops) + self.box_projection(boxes)
        valid = crop_mask.bool()
        scores = self.crop_score(person).squeeze(-1).masked_fill(~valid, -1e4)
        person_attention = scores.softmax(1) * valid.float()
        person_attention = person_attention / person_attention.sum(1, keepdim=True).clamp_min(1e-6)
        person_attended = (person * person_attention.unsqueeze(-1)).sum(1)
        denominator = valid.sum(1, keepdim=True).clamp_min(1).float()
        person_mean = (person * valid.unsqueeze(-1)).sum(1) / denominator
        person_max = person.masked_fill(~valid.unsqueeze(-1), -1e4).max(1).values
        person_max = torch.where(valid.any(1, keepdim=True), person_max, torch.zeros_like(person_max))
        count_feature = valid.sum(1, keepdim=True).float() / crop_mask.shape[1]
        logits = self.fusion(torch.cat([
            attended, *quadrants, global_feature, person_attended, person_mean, person_max, count_feature,
        ], 1))
        return logits, token_attention, person_attention


class PersonCropGeometryClassifier(nn.Module):
    TASK_CLASSES = {"pose_base": 5, "view": 3}

    def __init__(self, token_dim=768, pooled_dim=768, crop_dim=768, grid_size=14, hidden_dim=128, dropout=0.25):
        super().__init__()
        self.adapters = nn.ModuleDict({
            task: PersonCropTaskAdapter(token_dim, pooled_dim, crop_dim, classes, grid_size, hidden_dim, dropout)
            for task, classes in self.TASK_CLASSES.items()
        })

    def forward(self, tokens, pooled, crops, crop_mask, boxes):
        return {
            task: dict(zip(("logits", "attention", "person_attention"), adapter(tokens, pooled, crops, crop_mask, boxes)))
            for task, adapter in self.adapters.items()
        }
