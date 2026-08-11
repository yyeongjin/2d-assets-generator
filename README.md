# 2D Assets Generator

농장 생활 RPG에 필요한 타일, 오브젝트, 캐릭터, 아이템과 변형 에셋의 생성 방식을 실험하고 기록하는 저장소입니다. 이미지 모델은 RunPod에서 실행하고, 로컬 화면에서 입력·원본 출력·상태·히스토리를 확인합니다.

## 현재 현황

현재 결과물은 생성 품질이나 일관성이 검증된 완성본이 아닙니다. RunPod와 `Qwen-Image-Edit-2511`을 연결해 캐릭터·오브젝트·생명체 생성을 시도한 과정과 출력 결과를 기록용으로 남긴 상태입니다.

정지 이미지 한 장에서 일반 I2V 모델이 걷기를 추론하게 하고 영상에서 프레임을 추출하는 방식은 기각했습니다. `Wan2.2-TI2V-5B-Diffusers` 실험에서 캐릭터 외형·크기·배경이 프레임마다 변했고, 정지 프레임과 중복 프레임이 많았으며, 동작 prompt가 장면이나 원형 물체로 잘못 해석되는 결과도 발생했습니다.

2026-08-08에는 정면 캐릭터 원본 한 장과 프레임별 prompt만으로 걷기 8장을 개별 생성했지만, 착지 전·착지 순서, 좌우 발, 중립 자세 복원과 부츠 왜곡을 안정적으로 제어하지 못했습니다. 8프레임 전체는 승인되지 않았으며 [Qwen 정면 걷기 프레임 실패 기록](docs/QWEN_WALK_FRAME_FAILURES.md)에 중단 시점과 생성 ID를 남겼습니다.

다음 검증은 일반 I2V나 프레임별 이미지 편집이 아니라 SCAIL-2의 end-to-end RGB motion transfer를 사용합니다. 하나의 17-frame 제자리 walk cycle을 네 고정 카메라로 렌더링하고, 방향별 canonical reference와 mask로 네 번의 Animation Mode job을 실행한 뒤 동일 phase 8장씩을 추출합니다. 아직 성공 사례가 아니라 입력·검수·중단 조건을 정한 계획이며, 상세 내용은 [SCAIL-2 4방향 걷기 생성 전략](docs/SCAIL2_WALK_CYCLE_STRATEGY.md)에 기록합니다.

README의 GIF와 에셋 갤러리도 잘 작동하는 성공 사례를 의미하지 않습니다. 방향별 외형 일관성, 크기, 정면 표현, 프레임 구성 등 현재 확인된 결과와 문제를 비교하기 위한 실험 기록입니다.

![Asset Forge 브라우저 디버깅 과정](tools_test/public/screenshots/asset-forge-browser-debug.gif)

[생성 에셋 갤러리](tools_test/public/assets/catalog/README.md)는 캐릭터·오브젝트·생명체별 실험 출력을 README 안에서 바로 확인하기 위한 기록입니다.

## 현재 실험 중인 생성 순서

### 1. 4방향 기준 캐릭터

캐릭터를 한 방향씩 따로 만들지 않고 첫 생성에서 한 장의 `2×2` 방향 시트를 요청합니다.

| 셀 | 방향 |
|---:|---|
| 1 | 정면 |
| 2 | 후면 |
| 3 | 오른쪽 측면 |
| 4 | 왼쪽 측면 |

- 입력: 캐릭터 옵션으로 만든 짧은 prompt와 빈 흰 캔버스 1장
- 출력: 동일 캐릭터의 정면·후면·오른쪽·왼쪽이 들어간 원본 1장
- 필수 검사: 외형, 의상, 색상, 비율, 크기, 발 위치, 신체 잘림 여부
- 생성 중에는 크롭, 리사이즈, 픽셀화, 배경 제거를 하지 않음
- 사용자가 네 방향을 확인하고 승인한 결과만 `Reference A`로 사용

현재 RunPod는 `Qwen-Image-Edit-2511`을 vLLM Omni로 실행합니다. Edit 모델이 이미지 입력을 요구하므로 1단계에서도 빈 흰 캔버스 한 장을 보내지만, 이것은 포즈·윤곽 레이아웃 `Reference B`가 아닙니다.

### 2. 아이템 착용 검증

1단계에서 승인한 방향 시트에 무기·도구·장비가 일관되게 추가되는지 확인합니다.

