# 최종 RunPod 설치/실행 가이드

> **상태: V3 재검증 기준.** 3세션 서버와 결과 ZIP 생성까지는 V2에서 검증했다. V3는 실제 실패 작업의 pose debug를 기준으로 cycle 검출, 프레임별 yaw lock과 OTA body control score를 수정한 버전이며 아직 생성 품질을 다시 검증해야 한다. 이 경로 자체를 기각한 것은 아니다.

## 0. 최종 구조

```text
외부 Client
front.png / back.png / left.png / right.png
prompt / seed
        │
        │ HTTPS
        ▼
RunPod HTTP Proxy
https://<POD_ID>-8000.proxy.runpod.net
        │
        ▼
FastAPI :8000                 ← 세션 3
        │
        ▼
Job Queue
        │
        ├────→ Kimodo :9101   ← 세션 1
        │          │
        │          ▼
        │       motion.npz
        │          │
        │          ▼
        │     Motion Adapter
        │          │
        │          ▼
        └────→ One-to-All :9102 ← 세션 2
                   │
                   ├ front 17F
                   ├ back  17F
                   ├ left  17F
                   └ right 17F
                         │
                         ▼
                   4방향 × 8 PNG
                   +
                   sprite_sheet.png
                   +
                   result.zip
```

RunPod는 **서버**고 외부 PC/게임 서버/백엔드가 클라이언트입니다.

---

# 1. RunPod 사양

현재 검증 기준:

```text
GPU       NVIDIA L40S 48GB
Driver    CUDA 12.8 호환
RAM       64GB+
Disk      200GB 권장
HTTP Port 8000
HF_TOKEN  Pod 환경변수
```

RunPod에서 HTTP `8000`을 expose하면 외부에서 `https://<POD_ID>-8000.proxy.runpod.net` 형식으로 접근할 수 있습니다. 서비스 자체는 `0.0.0.0:8000`에 bind해야 합니다. [RunPod 공식 문서][1]

---

# 2. 시스템 기본 설치

```bash
cd /workspace

apt-get update

apt-get install -y \
  git \
  git-lfs \
  curl \
  unzip \
  ffmpeg \
  cmake \
  build-essential \
  ninja-build \
  libgl1 \
  libglib2.0-0

git lfs install
```

`uv`:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh

export PATH="$HOME/.local/bin:$PATH"
export UV_LINK_MODE=copy

uv --version
```

Python:

```bash
uv python install 3.11 3.12
```

**새 SSH 세션을 열 때 `uv`가 안 보이면 항상:**

```bash
export PATH="$HOME/.local/bin:$PATH"
```

또는 그냥:

```bash
/root/.local/bin/uv --version
```

을 사용하면 됩니다.

---

# 3. 프로젝트 생성 + 모델 repo clone

```bash
mkdir -p /workspace/sprite-pipeline
cd /workspace/sprite-pipeline
```

Kimodo:

```bash
git clone https://github.com/nv-tlabs/kimodo.git
```

One-to-All:

```bash
git clone https://github.com/ssj9596/One-to-All-Animation.git

mv One-to-All-Animation one-to-all
```

기타:

```bash
mkdir -p \
  server \
  workers \
  adapter \
  client \
  jobs \
  logs \
  run
```

revision 저장:

```bash
cd /workspace/sprite-pipeline/kimodo

git rev-parse HEAD \
  | tee /workspace/sprite-pipeline/KIMODO_REVISION.txt
```

```bash
cd /workspace/sprite-pipeline/one-to-all

git rev-parse HEAD \
  | tee /workspace/sprite-pipeline/ONE_TO_ALL_REVISION.txt
```

---

# 4. V3 전체 소스 ZIP 받기

사용할 파일:

[sprite_pipeline_fastapi_full_v3.zip](https://github.com/yyeongjin/2d-assets-generator/blob/main/sprite_pipeline_fastapi_full_v3.zip)

V3 ZIP 자체는 수정하지 않고 RunPod에도 원본을 그대로 보관한다. V2 ZIP은 롤백 비교용으로 저장소에 유지한다.

공개 저장소 기준으로 RunPod에서:

```bash
cd /workspace

