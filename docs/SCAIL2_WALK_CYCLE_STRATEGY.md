# 기각 기록 — SCAIL-2 4방향 걷기 생성 경로

## 판정

2026-08-13 기준으로 **SCAIL-2를 이 프로젝트의 캐릭터 동작 생성 모델로 사용하는 계획을 기각한다.**

프로젝트가 필요로 하는 것은 정면·후면·좌·우 정지 이미지에서 걷기, 무기 사용, 도구 사용 같은 동작과 스프라이트 프레임을 새로 설계하는 기능이다. SCAIL-2의 공식 용도는 이미 존재하는 Driving RGB video의 움직임을 Reference 캐릭터로 전이하는 것이다. 두 작업은 입력과 책임이 다르다.

```text
프로젝트가 필요한 흐름

4방향 정지 캐릭터
        +
동작 이름 또는 동작 조건
        ↓
모델이 동작과 phase를 설계
        ↓
4방향 동작 프레임


SCAIL-2의 실제 흐름

Reference character RGB + mask
        +
이미 동작이 완성된 Driving RGB video + mask
        +
영상 설명 prompt
        ↓
Driving motion을 Reference 캐릭터 외형으로 전이한 새 영상
```

따라서 RunPod endpoint와 로컬 입력 화면을 연결할 수 있는지와 별개로, SCAIL-2는 프로젝트에서 빠져 있던 **동작 생성 단계**를 해결하지 않는다.

## 공식 논문과 코드에서 확인한 사실

### 1. `pose-free`는 Driving video가 필요 없다는 뜻이 아니다

SCAIL-2의 `pose-free`는 OpenPose, skeleton, DensePose 같은 중간 pose representation을 사용하지 않는다는 뜻이다. Driving RGB video 자체를 VAE로 encode한 visual latent가 motion condition으로 들어간다.

```text
기존 pose 기반 전이
Driving video → skeleton·pose 추출 → 생성

SCAIL-2
Driving RGB video → VAE latent → 생성
```

즉 `pose-free`이지 `motion-source-free`가 아니다. 정지 이미지와 `walk`라는 단어만으로 보행을 설계하는 기능은 아니다.

### 2. 공식 inference가 네 입력 파일을 요구한다

공식 `generate.py`와 pipeline은 다음 입력 경로를 검사한다.

| 입력 | 실제 역할 |
|---|---|
| Reference RGB | 결과에 사용할 캐릭터 외형 |
| Reference mask | Reference 안의 캐릭터 binding 영역 |
| Driving RGB video | 전이할 실제 움직임과 시간 순서 |
| Driving mask video | Driving 캐릭터의 binding 영역 |

CLI의 `--pose`와 코드의 `pose_path`라는 이름은 혼동을 주지만, end-to-end mode에서는 skeleton이 아니라 실제 RGB Driving video가 들어간다. 로컬 API가 네 파일을 요구했던 것은 임의로 복잡하게 만든 인터페이스가 아니라 공식 pipeline 입력을 반영한 것이다.

### 3. 움직임은 prompt가 아니라 Driving RGB에서 온다

Driving video는 resize와 VAE encode를 거쳐 `pose_latent`로 변환되고, 별도의 pose patch embedding을 통해 Transformer context에 들어간다. Animation mode에서는 Driving과 Target의 temporal position을 대응시켜 같은 시점의 움직임을 전이한다.

따라서 heel contact, toe-off, passing pose, 무기 타격 같은 동작은 prompt로 새로 설계되는 것이 아니라 Driving video에 이미 보여야 한다.

### 4. Reference는 외형 조건이지 동작 계획이 아니다

Reference RGB는 VAE latent와 CLIP visual feature 경로로 들어가 appearance와 identity를 제공한다. 하지만 Target은 Gaussian noise에서 새로 생성된다. Reference pixel을 그대로 복사하는 구조가 아니므로 얼굴, 의상, 색, 비율과 픽셀 위치가 완전히 고정된다고 보장할 수 없다.

### 5. 마스크는 pose 또는 모션 데이터가 아니다

