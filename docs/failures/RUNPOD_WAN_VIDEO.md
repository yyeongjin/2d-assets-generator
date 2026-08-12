# 기각 기록 — RunPod Wan2.2 걷기 영상 실험

이 방식은 2D 스프라이트 제작 경로에서 기각했습니다. 아래 실행 명령과 설정은 재사용 가이드가 아니라 2026-08-06까지 수행한 실험을 재현하기 위한 기록입니다.

## 기각 이유

- 한 장의 기준 이미지에서 5초 영상을 만들면 얼굴, 의상, 신체 비율과 크기가 프레임마다 변했습니다.
- 흰 배경에 검은 원형·문자·색 번짐 같은 장면 요소가 생겨 캐릭터 프레임으로 사용할 수 없었습니다.
- `in place`가 장소로, `cycle`이 원형 물체로 해석되는 등 짧은 동작 prompt도 영상 장면으로 잘못 확장됐습니다.
- 81개 원본 프레임에서 40장을 추출해도 대부분 정지·중복이거나 배경이 깨졌습니다. 마지막 정면 실험은 정상 배경 5장, 서로 다른 후보 3장만 남았고 달리기 자세도 충분하지 않았습니다.
- 한 방향의 우연한 성공을 네 방향과 다른 캐릭터·생명체에서 재현하지 못했습니다.
- 방향마다 긴 영상 job을 실행하는 비용과 시간이 실제로 얻는 스프라이트 프레임 수에 비해 큽니다.

다음 제작 경로는 승인된 4방향 이미지를 분리한 뒤, 같은 동작을 네 개의 이미지 시트 요청으로 batch 실행하는 방식입니다. 출력 시트의 동일 셀 비율로 프레임 경계를 계산하고, 각 셀의 흰 여백을 자동 크롭한 뒤 공통 발 기준선과 캔버스 비율에 패딩 정렬합니다. 프레임 수는 고정하지 않습니다.

---

## 실험 환경

현재 실험 환경은 다음과 같습니다.

| 항목 | 설정 |
|---|---|
| GPU | NVIDIA L40S |
| VRAM | 48GB |
| 디스크 볼륨 | 50GB |
| 모델 | `Wan-AI/Wan2.2-TI2V-5B-Diffusers` |
| 사용 기능 | Image-to-Video |
| HTTP 포트 | `8000` |

50GB 볼륨에서는 약 34GB인 모델과 Hugging Face 캐시, 생성 영상을 함께 보관하므로 여유 공간이 크지 않습니다. 반복 테스트 중에는 `/data/video-output`을 확인하고 필요 없는 영상만 수동으로 정리합니다.

`HF_TOKEN`은 Hugging Face 인증에만 사용됩니다. 환경변수가 등록돼 있어도 모델 파일이 생기는 것은 아니므로 `hf download`를 별도로 실행해야 합니다. 토큰은 명령, 문서, 저장소에 직접 기록하지 않습니다.

## 1. 시스템 도구 설치

```bash
apt-get update
apt-get install -y \
  git curl jq \
  build-essential

curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
```

## 2. Python 3.12와 vLLM-Omni 설치

vLLM-Omni 공식 Quickstart의 CUDA 설치 조합인 Python 3.12와 `vllm==0.26.0`을 사용합니다.

```bash
mkdir -p ~/wan-video-server
cd ~/wan-video-server

uv venv --python 3.12 --seed
source .venv/bin/activate

uv pip install vllm==0.26.0 --torch-backend=auto

git clone https://github.com/vllm-project/vllm-omni.git
cd vllm-omni
uv pip install -e .

uv pip install "huggingface_hub[hf_xet]"
```

설치 확인:

```bash
python --version
vllm --version
python -c "import vllm_omni; print('VLLM OMNI READY')"
```

vLLM과 vLLM-Omni의 major/minor 버전이 맞지 않으면 `--omni`가 정상 동작하지 않을 수 있습니다.

## 3. Wan2.2 모델 다운로드

