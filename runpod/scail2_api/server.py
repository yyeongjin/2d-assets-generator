"""Queued FastAPI wrapper for one SCAIL-2 GPU pipeline."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

import runtime

DATA_ROOT = Path(os.environ.get("SCAIL_DATA_ROOT", "/workspace/scail2-data")).resolve()
API_TOKEN = os.environ.get("SCAIL_API_TOKEN", "").strip()
PRELOAD_MODEL = os.environ.get("SCAIL_LOAD_ON_START", "1") == "1"
security = HTTPBearer(auto_error=False)
queue: asyncio.Queue[str] = asyncio.Queue()
jobs: dict[str, dict] = {}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_token(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> None:
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="SCAIL_API_TOKEN is not configured")
    if credentials is None or credentials.scheme.lower() != "bearer" or not secrets.compare_digest(credentials.credentials, API_TOKEN):
        raise HTTPException(status_code=401, detail="invalid API token")


def resolve_input_path(value: str) -> Path:
    candidate = (DATA_ROOT / value).resolve()
    if candidate != DATA_ROOT and DATA_ROOT not in candidate.parents:
        raise ValueError("path escapes SCAIL_DATA_ROOT")
    if not candidate.is_file():
        raise ValueError(f"input file not found: {value}")
    return candidate


class JobRequest(BaseModel):
    direction: str
    prompt: str = Field(min_length=1, max_length=4000)
    reference_image: Path
    reference_mask: Path
    driving_video: Path
    driving_mask: Path
    target_width: int = Field(default=896, ge=32, le=2048, multiple_of=32)
    target_height: int = Field(default=512, ge=32, le=2048, multiple_of=32)
    sample_steps: int = Field(default=40, ge=1, le=100)
    sample_shift: float = Field(default=3.0, ge=0.0, le=20.0)
    sample_guide_scale: float = Field(default=5.0, ge=0.0, le=30.0)
    sample_solver: str = "unipc"
    seed: int = Field(default=4821, ge=0, le=2_147_483_647)

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, value: str) -> str:
        if value not in {"front", "back", "right", "left"}:
            raise ValueError("direction must be front, back, right, or left")
        return value

    @field_validator("sample_solver")
    @classmethod
    def validate_solver(cls, value: str) -> str:
        if value not in {"unipc", "dpm++"}:
            raise ValueError("sample_solver must be unipc or dpm++")
        return value

    @field_validator("reference_image", "reference_mask", "driving_video", "driving_mask", mode="before")
    @classmethod
    def validate_input_path(cls, value) -> Path:
        return resolve_input_path(str(value))

async def persist_job(job_id: str) -> None:
    job_root = runtime.SCAIL_OUTPUT_ROOT / job_id
    job_root.mkdir(parents=True, exist_ok=True)
    serializable = dict(jobs[job_id])
    request = serializable.get("request")
    if isinstance(request, JobRequest):
        serializable["request"] = request.model_dump(mode="json")
    (job_root / "job.json").write_text(json.dumps(serializable, ensure_ascii=False, indent=2), encoding="utf-8")


async def gpu_worker() -> None:
    while True:
        job_id = await queue.get()
        record = jobs[job_id]
        record.update(status="running", started_at=utc_now())
        await persist_job(job_id)
        try:
            result = await asyncio.to_thread(runtime.generate_job, job_id, record["request"])
            record.update(status="completed", completed_at=utc_now(), **result)
        except Exception as exc:
            record.update(status="failed", completed_at=utc_now(), error=str(exc))
            print(f"[SCAIL2][JOB_FAILED] id={job_id} error={exc}", flush=True)
        finally:
            await persist_job(job_id)
            queue.task_done()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    runtime.SCAIL_OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    worker_task = asyncio.create_task(gpu_worker())
    preload_task = asyncio.create_task(asyncio.to_thread(runtime.load_model_once)) if PRELOAD_MODEL else None
    yield
    worker_task.cancel()
    if preload_task:
        preload_task.cancel()


app = FastAPI(title="SCAIL-2 Pod API", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "ok": runtime.MODEL_STATE != "failed",
        "model": "SCAIL-14B",
        "model_state": runtime.MODEL_STATE,
        "model_error": runtime.MODEL_ERROR,
        "queue_depth": queue.qsize(),
        "active_jobs": sum(1 for job in jobs.values() if job["status"] == "running"),
    }


@app.post("/v1/jobs", status_code=202, dependencies=[Depends(require_token)])
async def create_job(request: JobRequest):
    job_id = uuid.uuid4().hex[:16]
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "direction": request.direction,
        "created_at": utc_now(),
        "request": request,
    }
    await queue.put(job_id)
    await persist_job(job_id)
    print(f"[SCAIL2][JOB_QUEUED] id={job_id} direction={request.direction} depth={queue.qsize()}", flush=True)
    return {"job_id": job_id, "status": "queued", "queue_position": queue.qsize()}


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(require_token)])
async def get_job(job_id: str):
    record = jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")
    return {key: value for key, value in record.items() if key != "request"}
