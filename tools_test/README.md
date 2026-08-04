# 로컬 2D 에셋 생성 디버거

RunPod의 이미지 모델로 만든 기존 4방향 캐릭터·생명체를 `Wan2.2-TI2V-5B-Diffusers`에 보내 방향별 제자리 걷기 영상과 원본 프레임을 확인하는 실험 화면입니다. Qwen 이미지 endpoint가 꺼져 있어도 이미 저장된 시트로 비디오 기능만 검사할 수 있습니다.

![브라우저에서 직접 클릭한 디버깅 과정](public/screenshots/asset-forge-browser-debug.gif)

[생성 에셋 썸네일 갤러리](public/assets/catalog/README.md)에서 종류별 최신 원본과 생성 ID를 바로 확인할 수 있습니다.

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. Node.js 22.13 이상을 사용합니다.

```dotenv
RUNPOD_BASE_URL=https://<POD_ID>-8000.proxy.runpod.net
RUNPOD_API_KEY=
RUNPOD_MODEL_ID=/data/models/Qwen-Image-Edit-2511
RUNPOD_REQUEST_TIMEOUT_MS=600000

RUNPOD_VIDEO_BASE_URL=https://<VIDEO_POD_ID>-8000.proxy.runpod.net
RUNPOD_VIDEO_API_KEY=
RUNPOD_VIDEO_MODEL_ID=/data/models/Wan2.2-TI2V-5B-Diffusers
RUNPOD_VIDEO_REQUEST_TIMEOUT_MS=1200000
RUNPOD_VIDEO_POLL_INTERVAL_MS=3000
```

`.env.local`은 커밋하지 않습니다.

## 비디오만 검사하는 순서

1. `비디오 연결 확인`을 눌러 Wan endpoint의 `/health`와 `/v1/models`만 확인합니다.
2. `최근 캐릭터` 또는 `최근 생명체`를 눌러 로컬에 저장된 2×2 시트를 선택합니다.
3. 화면의 중앙 십자선을 기준으로 정면·후면·오른쪽·왼쪽 셀이 맞는지 확인합니다.
4. `실제 이동`, `추적 보행`, `직접 제자리` 중 생성 방식을 선택합니다. 기본은 `직접 제자리`입니다.
5. 먼저 `오른쪽 이 방향 테스트`를 눌러 옆면에서 좌우 다리 교대와 반대쪽 팔 스윙이 실제로 보이는지 검사합니다.
6. 걷기 동작이 확인된 뒤 `검증 후 4방향 순차 생성`을 누릅니다.
7. 각 결과에서 실제 전송 셀, 원본 MP4, FFmpeg로 추출한 원본 프레임을 비교합니다.

초기 `49 frames` 요청은 정지 화면이나 춤 동작으로 수렴했습니다. `Wan2.2-TI2V-5B` 공식 I2V 예시값에 맞춰 `81 frames`, `50 steps`, `guidance 4`, `flow_shift 12`를 적용하고, `Smooth walk cycle in place` 중심의 짧은 prompt로 바꾼 뒤 오른쪽 측면에서 좌우 발 교대가 확인됐습니다. 이 값은 성공을 보장하는 규격이 아니라 현재 endpoint에서 동작이 확인된 실험 기준입니다. 비디오 prompt에는 픽셀화 지시를 넣지 않고, 생성 결과에는 자동 배경 제거·크로마키·리사이즈를 적용하지 않습니다. 한 방향 결과가 이미 있으면 4방향 순차 실행에서 해당 방향을 유지하고 나머지만 생성합니다.

### 2026-08-05 걷기 실험 현황

| 실험 | 설정 | 결과 |
|---|---|---|
| 직접 제자리, 짧은 길이 | 33~49 frames, flow shift 미지정 | 거의 정지하거나 춤 동작 |
| 실제 이동 | 49 frames, flow shift 미지정 | 위치와 다리 변화가 거의 없는 정지 화면 |
| 직접 제자리, 공식 샘플링 기준 | 81 frames, 50 steps, guidance 4, flow shift 12 | 오른쪽 측면에서 좌우 발 교대 보행 확인 |

