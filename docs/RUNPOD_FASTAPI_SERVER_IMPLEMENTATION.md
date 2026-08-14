# RunPod FastAPI 서버 구현 가이드

> **상태: 개선 중인 최신 구현.** FastAPI queue, Kimodo·OTA worker 호출과 결과 ZIP 생성까지는 동작했다. 현재 결과 품질 문제는 이 경로를 기각한 근거가 아니라 pose visibility/confidence 연결부를 수정해야 한다는 근거다. 제작 결과로 사용하기 전 [추후 개선 사항](KIMODO_ONE_TO_ALL_FUTURE_IMPROVEMENTS.md)을 반영하고 다시 검증한다.

`/workspace/sprite-pipeline/server`에 있다고 보고 아래를 실행한다.

이 코드는 실제로 다음 라우트를 띄웁니다.

```text
GET  /health
POST /v1/jobs
GET  /v1/jobs/{job_id}
GET  /v1/jobs/{job_id}/result
```

그리고 **job queue도 실제로 1개씩 직렬 처리**합니다. `pipeline.py`는 최종 구조대로 `Kimodo worker → Motion Adapter → OTA worker → 32PNG/ZIP`을 호출하도록 만듭니다.

---

# 1. `app/__init__.py`

```bash
cd /workspace/sprite-pipeline/server

mkdir -p app

cat <<'PY' > app/__init__.py
# sprite-pipeline API package
PY
```

# 2. `app/jobs.py`

Job 상태 저장 + queue입니다.

```bash
cat <<'PY' > app/jobs.py
import asyncio
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JOBS_ROOT = Path(
    os.environ.get(
        "SPRITE_JOBS_ROOT",
        "/workspace/sprite-pipeline/jobs",
    )
)

JOBS_ROOT.mkdir(parents=True, exist_ok=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self):
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._lock = threading.RLock()

    def job_dir(self, job_id: str) -> Path:
        return JOBS_ROOT / job_id

    def status_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "status.json"

    def request_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "request.json"

    def _atomic_json_write(
        self,
        path: Path,
        data: dict[str, Any],
    ) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)

        tmp = path.with_suffix(path.suffix + ".tmp")

        with tmp.open("w", encoding="utf-8") as f:
            json.dump(
                data,
                f,
                ensure_ascii=False,
                indent=2,
            )

        tmp.replace(path)

    def create(
        self,
        *,
        job_id: str,
        prompt: str,
        seed: int,
        inputs: dict[str, str],
    ) -> dict[str, Any]:
        with self._lock:
            job_dir = self.job_dir(job_id)

            (job_dir / "input").mkdir(parents=True, exist_ok=True)
            (job_dir / "motion").mkdir(parents=True, exist_ok=True)
            (job_dir / "pose").mkdir(parents=True, exist_ok=True)
            (job_dir / "rendered").mkdir(parents=True, exist_ok=True)
            (job_dir / "result").mkdir(parents=True, exist_ok=True)

            request_data = {
                "job_id": job_id,
                "prompt": prompt,
                "seed": seed,
                "inputs": inputs,
                "created_at": utc_now(),
            }

            status = {
                "job_id": job_id,
                "status": "queued",
                "stage": "queued",
                "progress": 0,
                "created_at": request_data["created_at"],
                "updated_at": request_data["created_at"],
                "error": None,
                "result_url": f"/v1/jobs/{job_id}/result",
            }

            self._atomic_json_write(
                self.request_path(job_id),
                request_data,
            )

            self._atomic_json_write(
                self.status_path(job_id),
                status,
            )

            return status

    def get_request(self, job_id: str) -> dict[str, Any] | None:
        path = self.request_path(job_id)

        if not path.exists():
            return None

        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def get(self, job_id: str) -> dict[str, Any] | None:
        path = self.status_path(job_id)

        if not path.exists():
            return None

        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def update(
        self,
        job_id: str,
        **fields: Any,
    ) -> dict[str, Any]:
        with self._lock:
            status = self.get(job_id)

            if status is None:
                raise KeyError(job_id)

            status.update(fields)
            status["updated_at"] = utc_now()

            self._atomic_json_write(
                self.status_path(job_id),
                status,
            )

            return status


store = JobStore()
PY
```

# 3. `app/pipeline.py`

이게 실제 orchestration입니다.

**중요:** Kimodo와 OTA는 서로 다른 venv라서 FastAPI 프로세스 안에 import하지 않습니다. 각각 localhost worker로 호출하는 구조입니다.

