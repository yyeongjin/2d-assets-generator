# Kimodo → Motion Adapter → One-to-All 추후 개선 사항

> **상태: 개선 후 재검증 예정.** 이 경로는 기각하지 않았다. Kimodo motion 생성, FastAPI queue, 네 방향 렌더링과 결과 ZIP 생성까지는 동작했다. 현재 결과를 사용할 수 없는 원인은 모델 전체보다 `custom 3D→2D pose adapter → One-to-All` 연결부에 있을 가능성이 높다.

## 현재 판정

2026-08-15 종단 테스트 결과는 다음 HARD GATE를 통과하지 못했다.

- 정면 행이 정투영 정면 대신 3/4 방향으로 변함
- 후면 행에 얼굴 또는 수염처럼 보이는 전면 특징이 생김
- 좌우 방향에서 얼굴, 옷, 모자와 신체 비율이 달라짐
- 네 방향의 같은 phase가 동일한 동작 순간으로 보이지 않음

입력한 네 방향 이미지 자체나 Kimodo의 motion 생성이 실패한 것으로 단정하지 않는다. 우선 아래 연결부를 수정하고 같은 입력으로 다시 비교한다.

```text
Kimodo 3D motion
        ↓
custom 3D→2D pose adapter
        ↓
OTA용 visibility/confidence
        ↓
방향별 One-to-All generation
```

## 확인된 구현 문제

### 1. 방향별 2D 좌표만 만들고 visibility를 잃는다

현재 adapter는 3D 좌표를 방향별 2D 좌표로 투영한다.

```text
front → x
back  → -x
left  → -z
right → z
```

그러나 2D body skeleton만으로 정면과 후면을 구분하기는 어렵다. 특히 `_body18()`이 모든 방향에서 BODY_18의 머리 점을 생성한다.

```text
0   nose
14  right eye
15  left eye
16  right ear
17  left ear
```

후면 reference에는 보이지 않아야 할 점까지 target control에 살아 있으면 OTA가 후면 캐릭터에 전면 얼굴 특징을 다시 그릴 수 있다.

### 2. 모든 관절 confidence가 1.0이 된다

현재 `workers/ota_worker.py`의 기본 처리에는 다음 동작이 있다.

```python
def body_pose_dict(candidate, score=None):
    if score is None:
        score = np.ones(18, dtype=np.float32)
```

adapter가 visibility 정보를 전달하지 않으면 18개 점 전부가 최대 confidence로 OTA에 들어간다. 이 동작은 reference에서 실제로 보이는 관절만 사용하는 방식과 다르다.

### 3. `without_face=True`만으로 해결되지 않는다

`without_face=True`는 별도의 68점 face landmark를 생략한다. BODY_18에 속한 nose, eye와 ear는 body pose drawing에 남을 수 있으므로 후면 머리 점 문제를 별도로 처리해야 한다.

### 4. 네 방향이 독립 diffusion이다

현재 네 방향은 서로 다른 생성 작업이다.

```text
front reference → generation A
back reference  → generation B
left reference  → generation C
right reference → generation D
```

같은 seed만 사용해도 얼굴, 모자, 셔츠, 소매와 체형이 자동으로 같아지지는 않는다. pose control을 바로잡은 뒤에도 방향 간 identity drift를 별도 검수해야 한다.

## 수정 순서

### 1. 모델에 들어간 control부터 확인

가장 최근 작업의 reference pose와 대표 control frame을 먼저 확인한다.

```bash
JOB="$(ls -dt /workspace/sprite-pipeline/jobs/*/ | head -1)"

echo "$JOB"

find "$JOB/pose" \
  -type f \
  \( -name 'reference_pose.png' \
     -o -name 'control_000.png' \
     -o -name 'control_008.png' \
     -o -name 'control_016.png' \) \
  | sort
```

방향별로 아래 파일을 비교한다.

```text
pose/front/reference_pose.png
pose/front/control_000.png
pose/back/reference_pose.png
pose/back/control_000.png
pose/left/reference_pose.png
pose/left/control_000.png
pose/right/reference_pose.png
pose/right/control_000.png
```

