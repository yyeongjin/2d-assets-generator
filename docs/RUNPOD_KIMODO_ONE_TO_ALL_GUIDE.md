# 최종 RunPod 설치/실행 가이드

> **상태: V8 현재 실행 기준.** V8은 V6의 정면·후면 cardinal 보정과 V7의 17-frame closed control loop, One-to-All 위치 안정화와 `8→1` loop QC를 유지하면서, 네 방향 공통 CIE Lab 팔레트 기반 색상 안정화와 최종 PNG 실루엣 위치·발 기준선·색상 hard gate를 추가한 오버레이다. V7은 RunPod L40S에서 캐릭터 3종의 방향별 8장·총 32 PNG와 `result.zip` 종단 생성을 확인했다. V8 패키지는 결정론적 테스트 17개와 V7 결과 오프라인 backtest를 통과했으며, 새 L40S diffusion 종단 렌더는 RunPod 적용 후 확인해야 한다. 이전 실패·성공 기록과 ZIP은 삭제하지 않고 `docs/`와 `archives/`에 보존한다.

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
        ├────→ Motion worker :9101 ← 세션 1
        │          │
        │          ├─ 기본: Kimodo 공식 05_root_path/motion.npz
        │          └─ 선택: Kimodo 새 motion 생성
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
                  V8 팔레트 안정화
                         │
                         ▼
                  위치·색상 loop QC
                         │
                         ▼
                   4방향 × 8 PNG
                   +
                   sprite_sheet.png
                   +
                   loop_qc.json
                   +
                   appearance_qc.json
                   +
                   result.zip
```

RunPod는 **서버**고 외부 PC/게임 서버/백엔드가 클라이언트입니다.

## RunPod에서 할 작업

- Kimodo와 One-to-All 저장소 clone 및 각 venv 설치
- V8 overlay를 기존 `/workspace/sprite-pipeline`에 배치
- 공식 `05_root_path/motion.npz`를 원본 수정 없이 작업용 스키마로 자동 정규화
- One-to-All 로드 전에 V8 Adapter hard gate와 pose preview 확인
- 16개 고유 phase와 첫 phase 복사본으로 닫힌 17-frame control 생성
- Motion worker `:9101`, One-to-All `:9102`, FastAPI `:8000` 실행
- 렌더 위치·팔레트 안정화, 8-frame 후보 선택과 appearance·loop QC 수행
- 작업 중간 파일과 최종 `result.zip` 생성

## 로컬 `:3000`에서 할 작업

- 인벤토리에서 `front`, `back`, `left`, `right` 네 입력 선택
- RunPod FastAPI에 multipart 작업 요청
- 작업 상태 polling
- 완료된 `/v1/jobs/<JOB_ID>/result`를 로컬 클라이언트가 다운로드
- 32 PNG, sprite sheet와 metadata를 에셋 인벤토리에 보관

RunPod의 임시 공인 endpoint와 인증 token은 로컬 환경변수로만 설정하며 저장소 파일에는 기록하지 않는다.

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

# 4. V8 전체 소스 ZIP 받기

사용할 파일:

[sprite_pipeline_fastapi_full_v8.zip](https://github.com/yyeongjin/2d-assets-generator/blob/main/sprite_pipeline_fastapi_full_v8.zip)

V8 ZIP 자체는 수정하지 않고 RunPod에도 원본을 그대로 보관한다. 이전 V2·V3·V5·V6·V7 ZIP은 저장소의 [`archives/pipeline-versions/`](../archives/pipeline-versions/)에 보존하며 현재 설치에는 사용하지 않는다. V4는 배포하지 않았다.

공개 저장소 기준으로 RunPod에서:

```bash
cd /workspace

curl -L \
  "https://github.com/yyeongjin/2d-assets-generator/raw/refs/heads/main/sprite_pipeline_fastapi_full_v8.zip" \
  -o sprite_pipeline_fastapi_full_v8.zip
```

확인과 무결성 검사:

```bash
ls -lh /workspace/sprite_pipeline_fastapi_full_v8.zip
sha256sum /workspace/sprite_pipeline_fastapi_full_v8.zip
unzip -t /workspace/sprite_pipeline_fastapi_full_v8.zip
```

SHA-256은 다음 값과 정확히 같아야 한다.

```text
d56eabb1b71eb097f266686d636b5840f99739878726bc3020ebd14cfb01d917
```

마지막에 `No errors detected in compressed data`가 나와야 한다. 원본 ZIP은 `/workspace/sprite_pipeline_fastapi_full_v8.zip`에 그대로 둔다.

---

# 5. V8 overlay 설치

`/workspace/sprite-pipeline/server/` 안에서 바로 압축을 풀지 않는다.

```bash
rm -rf /tmp/sprite_v8
mkdir -p /tmp/sprite_v8

