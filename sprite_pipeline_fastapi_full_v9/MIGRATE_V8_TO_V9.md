# V8에서 V9로 이동

## 원칙

V8 사람·캐릭터 경로를 교체하지 않는다. V9 overlay는 요청 routing, 동물 motion 계약, 동물 adapter/QC와 API lifecycle만 추가한다.

## 설치

```bash
cd /workspace
unzip -q sprite_pipeline_fastapi_full_v9.zip -d /tmp/sprite-v9
cd /tmp/sprite-v9/sprite_pipeline_fastapi_full_v9
./scripts/install_v9_overlay.sh /workspace/sprite-pipeline
```

기존 Kimodo·One-to-All repository, checkpoint, virtualenv, `.env`, jobs는 유지한다.

## 환경변수 병합

`.env.example`의 V9 항목을 기존 `.env`에 추가한다.

```dotenv
API_TOKEN=replace-with-a-long-random-token
ALLOW_UNAUTHENTICATED_API=false
SPRITE_WORKER_READ_TIMEOUT_SECONDS=1800
SPRITE_ANIMAL_QC_STRICT=true
SPRITE_ANIMAL_MOTION_NPZ_MAX_BYTES=67108864
SPRITE_ANIMAL_MOTION_NPZ_MAX_UNCOMPRESSED_BYTES=268435456
SPRITE_ANIMAL_MOTION_NPZ_MAX_MEMBERS=64
```

공개 서버에서 인증 우회를 켜지 않는다.

## 의존성

```bash
cd /workspace/sprite-pipeline
server/.venv/bin/pip install -r server/requirements.txt
```

테스트를 새 환경에서 재현할 때:

```bash
server/.venv/bin/pip install -r requirements-test.txt
```

프론트는 Node.js 22.13 이상에서 잠금 파일 그대로 설치한다.

```bash
cd tools_test
npm ci
npm run build
node --test tests/rendered-html.test.mjs
```

현재 배포 후보는 깨끗한 `npm ci`, production build, source-contract 테스트, lint와 `npm audit`(취약점 0개)을 완료했다.

## 회귀 검증

```bash
server/.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
server/.venv/bin/python -m compileall -q adapter server/app workers tests client scripts
bash -n scripts/*.sh client/*.sh
```

## 기존 client 요청

기존 V8 client는 새 field가 없어도 기본값 `subject_profile=auto`, `motion_backend=auto`로 동작한다. 사람 prompt와 사람 이미지가 분류되면 기존 Kimodo 경로를 탄다.

운영에서 사람 경로를 확실히 고정하려면:

```text
subject_profile=character
motion_backend=kimodo
```

## 동물 요청

기본 동물 cycle:

```text
subject_profile=quadruped
motion_backend=animal_procedural
```

외부 NPZ:

```text
subject_profile=quadruped
motion_backend=animal_npz
motion_npz=@walk.npz
```

이족동물은 `subject_profile=biped_animal`을 사용한다. `subject_profile=auto`로 NPZ를 보낼 때 NPZ의 `subject_profile` scalar가 `quadruped` 또는 `biped_animal`이면 그 값을 provider hint로 사용한다. NPZ 사양은 `ANIMAL_MOTION_NPZ_V1.md`에 있다.

패키지 배선 검증에는 아래 fixture를 사용한다. 두 파일은 학습 모델 품질 표본이 아니라 계약 검증용이다.

```bash
python scripts/validate_animal_motion_npz.py \
  examples/animal-motion-v1/quadruped_walk_contract_example.npz \
  --subject-profile quadruped
python scripts/validate_animal_motion_npz.py \
  examples/animal-motion-v1/biped_animal_walk_contract_example.npz \
  --subject-profile biped_animal
```

## 서비스 준비 상태

- 사람: Kimodo + One-to-All 모두 `ready`
- 동물: One-to-All만 `ready`여도 접수 가능
- `/health`: `character_ready`, `animal_ready`, backend capability를 별도로 반환
- 로컬 Next proxy도 Kimodo 장애를 전체 pipeline 장애로 처리하지 않음

## 실패 artifact

```text
GET /v1/jobs/{job_id}/debug
```

완료 또는 실패 job 삭제:

```text
DELETE /v1/jobs/{job_id}
```

처리 중 job은 삭제되지 않는다.

## 프로덕션 승격 전 남은 항목

- 실제 L40S에서 사족·이족동물의 procedural 및 대표 NPZ 요청 종단 실행
- control preview, render attempt, result/debug ZIP, QC 보고서 보존
