# RunPod SCAIL-2 설치·실행 가이드

이 문서는 아무 파일도 없는 새 RunPod On-Demand Pod에서 이 프로젝트와 `zai-org/SCAIL-2`를 `git clone`하고, 공식 inference를 한 번 실행하는 명령만 정리한다.

S3, 별도 API 서버, 로컬 클라이언트, 미리 업로드된 셸 스크립트를 전제로 하지 않는다. 먼저 이 저장소를 clone하므로 RunPod에는 문서와 프로젝트 코드가 실제로 존재한다. `chmod +x`, `cat << EOF`, 저장소 symlink 명령은 필요 없다.

## 먼저 확인할 사실: vLLM으로 실행하는 모델이 아니다

2026-08-12 기준 SCAIL-2는 vLLM-Omni 공식 지원 모델 목록에 없다. 공식 SCAIL-2 저장소도 `vllm serve`가 아니라 `wan-scail2` 브랜치의 `generate.py`를 실행하도록 안내한다.

따라서 다음 명령은 사용하지 않는다.

```bash
# 지원되지 않는 실행 방식
vllm serve zai-org/SCAIL-2 --omni
```

`uv`는 Python 환경과 패키지를 설치하는 데 사용한다. 모델 실행은 공식 `generate.py`가 담당한다.

