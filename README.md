# 2D Assets Generator

농장 생활 RPG에 필요한 타일, 오브젝트, 캐릭터, 생명체와 동작 에셋의 생성 방식을 실험하고 기록하는 저장소입니다.

## 현재 현황

현재 결과는 성공 사례가 아니라 생성 구조와 실패 조건을 확인하기 위한 기록입니다. 디버깅 화면은 두 작업을 분리해서 다룹니다.

- 타일·오브젝트·캐릭터·생명체·아이템·VFX·UI 기준 에셋: 로컬 화면에서 항목별 프롬프트를 편집하고, 사용자가 설정한 self-hosted 이미지 endpoint에 생성 요청
- 캐릭터 기준 시트: 역할·성별 표현·연령·체형·머리·의상·특징을 직접 선택하거나 랜덤 조합해 `2×2` 4방향 캐릭터를 생성하고, 만든 캐릭터 인벤토리에 누적 저장
- 캐릭터 4방향 걷기 동작: 준비된 방향별 입력을 SCAIL-2에 전달해 동작 전이

두 endpoint는 서로 대체하지 않습니다. 기존 전체 에셋 목록과 항목별 생성 칸을 유지하면서 SCAIL-2 동작 실험을 함께 기록합니다.

정면·후면·왼쪽·오른쪽 기준 이미지와 마스크는 미리 준비합니다. 하나의 정확한 17-frame 제자리 걷기 동작을 네 고정 카메라로 렌더링하고, 같은 동작과 timing을 SCAIL-2 Animation Mode로 네 방향에 각각 전이합니다.

캐릭터가 `2×2` 4방향 시트 한 장으로 저장되어 있다면 디버깅 화면에서 다시 네 장으로 분할할 수 있습니다. 분할 순서는 `좌상=정면`, `우상=후면`, `좌하=오른쪽`, `우하=왼쪽`입니다. 이 단계는 모델 생성이나 결과 후처리가 아니라 SCAIL-2 job을 등록하기 전 `Reference RGB` 입력을 준비하는 작업입니다. 분할은 RGB만 대상으로 하며 reference mask와 driving RGB·mask는 바꾸지 않습니다.

## 현재 디버깅 화면

2026-08-12 기준 로컬 `http://localhost:3000` 화면입니다. 캐릭터 조건·랜덤 조합, 직접 수정 가능한 생성 prompt, 기존 4방향 캐릭터 선택, 저장 인벤토리와 방향별 분할 입력을 한 화면에서 확인합니다.

![현재 4-View Walk Factory 화면](tools_test/public/screenshots/current-workbench.png)

![캐릭터 조건·랜덤 생성과 저장 캐릭터 인벤토리](tools_test/public/screenshots/current-character-generator.png)

## 생성 구조

```text
로컬 클라이언트
  ├─ 2×2 canonical 시트 → 방향별 reference RGB 분할
  ├─ 방향별 reference RGB + reference mask
  └─ 방향별 driving RGB 17F + driving mask 17F
        │ multipart로 endpoint에 직접 전송
        ▼
RunPod On-Demand Pod
  ├─ uv Python 환경
  ├─ SCAIL-2 공식 wan-scail2 코드와 checkpoint
  ├─ FastAPI + 단일 GPU queue
  ├─ 방향마다 한 cycle 생성
  └─ front/back/right/left raw MP4 생성
        │ 결과 endpoint에서 MP4 다운로드
        ▼
로컬 클라이언트
  ├─ 원본 MP4 저장·표시
  └─ 네 방향 완료 뒤 동일 phase PNG 추출
```

Pod 안에서는 프레임 추출, 픽셀화, 스프라이트 패킹을 하지 않습니다. 네 방향의 원본 영상 생성이 모두 끝난 뒤 로컬에서 8 phase를 추출하고 검수합니다. Frame 16은 Frame 0과 같은 자세로 닫히는지 확인하는 loop closure 용도이며 최종 8장에는 포함하지 않습니다.

SCAIL-2는 2026-08-12 기준 vLLM-Omni 공식 지원 모델이 아닙니다. RunPod의 FastAPI adapter가 공식 SCAIL-2 pipeline을 로드합니다. 로컬 클라이언트는 입력을 직접 전송하고 결과 MP4를 직접 내려받습니다. S3, bucket과 서버 내부 출력 경로는 사용하지 않습니다.

## 방향별 입력

