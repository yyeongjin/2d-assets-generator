# animal-motion-v1 NPZ 사양

V9 동물 경로가 외부 동물 motion 모델, 수동 리깅 도구 또는 사전 계산된 gait library에서 제어 데이터를 받을 때 사용하는 독립 계약이다. 이 파일은 Kimodo NPZ와 호환시키기 위한 파일이 아니며 사람 skeleton을 요구하지 않는다.

## 필수 데이터

| key | dtype | shape | 의미 |
|---|---|---:|---|
| `front` | float32 권장 | `[T,18,2]` | 정면 control sequence |
| `back` | float32 권장 | `[T,18,2]` | 후면 control sequence |
| `left` | float32 권장 | `[T,18,2]` | 왼쪽 control sequence |
| `right` | float32 권장 | `[T,18,2]` | 오른쪽 control sequence |

별칭 `front_keypoints`, `keypoints_front`도 허용하며 다른 방향도 동일하다. `T`는 방향마다 4~512다. 방향별 길이가 달라도 서버가 각각 16개 고유 phase로 resample한다.

## 선택 metadata

| key | 값 |
|---|---|
| `schema_version` | scalar string, 기본 `animal-motion-v1` |
| `subject_profile` | `quadruped` 또는 `biped_animal` |
| `coordinate_space` | `subject_box` 또는 `normalized_canvas`, 기본 `subject_box` |
| `provider` | motion 공급자 이름 |
| `motion_name` | 예: `walk`, `trot` |
| `source_model` | 공급 모델 또는 rig 버전 |

문자열 metadata는 UTF-8 scalar string이며 256자 이하다. `subject_profile`이 들어 있으면 API 요청의 최종 분류와 정확히 같아야 한다. `subject_profile=auto` 요청에서는 NPZ가 선언한 동물 profile이 prompt·silhouette 자동 분류보다 우선하는 명시적 provider hint로 사용된다.

## confidence

방향별 `[T,18]` 배열을 선택적으로 넣는다.

```text
front_scores
back_scores
left_scores
right_scores
```

값은 0~1로 clip된다. 생략하면 모두 1로 처리한다.

## 좌표계

### `subject_box`

각 keypoint의 `x,y`를 0~1 범위의 로컬 동물 bbox 좌표로 해석한다. V9가 네 방향 기준 이미지에서 얻은 foreground bbox에 맞춰 배치한다. 서로 크기와 여백이 다른 입력 이미지에 같은 motion library를 재사용하기 가장 적합하다.

### `normalized_canvas`

입력 캔버스 전체를 0~1로 본다. motion provider가 이미 각 방향 기준 이미지에 retargeting을 끝낸 경우 사용한다.

검증은 약간의 계산 오차를 허용해 `-0.25~1.25`까지 읽지만, 실제 adapter 출력은 안전한 캔버스 범위로 clip한다.

## 18개 control point

현재 One-to-All pose-control 입력이 18점 raster 형식을 소비하므로 배열 차원은 18로 고정한다. 이것은 Kimodo SOMA motion이나 사람 관절 의미를 동물 provider에 요구한다는 뜻이 아니다. V9는 슬롯을 동물 geometry로 재배치하고 사람 reference detector와 사람 global alignment를 우회한다.

다만 최종 rasterizer는 One-to-All의 기존 DWPose 호환 edge 형식을 사용한다. 따라서 이 사양은 **동물 motion 공급자를 사람 Kimodo에서 분리하는 compatibility bridge**이지, One-to-All 자체를 동물 전용 diffusion model로 바꾸는 계약은 아니다.

사족 프로필은 네 foot chain이 실제로 움직여야 하며 좌우 측면 몸통이 수평형이어야 한다. 이족동물은 두 walking leg chain과 비인간형 body/tail geometry를 사용한다. 정확한 slot 배치는 `adapter/animal_service.py`의 profile template이 기준이다.

## 생성 예시

```python
import numpy as np

T = 24
front = np.zeros((T, 18, 2), dtype=np.float32)
back = np.zeros((T, 18, 2), dtype=np.float32)
left = np.zeros((T, 18, 2), dtype=np.float32)
right = np.zeros((T, 18, 2), dtype=np.float32)

# 실제 provider가 네 방향의 normalized control을 채운다.
np.savez_compressed(
    "dog_walk_animal_motion_v1.npz",
    schema_version=np.array("animal-motion-v1"),
    subject_profile=np.array("quadruped"),
    coordinate_space=np.array("subject_box"),
    front=front,
    back=back,
    left=left,
    right=right,
)
```

빈 배열은 shape만 맞고 실제 foot motion이 없어 adapter QC에서 거부된다.

## 업로드 전 검증

```bash
cd /workspace/sprite-pipeline
server/.venv/bin/python scripts/validate_animal_motion_npz.py \
  dog_walk_animal_motion_v1.npz \
  --subject-profile quadruped
```

## 포함된 계약 예제

패키지에는 API 배선과 NPZ 계약을 바로 검증할 수 있는 두 개의 작은 예제가 포함된다.

```text
examples/animal-motion-v1/quadruped_walk_contract_example.npz
examples/animal-motion-v1/biped_animal_walk_contract_example.npz
```

이 예제는 학습된 동물 motion 모델의 품질 표본이 아니다. V9 procedural scaffold를 `animal-motion-v1` 형식으로 저장한 계약 fixture이며, upload validation, profile routing, periodic resample과 exact endpoint closure 검증용이다.

재생성 및 검증:

```bash
python scripts/create_animal_motion_npz_example.py \
  --subject-profile quadruped \
  --output examples/animal-motion-v1/quadruped_walk_contract_example.npz

python scripts/validate_animal_motion_npz.py \
  examples/animal-motion-v1/quadruped_walk_contract_example.npz \
  --subject-profile quadruped
```

## 보안·제한

- 기본 압축 파일 최대 크기: 64 MiB
- 기본 압축 해제 합계 최대 크기: 256 MiB
- 기본 ZIP member 최대 개수: 64
- 지원 schema: `animal-motion-v1`만 허용
- `allow_pickle=False`
- 손상·중복 ZIP member와 `.npy` 이외 member 거부
- 절대 경로와 `..` member 거부
- non-finite 좌표와 비정상 shape 거부
- 파일 hash와 방향별 frame 수를 job request/status metadata에 기록

## 현재 검증 경계

API validation, periodic resample, exact endpoint closure와 오프라인 adapter/QC는 검증했다. 실제 외부 animal model NPZ를 사용한 L40S + One-to-All 사족·이족 종단 생성은 아직 수행하지 않았으므로 이 계약의 생성 품질은 스테이징 상태다.
