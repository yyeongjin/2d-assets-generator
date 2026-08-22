#!/usr/bin/env python3
"""Run the V8 Motion Adapter against a Kimodo NPZ without loading One-to-All."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
from pathlib import Path

from PIL import Image


BUNDLE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MOTION = Path(
    "/workspace/sprite-pipeline/kimodo/kimodo/assets/demo/examples/"
    "kimodo-soma-rp/05_root_path/motion.npz"
)
DEFAULT_OUTPUT = Path("/tmp/sprite-v8-adapter-check")


def load_adapter_module():
    path = BUNDLE_ROOT / "adapter" / "service.py"
    spec = importlib.util.spec_from_file_location("sprite_adapter_v8_validator", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load adapter module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate cycle selection, heading canonicalization, cardinal front/back "
            "locking, and opposite-view projection for a Kimodo motion.npz."
        )
    )
    parser.add_argument("--motion", type=Path, default=DEFAULT_MOTION)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--keep-output",
        action="store_true",
        help="Keep an existing output directory instead of clearing it first.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    motion = args.motion.resolve()
    output = args.output.resolve()

    if not motion.is_file():
        raise SystemExit(f"Motion NPZ not found: {motion}")

    if output.exists() and not args.keep_output:
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    ref_root = output / "_validation_refs"
    ref_root.mkdir(parents=True, exist_ok=True)
    refs = {}
    for direction in ("front", "back", "left", "right"):
        path = ref_root / f"{direction}.png"
        Image.new("RGB", (96, 144), "white").save(path)
        refs[direction] = path

    adapter = load_adapter_module()
    adapter.build_pose_controls(motion, refs, output)

    meta = json.loads((output / "adapter_meta.json").read_text(encoding="utf-8"))
    validation = meta["validation"]
    cardinal = meta["cardinal_quality"]
    lock = cardinal["front_back_lock"]

    summary = {
        "status": "ok" if validation["ok"] else "failed",
        "adapter_version": meta["adapter_version"],
        "motion": str(motion),
        "cycle": {
            "start": meta["cycle_start"],
            "end": meta["cycle_end"],
            "source": meta["cycle_source"],
            "unique_frames": meta["unique_cycle_frames"],
            "control_endpoint_duplicates_phase_zero": meta[
                "control_endpoint_duplicates_phase_zero"
            ],
        },
        "gait_ok": meta["gait_quality"]["ok"],
        "cardinal_ok": cardinal["ok"],
        "postcanonical_hip_mean_deg": cardinal["postcanonical_hip"]["mean_deg"],
        "front_back_torso": {
            "before_p95_abs_deg": lock["torso_before"]["p95_abs_deg"],
            "after_p95_abs_deg": lock["torso_after"]["p95_abs_deg"],
            "limit_deg": lock["torso_yaw_limit_deg"],
        },
        "front_back_head": {
            "before_p95_abs_deg": lock["head_before"]["p95_abs_deg"],
            "after_p95_abs_deg": lock["head_after"]["p95_abs_deg"],
            "limit_deg": lock["head_yaw_limit_deg"],
        },
        "projection": validation["diagnostics"],
        "control_loop_closure": validation["diagnostics"]["control_loop_closure"],
        "preview": meta["preview"],
        "adapter_meta": str(output / "adapter_meta.json"),
        "adapter_validation": str(output / "adapter_validation.json"),
    }

    summary_path = output / "v8_validation_summary.json"
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if validation["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
