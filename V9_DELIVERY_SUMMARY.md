# V9 animal routing delivery summary

작성일: 2026-08-22  
상태: **스테이징 후보**

## 목적

V9는 정상 동작하는 V8 사람·사람형 캐릭터 경로를 교체하지 않는다. 요청을 시작할 때 대상과 motion 공급자를 분리해 동물이 사람용 Kimodo·인체 pose 전처리를 무조건 타지 않도록 한다.

| 대상 | motion backend | 경로 |
|---|---|---|
| 사람·사람형 캐릭터 | `kimodo` | V8 Kimodo → V8 adapter → One-to-All → V8 QC |
| 사족동물 | `animal_procedural` | V9 사족 motion → animal adapter → One-to-All → animal QC |
| 사족동물 | `animal_npz` | 외부 `animal-motion-v1` NPZ → animal adapter → One-to-All → animal QC |
| 이족동물 | `animal_procedural` | V9 이족동물 motion → animal adapter → One-to-All → animal QC |
| 이족동물 | `animal_npz` | 외부 `animal-motion-v1` NPZ → animal adapter → One-to-All → animal QC |

## 사람 경로 보존

- `adapter/service.py`: `94c53bfda7e283247e94495874ee4af569c7b35d0b6ea0c531193e723441dd18`
- `workers/kimodo_worker.py`: `1b3ef5e103a938ea84f154777470d905032da3aa189d59a4cc007e72ef67d532`

두 파일은 V8 기준과 바이트 단위로 동일하며 회귀 테스트가 해시를 고정한다.

## 포함된 동물 NPZ 계약 fixture

- `quadruped_walk_contract_example.npz`
- `biped_animal_walk_contract_example.npz`

두 파일은 API upload·routing·validation·resample·loop closure 검증용이다. 학습된 동물 motion 모델의 품질 결과로 간주하지 않는다.

## 검증 결과

- Python unit/API HTTP 테스트: **66/66 통과**
- 프론트 source-contract 테스트: **11/11 통과**
- TypeScript syntax transpile: **26/26 통과**
- Python compileall: 통과
- shell syntax: 통과
- package-lock 일치 검사: 통과
- clean `npm ci`, production build와 lint: 통과
- `npm audit`: 취약점 0개
- Next.js·eslint-config-next 잠금 버전: `16.3.2`
- sharp 잠금 버전: `0.35.3`
- 사족·이족 NPZ fixture 검증: 통과
- 독립 서버 ZIP 압축 해제 후 내부 manifest와 Python 66개 재검증: 통과

## 서버 ZIP

- 파일: `sprite_pipeline_fastapi_full_v9.zip`
- SHA-256: `f4d655a6779dbaf091e53ab581c2c254b5e18e64459b2bd5fe0c105406a6d35e`

## 아직 실행하지 않은 항목

- 실제 L40S + One-to-All 사족동물 신규 렌더
- 실제 L40S + One-to-All 이족동물 신규 렌더
- 외부 동물 motion 모델이 생성한 NPZ의 실제 종단 렌더

따라서 라우팅 독립성, API lifecycle, NPZ 계약과 실패 차단은 검증됐지만 동물 생성 품질을 프로덕션 확정으로 표시하지 않는다.
