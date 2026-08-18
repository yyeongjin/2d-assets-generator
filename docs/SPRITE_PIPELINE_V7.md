# Sprite Pipeline V7 적용과 검증

V7은 V6에서 성공한 Kimodo 공식 fixture 기반 경로와 Motion worker, One-to-All worker, FastAPI의 3서비스 구조를 유지하는 오버레이입니다. 새 프로젝트로 설치하지 않고 기존 `/workspace/sprite-pipeline` 위에 적용합니다.

## 패키지

- 파일: [`sprite_pipeline_fastapi_full_v7.zip`](../sprite_pipeline_fastapi_full_v7.zip)
- SHA-256: `460534a6bbc483ad7ad91dfc0fcacea20e6afdfcb6480b5dd365fa7a95698f81`
- 결정론적 테스트: 14개 통과
- Python compile: 통과
- Shell syntax: 통과
- Manifest SHA-256: 통과
- ZIP integrity: 통과
- Overlay 설치 검사: 통과

이 패키지 환경에서는 실제 L40S One-to-All GPU 렌더를 실행하지 않았습니다. 적용 후 첫 종단 요청에서 control endpoint 중복과 최종 loop QC를 확인해야 합니다.

## V7 변경점

### 1. 닫힌 17-frame control loop

V6의 `np.linspace(cycle_start, cycle_end, 17)` 대신 16개 고유 phase를 생성하고 17번째 control을 첫 번째 control의 정확한 복사로 만듭니다.

```text
control_016 == control_000
frames[16]  == frames[0]
scores[16]  == scores[0]
depth[16]   == depth[0]
```

하나라도 다르면 One-to-All 실행 전 Adapter hard gate에서 실패합니다.

### 2. One-to-All 결과의 위치 흔들림 보정

생성된 17개 이미지에 BODY_18 포즈 검출기를 다시 적용하고, 양쪽 골반 중앙의 X와 가장 낮은 발목의 Y를 cyclic control 위치에 맞춰 평행이동합니다. 캐릭터 크기, 신체 비율, 관절 각도, 팔다리 길이, 몸 회전, 걷기 phase와 상하 bobbing은 바꾸지 않습니다.

원본 렌더와 적용 이동량은 각각 다음 경로에 남습니다.

```text
rendered/attempt_00/<direction>/raw/
rendered/attempt_00/<direction>/render_meta.json
```

### 3. 8-frame 추출 후보 자동 비교

고정 `0,2,4,...14` 추출 대신 다음 세 후보를 비교합니다.

```text
even_start = 0, 2, 4, 6, 8, 10, 12, 14
odd        = 1, 3, 5, 7, 9, 11, 13, 15
even_end   = 16, 2, 4, 6, 8, 10, 12, 14
```

네 방향에는 하나의 공통 후보를 적용해 front, back, left, right의 발 phase를 유지합니다. `even_end`는 0번 이미지가 reference anchor의 영향을 강하게 받을 때 같은 phase인 16번을 대신 사용합니다.

### 4. 마지막 프레임에서 첫 프레임으로 이어지는 구간 검사

V7은 `1→2`부터 `8→1`까지 여덟 연결을 모두 검사합니다. 결과는 다음 두 파일에 저장합니다.

```text
result/loop_qc.json
debug/loop_qc.json
```

### 5. Loop QC 실패 시 One-to-All만 재시도

Kimodo와 Motion Adapter는 다시 실행하지 않습니다. 첫 시도는 사용자 seed를, 두 번째 시도는 `사용자 seed + 100003`을 사용합니다. 두 시도 모두 실패하면 성공 ZIP을 만들지 않고 `LOOP_QC_FAILED`로 끝내며 분석값을 `jobs/<JOB_ID>/loop_qc_failed.json`에 남깁니다.

## V6 환경에 오버레이 적용

기존 세 foreground 서비스만 종료합니다. venv, 저장소, 체크포인트, `.env`와 `jobs/`는 삭제하지 않습니다.

```bash
cd /workspace

rm -rf /tmp/sprite_v7
mkdir -p /tmp/sprite_v7

unzip -q \
  /workspace/sprite_pipeline_fastapi_full_v7.zip \
  -d /tmp/sprite_v7

cd /tmp/sprite_v7/sprite_pipeline_fastapi_full_v7

./scripts/install_v7_overlay.sh \
  /workspace/sprite-pipeline
```

오버레이는 `workers/`, `adapter/`, `server/app/`, `client/`, `scripts/`, `tests/`, `VERSION`, `CHANGES_v7.md`, `.env.v7.example`을 갱신합니다. 기존 Kimodo·One-to-All·서버 venv, 체크포인트, pretrained model, `.env`, `jobs/`는 유지합니다. `PYTHONPATH=/workspace/sprite-pipeline`는 사용하지 않습니다.

## 코드와 공식 fixture 검사

```bash
cd /workspace/sprite-pipeline

server/.venv/bin/python \
  -m unittest discover \
  -s tests \
  -p 'test_*.py' \
  -v
```

정상 결과는 `Ran 14 tests`와 `OK`입니다.