Reference mask와 Driving mask는 캐릭터 binding과 background source를 지정한다. 마스크가 알려 주는 것은 `어느 대상의 움직임을 어느 Reference에 연결할지`이지, 걷기 phase나 팔다리 자세가 아니다.

결국 현재 캐릭터용 Reference mask뿐 아니라 각 동작·방향의 Driving RGB와 정확히 맞는 Driving mask까지 먼저 준비해야 한다.

### 6. prompt는 영상 설명이며 gait planner가 아니다

공식 문서의 prompt는 생성될 subject와 scene을 설명하는 조건이다. 아래 기능은 공식 architecture와 inference interface에 없다.

- `walk` 한 단어에서 contact, down, passing, up phase 생성
- 정지 자세에서 heel-strike, toe-off와 swing leg 계획
- 4방향 카메라별 동작 자동 설계
- 8-frame sprite cycle 자동 구성
- 무기·도구별 공격 timing 생성

### 7. 17프레임은 공식 모델 요구값이 아니다

공식 기본 segment는 81프레임이며, 짧은 입력은 VAE temporal stride에 맞춰 `(T-1)//4*4+1` 길이로 처리된다. 자연스러운 길이는 `4n+1`이고 17프레임은 기존 프로젝트가 8개 phase 후보를 뽑기 위해 정한 실험값일 뿐이다.

따라서 `17F 입력 → 짝수 index 8장 추출`은 SCAIL-2가 보장하는 스프라이트 규격이 아니다. Driving과 출력이 정확한 closed walk가 아니면 이 추출 규칙도 의미가 없다.

### 8. SCAIL-2는 motion transfer 모델이지 motion synthesis 모델이 아니다

SCAIL-2에 있는 기능과 없는 기능을 구분하면 판단이 명확하다.

| 있음 | 없음 |
|---|---|
| Driving RGB motion latent | Text → gait planner |
| Reference appearance conditioning | 정지 자세 → 걷기 phase 설계 |
| Driving·Target 시간축 대응 | 걷기·공격·도구 동작 창작 |
| 캐릭터 간 motion transfer | Unity용 frame 수와 셀 자동 결정 |
| 새 영상 생성 | 픽셀 단위 identity·scale 고정 보장 |

## 프로젝트에서 기각하는 이유

### 핵심 기능이 선행 작업으로 되돌아간다

SCAIL-2로 걷기를 만들려면 먼저 정확한 걷기 Driving video를 제작해야 한다. 네 방향을 동일 phase로 맞추려면 하나의 rig와 animation을 네 카메라에서 렌더링하고, 방향별 mask video도 만들어야 한다. 이것은 프로젝트가 AI로 해결하려던 동작 설계 작업을 모델 호출 전에 사람이 완료해야 한다는 뜻이다.

### 캐릭터 한 명당 입력 준비 비용이 과도하다

캐릭터마다 Reference RGB와 Reference mask가 필요하고, 동작마다 네 방향 Driving RGB와 Driving mask가 필요하다. 걷기뿐 아니라 한손 무기, 양손 무기, 도구, 활, 운반 동작으로 늘어나면 driver와 mask 제작량이 빠르게 증가한다.

### 스프라이트에 필요한 고정성을 보장하지 않는다

이 프로젝트에서 중요한 것은 같은 캐릭터 외형, 동일 높이, 동일 발 기준선, 고정 카메라와 명확한 phase다. SCAIL-2는 생성형 video pipeline이므로 motion transfer가 성공해도 다음 항목을 별도로 검수해야 한다.

- 프레임별 얼굴·머리·의상 변화
- 캐릭터 높이와 중심 위치 변화
- 발 모양과 지면 접촉 변화
- 배경·그림자·새 물체 생성
- 첫 프레임과 마지막 프레임의 loop 불일치
- 네 방향 사이의 phase 불일치

### 4방향 결과를 위해 네 번의 고비용 video inference가 필요하다

한 방향의 결과가 다른 세 방향을 자동으로 제공하지 않는다. 정면·후면·좌·우를 각각 실행해야 하고, 한 방향이 실패하면 재생성·재검수 비용이 다시 발생한다. 결과를 PNG로 추출하고 정렬하는 후처리를 해도 생성 중 발생한 identity drift는 복구할 수 없다.

