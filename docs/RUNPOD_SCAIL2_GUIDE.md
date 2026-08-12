# RunPod SCAIL-2 서버와 로컬 클라이언트 실행 가이드

이 가이드는 작업 위치를 두 곳으로 분리한다.

```text
[RunPod On-Demand Pod]
공식 저장소 clone · uv 환경 · SCAIL-2 모델 · FastAPI · GPU 생성
        ▲                                               │
        │ multipart 입력                                │ MP4 stream
        │                                               ▼
[로컬 PC]
:3000 브라우저 → 같은 origin의 Next API proxy → RunPod
Python client → RunPod 직접 요청 → 결과 저장 · 프레임 추출 · 원격 임시파일 삭제
```

S3와 RunPod 웹 UI 수동 파일 업로드는 사용하지 않는다. Python 클라이언트는 endpoint에 직접 요청하고, `:3000` 브라우저는 같은 origin의 Next API route를 거친다. 두 경로 모두 결과 MP4를 로컬로 내려받는다.

## 먼저 확인할 사실: SCAIL-2는 vLLM 실행 모델이 아니다

2026-08-12 기준 SCAIL-2는 vLLM-Omni 공식 지원 모델 목록에 없다. 공식 SCAIL-2 저장소의 `wan-scail2` 브랜치는 `generate.py`와 `wan.SCAIL2Pipeline`을 사용한다.

따라서 `vllm serve zai-org/SCAIL-2 --omni`는 사용하지 않는다. 이 프로젝트의 FastAPI가 공식 SCAIL-2 pipeline을 로드하고 HTTP 요청을 연결한다.