curl -L \
  "https://github.com/yyeongjin/2d-assets-generator/raw/refs/heads/main/sprite_pipeline_fastapi_full_v3.zip" \
  -o sprite_pipeline_fastapi_full_v3.zip
```

확인:

```bash
ls -lh \
  /workspace/sprite_pipeline_fastapi_full_v3.zip
```

ZIP 무결성 검사:

```bash
unzip -t \
  /workspace/sprite_pipeline_fastapi_full_v3.zip
```

마지막에 다음 문구가 나와야 한다.

```text
No errors detected in compressed data
```

원본 ZIP의 최종 보관 위치는 `/workspace/sprite_pipeline_fastapi_full_v3.zip`이다. 배치 후에도 삭제하지 않는다.

---

# 5. V3 ZIP은 `/tmp`에 풀고 코드만 교체

`/workspace/sprite-pipeline/server/` 안에서 바로 압축을 풀지 않는다. 명시한 임시 디렉터리만 새로 만든다.

```bash
rm -rf /tmp/sprite_v3

mkdir -p /tmp/sprite_v3

unzip -q \
  /workspace/sprite_pipeline_fastapi_full_v3.zip \
  -d /tmp/sprite_v3
```

실제 구조 확인:

```bash
find \
  /tmp/sprite_v3 \
  -maxdepth 3 \
  -type f \
  | sort
```

V3 ZIP의 최상위 구조는 다음과 같다.

```text
/tmp/sprite_v3/
└── sprite_pipeline_fastapi_full_v3/
    ├── server/
    │   ├── requirements.txt
    │   └── app/
    │       ├── __init__.py
    │       ├── jobs.py
    │       ├── main.py
    │       └── pipeline.py
    ├── workers/
    │   ├── __init__.py
    │   ├── kimodo_worker.py
    │   └── ota_worker.py
    ├── adapter/
    │   ├── __init__.py
    │   └── service.py
    ├── client/
    │   ├── client.py
    │   ├── curl_example.sh
    │   └── requirements.txt
    ├── scripts/
    ├── README.md
    ├── CHANGES_v2.md
    ├── CHANGES_v3.md
    ├── MANIFEST_SHA256.txt
    └── .env.example
```

변수:

```bash
ROOT="/workspace/sprite-pipeline"
BUNDLE="/tmp/sprite_v3/sprite_pipeline_fastapi_full_v3"
```

FastAPI 코드와 V3 서버 requirements 교체:

```bash
mkdir -p "$ROOT/server/app"

cp -a \
  "$BUNDLE/server/app/." \
  "$ROOT/server/app/"

cp -a \
  "$BUNDLE/server/requirements.txt" \
  "$ROOT/server/requirements.txt"
```

Workers 교체:

```bash
mkdir -p "$ROOT/workers"

cp -a \
  "$BUNDLE/workers/." \
  "$ROOT/workers/"
```

이 단계에서 `workers/ota_worker.py`와 `workers/kimodo_worker.py`가 V3 bundle 코드로 교체된다.

Motion Adapter 교체:

```bash
mkdir -p "$ROOT/adapter"

cp -a \
  "$BUNDLE/adapter/." \
  "$ROOT/adapter/"
```

`adapter/service.py`는 V3에서 cycle 검출, 17프레임별 yaw lock, side/overlap limb score와 heading metadata를 수정한 파일이다.

Client 교체:

```bash
mkdir -p "$ROOT/client"

cp -a \
  "$BUNDLE/client/." \
  "$ROOT/client/"
```

이번 운영은 세 세션 foreground 방식이므로 `scripts/start_all.sh`와 `scripts/stop_all.sh`은 복사하거나 사용하지 않는다. 필요한 범위는 다음뿐이다.

```text
server/app/
server/requirements.txt
workers/
adapter/
client/
```

V3 배치 중 아래 기존 환경과 결과는 삭제하거나 덮어쓰지 않는다.

```text
/workspace/sprite-pipeline/kimodo/.venv/
/workspace/sprite-pipeline/kimodo/의 모델과 캐시

/workspace/sprite-pipeline/one-to-all/.venv/
/workspace/sprite-pipeline/one-to-all/pretrained_models/
/workspace/sprite-pipeline/one-to-all/checkpoints/