unzip -q \
  /workspace/sprite_pipeline_fastapi_full_v8.zip \
  -d /tmp/sprite_v8
```

기존 venv, Kimodo repo, One-to-All checkpoint, 기존 `.env`, `jobs/`를 유지한 채 overlay만 적용한다.

```bash
cd /tmp/sprite_v8/sprite_pipeline_fastapi_full_v8

./scripts/install_v8_overlay.sh \
  /workspace/sprite-pipeline
```

새 Pod에서 처음 설치하는 경우 FastAPI venv 생성에 사용할 requirements도 복사한다. 기존 V5 Pod와 내용이 같더라도 다시 복사해도 된다.

```bash
cp -a \
  /tmp/sprite_v8/sprite_pipeline_fastapi_full_v8/server/requirements.txt \
  /workspace/sprite-pipeline/server/requirements.txt
```

설치 스크립트는 다음 코드만 갱신한다.

```text
workers/
adapter/
server/app/
server/requirements.txt
client/
scripts/
tests/
VERSION
CHANGES_v8.md
README_V8.md
MIGRATE_V7_TO_V8.md
.env.v8.example
V8_BUILD_REPORT.txt
V8_BACKTEST_SUMMARY.json
```

다음 경로는 삭제하거나 덮어쓰지 않는다.

```text
/workspace/sprite-pipeline/kimodo/.venv/
/workspace/sprite-pipeline/kimodo/와 공식 example
/workspace/sprite-pipeline/one-to-all/.venv/
/workspace/sprite-pipeline/one-to-all/pretrained_models/
/workspace/sprite-pipeline/one-to-all/checkpoints/
/workspace/sprite-pipeline/server/.venv/
/workspace/sprite-pipeline/jobs/
/workspace/sprite-pipeline/.env
```

공식 Kimodo fixture가 clone된 저장소에 실제로 있는지 먼저 확인한다.

```bash
EX="/workspace/sprite-pipeline/kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path"

ls -lh \
  "$EX/meta.json" \
  "$EX/constraints.json" \
  "$EX/motion.npz"

cat "$EX/meta.json"
```

metadata의 prompt가 `A person is casually walking forward slowly`인지 확인한다. 공식 원본 NPZ에는 `root_positions`와 `global_root_heading`이 없을 수 있으며, V8은 job-local 파일을 만들 때 이를 자동으로 생성한다. 공식 파일 자체를 수정하지 않는다.

V8 핵심 코드와 버전 확인:

```bash
cd /workspace/sprite-pipeline

grep -n -E "WORKER_VERSION|official_example|05_root_path" workers/kimodo_worker.py
grep -n -E "ADAPTER_VERSION|cardinal|heading" adapter/service.py
grep -n -E "PIPELINE_VERSION|motion_source|official_example" server/app/pipeline.py
```

버전은 `8.0.0`이어야 한다.

## V8 코드 검사

One-to-All 서비스를 로드하기 전에 실행한다. V8 테스트에는 `workers/ota_worker.py`를 import하는 항목이 있어 `torch`와 `imageio`가 설치된 One-to-All venv를 사용한다. 새 Pod라면 먼저 이 문서의 **9. One-to-All venv 설치**까지 완료한 뒤 이 단계로 돌아온다.

```bash
cd /workspace/sprite-pipeline

one-to-all/.venv/bin/python \
  -m unittest discover \
  -s tests \
  -p 'test_*.py' \
  -v