| 입력 | 파일 예시 | 역할 |
|---|---|---|
| Reference RGB | `references/character-001/front/ref.jpg` | 승인된 방향별 캐릭터 외형 |
| Reference mask | `references/character-001/front/ref_mask.jpg` | reference 인물 영역 |
| Driving RGB | `drivers/master-walk-17f/front/rendered_v2.mp4` | 정확한 17-frame 제자리 걷기 |
| Driving mask | `drivers/master-walk-17f/front/rendered_mask_v2.mp4` | driving 인물 영역 |

네 방향은 서로 다른 동작을 추론하지 않습니다. 하나의 rig, 하나의 animation timeline, 하나의 보행 cycle을 정면·후면·왼쪽·오른쪽 고정 카메라로 렌더합니다. 자세와 발 순서는 prompt가 아니라 driving RGB가 결정하고, prompt는 생성될 영상의 방향·외형·고정 조건만 설명합니다.

## 로컬 디버깅 화면

```bash
cd tools_test
cp .env.example .env.local
# .env.local에 기준 에셋 이미지 endpoint와 SCAIL-2 Pod 값을 입력
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 화면에서 할 수 있는 일은 다음과 같습니다.

- SCAIL-2 Pod 상태와 내부 queue 확인
- 기존 8대 에셋 목록에서 항목별 생성 대상 선택
- 타일·오브젝트·캐릭터 등 항목마다 생성 프롬프트와 seed 편집
- 기준 에셋 이미지 endpoint 연결 확인과 생성
- 항목마다 모델 생성본 또는 직접 업로드한 사진을 여러 장 영구 보관
- 저장된 이미지 썸네일 선택, 크게 보기, 개별 제거
- 캐릭터·생명체 인벤토리 이미지 또는 업로드한 2×2 시트를 네 방향 RGB로 분할
- 분할 결과를 각 방향 탭에서 확인하고 `REFERENCE RGB` Volume 경로에 자동 연결
- 방향별 네 입력 경로와 positive prompt 편집
- 한 방향 또는 네 방향 job 등록
- job 상태, 원본 MP4 경로, 실행 시간 확인
- 로컬 업로드·다운로드용 manifest 저장
- 동일 phase 32 PNG 추출 규칙 확인

기준 에셋 이미지 endpoint는 `RUNPOD_BASE_URL`, `RUNPOD_API_KEY`, `RUNPOD_MODEL_ID`에서 읽고, 동작 endpoint는 `SCAIL2_BASE_URL`, `SCAIL2_API_TOKEN`에서 읽습니다. 실제 endpoint와 token은 코드나 manifest에 넣지 않고 `.env.local`에서만 관리합니다.

## RunPod와 로컬 클라이언트

빈 RunPod Pod에서 이 프로젝트와 공식 SCAIL-2 코드를 `git clone`하고, `uv` 환경 구성, 모델 다운로드·변환, FastAPI 실행까지 필요한 명령과 로컬 요청·다운로드 방법은 [RunPod SCAIL-2 서버와 로컬 클라이언트 실행 가이드](docs/RUNPOD_SCAIL2_GUIDE.md)에 정리했습니다.

`runpod/scail2_api/`는 RunPod에서 실행하고 `runpod/scail2_client/`와 `tools_test/`는 로컬에서 실행합니다. 클라이언트가 네 입력 파일을 multipart로 전송하고, 완료된 MP4를 결과 endpoint에서 내려받습니다.

## 에셋 범위 문서

- [기능 기획서](docs/PRODUCT_PLAN.md)
- [마스터 에셋 카탈로그](docs/ASSET_CATALOG.md)
- [타일 카탈로그](docs/TILE_CATALOG.md)
- [오브젝트 카탈로그](docs/OBJECT_CATALOG.md)
- [캐릭터·오브젝트 상대 크기 규격](docs/SCALE_SYSTEM.md)
- [SCAIL-2 4방향 걷기 생성 전략](docs/SCAIL2_WALK_CYCLE_STRATEGY.md)
- [RunPod SCAIL-2 서버와 로컬 클라이언트 실행 가이드](docs/RUNPOD_SCAIL2_GUIDE.md)

## 검수 원칙

- 4방향 모두 같은 character identity, 의상, 색상, 비율과 화면상 크기를 유지해야 합니다.
- 모든 방향은 같은 ground baseline과 같은 phase timing을 사용해야 합니다.
- 한 방향을 먼저 통과시킨 뒤 동일 설정으로 나머지 방향을 처리합니다.
- 원본 영상 네 개가 모두 생성되기 전에 자동 후처리를 시작하지 않습니다.
- 생성 모델 prompt에 픽셀화를 요구하지 않습니다.
- 실패한 job과 원본 결과도 설정·seed·실행 시간과 함께 기록합니다.