/workspace/sprite-pipeline/server/.venv/
/workspace/sprite-pipeline/jobs/
```

배치 확인:

```bash
cd /workspace/sprite-pipeline

echo '===== SERVER ====='
find server/app \
  -maxdepth 2 \
  -type f \
  | sort

echo
echo '===== WORKERS ====='
find workers \
  -maxdepth 2 \
  -type f \
  | sort

echo
echo '===== ADAPTER ====='
find adapter \
  -maxdepth 2 \
  -type f \
  | sort
```

V3 핵심 코드 확인:

```bash
grep -n \
  -E "left_heel_rising_edges|global_root_heading_per_frame|cycle_source|canonical_heading_(mean|std)_degrees" \
  adapter/service.py

grep -n \
  -E "head_joints|major_body|0\.78" \
  workers/ota_worker.py
```

두 검사 모두 V3 관련 코드가 출력되어야 한다. Python syntax 검사는 아래 `15. FastAPI venv` 단계에서 각 기존 venv로 실행한다.

## 기존 V2 배포를 V3로 빠르게 교체

V2 서버가 이미 설치되어 정상 구동됐던 Pod라면 전체 환경을 다시 설치하지 않는다. Session 2 One-to-All worker와 Session 3 FastAPI를 먼저 종료하고, V3에서 실제 변경된 두 파일만 교체한다.

```bash
cp \
  /tmp/sprite_v3/sprite_pipeline_fastapi_full_v3/adapter/service.py \
  /workspace/sprite-pipeline/adapter/service.py

cp \
  /tmp/sprite_v3/sprite_pipeline_fastapi_full_v3/workers/ota_worker.py \
  /workspace/sprite-pipeline/workers/ota_worker.py
```

교체 확인과 compile:

```bash
cd /workspace/sprite-pipeline

server/.venv/bin/python \
  -m py_compile \
  adapter/service.py

one-to-all/.venv/bin/python \
  -m py_compile \
  workers/ota_worker.py
```

그다음 Session 2 One-to-All worker와 Session 3 FastAPI를 이 문서의 실행 명령으로 다시 시작한다. Kimodo worker 코드는 바뀌지 않았으므로 Session 1은 그대로 유지해도 된다.

## V3 핵심 변경

- frame 0을 가짜 heel-strike로 선택하지 않음
- fallback cycle을 foot Y 하나가 아니라 pelvis 대비 3D foot trajectory로 판정
- cycle 평균 heading 대신 17프레임 각각의 `global_root_heading`으로 yaw 고정
- side far limb score `0.40 → 0.90`
- overlap limb score `0.45 → 0.80`
- driving body score와 reference body score의 곱셈 제거
- OTA BODY 1–13 control score를 최소 `0.78`로 유지
- reference confidence는 머리 방향과 얼굴 visibility에만 사용
- metadata에 `cycle_source`, heading mean/std 기록

synthetic yaw-oscillation 검사는 프레임마다 몸이 ±20° 회전하는 입력에서도 front shoulder orientation이 phase 전체에서 거의 동일하게 유지되는 것을 확인했다. 이 검사는 adapter 수학과 코드 경로 검증이며, 실제 One-to-All 생성 품질 통과를 의미하지 않는다.

---

# 6. Kimodo venv 설치

```bash
export PATH="$HOME/.local/bin:$PATH"

cd /workspace/sprite-pipeline/kimodo

rm -rf .venv

uv venv --python 3.11 .venv
```

한 번에 버전 pin:

```bash
uv pip install \
  --python .venv/bin/python \
  --torch-backend=cu128 \
  "torch==2.11.0" \
  "torchvision==0.26.0" \
  "torchaudio==2.11.0" \
  "transformers==5.1.0" \
  "peft==0.18.1" \
  "accelerate==1.13.0" \
  "huggingface-hub==1.6.0" \
  "safetensors==0.7.0" \
  "numpy==1.26.4" \
  "scipy==1.15.3" \
  "tokenizers==0.22.2" \
  -e ".[soma]"
