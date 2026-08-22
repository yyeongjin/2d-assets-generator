# V9 RunPod Kimodo + One-to-All 실행 가이드

> **상태: V9 스테이징 후보.** 사람 경로는 실제 캐릭터 종단 검증을 거친 V8 경로를 그대로 보존한다. 동물 경로는 사람용 Kimodo·ViTPose/DWPose 전처리를 우회하고 독립된 motion 공급자와 QC를 사용한다. 코드·오프라인 재현·API 계약은 검증했지만, 갱신된 프론트 잠금 파일의 clean production build와 새 V9 동물 경로의 실제 L40S + One-to-All 생성 결과는 아직 프로덕션 승인 전이다.

## 1. V9가 해결하는 문제

V8은 사람과 사람형 캐릭터에서 정상적으로 작동한다. 문제는 모든 요청이 사람용 motion과 BODY_18 정렬을 전제로 했다는 점이다. 돼지·개·소 같은 사족동물과 공룡·조류형 이족동물이 같은 경로를 타면 직립 인간형 변형, 다리 수 붕괴, 개체 복제와 몸통 분리가 발생했다.

V9는 사람 경로를 수정하는 버전이 아니다. 요청을 시작할 때 대상을 분류하고 motion 공급자를 선택한다.

| 대상 | `subject_profile` | 허용 `motion_backend` | 실제 경로 |
|---|---|---|---|
| 사람·사람형 캐릭터 | `character` | `auto`, `kimodo` | **V8 Kimodo → V8 adapter → One-to-All** |
| 개·고양이·소·돼지 등 | `quadruped` | `auto`, `animal_procedural`, `animal_npz` | 동물 motion → 동물 adapter → One-to-All |
| 공룡·새·비인간 이족 생물 | `biped_animal` | `auto`, `animal_procedural`, `animal_npz` | 동물 motion → 동물 adapter → One-to-All |
| 자동 판정 | `auto` | `auto` 권장 | 이미지·prompt 분류 후 위 경로 중 하나 |

동물에 `kimodo`를 지정하면 요청 단계에서 거부한다. 사람에 동물 NPZ를 첨부해도 거부한다. `subject_profile=auto` 요청에 profile metadata가 든 동물 NPZ가 첨부되면 NPZ 선언을 명시적 provider hint로 사용한다. 이 경계 때문에 동물 기능을 추가하거나 교체해도 V8 사람 파이프라인에 회귀를 만들지 않는다.

## 2. 전체 구조

```text
외부 Client / 로컬 :3000
front.png / back.png / left.png / right.png
subject_profile / motion_backend / optional motion_npz
        │
        ▼
FastAPI :8000
        │
        ├─ character + kimodo
        │      └─ Kimodo worker :9101
        │          └─ V8 human motion adapter
        │
        ├─ quadruped|biped_animal + animal_procedural
        │      └─ V9 profile-specific closed control cycle
        │
        └─ quadruped|biped_animal + animal_npz
               └─ independent animal-motion-v1 NPZ
                         │
                         ▼
                 One-to-All worker :9102
                         │
                         ▼
       character QC 또는 animal identity/topology QC
                         │
                         ▼
                     result.zip
```

## RunPod에서 할 작업

- `github.com/nv-tlabs/kimodo`와 `github.com/ssj9596/One-to-All-Animation` 설치
- `Kimodo-SOMA-RP-v1.1`, `One-to-All-1.3b_2` checkpoint 준비
- V9 overlay를 `/workspace/sprite-pipeline`에 설치
- One-to-All worker `:9102`와 FastAPI `:8000` 실행
- 사람 요청을 사용할 때만 Kimodo worker `:9101` 실행
- 동물 NPZ를 업로드하면 queue 진입 전에 schema·profile·크기·좌표 범위를 검증
- 실패 작업은 `/v1/jobs/<JOB_ID>/debug`의 `failure_debug.zip`으로 보존

## 로컬 `:3000`에서 할 작업

- 네 방향 이미지를 선택하거나 `2×2` 시트를 분할
- `subject_profile`과 `motion_backend` 선택
- 외부 동물 motion을 쓸 때 `animal-motion-v1` NPZ 첨부
- 작업 상태 polling 및 `result.zip` 다운로드
- 완료·실패 작업의 RunPod 임시 디렉터리 삭제

RunPod endpoint와 bearer token은 환경변수로만 설정하며 저장소에 기록하지 않는다.

## 3. 권장 RunPod 사양

```text
GPU       NVIDIA L40S 48GB
RAM       64GB+
Disk      200GB 권장
HTTP Port 8000
```

One-to-All이 항상 필요한 GPU renderer다. `KIMODO_MOTION_SOURCE=official_example`을 쓰는 안정적 사람 경로에서는 Kimodo diffusion 모델을 VRAM에 올리지 않음으로써 One-to-All에 VRAM을 집중할 수 있다. 새 Kimodo motion 생성 모드를 쓸 때만 별도 자원 계획이 필요하다.

