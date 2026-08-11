# RunPod SCAIL-2 설치·작업 API 실행 가이드

이 프로젝트의 생성 모델은 `zai-org/SCAIL-2`다. 준비된 캐릭터 4방향 reference와 하나의 master walk에서 렌더한 4방향 RGB driver를 입력해, 방향당 하나의 closed walk video를 생성한다.

```text
4 canonical references
+
one master walk rendered by four locked cameras
        ↓
four independent SCAIL-2 Animation jobs
        ↓
front/back/left/right raw videos
        ↓ local download
same 8 phases from each video
        ↓
4 × 8 = 32 PNG
```

32장을 32번 독립 생성하지 않는다. 네 방향을 하나의 영상으로 생성하지도 않는다. 생성 단위는 `한 방향의 한 walk cycle 전체`다.

## 1. 실행 구조

```text
[로컬 PC]
reference/front|back|left|right
driving/front|back|left|right
        │
        │ RunPod S3-compatible upload
        ▼
[Network Volume /workspace]
        │
        ▼
[On-Demand Pod]
SCAIL-2 14B 한 번 로드
FastAPI :8000
단일 GPU worker queue
        │
        ▼
raw front/back/left/right mp4
        │
        │ S3-compatible download
        ▼
[로컬 클라이언트]
ffmpeg로 8 phase 추출
```

입력 video나 결과 video를 API JSON의 base64로 보내지 않는다. Network Volume은 Pod에서 `/workspace`로 보이며 로컬에서는 RunPod S3-compatible API로 접근한다.

## 2. Pod와 저장 공간

첫 검증 환경은 다음처럼 잡는다.

| 항목 | 설정 |
|---|---|
| GPU | A100 PCIe 80GB 권장 시작점 |
| Pod | RunPod On-Demand Pod |
| Network Volume | 약 180~200GB |
| HTTP port | `8000` |
| Python | 3.10~3.12 |

SCAIL-2 저장소는 약 81GB이고 wan branch 실행용 변환 safetensors도 별도로 생성한다. 원본·변환본·입출력을 같이 둘 공간을 고려한 첫 검증값이며 공식 최소 사양을 뜻하지 않는다.

## 3. 저장소와 API 배치

```bash
cd /workspace
git clone https://github.com/yyeongjin/2d-assets-generator.git

ln -sfn \
  /workspace/2d-assets-generator/runpod/scail2_api \
  /workspace/scail2-api
```

저장소를 다른 경로에 받았다면 symlink의 첫 번째 경로만 바꾼다.

## 4. SCAIL-2 설치와 모델 변환

```bash
cd /workspace/scail2-api
chmod +x prepare_runpod.sh start.sh
./prepare_runpod.sh
```

스크립트는 다음을 수행한다.

1. `git`, `git-lfs`, `curl`, `ffmpeg`, build tools 설치
2. Python 3.12 가상환경 생성
3. 공식 `wan-scail2` branch clone과 submodule 초기화
4. 공식 requirements와 FastAPI requirements 설치
5. `zai-org/SCAIL-2` 다운로드
6. 공식 `convert.py`로 wan safetensors 생성

핵심 공식 명령은 다음과 같다.

```bash
git clone --branch wan-scail2 \
  https://github.com/zai-org/SCAIL-2.git \
  /workspace/SCAIL-2

cd /workspace/SCAIL-2
git submodule update --init --recursive

hf download zai-org/SCAIL-2 \
  --local-dir /workspace/models/SCAIL-2

python convert.py \
  --scail-dir /workspace/models/SCAIL-2 \
  --save-path /workspace/models/SCAIL-2.safetensors
```

확인:

```bash
test -d /workspace/SCAIL-2 && echo "REPO READY"
test -d /workspace/models/SCAIL-2 && echo "CHECKPOINT READY"
test -f /workspace/models/SCAIL-2.safetensors && echo "CONVERTED MODEL READY"
```

## 5. Canonical reference 4방향

캐릭터별로 다음 파일을 준비한다.

