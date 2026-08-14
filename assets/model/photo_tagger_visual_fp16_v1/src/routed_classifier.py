"""Head-wise routing between the independent and structured probes."""

from __future__ import annotations

import json
from pathlib import Path

import torch
from torch import nn

from .structured_classifier import (
    load_structured_checkpoint,
    structured_probabilities,
)


class LinearEmbeddingClassifier(nn.Module):
    def __init__(self, embedding_dim: int, head_spaces: dict[str, list[str]]):
        super().__init__()
        self.heads = nn.ModuleDict({
            head: nn.Linear(embedding_dim, len(labels))
            for head, labels in head_spaces.items()
        })

    def forward(self, embeddings: torch.Tensor) -> dict[str, torch.Tensor]:
        return {head: layer(embeddings) for head, layer in self.heads.items()}


class RoutedEmbeddingClassifier(nn.Module):
    def __init__(
        self,
        linear: LinearEmbeddingClassifier,
        structured: nn.Module,
        routing: dict[str, str],
    ) -> None:
        super().__init__()
        self.linear = linear
        self.structured = structured
        self.routing = routing

    def probabilities(self, embeddings: torch.Tensor) -> dict[str, torch.Tensor]:
        linear_probabilities = {
            head: logits.softmax(dim=1)
            for head, logits in self.linear(embeddings).items()
        }
        structured_output = structured_probabilities(self.structured(embeddings))
        return {
            head: (structured_output[head] if source == "structured"
                   else linear_probabilities[head])
            for head, source in self.routing.items()
        }


def load_routed_classifier(
    linear_path: Path | str,
    structured_path: Path | str,
    routing_path: Path | str,
    device: torch.device | str = "cpu",
) -> tuple[RoutedEmbeddingClassifier, dict]:
    linear_checkpoint = torch.load(linear_path, map_location=device, weights_only=True)
    structured, structured_checkpoint = load_structured_checkpoint(
        structured_path, device
    )
    routing = json.loads(Path(routing_path).read_text(encoding="utf-8"))
    if set(routing) != set(linear_checkpoint["head_spaces"]):
        raise ValueError("Routing heads do not match checkpoint label spaces")
    if any(source not in {"linear", "structured"} for source in routing.values()):
        raise ValueError("Every route must be 'linear' or 'structured'")
    linear = LinearEmbeddingClassifier(
        linear_checkpoint["embedding_dim"], linear_checkpoint["head_spaces"]
    ).to(device)
    linear.load_state_dict(linear_checkpoint["state_dict"])
    linear.eval()
    model = RoutedEmbeddingClassifier(linear, structured, routing).to(device).eval()
    metadata = {
        "embedding_dim": linear_checkpoint["embedding_dim"],
        "head_spaces": linear_checkpoint["head_spaces"],
        "encoder_frozen": True,
        "routing": routing,
        "linear_checkpoint": str(linear_path),
        "structured_checkpoint": str(structured_path),
        "structured_logic": structured_checkpoint.get("logic", {}),
    }
    return model, metadata