```bash
cat <<'PY' > app/pipeline.py
import asyncio
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

import httpx
from PIL import Image

from .jobs import JobStore


PROJECT_ROOT = Path("/workspace/sprite-pipeline")

KIMODO_WORKER_URL = os.environ.get(
    "KIMODO_WORKER_URL",
    "http://127.0.0.1:9101",
)

OTA_WORKER_URL = os.environ.get(
    "OTA_WORKER_URL",
    "http://127.0.0.1:9102",
)

SELECTED_PHASES = [
    0,
    2,
    4,
    6,
    8,
    10,
    12,
    14,
]

DIRECTIONS = [
    "front",
    "back",
    "left",
    "right",
]


class PipelineError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
    ):
        super().__init__(message)
        self.code = code
        self.message = message


async def call_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs,
):
    try:
        response = await client.request(
            method,
            url,
            **kwargs,
        )
    except httpx.ConnectError as exc:
        raise PipelineError(
            "WORKER_UNREACHABLE",
            f"Worker unreachable: {url}",
        ) from exc

    if response.status_code >= 400:
        raise PipelineError(
            "WORKER_FAILED",
            (
                f"{url} returned "
                f"{response.status_code}: "
                f"{response.text}"
            ),
        )

    return response.json()


def load_adapter():
    """
    adapter/service.py는 server venv에서 실행한다.

    필요한 함수:
        build_pose_controls(
            motion_npz: Path,
            refs: dict[str, Path],
            output_root: Path,
        ) -> dict[str, Path]
    """

    root = str(PROJECT_ROOT)

    if root not in sys.path:
        sys.path.insert(0, root)

    try:
        from adapter.service import build_pose_controls
    except ImportError as exc:
        raise PipelineError(
            "MOTION_ADAPTER_NOT_READY",
            (
                "Cannot import "
                "/workspace/sprite-pipeline/adapter/service.py"
            ),
        ) from exc

    return build_pose_controls


def collect_pngs(directory: Path) -> list[Path]:
    files = sorted(
        directory.glob("*.png"),
        key=lambda p: p.name,
    )

    return files


def extract_sprite_frames(
    rendered_root: Path,
    result_root: Path,
) -> None:
    for direction in DIRECTIONS:
        src_dir = rendered_root / direction
        dst_dir = result_root / direction

        dst_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        frames = collect_pngs(src_dir)

        if len(frames) < 15:
            raise PipelineError(
                "NOT_ENOUGH_RENDERED_FRAMES",
                (
                    f"{direction}: expected at least "
                    f"15 frames, got {len(frames)}"
                ),
            )

        for output_index, source_index in enumerate(
            SELECTED_PHASES
        ):
            src = frames[source_index]
            dst = dst_dir / f"{output_index}.png"

            shutil.copy2(
                src,
                dst,
            )


def create_sprite_sheet(
    result_root: Path,
) -> Path:
    all_rows: list[list[Image.Image]] = []

    cell_width = None
    cell_height = None

    for direction in DIRECTIONS:
        row: list[Image.Image] = []

        for i in range(8):
            path = result_root / direction / f"{i}.png"

            image = Image.open(path).convert("RGBA")

            if cell_width is None:
                cell_width = image.width
                cell_height = image.height

            if (
                image.width != cell_width
                or image.height != cell_height
            ):
                image = image.resize(
                    (cell_width, cell_height),
                    Image.Resampling.LANCZOS,
                )

            row.append(image)

        all_rows.append(row)

    assert cell_width is not None
    assert cell_height is not None

    sheet = Image.new(
        "RGBA",
        (
            cell_width * 8,
            cell_height * 4,
        ),
        (0, 0, 0, 0),
    )

    for row_index, row in enumerate(all_rows):
        for col_index, image in enumerate(row):
            sheet.alpha_composite(
                image,
                (
                    col_index * cell_width,
                    row_index * cell_height,
                ),
            )

    output = result_root / "sprite_sheet.png"
    sheet.save(output)

    return output


def create_metadata(
    *,
    job_id: str,
    prompt: str,
    seed: int,
    result_root: Path,
) -> Path:
    metadata = {
        "job_id": job_id,
        "animation": "walk",
        "prompt": prompt,
        "seed": seed,
        "directions": DIRECTIONS,
        "frames_per_direction": 8,
        "source_motion_frames": 17,
        "selected_phase_indices": SELECTED_PHASES,
        "loop": True,
    }

    path = result_root / "metadata.json"

    with path.open(
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            metadata,
            f,
            ensure_ascii=False,
            indent=2,
        )

    return path


def create_zip(
    result_root: Path,
) -> Path:
    zip_path = result_root / "result.zip"

    with zipfile.ZipFile(
        zip_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as zf:
        for direction in DIRECTIONS:
            for i in range(8):
                path = result_root / direction / f"{i}.png"

                zf.write(
                    path,
                    arcname=f"{direction}/{i}.png",
                )

        zf.write(
            result_root / "sprite_sheet.png",
            arcname="sprite_sheet.png",
        )

        zf.write(
            result_root / "metadata.json",
            arcname="metadata.json",
        )

    return zip_path


async def run_job(
    job_id: str,
    store: JobStore,
) -> None:
    request = store.get_request(job_id)

    if request is None:
        raise PipelineError(
            "JOB_REQUEST_NOT_FOUND",
            f"Missing request.json for {job_id}",
        )

    job_dir = store.job_dir(job_id)

    prompt = request["prompt"]
    seed = int(request["seed"])

    inputs = {
        direction: Path(path)
        for direction, path in request["inputs"].items()
    }

    motion_dir = job_dir / "motion"
    pose_root = job_dir / "pose"
    rendered_root = job_dir / "rendered"
    result_root = job_dir / "result"

    motion_path = motion_dir / "motion.npz"

    timeout = httpx.Timeout(
        connect=10.0,
        read=None,
        write=60.0,
        pool=None,
    )

    async with httpx.AsyncClient(
        timeout=timeout,
    ) as client:

        # --------------------------
        # Kimodo
        # --------------------------

        store.update(
            job_id,
            status="processing",
            stage="kimodo",
            progress=5,
        )

        kimodo_result = await call_json(
            client,
            "POST",
            f"{KIMODO_WORKER_URL}/generate",
            json={
                "prompt": prompt,
                "seed": seed,
                "duration": 3.0,
                "diffusion_steps": 100,
                "output_path": str(motion_path),
            },
        )

        returned_motion = Path(
            kimodo_result.get(
                "motion_path",
                motion_path,
            )
        )

        if not returned_motion.exists():
            raise PipelineError(
                "KIMODO_OUTPUT_MISSING",
                (
                    "Kimodo worker returned success "
                    "but motion.npz does not exist"
                ),
            )

        # --------------------------
        # Motion Adapter
        # --------------------------

        store.update(
            job_id,
            stage="motion_adapter",
            progress=20,
        )

        build_pose_controls = load_adapter()

        pose_dirs = await asyncio.to_thread(
            build_pose_controls,
            returned_motion,
            inputs,
            pose_root,
        )

        for direction in DIRECTIONS:
            if direction not in pose_dirs:
                raise PipelineError(
                    "POSE_DIRECTION_MISSING",
                    f"Adapter did not return {direction}",
                )

            pose_dir = Path(pose_dirs[direction])

            if not pose_dir.exists():
                raise PipelineError(
                    "POSE_OUTPUT_MISSING",
                    f"Pose directory missing: {pose_dir}",
                )

        # --------------------------
        # One-to-All
        # --------------------------

        progress_map = {
            "front": 35,
            "back": 50,
            "left": 65,
            "right": 80,
        }

        for direction in DIRECTIONS:
            store.update(
                job_id,
                stage=f"render_{direction}",
                progress=progress_map[direction],
            )

            output_dir = rendered_root / direction

            output_dir.mkdir(
                parents=True,
                exist_ok=True,
            )

            ota_result = await call_json(
                client,
                "POST",
                f"{OTA_WORKER_URL}/render",
                json={
                    "reference_image": str(
                        inputs[direction]
                    ),
                    "pose_dir": str(
                        pose_dirs[direction]
                    ),
                    "output_dir": str(output_dir),
                    "prompt": prompt,
                    "seed": seed,
                    "num_frames": 17,
                },
            )

            frames_dir = Path(
                ota_result.get(
                    "frames_dir",
                    output_dir,
                )
            )

            if not frames_dir.exists():
                raise PipelineError(
                    "OTA_OUTPUT_MISSING",
                    (
                        f"{direction}: OTA output "
                        f"directory missing"
                    ),
                )

            if frames_dir != output_dir:
                if output_dir.exists():
                    shutil.rmtree(output_dir)

                shutil.copytree(
                    frames_dir,
                    output_dir,
                )

        # --------------------------
        # Postprocess
        # --------------------------

        store.update(
            job_id,
            stage="postprocess",
            progress=92,
        )

        extract_sprite_frames(
            rendered_root,
            result_root,
        )

        create_sprite_sheet(
            result_root,
        )

        create_metadata(
            job_id=job_id,
            prompt=prompt,
            seed=seed,
            result_root=result_root,
        )

        zip_path = create_zip(
            result_root,
        )

        if not zip_path.exists():
            raise PipelineError(
                "ZIP_CREATION_FAILED",
                "result.zip was not created",
            )

        store.update(
            job_id,
            status="succeeded",
            stage="succeeded",
            progress=100,
            error=None,
            result_path=str(zip_path),
        )
PY
```