```

**나중에 일부 dependency만 별도로 `--reinstall`하지 않습니다.**

검사:

```bash
uv pip check \
  --python .venv/bin/python
```

```bash
.venv/bin/python -c '
import torch
import transformers
import peft
import accelerate
import numpy

print("torch       :", torch.__version__)
print("cuda        :", torch.version.cuda)
print("cuda avail  :", torch.cuda.is_available())
print("gpu         :", torch.cuda.get_device_name(0))
print("transformers:", transformers.__version__)
print("peft        :", peft.__version__)
print("accelerate  :", accelerate.__version__)
print("numpy       :", numpy.__version__)
'
```

기준:

```text
torch        : 2.11.0+cu128
cuda         : 12.8
cuda avail   : True
gpu          : NVIDIA L40S
transformers : 5.1.0
peft         : 0.18.1
accelerate   : 1.13.0
numpy        : 1.26.4
```

---

# 7. Kimodo HF 권한 확인

Pod에 `HF_TOKEN`이 있어야 합니다.

```bash
echo "${HF_TOKEN:+HF_TOKEN is set}"
```

계정:

```bash
.venv/bin/python -c '
import os
from huggingface_hub import whoami

x = whoami(
    token=os.environ["HF_TOKEN"]
)

print(x["name"])
'
```

Kimodo local LLM2Vec가 사용하는 Llama 모델 접근도 되어 있어야 합니다.

```bash
.venv/bin/python -c '
import os
from huggingface_hub import hf_hub_download

p = hf_hub_download(
    repo_id="meta-llama/Meta-Llama-3-8B-Instruct",
    filename="config.json",
    token=os.environ["HF_TOKEN"],
)

print("Llama access OK:", p)
'
```

---

# 8. Kimodo smoke test

48GB라 CPU offload는 하지 않습니다.

즉:

```bash
export TEXT_ENCODER_DEVICE=cpu
```

사용 안 함.

별도 text encoder server도 사용하지 않으므로 `local`로 고정:

```bash
cd /workspace/sprite-pipeline/kimodo

TEXT_ENCODER_MODE=local \
.venv/bin/kimodo_gen \
  "A person walks naturally forward with a relaxed, balanced and steady gait." \
  --model Kimodo-SOMA-RP-v1.1 \
  --duration 3.0 \
  --diffusion_steps 100 \
  --num_samples 1 \
  --seed 42 \
  --output /workspace/sprite-pipeline/jobs/smoke/kimodo_walk
```

성공:

```text
Saving the npz output to
/workspace/sprite-pipeline/jobs/smoke/kimodo_walk.npz
```

실제 기존 테스트에서도 Kimodo는 NPZ 생성까지 성공했습니다.

---

# 9. One-to-All venv 설치

여기가 중요합니다.

공식 `requirements.txt`는:

```text
onnxruntime-gpu
```

를 버전 고정 없이 요구합니다.

그대로 설치하면 지금처럼 `onnxruntime-gpu 1.28.0`이 잡혀 CUDA 13을 요구할 수 있습니다.

ONNX Runtime 공식 호환표에서 `1.27.x~1.29.x` PyPI GPU wheel은 CUDA 13, `1.21.x~1.26.x`는 CUDA 12.8 + cuDNN 9 계열입니다. 따라서 지금 CUDA 12.x 환경에서는 **1.26.x로 고정**합니다. [ONNX Runtime 공식 호환표][2]

먼저:

```bash
export PATH="$HOME/.local/bin:$PATH"

cd /workspace/sprite-pipeline/one-to-all
```

requirements 수정:

```bash
sed -i \
  's/^onnxruntime-gpu$/onnxruntime-gpu==1.26.0/' \
  requirements.txt
```

확인:

```bash
grep onnxruntime \
  requirements.txt
```

결과:

```text
onnxruntime-gpu==1.26.0
```

venv:

```bash
rm -rf .venv

uv venv --python 3.12 .venv
```

설치:

```bash
uv pip install \
  --python .venv/bin/python \
  --torch-backend=cu124 \
  "torch==2.5.1" \
  "torchvision==0.20.1" \
  "torchaudio==2.5.1" \
  "huggingface_hub<1" \
  -r requirements.txt