확인된 결과 ID는 `WALK-20260804174144-RIGHT-f007af86`이며, 40개 추출 프레임은 브라우저 결과 카드에서 원본 MP4와 함께 확인했습니다. 아직 정면·후면·왼쪽과 다른 캐릭터·생명체의 재현성은 검증 전입니다.

![오른쪽 측면 제자리 걷기 원본 영상 미리보기](public/screenshots/wan-right-walk-official-sampling.gif)

![오른쪽 측면 제자리 걷기 40프레임 검사](public/screenshots/wan-right-walk-official-sampling-frames.png)

이 흐름은 [acatovic/ai-game-studio](https://github.com/acatovic/ai-game-studio)의 `기준 스프라이트 → I2V job polling → 영상 저장 → FFmpeg 프레임 추출 → 프레임 선택` 방식에서 영감을 얻었습니다. RunPod 설정과 API 실행은 [RunPod Wan2.2 걷기 영상 서버 실행 가이드](../docs/RUNPOD_WAN_VIDEO.md)에 정리했습니다.

## 화면에서 확인하는 순서

1. `연결 확인`을 눌러 `/health`와 `/v1/models`를 확인합니다.
2. 캐릭터 역할, 성별 표현, 연령, 체형, 머리, 의상, 특징을 선택합니다.
3. 실제 전송 prompt를 확인하거나 직접 수정합니다.
4. `4방향 캐릭터 생성`을 누릅니다.
5. 화면에 표시된 RunPod 원본에서 정면·후면·오른쪽·왼쪽의 정체성과 크기를 비교합니다.
6. 사용할 결과를 `4방향 기준 A로 승인`합니다.
7. 무기·도구·장비 이미지를 Reference B로 올립니다.
8. `아이템 착용 4방향 생성`을 눌러 A의 캐릭터가 유지되는지 확인합니다.
9. 하단 에셋 대분류에서 필요한 목록을 선택해 기준 원본을 생성합니다.
10. 타일은 원본과 `2×2 REPEAT CHECK`를 함께 보고 반복 경계를 확인합니다.
11. 가이드의 셀 비율, 머리·발 접촉, 포즈가 윤곽 내부에 있는지 확인합니다.

## 기준 에셋 대분류

| 분류 | 화면의 기본 검사 |
|---|---|
| 타일 | 2D 표현, 캔버스 전체 채움, 2×2 반복 시 경계·중앙 구도 |
| 오브젝트 | 정면 중심, 측면·3/4 회전 없음, 전체 실루엣, 잘림 없음 |
| 생명체 | 정면·후면·오른쪽·왼쪽, 같은 종·색·크기 |
| 아이템 | 단일 아이템, 넓은 여백, 캐릭터·손 없음 |
| VFX | 같은 효과의 형성·확장·최대·소멸 진행 |
| UI | 읽기 쉬운 단일 아이콘, 충분한 여백 |
| 가이드 | 실제 셀 비율의 검은 윤곽, 포즈의 머리·발 접촉 |

## 2026-08-04 브라우저 검사 결과

| 대상 | 결과 | 확인 내용 |
|---|---|---|
| 4방향 캐릭터 | 통과 | 한 장에서 정면·후면·우측·좌측 생성, 동일 크기 유지 |
| 한손검 기준 원본 | 통과 | 중앙 단일 검, 전체 노출, 넓은 여백 |
| 한손검 착용 | 부분 통과 | 네 방향 모두 손에 부착, 캐릭터 유지. 흰 배경 편집 잔상은 남음 |
| 잔디 타일 | 실패 기록 | 2D 표현과 경계 연속성은 확보했지만 중앙 사각형 반복 구도가 남음 |
| 나무 오브젝트 | 통과 | 단일 2D 오브젝트, 잘림 없음 |
| 닭 4방향 | 부분 통과 | 네 방향은 정확함. 정면과 측면 체형 차이 및 그림자 발생 |
| 먼지 VFX | 부분 통과 | 형성·확장·최대·소멸 순서는 정확함. 미세 입자 질감이 남음 |
| 체력 UI | 통과 | 단일 아이콘과 여백 유지 |
| 점유·방향·동작 가이드 | 통과 | 로컬 렌더러로 12종 생성, 비율 고정, 머리·발 윤곽 접촉 |

카탈로그 선택 UI는 타일 16종, 오브젝트 20종, 생명체 12종, 아이템 19종, VFX 14종, UI 13종, 가이드 12종까지 총 106개 항목을 브라우저에서 하나씩 클릭해 체크 상태와 prompt 갱신을 확인했습니다.

19:39~20:58 추가 반복 검사에서는 오브젝트 18회, 생명체 8회, 캐릭터 4회를 실제 RunPod로 생성했습니다. 오브젝트의 `front three-quarter view`는 제거했고, 일반 오브젝트는 정면, 농가·축사·온실은 정면 입면 전용 prompt를 사용합니다. 농가는 첫 재시도에서 3/4 농장 장면이 나와 실패 기록으로 남겼고, 정면 입면 지시 뒤 단일 건물 스프라이트로 교정했습니다. 온실도 첫 정면 결과가 축사처럼 나와 유리 벽·유리문·유리지붕 조건으로 다시 생성했습니다.

## 실제 요청

### 4방향 기준 생성

- Endpoint: `/v1/images/edits`
- 이미지: 1024×1024 빈 흰 캔버스 1장
- 출력 셀 순서: front, back, right, left
- 출력 저장: `public/generated/character-sheets/`
- 후처리: 없음

빈 캔버스는 Edit 모델의 필수 입력일 뿐 Reference B가 아닙니다.

### 아이템 착용

- Reference A: 승인한 4방향 시트
- Reference B: 업로드한 실제 아이템
- 출력 저장: `public/generated/runpod/`
- 후처리: 없음

### 기준 에셋

- Endpoint: 로컬 `/api/runpod/asset`
- RunPod 사용: 타일, 오브젝트, 생명체, 아이템, VFX, UI
- 로컬 렌더러 사용: 점유, 4방향, 동작, edge-corner 가이드
- 출력 저장: `public/generated/base-assets/<category>/`
- 생성 중 자동 후처리: 없음
- 타일 반복 미리보기: 원본을 CSS로 2×2 표시하며 파일은 바꾸지 않음

### 에셋 갤러리 정리

생성을 마친 뒤 아래 명령을 실행하면 같은 종류의 가장 최근 결과를 카테고리 폴더로 복사하고, 상위 README와 카테고리별 README에 썸네일 표를 만듭니다.

```bash
node scripts/build-asset-gallery.mjs
```

현재 테스트 세션 이후 결과만 정리하려면 생성 ID의 UTC 타임스탬프를 지정합니다.

```bash
ASSET_GALLERY_SINCE=20260804104200 node scripts/build-asset-gallery.mjs
```

- 원본 생성 기록: `public/generated/` — 로컬 기록, Git에서 제외
- 공유용 최신 에셋: `public/assets/catalog/<category>/`
- 전체 갤러리: `public/assets/catalog/README.md`
- 분류: characters, equipment, objects, creatures, tiles, items, vfx, ui, guides

## 디버그 로그

브라우저 콘솔:

- `[AssetForge][HEALTH_*]`
- `[AssetForge][CHARACTER_REQUEST_*]`
- `[AssetForge][CHARACTER_OUTPUT_RENDERED]`
- `[AssetForge][ITEM_REFERENCE_SELECTED]`
- `[AssetForge][EQUIP_REQUEST_*]`

서버 콘솔:

- `[RunPod][HEALTH_*]`
- `[RunPod][IMAGE_EDIT_*]`
- `[CharacterSheet][REQUEST_*]`
- `[BaseAsset][REQUEST_*]`

로그에는 API key와 base64 이미지 본문을 출력하지 않습니다. 요청 ID, 모델, 파일명·bytes, prompt 길이, seed, steps, 크기, 경과 시간과 오류만 기록합니다.

## 검사

```bash
npm run lint
npm run build
npm test
```