# 4. `app/main.py`

이게 실제 FastAPI 서버입니다.

파일 업로드 → job 생성 → queue → pipeline 실행 → 상태 조회 → ZIP 다운로드까지 들어갑니다.

```bash
cat <<'PY' > app/main.py
import asyncio
import hmac
import io
import os
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)
from PIL import Image

from .jobs import store
from .pipeline import PipelineError, run_job


MAX_IMAGE_BYTES = 20 * 1024 * 1024

security = HTTPBearer(
    auto_error=False,
)


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        security
    ),
):
    expected = os.environ.get("API_TOKEN")

    # 개발 중 API_TOKEN 미설정이면 인증 생략.
    # 외부 공개 전에 반드시 API_TOKEN 설정.
    if not expected:
        return

    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header",
        )

    if credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Bearer token required",
        )

    if not hmac.compare_digest(
        credentials.credentials,
        expected,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid API token",
        )


async def save_upload_as_png(
    upload: UploadFile,
    destination: Path,
) -> None:
    data = await upload.read()

    if not data:
        raise HTTPException(
            status_code=400,
            detail=f"{upload.filename}: empty file",
        )

    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"{upload.filename}: image exceeds "
                f"{MAX_IMAGE_BYTES} bytes"
            ),
        )

    try:
        image = Image.open(
            io.BytesIO(data)
        )

        image.load()

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{upload.filename}: invalid image",
        ) from exc

    if image.mode not in (
        "RGB",
        "RGBA",
    ):
        image = image.convert("RGBA")

    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    image.save(
        destination,
        format="PNG",
    )


async def queue_worker() -> None:
    while True:
        job_id = await store.queue.get()

        try:
            await run_job(
                job_id,
                store,
            )

        except PipelineError as exc:
            store.update(
                job_id,
                status="failed",
                progress=100,
                error={
                    "code": exc.code,
                    "message": exc.message,
                },
            )

        except asyncio.CancelledError:
            raise

        except Exception as exc:
            store.update(
                job_id,
                status="failed",
                progress=100,
                error={
                    "code": "INTERNAL_ERROR",
                    "message": str(exc),
                },
            )

        finally:
            store.queue.task_done()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(
        queue_worker(),
        name="sprite-job-worker",
    )

    app.state.queue_worker = task

    try:
        yield
    finally:
        task.cancel()

        with suppress(
            asyncio.CancelledError
        ):
            await task


app = FastAPI(
    title="Sprite Pipeline API",
    version="1.0.0",
    lifespan=lifespan,
)


async def check_port(
    host: str,
    port: int,
) -> bool:
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(
                host,
                port,
            ),
            timeout=0.5,
        )

        writer.close()

        await writer.wait_closed()

        return True

    except Exception:
        return False


@app.get("/health")
async def health():
    kimodo_ready, ota_ready = await asyncio.gather(
        check_port(
            "127.0.0.1",
            9101,
        ),
        check_port(
            "127.0.0.1",
            9102,
        ),
    )

    return {
        "status": "ok",
        "api": "ready",
        "kimodo_worker": (
            "ready"
            if kimodo_ready
            else "down"
        ),
        "ota_worker": (
            "ready"
            if ota_ready
            else "down"
        ),
        "queue_size": store.queue.qsize(),
        "auth_enabled": bool(
            os.environ.get("API_TOKEN")
        ),
    }


@app.post("/v1/jobs")
async def create_job(
    front: UploadFile = File(...),
    back: UploadFile = File(...),
    left: UploadFile = File(...),
    right: UploadFile = File(...),
    prompt: str = Form(...),
    seed: int = Form(42),
    _auth=Depends(require_auth),
):
    prompt = prompt.strip()

    if not prompt:
        raise HTTPException(
            status_code=400,
            detail="prompt is required",
        )

    job_id = uuid.uuid4().hex

    job_dir = store.job_dir(
        job_id
    )

    input_dir = job_dir / "input"

    paths = {
        "front": input_dir / "front.png",
        "back": input_dir / "back.png",
        "left": input_dir / "left.png",
        "right": input_dir / "right.png",
    }

    try:
        await save_upload_as_png(
            front,
            paths["front"],
        )

        await save_upload_as_png(
            back,
            paths["back"],
        )

        await save_upload_as_png(
            left,
            paths["left"],
        )

        await save_upload_as_png(
            right,
            paths["right"],
        )

    finally:
        await front.close()
        await back.close()
        await left.close()
        await right.close()

    status = store.create(
        job_id=job_id,
        prompt=prompt,
        seed=seed,
        inputs={
            name: str(path)
            for name, path in paths.items()
        },
    )

    await store.queue.put(
        job_id
    )

    return JSONResponse(
        status_code=202,
        content={
            "job_id": job_id,
            "status": status["status"],
            "status_url": (
                f"/v1/jobs/{job_id}"
            ),
            "result_url": (
                f"/v1/jobs/{job_id}/result"
            ),
        },
    )


@app.get("/v1/jobs/{job_id}")
async def get_job(
    job_id: str,
    _auth=Depends(require_auth),
):
    status = store.get(
        job_id
    )

    if status is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    return status


@app.get("/v1/jobs/{job_id}/result")
async def get_result(
    job_id: str,
    _auth=Depends(require_auth),
):
    status = store.get(
        job_id
    )

    if status is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    if status["status"] == "failed":
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Job failed",
                "error": status.get("error"),
            },
        )

    if status["status"] != "succeeded":
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Job is not finished",
                "status": status["status"],
                "stage": status["stage"],
                "progress": status["progress"],
            },
        )

    result_path = Path(
        status.get(
            "result_path",
            store.job_dir(job_id)
            / "result"
            / "result.zip",
        )
    )

    if not result_path.exists():
        raise HTTPException(
            status_code=500,
            detail="Result ZIP is missing",
        )

    return FileResponse(
        result_path,
        media_type="application/zip",
        filename=f"{job_id}.zip",
    )
PY
```