`/data`가 RunPod Network Volume 또는 영구 볼륨에 연결되어 있는지 먼저 확인합니다.

```bash
mkdir -p \
  /data/models \
  /data/huggingface-cache \
  /data/video-output

export HF_HOME=/data/huggingface-cache
export HF_HUB_DOWNLOAD_TIMEOUT=120

hf download \
  Wan-AI/Wan2.2-TI2V-5B-Diffusers \
  --local-dir /data/models/Wan2.2-TI2V-5B-Diffusers
```

RunPod Secret이나 터미널 환경에 `HF_TOKEN`이 등록되어 있으면 `hf`가 인증에 사용합니다. 인증 상태만 확인하려면 다음 명령을 실행합니다.

```bash
hf auth whoami
```

다운로드 확인:

```bash
du -sh /data/models/Wan2.2-TI2V-5B-Diffusers

test -f /data/models/Wan2.2-TI2V-5B-Diffusers/model_index.json \
  && echo "MODEL READY"
```

## 4. vLLM-Omni 비디오 서버 실행

```bash
source ~/wan-video-server/.venv/bin/activate

export CUDA_VISIBLE_DEVICES=0
export HF_HOME=/data/huggingface-cache
export VLLM_OMNI_SERVER_STORAGE__PATH=/data/video-output

vllm serve /data/models/Wan2.2-TI2V-5B-Diffusers \
  --omni \
  --host 0.0.0.0 \
  --port 8000
```

`VLLM_OMNI_SERVER_STORAGE__PATH`는 비동기 `/v1/videos` 결과 저장 경로입니다. 예전 이름인 `VLLM_OMNI_STORAGE_PATH`는 deprecated 상태이므로 사용하지 않습니다.

터미널은 모델 로딩과 생성 로그를 볼 수 있도록 계속 열어 둡니다. RunPod에서는 HTTP 포트 `8000`을 노출합니다.

## 5. 연결 확인

실제 endpoint는 저장소에 기록하지 않습니다.

```bash
VIDEO_BASE_URL="https://your-video-runpod-proxy.example.com"

curl -sS "$VIDEO_BASE_URL/health"
curl -sS "$VIDEO_BASE_URL/v1/models" | jq .
```

`/v1/models`에 `/data/models/Wan2.2-TI2V-5B-Diffusers`가 표시되면 모델 탐색이 완료된 것입니다.

## 6. 4방향 제자리 걷기 생성 방식

캐릭터와 생명체는 동일한 순서의 `2×2` 기준 시트를 사용합니다.

| 셀 | 방향 | 걷기 요청 |
|---:|---|---|
| 왼쪽 위 | 정면 | 화면 쪽으로 다가오지 않는 정면 제자리 걷기 |
| 오른쪽 위 | 후면 | 화면 안쪽으로 멀어지지 않는 후면 제자리 걷기 |
| 왼쪽 아래 | 오른쪽 | 옆으로 이동하지 않는 오른쪽 제자리 걷기 |
| 오른쪽 아래 | 왼쪽 | 옆으로 이동하지 않는 왼쪽 제자리 걷기 |

로컬 도구는 시트 중심을 기준으로 4등분하고 한 방향씩 순차 요청합니다. 각 요청에는 한 방향 셀만 `input_reference`로 전송합니다.

```bash
VIDEO_BASE_URL="https://your-video-runpod-proxy.example.com"
INPUT_IMAGE="/data/input/character-front.png"

create_response=$(curl -sS "$VIDEO_BASE_URL/v1/videos" \
  -F "prompt=Smooth walk cycle in place, front-view, full body, clear alternating steps, no head tilting, no camera movement. Keep the same character and white background." \
  -F "negative_prompt=low quality, blurry, static, dancing, pointing, turning, changing character" \
  -F "input_reference=@${INPUT_IMAGE};type=image/png" \
  -F "width=480" \
  -F "height=832" \
  -F "num_frames=81" \
  -F "fps=16" \
  -F "num_inference_steps=50" \
  -F "guidance_scale=4.0" \
  -F "flow_shift=12.0" \
  -F "seed=4821")

echo "$create_response" | jq .
video_id=$(echo "$create_response" | jq -r '.id')
```

