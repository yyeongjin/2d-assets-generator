# 2D Assets Generator 제품 기획서

- 문서 상태: Draft v0.1
- 작성일: 2026-08-02
- 기준 모델: `Qwen/Qwen-Image`, `Qwen/Qwen-Image-Edit-2509`
- 우선 실행 환경: RunPod GPU Pod

## 1. 제품 정의

### 1.1 한 문장 정의

2D 게임 제작에 필요한 대량의 타일·오브젝트·캐릭터 에셋을 카탈로그에 따라 생성하고, 방향/상태/애니메이션 변형을 확장하며, Unity 투입 전까지 품질과 재현성을 추적하는 제작 도구다.

### 1.2 해결하려는 문제

농장 생활 RPG 같은 게임은 한 가지 화풍 안에서 수천 개의 에셋을 요구한다. 일반 이미지 생성 UI는 좋은 이미지 한 장에는 적합하지만 다음 문제를 해결하지 못한다.

- 어떤 에셋과 변형이 필요한지 전체 수량을 관리하기 어렵다.
- 프롬프트를 매번 손으로 작성해 스타일과 규격이 흔들린다.
- 동일 캐릭터의 정면/후면/측면 및 동작 사이 정체성이 깨진다.
- 타일 연결, pivot, 프레임 정렬, 투명도처럼 게임 엔진에 필요한 조건을 검증하지 않는다.
- 생성 당시의 모델과 seed를 잃어버려 결과를 재현하기 어렵다.

### 1.3 제품 원칙

1. 생성의 단위는 이미지 한 장이 아니라 `asset + variant + provenance`다.
2. 에셋 카탈로그가 생성 큐와 진행률의 단일 기준점이 된다.
3. 모델이 잘하는 원화 생성과 코드가 잘하는 정렬/패킹/검증을 분리한다.
4. 모든 생성 결과는 원본 입력과 설정으로 추적 가능해야 한다.
5. 최종 합격 기준은 Unity 테스트 씬에서의 동작이다.

## 2. 사용자와 핵심 시나리오

### 2.1 주 사용자

- 소규모 게임 개발자 또는 테크니컬 아티스트
- RunPod에서 생성 모델을 운용하고 로컬 Unity 프로젝트에서 결과를 검증하는 사용자

### 2.2 핵심 시나리오

1. 새 프로젝트를 만들고 타일 크기, 출력 크기, 팔레트, 시점, 광원, 외곽선 규칙을 스타일 프리셋으로 저장한다.
2. 카탈로그에서 `character.npc.blacksmith`를 선택하고 속성 폼으로 기준 캐릭터 후보를 만든다.
3. 후보 하나를 승인한 뒤 방향과 동작을 선택하고 포즈 가이드와 함께 I2I 배치를 실행한다.
4. 프레임 정렬과 시트 패킹 결과를 미리보기에서 확인하고 Unity로 내보낸다.
5. Unity 테스트 씬에서 scale, pivot, animation, sorting 문제를 기록하고 해당 generation으로 돌아와 다시 생성한다.
6. 대시보드에서 카탈로그의 완료/검수/실패/미생성 수량을 확인한다.

## 3. 제품 범위

상세 제작 대상은 문서 역할에 따라 분리한다.

- `ASSET_CATALOG.md`: 전체 분류와 P0 플레이 가능 뼈대
- `TILE_CATALOG.md`: 지형, 전이, 길, 구조물, 실내 타일 표
- `OBJECT_CATALOG.md`: 자연물, 농장, 설비, 건물, 마을, 실내, 광산 오브젝트 표

### 3.1 MVP 포함

- 단일 사용자, 단일 GPU worker
- 프로젝트와 스타일 프리셋 생성
- T2I 기준 에셋 후보 생성 및 승인
- 캐릭터 기준 이미지 + 레이아웃 가이드 기반 I2I 생성
- 4방향과 핵심 동작 프리셋
- 이미지 후처리와 스프라이트 시트 패킹
- 생성 이력, 비교, 승인/반려
- PNG + JSON manifest Unity 내보내기
- 에셋 카탈로그 진행률

### 3.2 MVP 제외

- 모델 학습과 LoRA 학습 UI
- 여러 사용자의 동시 편집 및 권한 관리
- 결제/과금 시스템
- 완전 자동 품질 승인
- 게임 코드나 밸런스 데이터 생성
- 특정 상용 게임의 화풍 또는 원본 에셋 복제

## 4. 도구 1 — 기준 에셋 생성기(T2I)

### 4.1 목적

