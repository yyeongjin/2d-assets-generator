# RunPod SCAIL-2 서버와 로컬 클라이언트 실행 가이드

이 가이드는 작업 위치를 두 곳으로 분리한다.

```text
[RunPod On-Demand Pod]
저장소 clone · uv 환경 · SCAIL-2 모델 · FastAPI · GPU 생성
        ▲                                      │
        │ multipart 입력                       │ MP4 다운로드
        │                                      ▼
[로컬 PC]
:3000 디버거 · 입력 선택 · prompt · job polling · 결과 저장 · 프레임 추출
```

S3와 RunPod 웹 UI 수동 파일 업로드는 사용하지 않는다. 로컬 클라이언트가 입력 파일을 endpoint에 직접 전송하고 결과 파일도 endpoint에서 직접 내려받는다.

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

## 4. 로컬에서 API adapter 파일만 RunPod로 전달

FastAPI endpoint에는 다음 세 파일만 필요하다.

```text
runpod/scail2_api/server.py
runpod/scail2_api/runtime.py
runpod/scail2_api/requirements-api.txt
```

로컬 저장소 루트에서 RunPod의 SSH 접속 정보에 맞춰 파일 세 개만 전달한다.

```bash
scp -P RUNPOD_SSH_PORT \
  runpod/scail2_api/server.py \
  runpod/scail2_api/runtime.py \
  runpod/scail2_api/requirements-api.txt \
  root@RUNPOD_SSH_HOST:/workspace/scail2_api/
```

RunPod 터미널에서 확인한다.

```bash
ls -al /workspace/scail2_api
```

이 단계는 로컬 프로젝트 전체를 RunPod에 복제하는 과정이 아니다. GPU endpoint 실행에 필요한 adapter 파일 세 개만 배포한다.

## 5. Python 3.12 환경과 패키지 설치

```bash
cd /workspace/SCAIL-2

uv venv /workspace/scail2-venv \
  --python 3.12 \
  --seed

source /workspace/scail2-venv/bin/activate

uv pip install -r /workspace/SCAIL-2/requirements.txt
uv pip install "huggingface_hub[hf_xet]"
uv pip install -r /workspace/scail2_api/requirements-api.txt
```

별도로 vLLM이나 vLLM-Omni를 설치하지 않는다.

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
export SCAIL_LOAD_ON_START=1

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

## 8. RunPod 서버가 담당하는 일

RunPod에는 사용자가 미리 입력 파일을 올려두지 않는다.

1. `POST /v1/jobs`에서 multipart 입력 4종과 설정을 받는다.
2. 입력을 `/workspace/scail2-data/jobs/JOB_ID/inputs/`에 저장한다.
3. 즉시 `job_id`를 반환한다.
4. 단일 GPU queue가 SCAIL-2를 실행한다.
5. `GET /v1/jobs/JOB_ID`가 상태와 결과 다운로드 URL을 반환한다.
6. `GET /v1/jobs/JOB_ID/output`이 결과 MP4를 클라이언트에 전송한다.

서버 내부 `output_path`는 클라이언트 API 응답에 노출하지 않는다.

# 로컬에서 할 작업

## 9. 로컬 클라이언트 설치

로컬 PC에 저장소가 이미 있으면 다시 clone하지 않고 해당 저장소로 이동한다. 없다면 다음처럼 clone한다.

```bash
git clone \
  https://github.com/yyeongjin/2d-assets-generator.git

cd 2d-assets-generator

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
```

S3 환경변수, bucket, 서버 내부 파일 경로는 사용하지 않는다.

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

브라우저에서 `http://localhost:3000`을 연다. 방향별 reference, mask, driving video와 driving mask를 선택하고 생성 요청을 보내면 브라우저가 multipart로 RunPod에 전달한다. 완료 뒤 화면의 `원본 MP4 다운로드`로 결과를 로컬에 내려받는다.

## 최종 책임 분리

| RunPod | 로컬 PC |
|---|---|
| SCAIL-2 코드·checkpoint 보관 | 캐릭터와 driver 원본 보관 |
| SCAIL-2 pipeline 한 번 로드 | 방향별 입력 선택 |
| multipart 입력 수신 | prompt와 seed 설정 |
| 단일 GPU queue 생성 | job 등록과 상태 확인 |
| 결과 MP4 download endpoint 제공 | 결과 MP4 다운로드 |
| 원본 MP4가 내려받힐 때까지 임시 보관 | 모든 방향 완료 뒤 프레임 추출·후처리 |

RunPod는 결과를 생성하고 전송한다. 로컬은 입력을 보내고 결과를 받아 저장·표시·후처리한다.