```

`Ran 17 tests`와 `OK`로 끝나야 한다.

## V8 핵심 변경

- 기본 `KIMODO_MOTION_SOURCE=official_example`
- 공식 NPZ를 원본 수정 없이 job-local V8 스키마로 정규화
- fixture 모드에서는 Kimodo diffusion 모델과 LLM stack을 VRAM에 올리지 않음
- heading을 `delta = -heading`으로 정규화하고 canonical hip 평균 오차를 검사
- 자연스러운 canonical motion은 `left/right`에 사용
- torso yaw `±2.5°`, head yaw `±5°` cardinal-lock motion은 `front/back`에 사용
- front/back과 left/right의 정반대 뷰 투영 대칭 오차 검사
- 3D 발 교차, 보폭, 발 들림과 무릎 굽힘 검사 실패 시 OTA 실행 차단
- 정면·후면과 좌우에 서로 다른 geometry source와 guidance 값을 metadata에 기록
- 16개 고유 phase 뒤에 첫 control을 정확히 복사해 17-frame closed loop 구성
- 렌더 이미지의 골반 중심과 발 기준선을 control 위치에 맞춰 평행이동
- `even_start`, `odd`, `even_end` 후보 중 네 방향 공통 8-frame phase 선택
- `1→2`부터 `8→1`까지 loop QC 수행
- 네 방향 입력에서 공통 CIE Lab 팔레트를 만들고 OTA 17프레임의 색조·채도와 밝기 흔들림을 제한적으로 보정
- 최종 PNG의 전경 centroid, 발 기준선, 높이와 색상 `8→1` seam을 추가 검사
- appearance 또는 loop QC 실패 시 Kimodo와 Adapter는 유지하고 One-to-All만 다른 seed로 재시도

클라이언트 `prompt`와 `seed`는 downstream 렌더링과 작업 이력에는 남지만, 기본 fixture 모드에서 gait를 새로 생성하는 데 사용하지 않는다. 새 Kimodo motion 생성 실험을 다시 할 때만 `KIMODO_MOTION_SOURCE=generated`로 명시적으로 전환한다.

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

# 7. Kimodo HF 권한 확인 — `generated` 모드만

기본 `official_example` 모드는 저장소에 포함된 `motion.npz`를 읽으므로 새 Kimodo motion 생성용 모델을 다운로드하거나 로드하지 않는다. 아래 단계는 나중에 `KIMODO_MOTION_SOURCE=generated`를 사용할 때만 필요하다.

Pod에 `HF_TOKEN`이 있어야 한다.

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

# 8. 공식 Kimodo walk fixture 확인

기본 V8 검증에서는 새 motion을 생성하지 않는다. 공식 example 세 파일과 NPZ 배열부터 확인한다.

```bash
cd /workspace/sprite-pipeline

EX="kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path"

ls -lh \
  "$EX/meta.json" \
  "$EX/constraints.json" \
  "$EX/motion.npz"

cat "$EX/meta.json"
```

NPZ가 Kimodo export 형식인지 확인:

```bash
kimodo/.venv/bin/python - <<'PY'
import numpy as np
from pathlib import Path

p = Path("kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path/motion.npz")
with np.load(p, allow_pickle=False) as data:
    print("keys:", data.files)
    print("posed_joints:", data["posed_joints"].shape)
    print("global_rot_mats:", data["global_rot_mats"].shape)
    print("foot_contacts:", data["foot_contacts"].shape)
    print("root_positions present:", "root_positions" in data.files)
PY
```

공식 `05_root_path/motion.npz`의 정상 key는 `posed_joints`, `global_rot_mats`, `foot_contacts`다. `root_positions`가 없다는 이유로 실패시키면 안 된다. V8 `workers/fixture_io.py`가 작업용 NPZ를 만들 때 `posed_joints[:, 0, :]`의 Hips 좌표에서 `root_positions`를 만들고 heading도 보완한다.

새 motion 생성 경로를 별도로 시험할 때만 다음을 실행한다. 48GB GPU에서는 CPU offload를 사용하지 않는다.

```bash
cd /workspace/sprite-pipeline/kimodo

KIMODO_MOTION_SOURCE=generated \
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

이 생성 결과는 공식 fixture 검증과 섞지 않는다.

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

복사한 V8 requirements로 설치:

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

## 15-B. One-to-All 없이 공식 motion과 V8 Adapter 검사

첫 검증에서는 OTA worker를 호출하지 않는다.

```bash
cd /workspace/sprite-pipeline

PYTHON_BIN=/workspace/sprite-pipeline/server/.venv/bin/python \
./scripts/check_official_walk.sh
```

검수 대상:

```text
/tmp/sprite-v8-official-check/pose_preview.png
/tmp/sprite-v8-official-check/adapter_meta.json
/tmp/sprite-v8-official-check/adapter_validation.json
/tmp/sprite-v8-official-check/v8_validation_summary.json
```

