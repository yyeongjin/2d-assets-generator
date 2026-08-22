# Sprite Pipeline V9 — independent animal motion routing

## 목적

V8의 사람·캐릭터 경로는 유지한다. V9는 동물이 사람용 Kimodo motion과 ViTPose/DWPose alignment를 무조건 타던 구조만 분리한다.

## API 계약

새 multipart fields:

- `subject_profile=auto|character|quadruped|biped_animal`
- `motion_backend=auto|kimodo|animal_procedural|animal_npz`
- `motion_npz=@file.npz` 선택 입력

`auto`는 최종 profile이 사람일 때 `kimodo`, 동물일 때 NPZ 유무에 따라 `animal_npz` 또는 `animal_procedural`로 결정한다. `subject_profile=auto`인 요청에 profile metadata가 든 NPZ가 첨부되면 NPZ 선언을 명시적 동물 provider hint로 사용한다. 잘못 섞인 사람/동물 backend 요청은 queue와 작업 디렉터리 생성 전에 거부한다.

## 사람 경로

기존 V8 흐름을 유지한다.

`Kimodo → V8 motion adapter → human reference pose alignment → One-to-All → appearance/loop QC`

동물 routing 코드가 사람 adapter의 생성 규칙이나 QC threshold를 변경하지 않는다. `adapter/service.py`와 `workers/kimodo_worker.py`의 V8 SHA-256을 회귀 테스트로 고정했다.

## 동물 경로

- Kimodo 우회
- 사람 reference-pose detector와 human global alignment 우회
- `quadruped`와 `biped_animal` 별도 topology
- 네 방향 foreground bbox 기반 retargeting
- exact 17-control closed loop
- 동물 전용 identity/topology/duplicate/limb/loop QC
- 실패 artifact를 `failure_debug.zip`으로 보존

### `animal_procedural`

외부 동물 motion이 없을 때 사용하는 기본 gait다. 사족은 네 foot chain에 서로 다른 phase를 적용하고, 이족동물은 비인간형 두 leg chain과 body/tail cue를 사용한다.

### `animal_npz`

외부 동물 model, 수동 rig 또는 motion library에서 `animal-motion-v1` NPZ를 받는다.

- 네 방향 `[T,18,2]`, `T=4..512`
- `subject_box` 또는 `normalized_canvas`
- profile mismatch, corrupt ZIP, duplicate/unsafe member, pickle, non-finite, abnormal range 거부
- 압축·압축 해제 총량·member 수 제한
- 16개 고유 phase로 periodic resample 후 phase 0을 복사해 17번째 endpoint 생성
- provider, source model, source SHA-256, size, frame counts를 request/status metadata에 기록
- 사족·이족 `animal-motion-v1` 계약 fixture, 생성기와 검증기를 패키지에 포함

현재 NPZ adapter는 One-to-All 호환을 위한 18-slot control bridge다. 독립 동물 motion 공급자와 사람 파이프라인을 분리하지만, 별도 동물 diffusion 모델의 품질을 보장하지는 않는다.

## API/운영 보강

- fail-closed bearer authentication
- queued/processing job restart recovery
- finite worker timeout
- strict 32-character job ID
- `/v1/jobs/{job_id}/debug`
- `DELETE /v1/jobs/{job_id}`
- `/health`의 `character_ready`, `animal_ready`, backend capability 분리
- Kimodo 장애 시 동물 route 유지

## 프론트엔드

- profile selector: `auto|character|quadruped|biped_animal`
- backend selector: `auto|kimodo|animal_procedural|animal_npz`
- 동물 NPZ 업로드
- route별 readiness 표시
- Next.js 및 eslint-config-next 잠금 버전을 `16.3.2`, sharp를 `0.35.3`으로 갱신
- UTF-8 bearer token 비교로 비 ASCII 토큰이 500을 만들던 인증 오류 수정
- jobs 경로를 import 시점에 생성하지 않고 실제 작업 생성 시점까지 지연

## 검증 상태

완료:

- Python unit/API HTTP 테스트 66개
- 프론트 source contract 테스트 11개
- TypeScript 26개 파일 syntax transpile
- Python compileall과 shell syntax
- package-lock 핵심 dependency/version 일치 검사
- clean `npm ci`, production build와 lint
- `npm audit` 취약점 0개
- V8 사람 경로 해시 회귀 테스트
- 인증·routing·queue recovery·debug ZIP·삭제 lifecycle 테스트
- 기존 V8 돼지·개·공룡 실패 결과의 V9 QC 재차단

아직 실행하지 않은 항목:

- 새 V9 경로의 실제 L40S + One-to-All 사족/이족동물 diffusion 생성
- 실제 외부 animal motion model에서 받은 NPZ의 종단 검증

따라서 V9는 스테이징 후보이며, 깨끗한 Node 환경 빌드와 실제 동물 종단 표본을 통과한 뒤 프로덕션으로 승격한다.
