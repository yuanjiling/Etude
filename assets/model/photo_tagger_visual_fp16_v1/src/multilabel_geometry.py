"""Frozen-feature spatial classifier for multi-label pose and view tags."""

from __future__ import annotations

from torch import nn

from src.spatial_geometry import SpatialTaskAdapter


class MultiLabelGeometryClassifier(nn.Module):
    TASK_CLASSES = {"pose_base": 5, "view": 3}

    def __init__(
        self,
        token_dim: int = 768,
        pooled_dim: int = 768,
        grid_size: int = 14,
        hidden_dim: int = 128,
        dropout: float = 0.2,
    ) -> None:
        super().__init__()
        self.adapters = nn.ModuleDict({
            task: SpatialTaskAdapter(
                token_dim, pooled_dim, classes, grid_size, hidden_dim, dropout
            )
            for task, classes in self.TASK_CLASSES.items()
        })

    def forward(self, tokens, pooled):
        output = {}
        for task, adapter in self.adapters.items():
            logits, _, attention = adapter(tokens, pooled)
            output[task] = {"logits": logits, "attention": attention}
        return output

