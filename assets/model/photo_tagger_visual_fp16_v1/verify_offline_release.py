"""Verify or refresh the SHA-256 manifest of an offline release."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def calculate(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(item for item in root.rglob("*") if item.is_file())
        if path.name != "checksums.sha256.json" and "__pycache__" not in path.parts and path.suffix != ".pyc"
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path, nargs="?", default=Path(__file__).resolve().parent)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    root = args.release.resolve()
    checksum_path = root / "checksums.sha256.json"
    actual = calculate(root)
    if args.refresh:
        checksum_path.write_text(json.dumps(actual, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"refreshed": len(actual), "release": str(root)}))
        return 0
    expected = json.loads(checksum_path.read_text(encoding="utf-8"))
    missing = sorted(set(expected) - set(actual))
    unexpected = sorted(set(actual) - set(expected))
    changed = sorted(path for path in set(expected) & set(actual) if expected[path] != actual[path])
    report = {"passed": not (missing or unexpected or changed), "checked": len(actual), "missing": missing, "unexpected": unexpected, "changed": changed}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