| 입력 | 내용 |
|---|---|
| Reference A | 승인한 4방향 캐릭터 시트 |
| Reference B | 실제 아이템 이미지 |
| prompt | 캐릭터를 바꾸지 않고 B의 아이템만 네 방향에 추가 |
| 출력 | 아이템을 착용한 4방향 원본 시트 |

이 단계의 `Reference B`는 레이아웃 윤곽선이 아니라 실제 아이템입니다.

### 3. SCAIL-2 4방향 걷기 검증

승인된 `2×2` 방향 시트를 네 canonical reference로 분리합니다. 하나의 17-frame 제자리 walk animation을 정면·후면·오른쪽·왼쪽 고정 카메라로 렌더링하고, 방향별 reference·driving·mask를 사용해 네 개의 SCAIL-2 Animation Mode job을 실행합니다.

1. 방향별 canonical reference와 reference mask 승인
2. 같은 animation timeline을 공유하는 방향별 17-frame RGB driving과 mask 준비
3. 오른쪽 측면 한 방향을 먼저 생성해 motion fidelity와 외형 일관성 검사
4. 통과한 설정으로 나머지 세 방향 생성
5. 각 결과에서 `0, 2, 4, 6, 8, 10, 12, 14`번 frame 추출
6. 네 방향의 같은 phase와 frame 0/16 loop를 검수
7. 32프레임 승인 뒤에만 최종 후처리와 스프라이트 패킹

SCAIL-2도 픽셀 단위 외형 고정을 보장하지 않습니다. 이 단계의 결과는 완성 스프라이트가 아니라 검수할 master animation strip입니다.

## 에셋 범위

- 타일: 지표면, 경작지, 물, 해안, 절벽, 길, 다리, 계단, 실내 바닥·벽, 계절·전이 타일
- 오브젝트: 자연물, 작물, 울타리, 건물, 제작 설비, 가구, 마을·광산 소품
- 캐릭터·생명체: 플레이어, NPC, 가축, 야생동물, 몬스터
- 아이템: 도구, 무기, 씨앗, 작물, 음식, 광물, 제작 재료, 장비, 퀘스트 물품
- 표현 요소: 초상화, 아이콘, 커서, 상태 표시, 타격·채집·물·날씨 VFX

세부 목록과 실제 규격은 아래 문서에서 관리합니다.

- [기능 기획서](docs/PRODUCT_PLAN.md)
- [마스터 에셋 카탈로그](docs/ASSET_CATALOG.md)
- [타일 카탈로그](docs/TILE_CATALOG.md)
- [오브젝트 카탈로그](docs/OBJECT_CATALOG.md)
- [캐릭터·오브젝트 상대 크기 규격](docs/SCALE_SYSTEM.md)
- [RunPod Qwen-Image-Edit-2511 실행 가이드](docs/RUNPOD_QWEN_IMAGE_EDIT.md)
- [기각된 RunPod Wan2.2 영상 실험 기록](docs/RUNPOD_WAN_VIDEO.md)
- [Qwen 정면 걷기 프레임 실패 기록](docs/QWEN_WALK_FRAME_FAILURES.md)
- [SCAIL-2 4방향 걷기 생성 전략](docs/SCAIL2_WALK_CYCLE_STRATEGY.md)

기각된 일반 I2V 실험은 [acatovic/ai-game-studio](https://github.com/acatovic/ai-game-studio)의 흐름에서 영감을 얻어 검증했습니다. 해당 실패 기록은 유지합니다. SCAIL-2 검증에서는 동작을 prompt로 추론시키지 않고, 하나의 정확한 RGB driving cycle을 캐릭터에 옮기는 별도 경로를 사용합니다.

## 로컬 도구 실행

```bash
cd tools_test
cp .env.example .env.local
# .env.local에 RunPod endpoint와 필요한 인증 정보 입력
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. Endpoint와 키는 코드에 넣지 않고 `.env.local`에서만 읽습니다.

## 저장 원칙

- RunPod 입력 이미지, prompt, seed, model, 요청 ID, 출력 원본, 경과 시간을 generation 단위로 저장
- 1단계와 2단계의 실제 전송 이미지를 화면에 표시
- 생성 실패와 완료 상태를 히스토리에 분리해 표시
- 원본 생성을 모두 끝내기 전 자동 후처리 금지
- 모델 prompt에 픽셀화 지시를 넣지 않음
