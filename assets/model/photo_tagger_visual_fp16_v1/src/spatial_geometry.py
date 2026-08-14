"""Independent spatial-token adapters for pose, perspective, and view."""

from __future__ import annotations

import torch
from torch import nn


class SpatialTaskAdapter(nn.Module):
    def __init__(
        self,
        token_dim: int,
        pooled_dim: int,
        classes: int,
        grid_size: int,
        hidden_dim: int = 128,
        dropout: float = 0.2,
        ordinal: bool = False,
    ) -> None:
        super().__init__()
        self.grid_size = grid_size
        self.ordinal = ordinal
        self.token_norm = nn.LayerNorm(token_dim)
        self.token_projection = nn.Linear(token_dim, hidden_dim)
        self.attention_score = nn.Linear(hidden_dim, 1)
        self.pooled_projection = nn.Sequential(
            nn.LayerNorm(pooled_dim), nn.Linear(pooled_dim, hidden_dim), nn.GELU()
        )
        # global token attention + 4 quadrants + projected pooled embedding
        combined_dim = hidden_dim * 6
        self.fusion = nn.Sequential(
            nn.LayerNorm(combined_dim),
            nn.Linear(combined_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.classifier = nn.Linear(hidden_dim, classes)
        self.ordinal_head = nn.Linear(hidden_dim, 1) if ordinal else None

    def forward(
        self, tokens: torch.Tensor, pooled: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor | None, torch.Tensor]:
        projected = torch.nn.functional.gelu(
            self.token_projection(self.token_norm(tokens))
        )
        attention = self.attention_score(projected).squeeze(-1).softmax(dim=1)
        attended = torch.sum(projected * attention.unsqueeze(-1), dim=1)
        batch, token_count, hidden = projected.shape
        if token_count != self.grid_size * self.grid_size:
            raise ValueError(f"Expected {self.grid_size ** 2} tokens, got {token_count}")
        grid = projected.reshape(batch, self.grid_size, self.grid_size, hidden)
        midpoint = self.grid_size // 2
        quadrants = [
            grid[:, :midpoint, :midpoint].mean(dim=(1, 2)),
            grid[:, :midpoint, midpoint:].mean(dim=(1, 2)),
            grid[:, midpoint:, :midpoint].mean(dim=(1, 2)),
            grid[:, midpoint:, midpoint:].mean(dim=(1, 2)),
        ]
        global_feature = self.pooled_projection(pooled)
        fused = self.fusion(torch.cat([attended, *quadrants, global_feature], dim=1))
        ordinal = self.ordinal_head(fused).squeeze(1) if self.ordinal_head is not None else None
        return self.classifier(fused), ordinal, attention


class SpatialGeometryClassifier(nn.Module):
    TASK_CLASSES = {"pose_base": 5, "perspective": 3, "view": 3}

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
                token_dim, pooled_dim, classes, grid_size, hidden_dim, dropout,
                ordinal=(task == "perspective"),
            )
            for task, classes in self.TASK_CLASSES.items()
        })

    def forward(self, tokens: torch.Tensor, pooled: torch.Tensor) -> dict[str, dict]:
        output = {}
        for task, adapter in self.adapters.items():
            logits, ordinal, attention = adapter(tokens, pooled)
            output[task] = {
                "logits": logits,
                "ordinal": ordinal,
                "attention": attention,
            }
        return output


def load_spatial_geometry_checkpoint(path, device="cpu"):
    checkpoint = torch.load(path, map_location=device, weights_only=True)
    if checkpoint.get("architecture") != "spatial_geometry_classifier":
        raise ValueError("Unsupported spatial geometry checkpoint")
    model = SpatialGeometryClassifier(
        checkpoint["token_dim"], checkpoint["pooled_dim"],
        checkpoint["grid_size"], checkpoint["hidden_dim"], checkpoint["dropout"],
    ).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, checkpoint
