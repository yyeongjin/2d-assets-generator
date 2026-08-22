#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adapter.animal_service import DIRECTIONS, UNIQUE_CYCLE_FRAMES, _build_direction
from server.app.motion_routing import inspect_animal_motion_npz


def build_payload(subject_profile: str) -> dict[str, np.ndarray]:
    payload: dict[str, np.ndarray] = {
        "schema_version": np.array("animal-motion-v1"),
        "subject_profile": np.array(subject_profile),
        "coordinate_space": np.array("subject_box"),
        "provider": np.array("v9-contract-example"),
        "motion_name": np.array("walk-cycle-contract-example"),
        "source_model": np.array("procedural-contract-example-not-a-trained-model"),
    }
    for direction in DIRECTIONS:
        frames, scores = _build_direction(
            subject_profile,
            direction,
            (0.0, 0.0, 1.0, 1.0),
        )
        # animal-motion-v1 providers submit unique periodic phases. The V9
        # adapter adds the exact repeated endpoint after resampling.
        payload[direction] = frames[:UNIQUE_CYCLE_FRAMES].astype(np.float32)
        payload[f"{direction}_scores"] = scores[:UNIQUE_CYCLE_FRAMES].astype(
            np.float32
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create a small animal-motion-v1 contract example. This verifies "
            "routing/NPZ plumbing and is not a trained animal motion model."
        )
    )
    parser.add_argument(
        "--subject-profile",
        required=True,
        choices=("quadruped", "biped_animal"),
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output, **build_payload(args.subject_profile))
    report = inspect_animal_motion_npz(args.output, args.subject_profile)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
