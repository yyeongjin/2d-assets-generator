# RunPod에서 Qwen-Image-Edit-2511 실행

RunPod GPU Pod에서 `Qwen/Qwen-Image-Edit-2511`을 내려받고 vLLM Omni 서버로 실행하는 절차입니다. 모델과 Hugging Face 캐시는 Pod 재시작 후에도 유지할 볼륨 경로에 저장합니다.

## 검증한 RunPod 사양

이 프로젝트에서 실제로 실행한 Pod 설정은 다음과 같습니다.

| 항목 | 설정 |
|---|---|
| GPU | NVIDIA A100 |
| VRAM | 80GB |
| 디스크 | 80GB |

디스크를 `50GB`로 설정하면 vLLM·vLLM-Omni 설치, 모델 다운로드, 캐시 생성 과정에서 용량이 부족해 실패합니다. 검증된 설정인 **80GB 이상으로 설정**하고, 다른 모델이나 생성 결과도 같은 디스크에 보관한다면 그보다 넉넉하게 잡습니다.

## 1. 시스템 도구 설치

RunPod 터미널에서 실행합니다.

```bash
apt-get update
apt-get install -y \
  git git-lfs curl jq \
  build-essential

curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
```

## 2. Python 3.12 환경과 vLLM 설치

```bash
mkdir -p ~/qwen-image-server
cd ~/qwen-image-server

uv venv --python 3.12 --seed
source .venv/bin/activate

# vLLM 설치
uv pip install vllm==0.26.0 --torch-backend=auto

# 최신 vLLM-Omni 소스 설치
git clone https://github.com/vllm-project/vllm-omni.git
cd vllm-omni
uv pip install -e .

# 모델 다운로드와 클라이언트 테스트에 사용
uv pip install "huggingface_hub[hf_xet]" requests

git lfs install
```

## 3. 모델 다운로드

`/data`가 RunPod Network Volume 또는 영구 볼륨에 연결되어 있는지 먼저 확인합니다.

```bash
mkdir -p /data/models
chown -R "$USER:$USER" /data/models

hf download \
  Qwen/Qwen-Image-Edit-2511 \
  --local-dir /data/models/Qwen-Image-Edit-2511
```

Hugging Face 인증이 필요한 환경이라면 다운로드 전에 `hf auth login`을 실행합니다. 토큰은 저장소나 실행 명령에 직접 기록하지 않습니다.

## 4. vLLM Omni 서버 실행

새 터미널을 열었거나 가상환경을 나갔다면 다시 활성화합니다.

```bash
source ~/qwen-image-server/.venv/bin/activate

export CUDA_VISIBLE_DEVICES=0
export HF_HOME=/data/huggingface-cache

vllm serve /data/models/Qwen-Image-Edit-2511 \
  --omni \
  --host 0.0.0.0 \
  --port 8000 \
  --num-weight-load-threads 8
```

터미널은 서버 로그를 확인할 수 있도록 계속 열어 둡니다. 모델 로드가 끝나면 RunPod에서 HTTP Port `8000`을 노출합니다.

## 5. Endpoint 확인

RunPod Proxy URL은 일반적으로 다음 형태입니다.

```text
https://<POD_ID>-8000.proxy.runpod.net
```

실제 주소를 환경변수로만 설정한 뒤 모델 목록을 확인합니다.

```bash
export RUNPOD_BASE_URL="https://<POD_ID>-8000.proxy.runpod.net"

curl --fail --show-error --silent \
  "$RUNPOD_BASE_URL/v1/models" | jq
```

`tools_test`에서는 endpoint와 키를 코드에 넣지 않고 `.env.local`로 전달합니다.

```dotenv
RUNPOD_BASE_URL=https://<POD_ID>-8000.proxy.runpod.net
RUNPOD_MODEL_ID=/data/models/Qwen-Image-Edit-2511
RUNPOD_REQUEST_TIMEOUT_MS=600000

# 인증을 설정한 경우에만 로컬 파일에 입력
RUNPOD_API_KEY=
```

`.env.local`은 Git에 커밋하지 않습니다. RunPod를 중지했거나 Proxy URL이 바뀌면 로컬 도구의 상태 표시는 연결 오류가 됩니다.

## 6. 로컬 디버깅 도구 실행

