# 2D Assets Generator

농장 생활 RPG에 필요한 타일, 오브젝트, 캐릭터, 생명체, 아이템, VFX와 UI 에셋을 항목별로 생성하고 보관하기 위한 로컬 작업 도구입니다.

현재 저장소는 완성된 생성 품질을 보여주는 결과물이 아닙니다. 수천 개의 에셋을 실제로 관리할 수 있는 입력 구조, 저장 방식, 방향 분할과 동작 생성 흐름을 확인하기 위한 작업 현황입니다.

## 현재 화면

### 캐릭터 조건과 4방향 기준 시트

캐릭터의 역할, 성별 표현, 연령, 체형, 머리, 의상과 특징을 선택하거나 랜덤으로 조합합니다. 실제 전송 prompt를 직접 수정할 수 있으며, 생성된 `2×2` 4방향 시트는 캐릭터 인벤토리에 계속 저장됩니다.

![캐릭터 조건과 4방향 기준 시트](tools_test/public/screenshots/current-workbench.png)

### 저장된 4방향 시트 분할과 방향별 입력

인벤토리에서 캐릭터 또는 생명체의 `2×2` 시트를 선택하고 `좌상=정면`, `우상=후면`, `좌하=오른쪽`, `우하=왼쪽` 규칙으로 네 Reference RGB를 만듭니다. Reference mask와 방향별 Driving RGB·mask는 별도 입력입니다.

![4방향 시트 분할과 SCAIL-2 입력](tools_test/public/screenshots/current-character-generator.png)

### 에셋 목록과 항목별 이미지 인벤토리

타일·오브젝트·캐릭터·생명체·아이템·VFX·UI·가이드 목록을 유지합니다. 목록의 각 항목마다 prompt와 seed를 편집하고, 생성 이미지 또는 직접 업로드한 이미지를 여러 장 저장하고 선택하거나 제거할 수 있습니다.

![에셋 목록과 항목별 이미지 인벤토리](tools_test/public/screenshots/current-asset-catalog.png)

## 도구가 다루는 작업

### 기준 에셋 생성과 보관

- 타일, 오브젝트, 캐릭터, 생명체, 아이템, VFX, UI, 가이드의 생성 대상 목록
- 대상마다 독립된 생성 prompt와 seed
- 생성 이미지와 직접 업로드한 이미지의 항목별 인벤토리
- 저장 이미지 선택, 크게 보기와 개별 제거
- 캐릭터 조건 선택과 유형별 랜덤 조합
- 캐릭터 `2×2` 4방향 시트 생성 및 누적 저장

생성 이미지와 메타데이터는 로컬 `tools_test/app/generated/` 아래에 저장합니다. 화면의 인벤토리는 이 파일들을 다시 읽어 구성하므로 최신 결과 하나만 사용하는 구조가 아닙니다.

### 4방향 걷기 동작 생성

SCAIL-2에는 방향마다 다음 네 파일을 하나의 job으로 전달합니다.

| 입력 | 역할 |
|---|---|
| Reference RGB | 해당 방향의 캐릭터 또는 생명체 외형 |
| Reference mask | Reference RGB의 대상 영역 |
| Driving RGB 17F | 해당 방향에서 렌더링한 17-frame closed walk |
| Driving mask 17F | Driving RGB의 대상 영역 |

정면·후면·왼쪽·오른쪽은 하나의 rig와 하나의 animation timeline을 네 고정 카메라로 렌더한 Driving 영상을 사용합니다. 자세와 발 순서는 prompt가 아니라 Driving RGB가 결정합니다.

## 전체 흐름

```text
로컬 :3000 화면
  ├─ 기준 에셋 목록과 항목별 인벤토리
  ├─ 캐릭터 조건·랜덤 4방향 시트 생성
  ├─ 저장된 2×2 시트 선택과 네 방향 RGB 분할
  └─ 방향별 RGB·mask·17F driver를 Next API에 전달
                         │
                         ▼
로컬 Next API proxy
  ├─ RunPod endpoint와 token은 서버 환경변수에서만 읽음
  └─ multipart 등록·상태 조회·결과 다운로드를 중계
                         │
                         ▼
RunPod On-Demand Pod
  ├─ SCAIL-2를 Pod 시작 시 한 번 로드
  ├─ FastAPI :8000
  ├─ 단일 GPU 직렬 queue
  ├─ 202 + job_id 반환
  └─ 방향별 raw MP4 생성
                         │
                         ▼
로컬 클라이언트
  ├─ MP4 다운로드와 재생
  ├─ 네 방향 생성 완료 후 동일 phase PNG 추출
  └─ 다운로드 확인 후 RunPod 임시 job 제거
```

