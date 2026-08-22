from __future__ import annotations

import argparse
import time
from contextlib import ExitStack
from pathlib import Path

import requests

SUBJECT_PROFILES = ("auto", "character", "quadruped", "biped_animal")
MOTION_BACKENDS = ("auto", "kimodo", "animal_procedural", "animal_npz")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Submit a V9 four-direction sprite motion job."
    )
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--front", required=True)
    parser.add_argument("--back", required=True)
    parser.add_argument("--left", required=True)
    parser.add_argument("--right", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--subject-profile",
        choices=SUBJECT_PROFILES,
        default="auto",
        help="character preserves V8 Kimodo; animal profiles bypass it.",
    )
    parser.add_argument(
        "--motion-backend",
        choices=MOTION_BACKENDS,
        default="auto",
        help="animal_npz requires --motion-npz.",
    )
    parser.add_argument("--motion-npz", help="Optional animal-motion-v1 NPZ.")
    parser.add_argument("--output", default="result.zip")
    return parser.parse_args()


def validate_route(args: argparse.Namespace) -> None:
    has_npz = bool(args.motion_npz)
    if args.motion_backend == "animal_npz" and not has_npz:
        raise SystemExit("--motion-backend animal_npz requires --motion-npz")
    if args.subject_profile == "character":
        if args.motion_backend not in {"auto", "kimodo"} or has_npz:
            raise SystemExit(
                "character requests preserve the V8 Kimodo path and cannot use animal NPZ"
            )
    if args.subject_profile in {"quadruped", "biped_animal"}:
        if args.motion_backend == "kimodo":
            raise SystemExit("animal profiles cannot use Kimodo")
    if has_npz and Path(args.motion_npz).suffix.lower() != ".npz":
        raise SystemExit("--motion-npz must point to a .npz file")


def main() -> None:
    args = parse_args()
    validate_route(args)

    base = args.base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {args.token}"}

    with ExitStack() as stack:
        files: dict[str, object] = {}
        for direction in ("front", "back", "left", "right"):
            path = Path(getattr(args, direction))
            handle = stack.enter_context(path.open("rb"))
            files[direction] = (path.name, handle, "image/png")
        if args.motion_npz:
            motion_path = Path(args.motion_npz)
            motion_handle = stack.enter_context(motion_path.open("rb"))
            files["motion_npz"] = (
                motion_path.name,
                motion_handle,
                "application/octet-stream",
            )

        response = requests.post(
            f"{base}/v1/jobs",
            headers=headers,
            files=files,
            data={
                "prompt": args.prompt,
                "seed": str(args.seed),
                "subject_profile": args.subject_profile,
                "motion_backend": args.motion_backend,
            },
            timeout=60,
        )

    response.raise_for_status()
    body = response.json()
    job_id = body["job_id"]
    print("job_id:", job_id)
    print("subject_profile:", body.get("subject_profile"))
    print("motion_backend:", body.get("motion_backend"))

    while True:
        response = requests.get(
            f"{base}/v1/jobs/{job_id}",
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        status = response.json()
        print(status.get("status"), status.get("stage"), status.get("progress"))

        if status["status"] == "succeeded":
            break
        if status["status"] == "failed":
            debug_url = status.get("debug_url")
            if debug_url:
                print("failure debug:", f"{base}{debug_url}")
            raise RuntimeError(status)

        time.sleep(2)

    response = requests.get(
        f"{base}/v1/jobs/{job_id}/result",
        headers=headers,
        timeout=120,
    )
    response.raise_for_status()
    output = Path(args.output)
    output.write_bytes(response.content)
    print("saved:", output)


if __name__ == "__main__":
    main()