- [SCAIL-2 공식 저장소](https://github.com/zai-org/SCAIL-2/tree/wan-scail2)
- [vLLM-Omni 공식 지원 모델 목록](https://docs.vllm.ai/projects/vllm-omni/en/latest/models/supported_models/)

## 1. Pod 설정

첫 실행에서는 다음 정도의 공간을 잡는다.

| 항목 | 설정 |
|---|---|
| Pod | RunPod On-Demand Pod |
| GPU | A100 80GB부터 검증 |
| Container disk 또는 Network Volume | 180~200GB |
| Python | 3.10~3.12 |

Hugging Face 원본 checkpoint와 wan 브랜치용 변환 safetensors가 동시에 필요하므로 80GB 디스크로는 부족하다. Network Volume은 필수가 아니며, Pod를 지워도 모델을 보존하려는 경우에만 사용한다.

## 2. 시스템 도구와 uv 설치

새 Pod 터미널에서 그대로 실행한다.

```bash
apt-get update
apt-get install -y \
  git git-lfs curl ffmpeg \
  build-essential

curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"

git lfs install
```

## 3. 이 프로젝트와 공식 SCAIL-2 코드 받기

```bash
mkdir -p \
  /workspace/models \
  /workspace/huggingface-cache \
  /workspace/scail2-output

cd /workspace

git clone \
  https://github.com/yyeongjin/2d-assets-generator.git \
  /workspace/2d-assets-generator

git clone \
  --branch wan-scail2 \
  --depth 1 \
  https://github.com/zai-org/SCAIL-2.git \
  /workspace/SCAIL-2

cd /workspace/SCAIL-2
git submodule update --init --recursive
```

첫 번째 clone은 이 프로젝트의 문서, 로컬 디버거와 추후 HTTP adapter 코드를 받는다. 두 번째 clone은 실제 모델을 실행하는 공식 SCAIL-2 코드다. `SCAIL-Pose`가 submodule이므로 공식 저장소의 `git submodule update`는 생략하지 않는다.

## 4. Python 3.12 환경 설치

```bash
cd /workspace/SCAIL-2

uv venv /workspace/scail2-venv \
  --python 3.12 \
  --seed

source /workspace/scail2-venv/bin/activate

uv pip install -r requirements.txt
uv pip install "huggingface_hub[hf_xet]"
```

공식 requirements에는 PyTorch, Diffusers, Transformers, Flash Attention과 영상 처리 패키지가 포함되어 있다. 별도로 vLLM이나 vLLM-Omni를 설치하지 않는다.

## 5. 모델 다운로드와 변환

Hugging Face 인증이 필요한 환경에서는 먼저 `hf auth login`을 실행한다. 토큰을 저장소나 명령문에 직접 기록하지 않는다.

```bash
source /workspace/scail2-venv/bin/activate

export HF_HOME=/workspace/huggingface-cache
export HF_HUB_DOWNLOAD_TIMEOUT=120

hf download \
  zai-org/SCAIL-2 \
  --local-dir /workspace/models/SCAIL-2
```

공식 `wan-scail2` 브랜치는 다운로드한 SAT checkpoint를 safetensors로 한 번 변환해야 한다.

```bash
cd /workspace/SCAIL-2

python convert.py \
  --scail-dir /workspace/models/SCAIL-2 \
  --save-path /workspace/models/SCAIL-2.safetensors
```

파일을 확인한다.

```bash
test -f /workspace/models/SCAIL-2/model/1/fsdp2_rank_0000_checkpoint.pt \
  && echo "CHECKPOINT READY"

test -f /workspace/models/SCAIL-2.safetensors \
  && echo "CONVERTED MODEL READY"

du -sh \
  /workspace/models/SCAIL-2 \
  /workspace/models/SCAIL-2.safetensors
```

## 6. 입력 파일 배치

SCAIL-2 Animation Mode 한 번에는 다음 네 파일이 필요하다.

```text
/workspace/scail2-input/front/
├── ref.jpg
├── ref_mask.jpg
├── rendered_v2.mp4
└── rendered_mask_v2.mp4
```

각 파일의 의미는 다음과 같다.

| 파일 | 역할 |
|---|---|
| `ref.jpg` | 해당 방향 캐릭터 기준 이미지 |
| `ref_mask.jpg` | 기준 이미지의 SCAIL mask |
| `rendered_v2.mp4` | 해당 방향의 driving video |
| `rendered_mask_v2.mp4` | driving video와 같은 프레임 수의 SCAIL mask video |

파일은 RunPod 웹 UI의 파일 업로드나 사용자가 선택한 전송 방식으로 `/workspace/scail2-input/front/`에 넣는다. 이 가이드는 S3 사용을 요구하지 않는다.

Mask는 선택 입력이 아니다. 공식 문서상 Animation Mode에서도 올바른 reference mask와 driving mask가 필요하다. 전처리가 필요하면 공식 `SCAIL-Pose` 안내를 따라 별도로 준비한다.

## 7. 먼저 정면 한 방향 직접 실행

서버를 띄우기 전에 공식 CLI로 정면 한 방향이 실제 생성되는지 확인한다.

```bash
source /workspace/scail2-venv/bin/activate
export CUDA_VISIBLE_DEVICES=0

cd /workspace/SCAIL-2

python generate.py \
  --model SCAIL-14B \
  --ckpt_dir /workspace/models/SCAIL-2 \
  --scail_path /workspace/models/SCAIL-2.safetensors \
  --target_w 896 \
  --target_h 512 \
  --image /workspace/scail2-input/front/ref.jpg \
  --mask_image /workspace/scail2-input/front/ref_mask.jpg \
  --pose /workspace/scail2-input/front/rendered_v2.mp4 \
  --mask_video /workspace/scail2-input/front/rendered_mask_v2.mp4 \
  --prompt "A full-body 2D game character performs a seamless in-place walk cycle in a fixed orthographic front view." \
  --save_file /workspace/scail2-output/front.mp4
```

Animation Mode에서는 `--replace_flag`를 넣지 않는다. 공식 기본값은 `False`다.

생성 결과를 확인한다.

```bash
test -f /workspace/scail2-output/front.mp4 \
  && echo "FRONT OUTPUT READY"

ffprobe \
  -v error \
  -show_entries stream=width,height,nb_frames,r_frame_rate \
  -of default=noprint_wrappers=1 \
  /workspace/scail2-output/front.mp4
```

## 8. 나머지 방향 실행

정면 결과에서 캐릭터 정체성, 화면상 크기, baseline과 걷기 동작이 유지된 것을 확인한 뒤 같은 명령의 입력·출력 경로만 바꿔 후면, 오른쪽, 왼쪽을 각각 실행한다.

| 방향 | 입력 폴더 | 출력 파일 |
|---|---|---|
| front | `/workspace/scail2-input/front` | `/workspace/scail2-output/front.mp4` |
| back | `/workspace/scail2-input/back` | `/workspace/scail2-output/back.mp4` |
| right | `/workspace/scail2-input/right` | `/workspace/scail2-output/right.mp4` |
| left | `/workspace/scail2-input/left` | `/workspace/scail2-output/left.mp4` |

네 방향을 한 요청에 넣지 않는다. 한 방향의 한 walk cycle이 SCAIL-2 한 번의 생성 단위다.

## 9. 로컬 `:3000` 연결과 모델 실행은 별개다

위 명령은 SCAIL-2 자체가 정상 동작하는지를 검증하는 공식 CLI 실행이다. `generate.py`는 HTTP endpoint를 열지 않는다.

로컬 디버깅 화면에서 RunPod에 요청하려면 모델 실행이 확인된 뒤 HTTP adapter를 별도로 붙여야 한다. 저장소의 `runpod/scail2_api/`는 그 연결을 실험하기 위한 코드이지 SCAIL-2 설치나 첫 실행에 필요한 공식 구성 요소가 아니다.

RunPod에서 clone된 adapter 코드는 다음 경로에 있다.

```text
/workspace/2d-assets-generator/runpod/scail2_api/
```

정리하면 순서는 다음과 같다.

```text
빈 RunPod Pod
  → 2d-assets-generator git clone
  → uv 환경 설치
  → SCAIL-2 공식 코드·모델 준비
  → generate.py로 정면 한 방향 검증
  → 네 방향 검증
  → 그 다음 로컬 :3000용 HTTP adapter 연결
```

SCAIL-2가 vLLM-Omni에 공식 추가되기 전까지는 `vllm serve` 명령을 가이드에 넣지 않는다.
