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
- `캐릭터 방향 기준`: 정면 중립 기준으로 back과 left를 RunPod에서 만들고, right는 left를 수평 반전해 같은 픽셀 구조로 저장한다. 네 방향 기준을 육안 검수·승인한 뒤 동작은 같은 방향 기준에서 파생한다.
- 방향 기준은 슬롯별로 분리한다. `후면·좌측 생성 + 우측 반전`으로 방향 기준을 만들고, `최근 기준 불러오기`로 새로고침 뒤에도 최신 묶음을 복구한다. back/left/right 승인 전까지 전체 동작 생성은 비활성화된다.
- `타일 변형`: 캐릭터 포즈 대신 center/edge/corner/transition/47-tile blob topology 가이드를 표시한다.
- 검은 사각형 윤곽은 실제 출력 비율의 크롭 범위다. 윤곽은 흰 캔버스 안쪽에 잘리지 않게 그리고 정확한 ratio를 유지한다. 캐릭터는 머리가 위 변, 발이 아래 변에 닿도록 사각형을 세로 100% 채우며 모든 픽셀은 내부에 있어야 한다.
- 네 방향은 같은 상단·바닥선과 높이를 사용한다. 방향별로 달라지는 값은 정면 78%, 후면 76%, 좌·우 56%의 가로 점유 폭이다.
- 후처리는 검은 윤곽 내부의 정확한 rect를 크롭한 뒤 선택된 픽셀 규격으로 리사이즈한다. 512×1024 캐릭터 가이드에서는 `506×1012 @ (3,6)`을 크롭해 32×64로 내보낸다.
- I2I 생성 시 승인 기준 A의 흰 여백을 분석해 캐릭터 외곽을 같은 검은 사각형에 맞춰 배치하고, 자동 생성한 레이아웃 B와 함께 `/v1/images/edits`로 전송한다. 외형은 바꾸지 않고 캔버스 배치만 정규화한다.
- 실제 전송 A/B와 OUTPUT을 생성 ID별로 저장하고 세 이미지의 자연 크기와 화면 표시 크기를 같은 파이프라인 카드에서 비교한다.
- 선택 변경, 가이드 생성, A 정규화, 요청 시작·완료·실패, A/B/OUTPUT 렌더 크기를 `[AssetForge][EVENT]` 콘솔 로그로 남긴다. 서버는 `[RunPod][EVENT]` 로그로 health, 참조 파일명·바이트, 출력 저장을 남긴다.
- 동작 배치는 프레임별 PNG/JSON 존재 여부를 확인해 이미 완료된 결과를 건너뛴다. 일시적 요청 오류는 프레임당 최대 3회 재시도하며, 중단 뒤 같은 묶음에서 실패한 프레임부터 재개한다.
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
| 4방향 공통 높이 | 정면 A, 후면, 좌측, 우측 | 정면 전송 A는 윤곽 `y=6~1017`, 후면·좌측·우측 32×64 PNG는 모두 `y=0~63`, 높이 `64px` 통과 |
| 배치 재개 | 9/51 지점에서 endpoint 오류 후 재실행 | 기존 9개 PNG를 건너뛰고 `ToolSwing_Down_02`부터 재요청, 프레임당 3회 자동 재시도 확인 |
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

### 4방향 — 검은 사각형을 같은 높이로 채운 승인 기준

![정면 후면 좌측 우측의 공통 상단과 바닥선](./public/screenshots/08-common-height-direction-output.png)

### RunPod 배치 — 생성 결과와 중단·재개 상태

![9개 완료 결과와 재개 가능한 배치 상태](./public/screenshots/09-runpod-resume-debug.png)