프롬프트에는 제자리 걷기, 방향, 좌우 다리 교대, 외형 유지, 고정 카메라만 짧게 적습니다. 첫 검사는 한 방향만 생성하고, 실제 보행이 확인된 뒤 네 방향을 순차 생성합니다. 픽셀화나 스프라이트 후처리는 모델에 요청하지 않습니다.

`flow_shift=12.0`은 vLLM-Omni의 `Wan2.2-TI2V-5B-Diffusers` 480p I2V 예시에 맞춘 값입니다. 로컬 실험에서는 `33~49 frames`와 flow shift 미지정 조합이 거의 정지한 영상으로 수렴했고, `81 frames`, `50 steps`, `guidance 4`, `flow_shift 12` 조합에서 오른쪽 측면 좌우 발 교대가 확인됐습니다. 이것은 현재 endpoint의 실험 결과이며 다른 방향과 입력에서 동일한 결과를 보장하지 않습니다.

## 7. 상태 확인과 영상 다운로드

```bash
while true; do
  status=$(curl -sS "$VIDEO_BASE_URL/v1/videos/$video_id" | jq -r '.status')
  echo "VIDEO STATUS: $status"

  case "$status" in
    completed) break ;;
    failed|cancelled|expired) exit 1 ;;
  esac

  sleep 3
done

curl -fL \
  "$VIDEO_BASE_URL/v1/videos/$video_id/content" \
  -o /data/video-output/walk-front.mp4

ls -lh /data/video-output/walk-front.mp4
```

`POST /v1/videos`는 job ID를 반환합니다. 완료된 뒤 `/v1/videos/{id}/content`에서 MP4를 받습니다.

## 8. 로컬 도구 연결

`tools_test/.env.local`에 이미지 endpoint와 분리된 비디오 endpoint를 설정합니다.

```dotenv
RUNPOD_VIDEO_BASE_URL=https://your-video-runpod-proxy.example.com
RUNPOD_VIDEO_API_KEY=
RUNPOD_VIDEO_MODEL_ID=/data/models/Wan2.2-TI2V-5B-Diffusers
RUNPOD_VIDEO_REQUEST_TIMEOUT_MS=1200000
RUNPOD_VIDEO_POLL_INTERVAL_MS=3000
```

로컬 도구는 다음 순서로 처리합니다.

1. 캐릭터 또는 생명체의 4방향 시트를 선택합니다.
2. 시트를 중앙 기준으로 네 셀로 자릅니다.
3. 정면, 후면, 오른쪽, 왼쪽 순서로 I2V job을 하나씩 생성합니다.
4. 각 job 상태를 polling하고 완료된 원본 MP4를 저장합니다.
5. FFmpeg로 시각 변경 없이 프레임만 추출합니다.
6. 방향별 영상과 프레임을 화면에 표시합니다.

이 흐름은 [acatovic/ai-game-studio](https://github.com/acatovic/ai-game-studio)의 `기준 스프라이트 → I2V job polling → 영상 저장 → FFmpeg 프레임 추출 → 프레임 선택` 방식에서 영감을 얻었습니다. 현재 도구에서는 원본 검토가 먼저이므로 자동 크로마키, 배경 제거, 픽셀화, 리사이즈를 적용하지 않습니다.

## 참고 문서

- [vLLM-Omni Quickstart](https://docs.vllm.ai/projects/vllm-omni/en/latest/getting_started/quickstart/)
- [vLLM-Omni Supported Models](https://docs.vllm.ai/projects/vllm-omni/en/latest/models/supported_models/)
- [vLLM-Omni Videos API](https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/videos_api/)
- [vLLM-Omni Image-to-Video example](https://docs.vllm.ai/projects/vllm-omni/en/latest/user_guide/examples/offline_inference/image_to_video/)
- [Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/main/guides/cli)
- [Hugging Face environment variables](https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables)
- [Wan2.2 TI2V-5B Diffusers](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers)