```

검사:

```bash
uv pip check \
  --python .venv/bin/python
```

```bash
.venv/bin/python -c '
import torch
import onnxruntime as ort
import diffusers
import transformers
import accelerate

print("torch       :", torch.__version__)
print("cuda        :", torch.version.cuda)
print("cudnn       :", torch.backends.cudnn.version())
print("ort         :", ort.__version__)
print("providers   :", ort.get_available_providers())
print("diffusers   :", diffusers.__version__)
print("transformers:", transformers.__version__)
print("accelerate  :", accelerate.__version__)
'
```

기준:

```text
torch        2.5.1+cu124
cuda         12.4
cudnn        90100
ort          1.26.0
CUDAExecutionProvider 존재
diffusers    0.33.0
transformers 4.40.1
accelerate   0.29.3
```

---

# 10. FlashAttention

```bash
cd /workspace/sprite-pipeline/one-to-all

MAX_JOBS=8 \
uv pip install \
  --python .venv/bin/python \
  --no-build-isolation \
  --no-deps \
  flash-attn
```

확인:

```bash
.venv/bin/python -c '
import flash_attn
print("FlashAttention OK")
'
```

---

# 11. One-to-All 모델 다운로드

```bash
cd /workspace/sprite-pipeline/one-to-all
```

Wan base:

```bash
.venv/bin/hf download \
  Wan-AI/Wan2.1-T2V-1.3B-Diffusers \
  --local-dir pretrained_models/Wan2.1-T2V-1.3B-Diffusers
```

One-to-All:

```bash
.venv/bin/hf download \
  MochunniaN1/One-to-All-1.3b_2 \
  --local-dir checkpoints/One-to-All-1.3b_2
```

Pose2D:

```bash
.venv/bin/hf download \
  Wan-AI/Wan2.2-Animate-14B \
  --include "process_checkpoint/pose2d/*" \
  --local-dir pretrained_models
```

Detector는 **정확한 파일을 별도로 명시**:

```bash
.venv/bin/hf download \
  Wan-AI/Wan2.2-Animate-14B \
  process_checkpoint/det/yolov10m.onnx \
  --local-dir pretrained_models
```

DWPose:

```bash
.venv/bin/hf download \
  FrancisRing/StableAnimator \
  --include "DWPose/*" \
  --local-dir pretrained_models
```

---

# 12. Pose 모델 파일 검사

Detector:

```bash
ls -lh \
  pretrained_models/process_checkpoint/det/yolov10m.onnx
```

Pose model은 파일 하나가 아니라 **external-data ONNX directory** 형태입니다.

확인:

```bash
ls -lh \
  pretrained_models/process_checkpoint/pose2d/vitpose_h_wholebody.onnx/end2end.onnx
```

One-to-All의 loader는 checkpoint가 directory면 내부 `end2end.onnx`를 자동 선택합니다.

---

# 13. ONNX GPU만 먼저 테스트

Detector:

```bash
cd /workspace/sprite-pipeline/one-to-all

.venv/bin/python -c '
import torch
import onnxruntime as ort

p="pretrained_models/process_checkpoint/det/yolov10m.onnx"

print("torch:", torch.__version__)
print("ort:", ort.__version__)

s = ort.InferenceSession(
    p,
    providers=[
        "CUDAExecutionProvider",
        "CPUExecutionProvider",
    ],
)

print("DETECTOR OK")
print(s.get_providers())
'
```

Pose:

```bash
.venv/bin/python -c '
import torch
import onnxruntime as ort

p="pretrained_models/process_checkpoint/pose2d/vitpose_h_wholebody.onnx/end2end.onnx"

s = ort.InferenceSession(
    p,
    providers=[
        "CUDAExecutionProvider",
        "CPUExecutionProvider",
    ],
)

print("POSE OK")
print(s.get_providers())
'
```

둘 다:

```text
CUDAExecutionProvider
```

가 실제 provider에 있어야 합니다.

---

# 14. One-to-All 본 모델 load smoke

```bash
cd /workspace/sprite-pipeline/one-to-all/video-generation

../.venv/bin/python -c '
import importlib.util
import torch

spec = importlib.util.spec_from_file_location(
    "ota_inference",
    "inference_1.3b.py"
)

mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

pipe = mod.build_pipe(
    "cuda",
    "../checkpoints/One-to-All-1.3b_2"
)

print("ONE-TO-ALL OK")
print("GPU:", torch.cuda.get_device_name(0))
print(
    "allocated GiB:",
    round(
        torch.cuda.memory_allocated()
        / 1024**3,
        2,
    )
)
'
```

`from inference_1.3b import ...`는 Python 문법상 사용하지 않습니다.

---

# 15. FastAPI venv

**`uv init` 안 합니다.**

그러면 `src/server/__init__.py` 같은 package build 문제 자체가 없습니다.

```bash
export PATH="$HOME/.local/bin:$PATH"

cd /workspace/sprite-pipeline/server

rm -rf .venv

uv venv --python 3.12 .venv
```

복사한 V3 requirements로 설치:

```bash
uv pip install \
  --python .venv/bin/python \
  -r requirements.txt
```

확인:

```bash
.venv/bin/python -c '
import fastapi
import uvicorn
import httpx
import PIL
import numpy

print("SERVER VENV OK")
'
```

코드 syntax:

```bash
cd /workspace/sprite-pipeline

server/.venv/bin/python \
  -m compileall \
  server/app \
  adapter

kimodo/.venv/bin/python \
  -m py_compile \
  workers/kimodo_worker.py

one-to-all/.venv/bin/python \
  -m py_compile \
  workers/ota_worker.py
```

---

# 16. 여기서부터 3개 세션 운영

**`scripts/start_all.sh` 안 씁니다.**

**`PYTHONPATH=/workspace/sprite-pipeline`도 절대 안 넣습니다.**

Kimodo repo 폴더 자체가 `kimodo` Python package를 shadowing하기 때문입니다.

---

# 세션 1 — Kimodo worker

```bash
cd /workspace/sprite-pipeline/kimodo
```

실행:

```bash
TEXT_ENCODER_MODE=local \
PYTHONUNBUFFERED=1 \
.venv/bin/python \
../workers/kimodo_worker.py
```

세션 그대로 유지.

정상 마지막:

```text
[kimodo-worker] ready: ...
[kimodo-worker] GPU: NVIDIA L40S
[kimodo-worker] listening http://127.0.0.1:9101
```

다른 세션에서 확인:

```bash
curl \
  http://127.0.0.1:9101/health
```

실제로 확인된 현재 기준:

```json
{
  "status": "ready",
  "model": "kimodo-soma-rp-v1.1",
  "gpu": "NVIDIA L40S",
  "allocated_gib": 15.23
}
```

---

# 세션 2 — One-to-All worker

Kimodo `9101` ready 확인 후:

```bash
cd /workspace/sprite-pipeline/one-to-all
```

실행:

```bash
PYTHONUNBUFFERED=1 \
.venv/bin/python \
../workers/ota_worker.py
```

**여기도 `PYTHONPATH` 없음.**

정상 마지막:

```text
[ota-worker] building One-to-All pipe
...
[ota-worker] ready
[ota-worker] GPU: NVIDIA L40S
[ota-worker] listening http://127.0.0.1:9102
```

확인:

```bash
curl \
  http://127.0.0.1:9102/health
```

이 상태에서:

```bash
nvidia-smi
```

로 **Kimodo + OTA 두 모델 동시 resident VRAM** 확인.

OOM이 나면 설치를 더 만지지 말고 그때 residency 전략만 조정합니다.

---

# 세션 3 — FastAPI public server

Kimodo `9101`, OTA `9102` 둘 다 ready인 상태에서:

```bash
cd /workspace/sprite-pipeline/server
```

API 인증 토큰:

```bash
export API_TOKEN='<새_인증_토큰>'
```

실행:

```bash
PYTHONUNBUFFERED=1 \
KIMODO_WORKER_URL="http://127.0.0.1:9101" \
OTA_WORKER_URL="http://127.0.0.1:9102" \
.venv/bin/python \
-m uvicorn \
app.main:app \
--host 0.0.0.0 \
--port 8000 \
--workers 1
```

정상:

```text
Uvicorn running on http://0.0.0.0:8000
```

확인:

```bash
curl \
  http://127.0.0.1:8000/health
