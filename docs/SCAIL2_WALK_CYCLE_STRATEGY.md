# SCAIL-2 4방향 걷기 생성 전략

## 결정

걷기 프레임은 `Qwen-Image-Edit-2511`로 한 장씩 독립 생성하지 않는다. 하나의 정확한 제자리 걷기 동작을 네 방향에서 렌더링한 RGB driving video와 방향별 canonical reference를 사용해, SCAIL-2 Animation Mode를 방향당 한 번씩 총 네 번 실행한다.

```text
하나의 17-frame master walk cycle
        ├── front driving + front reference + masks ──→ front 17F
        ├── back driving  + back reference  + masks ──→ back 17F
        ├── left driving  + left reference  + masks ──→ left 17F
        └── right driving + right reference + masks ──→ right 17F

각 결과에서 0, 2, 4, 6, 8, 10, 12, 14번 프레임 추출
        ↓
4방향 × 8프레임 = 최종 32프레임
```

생성 단위는 한 프레임이 아니라 **한 방향의 한 보행 주기 전체**다. 일반 I2V가 정지 이미지에서 동작을 추론하게 하지 않고, 우리가 준비한 RGB driving video가 동작과 시간 순서를 정의한다.

## 공식 자료 검토 결과

| 항목 | 판정 | 프로젝트 적용 |
|---|---|---|
| RGB driving 직접 사용 | 확인 | skeleton으로 다시 축약하지 않음 |
| Animation Mode | 확인 | `replace_flag=false` 사용 |
| reference·driving mask | 필수 | reference와 driving에 같은 character binding color 사용 |
| 8프레임 입력 | 부적합 | 기본 81-frame segment보다 짧으면 공식 코드가 `(T-1)//4*4+1`로 유효 길이를 줄여 8장은 5장만 사용 |
| 17프레임 입력 | 프로젝트 설계값 | `17 = 4×4+1`, 16fps에서 처음과 마지막 사이가 1초인 closed cycle로 구성 |
| 512p·704p | 둘 다 공식 지원 | 발 접촉 검증은 704 계열부터 실험하고 H/W는 32의 배수로 설정 |
| multi-reference | 실험 기능 | 첫 검증에서는 방향별 main reference 한 장만 사용 |
| 정체성·픽셀 고정 | 보장 없음 | SCAIL-2 결과를 master animation strip으로 취급하고 검수 후 후처리 |

`17프레임`, `704 계열`, 방향별 reference 네 장은 SCAIL-2의 공식 필수조건이 아니다. 공식 코드의 VAE stride, sample fps와 프로젝트의 4방향 스프라이트 요구를 결합해 정한 제작 규칙이다. 704 생성이 발 디테일을 반드시 보장하는 것도 아니므로 512와 비교 기록을 남긴다.

## 입력 규격

### 방향별 canonical reference

캐릭터마다 아래 네 장을 승인한 뒤 사용한다.

| ID | 내용 |
|---|---|
| `R_front` | 정면 중립 전신 |
| `R_back` | 후면 중립 전신 |
| `R_left` | 왼쪽 측면 중립 전신 |
| `R_right` | 오른쪽 측면 중립 전신 |

네 장은 같은 캔버스, 캐릭터 높이, 중심 위치, 발 기준선, 조명과 색을 사용한다. 각 방향 실행에는 해당 방향 reference 한 장만 main reference로 넣는다. 다른 방향을 additional reference로 넣는 실험은 단일 reference가 먼저 통과한 뒤에만 진행한다.

### Master driving motion

하나의 rig와 하나의 walk animation을 네 개의 고정 카메라로 렌더링한다. SCAIL-2에는 rig나 skeleton이 아니라 렌더링된 RGB video를 입력한다.

| 조건 | 규칙 |
|---|---|
| 프레임 | 0~16, 총 17장 |
| FPS | 16 |
| loop | frame 16의 자세가 frame 0의 다음 주기 시작 자세와 일치 |
| root | X 고정, Y 변화 최소화 |
| camera | 위치·회전·초점 고정 |
| scale | 전 프레임 캐릭터 높이 고정 |
| 배경 | 단순하고 일정한 배경 |
| phase | 네 카메라가 같은 animation timeline을 공유 |

정면·후면 driving에서 캐릭터가 카메라 쪽으로 이동하거나 멀어지면 안 된다. 측면 driving도 화면을 가로질러 이동하지 않고 제자리에서 걷는다. heel contact, toe-off와 swing은 프롬프트가 아니라 driving frame에 실제로 보여야 한다.

### Mask

SCAIL-2 공식 의미를 그대로 따른다.

| 값 | 의미 |
|---|---|
| 검정 | 결과에 유지하지 않을 background |
| 흰색 | 결과에 유지할 background |
| 동일한 색 | reference character와 driving character의 binding slot |

reference mask와 17-frame driving mask는 character 영역에 동일한 binding color를 사용한다. 마스크가 잘못되면 Animation Mode가 Replacement Mode처럼 동작할 수 있으므로 RGB 결과보다 먼저 mask preview를 검수한다.