# 5. 문법부터 검사

서버 실행 전에:

```bash
cd /workspace/sprite-pipeline/server

uv run python -m compileall app
```

정상이면:

```text
Compiling 'app/__init__.py'...
Compiling 'app/jobs.py'...
Compiling 'app/main.py'...
Compiling 'app/pipeline.py'...
```

이런 식으로 나옵니다.

# 6. 실제 FastAPI 실행

이제야 서버를 띄웁니다.

```bash
cd /workspace/sprite-pipeline/server

export API_TOKEN='여기에-임의의-긴-토큰'

uv run uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1
```

다른 RunPod 터미널에서:

```bash
ss -lntp | grep ':8000'
```

**이번에는 반드시:**

```text
LISTEN ... 0.0.0.0:8000 ...
```

가 떠야 합니다.

# 7. `/health` 말고 route가 실제 생겼는지 확인

```bash
curl -s \
  http://127.0.0.1:8000/openapi.json \
  | python -m json.tool \
  | grep -E '"/health"|"/v1/jobs'
```

적어도:

```text
"/health"
"/v1/jobs"
"/v1/jobs/{job_id}"
"/v1/jobs/{job_id}/result"
```

가 나와야 합니다.

즉 이제는 **`/health`밖에 없는 서버가 아닙니다.**