다음 hard gate가 모두 통과해야 한다.

```text
canonical hip 평균 오차      <= 1.0°
front/back torso yaw p95    <= 2.5°
front/back head yaw p95     <= 5.0°
front/back 투영 대칭 오차    <= 1e-5
left/right 투영 대칭 오차    <= 1e-5
3D 발 교차·보폭 검사         통과
unique cycle frames          = 16
control endpoint duplicate   = true
네 방향 endpoint error       = 0
```

네 방향 pose의 phase, 발 순서와 신체 방향이 정상일 때만 아래 3세션 종단 생성으로 넘어간다. 이 단계가 실패하면 OTA를 실행하지 않고 Adapter 문제로 기록한다.

---

# 16. 여기서부터 3개 세션 운영

**`scripts/start_all.sh` 안 씁니다.**

**`PYTHONPATH=/workspace/sprite-pipeline`도 절대 안 넣습니다.**

Kimodo repo 폴더 자체가 `kimodo` Python package를 shadowing하기 때문입니다.

---

# 세션 1 — Motion worker

```bash
cd /workspace/sprite-pipeline/kimodo
```

실행:

```bash
export KIMODO_MOTION_SOURCE=official_example
export KIMODO_OFFICIAL_WALK_MOTION=/workspace/sprite-pipeline/kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path/motion.npz

PYTHONUNBUFFERED=1 \
.venv/bin/python \
../workers/kimodo_worker.py
```

세션 그대로 유지.

정상 마지막:

```text
[kimodo-worker] V8 source=official_example fixture=...
[kimodo-worker] Kimodo diffusion model is NOT loaded in fixture mode
[kimodo-worker] listening http://127.0.0.1:9101
```

다른 세션에서 확인:

```bash
curl \
  http://127.0.0.1:9101/health
```

V8 기본 기준:

```json
{
  "status": "ready",
  "model": "official-demo:kimodo-soma-rp/05_root_path",
  "worker_version": "8.0.0",
  "motion_source": "official_example",
  "fixture": "/workspace/sprite-pipeline/kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path/motion.npz",
  "allocated_gib": 0.0
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
export OTA_CHECKPOINT_DIR=/workspace/sprite-pipeline/one-to-all/checkpoints/One-to-All-1.3b_2

export OTA_STABILIZE_RENDERED_FRAMES=true
export OTA_STABILIZE_MAX_SHIFT_RATIO=0.08
export OTA_STABILIZE_SMOOTHING=0.35
export OTA_STABILIZE_MIN_VALID_FRACTION=0.60

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

로 **One-to-All만 GPU에 resident이고 fixture motion worker가 Kimodo diffusion VRAM을 사용하지 않는지** 확인한다.

OOM이 나면 설치를 더 만지지 말고 그때 residency 전략만 조정합니다.

---

# 세션 3 — FastAPI public server

Kimodo `9101`, OTA `9102` 둘 다 ready인 상태에서:

```bash
cd /workspace/sprite-pipeline/server
```

API 인증 토큰:

```bash
export API_TOKEN='<새_ASCII_인증_토큰>'
export SPRITE_CANONICAL_HEADING_TOLERANCE_DEG=1.0
export SPRITE_FRONT_BACK_TORSO_YAW_LIMIT_DEG=2.5
export SPRITE_FRONT_BACK_HEAD_YAW_LIMIT_DEG=5.0
export SPRITE_BODY18_SHOULDER_BLEND=0.35

export OTA_FRONT_BACK_IMAGE_GUIDANCE_SCALE=2.5
export OTA_FRONT_BACK_POSE_GUIDANCE_SCALE=1.5
export OTA_SIDE_IMAGE_GUIDANCE_SCALE=2.5
export OTA_SIDE_POSE_GUIDANCE_SCALE=1.5

export SPRITE_APPEARANCE_STABILIZE=true
export SPRITE_APPEARANCE_QC_STRICT=true
export SPRITE_APPEARANCE_PALETTE_SIZE=12
export SPRITE_APPEARANCE_CHROMA_STRENGTH=0.55
export SPRITE_APPEARANCE_BRIGHTNESS_STRENGTH=0.18
export SPRITE_APPEARANCE_CONTRAST_STRENGTH=0.16
export SPRITE_APPEARANCE_MAX_DELTA_E=14.0
export SPRITE_APPEARANCE_TEMPORAL_CHROMA_STRENGTH=0.38
export SPRITE_APPEARANCE_TEMPORAL_LUMA_STRENGTH=0.16
export SPRITE_APPEARANCE_MAX_TEMPORAL_CHROMA_SPREAD=13.0
export SPRITE_APPEARANCE_MAX_TEMPORAL_LUMA_SPREAD=12.0
export SPRITE_APPEARANCE_MAX_MEAN_CORRECTION_DELTA_E=9.0