## 4. V9 설치

```bash
cd /workspace
unzip -q sprite_pipeline_fastapi_full_v9.zip -d /tmp/sprite-v9
cd /tmp/sprite-v9/sprite_pipeline_fastapi_full_v9
./scripts/install_v9_overlay.sh /workspace/sprite-pipeline
```

기존 `.env`, model repository, checkpoint, virtualenv와 job 데이터는 덮어쓰지 않는다.

서버 의존성:

```bash
cd /workspace/sprite-pipeline
server/.venv/bin/pip install -r server/requirements.txt
```

전체 테스트를 같은 환경에서 재현하려면:

```bash
server/.venv/bin/pip install -r requirements-test.txt
server/.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
server/.venv/bin/python -m compileall -q adapter server/app workers tests client scripts
bash -n scripts/*.sh client/*.sh
```

`torch`는 One-to-All 환경에 이미 설치되어 있으면 다시 설치하지 않아도 된다. `requirements-test.txt`는 깨끗한 CPU 테스트 환경에서 누락되기 쉬운 `torch`와 `imageio`를 명시한다.

## 5. 환경변수

```dotenv
API_TOKEN=replace-with-a-long-random-token
ALLOW_UNAUTHENTICATED_API=false
SPRITE_PIPELINE_ROOT=/workspace/sprite-pipeline
SPRITE_JOBS_ROOT=/workspace/sprite-pipeline/jobs
SPRITE_WORKER_READ_TIMEOUT_SECONDS=1800
SPRITE_ANIMAL_MOTION_NPZ_MAX_BYTES=67108864
SPRITE_ANIMAL_MOTION_NPZ_MAX_UNCOMPRESSED_BYTES=268435456
SPRITE_ANIMAL_MOTION_NPZ_MAX_MEMBERS=64

KIMODO_WORKER_URL=http://127.0.0.1:9101
OTA_WORKER_URL=http://127.0.0.1:9102
KIMODO_MODEL=Kimodo-SOMA-RP-v1.1
KIMODO_MOTION_SOURCE=official_example
```

외부 공개 서버에서 `ALLOW_UNAUTHENTICATED_API=true`를 사용하지 않는다. `API_TOKEN`이 없으면 API는 fail-closed로 503을 반환한다.

## 6. 서비스 실행

### 전체 서비스 launcher

```bash
cd /workspace/sprite-pipeline
./scripts/start_all.sh
```

launcher는 `.env`를 읽고 Kimodo, One-to-All, FastAPI를 백그라운드로 시작하며 PID와 로그를 각각 `run/`, `logs/`에 기록한다. 동물 전용 Pod에서는 Kimodo를 올리지 않아도 된다.

```bash
START_KIMODO=false ./scripts/start_all.sh
./scripts/status.sh
./scripts/stop_all.sh
```

장기 운영에서는 같은 명령을 systemd/supervisor 정책으로 감싸도 된다. 최종적으로 다음 health가 필요하다.

```text
One-to-All :9102  ready   모든 작업에 필요
Kimodo     :9101  ready   character 작업에만 필요
FastAPI    :8000  ready/degraded
```

`/health`의 `character_ready`와 `animal_ready`는 별도로 계산한다. Kimodo가 내려가도 One-to-All이 준비되어 있으면 동물 작업은 받을 수 있다.

## 7. API 요청

### 7.1 사람·캐릭터: V8 경로 유지

```bash
curl --fail-with-body -X POST "${BASE_URL}/v1/jobs" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F "front=@front.png" \
  -F "back=@back.png" \
  -F "left=@left.png" \
  -F "right=@right.png" \
  -F "subject_profile=character" \
  -F "motion_backend=kimodo" \
  -F "prompt=A person walks naturally in place." \
  -F "seed=42"
```

### 7.2 사족동물: 내장 안전 cycle

```bash
curl --fail-with-body -X POST "${BASE_URL}/v1/jobs" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F "front=@front.png" \
  -F "back=@back.png" \
  -F "left=@left.png" \
  -F "right=@right.png" \
  -F "subject_profile=quadruped" \
  -F "motion_backend=animal_procedural" \
  -F "prompt=The same dog walks naturally in place on four legs." \
  -F "seed=42"
```

### 7.3 사족동물: 독립 NPZ

```bash
curl --fail-with-body -X POST "${BASE_URL}/v1/jobs" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F "front=@front.png" \
  -F "back=@back.png" \
  -F "left=@left.png" \
  -F "right=@right.png" \
  -F "subject_profile=quadruped" \
  -F "motion_backend=animal_npz" \
  -F "motion_npz=@dog_walk_animal_motion_v1.npz" \
  -F "prompt=The same dog walks naturally in place on four legs." \
  -F "seed=42"
```