브라우저는 RunPod로 직접 요청하지 않습니다. 같은 origin의 Next API proxy만 호출하므로 token이 브라우저에 노출되지 않고 RunPod 서버에 별도 CORS 허용도 필요하지 않습니다. Python 클라이언트는 RunPod FastAPI에 직접 요청할 수 있습니다.

## SCAIL-2 처리 규칙

- SCAIL-2는 vLLM으로 실행하지 않습니다. RunPod FastAPI adapter가 공식 pipeline을 직접 로드합니다.
- SCAIL config는 공식 저장소 내부 파일의 절대경로로 전달합니다.
- Driving RGB와 Driving mask는 GPU queue에 넣기 전에 각각 정확히 17프레임인지 검사합니다.
- 모델 생성은 raw MP4까지 담당합니다.
- PNG 추출, 픽셀화, 리사이즈와 스프라이트 패킹은 네 방향 생성이 모두 끝난 뒤 로컬에서 따로 실행합니다.
- `0·2·4·6·8·10·12·14` 프레임을 동일 phase 후보로 사용합니다.
- Frame 16은 Frame 0과 같은 자세로 닫히는지 확인하는 loop closure 검사용이며 최종 8장에서는 제외합니다.
- RunPod HTTP 연결에 긴 추론을 매달지 않고 `POST → 202 job_id → polling → output download` 순서로 처리합니다.

## 로컬 실행

```bash
cd tools_test
cp .env.example .env.local
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

```dotenv
# 기준 에셋 이미지 endpoint
RUNPOD_BASE_URL=
RUNPOD_API_KEY=
RUNPOD_MODEL_ID=

# SCAIL-2 FastAPI endpoint
SCAIL2_BASE_URL=
SCAIL2_API_TOKEN=
```

실제 endpoint와 token은 코드, README와 manifest에 기록하지 않습니다.

## RunPod와 로컬의 책임

| 위치 | 실행하는 것 |
|---|---|
| RunPod | 공식 `zai-org/SCAIL-2` clone, `uv` 환경 구성, checkpoint 준비, FastAPI adapter 실행, GPU 추론 |
| 로컬 | `tools_test` 화면, 에셋 인벤토리, multipart 요청, polling, MP4 다운로드, 프레임 추출과 후처리 |

빈 RunPod Pod에서 개인 프로젝트 저장소를 clone하거나 `scp`로 파일을 옮기는 과정은 필요하지 않습니다. RunPod 터미널에서 공식 SCAIL-2 저장소를 clone하고 FastAPI adapter 파일을 `cat <<'EOF'`로 만드는 전체 명령은 [RunPod SCAIL-2 실행 가이드](docs/RUNPOD_SCAIL2_GUIDE.md)에 정리했습니다.

## 에셋 범위 문서

- [기능 기획서](docs/PRODUCT_PLAN.md)
- [마스터 에셋 카탈로그](docs/ASSET_CATALOG.md)
- [타일 카탈로그](docs/TILE_CATALOG.md)
- [오브젝트 카탈로그](docs/OBJECT_CATALOG.md)
- [캐릭터·오브젝트 상대 크기 규격](docs/SCALE_SYSTEM.md)
- [SCAIL-2 4방향 걷기 생성 전략](docs/SCAIL2_WALK_CYCLE_STRATEGY.md)
- [RunPod SCAIL-2 실행 가이드](docs/RUNPOD_SCAIL2_GUIDE.md)

## 현재 검수 기준

- 네 방향 모두 같은 캐릭터 정체성, 의상, 색상, 비율과 화면상 크기를 유지해야 합니다.
- 네 방향 모두 같은 ground baseline과 같은 phase timing을 사용해야 합니다.
- 생성 prompt에는 픽셀화를 요구하지 않습니다.
- 네 방향의 원본 MP4가 모두 생성되기 전에 후처리를 자동으로 시작하지 않습니다.
- 실패 결과도 입력, prompt, seed와 실행 시간을 함께 남겨 다음 실험에서 비교합니다.
