# 로컬 에셋 생성 디버깅 도구

에셋 생성 흐름, 체크박스, 실제 출력 비율의 검은 윤곽 레이아웃, 접지선, 생성 슬롯, 로컬 히스토리와 RunPod Image Edit 요청을 확인하는 Next.js 도구다.

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 연다. Node.js 22.13 이상을 사용한다.

`.env.local`에는 `RUNPOD_BASE_URL`, 선택적 `RUNPOD_API_KEY`, `RUNPOD_MODEL_ID`, `RUNPOD_REQUEST_TIMEOUT_MS`를 설정한다. 키와 endpoint는 코드나 커밋에 넣지 않는다.

## 화면 구조

- `기준 에셋 생성`: 문서 카탈로그의 타일, 오브젝트, 캐릭터, 생명체, 아이템, VFX, UI, 가이드 8분류와 세부 family를 선택한다. 이 단계에는 레이아웃 이미지를 사용하지 않는다.
- `방향 · 동작 변형`: 캐릭터·오브젝트·타일만 다룬다. 캐릭터는 방향별 무동작 승인 기준(Reference A)과 선택한 방향·동작의 자동 레이아웃 가이드(Reference B)를 사용한다.
- `캐릭터 방향 기준`: 정면 중립 기준으로 front/back/left/right 기준을 먼저 승인하고, 동작은 같은 방향 기준에서 파생한다. 정면·후면과 좌·우 측면은 같은 rect를 쓰되 내부 점유 폭과 포즈가 다르다.
- 방향 기준은 슬롯별로 분리한다. front만 기본 테스트 기준이 등록되어 있으며 back/left/right는 해당 방향을 선택한 뒤 `교체`로 승인 이미지를 등록하기 전까지 RunPod 생성 버튼이 비활성화된다.
- `타일 변형`: 캐릭터 포즈 대신 center/edge/corner/transition/47-tile blob topology 가이드를 표시한다.
- 검은 사각형 윤곽은 실제 출력 비율의 크롭 범위다. 생성 대상의 모든 픽셀은 윤곽 안에 있어야 하며, 발이나 오브젝트 밑면은 윤곽 아랫변에 닿는다.
- 후처리는 검은 윤곽 기준 크롭 후 선택된 픽셀 규격으로 리사이즈한다.
- I2I 생성 시 승인 기준 A를 가이드 캔버스와 같은 크기의 흰 캔버스로 정규화하고, 자동 생성한 레이아웃 B와 함께 `/v1/images/edits`로 전송한다.
- 실제 전송 A/B와 OUTPUT을 생성 ID별로 저장하고 세 이미지의 자연 크기와 화면 표시 크기를 같은 파이프라인 카드에서 비교한다.
- 선택 변경, 가이드 생성, A 정규화, 요청 시작·완료·실패, A/B/OUTPUT 렌더 크기를 `[AssetForge][EVENT]` 콘솔 로그로 남긴다. 서버는 `[RunPod][EVENT]` 로그로 health, 참조 파일명·바이트, 출력 저장을 남긴다.
- 화면 설정과 히스토리는 브라우저 `localStorage`에 저장한다.

## 검사

```bash
npm test
```

소스 규칙 검사와 production build를 함께 실행한다.

## 브라우저 클릭 검증 기록

로컬 `http://localhost:3000`에서 다음 항목을 직접 클릭해 확인했다.

| 구분 | 클릭 항목 | 확인 결과 |
|---|---|---|
| 도구 1 | 타일, 오브젝트, 캐릭터, 생명체, 아이템, VFX, UI, 가이드 | 8분류 모두 해당 family·옵션·후보 화면으로 전환 |
| 캐릭터 방향 | front, back, left, right | 점유 폭 `78%`, `76%`, `56%`, `56%`와 방향별 Reference A 변경 |
| 캐릭터 동작 | `walk_empty`, `weapon_1h`, `weapon_2h`, `tool_swing`, `bow_shoot`, `carry_front`, `carry_overhead` | 프레임 슬롯 `4`, `2`, `2`, `4`, `3`, `1`, `1`과 내부 포즈 변경. 걷기는 골반 연결점을 유지하고 각도별 다리 길이를 보정해 양발의 바닥선 접촉 유지 |
| 걷기 프레임 | `Walk_Down_01~04`, `Walk_Up_01~04`, `Walk_Left_01~04`, `Walk_Right_01~04` | 4프레임을 직접 클릭해 선택 ID와 포즈 프레임 번호 변경, 모든 포즈의 크롭 내부 포함과 발끝 접지 확인 |
| RunPod 생성 | front / `Walk_Down_01` / 빈손 걷기 | 실제 A·B를 각각 `512×1024`로 전송하고 `512×1024` OUTPUT을 3000 화면에 표시. A/B/OUTPUT 셸은 모두 `75×150`, 내부 이미지는 `64×139`로 동일 |
| 오브젝트 | 일반 나무, 농가 | 윤곽 ratio와 출력이 `3:5 / 96×160`, `6:7 / 192×224`로 변경 |
| 타일 | center, edge, outer corner, inner corner, transition, 47-tile blob | 6개 topology 가이드 모두 변경 |
| 히스토리 | 현재 설정 저장 | `LOCAL-*` 항목 추가와 대기 상태 집계 변경 |

## 화면 캡처

### 도구 1 — 전체 대분류와 타일 기준 후보

![도구 1 전체 에셋 카탈로그](./public/screenshots/01-t2i-full-catalog.png)

### 캐릭터 — 방향별 기준과 바닥선에 닿는 빈손 걷기

![방향별 캐릭터 기준과 빈손 걷기 접지](./public/screenshots/02-i2i-direction-layouts.png)

### 오브젝트 — 농가 6:7 규격 윤곽과 접지선

![농가 오브젝트 규격 레이아웃](./public/screenshots/03-i2i-object-layout.png)

### 타일 — transition topology 가이드

![타일 transition 레이아웃](./public/screenshots/04-i2i-tile-layout.png)

### 캐릭터 — 실제 클릭 검증한 4개 걷기 프레임

![Walk Down 4프레임과 크롭 내부 접지 검증](./public/screenshots/05-i2i-walk-frames-verified.jpg)

### RunPod — 실제 전송 A/B와 3000 화면의 OUTPUT

![동일한 512x1024 캔버스의 Reference A, Reference B, RunPod 출력](./public/screenshots/06-runpod-result-three-canvas.jpg)

### 방향별 Reference A — front 승인, 나머지 방향 등록 대기

![front 승인 기준과 back left right 미등록 게이트](./public/screenshots/07-direction-reference-gates.jpg)