먼저 back control에서 nose, eye와 ear가 전면 사람처럼 표시되는지 확인한다.

### 2. reference detector score를 target에 전달

방향별 reference pose detector가 반환한 score를 같은 방향의 target frame에 전달한다.

```python
ref_score = ref_dwpose["bodies"]["score"][0][:18]
ref_score[ref_score < 0.25] = 0.0

for frame in target_frames:
    pose = body_pose_dict(
        frame,
        score=ref_score,
    )
```

핵심은 adapter가 생성한 모든 점을 무조건 보이는 것으로 처리하지 않는 것이다.

### 3. 방향별 머리 점 정책 적용

후면은 BODY_18의 전면 머리 점을 제거한다.

```python
if direction == "back":
    control_score[[0, 14, 15, 16, 17]] = 0.0
```

정면은 전부 제거하기 전에 낮은 강도로 시험한다.

```python
if direction == "front":
    control_score[[0, 14, 15, 16, 17]] *= 0.35
```

좌우는 각 방향 reference detector score를 유지해 보이지 않는 쪽 eye와 ear의 confidence가 자연스럽게 낮아지도록 한다.

### 4. pose 수정 후 identity prompt 보강

`image_guidance_scale`을 먼저 크게 올려 문제를 덮지 않는다. control pose를 정상화한 뒤 API의 motion prompt와 OTA 내부 render prompt를 분리한다.

내부 identity constraint 후보:

```text
same character as the reference image,
identical clothing,
identical colors,
identical hat,
fixed camera,
full body,
white background,
walking in place
```

negative 후보:

```text
different character,
different clothes,
different outfit,
color change,
face change,
viewpoint change,
camera rotation,
zoom,
cropped body
```

현재 1.3B 설정의 `image_guidance_scale=2.5`, `pose_guidance_scale=1.5`는 우선 유지하고 pose 수정 전후 결과를 비교한다.

## 수정 대상

우선 다음 두 파일만 좁게 수정한다.

```text
adapter/service.py
workers/ota_worker.py
```

첫 수정에서 Kimodo 모델, 네 방향 입력 규격, 17 phase와 FastAPI queue를 동시에 바꾸지 않는다. 원인을 분리할 수 있도록 같은 입력 이미지, prompt와 seed를 유지한다.

## 재검증 기준

다음 항목을 모두 통과해야 제작 경로로 승격한다.

1. front는 엄격한 정면, back은 얼굴이 없는 엄격한 후면으로 유지
2. left와 right가 명확한 측면이며 카메라가 3/4 방향으로 회전하지 않음
3. 네 방향에서 얼굴, 모자, 의상, 색상, 체형과 화면상 크기 유지
4. 같은 phase가 네 방향에서 동일한 동작 순간을 표현
5. 모든 프레임이 같은 ground baseline과 전체 신체 framing 유지
6. 방향별 8 PNG, sprite sheet, metadata와 result ZIP 구조 유지

한 방향이라도 실패하면 나머지 결과를 승인하지 않고 control PNG와 detector score부터 다시 비교한다.

## 유지하는 것

- Kimodo를 사용한 3D motion 생성
- 정면·후면·왼쪽·오른쪽 원본 RGB 네 장 입력
- FastAPI job queue와 결과 ZIP 다운로드
- 방향별 pose/control 디버깅 파일 저장
- 종단 테스트와 실패 결과 기록

이 개선 계획은 최근 파이프라인을 폐기하기 위한 문서가 아니다. 작동한 서버 구조를 유지하면서 pose 연결부와 방향 간 identity를 순서대로 고쳐 다시 검증하기 위한 기준이다.

## 관련 문서

- [3세션 RunPod 설치·실행 가이드](RUNPOD_KIMODO_ONE_TO_ALL_GUIDE.md)
- [2026-08-15 종단 테스트 기록](test-records/KIMODO_ONE_TO_ALL_2026-08-15.md)
- [One-to-All 공식 저장소](https://github.com/ssj9596/One-to-All-Animation)
