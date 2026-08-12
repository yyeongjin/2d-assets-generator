"""Upload SCAIL-2 inputs to RunPod, wait for jobs, and download raw videos."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from contextlib import ExitStack
from pathlib import Path

import requests

DIRECTIONS = ("front", "back", "left", "right")
UPLOAD_FIELDS = (
    ("local_reference_image", "reference_image", "image/jpeg"),
    ("local_reference_mask", "reference_mask", "image/jpeg"),
    ("local_driving_video", "driving_video", "video/mp4"),
    ("local_driving_mask", "driving_mask", "video/mp4"),
)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def authorization(api_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_token}"}


def submit_job(api_url: str, api_token: str, direction: str, view: dict, settings: dict) -> str:
    data = {
        "direction": direction,
        "prompt": view["prompt"],
        "target_width": str(settings["width"]),
        "target_height": str(settings["height"]),
        "sample_steps": str(settings["steps"]),
        "sample_shift": str(settings["shift"]),
        "sample_guide_scale": str(settings["cfg"]),
        "sample_solver": settings["solver"],
        "seed": str(settings["seed"]),
    }

    with ExitStack() as stack:
        files = {}
        for local_key, form_key, content_type in UPLOAD_FIELDS:
            local_path = Path(view[local_key]).expanduser().resolve()
            if not local_path.is_file():
                raise FileNotFoundError(f"prepared input not found: {local_path}")
            handle = stack.enter_context(local_path.open("rb"))
            files[form_key] = (local_path.name, handle, content_type)
            print(f"[LOCAL][UPLOAD] direction={direction} field={form_key} path={local_path}", flush=True)

        response = requests.post(
            f"{api_url}/v1/jobs",
            headers=authorization(api_token),
            data=data,
            files=files,
            timeout=float(os.environ.get("SCAIL2_UPLOAD_TIMEOUT_SECONDS", "300")),
        )

    response.raise_for_status()
    job_id = response.json()["job_id"]
    print(f"[LOCAL][JOB_QUEUED] direction={direction} id={job_id}", flush=True)
    return job_id


def wait_for_job(api_url: str, api_token: str, job_id: str) -> dict:
    while True:
        response = requests.get(
            f"{api_url}/v1/jobs/{job_id}",
            headers=authorization(api_token),
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


def download_output(api_url: str, api_token: str, job_id: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial_path = destination.with_suffix(destination.suffix + ".part")
    print(f"[LOCAL][DOWNLOAD] id={job_id} -> {destination}", flush=True)
    try:
        with requests.get(
            f"{api_url}/v1/jobs/{job_id}/output",
            headers=authorization(api_token),
            stream=True,
            timeout=(30, 300),
        ) as response:
            response.raise_for_status()
            with partial_path.open("wb") as output:
                for chunk in response.iter_content(chunk_size=8 * 1024 * 1024):
                    if chunk:
                        output.write(chunk)
        partial_path.replace(destination)
    except Exception:
        partial_path.unlink(missing_ok=True)
        raise


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
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/scail2"))
    parser.add_argument("--skip-frame-extraction", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    api_url = required_env("SCAIL2_BASE_URL").rstrip("/")
    api_token = required_env("SCAIL2_API_TOKEN")
    project_root = args.output_dir / manifest["project_id"]

    selected_views = args.views or list(manifest["views"])
    for direction in selected_views:
        view = manifest["views"].get(direction)
        if view is None:
            raise KeyError(f"manifest view is missing: {direction}")
        job_id = submit_job(api_url, api_token, direction, view, manifest["generation"])
        result = wait_for_job(api_url, api_token, job_id)
        video_path = project_root / direction / f"{direction}_animation_raw.mp4"
        download_output(api_url, api_token, job_id, video_path)
        if not args.skip_frame_extraction:
            extract_frames(video_path, project_root / direction / "frames", manifest["local_extract"]["indices"])
        runtime_seconds = float(result.get("runtime_seconds", 0))
        print(f"[LOCAL][COMPLETE] direction={direction} runtime={runtime_seconds:.1f}s", flush=True)


if __name__ == "__main__":
    main()