타일 소재, 오브젝트 디자인, 캐릭터 기준 턴어라운드의 출발점 등 각 asset family의 대표 이미지를 만든다.

### 4.2 화면 구성

1. **프로젝트/프리셋 바**: 프로젝트, 모델, 스타일, 팔레트, 캔버스 규격 선택
2. **에셋 유형 패널**: 대분류와 세부 유형 선택
3. **조건 패널**: 유형에 따라 필요한 필드만 동적으로 표시
4. **프롬프트 패널**: 자동 조립 결과, 사용자 추가 지시, negative prompt
5. **생성 설정**: seed, 후보 수, steps, true CFG, 크기
6. **결과 보드**: 후보 비교, 즐겨찾기, 승인, 반려, 재생성

### 4.3 공통 입력 필드

| 그룹 | 필드 |
|---|---|
| 식별 | asset ID, 표시 이름, 카테고리, 태그 |
| 스타일 | 시점, 투영 방식, 픽셀 밀도, 팔레트, 외곽선, 음영 단계, 광원 방향 |
| 배치 | 캔버스 비율, 차지 비율, 여백, 바닥 접점, 그림자 정책 |
| 생성 | prompt 보충문, negative prompt, seed, steps, true CFG, 후보 수 |
| 출력 | 기준 셀 크기, 출력 배율, 배경/알파 정책, 파일 이름 |

### 4.4 유형별 조건

#### 캐릭터

서로 배타적인 값은 체크박스가 아니라 단일 선택(chip/radio/select), 함께 적용 가능한 특징은 다중 선택을 사용한다.

- 역할: 플레이어, NPC, 상인, 농부, 대장장이, 의사, 모험가 등
- 성별 표현, 연령대, 키/체형, 피부색
- 얼굴형, 눈, 머리 모양/색, 수염
- 상의, 하의, 신발, 겉옷, 모자, 액세서리
- 직업 소품, 기본 표정, 성격 키워드
- 인간형/비인간형, 종족 특징
- 좌우 비대칭 요소와 반드시 유지할 identity key

#### 타일

- 환경/바이옴, 소재, 계절, 건조/젖음, 손상 상태
- seamless 여부, autotile 규칙, 가장자리와 코너 요구
- 반복 허용 정도, 장식 밀도, 애니메이션 여부
- 보행 가능/불가, 높이 레벨, 그림자 수신 정책

#### 오브젝트

- 기능, 소재, 크기(cell 단위), 배치 환경
- 상태 목록, 상호작용, 방향 수, 애니메이션 여부
- pivot, 바닥 접점, 충돌 영역, 그림자 분리 여부

### 4.5 프롬프트 조립 순서

`프로젝트 스타일 고정문 → 에셋 정체성 → 시점/구도 → 재질/색 → 상태/동작 → 게임 규격 → 배경/금지 조건 → 사용자 지시`

자동 프롬프트는 숨기지 않는다. 사용자가 각 fragment의 활성 여부와 최종 문장을 확인하고 편집할 수 있어야 한다.

### 4.6 출력

- 원본 모델 출력
- 후처리 미리보기
- 사용한 prompt/settings JSON
- 썸네일
- 승인 시 immutable 기준 asset revision

## 5. 도구 2 — 방향·동작·스프라이트 생성기(I2I)

### 5.1 입력 슬롯

`Qwen-Image-Edit-2509`는 다중 이미지 편집을 지원하고 1~3개 입력에서 최적 성능을 안내한다. 이를 다음 역할로 고정한다.

| 슬롯 | 필수 | 역할 |
|---|---:|---|
| Reference A | 예 | 승인된 캐릭터/오브젝트의 정체성, 색, 재질 |
| Reference B | 예 | 레이아웃, 방향, 포즈 또는 keypoint/실루엣 가이드 |
| Reference C | 아니요 | 무기, 도구, 의상, 제품 또는 추가 스타일 참조 |

레이아웃 가이드는 흰 배경 위 검은 도형으로 만든다. 정사각형/직사각형은 목표 점유 영역과 바닥면을 나타내고, 캐릭터 가이드는 머리·몸통·손·발의 위치 및 장비 궤적을 추가할 수 있다.

### 5.2 입력에 따른 옵션 활성화

- 캐릭터 입력: 방향, 동작, 장비 손, 표정, 프레임 수, loop 옵션 활성화
- 오브젝트 입력: 상태, 방향, 열림 정도, 내용물, 작동 프레임 활성화
- 타일 입력: 가장자리/코너, 계절, 젖음, 연결 규칙 활성화
- building 입력: 업그레이드 단계, 문/창문 상태, 계절 장식 활성화