```bash
cd /workspace/sprite-pipeline

PYTHON_BIN=/workspace/sprite-pipeline/server/.venv/bin/python \
./scripts/check_official_walk.sh
```

검사 결과는 `/tmp/sprite-v7-official-check/`에 생성됩니다. 다음 항목을 확인합니다.

```text
adapter_version: 7.0.0
unique_cycle_frames: 16
control_endpoint_duplicates_phase_zero: true
front control endpoint error: 0
back control endpoint error: 0
left control endpoint error: 0
right control endpoint error: 0
```

## 세 서비스 실행

### 세션 1 — Motion worker `:9101`

```bash
cd /workspace/sprite-pipeline/kimodo

export KIMODO_MOTION_SOURCE=official_example
export KIMODO_OFFICIAL_WALK_MOTION=/workspace/sprite-pipeline/kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path/motion.npz

PYTHONUNBUFFERED=1 \
.venv/bin/python \
../workers/kimodo_worker.py
```

`curl http://127.0.0.1:9101/health` 응답에서 `worker_version=7.0.0`, `motion_source=official_example`을 확인합니다.

### 세션 2 — One-to-All worker `:9102`

```bash
cd /workspace/sprite-pipeline/one-to-all

export OTA_CHECKPOINT_DIR=/workspace/sprite-pipeline/one-to-all/checkpoints/One-to-All-1.3b_2
export OTA_STABILIZE_RENDERED_FRAMES=true
export OTA_STABILIZE_MAX_SHIFT_RATIO=0.08
export OTA_STABILIZE_SMOOTHING=0.35
export OTA_STABILIZE_MIN_VALID_FRACTION=0.60

PYTHONUNBUFFERED=1 \
.venv/bin/python \
../workers/ota_worker.py
```

`curl http://127.0.0.1:9102/health` 응답에서 `worker_version=7.0.0`을 확인합니다.

### 세션 3 — FastAPI `:8000`

```bash
cd /workspace/sprite-pipeline/server

export API_TOKEN='<기존_ASCII_인증_토큰>'

export SPRITE_CANONICAL_HEADING_TOLERANCE_DEG=1.0
export SPRITE_FRONT_BACK_TORSO_YAW_LIMIT_DEG=2.5
export SPRITE_FRONT_BACK_HEAD_YAW_LIMIT_DEG=5.0
export SPRITE_BODY18_SHOULDER_BLEND=0.35

export OTA_FRONT_BACK_IMAGE_GUIDANCE_SCALE=2.5
export OTA_FRONT_BACK_POSE_GUIDANCE_SCALE=1.5
export OTA_SIDE_IMAGE_GUIDANCE_SCALE=2.5
export OTA_SIDE_POSE_GUIDANCE_SCALE=1.5

export OTA_LOOP_MAX_ATTEMPTS=2
export OTA_LOOP_SEED_STRIDE=100003
export SPRITE_LOOP_QC_STRICT=true
export SPRITE_LOOP_MAX_SEAM_RATIO=1.65
export SPRITE_LOOP_MAX_MEAN_SEAM_RATIO=1.40
export SPRITE_LOOP_MAX_TRANSITION_RATIO=2.25

PYTHONUNBUFFERED=1 \
KIMODO_WORKER_URL=http://127.0.0.1:9101 \
OTA_WORKER_URL=http://127.0.0.1:9102 \
.venv/bin/python \
-m uvicorn \
app.main:app \
--host 0.0.0.0 \
--port 8000 \
--workers 1
```

`curl http://127.0.0.1:8000/health` 응답에서 세 서비스 버전이 모두 `7.0.0`인지 확인합니다.

## 생성 결과 확인

외부 client 요청 형식은 V6와 같습니다. 완료된 작업에서 다음 파일을 확인합니다.

```bash
JOB_ID='<실제_JOB_ID>'

cat \
  "/workspace/sprite-pipeline/jobs/${JOB_ID}/result/loop_qc.json"
```

우선 확인할 필드는 다음과 같습니다.

```text
ok: true
selected_candidate
selected_phase_indices
selected_attempt
selected_render_seed
selected_metrics.directions.front.seam_ratio
selected_metrics.directions.back.seam_ratio
selected_metrics.directions.left.seam_ratio
selected_metrics.directions.right.seam_ratio
```

최종 ZIP에는 `debug/loop_qc.json`과 네 방향의 `debug/<direction>/render_meta.json`이 추가됩니다. 첫 두 시도가 모두 실패하면 `OTA_LOOP_MAX_ATTEMPTS=3`으로 올린 뒤 FastAPI만 재시작할 수 있지만 strict loop QC는 유지합니다.

## 첫 실제 GPU 종단 테스트의 판정 조건

1. `control_016`과 `control_000`이 정확히 같아야 합니다.
2. 최종 `loop_qc.json`의 `ok`가 `true`여야 합니다.
3. 원본 캐릭터와 비교해 얼굴, 액세서리, 의상, 체형이 유지되는지는 V6 기록과 동일하게 별도 시각 검수해야 합니다.
