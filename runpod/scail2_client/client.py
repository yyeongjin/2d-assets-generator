"""Upload prepared inputs, manage SCAIL-2 jobs, download videos, and extract PNGs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from pathlib import Path

import boto3
import requests

DIRECTIONS = ("front", "back", "left", "right")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=required_env("RUNPOD_S3_ENDPOINT"),
        aws_access_key_id=required_env("RUNPOD_S3_ACCESS_KEY"),
        aws_secret_access_key=required_env("RUNPOD_S3_SECRET_KEY"),
        region_name=os.environ.get("RUNPOD_S3_REGION", "us-east-1"),
    )


def volume_key(relative_path: str) -> str:
    prefix = os.environ.get("RUNPOD_VOLUME_PREFIX", "scail2-data").strip("/")
    return f"{prefix}/{relative_path.lstrip('/')}"


def output_key(output_path: str) -> str:
    workspace_relative = output_path.removeprefix("/workspace/")
    return workspace_relative.lstrip("/")


def upload_view(client, bucket: str, view: dict) -> None:
    pairs = (
        ("local_reference_image", "reference_image"),
        ("local_reference_mask", "reference_mask"),
        ("local_driving_video", "driving_video"),
        ("local_driving_mask", "driving_mask"),
    )
    for local_key, remote_key in pairs:
        local_path = Path(view[local_key]).expanduser().resolve()
        if not local_path.is_file():
            raise FileNotFoundError(f"prepared input not found: {local_path}")
        object_key = volume_key(view[remote_key])
        print(f"[LOCAL][UPLOAD] {local_path} -> s3://{bucket}/{object_key}", flush=True)
        client.upload_file(str(local_path), bucket, object_key)


def submit_job(api_url: str, api_token: str, direction: str, view: dict, settings: dict) -> str:
    payload = {
        "direction": direction,
        "prompt": view["prompt"],
        "reference_image": view["reference_image"],
        "reference_mask": view["reference_mask"],
        "driving_video": view["driving_video"],
        "driving_mask": view["driving_mask"],
        "target_width": settings["width"],
        "target_height": settings["height"],
        "sample_steps": settings["steps"],
        "sample_shift": settings["shift"],
        "sample_guide_scale": settings["cfg"],
        "sample_solver": settings["solver"],
        "seed": settings["seed"],
    }
    response = requests.post(
        f"{api_url}/v1/jobs",
        headers={"Authorization": f"Bearer {api_token}"},
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    job_id = response.json()["job_id"]
    print(f"[LOCAL][JOB_QUEUED] direction={direction} id={job_id}", flush=True)
    return job_id


def wait_for_job(api_url: str, api_token: str, job_id: str) -> dict:
    while True:
        response = requests.get(
            f"{api_url}/v1/jobs/{job_id}",
            headers={"Authorization": f"Bearer {api_token}"},
            timeout=30,
        )
        response.raise_for_status()
        body = response.json()
        print(f"[LOCAL][JOB_STATUS] id={job_id} status={body['status']}", flush=True)
        if body["status"] == "completed":
            return body
        if body["status"] == "failed":
            raise RuntimeError(body.get("error", "SCAIL-2 job failed"))
        time.sleep(5)


def extract_frames(video_path: Path, output_dir: Path, indices: list[int]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for phase, frame_index in enumerate(indices, start=1):
        output_path = output_dir / f"phase_{phase:02d}_source_{frame_index:03d}.png"
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(video_path),
                "-vf", f"select=eq(n\\,{frame_index})",
                "-frames:v", "1", str(output_path),
            ],
            check=True,
        )
        print(f"[LOCAL][FRAME] phase={phase} source={frame_index} path={output_path}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--views", nargs="+", choices=DIRECTIONS)
    parser.add_argument("--skip-upload", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/scail2"))
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    api_url = required_env("SCAIL2_BASE_URL").rstrip("/")
    api_token = required_env("SCAIL2_API_TOKEN")
    bucket = required_env("RUNPOD_S3_BUCKET")
    storage = s3_client()
    project_root = args.output_dir / manifest["project_id"]

    selected_views = args.views or list(manifest["views"])
    for direction in selected_views:
        view = manifest["views"].get(direction)
        if view is None:
            raise KeyError(f"manifest view is missing: {direction}")
        if not args.skip_upload:
            upload_view(storage, bucket, view)
        job_id = submit_job(api_url, api_token, direction, view, manifest["generation"])
        result = wait_for_job(api_url, api_token, job_id)
        video_path = project_root / direction / f"{direction}_animation_raw.mp4"
        video_path.parent.mkdir(parents=True, exist_ok=True)
        key = output_key(result["output_path"])
        print(f"[LOCAL][DOWNLOAD] s3://{bucket}/{key} -> {video_path}", flush=True)
        storage.download_file(bucket, key, str(video_path))
        extract_frames(video_path, project_root / direction / "frames", manifest["local_extract"]["indices"])
        runtime_seconds = float(result.get("runtime_seconds", 0))
        print(f"[LOCAL][COMPLETE] direction={direction} runtime={runtime_seconds:.1f}s", flush=True)


if __name__ == "__main__":
    main()
