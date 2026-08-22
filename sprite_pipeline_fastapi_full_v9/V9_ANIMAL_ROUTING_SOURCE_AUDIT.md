# V9 동물 routing — 모델 소스와 V8 실패 기록 조사

조사 기준일: 2026-08-21

## 결론

V8 동물 실패는 prompt만의 문제가 아니다. 사람 경로가 다음 세 단계 모두에서 사람·사람형 body를 전제로 한다.

1. Kimodo가 human/humanoid kinematic motion을 생성한다.
2. 기존 adapter가 SOMA motion을 DWPose/OpenPose BODY_18 사람 관절로 투영한다.
3. One-to-All 전처리가 YOLOv10m + ViTPose whole-body로 reference 사람 pose를 찾고 driving pose를 그 reference에 정렬한다.

따라서 사족동물에 같은 경로를 적용하면 동물이 사람형 motion과 reference alignment에 끌려가는 것이 구조적으로 자연스럽다. V9는 사람 경로를 수정하지 않고, 동물 요청만 Kimodo와 사람 reference-pose detector를 우회한다.

## 확인한 upstream 코드

### One-to-All Animation

공식 저장소: `ssj9596/One-to-All-Animation`

- `video-generation/infer_utils.py`
  - `Pose2d`에 `vitpose_h_wholebody.onnx`와 `yolov10m.onnx`를 로드한다.
  - reference와 driving frame을 `wanpose2d`로 추론한다.
  - 결과를 DWPose 구조로 바꾼 뒤 `align_to_reference` 또는 `align_to_pose`를 수행한다.
- `video-generation/infer_preprocess.py`
  - reference image와 driving video를 받아 pose video, image pose와 mask를 생성한다.
  - 공개 예제의 입력 계약도 사람 pose retargeting 중심이다.

V9 판단: One-to-All renderer 자체는 유지하되, 동물 요청에서는 reference 사람 detector와 사람 global alignment를 호출하지 않는다. 동물 adapter가 만든 제어 프레임을 직접 image-pose/control-video 입력으로 사용한다.

### Kimodo

공식 저장소: `nv-tlabs/kimodo`

공식 설명은 human/humanoid motion generation을 대상으로 한다. V9 판단: 사람·캐릭터 요청에는 기존 V8 Kimodo 경로를 그대로 유지하고, `quadruped`와 `biped_animal` 요청에서는 Kimodo를 호출하지 않는다.

## V8 실제 실패 기록

근거: `docs/test-records/V8_CREATURES_2026-08-20.md`

실제 L40S V8 테스트는 8종 중 사용 가능한 동물 에셋이 `0/8`이었다.

| 사례 | V8 API | 실제 관찰 | V9 대응 |
|---|---|---|---|
| 돼지 | loop/appearance QC 통과 | 사족 체형이 사라지고 사람처럼 직립 | `quadruped`, Kimodo·사람 detector 우회 |
| 개 | QC 통과 | 개체 복제, 사족과 직립 개가 동시에 생성 | 동물 duplicate/component/identity QC |
| 공룡 | QC 통과 | 사람형 보행자와 공룡 몸체·꼬리가 분리 | `biped_animal`, 비인간 실루엣 QC |
| 소·양·고양이 등 5종 | 기존 hard gate 거절 | 결과 ZIP 없음 | 실패 debug ZIP으로 입력·control·대표 렌더 보존 |

V8의 loop/appearance QC는 색상, 위치, baseline과 seam을 검사하지만 종, 개체 수와 사족/이족 형태를 판정하지 않았다. V9는 기존 돼지·개·공룡 결과를 동물 QC로 다시 검사해 `3/3` 모두 거부했다.

## 시도한 경로와 판정

### 1. prompt와 negative prompt만 강화

동물, 사족, 다리 수와 duplicate 금지 문구를 강화하는 것은 보조책이다. driving control 자체가 사람형이면 prompt만으로 구조적 bias를 제거할 수 없으므로 단독 해결책으로 채택하지 않았다.

### 2. 사람 reference pose detector를 동물에도 사용

V8 실패의 직접 원인이므로 기각했다. 사족동물은 detector가 실패하거나 사람형 관절로 잘못 맞춰진다.

### 3. 동물 procedural control

외부 동물 motion provider가 아직 없을 때 사용할 staging fallback이다. 사족은 네 foot chain에 다른 phase를 적용하고, 이족동물은 별도 비인간형 geometry를 사용한다. 사람 detector는 호출하지 않는다.

### 4. 외부 `animal-motion-v1` NPZ

동물 motion model, 수동 rig 또는 gait library가 네 방향 normalized control을 제공하는 경로다. API에서 `motion_backend=animal_npz`를 선택하고 multipart로 NPZ를 첨부한다. profile, schema, shape, 범위, 압축 해제 크기와 파일 hash를 queue 이전에 검증한다.

### 5. route별 readiness

사람은 Kimodo + One-to-All이 모두 준비되어야 한다. 동물은 One-to-All만 준비되어도 접수된다. 로컬 Next proxy도 Kimodo 장애를 전체 장애로 취급하지 않는다.

## 중요한 한계

`animal-motion-v1`은 Kimodo NPZ가 아니며 사람 SOMA motion과 호환시키기 위한 파일도 아니다. 다만 현재 renderer가 18점 pose raster를 소비하므로 V9의 첫 계약은 18개 슬롯을 가진 호환 bridge다. 슬롯의 동물 geometry는 별도로 만들지만 최종 pose raster는 One-to-All의 기존 pose-control 입력 형식을 사용한다.

즉, V9는 다음을 확실히 해결한다.

- 사람·동물 motion source와 reference alignment의 분리
- API에서 backend 선택
- 외부 동물 NPZ 교체 가능성
- Kimodo 장애와 동물 route의 독립성
- 동물 실패 증거 보존과 의미 QC

다음은 아직 실제 GPU 결과로 확정되지 않았다.

- One-to-All 1.3B가 사족동물 pose raster를 충분히 따르는지
- 어떤 동물 NPZ topology와 guidance 값이 종별로 가장 안정적인지
- 사족·조류·공룡 전체에 하나의 renderer가 충분한지

따라서 V9는 스테이징에서 통합 검증할 후보이며, 메인 반영과 동물 생성 품질의 프로덕션 승격은 clean frontend build와 실제 L40S 사족·이족 E2E 결과 이후에만 한다.