로컬 저장소에서 실행합니다.

```bash
cd tools_test
cp .env.example .env.local
# .env.local에 위 RunPod 설정 입력
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열고 다음 순서로 확인합니다.

1. `연결 확인`으로 `/health`와 `/v1/models` 응답 확인
2. 캐릭터 조건과 실제 전송 prompt 확인
3. 1024×1024 빈 흰 캔버스 1장을 `/v1/images/edits`에 보내 2×2 방향 시트 생성
4. 정면·후면·오른쪽·왼쪽의 정체성, 크기, 발 위치를 확인하고 Reference A로 승인
5. 실제 아이템 이미지를 Reference B로 올려 네 방향 착용 결과 생성

1단계의 빈 흰 캔버스는 Edit 모델이 요구하는 이미지 입력이며 레이아웃 가이드가 아닙니다. 1단계에는 Reference B가 없습니다. 2단계의 Reference B는 검은 윤곽 가이드가 아니라 실제 무기·도구·장비 이미지입니다. 두 단계 모두 RunPod 원본을 먼저 저장하며 자동 크롭·리사이즈·픽셀화를 실행하지 않습니다.

## 7. vLLM Qwen 파이프라인의 마스크·레이아웃 제한

vLLM-Omni의 `/v1/images/edits` 요청 규격에 `mask_image` 필드가 있어도 현재 `QwenImageEditPlusPipeline`이 그 필드를 실제 생성 입력으로 사용한다는 뜻은 아닙니다. 확인한 vLLM-Omni 구현에서는 Qwen 파이프라인이 `multi_modal_data["image"]`만 읽고 `mask_image`를 읽지 않습니다. 따라서 현재 도구는 사용되지 않는 마스크를 전송하지 않으며 화면에도 `MASK 미전송`으로 표시합니다.

실제 endpoint에서 다음 조건으로 확인했습니다.

| 항목 | 값 |
|---|---|
| Reference A | 512×1024, 외형 기준과 내부 검은 프레임 |
| Reference B | 512×1024, 동일 좌표의 내부 검은 프레임과 걷기 포즈 |
| 목표 내부 프레임 | `x=52`, `y=103`, `409×818`, 사방 약 10% 바깥 여백 |
| 출력 | 512×1024 |
| 검은 프레임 보존율 | `L 0.58 / T 0.53 / R 0.02 / B 0.00` |
| 접촉 판정 | 윤곽 실패로 보류 |

출력 모델은 Reference B의 내부 프레임을 고정하지 않고 캔버스 가장자리 쪽으로 다시 확대해 그렸습니다. 이 결과를 맞는 것으로 처리하거나 목표 프레임을 96%까지 키우면 안 됩니다. 목표 프레임은 80%와 사방 10% 여백으로 유지하고, 같은 현상은 생성 실패로 기록합니다.

색상을 반전한 마스크도 해결책이 아닙니다.

- 현재 vLLM Qwen 파이프라인에서는 마스크 자체를 읽지 않으므로 흑백 어느 방향도 적용되지 않습니다.
- Diffusers의 `QwenImageEditInpaintPipeline`에서는 흰 영역을 다시 그리고 검은 영역을 보존합니다.
- 이 규칙을 반전해 바깥을 흰색, 안쪽을 검은색으로 만들면 바깥을 편집하고 캐릭터가 들어갈 안쪽을 잠그므로 목적과 반대입니다.

프레임을 실제로 잠그려면 흰색 내부 편집 영역과 검은색 외부 보존 영역을 사용하는 inpaint 파이프라인이 필요합니다. 단순히 vLLM 요청에 `mask_image` 필드만 추가하는 것으로는 해결되지 않습니다.

현재 캐릭터 검증 구조는 이 제한에 의존하지 않습니다. 첫 요청에서 네 방향을 한 장에 생성하고, 다음 요청은 승인한 네 방향 시트 A와 실제 아이템 B를 사용합니다. 이전 레이아웃 B 실험의 수치는 실패 기록으로만 남겨 두며 현재 생성 입력에는 사용하지 않습니다.

- [vLLM-Omni Image Edit API](https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/image_edit_api/)
- [Diffusers Qwen Image Edit/Inpaint](https://huggingface.co/docs/diffusers/api/pipelines/qwenimage)
