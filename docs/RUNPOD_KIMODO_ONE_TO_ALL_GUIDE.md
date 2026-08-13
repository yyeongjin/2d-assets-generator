# RunPod Kimodo + One-to-All 4방향 동작 파이프라인 가이드

이 문서는 정면·후면·왼쪽·오른쪽 캐릭터 이미지 네 장을 로컬 클라이언트에서 RunPod로 보내고, 서버가 동작 생성과 4방향 작화·프레임 추출을 끝낸 뒤 `result.zip`을 로컬에 반환하는 예정 구조를 기록합니다.

기존 SCAIL-2 실험과 실패 사유는 `docs/failures/`에 보존하며 이 경로의 실행 입력으로 사용하지 않습니다.

## 1. 작업 경계

| RunPod에서 할 작업 | 로컬 `:3000`에서 할 작업 |
|---|---|
| Kimodo와 One-to-All 모델을 GPU에 한 번 로드 | 기존 에셋 목록·이미지 인벤토리 유지 |
| Kimodo로 하나의 걷기 motion 생성 | 캐릭터·생명체의 4방향 이미지 선택 |
| Motion Adapter로 체형·제자리·4방향 pose 생성 | `front`, `back`, `left`, `right` 네 장 전송 |
| One-to-All을 정면→후면→왼쪽→오른쪽 순서로 실행 | `job_id` 상태 조회 |
| 방향당 8장을 골라 32 PNG와 sheet 패킹 | 서버의 `result.zip` 직접 다운로드 |

별도 파일 전송 서비스와 사용자 저장소 clone은 필요하지 않습니다. 로컬 클라이언트가 HTTP multipart로 입력을 보내고 HTTP로 결과를 받습니다.

## 2. 기준 Pod

```text
GPU VRAM   48GB
RAM        64GB 이상
Disk       120GB 이상
HTTP       8000
HF_TOKEN   RunPod 환경변수
```

운영 원칙은 다음과 같습니다.

```text
Kimodo model        GPU 상주
One-to-All 1.3B     GPU 상주
GPU inference       동시에 1개만 실행
```

모델 상주와 추론 동시 실행은 다른 문제입니다. 두 모델은 다시 로드하지 않도록 상주시켜도 Kimodo denoising과 One-to-All generation은 겹치지 않게 직렬 처리합니다.

## 3. 시스템 도구와 uv

RunPod 터미널에서 실행합니다.

```bash
cd /workspace

apt-get update
apt-get install -y \
  git \
  git-lfs \
  curl \
  ffmpeg \
  cmake \
  build-essential \
  ninja-build \
  libgl1 \
  libglib2.0-0

git lfs install

curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

uv --version
uv python install 3.11 3.12
```

## 4. 공식 저장소 clone과 디렉터리

RunPod에는 공식 모델 저장소만 clone합니다.

```bash
mkdir -p /workspace/sprite-pipeline
cd /workspace/sprite-pipeline

git clone https://github.com/nv-tlabs/kimodo.git
git clone https://github.com/ssj9596/One-to-All-Animation.git
mv One-to-All-Animation one-to-all

mkdir -p server models jobs logs run

git -C kimodo rev-parse HEAD | tee KIMODO_REVISION.txt
git -C one-to-all rev-parse HEAD | tee ONE_TO_ALL_REVISION.txt
```

Kimodo와 One-to-All은 요구하는 Python과 `transformers` 버전이 다르므로 가상환경을 합치지 않습니다.

## 5. Kimodo 설치

Kimodo는 Python 3.11 환경에 설치합니다.

```bash
cd /workspace/sprite-pipeline/kimodo

uv venv --python 3.11 .venv

uv pip install \
  --python .venv/bin/python \
  torch==2.5.1 \
  torchvision==0.20.1 \
  torchaudio==2.5.1 \
  --index-url https://download.pytorch.org/whl/cu124

uv pip install \
  --python .venv/bin/python \
  -e ".[soma]"
```

48GB GPU에서는 `TEXT_ENCODER_DEVICE=cpu`를 설정하지 않습니다. 공식 Kimodo 문서는 전체 GPU 로드에 약 17GB VRAM이 필요하고 CPU text encoder는 작은 GPU용 절약 옵션이라고 설명합니다.