```text
references/CHARACTER_ID/
├── front/ref.jpg, ref_mask.jpg
├── back/ref.jpg, ref_mask.jpg
├── left/ref.jpg, ref_mask.jpg
└── right/ref.jpg, ref_mask.jpg
```

각 reference는 다음 조건을 공유한다.

- standing neutral pose
- 같은 canvas
- 같은 화면상 캐릭터 scale
- 같은 ground baseline
- 같은 조명과 색
- full body

정면 한 장에서 뒤·좌·우를 추론하지 않는다. 각 SCAIL job에는 해당 방향 reference 한 장만 main reference로 사용한다. 처음부터 experimental multi-reference로 네 장을 동시에 넣지 않는다.

## 6. Master walk와 4방향 RGB driver

걷기는 방향마다 따로 설계하지 않는다.

```text
one rig + one exact walk animation
        ├── front locked camera
        ├── back locked camera
        ├── left locked camera
        └── right locked camera
```

SCAIL-2에 skeleton을 넣는 것이 아니다. 네 camera에서 렌더한 RGB video를 넣는다.

Driver 조건:

- 17-frame closed cycle
- 16fps
- frame 16은 frame 0과 같은 다음 cycle 시작 pose
- root translation 없음
- character 화면 위치·scale 고정
- camera·zoom 고정
- pelvis 상하, 팔·다리 swing, heel/toe 상태는 RGB에서 명확히 표시

최종 sprite는 각 결과 video에서 다음 frame만 가져온다.

```text
0, 2, 4, 6, 8, 10, 12, 14
```

Frame 16은 PNG로 사용하지 않고 loop closure 검증에 사용한다. `17→8`은 이 프로젝트 규격이며 SCAIL-2 공식 필수 규격이 아니다.

## 7. SCAIL-Pose 전처리

방향별 SCAIL job은 다음 네 파일만 읽는다.

| 파일 | 역할 |
|---|---|
| `ref.jpg` | 해당 방향 canonical reference |
| `ref_mask.jpg` | reference mask |
| `rendered_v2.mp4` | 17-frame RGB driver |
| `rendered_mask_v2.mp4` | driver mask video |

Mask는 generation endpoint가 매 요청마다 만들지 않는다. Asset 준비 단계에서 공식 SCAIL-Pose 전처리를 실행하고 결과를 재사용한다. 캐릭터 reference가 바뀌면 reference mask는 새로 준비한다.

```bash
source /workspace/scail2-server/.venv/bin/activate
cd /workspace/SCAIL-2/SCAIL-Pose

# SCAIL-Pose README의 detector·pose·SAM3 checkpoint 설치를 먼저 완료한다.
python NLFPoseExtract/process_animation_aio.py \
  --subdir /workspace/scail2-data/PREPROCESS_INPUT \
  --e2e_mode
```

Mask RGB 의미를 임의로 추측해 직접 그리지 않는다. 잘못된 mask는 Animation Mode를 replacement-like 결과로 무너뜨릴 수 있다.

## 8. FastAPI 서버 실행

```bash
source /workspace/scail2-server/.venv/bin/activate
cd /workspace/scail2-api

export CUDA_VISIBLE_DEVICES=0
export SCAIL_API_TOKEN='replace-with-a-long-random-token'
export SCAIL_DATA_ROOT=/workspace/scail2-data

./start.sh
```

서버는 다음 원칙으로 동작한다.

- `uvicorn --workers 1`
- SCAIL-2 pipeline을 프로세스 시작 뒤 한 번만 로드
- 여러 job을 받아도 GPU에서는 한 작업씩 실행
- `POST /v1/jobs`는 즉시 `job_id` 반환
- `GET /v1/jobs/{job_id}`로 상태 polling
- Pod는 raw MP4까지만 생성

RunPod에서 HTTP port `8000`을 노출한다.

```text
https://POD_ID-8000.proxy.runpod.net
```

Pod HTTP proxy에는 긴 연결 제한이 있으므로 생성이 끝날 때까지 한 요청을 붙잡지 않는다.

## 9. API 확인

```bash
export SCAIL_BASE_URL=https://POD_ID-8000.proxy.runpod.net

curl -sS "$SCAIL_BASE_URL/health" | jq
```