export OTA_LOOP_MAX_ATTEMPTS=2
export OTA_LOOP_SEED_STRIDE=100003
export SPRITE_LOOP_QC_STRICT=true
export SPRITE_LOOP_MAX_SEAM_RATIO=1.45
export SPRITE_LOOP_MAX_MEAN_SEAM_RATIO=1.20
export SPRITE_LOOP_MAX_TRANSITION_RATIO=2.25
export SPRITE_LOOP_MAX_FRONT_BACK_CENTROID_SEAM_RATIO=0.011
export SPRITE_LOOP_MAX_FRONT_BACK_GROUND_SEAM_RATIO=0.011
export SPRITE_LOOP_MAX_FRONT_BACK_HEIGHT_SEAM_RATIO=0.025
export SPRITE_LOOP_MAX_COLOR_SEAM_DELTA_E=12.0
```

`API_TOKEN`에는 영문, 숫자와 일반 ASCII 기호만 사용한다. 이전 셸에 잘못된 값이 남아 있다면 `unset API_TOKEN` 후 다시 설정하고 FastAPI를 재시작한다.

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
render_front_attempt_1
↓
render_back_attempt_1
↓
render_left_attempt_1
↓
render_right_attempt_1
↓
appearance_attempt_1
↓
loop_qc_attempt_1
↓
succeeded 또는 One-to-All attempt_2
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
debug/
  motion_qc.json
  adapter_meta.json
  adapter_validation.json
  pose_preview.png
  appearance_qc.json
  loop_qc.json
  front/appearance_meta.json
  front/render_meta.json
  back/appearance_meta.json
  back/render_meta.json
  left/appearance_meta.json
  left/render_meta.json
  right/appearance_meta.json
  right/render_meta.json
```

서버 내부의 최종 appearance와 loop 판정은 다음 파일에서 확인한다.

```bash
JOB_ID='<실제_JOB_ID>'

cat \
  "/workspace/sprite-pipeline/jobs/${JOB_ID}/result/appearance_qc.json"

cat \
  "/workspace/sprite-pipeline/jobs/${JOB_ID}/result/loop_qc.json"
```

다음 필드를 우선 확인한다.

```text
appearance_qc.json -> ok: true
loop_qc.json       -> ok: true
selected_attempt
selected_render_seed
selected_candidate
selected_phase_indices
selected_metrics.worst_seam_ratio
selected_metrics.mean_seam_ratio
selected_metrics.worst_transition_ratio
```

두 렌더가 모두 strict appearance·loop QC를 통과하지 못하면 작업은 `LOOP_QC_FAILED`로 종료되고 전체 보고서는 `jobs/<JOB_ID>/loop_qc_failed.json`에 남는다. 이때 cardinal 보정, appearance strict QC나 8-frame 후보 선택을 제거하지 않는다. 같은 캐릭터가 반복해서 경계선에서 실패할 때만 `OTA_LOOP_MAX_ATTEMPTS=3`으로 올린 뒤 FastAPI를 재시작해 다시 요청한다.

V8 결과에서 `front/back`의 `keypoints.json`은 다음 geometry source를 가져야 한다.

```json
"geometry_source": "front_back_cardinal_lock"
```

`left/right`는 다음 값이어야 한다.

```json
"geometry_source": "natural_canonical_cycle"
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
  motion.qc.json

pose/
  pose_preview.png
  adapter_meta.json
  adapter_validation.json
  front/
  back/
  left/
  right/

rendered/
  attempt_00/
    front/
      frame_000.png ... frame_016.png
      preappearance/
      appearance_meta.json
      render_meta.json
    back/
    left/
    right/
    appearance_qc.json
    loop_qc.json
  attempt_01/  # 첫 시도의 appearance 또는 loop QC 실패 시에만 생성

result/
  front/0.png ... 7.png
  back/0.png ... 7.png
  left/0.png ... 7.png
  right/0.png ... 7.png
  sprite_sheet.png
  metadata.json
  appearance_qc.json
  loop_qc.json
  result.zip

request.json
status.json
```

