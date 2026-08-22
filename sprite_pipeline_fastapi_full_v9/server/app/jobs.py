import asyncio
import json
import os
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

JOBS_ROOT = Path(os.environ.get("SPRITE_JOBS_ROOT", "/workspace/sprite-pipeline/jobs"))
JOB_ID_RE = re.compile(r"^[a-f0-9]{32}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self):
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._lock = threading.RLock()

    def valid_job_id(self, job_id: str) -> bool:
        return bool(JOB_ID_RE.fullmatch(job_id))

    def job_dir(self, job_id: str) -> Path:
        if not self.valid_job_id(job_id):
            raise ValueError("Invalid job_id")
        return JOBS_ROOT / job_id

    def status_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "status.json"

    def request_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "request.json"

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    def create(
        self,
        job_id: str,
        prompt: str,
        seed: int,
        inputs: dict[str, str],
        subject_profile: str = "character",
        profile_classification: dict[str, Any] | None = None,
        motion_backend: str = "kimodo",
        requested_motion_backend: str = "auto",
        motion_routing: dict[str, Any] | None = None,
        motion_input: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            root = self.job_dir(job_id)
            for name in ("input", "motion", "pose", "rendered", "result"):
                (root / name).mkdir(parents=True, exist_ok=True)

            now = utc_now()
            request = {
                "job_id": job_id,
                "prompt": prompt,
                "seed": seed,
                "inputs": inputs,
                "subject_profile": subject_profile,
                "profile_classification": profile_classification or {},
                "motion_backend": motion_backend,
                "requested_motion_backend": requested_motion_backend,
                "motion_routing": motion_routing or {},
                "motion_input": motion_input or {},
                "created_at": now,
            }
            status = {
                "job_id": job_id,
                "status": "queued",
                "stage": "queued",
                "progress": 0,
                "subject_profile": subject_profile,
                "profile_classification": profile_classification or {},
                "motion_backend": motion_backend,
                "requested_motion_backend": requested_motion_backend,
                "motion_routing": motion_routing or {},
                "motion_input": motion_input or {},
                "created_at": now,
                "updated_at": now,
                "error": None,
                "result_url": f"/v1/jobs/{job_id}/result",
                "debug_url": f"/v1/jobs/{job_id}/debug",
            }
            self._write_json(self.request_path(job_id), request)
            self._write_json(self.status_path(job_id), status)
            return status

    def get_request(self, job_id: str) -> dict[str, Any] | None:
        try:
            path = self.request_path(job_id)
        except ValueError:
            return None
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def get(self, job_id: str) -> dict[str, Any] | None:
        try:
            path = self.status_path(job_id)
        except ValueError:
            return None
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def update(self, job_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            status = self.get(job_id)
            if status is None:
                raise KeyError(job_id)
            status.update(fields)
            status["updated_at"] = utc_now()
            self._write_json(self.status_path(job_id), status)
            return status

    def recoverable_jobs(self) -> list[str]:
        recovered: list[str] = []
        with self._lock:
            for status_path in sorted(JOBS_ROOT.glob("*/status.json")):
                try:
                    status = json.loads(status_path.read_text(encoding="utf-8"))
                    job_id = str(status.get("job_id", ""))
                    if not self.valid_job_id(job_id):
                        continue
                    if status.get("status") not in {"queued", "processing"}:
                        continue
                    if not self.request_path(job_id).exists():
                        continue
                    status.update(
                        status="queued",
                        stage="recovered_after_restart",
                        progress=min(int(status.get("progress", 0)), 20),
                        updated_at=utc_now(),
                    )
                    self._write_json(status_path, status)
                    recovered.append(job_id)
                except Exception:
                    continue
        return recovered

    def delete(self, job_id: str) -> bool:
        with self._lock:
            try:
                root = self.job_dir(job_id)
            except ValueError:
                return False
            if not root.exists():
                return False
            status = self.get(job_id) or {}
            if status.get("status") == "processing":
                raise RuntimeError("processing job cannot be deleted")
            shutil.rmtree(root)
            return True


store = JobStore()
