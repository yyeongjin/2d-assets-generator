"""Single-process SCAIL-2 runtime used by the RunPod FastAPI worker."""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

SCAIL_REPO_ROOT = Path(os.environ.get("SCAIL_REPO_ROOT", "/workspace/SCAIL-2")).resolve()
SCAIL_CHECKPOINT_DIR = Path(os.environ.get("SCAIL_CHECKPOINT_DIR", "/workspace/models/SCAIL-2")).resolve()
SCAIL_SAFETENSORS_PATH = Path(os.environ.get("SCAIL_SAFETENSORS_PATH", "/workspace/models/SCAIL-2.safetensors")).resolve()
SCAIL_OUTPUT_ROOT = Path(os.environ.get("SCAIL_OUTPUT_ROOT", "/workspace/scail2-data/outputs")).resolve()
SCAIL_CONFIG_PATH = os.environ.get("SCAIL_CONFIG_PATH") or None
SCAIL_DEVICE_ID = int(os.environ.get("SCAIL_DEVICE_ID", "0"))

_PIPELINE = None
_CONFIG = None
_GENERATE_VIDEO = None
_MODEL_LOCK = threading.Lock()
MODEL_STATE = "not_loaded"
MODEL_ERROR: str | None = None


def _require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"{label} not found: {path}")


def load_model_once():
    global _PIPELINE, _CONFIG, _GENERATE_VIDEO, MODEL_STATE, MODEL_ERROR
    if _PIPELINE is not None:
        return _PIPELINE

    with _MODEL_LOCK:
        if _PIPELINE is not None:
            return _PIPELINE
        MODEL_STATE = "loading"
        started_at = time.monotonic()
        try:
            _require_file(SCAIL_SAFETENSORS_PATH, "converted SCAIL safetensors")
            if not SCAIL_REPO_ROOT.is_dir():
                raise FileNotFoundError(f"SCAIL repository not found: {SCAIL_REPO_ROOT}")
            sys.path.insert(0, str(SCAIL_REPO_ROOT))
            import wan  # type: ignore
            from generate import generate_video  # type: ignore
            from wan.configs import SCAIL_CONFIGS, SCAIL_CONFIG_PATHS  # type: ignore

            config = SCAIL_CONFIGS["SCAIL-14B"]
            config_path = SCAIL_CONFIG_PATH or SCAIL_CONFIG_PATHS["SCAIL-14B"]
            print("[SCAIL2][MODEL_LOAD_START]", flush=True)
            _PIPELINE = wan.SCAIL2Pipeline(
                config=config,
                checkpoint_dir=str(SCAIL_CHECKPOINT_DIR),
                scail_safetensors_path=str(SCAIL_SAFETENSORS_PATH),
                scail_config_path=config_path,
                device_id=SCAIL_DEVICE_ID,
                rank=0,
                t5_fsdp=False,
                dit_fsdp=False,
                use_usp=False,
                t5_cpu=False,
                lora_path=None,
                lora_alpha=1.0,
            )
            _CONFIG = config
            _GENERATE_VIDEO = generate_video
            MODEL_STATE = "ready"
            MODEL_ERROR = None
            print(f"[SCAIL2][MODEL_LOAD_COMPLETE] elapsed={time.monotonic() - started_at:.1f}s", flush=True)
            return _PIPELINE
        except Exception as exc:
            MODEL_STATE = "failed"
            MODEL_ERROR = str(exc)
            print(f"[SCAIL2][MODEL_LOAD_FAILED] {exc}", flush=True)
            raise


def generate_job(job_id: str, request) -> dict:
    pipeline = load_model_once()
    assert _CONFIG is not None and _GENERATE_VIDEO is not None
    job_root = SCAIL_OUTPUT_ROOT / job_id
    job_root.mkdir(parents=True, exist_ok=True)
    video_path = job_root / f"{request.direction}_animation_raw.mp4"
    args = SimpleNamespace(
        target_h=request.target_height,
        target_w=request.target_width,
        sample_shift=request.sample_shift,
        sample_solver=request.sample_solver,
        segment_len=81,
        segment_overlap=5,
        sample_steps=request.sample_steps,
        sample_guide_scale=request.sample_guide_scale,
        base_seed=request.seed,
        offload_model=True,
        save_file=str(video_path),
        prompt=request.prompt,
    )
    started_at = time.monotonic()
    print(f"[SCAIL2][JOB_START] id={job_id} direction={request.direction}", flush=True)
    _GENERATE_VIDEO(
        pipeline,
        request.prompt,
        str(request.reference_image),
        str(request.reference_mask),
        str(request.driving_video),
        str(request.driving_mask),
        args,
        SCAIL_DEVICE_ID,
        0,
        _CONFIG,
        None,
        False,
    )
    _require_file(video_path, "SCAIL output video")
    runtime_seconds = time.monotonic() - started_at
    print(f"[SCAIL2][JOB_COMPLETE] id={job_id} elapsed={runtime_seconds:.1f}s", flush=True)
    return {
        "output_path": str(video_path),
        "runtime_seconds": runtime_seconds,
    }