## 방향별 실행

각 방향은 별도 inference job이다. 네 방향을 하나의 영상에 이어 붙이지 않는다.

```text
Run 1: R_front + D_front + M_front
Run 2: R_back  + D_back  + M_back
Run 3: R_left  + D_left  + M_left
Run 4: R_right + D_right + M_right
```

공통 설정은 model checkpoint, seed 정책, fps, frame count, 해상도, sampling steps와 prompt 형식이다. prompt는 긴 동작 명령으로 gait를 설계하지 않고 캐릭터 외형, 고정 카메라와 driving에 보이는 제자리 걷기를 설명한다. 공식 README는 짧거나 빈 prompt도 실행되지만 reference subject와 motion을 자세히 설명하는 prompt가 일반적으로 더 낫다고 안내한다.

## 프레임 추출과 결과 구조

방향별 17프레임에서 아래 인덱스만 최종 스프라이트 후보로 사용한다.

| 최종 phase | 원본 frame |
|---:|---:|
| 1 | 0 |
| 2 | 2 |
| 3 | 4 |
| 4 | 6 |
| 5 | 8 |
| 6 | 10 |
| 7 | 12 |
| 8 | 14 |

frame 16은 추출하지 않고 frame 0과의 loop closure 검사에 사용한다. 네 방향의 같은 phase 번호는 같은 master motion의 같은 시각이어야 한다.

## 검수 기준

| 검사 | 통과 기준 |
|---|---|
| 방향 | 전 구간에서 정면·후면·좌·우 카메라가 바뀌지 않음 |
| 정체성 | 얼굴, 머리, 의상, 색상과 체형이 frame 간 크게 변하지 않음 |
| 크기 | 캐릭터 높이와 중심 위치가 전 구간에서 안정적 |
| 발 | contact, toe-off, passing이 driving과 같은 시간에 나타남 |
| phase | 네 방향의 동일 phase가 같은 발 상태를 가짐 |
| loop | frame 16에서 frame 0으로 연결할 때 튐이 없음 |
| 배경 | 새로운 물체, 문자, 카메라 이동과 배경 변화가 없음 |

한 방향이 실패하면 나머지 세 방향을 자동으로 계속 생성하지 않는다. 먼저 오른쪽 측면 한 방향으로 motion fidelity와 외형 일관성을 확인한 뒤 정면, 후면, 왼쪽 순으로 확대한다.

## 저장 항목

각 job에는 아래 항목을 함께 저장한다.

- canonical reference와 reference mask
- 17-frame driving video와 driving mask video
- 방향, model checkpoint, seed, prompt, 해상도, fps, frame count, sampling 설정
- SCAIL-2 원본 영상과 17개 원본 프레임
- 추출 인덱스 `0,2,4,6,8,10,12,14`
- frame 0/16 loop 비교 결과
- 방향별 승인·반려와 실패 이유
- 후처리 여부

모든 방향의 원본 검수가 끝나기 전에는 픽셀화, 최종 리사이즈, 배경 제거와 스프라이트 패킹을 자동 실행하지 않는다.

## 하지 않는 방식

- Qwen으로 최종 32장을 32번 독립 생성
- 이전 생성 프레임을 다음 이미지 편집 reference로 연결
- 정지 이미지 한 장에서 일반 I2V 모델이 걷기를 추론하게 함
- 정면·후면·좌·우를 한 영상에 이어 붙임
- 8프레임 driving을 공식 기본 segment 설정에 그대로 입력
- 네 방향 reference를 처음부터 모두 multi-reference로 입력
- 생성과 동시에 픽셀화·리사이즈·스프라이트 패킹

## 검증 순서

1. 캐릭터 한 명의 방향별 canonical reference 네 장과 mask 승인
2. 하나의 rig·walk animation으로 17-frame 제자리 driving 네 방향 렌더링
3. mask preview와 네 방향 phase 동기화 확인
4. 오른쪽 측면 704 계열 Animation Mode 한 번 실행
5. motion fidelity, 외형, 크기, background, loop 검사
6. 같은 입력을 512 계열로 실행해 비용·디테일 비교
7. 통과한 설정으로 정면·후면·왼쪽 실행
8. 네 결과에서 동일 phase 8장씩 추출
9. 32프레임을 검수한 뒤에만 후처리와 Unity import 진행

이 전략은 아직 성공이 확인된 제작법이 아니다. 다음 실험의 입력과 실패 조건을 고정한 검증 계획이다.

## 근거

- [SCAIL-2 논문](https://arxiv.org/html/2606.10804)
- [SCAIL-2 공식 저장소](https://github.com/zai-org/SCAIL-2)
- [wan-scail2 실행 문서](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/README.md)
- [짧은 입력 frame 유효 길이 계산](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/wan/scail.py)
- [SCAIL-2 14B VAE stride 설정](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/wan/configs/scail_config_14B.py)
- [공식 16fps 설정](https://github.com/zai-org/SCAIL-2/blob/wan-scail2/wan/configs/shared_config.py)