---

# 22. Production 걷기 fixture 생성

공식 `05_root_path`는 회귀 기준으로 계속 유지한다. 최종 production fixture는 Kimodo generated 모드에서 직선 root 경로와 고정 heading을 사용해 후보를 만들고, V8 hard gate를 통과한 결과만 동결한다.

먼저 세션 1의 기존 Motion worker만 종료하고 generated 모드로 다시 실행한다.

```bash
cd /workspace/sprite-pipeline/kimodo

export KIMODO_MOTION_SOURCE=generated
export KIMODO_MODEL=Kimodo-SOMA-RP-v1.1
export KIMODO_DENSE_ROOT_CONSTRAINT=true
export KIMODO_GENERATED_DURATION=4.0
export KIMODO_MAX_MOTION_ATTEMPTS=8

PYTHONUNBUFFERED=1 \
.venv/bin/python \
../workers/kimodo_worker.py
```

후보 생성과 검증:

```bash
cd /workspace/sprite-pipeline

PYTHON_BIN=/workspace/sprite-pipeline/server/.venv/bin/python \
KIMODO_WORKER_URL=http://127.0.0.1:9101 \
./scripts/generate_v8_candidate.sh 42
```

통과하면 다음 파일이 함께 만들어진다.

```text
neutral_walk_seed_42.npz
neutral_walk_seed_42.meta.json
neutral_walk_seed_42_v8_validation/
```

다른 seed도 같은 방식으로 검사하고, V8 gait·cardinal gate를 모두 통과한 후보만 fixture로 고정한다. Adapter 통과만으로 최종 렌더 품질이 보장되지는 않으므로 V8 종단 요청의 `appearance_qc.json`과 `loop_qc.json`도 모두 통과해야 한다.

```bash
./scripts/generate_v8_candidate.sh 104771
./scripts/generate_v8_candidate.sh 209500
./scripts/generate_v8_candidate.sh 314229
```

고정 예시:

```bash
export KIMODO_MOTION_SOURCE=fixture
export KIMODO_FIXTURE_LABEL=generated-neutral-walk-seed-42
export KIMODO_FIXTURE_MOTION=/workspace/sprite-pipeline/fixtures/v8/neutral_walk_seed_42.npz
export KIMODO_FIXTURE_META=/workspace/sprite-pipeline/fixtures/v8/neutral_walk_seed_42.meta.json
```

공식 원본 fixture는 수정하지 않는다. 생성 후보의 prompt, seed, model, repository revision, constraints와 SHA-256은 `.meta.json`에 보존한다.

---

# 23. 최종 기억할 것

```text
설치할 때:
새 세션 → export PATH="$HOME/.local/bin:$PATH"

실행할 때:
uv 필요 없음.
각 .venv/bin/python 직접 실행.

절대 금지:
PYTHONPATH=/workspace/sprite-pipeline

Motion worker:
kimodo/.venv
기본 KIMODO_MOTION_SOURCE=official_example
공식 05_root_path/motion.npz 사용
공식 NPZ는 job-local V8 스키마로 자동 정규화
기본 모드에서는 Kimodo diffusion 모델을 VRAM에 올리지 않음

V8 Adapter:
heading delta = -heading
front/back = cardinal-lock geometry
left/right = natural canonical geometry
16 unique controls + exact phase-zero duplicate
hard gate 통과 후에만 OTA 실행

One-to-All:
one-to-all/.venv
torch cu124
onnxruntime-gpu 1.26.0
pose-anchor translation stabilization
V8 공통 팔레트 appearance stabilization

Server:
server/.venv
GPU 패키지 없음
even/odd/end 8-frame 후보 선택
8→1 포함 appearance·geometry·color loop QC
실패 시 One-to-All만 seed를 바꿔 재시도

실행:
세션1 Motion worker :9101
세션2 OTA           :9102
세션3 API           :8000
```

이 문서가 V3 실패 motion 분석, V5 공식 fixture 종단 성공, V6 cardinal 보정, V7 loop 안정화와 V8 appearance·최종 PNG QC를 모두 반영한 **현재 단일 3세션 설치·운영 가이드**입니다.

[1]: https://docs.runpod.io/pods/configuration/expose-ports "Expose ports - Runpod Documentation"
[2]: https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html "NVIDIA - CUDA | onnxruntime"