설치 확인:

```bash
.venv/bin/python -c '
import torch
import kimodo
print("torch:", torch.__version__)
print("cuda:", torch.cuda.is_available())
print("gpu:", torch.cuda.get_device_name(0))
'
```

걷기 smoke test:

```bash
mkdir -p /workspace/sprite-pipeline/jobs/smoke

.venv/bin/kimodo_gen \
  "A person walks naturally forward with a relaxed, balanced and steady gait." \
  --model Kimodo-SOMA-RP-v1.1 \
  --duration 3.0 \
  --diffusion_steps 100 \
  --num_samples 1 \
  --seed 42 \
  --output /workspace/sprite-pipeline/jobs/smoke/kimodo_walk

ls -lh /workspace/sprite-pipeline/jobs/smoke/kimodo_walk.npz
```

모델은 첫 CLI 실행에서 자동으로 다운로드됩니다. 다른 터미널에서 `watch -n 1 nvidia-smi`를 실행해 idle VRAM과 denoising peak를 따로 기록합니다.

## 6. One-to-All 1.3B 설치

One-to-All은 Python 3.12 환경에 설치합니다.

```bash
cd /workspace/sprite-pipeline/one-to-all

uv venv --python 3.12 .venv

uv pip install \
  --python .venv/bin/python \
  torch==2.5.1 \
  torchvision==0.20.1 \
  torchaudio==2.5.1 \
  --index-url https://download.pytorch.org/whl/cu124

uv pip install \
  --python .venv/bin/python \
  -r requirements.txt

uv pip install \
  --python .venv/bin/python \
  "huggingface_hub<1"

MAX_JOBS=8 uv pip install \
  --python .venv/bin/python \
  --no-build-isolation \
  flash-attn
```

모델 다운로드:

```bash
cd /workspace/sprite-pipeline/one-to-all

.venv/bin/hf download \
  Wan-AI/Wan2.1-T2V-1.3B-Diffusers \
  --local-dir pretrained_models/Wan2.1-T2V-1.3B-Diffusers

.venv/bin/hf download \
  MochunniaN1/One-to-All-1.3b_2 \
  --local-dir checkpoints/One-to-All-1.3b_2

.venv/bin/hf download \
  Wan-AI/Wan2.2-Animate-14B \
  --include "process_checkpoint/det/*" \
  --include "process_checkpoint/pose2d/*" \
  --local-dir pretrained_models

.venv/bin/hf download \
  FrancisRing/StableAnimator \
  --include "DWPose/*" \
  --local-dir pretrained_models
```

공식 quick inference 확인:

```bash
cd /workspace/sprite-pipeline/one-to-all/video-generation

../.venv/bin/python infer_preprocess.py
../.venv/bin/python inference_1.3b.py
```

실제 파일 경로는 공식 `examples`와 inference script의 입력 설정에 맞게 지정합니다. 이 단계에서는 production API를 붙이지 말고 One-to-All 단독 peak VRAM부터 측정합니다.

## 7. 상주 가능성 확인 순서

서버 코드를 붙이기 전에 다음 순서대로 측정합니다.

```text
1. Kimodo 단독 idle / inference peak VRAM
2. One-to-All 단독 idle / inference peak VRAM
3. 두 프로세스가 모델만 동시에 load된 resident VRAM
4. 두 모델 resident 상태에서 Kimodo inference
5. 두 모델 resident 상태에서 One-to-All inference
6. 어느 단계에서도 OOM이 없으면 상주 worker 구조 적용
```

48GB에서 통과하지 못하면 그때 CPU offload 또는 worker별 load/unload를 검토합니다. 처음부터 CPU offload를 기본값으로 두지 않습니다.

## 8. FastAPI worker 구조

Kimodo와 One-to-All 공식 저장소는 이 프로젝트용 `/v1/jobs` HTTP 서버를 제공하지 않습니다. 따라서 다음 worker와 adapter는 별도 구현 대상입니다.