```

최종적으로:

```json
{
  "status": "ready",
  "api": "ready",
  "kimodo_worker": {
    "status": "ready"
  },
  "ota_worker": {
    "status": "ready"
  }
}
```

포트:

```bash
ss -lntp \
  | grep -E '(:8000|:9101|:9102)'
```

정상:

```text
127.0.0.1:9101   Kimodo
127.0.0.1:9102   One-to-All
0.0.0.0:8000     FastAPI
```

---

# 17. RunPod 외부 HTTP 8000

Pod 설정의:

```text
Expose HTTP Ports
```

에:

```text
8000
```

추가.

외부 주소:

```text
https://<POD_ID>-8000.proxy.runpod.net
```

RunPod 공식 Pod HTTP proxy가 expose된 HTTP 포트를 이 URL 형태로 제공합니다. [RunPod 공식 문서][1]

외부 PC에서:

```bash
curl \
  "https://${POD_ID}-8000.proxy.runpod.net/health"
```

---

# 18. 외부 Client → 생성 요청

이건 **RunPod 내부가 아니라 외부 client에서** 실행.

```bash
export POD_ID="실제_POD_ID"
export API_TOKEN="<서버와_같은_인증_토큰>"
```

```bash
curl -X POST \
  "https://${POD_ID}-8000.proxy.runpod.net/v1/jobs" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F "front=@front.png" \
  -F "back=@back.png" \
  -F "left=@left.png" \
  -F "right=@right.png" \
  -F "prompt=A person walks naturally forward with a relaxed balanced and steady gait." \
  -F "seed=42"
```

응답:

```json
{
  "job_id": "abc123...",
  "status": "queued",
  "status_url": "/v1/jobs/abc123...",
  "result_url": "/v1/jobs/abc123.../result"
}
```

---

# 19. 상태 조회

```bash
JOB_ID="abc123..."
```

```bash
curl \
  "https://${POD_ID}-8000.proxy.runpod.net/v1/jobs/${JOB_ID}" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

stage:

```text
queued
↓
kimodo
↓
motion_adapter
↓
render_front
↓
render_back
↓
render_left
↓
render_right
↓
postprocess
↓
succeeded
```

---

# 20. 결과 다운로드

```bash
curl -L \
  "https://${POD_ID}-8000.proxy.runpod.net/v1/jobs/${JOB_ID}/result" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -o result.zip
```

결과:

```text
result.zip

front/
  0.png ... 7.png

back/
  0.png ... 7.png

left/
  0.png ... 7.png

right/
  0.png ... 7.png

sprite_sheet.png
metadata.json
```

---

# 21. 서버 내부 작업 결과

```text
/workspace/sprite-pipeline/jobs/<JOB_ID>/

input/
  front.png
  back.png
  left.png
  right.png

motion/
  motion.npz

pose/
  front/
  back/
  left/
  right/

rendered/
  front/
  back/
  left/
  right/

result/
  front/0.png ... 7.png
  back/0.png ... 7.png
  left/0.png ... 7.png
  right/0.png ... 7.png
  sprite_sheet.png
  metadata.json
  result.zip

request.json
status.json
```

---

# 22. 최종 기억할 것

```text
설치할 때:
새 세션 → export PATH="$HOME/.local/bin:$PATH"

실행할 때:
uv 필요 없음.
각 .venv/bin/python 직접 실행.

절대 금지:
PYTHONPATH=/workspace/sprite-pipeline

Kimodo:
kimodo/.venv
CUDA 12.8

One-to-All:
one-to-all/.venv
torch cu124
onnxruntime-gpu 1.26.0

Server:
server/.venv
GPU 패키지 없음

실행:
세션1 Kimodo :9101
세션2 OTA    :9102
세션3 API    :8000
```

이게 지금까지 실제로 나온 오류들을 모두 반영한 **3세션 기준 최종 설치/운영 가이드**입니다.

[1]: https://docs.runpod.io/pods/configuration/expose-ports "Expose ports - Runpod Documentation"
[2]: https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html "NVIDIA - CUDA | onnxruntime"
