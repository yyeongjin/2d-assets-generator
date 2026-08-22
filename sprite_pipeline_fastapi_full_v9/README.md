# Sprite Pipeline V9

V9는 **검증된 V8 사람·캐릭터 경로를 그대로 보존**하고, 동물 요청만 독립 motion 경로로 분리한 스테이징 후보입니다. 사람용 Kimodo motion을 사족·이족동물에 강제로 적용하던 구조를 제거하는 것이 목적이며, 사람 생성 규칙을 다시 설계하는 버전이 아닙니다.

```text
character      → kimodo             → V8 human adapter  → One-to-All → V8 appearance/loop QC
quadruped      → animal_procedural  → V9 animal adapter → One-to-All → animal QC
quadruped      → animal_npz         → V9 animal adapter → One-to-All → animal QC
biped_animal   → animal_procedural  → V9 animal adapter → One-to-All → animal QC
biped_animal   → animal_npz         → V9 animal adapter → One-to-All → animal QC
```

동물 경로는 Kimodo와 사람 reference-pose detector를 호출하지 않습니다. 외부 동물 motion 모델·수동 rig·motion library가 준비되면 `animal-motion-v1` NPZ를 업로드해 사람 코드 수정 없이 motion 공급자를 교체할 수 있습니다.

## API routing

`POST /v1/jobs` multipart fields:

```text
front, back, left, right  required images
prompt                    required text
seed                      optional integer
subject_profile           auto | character | quadruped | biped_animal
motion_backend             auto | kimodo | animal_procedural | animal_npz
motion_npz                 optional .npz, animal only
```

라우팅 규칙:

- `character + auto|kimodo` → 기존 V8 Kimodo 경로
- `quadruped|biped_animal + auto` → NPZ가 있으면 `animal_npz`, 없으면 `animal_procedural`
- `quadruped|biped_animal + kimodo` → queue 진입 전에 거부
- `character + motion_npz|animal_*` → queue 진입 전에 거부
- `animal_npz` → NPZ 필수
- `subject_profile=auto` + profile metadata가 든 NPZ → NPZ의 `quadruped|biped_animal` 선언을 명시적 provider hint로 사용

`/health`는 `character_ready`와 `animal_ready`를 별도로 반환합니다. Kimodo가 중단돼도 One-to-All이 준비돼 있으면 동물 요청은 계속 접수할 수 있습니다.

## animal-motion-v1

필수 방향 배열은 `front`, `back`, `left`, `right`이며 각 shape은 `[T,18,2]`, `T=4..512`입니다. 좌표계는 `subject_box` 또는 `normalized_canvas`입니다. 서버는 각 방향을 16개 고유 phase로 주기 resample하고 첫 phase를 17번째에 정확히 복사합니다.

기본 제한:

- 압축 업로드: 64 MiB
- 압축 해제 총량: 256 MiB
- ZIP member: 64개
- NumPy object/pickle: 금지
- 지원 schema: `animal-motion-v1`

전체 계약: [ANIMAL_MOTION_NPZ_V1.md](ANIMAL_MOTION_NPZ_V1.md)

검증:

```bash
python scripts/validate_animal_motion_npz.py walk.npz --subject-profile quadruped
```

패키지의 계약 fixture로 routing과 adapter를 즉시 점검할 수 있습니다.

```bash
python scripts/validate_animal_motion_npz.py \
  examples/animal-motion-v1/quadruped_walk_contract_example.npz \
  --subject-profile quadruped
```

`examples/animal-motion-v1/`의 두 NPZ는 학습된 동물 모델 결과가 아니라 API·계약 검증용입니다.

## 설치

```bash
unzip -q sprite_pipeline_fastapi_full_v9.zip -d /tmp/sprite-v9
cd /tmp/sprite-v9/sprite_pipeline_fastapi_full_v9
./scripts/install_v9_overlay.sh /workspace/sprite-pipeline
```

기존 model repository, checkpoint, virtualenv, `.env`, job 디렉터리는 교체하지 않습니다.

서버 의존성:

```bash
cd /workspace/sprite-pipeline
server/.venv/bin/pip install -r server/requirements.txt
```

테스트 의존성까지 깨끗한 환경에 설치:

```bash
server/.venv/bin/pip install -r requirements-test.txt
```

## 검증 명령

```bash
server/.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
server/.venv/bin/python -m compileall -q adapter server/app workers tests client scripts
bash -n scripts/*.sh client/*.sh
```

이 패키지에서 실행한 검증은 `V9_BUILD_REPORT.txt`에 기록합니다. 현재 기준은 Python 66개와 프론트 source contract 11개 통과, Python compileall·shell syntax·TypeScript syntax 통과입니다. 의존성은 Next.js와 eslint-config-next `16.3.2`, sharp `0.35.3`으로 잠갔고 clean `npm ci`, production build, lint와 `npm audit`(취약점 0개)도 통과했습니다.

## 운영 경계

- API는 `API_TOKEN`이 없으면 fail-closed입니다.
- One-to-All은 모든 요청에 필요합니다.
- Kimodo는 `character` 요청에만 필요합니다.
- queue 재시작 복구, 실패 debug ZIP, result 다운로드와 완료·실패 job 삭제 API가 포함됩니다.
- V8의 `adapter/service.py`와 `workers/kimodo_worker.py`는 바이트 단위 해시로 고정해 사람 경로 회귀를 감지합니다.
- 현재 동물 adapter는 One-to-All 호환을 위해 동물 topology를 18개 control slot에 투영하는 bridge입니다. 이것은 별도 동물 diffusion 모델을 학습했다는 뜻이 아닙니다.
- 실제 신규 L40S 동물 diffusion 종단 검증 전까지 이 빌드는 **프로덕션 확정본이 아니라 스테이징 후보**입니다.

## 문서

- 변경 내역: [CHANGES_v9.md](CHANGES_v9.md)
- 마이그레이션: [MIGRATE_V8_TO_V9.md](MIGRATE_V8_TO_V9.md)
- 모델 소스·V8 실패 기록 조사: [V9_ANIMAL_ROUTING_SOURCE_AUDIT.md](V9_ANIMAL_ROUTING_SOURCE_AUDIT.md)
- 빌드 검증: [V9_BUILD_REPORT.txt](V9_BUILD_REPORT.txt)
