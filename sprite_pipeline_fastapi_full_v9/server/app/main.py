import asyncio
import hmac
import io
import os
import shutil
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image

from .jobs import store
from .pipeline import (
    KIMODO_WORKER_URL,
    OTA_WORKER_URL,
    PIPELINE_VERSION,
    PipelineError,
    create_failure_debug_zip,
    run_job,
)
from .motion_routing import (
    MAX_ANIMAL_NPZ_MEMBERS,
    MAX_ANIMAL_NPZ_SIZE,
    MAX_ANIMAL_NPZ_UNCOMPRESSED_SIZE,
    SUPPORTED_ANIMAL_NPZ_SCHEMAS,
    VALID_MOTION_BACKENDS,
    inspect_animal_motion_npz_bytes,
    normalize_motion_backend,
    resolve_motion_backend,
)
from .subject_profile import (
    VALID_SUBJECT_PROFILES,
    classify_subject,
    normalize_subject_profile,
)

MAX_IMAGE_SIZE = 20 * 1024 * 1024
security = HTTPBearer(auto_error=False)


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
):
    expected = os.environ.get("API_TOKEN", "").strip()
    if not expected:
        if env_bool("ALLOW_UNAUTHENTICATED_API", False):
            return
        raise HTTPException(
            status_code=503,
            detail="API_TOKEN is required unless ALLOW_UNAUTHENTICATED_API=true",
        )
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    # compare_digest rejects non-ASCII ``str`` values with TypeError. Compare
    # UTF-8 bytes so malformed or unexpected Unicode credentials are handled
    # as an ordinary authentication failure instead of becoming a 500.
    if not hmac.compare_digest(
        credentials.credentials.encode("utf-8"),
        expected.encode("utf-8"),
    ):
        raise HTTPException(status_code=401, detail="Invalid API token")


async def save_image(upload: UploadFile, destination: Path):
    data = await upload.read()
    if not data:
        raise HTTPException(400, "Empty image")
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(413, "Image too large")

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise HTTPException(400, "Invalid image") from exc

    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "PNG")


