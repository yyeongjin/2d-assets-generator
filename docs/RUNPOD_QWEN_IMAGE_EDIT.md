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

브라우저에서 `http://localhost:3000`을 열고 `방향 · 상태 · 동작 변형`을 선택합니다. 현재 생성 흐름은 Reference A와 레이아웃 가이드 B를 `/v1/images/edits`로 전송하고, 512×1024 원본을 먼저 저장합니다. 68개 동작 프레임 생성이 모두 끝난 뒤에만 화면의 수동 후처리 버튼을 사용할 수 있습니다.