한 방향 작업 등록:

```bash
curl -sS \
  -H "Authorization: Bearer $SCAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$SCAIL_BASE_URL/v1/jobs" \
  -d '{
    "direction": "front",
    "prompt": "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic front view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
    "reference_image": "references/character-001/front/ref.jpg",
    "reference_mask": "references/character-001/front/ref_mask.jpg",
    "driving_video": "drivers/master-walk-17f/front/rendered_v2.mp4",
    "driving_mask": "drivers/master-walk-17f/front/rendered_mask_v2.mp4",
    "target_width": 896,
    "target_height": 512,
    "sample_steps": 40,
    "sample_shift": 3.0,
    "sample_guide_scale": 5.0,
    "sample_solver": "unipc",
    "seed": 4821
  }' | jq
```

상태 조회:

```bash
curl -sS \
  -H "Authorization: Bearer $SCAIL_API_TOKEN" \
  "$SCAIL_BASE_URL/v1/jobs/JOB_ID" | jq
```

Prompt는 편집 명령이 아니라 생성될 영상의 description이다. 걷기 phase, heel rise, toe-off는 prompt가 아니라 RGB driver에서 결정한다.

## 10. 로컬 S3 클라이언트

로컬 클라이언트는 다음을 순서대로 수행한다.

1. 준비된 reference·mask·driver·driver mask를 Network Volume에 업로드
2. 방향별 job 등록과 polling
3. 완료된 raw video 다운로드
4. ffmpeg로 동일 phase 8 PNG 추출

설치:

```bash
python3 -m venv .venv-scail-client
source .venv-scail-client/bin/activate
pip install -r runpod/scail2_client/requirements.txt
```

환경변수:

```bash
export SCAIL2_BASE_URL=https://POD_ID-8000.proxy.runpod.net
export SCAIL2_API_TOKEN='same-api-token'

export RUNPOD_S3_ENDPOINT='RunPod console의 S3 endpoint'
export RUNPOD_S3_ACCESS_KEY='S3 access key'
export RUNPOD_S3_SECRET_KEY='S3 secret key'
export RUNPOD_S3_BUCKET='Network Volume ID'
export RUNPOD_VOLUME_PREFIX='scail2-data'
```

먼저 정면 한 방향만 검증한다.

```bash
python runpod/scail2_client/client.py \
  runpod/scail2_client/example-manifest.json \
  --views front
```

통과한 설정만 나머지 방향에 적용한다. `example-manifest.json`에 네 방향을 모두 채운 뒤:

```bash
python runpod/scail2_client/client.py manifest.json
```

## 11. 로컬 3000 작업 보드

```bash
cd tools_test
cp .env.example .env.local
```

```dotenv
SCAIL2_BASE_URL=https://POD_ID-8000.proxy.runpod.net
SCAIL2_API_TOKEN=same-api-token
SCAIL2_REQUEST_TIMEOUT_MS=20000
```

```bash
npm install
npm run dev
```

`http://localhost:3000` 화면은 모델 입력을 생성하지 않는다. 다음만 담당한다.

1. 캐릭터 ID와 Network Volume 상대 경로 관리
2. 방향별 prepared input 4종 확인
3. 방향별 positive description 편집
4. Pod health·queue 상태 확인
5. 한 방향 또는 네 방향 job 등록
6. raw video 경로와 runtime 기록
7. 로컬 8-phase 추출 대상 표시

환경변수와 S3 secret은 코드에 기록하지 않는다.

## 12. 공식 자료

- [SCAIL-2 공식 저장소](https://github.com/zai-org/SCAIL-2)
- [SCAIL-2 Hugging Face](https://huggingface.co/zai-org/SCAIL-2)
- [SCAIL-Pose](https://github.com/zai-org/SCAIL-Pose)
- [RunPod HTTP port](https://docs.runpod.io/pods/configuration/expose-ports)
- [RunPod Network Volume](https://docs.runpod.io/storage/network-volumes)
- [RunPod S3-compatible API](https://docs.runpod.io/storage/s3-api)