# 8. RunPod 내부에서 실제 POST도 가능

테스트 이미지 4장이 있다고 하면:

```bash
curl -X POST \
  http://127.0.0.1:8000/v1/jobs \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F "front=@/path/to/front.png" \
  -F "back=@/path/to/back.png" \
  -F "left=@/path/to/left.png" \
  -F "right=@/path/to/right.png" \
  -F "prompt=A person walks naturally forward with a relaxed balanced and steady gait." \
  -F "seed=42"
```

정상적으로 API까지 구현된 상태라면:

```json
{
  "job_id": "...",
  "status": "queued",
  "status_url": "/v1/jobs/...",
  "result_url": "/v1/jobs/.../result"
}
```

가 **실제로 반환**됩니다.

다만 여기서 현재 다음 두 서비스까지 떠 있어야 생성 단계가 계속 진행됩니다.

```text
127.0.0.1:9101  Kimodo resident worker
127.0.0.1:9102  One-to-All resident worker

+
/workspace/sprite-pipeline/adapter/service.py
```

그래서 지금 `/health`를 치면 아직 이 단계에서는 아마:

```json
{
  "status": "ok",
  "api": "ready",
  "kimodo_worker": "down",
  "ota_worker": "down",
  "queue_size": 0,
  "auth_enabled": true
}
```

가 나오는 게 정상입니다.

**이번에는 FastAPI 껍데기에서 멈추는 게 아니라 HTTP API와 queue까지 실제 구현했습니다. 다음 구현 대상은 정확히 `kimodo_worker.py`, `adapter/service.py`, `ota_worker.py` 세 개입니다.**