### 5.3 캐릭터 방향

- front / north-facing camera 기준 정면 표현
- back
- left
- right

좌우가 대칭인 캐릭터는 한쪽을 생성해 mirror할 수 있으나, 가방·흉터·무기 손처럼 비대칭 특징이 있으면 좌우를 각각 생성한다. 이 정책은 asset 단위로 기록한다.

### 5.4 캐릭터 동작 프리셋

| ID | 동작 | 핵심 제약 |
|---|---|---|
| `idle` | 대기 | 발 접점과 몸 중심 고정 |
| `walk_empty` | 빈손 걷기 | 좌우 발 교차, loop 가능 |
| `weapon_1h` | 한손 무기 들기/공격 | 손잡이 위치와 주 사용 손 고정 |
| `weapon_2h` | 양손 무기 들기/공격 | 두 손 간 거리와 무기 축 유지 |
| `tool_swing` | 도구 휘두르기 | 준비-타격-회수, 궤적 일관성 |
| `bow_shoot` | 활 쏘기 | 당기기-릴리스, 활/화살 방향 |
| `carry_front` | 물건을 앞에 들기 | 물체가 양손 앞, 얼굴 비가림 제한 |
| `carry_overhead` | 물건을 머리 위에 들기 | 팔과 물체 높이, 실루엣 여백 확보 |

프레임 수는 프리셋 기본값을 제공하되 프로젝트에서 변경할 수 있게 한다. 프레임별 이미지를 무관하게 한 번씩 생성하지 않고, 동일 generation group과 가이드 세트로 묶어 정체성 검수를 수행한다.

### 5.5 결정론적 후처리

모델 출력 이후 다음 단계는 같은 입력에 항상 같은 결과를 내야 한다.

1. 배경 제거 또는 배경색 키잉
2. 빈 영역 crop과 기준 캔버스 배치
3. 바닥 접점/중심선 정렬
4. 투명 여백과 alpha edge 정리
5. 목표 해상도로 nearest-neighbor 축소
6. 선택적 팔레트 quantization 및 dithering
7. 프레임별 bbox 검사
8. 고정 순서로 sprite sheet pack
9. rect, pivot, duration, event를 manifest에 기록

AI 출력에 정확한 픽셀 격자, 타일 이음새, 프레임 위치를 전적으로 맡기지 않는다.

## 6. 생성 디버거

### 6.1 비교 화면

- Reference A/B/C, 원본 출력, 후처리 출력 동시 표시
- checkerboard/흰색/검은색/게임 배경 전환
- nearest-neighbor 1x/2x/4x/8x 확대
- onion skin 및 animation loop 재생
- 두 세대 간 slider/깜박임 비교
- 프레임 중심선, 바닥선, bbox, pivot, collision overlay

### 6.2 기록 항목

| 구분 | 기록 |
|---|---|
| 모델 | model ID, revision, pipeline class, dtype |
| 생성 | seed, steps, true CFG, width/height, prompt, negative prompt |
| 입력 | 각 이미지 경로, SHA-256, 역할, 전처리 정보 |
| 출력 | 파일 해시, 크기, alpha, palette, 후처리 버전 |
| 실행 | job ID, 시작/종료 시각, GPU, VRAM peak, 소요 시간, 오류 |
| 검수 | 자동 검사 결과, 승인 상태, 사유, 사용자 메모 |

### 6.3 자동 검사

- 파일 크기/색상 모드/알파 채널
- sprite rect와 canvas 경계 초과
- 바닥 접점, pivot, 프레임 bbox 편차
- 방향별 크기와 대표 색상 분포 편차
- animation loop 첫/마지막 프레임 급변
- 타일 가장자리 픽셀 불일치와 반복 시 seam
- 파일 누락, 중복 ID, manifest 불일치

자동 검사는 합격을 보장하지 않는다. 의심 결과를 빠르게 찾는 필터로 사용한다.

## 7. Unity 연동

### 7.1 1차 내보내기 계약

```text
export/<project>/<asset_id>/<revision>/
├── source.png
├── spritesheet.png
├── manifest.json
└── preview.gif
```

manifest 필수 항목:

- asset ID, revision, category, tags
- texture width/height, filter mode, compression, pixels per unit
- 각 frame의 name, rect, pivot, duration, direction, action
- sorting point, shadow anchor, collision shapes
- source generation ID와 input hashes

### 7.2 Unity Editor importer 목표