`subject_profile=auto`와 `motion_backend=auto`도 지원한다. NPZ에 `subject_profile=quadruped|biped_animal` scalar가 있으면 그 선언을 provider hint로 사용해 `animal_npz`로 라우팅한다. NPZ가 없으면 이미지·prompt 분류 결과에 따라 동물은 `animal_procedural`, 사람은 `kimodo`로 결정된다. 운영 요청에서는 대상이 확실할 때 명시값을 사용한다.

응답에는 실제 선택 결과가 들어간다.

```json
{
  "job_id": "32-character-hex-id",
  "subject_profile": "quadruped",
  "motion_backend": "animal_npz",
  "motion_routing": {
    "requested_backend": "auto",
    "resolved_backend": "animal_npz",
    "reason": "uploaded_animal_npz_present"
  }
}
```

## 8. animal-motion-v1 NPZ 계약

자세한 사양은 [`ANIMAL_MOTION_NPZ_V1.md`](ANIMAL_MOTION_NPZ_V1.md)에 있다.

필수 배열:

```text
front  float32 [T, 18, 2]
back   float32 [T, 18, 2]
left   float32 [T, 18, 2]
right  float32 [T, 18, 2]
```

- `T`: 4~512
- 좌표: 정규화된 `x, y`
- `coordinate_space=subject_box`: 0~1 좌표를 각 방향 입력 실루엣 bbox에 맞춤
- `coordinate_space=normalized_canvas`: 캔버스 전체 0~1 좌표
- 선택 scalar: `schema_version=animal-motion-v1`, `subject_profile=quadruped|biped_animal`
- 선택 confidence: `front_scores`, `back_scores`, `left_scores`, `right_scores`의 `[T,18]`
- 기본 제한: 압축 64 MiB, 압축 해제 총량 256 MiB, ZIP member 64개
- NumPy object/pickle 배열은 허용하지 않음

서버는 입력 길이를 주기적으로 16개 고유 phase로 resample하고 첫 phase를 마지막에 정확히 복사해 17-control loop를 만든다. 사람 reference pose detector는 호출하지 않는다. 현재 adapter는 One-to-All 호환을 위해 동물 topology를 18개 control slot에 투영하는 bridge이며, 별도 동물 diffusion 모델을 학습한 것은 아니다.

패키지에는 계약 배선 점검용 fixture가 포함된다.

```text
examples/animal-motion-v1/quadruped_walk_contract_example.npz
examples/animal-motion-v1/biped_animal_walk_contract_example.npz
```

이 파일들은 학습 모델 품질 표본이 아니며, 실제 운영 승격 판정에는 외부 animal motion provider NPZ와 L40S 렌더 결과를 별도로 사용한다.

## 9. 상태·결과·실패 파일

```bash
JOB_ID="..."

curl -H "Authorization: Bearer ${API_TOKEN}" \
  "${BASE_URL}/v1/jobs/${JOB_ID}"

curl --fail -L -H "Authorization: Bearer ${API_TOKEN}" \
  "${BASE_URL}/v1/jobs/${JOB_ID}/result" \
  -o result.zip

curl --fail -L -H "Authorization: Bearer ${API_TOKEN}" \
  "${BASE_URL}/v1/jobs/${JOB_ID}/debug" \
  -o failure_debug.zip

curl --fail -X DELETE -H "Authorization: Bearer ${API_TOKEN}" \
  "${BASE_URL}/v1/jobs/${JOB_ID}"
```

재시작 시 `queued`와 `processing` 상태는 다시 queue에 넣는다. 처리 중인 job은 삭제할 수 없다.

## 10. 프로덕션 승인 조건

현재 패키지는 다음까지 완료했다.

- 사람 경로 V8 코드 보존 및 SHA-256 회귀 테스트
- 동물 routing, NPZ 계약, adapter, QC와 API HTTP lifecycle 테스트
- 기존 V8 동물 실패 결과의 V9 QC 재차단
- Python 66개 테스트, 프론트 source contract 11개 테스트
- Python compileall, shell syntax, TypeScript syntax와 package-lock 핵심 버전 검사
- clean `npm ci`, production build와 lint 통과
- `npm audit` 취약점 0개
- Next.js와 eslint-config-next `16.3.2`, sharp `0.35.3` 잠금 반영

프로덕션 승격 전에 실제 GPU 품질 검증이 남아 있다.

1. 실제 L40S에서 새 V9 경로로 사족·이족동물을 생성한다. 최소한 개·돼지·고양이·소와 공룡·조류형 캐릭터를 `animal_procedural` 및 대표 외부 NPZ로 실행하고, 원본·control preview·render attempts·result/debug ZIP을 함께 보존한다.

모델 소스와 V8 실패 기록을 조사한 근거는 [`V9_ANIMAL_ROUTING_SOURCE_AUDIT.md`](V9_ANIMAL_ROUTING_SOURCE_AUDIT.md)에 정리했다.
