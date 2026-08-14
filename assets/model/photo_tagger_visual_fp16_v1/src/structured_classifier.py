"""Structured frozen-embedding classifier and its label relationships."""

from __future__ import annotations

from pathlib import Path
from typing import Dict

import torch
from torch import nn


class MLPBranch(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int, dropout: float):
        super().__init__()
        self.layers = nn.Sequential(
            nn.LayerNorm(input_dim),
            nn.Linear(input_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )

    def forward(self, embeddings: torch.Tensor) -> torch.Tensor:
        return self.layers(embeddings)


class StructuredEmbeddingClassifier(nn.Module):
    """Hierarchical multi-task classifier over a frozen vision embedding.

    Four small branches keep unrelated tasks from forcing one representation:
    composition handles people/gender, geometry handles spatial labels,
    appearance handles clothing/props, and detail handles body-part crops.
    """

    def __init__(
        self,
        embedding_dim: int,
        hidden_dim: int = 256,
        dropout: float = 0.15,
    ) -> None:
        super().__init__()
        self.embedding_dim = embedding_dim
        self.hidden_dim = hidden_dim
        self.dropout = dropout
        self.input_norm = nn.LayerNorm(embedding_dim)
        self.scope_head = nn.Linear(embedding_dim, 2)

        self.composition = MLPBranch(embedding_dim, hidden_dim, dropout)
        self.geometry = MLPBranch(embedding_dim, hidden_dim, dropout)
        self.appearance = MLPBranch(embedding_dim, hidden_dim, dropout)
        self.detail = MLPBranch(embedding_dim, hidden_dim, dropout)

        self.primary_body_part_head = nn.Linear(hidden_dim, 7)
        self.people_binary_head = nn.Linear(hidden_dim, 2)  # single / multi
        self.people_multi_head = nn.Linear(hidden_dim, 2)  # two / group
        self.gender_presence_head = nn.Linear(hidden_dim, 2)  # male / female

        self.clothing_head = nn.Linear(hidden_dim, 3)
        self.handheld_prop_head = nn.Linear(hidden_dim, 2)

        self.framing_head = nn.Linear(hidden_dim, 3)
        self.pose_coarse_head = nn.Linear(hidden_dim, 3)  # standing / lying / compact
        self.pose_compact_head = nn.Linear(hidden_dim, 3)  # sitting / kneeling / crouching
        self.action_level_head = nn.Linear(hidden_dim, 2)
        self.perspective_binary_head = nn.Linear(hidden_dim, 2)  # eye / angled
        self.perspective_angle_head = nn.Linear(hidden_dim, 2)  # high / low
        self.view_binary_head = nn.Linear(hidden_dim, 2)  # front / non-front
        self.view_nonfront_head = nn.Linear(hidden_dim, 2)  # back / side

    def forward(self, embeddings: torch.Tensor) -> Dict[str, torch.Tensor]:
        normalized = self.input_norm(embeddings)
        composition = self.composition(embeddings)
        geometry = self.geometry(embeddings)
        appearance = self.appearance(embeddings)
        detail = self.detail(embeddings)
        return {
            "content_scope": self.scope_head(normalized),
            "primary_body_part": self.primary_body_part_head(detail),
            "people_binary": self.people_binary_head(composition),
            "people_multi": self.people_multi_head(composition),
            "gender_presence": self.gender_presence_head(composition),
            "clothing": self.clothing_head(appearance),
            "handheld_prop": self.handheld_prop_head(appearance),
            "framing": self.framing_head(geometry),
            "pose_coarse": self.pose_coarse_head(geometry),
            "pose_compact": self.pose_compact_head(geometry),
            "action_level": self.action_level_head(geometry),
            "perspective_binary": self.perspective_binary_head(geometry),
            "perspective_angle": self.perspective_angle_head(geometry),
            "view_binary": self.view_binary_head(geometry),
            "view_nonfront": self.view_nonfront_head(geometry),
        }


def load_structured_checkpoint(
    path: Path | str, device: torch.device | str = "cpu"
) -> tuple[StructuredEmbeddingClassifier, dict]:
    """Load a self-describing structured checkpoint for inference."""
    checkpoint = torch.load(path, map_location=device, weights_only=True)
    if checkpoint.get("architecture") != "structured_embedding_classifier":
        raise ValueError(f"Unsupported checkpoint architecture: {checkpoint.get('architecture')!r}")
    if checkpoint.get("encoder_frozen") is not True:
        raise ValueError("Checkpoint does not certify a frozen encoder")
    model = StructuredEmbeddingClassifier(
        checkpoint["embedding_dim"], checkpoint["hidden_dim"], checkpoint["dropout"]
    ).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, checkpoint


def structured_probabilities(
    logits: Dict[str, torch.Tensor], epsilon: float = 1e-8
) -> Dict[str, torch.Tensor]:
    """Decode internal hierarchy into the project's original 12 heads."""
    people_root = logits["people_binary"].softmax(dim=1)
    people_multi = logits["people_multi"].softmax(dim=1)
    people = torch.stack((
        people_root[:, 0],
        people_root[:, 1] * people_multi[:, 0],
        people_root[:, 1] * people_multi[:, 1],
    ), dim=1)

    gender_logits = logits["gender_presence"]
    gender_single = gender_logits.softmax(dim=1)
    presence = gender_logits.sigmoid()
    male, female = presence[:, 0], presence[:, 1]
    gender_multi = torch.stack((
        male * (1.0 - female),
        female * (1.0 - male),
        male * female,
    ), dim=1)
    gender_multi = gender_multi / gender_multi.sum(dim=1, keepdim=True).clamp_min(epsilon)

    pose_root = logits["pose_coarse"].softmax(dim=1)
    pose_compact = logits["pose_compact"].softmax(dim=1)
    pose = torch.stack((
        pose_root[:, 0],
        pose_root[:, 2] * pose_compact[:, 0],
        pose_root[:, 2] * pose_compact[:, 1],
        pose_root[:, 2] * pose_compact[:, 2],
        pose_root[:, 1],
    ), dim=1)

    perspective_root = logits["perspective_binary"].softmax(dim=1)
    perspective_angle = logits["perspective_angle"].softmax(dim=1)
    perspective = torch.stack((
        perspective_root[:, 0],
        perspective_root[:, 1] * perspective_angle[:, 0],
        perspective_root[:, 1] * perspective_angle[:, 1],
    ), dim=1)

    view_root = logits["view_binary"].softmax(dim=1)
    view_nonfront = logits["view_nonfront"].softmax(dim=1)
    view = torch.stack((
        view_root[:, 0],
        view_root[:, 1] * view_nonfront[:, 0],
        view_root[:, 1] * view_nonfront[:, 1],
    ), dim=1)

    return {
        "content_scope": logits["content_scope"].softmax(dim=1),
        "primary_body_part": logits["primary_body_part"].softmax(dim=1),
        "people": people,
        "gender_single": gender_single,
        "gender_multi": gender_multi,
        "clothing": logits["clothing"].softmax(dim=1),
        "framing": logits["framing"].softmax(dim=1),
        "pose_base": pose,
        "action_level": logits["action_level"].softmax(dim=1),
        "handheld_prop": logits["handheld_prop"].softmax(dim=1),
        "perspective": perspective,
        "view": view,
    }


@torch.inference_mode()
def apply_output_gates(
    probabilities: Dict[str, torch.Tensor]
) -> list[dict[str, int | float | None]]:
    """Return conditionally valid predictions and joint parent confidence."""
    batch = probabilities["content_scope"].shape[0]
    rows: list[dict[str, int | float | None]] = []
    for index in range(batch):
        scope = int(probabilities["content_scope"][index].argmax())
        result: dict[str, int | float | None] = {
            "content_scope": scope,
            "content_scope_confidence": float(probabilities["content_scope"][index, scope]),
        }
        if scope == 1:  # body_detail
            part = int(probabilities["primary_body_part"][index].argmax())
            result["primary_body_part"] = part
            result["primary_body_part_confidence"] = float(
                probabilities["content_scope"][index, scope]
                * probabilities["primary_body_part"][index, part]
            )
            for head in ("people", "gender_single", "gender_multi", "clothing",
                         "framing", "pose_base", "action_level", "perspective", "view"):
                result[head] = None
            prop = int(probabilities["handheld_prop"][index].argmax())
            result["handheld_prop"] = prop
            rows.append(result)
            continue

        people = int(probabilities["people"][index].argmax())
        people_confidence = probabilities["people"][index, people]
        result["people"] = people
        result["people_confidence"] = float(
            probabilities["content_scope"][index, 0] * people_confidence
        )
        if people == 0:
            gender = int(probabilities["gender_single"][index].argmax())
            result["gender_single"] = gender
            result["gender_multi"] = None
            result["gender_confidence"] = float(
                probabilities["content_scope"][index, 0]
                * people_confidence
                * probabilities["gender_single"][index, gender]
            )
        else:
            gender = int(probabilities["gender_multi"][index].argmax())
            result["gender_single"] = None
            result["gender_multi"] = gender
            result["gender_confidence"] = float(
                probabilities["content_scope"][index, 0]
                * people_confidence
                * probabilities["gender_multi"][index, gender]
            )
        for head in ("clothing", "framing", "pose_base", "action_level",
                     "handheld_prop", "perspective", "view"):
            result[head] = int(probabilities[head][index].argmax())
        result["primary_body_part"] = None
        rows.append(result)
    return rows