- manifest를 읽어 TextureImporter 설정 적용
- Sprite Editor rect/pivot 자동 생성
- 방향/동작별 AnimationClip 및 AnimatorOverrideController 생성
- Tile/RuleTile과 prefab 초안 생성
- 테스트 씬에 선택 asset을 배치하고 배경/조명/배율 전환
- 문제 프레임과 generation ID를 복사해 생성기로 되돌아갈 수 있게 함

## 8. 정보 구조와 데이터 모델

### 8.1 핵심 엔티티

- `Project`: 해상도, 팔레트, 시점, Unity 설정
- `StylePreset`: 모든 asset에 반복 적용할 시각 규칙과 prompt fragments
- `CatalogEntry`: 만들어야 할 asset family와 variant 요구
- `Asset`: 승인된 논리적 게임 자산
- `AssetRevision`: 기준 이미지/시트의 불변 버전
- `GenerationJob`: 입력, 설정, 상태, 로그
- `GenerationResult`: 원본/후처리 파일과 측정값
- `Guide`: layout/pose/autotile template
- `Review`: 승인/반려와 사유
- `Export`: Unity 전달 묶음

### 8.2 ID 규칙 예시

```text
tile.terrain.grass.spring
tile.water.shore.outer_corner.ne
object.nature.tree.oak.mature.summer
object.farm.chest.wood.closed
character.npc.blacksmith.walk.front.frame_00
item.tool.watering_can.copper
vfx.harvest.leaf.frame_03
```

표시 이름은 바뀔 수 있지만 ID는 한번 배포한 뒤 바꾸지 않는다.

### 8.3 상태 흐름

`planned → queued → generating → generated → review_needed → approved/rejected → exported → unity_verified`

## 9. 시스템 구조

### 9.1 MVP 구성

- **Gradio UI**: 폼, 큐, 결과 비교, 카탈로그 진행률
- **Application service**: prompt 조립, job 상태, 승인, export
- **GPU worker**: T2I/I2I pipeline을 프로세스 시작 시 1회 load
- **Post-processor**: crop, alpha, scale, palette, sheet pack, 검사
- **Storage**: 프로젝트 디렉터리 + SQLite
- **Unity importer**: 별도 Unity package

UI 코드가 Diffusers를 직접 호출하지 않게 하여 이후 FastAPI/웹 UI 또는 RunPod Endpoint로 교체할 수 있게 한다.

### 9.2 RunPod 디렉터리 권장안

```text
/workspace/models/       # Hugging Face cache, persistent volume
/workspace/projects/     # source, result, manifests, database
/workspace/app/          # repository checkout
```

- 모델은 worker 시작 시 load하고 job마다 다시 읽지 않는다.
- `bfloat16`을 기본으로 시작하며 실제 GPU별 VRAM/시간을 benchmark한다.
- OOM 시 CPU offload, quantization, attention backend는 별도 프로필로 제공한다.
- 라이브러리와 모델 revision을 lock해 재현성을 유지한다.

### 9.3 논리 API

| 메서드 | 경로 | 역할 |
|---|---|---|
| POST | `/projects` | 프로젝트 생성 |
| GET | `/catalog` | 필터된 카탈로그/진행률 |
| POST | `/prompts/preview` | 폼 입력으로 prompt 미리보기 |
| POST | `/jobs/t2i` | 기준 에셋 생성 job |
| POST | `/jobs/i2i` | 방향/상태/동작 생성 job |
| GET | `/jobs/{id}` | 상태, 로그, 결과 |
| POST | `/results/{id}/review` | 승인/반려 |
| POST | `/assets/{id}/pack` | 시트와 manifest 생성 |
| POST | `/exports/unity` | Unity export 생성 |

MVP에서는 함수 경계로 먼저 구현하고, 원격 분리가 필요할 때 HTTP API로 노출한다.

## 10. 품질 기준

### 10.1 공통

- 프로젝트 스타일/팔레트/광원 규칙 준수
- 지정 캔버스와 바닥 접점 준수
- 깨진 실루엣, 잘린 부분, 불필요한 텍스트 없음
- 투명 배경과 깨끗한 alpha edge
- generation provenance 100% 기록

### 10.2 캐릭터

- 방향·동작 전체에서 얼굴, 머리, 의상, 체형, 대표 색 유지
- 발 위치가 기준선에서 허용 오차 이내
- 장비가 손에서 분리되거나 프레임마다 형태가 바뀌지 않음
- loop에서 명백한 위치 점프 없음

### 10.3 타일