async def worker_loop():
    while True:
        job_id = await store.queue.get()
        try:
            await run_job(job_id, store)
        except PipelineError as exc:
            status = store.get(job_id) or {}
            debug_path = status.get("debug_path")
            if not debug_path:
                with suppress(Exception):
                    debug_path = str(create_failure_debug_zip(store.job_dir(job_id)))
            store.update(
                job_id,
                status="failed",
                stage=status.get("stage", "failed"),
                progress=100,
                error={"code": exc.code, "message": exc.message},
                debug_path=debug_path,
                debug_url=f"/v1/jobs/{job_id}/debug" if debug_path else None,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            status = store.get(job_id) or {}
            debug_path = None
            with suppress(Exception):
                debug_path = str(create_failure_debug_zip(store.job_dir(job_id)))
            store.update(
                job_id,
                status="failed",
                stage=status.get("stage", "failed"),
                progress=100,
                error={"code": "INTERNAL_ERROR", "message": str(exc)},
                debug_path=debug_path,
                debug_url=f"/v1/jobs/{job_id}/debug" if debug_path else None,
            )
        finally:
            store.queue.task_done()


@asynccontextmanager
async def lifespan(app: FastAPI):
    for job_id in store.recoverable_jobs():
        await store.queue.put(job_id)
    worker = asyncio.create_task(worker_loop())
    app.state.worker = worker
    try:
        yield
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(
    title="Sprite Pipeline API",
    version=PIPELINE_VERSION,
    lifespan=lifespan,
)


async def get_worker_health(url: str):
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()
    except Exception:
        return {"status": "down"}


async def workers_health() -> tuple[dict, dict]:
    return await asyncio.gather(
        get_worker_health(f"{KIMODO_WORKER_URL}/health"),
        get_worker_health(f"{OTA_WORKER_URL}/health"),
    )


@app.get("/")
async def root():
    return {
        "service": "sprite-pipeline",
        "version": PIPELINE_VERSION,
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
        "subject_profiles": list(VALID_SUBJECT_PROFILES),
        "motion_backends": list(VALID_MOTION_BACKENDS),
        "animal_motion_schemas": list(SUPPORTED_ANIMAL_NPZ_SCHEMAS),
    }


@app.get("/health")
async def health():
    kimodo, ota = await workers_health()
    kimodo_ready = kimodo.get("status") == "ready"
    ota_ready = ota.get("status") == "ready"
    return {
        "status": "ready" if ota_ready else "degraded",
        "pipeline_version": PIPELINE_VERSION,
        "api": "ready",
        "kimodo_worker": kimodo,
        "ota_worker": ota,
        "character_ready": bool(kimodo_ready and ota_ready),
        "animal_ready": bool(ota_ready),
        "capabilities": {
            "character": bool(kimodo_ready and ota_ready),
            "quadruped": bool(ota_ready),
            "biped_animal": bool(ota_ready),
            "motion_backends": {
                "kimodo": bool(kimodo_ready and ota_ready),
                "animal_procedural": bool(ota_ready),
                "animal_npz": bool(ota_ready),
            },
            "animal_npz": {
                "schemas": list(SUPPORTED_ANIMAL_NPZ_SCHEMAS),
                "max_upload_bytes": MAX_ANIMAL_NPZ_SIZE,
                "max_uncompressed_bytes": MAX_ANIMAL_NPZ_UNCOMPRESSED_SIZE,
                "max_members": MAX_ANIMAL_NPZ_MEMBERS,
            },
        },
        "queue_size": store.queue.qsize(),
        "auth_enabled": bool(os.environ.get("API_TOKEN")),
        "unauthenticated_api_allowed": env_bool("ALLOW_UNAUTHENTICATED_API", False),
    }


@app.post("/v1/jobs")
async def create_job(
    front: UploadFile = File(...),
    back: UploadFile = File(...),
    left: UploadFile = File(...),
    right: UploadFile = File(...),
    prompt: str = Form(...),
    seed: int = Form(42),
    subject_profile: str = Form("auto"),
    motion_backend: str = Form("auto"),
    motion_npz: UploadFile | None = File(None),
    _auth=Depends(require_auth),
):
    prompt = prompt.strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")
    try:
        requested_profile = normalize_subject_profile(subject_profile)
        requested_backend = normalize_motion_backend(motion_backend)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    has_motion_npz = bool(motion_npz is not None and (motion_npz.filename or "").strip())
    job_id = uuid.uuid4().hex
    root = store.job_dir(job_id)
    input_dir = root / "input"
    paths = {
        "front": input_dir / "front.png",
        "back": input_dir / "back.png",
        "left": input_dir / "left.png",
        "right": input_dir / "right.png",
    }

    try:
        await save_image(front, paths["front"])
        await save_image(back, paths["back"])
        await save_image(left, paths["left"])
        await save_image(right, paths["right"])

        raw_motion: bytes | None = None
        motion_input: dict = {}
        if has_motion_npz:
            assert motion_npz is not None
            raw_motion = await motion_npz.read(MAX_ANIMAL_NPZ_SIZE + 1)
            if len(raw_motion) > MAX_ANIMAL_NPZ_SIZE:
                raise HTTPException(413, "motion_npz is too large")
            try:
                # Inspect without an expected profile first. For auto requests,
                # a declared animal profile is an explicit provider hint and can
                # resolve ambiguity in a prompt/silhouette classifier.
                motion_input = await asyncio.to_thread(
                    inspect_animal_motion_npz_bytes,
                    raw_motion,
                    None,
                )
            except ValueError as exc:
                raise HTTPException(400, f"invalid motion_npz: {exc}") from exc

        classification = await asyncio.to_thread(
            classify_subject,
            requested_profile,
            prompt,
            paths,
        )
        declared_npz_profile = motion_input.get("subject_profile")
        if (
            requested_profile == "auto"
            and declared_npz_profile in {"quadruped", "biped_animal"}
        ):
            classifier_profile = str(classification["resolved_profile"])
            classification = dict(classification)
            classification["classifier_resolved_profile"] = classifier_profile
            classification["resolved_profile"] = declared_npz_profile
            classification["reason"] = "animal_npz_declared_profile"

        resolved_profile = str(classification["resolved_profile"])
        if declared_npz_profile and declared_npz_profile != resolved_profile:
            raise HTTPException(
                400,
                "motion_npz subject_profile does not match the resolved request profile",
            )

        route = resolve_motion_backend(
            resolved_profile,
            requested_backend,
            has_motion_npz,
        )

        if raw_motion is not None:
            motion_path = input_dir / "animal_motion.npz"
            motion_path.parent.mkdir(parents=True, exist_ok=True)
            motion_path.write_bytes(raw_motion)
            motion_input["path"] = "input/animal_motion.npz"
            motion_input["original_filename"] = Path(motion_npz.filename or "animal_motion.npz").name

        kimodo, ota = await workers_health()
        ota_ready = ota.get("status") == "ready"
        kimodo_ready = kimodo.get("status") == "ready"
        required_ready = ota_ready and (
            route.resolved_backend != "kimodo" or kimodo_ready
        )
        if not required_ready:
            raise HTTPException(
                503,
                detail={
                    "message": "Required model worker is not ready",
                    "subject_profile": resolved_profile,
                    "motion_backend": route.resolved_backend,
                    "kimodo_required": route.resolved_backend == "kimodo",
                    "kimodo_worker": kimodo,
                    "ota_worker": ota,
                },
            )

        routing = {
            "requested_backend": route.requested_backend,
            "resolved_backend": route.resolved_backend,
            "reason": route.reason,
            "motion_npz_required": route.motion_npz_required,
        }
        status = store.create(
            job_id=job_id,
            prompt=prompt,
            seed=seed,
            inputs={direction: str(path) for direction, path in paths.items()},
            subject_profile=resolved_profile,
            profile_classification=classification,
            motion_backend=route.resolved_backend,
            requested_motion_backend=route.requested_backend,
            motion_routing=routing,
            motion_input=motion_input,
        )
        await store.queue.put(job_id)
    except HTTPException:
        shutil.rmtree(root, ignore_errors=True)
        raise
    except ValueError as exc:
        shutil.rmtree(root, ignore_errors=True)
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        shutil.rmtree(root, ignore_errors=True)
        raise HTTPException(400, f"job preparation failed: {exc}") from exc
    finally:
        await front.close()
        await back.close()
        await left.close()
        await right.close()
        if motion_npz is not None:
            await motion_npz.close()

    return JSONResponse(
        status_code=202,
        content={
            "job_id": job_id,
            "status": status["status"],
            "subject_profile": resolved_profile,
            "profile_classification": classification,
            "motion_backend": route.resolved_backend,
            "motion_routing": routing,
            "motion_input": motion_input,
            "status_url": f"/v1/jobs/{job_id}",
            "result_url": f"/v1/jobs/{job_id}/result",
            "debug_url": f"/v1/jobs/{job_id}/debug",
        },
    )


@app.get("/v1/jobs/{job_id}")
async def job_status(job_id: str, _auth=Depends(require_auth)):
    status = store.get(job_id)
    if status is None:
        raise HTTPException(404, "Job not found")
    return status


@app.get("/v1/jobs/{job_id}/result")
async def job_result(job_id: str, _auth=Depends(require_auth)):
    status = store.get(job_id)
    if status is None:
        raise HTTPException(404, "Job not found")

    if status["status"] == "failed":
        raise HTTPException(
            409,
            detail={
                "status": "failed",
                "error": status.get("error"),
                "debug_url": status.get("debug_url"),
            },
        )
    if status["status"] != "succeeded":
        raise HTTPException(
            409,
            detail={
                "status": status["status"],
                "stage": status["stage"],
                "progress": status["progress"],
            },
        )

    result = Path(status["result_path"])
    if not result.exists():
        raise HTTPException(500, "Result ZIP missing")
    return FileResponse(result, media_type="application/zip", filename=f"{job_id}.zip")


@app.get("/v1/jobs/{job_id}/debug")
async def job_debug(job_id: str, _auth=Depends(require_auth)):
    status = store.get(job_id)
    if status is None:
        raise HTTPException(404, "Job not found")
    debug_path = status.get("debug_path")
    if not debug_path and status.get("status") == "failed":
        with suppress(Exception):
            debug_path = str(create_failure_debug_zip(store.job_dir(job_id)))
            store.update(job_id, debug_path=debug_path, debug_url=f"/v1/jobs/{job_id}/debug")
    if not debug_path:
        raise HTTPException(409, "Debug ZIP is available only after a failed job")
    path = Path(debug_path)
    if not path.exists():
        raise HTTPException(500, "Debug ZIP missing")
    return FileResponse(path, media_type="application/zip", filename=f"{job_id}-debug.zip")


@app.delete("/v1/jobs/{job_id}", status_code=204)
async def delete_job(job_id: str, _auth=Depends(require_auth)):
    try:
        deleted = store.delete(job_id)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    if not deleted:
        raise HTTPException(404, "Job not found")
    return Response(status_code=204)