- [SCAIL-2 공식 저장소](https://github.com/zai-org/SCAIL-2/tree/wan-scail2)
- [vLLM-Omni 공식 지원 모델 목록](https://docs.vllm.ai/projects/vllm-omni/en/latest/models/supported_models/)

# RunPod에서 할 작업

## 1. Pod 설정

| 항목 | 설정 |
|---|---|
| Pod | RunPod On-Demand Pod |
| GPU | A100 80GB부터 검증 |
| Container disk 또는 Network Volume | 180~200GB |
| HTTP port | `8000` |
| Python | 3.10~3.12 |

Hugging Face 원본 checkpoint와 wan 브랜치용 변환 safetensors가 동시에 필요하므로 80GB 디스크로는 부족하다. Network Volume은 모델을 Pod 종료 뒤에도 보존하려는 경우에만 사용한다.

## 2. 시스템 도구와 uv 설치

새 Pod 터미널에서 실행한다.

```bash
apt-get update
apt-get install -y \
  git git-lfs curl ffmpeg \
  build-essential

curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"

git lfs install
```

## 3. 공식 SCAIL-2 clone

```bash
mkdir -p \
  /workspace/models \
  /workspace/huggingface-cache \
  /workspace/scail2-data \
  /workspace/scail2_api

cd /workspace

git clone \
  --branch wan-scail2 \
  --depth 1 \
  https://github.com/zai-org/SCAIL-2.git \
  /workspace/SCAIL-2

cd /workspace/SCAIL-2
git submodule update --init --recursive
```

RunPod에서 clone하는 저장소는 공식 `zai-org/SCAIL-2` 하나다. 로컬 에셋 생성기 저장소 전체를 RunPod에 clone하지 않는다. `SCAIL-Pose`가 submodule이므로 공식 저장소의 submodule 초기화는 생략하지 않는다.

## 4. RunPod 터미널에서 API 파일 생성

다른 저장소를 추가로 clone하지 않고 RunPod 터미널에서 endpoint 파일을 직접 만든다.

```bash
mkdir -p /workspace/scail2_api

cat <<'EOF' > /workspace/scail2_api/requirements-api.txt
fastapi==0.116.1
python-multipart==0.0.20
uvicorn[standard]==0.35.0
EOF
```

아래 서버는 모델을 한 번만 로드하고, 업로드된 작업을 한 GPU에서 순서대로 처리하며, 결과 MP4를 다운로드 endpoint로 돌려준다.

```bash
cat <<'PY' > /workspace/scail2_api/server.py
from __future__ import annotations

import asyncio
import os
import secrets
import shutil
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import cv2
from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

SCAIL_REPO_ROOT = Path(os.environ.get("SCAIL_REPO_ROOT", "/workspace/SCAIL-2")).resolve()
SCAIL_CHECKPOINT_DIR = Path(os.environ.get("SCAIL_CHECKPOINT_DIR", "/workspace/models/SCAIL-2")).resolve()
SCAIL_SAFETENSORS_PATH = Path(os.environ.get("SCAIL_SAFETENSORS_PATH", "/workspace/models/SCAIL-2.safetensors")).resolve()
DATA_ROOT = Path(os.environ.get("SCAIL_DATA_ROOT", "/workspace/scail2-data")).resolve()
OUTPUT_ROOT = Path(os.environ.get("SCAIL_OUTPUT_ROOT", "/workspace/scail2-data/outputs")).resolve()
API_TOKEN = os.environ.get("SCAIL_API_TOKEN", "").strip()
DEVICE_ID = int(os.environ.get("SCAIL_DEVICE_ID", "0"))

security = HTTPBearer(auto_error=False)
queue: asyncio.Queue[str] = asyncio.Queue()
jobs: dict[str, dict] = {}
model_lock = threading.Lock()
pipeline = None
config = None
generate_video = None
model_state = "not_loaded"
model_error = None
EXPECTED_DRIVING_FRAMES = 17


def require_token(credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="SCAIL_API_TOKEN is not configured")
    valid = credentials and credentials.scheme.lower() == "bearer" and secrets.compare_digest(credentials.credentials, API_TOKEN)
    if not valid:
        raise HTTPException(status_code=401, detail="invalid API token")


def get_video_frame_count(path: Path) -> int:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"cannot open video: {path}")
    try:
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if count > 0:
            return count
        count = 0
        while True:
            ok, _frame = capture.read()
            if not ok:
                break
            count += 1
        return count
    finally:
        capture.release()


def validate_driving_pair(video: Path, mask: Path):
    video_frames = get_video_frame_count(video)
    mask_frames = get_video_frame_count(mask)
    if video_frames != EXPECTED_DRIVING_FRAMES:
        raise ValueError(f"driving video must contain exactly 17 frames, got {video_frames}")
    if mask_frames != EXPECTED_DRIVING_FRAMES:
        raise ValueError(f"driving mask must contain exactly 17 frames, got {mask_frames}")
    print(f"[SCAIL2][INPUT_VALIDATED] driving_frames={video_frames} mask_frames={mask_frames}", flush=True)


def load_model_once():
    global pipeline, config, generate_video, model_state, model_error
    if pipeline is not None:
        return pipeline
    with model_lock:
        if pipeline is not None:
            return pipeline
        model_state = "loading"
        try:
            if not SCAIL_REPO_ROOT.is_dir():
                raise FileNotFoundError(f"SCAIL repository not found: {SCAIL_REPO_ROOT}")
            if not SCAIL_SAFETENSORS_PATH.is_file():
                raise FileNotFoundError(f"SCAIL safetensors not found: {SCAIL_SAFETENSORS_PATH}")
            sys.path.insert(0, str(SCAIL_REPO_ROOT))
            import wan
            from generate import generate_video as official_generate_video
            from wan.configs import SCAIL_CONFIGS, SCAIL_CONFIG_PATHS

            config = SCAIL_CONFIGS["SCAIL-14B"]
            scail_config_path = (SCAIL_REPO_ROOT / SCAIL_CONFIG_PATHS["SCAIL-14B"]).resolve()
            if not scail_config_path.is_file():
                raise FileNotFoundError(f"SCAIL config not found: {scail_config_path}")
            pipeline = wan.SCAIL2Pipeline(
                config=config,
                checkpoint_dir=str(SCAIL_CHECKPOINT_DIR),
                scail_safetensors_path=str(SCAIL_SAFETENSORS_PATH),
                scail_config_path=str(scail_config_path),
                device_id=DEVICE_ID,
                rank=0,
                t5_fsdp=False,
                dit_fsdp=False,
                use_usp=False,
                t5_cpu=False,
                lora_path=None,
                lora_alpha=1.0,
            )
            generate_video = official_generate_video
            model_state = "ready"
            model_error = None
            print("[SCAIL2][MODEL_READY]", flush=True)
            return pipeline
        except Exception as exc:
            model_state = "failed"
            model_error = str(exc)
            print(f"[SCAIL2][MODEL_FAILED] {exc}", flush=True)
            raise


async def save_upload(upload: UploadFile, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("wb") as output:
            while chunk := await upload.read(8 * 1024 * 1024):
                output.write(chunk)
    finally:
        await upload.close()
    if path.stat().st_size == 0:
        raise ValueError(f"empty upload: {upload.filename}")


def run_job(job_id: str, job: dict):
    validate_driving_pair(job["driving_video"], job["driving_mask"])
    loaded_pipeline = load_model_once()
    output_dir = OUTPUT_ROOT / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{job['direction']}_animation_raw.mp4"
    args = SimpleNamespace(
        target_h=job["target_height"],
        target_w=job["target_width"],
        sample_shift=job["sample_shift"],
        sample_solver=job["sample_solver"],
        segment_len=81,
        segment_overlap=5,
        sample_steps=job["sample_steps"],
        sample_guide_scale=job["sample_guide_scale"],
        base_seed=job["seed"],
        offload_model=True,
        save_file=str(output_path),
        prompt=job["prompt"],
    )
    started_at = time.monotonic()
    generate_video(
        loaded_pipeline,
        job["prompt"],
        str(job["reference_image"]),
        str(job["reference_mask"]),
        str(job["driving_video"]),
        str(job["driving_mask"]),
        args,
        DEVICE_ID,
        0,
        config,
        None,
        False,
    )
    if not output_path.is_file():
        raise FileNotFoundError(f"output video not found: {output_path}")
    return output_path, time.monotonic() - started_at


async def gpu_worker():
    while True:
        job_id = await queue.get()
        job = jobs[job_id]
        job["status"] = "running"
        try:
            output_path, runtime_seconds = await asyncio.to_thread(run_job, job_id, job)
            job.update(status="completed", output_path=output_path, runtime_seconds=runtime_seconds)
        except Exception as exc:
            job.update(status="failed", error=str(exc))
            print(f"[SCAIL2][JOB_FAILED] id={job_id} error={exc}", flush=True)
        finally:
            queue.task_done()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    worker = asyncio.create_task(gpu_worker())
    preload = asyncio.create_task(asyncio.to_thread(load_model_once))
    yield
    worker.cancel()
    preload.cancel()


app = FastAPI(title="SCAIL-2 Pod API", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "ok": model_state != "failed",
        "model": "SCAIL-14B",
        "model_state": model_state,
        "model_error": model_error,
        "queue_depth": queue.qsize(),
    }


@app.post("/v1/jobs", status_code=202, dependencies=[Depends(require_token)])
async def create_job(
    direction: str = Form(...),
    prompt: str = Form(...),
    reference_image: UploadFile = File(...),
    reference_mask: UploadFile = File(...),
    driving_video: UploadFile = File(...),
    driving_mask: UploadFile = File(...),
    target_width: int = Form(896),
    target_height: int = Form(512),
    sample_steps: int = Form(40),
    sample_shift: float = Form(3.0),
    sample_guide_scale: float = Form(5.0),
    sample_solver: str = Form("unipc"),
    seed: int = Form(4821),
):
    if direction not in {"front", "back", "left", "right"}:
        raise HTTPException(status_code=422, detail="invalid direction")
    if target_width % 32 or target_height % 32:
        raise HTTPException(status_code=422, detail="width and height must be multiples of 32")
    if not prompt.strip():
        raise HTTPException(status_code=422, detail="prompt is empty")

    job_id = uuid.uuid4().hex[:16]
    input_dir = DATA_ROOT / "jobs" / job_id / "inputs"
    paths = {
        "reference_image": input_dir / "ref.jpg",
        "reference_mask": input_dir / "ref_mask.jpg",
        "driving_video": input_dir / "rendered_v2.mp4",
        "driving_mask": input_dir / "rendered_mask_v2.mp4",
    }
    for key, upload in (
        ("reference_image", reference_image),
        ("reference_mask", reference_mask),
        ("driving_video", driving_video),
        ("driving_mask", driving_mask),
    ):
        await save_upload(upload, paths[key])

    try:
        validate_driving_pair(paths["driving_video"], paths["driving_mask"])
    except Exception as exc:
        shutil.rmtree(DATA_ROOT / "jobs" / job_id, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "direction": direction,
        "prompt": prompt,
        **paths,
        "target_width": target_width,
        "target_height": target_height,
        "sample_steps": sample_steps,
        "sample_shift": sample_shift,
        "sample_guide_scale": sample_guide_scale,
        "sample_solver": sample_solver,
        "seed": seed,
    }
    await queue.put(job_id)
    print(f"[SCAIL2][JOB_QUEUED] id={job_id} direction={direction}", flush=True)
    return {"job_id": job_id, "status": "queued", "queue_position": queue.qsize()}


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(require_token)])
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    response = {
        "job_id": job_id,
        "status": job["status"],
        "direction": job["direction"],
        "runtime_seconds": job.get("runtime_seconds"),
        "error": job.get("error"),
    }
    if job["status"] == "completed":
        response["output_url"] = f"/v1/jobs/{job_id}/output"
    return response


@app.get("/v1/jobs/{job_id}/output", dependencies=[Depends(require_token)])
async def download_output(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail=f"job is not completed: {job['status']}")
    output_path = Path(job["output_path"]).resolve()
    if OUTPUT_ROOT not in output_path.parents or not output_path.is_file():
        raise HTTPException(status_code=404, detail="output file not found")
    return FileResponse(output_path, media_type="video/mp4", filename=f"{job['direction']}_animation_raw.mp4")


@app.delete("/v1/jobs/{job_id}", status_code=204, dependencies=[Depends(require_token)])
async def delete_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] in {"queued", "running"}:
        raise HTTPException(status_code=409, detail=f"job is still active: {job['status']}")
    shutil.rmtree(DATA_ROOT / "jobs" / job_id, ignore_errors=True)
    shutil.rmtree(OUTPUT_ROOT / job_id, ignore_errors=True)
    jobs.pop(job_id, None)
    print(f"[SCAIL2][JOB_DELETED] id={job_id}", flush=True)
    return Response(status_code=204)
PY
```

RunPod 터미널에서 두 파일이 생겼는지 확인한다.

```bash
ls -al /workspace/scail2_api
python -m py_compile /workspace/scail2_api/server.py
```

## 5. Python 3.12 환경과 패키지 설치

```bash
cd /workspace/SCAIL-2

uv venv /workspace/scail2-venv \
  --python 3.12 \
  --seed

source /workspace/scail2-venv/bin/activate

# 공식 requirements에서 flash_attn만 분리해서 먼저 나머지를 설치한다.
grep -v '^flash_attn$' \
  /workspace/SCAIL-2/requirements.txt \
  > /tmp/scail2-requirements.txt

uv pip install -r /tmp/scail2-requirements.txt
uv pip install packaging ninja

# CUDA toolkit과 nvcc가 있는 PyTorch development 이미지에서 실행한다.
nvcc -V
MAX_JOBS=4 uv pip install flash-attn --no-build-isolation

uv pip install "huggingface_hub[hf_xet]"
uv pip install -r /workspace/scail2_api/requirements-api.txt
```

별도로 vLLM이나 vLLM-Omni를 설치하지 않는다.

`flash-attn`은 일반 wheel 설치처럼 처리하지 않는다. RunPod 템플릿은 `nvcc -V`가 동작하는 CUDA/PyTorch development 이미지를 사용하고, build isolation을 끈 상태에서 설치한다. 공식 SCAIL-2 requirements에 `opencv-python`도 포함되므로 위 17F 검증 코드가 별도 OpenCV 설치 없이 동작한다.

## 6. 모델 다운로드와 변환

Hugging Face 인증이 필요한 환경이면 먼저 `hf auth login`을 실행한다. 토큰은 저장소나 실행 명령에 기록하지 않는다.

```bash
source /workspace/scail2-venv/bin/activate

export HF_HOME=/workspace/huggingface-cache
export HF_HUB_DOWNLOAD_TIMEOUT=120

hf download \
  zai-org/SCAIL-2 \
  --local-dir /workspace/models/SCAIL-2
```

공식 `wan-scail2` 브랜치에서 사용할 safetensors를 한 번 생성한다.

```bash
cd /workspace/SCAIL-2

python convert.py \
  --scail-dir /workspace/models/SCAIL-2 \
  --save-path /workspace/models/SCAIL-2.safetensors
```

확인:

```bash
test -f /workspace/models/SCAIL-2/model/1/fsdp2_rank_0000_checkpoint.pt \
  && echo "CHECKPOINT READY"

test -f /workspace/models/SCAIL-2.safetensors \
  && echo "CONVERTED MODEL READY"

du -sh \
  /workspace/models/SCAIL-2 \
  /workspace/models/SCAIL-2.safetensors
```

## 7. FastAPI 서버 실행

`SCAIL_API_TOKEN`에는 직접 정한 긴 임의 문자열을 넣는다. 이 값은 로컬 클라이언트에도 동일하게 설정한다.

```bash
source /workspace/scail2-venv/bin/activate

export CUDA_VISIBLE_DEVICES=0
export SCAIL_API_TOKEN='replace-with-a-long-random-token'
export SCAIL_REPO_ROOT=/workspace/SCAIL-2
export SCAIL_CHECKPOINT_DIR=/workspace/models/SCAIL-2
export SCAIL_SAFETENSORS_PATH=/workspace/models/SCAIL-2.safetensors
export SCAIL_DATA_ROOT=/workspace/scail2-data
export SCAIL_OUTPUT_ROOT=/workspace/scail2-data/outputs

cd /workspace/scail2_api

uvicorn server:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1
```

`chmod +x`나 별도 시작 스크립트는 필요 없다. 위 명령은 전달한 Python adapter를 직접 실행한다.

RunPod에서 HTTP port `8000`을 노출한다.

```text
https://POD_ID-8000.proxy.runpod.net
```

이 터미널은 모델 load와 job 로그를 확인할 수 있도록 계속 열어 둔다.

RunPod HTTP proxy의 한 연결 제한 때문에 생성이 끝날 때까지 `POST` 연결을 유지하지 않는다. `POST /v1/jobs`는 업로드 검증 뒤 `202 + job_id`를 즉시 반환하고, 긴 GPU 추론은 queue에서 계속된다. multipart 업로드와 최종 MP4 다운로드는 각각 proxy 제한 안에 끝나야 하며, 로컬의 `SCAIL2_REQUEST_TIMEOUT_MS`를 늘려도 RunPod 앞단 제한 자체가 늘어나지는 않는다.

## 8. RunPod 서버가 담당하는 일

RunPod에는 사용자가 미리 입력 파일을 올려두지 않는다.

1. `POST /v1/jobs`에서 multipart 입력 4종과 설정을 받는다.
2. 입력을 `/workspace/scail2-data/jobs/JOB_ID/inputs/`에 저장한다.
3. driving RGB와 driving mask가 각각 정확히 17프레임인지 검증한다.
4. 즉시 `job_id`를 반환한다.
5. 단일 GPU queue가 SCAIL-2를 실행한다.
6. `GET /v1/jobs/JOB_ID`가 상태와 결과 다운로드 URL을 반환한다.
7. `GET /v1/jobs/JOB_ID/output`이 결과 MP4를 클라이언트에 전송한다.
8. 클라이언트 저장 완료 뒤 `DELETE /v1/jobs/JOB_ID`가 해당 입력과 결과를 삭제한다.

서버 내부 `output_path`는 클라이언트 API 응답에 노출하지 않는다.

# 로컬에서 할 작업

## 9. 로컬 클라이언트 설치

로컬 PC에서 이미 작업 중인 에셋 생성기 저장소 루트로 이동한다. RunPod 설치를 위해 로컬 저장소를 다시 clone할 필요는 없다.

```bash
cd /LOCAL_PATH/2d-assets-generator

curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"

uv venv .venv-scail-client \
  --python 3.12 \
  --seed

source .venv-scail-client/bin/activate
uv pip install -r runpod/scail2_client/requirements.txt
```

프레임 추출까지 실행하려면 로컬에 `ffmpeg`가 설치되어 있어야 한다.

## 10. 로컬 입력과 manifest

로컬 PC에 다음 입력을 준비한다.

```text
inputs/character-001/front/
├── ref.jpg
└── ref_mask.jpg

inputs/master-walk-17f/front/
├── rendered_v2.mp4
└── rendered_mask_v2.mp4
```

`runpod/scail2_client/example-manifest.json`에는 서버 경로가 아니라 로컬 파일 경로만 기록한다.

```json
{
  "project_id": "character-001",
  "views": {
    "front": {
      "local_reference_image": "inputs/character-001/front/ref.jpg",
      "local_reference_mask": "inputs/character-001/front/ref_mask.jpg",
      "local_driving_video": "inputs/master-walk-17f/front/rendered_v2.mp4",
      "local_driving_mask": "inputs/master-walk-17f/front/rendered_mask_v2.mp4",
      "prompt": "A full-body 2D game character performs a seamless in-place walk cycle in a fixed orthographic front view."
    }
  }
}
```

## 11. 로컬에서 요청·다운로드 실행

```bash
source .venv-scail-client/bin/activate

export SCAIL2_BASE_URL=https://POD_ID-8000.proxy.runpod.net
export SCAIL2_API_TOKEN='same-token-used-on-runpod'

python runpod/scail2_client/client.py \
  runpod/scail2_client/example-manifest.json \
  --views front
```

로컬 클라이언트의 실제 처리 순서:

```text
로컬 파일 4종을 multipart로 POST
  → job_id 수신
  → 상태 polling
  → 완료된 MP4 다운로드
  → 로컬 outputs/scail2/PROJECT_ID/DIRECTION/에 저장
  → 로컬 ffmpeg로 지정 phase PNG 추출
  → 성공하면 RunPod job 입력·결과 임시파일 삭제
```

S3 환경변수, bucket, 서버 내부 파일 경로는 사용하지 않는다.

기본값은 로컬 저장과 프레임 추출이 모두 성공한 뒤 원격 job을 삭제한다. 장애 분석을 위해 RunPod 파일을 남겨야 할 때만 `--keep-remote-job`을 추가한다.

## 12. 로컬 `:3000` 디버깅 화면

```bash
cd tools_test
cp .env.example .env.local
```

`.env.local`에 RunPod endpoint와 동일한 token을 넣는다.

```dotenv
SCAIL2_BASE_URL=https://POD_ID-8000.proxy.runpod.net
SCAIL2_API_TOKEN=same-token-used-on-runpod
SCAIL2_REQUEST_TIMEOUT_MS=300000
```

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 연다. 방향별 reference, mask, driving video와 driving mask를 선택하면 브라우저는 같은 origin의 `/api/scail2/*`에 요청하고, Next 서버가 Bearer token을 추가해 RunPod로 전달한다. 따라서 현재 구조에서는 FastAPI CORS 설정도, 브라우저 번들에 token을 넣는 코드도 필요 없다. 완료 뒤 `원본 MP4 로컬 저장`을 누르면 인증된 Next output proxy가 MP4를 stream한다. 저장을 확인한 뒤 `RunPod 임시 파일 삭제`를 누른다.

## 최종 책임 분리

| RunPod | 로컬 PC |
|---|---|
| SCAIL-2 코드·checkpoint 보관 | 캐릭터와 driver 원본 보관 |
| SCAIL-2 pipeline 한 번 로드 | 방향별 입력 선택 |
| multipart 입력 수신 | prompt와 seed 설정 |
| 단일 GPU queue 생성 | job 등록과 상태 확인 |
| 결과 MP4 download·job delete endpoint 제공 | 인증된 Next proxy 또는 Python client로 결과 MP4 다운로드 |
| 원본 MP4가 내려받힐 때까지 임시 보관 | 저장·추출 성공 뒤 RunPod 임시 job 삭제 |
| 브라우저 CORS를 열지 않음 | 브라우저는 같은 origin의 `/api/scail2/*`만 호출 |

RunPod는 결과를 생성하고 전송한다. 로컬은 입력을 보내고 결과를 받아 저장·표시·후처리한다.