```text
/workspace/sprite-pipeline/
├── kimodo/.venv/
├── one-to-all/.venv/
├── server/.venv/
├── workers/
│   ├── kimodo_worker.py
│   ├── one_to_all_worker.py
│   └── motion_adapter/
├── jobs/
└── logs/
```

API 환경:

```bash
cd /workspace/sprite-pipeline

uv init --app --python 3.12 server
cd server

uv add \
  fastapi \
  "uvicorn[standard]" \
  python-multipart \
  aiofiles \
  pillow \
  numpy \
  httpx
```

worker 구현이 끝나면 서버는 다음처럼 실행합니다.

```bash
cd /workspace/sprite-pipeline/server

uv run uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000
```

RunPod에서 HTTP 포트 `8000`을 노출합니다. 토큰은 환경변수로 주입하고 코드나 문서에 실제 값을 기록하지 않습니다.

## 9. API 계약

### 상태 확인

```http
GET /health
```

예상 응답:

```json
{
  "ok": true,
  "kimodo_state": "ready",
  "one_to_all_state": "ready",
  "queue_depth": 0
}
```

### 4방향 작업 등록

```http
POST /v1/jobs
Content-Type: multipart/form-data
```

필수 입력은 이미지 네 장입니다.

```text
front = front.png
back  = back.png
left  = left.png
right = right.png
```

추가 필드:

```text
action = walk
prompt = optional motion description
seed   = optional integer
```

요청 예시:

```bash
curl -X POST \
  "https://${POD_ID}-8000.proxy.runpod.net/v1/jobs" \
  -H "Authorization: Bearer ${MOTION_PIPELINE_API_TOKEN}" \
  -F "front=@front.png" \
  -F "back=@back.png" \
  -F "left=@left.png" \
  -F "right=@right.png" \
  -F "action=walk" \
  -F "seed=42"
```

서버는 즉시 `202`와 `job_id`를 반환하고 GPU queue에서 한 작업씩 처리합니다.

### 상태와 결과

```http
GET /v1/jobs/JOB_ID
GET /v1/jobs/JOB_ID/output
DELETE /v1/jobs/JOB_ID
```

## 10. 서버 내부 데이터 흐름

```text
front/back/left/right 저장
        ↓
Kimodo: 자연스러운 motion.npz 생성
        ↓
Motion Adapter
  - 한 cycle 검출
  - 17 frame normalize
  - in-place 변환
  - reference body retarget
  - front/back/left/right pose 생성
        ↓
One-to-All 순차 실행
        ↓
4방향 × 17 RGB
        ↓
방향당 8 frame 선택
        ↓
32 PNG + sprite sheet + metadata
```

`result.zip` 구조:

```text
front/0.png ... 7.png
back/0.png  ... 7.png
left/0.png  ... 7.png
right/0.png ... 7.png
sprite_sheet.png
metadata.json
```

## 11. 로컬 `:3000` 연결

```bash
cd tools_test
cp .env.example .env.local
```

`.env.local`에 실제 endpoint와 token을 넣습니다.

```dotenv
MOTION_PIPELINE_BASE_URL=https://your-motion-pod-8000.proxy.runpod.net
MOTION_PIPELINE_API_TOKEN=
MOTION_PIPELINE_REQUEST_TIMEOUT_MS=300000
```

실행:

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열고 다음 순서로 사용합니다.

```text
기존 인벤토리의 2×2 시트 선택 또는 로컬 시트 업로드
→ 4방향 분할
→ 네 방향 입력 미리보기 확인
→ 동작 prompt와 seed 확인
→ 4방향 동작 생성 요청
→ job 상태 확인
→ result.zip 로컬 저장
```

4방향 기준 이미지를 생성하는 기존 이미지 모델 화면과 에셋 카탈로그·인벤토리는 제거하지 않습니다. 동작 서버는 이미 준비된 네 방향 이미지를 입력으로 받으며, 기준 이미지 생성 모델은 나중에 별도 endpoint로 계속 연결할 수 있습니다.

## 공식 자료

- [NVIDIA Kimodo 공식 저장소](https://github.com/nv-tlabs/kimodo)
- [One-to-All Animation 공식 저장소](https://github.com/ssj9596/One-to-All-Animation)
