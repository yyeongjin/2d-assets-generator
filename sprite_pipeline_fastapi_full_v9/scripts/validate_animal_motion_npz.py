#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.app.motion_routing import inspect_animal_motion_npz


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate an animal-motion-v1 NPZ.")
    parser.add_argument("path", type=Path)
    parser.add_argument(
        "--subject-profile", choices=("quadruped", "biped_animal")
    )
    args = parser.parse_args()
    report = inspect_animal_motion_npz(args.path, args.subject_profile)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