- 동일 tile을 반복해도 경계선이 보이지 않음
- 모든 autotile 인접 조합에서 빈 픽셀/잘못된 전이 없음
- 계절 variant 사이 형태가 대응됨
- collision 및 walkability metadata 존재

### 10.4 오브젝트

- 모든 상태에서 크기, pivot, 바닥 접점 유지
- 실제 상호작용 영역과 collision shape가 일치
- 뒤로 지나갈 수 있는 큰 오브젝트는 sorting point 정의

## 11. 마일스톤과 완료 조건

### M0 — 생성 실험대

- RunPod에서 T2I와 2509 I2I 각각 성공
- 입력/설정/결과를 한 job 폴더에 저장
- 고정 seed 재실행 절차 문서화

### M1 — 기준 에셋 생성기

- character/tile/object 세 유형의 동적 폼
- prompt preview 및 수동 편집
- 후보 4장 생성, 승인/반려, 기준 asset 등록
- 카탈로그 상태 반영

### M2 — 캐릭터 스프라이트 vertical slice

- 동일 캐릭터 4방향 idle + walk 완성
- `tool_swing`, `carry_overhead` 각각 한 동작 완성
- 프레임 정렬, 시트 패킹, 미리보기
- identity/foot alignment 수동 QA 통과

### M3 — 월드 vertical slice

- 풀/흙/경작지/물/해안/길 autotile 세트
- 나무/바위/상자/문/제작 설비 상태 variant
- 계절 2종 이상과 물 애니메이션
- tile seam 자동 테스트 통과

### M4 — Unity 검증

- manifest import와 sprite slicing 자동화
- AnimationClip/RuleTile 생성
- 테스트 씬에서 이동, 타일링, 정렬, 충돌 확인
- Unity에서 발견한 문제를 generation ID로 추적

### M5 — 대량 생산

- 카탈로그 batch queue, 우선순위, 재시도
- 중단 후 재개와 실패 격리
- 에셋별 비용/시간/성공률 리포트
- P0 카탈로그 100%가 `unity_verified` 상태

## 12. 주요 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 방향/프레임마다 캐릭터 정체성 변화 | 기준 asset 고정, pose guide, identity key prompt, 그룹 QA, 필요 시 LoRA 연구 |
| AI가 정확한 tile seam을 만들지 못함 | 모델은 소재 원본을 만들고 autotile mask와 경계 합성은 코드로 처리 |
| 고해상도 출력의 축소 결과가 흐림 | nearest-neighbor 축소, 제한 팔레트, outline/alpha 후처리, 실제 해상도 미리보기 |
| RunPod OOM과 느린 cold start | persistent model cache, worker 상주, GPU 프로필 benchmark, offload/quantization 선택지 |
| 모델/라이브러리 업데이트로 결과 변화 | dependency lock, model revision 및 pipeline class 기록 |
| 수천 개 결과의 검수 병목 | 카탈로그 우선순위, contact sheet, 자동 이상 탐지, generation group 승인 |
| 라이선스/유사성 문제 | 모델 라이선스와 출력 정책 확인, 독창적 스타일 프리셋, 참조 이미지 출처 기록 |

## 13. 제품 지표

- 카탈로그 완료율: planned 대비 approved/exported/unity_verified 비율
- 첫 승인까지의 평균 generation 수
- direction/action 세트 identity QA 통과율
- tile seam 자동 검사 통과율
- Unity import 후 수동 수정이 필요 없는 asset 비율
- asset당 GPU 시간 및 재생성률
- 동일 설정 재실행 시 provenance 누락률(목표 0%)

## 14. 구현 전 결정할 항목

아래 값은 첫 vertical slice 전에 프로젝트 설정으로 확정한다.

- 기준 tile 크기와 캐릭터 canvas 크기(예: 16/32/48/64 px 중 선택)
- orthographic/top-down/3-quarter 시점과 카메라 각도
- 제한 팔레트 사용 여부와 색상 수
- 좌우 방향 mirror 정책
- 캐릭터 동작별 frame 수와 FPS
- Unity PPU, pivot, sorting 기준, Tilemap/RuleTile 버전
- 배경 제거 방식과 그림자 분리 정책
- RunPod 목표 GPU와 허용 가능한 job당 시간/비용

## 15. 참고 자료

- [Hugging Face Diffusers — QwenImage pipelines](https://huggingface.co/docs/diffusers/api/pipelines/qwenimage)
- [Qwen/Qwen-Image-Edit-2509 model card](https://huggingface.co/Qwen/Qwen-Image-Edit-2509)
- [QwenLM/Qwen-Image](https://github.com/QwenLM/Qwen-Image)
