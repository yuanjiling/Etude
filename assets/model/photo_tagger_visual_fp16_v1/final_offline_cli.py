"""CLI for the packaged offline photo classifier."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.final_offline_classifier import FinalOfflineClassifier, discover_images


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--encoder", type=Path, help="Local SigLIP2 directory for weights-only packages")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--no-recursive", action="store_true")
    args = parser.parse_args()
    classifier = FinalOfflineClassifier(args.model_dir, args.device, args.encoder)
    paths = discover_images(args.input, recursive=not args.no_recursive)
    total = len(paths)
    print(json.dumps({"type": "progress", "total": total, "current": 0}), flush=True)
    
    results = []
    for i, path in enumerate(paths):
        res = classifier.classify_many([path])
        results.extend(res)
        print(json.dumps({"type": "progress", "total": total, "current": i + 1}), flush=True)
    if args.output is None:
        return 0
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    fields = ["source", *classifier.head_spaces]
    with (args.output / "results.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for result in results:
            writer.writerow({"source": result["source"], **result["labels"]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
