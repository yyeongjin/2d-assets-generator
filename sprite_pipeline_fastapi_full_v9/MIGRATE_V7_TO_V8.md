# 현재 V7 → V8 적용 순서

V8은 overlay입니다. 기존 Kimodo 저장소, One-to-All 저장소, 모델, checkpoint, venv, `.env`, `jobs/`를 삭제하지 않습니다.

## 1. 세 서비스 종료

기존 foreground 세션에서 각각 `Ctrl-C`:

```text
Motion worker :9101
One-to-All    :9102
FastAPI       :8000
```

## 2. V8 overlay 설치

```bash
cd /workspace
rm -rf /tmp/sprite_v8
mkdir -p /tmp/sprite_v8

unzip -q \
  /workspace/sprite_pipeline_fastapi_full_v8.zip \
  -d /tmp/sprite_v8

cd /tmp/sprite_v8/sprite_pipeline_fastapi_full_v8

./scripts/install_v8_overlay.sh \
  /workspace/sprite-pipeline
```

## 3. 코드 검사

```bash
cd /workspace/sprite-pipeline

server/.venv/bin/python \
  -m unittest discover \
  -s tests \
  -p 'test_*.py' \
  -v
```

정상 기준:

```text
Ran 17 tests
OK
```

## 4. 공식 motion control 검사

```bash
cd /workspace/sprite-pipeline

PYTHON_BIN=/workspace/sprite-pipeline/server/.venv/bin/python \
./scripts/check_official_walk.sh
```

결과:

```text
/tmp/sprite-v8-official-check/v8_validation_summary.json
```

확인값:

```text
adapter_version: 8.0.0
unique_frames: 16
control_endpoint_duplicates_phase_zero: true
gait_ok: true
cardinal_ok: true
```

## 5. 서비스 재실행

### Motion worker

```bash
cd /workspace/sprite-pipeline/kimodo
export KIMODO_MOTION_SOURCE=official_example
export KIMODO_OFFICIAL_WALK_MOTION=/workspace/sprite-pipeline/kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path/motion.npz
PYTHONUNBUFFERED=1 .venv/bin/python ../workers/kimodo_worker.py
```

### One-to-All

```bash
cd /workspace/sprite-pipeline/one-to-all
export OTA_CHECKPOINT_DIR=/workspace/sprite-pipeline/one-to-all/checkpoints/One-to-All-1.3b_2
export OTA_STABILIZE_RENDERED_FRAMES=true
export OTA_STABILIZE_MAX_SHIFT_RATIO=0.08
export OTA_STABILIZE_SMOOTHING=0.35
export OTA_STABILIZE_MIN_VALID_FRACTION=0.60
PYTHONUNBUFFERED=1 .venv/bin/python ../workers/ota_worker.py
```

### FastAPI

```bash
cd /workspace/sprite-pipeline/server
export API_TOKEN='<기존 ASCII 토큰>'

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

PYTHONUNBUFFERED=1 \
KIMODO_WORKER_URL=http://127.0.0.1:9101 \
OTA_WORKER_URL=http://127.0.0.1:9102 \
.venv/bin/python \
-m uvicorn app.main:app \
--host 0.0.0.0 \
--port 8000 \
--workers 1
```

세 `/health` 응답의 버전이 모두 `8.0.0`이어야 합니다.

## 6. 첫 종단 결과 검사

기존 V7과 같은 API 요청을 사용합니다. 새 stage:

```text
appearance_attempt_1
loop_qc_attempt_1
```

결과 검사:

```bash
JOB_ID='<job id>'

cat "/workspace/sprite-pipeline/jobs/${JOB_ID}/result/appearance_qc.json"
cat "/workspace/sprite-pipeline/jobs/${JOB_ID}/result/loop_qc.json"
```

필수값:

```text
appearance_qc.json -> ok: true
loop_qc.json       -> ok: true
```

첫 attempt가 실패하면 Kimodo와 Adapter는 다시 실행하지 않고 OTA만 다른 seed로 재시도합니다. 두 번 모두 실패한 캐릭터는 다음처럼 attempt 수만 3으로 올리고 FastAPI를 재시작합니다.

```bash
export OTA_LOOP_MAX_ATTEMPTS=3
```

cardinal 보정, exact closed control, strict QC를 제거하지 않습니다.