### 전체 에셋 생성기의 범위를 해결하지 않는다

프로젝트는 캐릭터 외에도 타일, 오브젝트, 생명체, 아이템, VFX와 UI를 대량 생성하고 항목별 인벤토리로 관리해야 한다. SCAIL-2는 이 기준 에셋 생성이나 카탈로그 생성에는 사용되지 않으며, 캐릭터·생명체의 기존 motion transfer라는 좁은 단계만 담당한다.

### 운영 성공 여부와 제품 적합성은 별개다

RunPod에서 dependency를 설치하고 FastAPI adapter가 모델을 로드하도록 만드는 작업은 기술적으로 계속할 수 있다. 그러나 endpoint가 정상 실행되어도 위의 기능 불일치는 바뀌지 않는다. 이번 기각은 일시적인 `einops`·`decord` 설치 오류 때문이 아니라 공식 모델 구조와 프로젝트 목표가 맞지 않기 때문이다.

## 보존하는 것과 중단하는 것

### 계속 유지

- 타일·오브젝트·캐릭터·생명체·아이템·VFX·UI·가이드 카탈로그
- 항목별 prompt, seed, 생성 이미지와 업로드 이미지 인벤토리
- 캐릭터 조건과 랜덤 조합
- 캐릭터·생명체 `2×2` 4방향 기준 시트 생성과 방향 분할
- 생성 결과 저장·선택·제거와 히스토리
- 아이템 착용 4방향 검증

### 중단

- SCAIL-2를 주 동작 생성 모델로 사용하는 계획
- 17-frame master driver를 프로젝트 표준으로 확정하는 계획
- SCAIL-2 결과를 8프레임씩 추출해 32-frame 걷기 시트로 만드는 계획
- SCAIL-2 RunPod endpoint 추가 생성 테스트
- SCAIL-2를 타일·오브젝트 등 전체 에셋 생성 흐름에 연결하는 계획

### 기록으로만 유지

- 로컬 디버거의 SCAIL-2 입력·job 화면
- RunPod FastAPI adapter와 실행 가이드
- Reference/Driving RGB·mask 입력 구조
- 서버 dependency, queue, polling, MP4 download 구현

이 기록은 성공한 제작 경로가 아니다. 같은 모델을 다시 검토할 때 이미 확인한 구조와 실패 판단을 반복하지 않기 위한 자료다.

## 향후 동작 생성 모델의 필수조건

대체 경로를 정할 때는 모델 이름부터 확정하지 않고 아래 조건을 먼저 검증한다.

1. 4방향 정지 이미지에서 외부 Driving video 없이 동작을 생성할 수 있는가
2. 걷기 phase 또는 포즈 순서를 입력으로 통제할 수 있는가
3. 캐릭터 identity, 의상, 색, 비율과 높이를 프레임 전체에서 유지하는가
4. 고정 카메라, 발 기준선과 캔버스 크기를 유지하는가
5. 방향별 동일 phase를 재현할 수 있는가
6. 걷기 외 무기·도구·운반 동작으로 확장할 수 있는가
7. 생성 결과를 셀 단위 PNG와 스프라이트 시트로 안정적으로 분리할 수 있는가
8. 캐릭터와 생명체를 반복 생산할 수 있는 비용과 처리 시간을 갖는가

이 조건을 실제 출력으로 통과하기 전까지 동작 생성 방식은 **미정**으로 둔다.

## 공식 근거

- [SCAIL-2 논문](https://arxiv.org/html/2606.10804)
- [SCAIL-2 공식 저장소](https://github.com/zai-org/SCAIL-2)
- [`wan-scail2` 실행 문서](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/README.md)
- [공식 inference 입력 검사](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/generate.py)
- [Reference·Driving VAE 처리](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/wan/scail.py)
- [Reference·Driving token과 shifted RoPE](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/wan/modules/model_scail2.py)
- [SCAIL-2 14B 설정](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/wan/configs/scail_config_14B.py)
- [공식 FPS 설정](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/wan/configs/shared_config.py)
