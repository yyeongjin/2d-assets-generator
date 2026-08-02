# 타일 카탈로그

농장 생활 RPG형 2D 월드의 기본 뼈대에 필요한 타일 family를 카테고리별 표로 정의한다.

## 1. 공통 규격

| 항목 | 원칙 |
|---|---|
| Tile size | 프로젝트 설정값. 32×32 px 등 실제 게임 규격에 맞춰 결정 |
| 생성 크기 | 모델 친화적 고해상도로 생성 후 결정론적으로 축소 |
| 연결 | Unity RuleTile 또는 동일한 adjacency 규칙 사용 |
| 변형 축 | season, weather, state, direction, height, animation 중 필요한 것만 선택 |
| 물리 | walkable, farmable, fishable, collision, nav cost를 metadata로 기록 |
| 검수 | 반복 seam, 모든 인접 조합, palette, alpha, collision 검사 |

## 2. Autotile 구성

| 우선 | 구성 | 필요한 variant | 용도 |
|---|---|---|---|
| P0 | 간소화 set | center, N/E/S/W edge, 4 outer corner, 4 inner corner, single, corridor, end cap | 빠른 vertical slice |
| P1 | 47-tile blob | 8방향 인접 전체 조합 | 자연 지형과 복합 전이 |
| P1 | transition set | A/B 소재별 edge, inner/outer corner | 잔디↔흙 등 소재 전이 |
| P1 | animated set | 각 topology의 동일 frame 수 | 물, 해안, lava 등 |

## 3. 자연 지표면

| 우선 | Tile family | 필수 variant | Gameplay metadata |
|---|---|---|---|
| P0 | 잔디 | 기본/듬성함/무성함, 계절 4종, 장식 없는 center | walkable, buildable |
| P0 | 흙 | 단단함/부드러움/젖음/진흙 | walkable, buildable |
| P0 | 경작지 | 경작/건조/물 줌, adjacency | farmable, watered |
| P0 | 모래 | 해변/건조지/젖은 해안 | walkable, diggable |
| P0 | 얕은 물 | loop frame, 흐름 variant | walkable 여부, fishable |
| P0 | 깊은 물 | loop frame, 색 깊이 | blocked, fishable |
| P1 | 자갈 | 밝음/어두움, 돌 density | walkable |
| P1 | 암반 | 평지/균열, 산악/광산 palette | walkable, mineable 여부 |
| P1 | 눈 | 얕음/쌓임/발자국 overlay | movement cost |
| P1 | 얼음 | 일반/금감 | slippery |
| P1 | 늪/습지 | 진흙/얕은 물/독성 | movement cost, damage |
| P2 | 낙엽/꽃잎 | 계절, density overlay | cosmetic |
| P2 | 재/화산 | 균열/lava edge/emissive | damage, blocked |

## 4. 물과 해안

| 우선 | Tile family | 필수 variant | Animation/연결 |
|---|---|---|---|
| P0 | 해안선 | N/E/S/W, inner/outer corner | 거품 loop |
| P0 | 얕은↔깊은 물 | edge/corner/center | 동일 위상 loop |
| P1 | 강물 | 직선/곡선/T/합류/발원/출구 | 흐름 방향별 loop |
| P1 | 연못 | center/edge/corner/single | 잔잔한 loop |
| P1 | 폭포 | top/flow/base | 흐름 + splash |
| P1 | 관개수로 | 직선/코너/T/교차/inlet/outlet | 물 있음/없음 |
| P2 | 독/용암 | shore/center/corner | emissive/damage loop |

## 5. 지형 전이와 높이

| 우선 | Tile family | 필수 variant | 비고 |
|---|---|---|---|
| P0 | 잔디↔흙 | edge, inner/outer corner | 계절 대응 |
| P0 | 잔디↔모래 | edge, inner/outer corner | 해변 연결 |
| P1 | 흙↔암반 | edge, inner/outer corner | 산악 연결 |
| P1 | 눈↔노출 지면 | edge, patch | 겨울 variant |
| P0 | 절벽 | top/face/edge/inner/outer corner | collision, height |
| P1 | 단독 암주 | top/face/base | sorting/collision |
| P1 | 옹벽 | 흙/돌/나무 소재, corner/end | height |
| P0 | 자연 계단 | N/E/S/W 도착부 | layer transition |
| P1 | 경사로 | 4방향 | movement rule |
| P1 | 동굴 입구 | open/blocked, shadow | scene transition |
| P1 | 구멍/void | edge/corner | fall/blocked |

## 6. 길과 포장

| 우선 | Tile family | 필수 topology | 상태 |
|---|---|---|---|
| P0 | 흙길 | 직선/코너/T/교차/끝 | dry/wet/season |
| P0 | 나무 길 | plank 방향/연결/코너 | intact/damaged/wet |
| P0 | 돌길 | 조약돌/판석 topology | moss/snow/wet |
| P1 | 벽돌길 | topology + border | 색/wet/snow |
| P1 | 마을 도로 | 차도/인도/curb/배수구 | dry/wet/snow |
| P1 | 광산 레일 | 직선/곡선/교차/끝/switch | normal/broken |
| P2 | 장식 border | 화단/광장/울타리 밑 | 계절 |

## 7. 구조 연결

| 우선 | Tile family | 필수 variant | Metadata |
|---|---|---|---|
| P0 | 나무 다리 | N-S/E-W, 입구/중간/난간 | collision, below layer |
| P1 | 돌/밧줄 다리 | 방향, corner, damaged | collision |
| P0 | 계단 | 4방향, 위/아래 도착부 | layer transition |
| P1 | 사다리 | 4방향/상하 | interaction |
| P1 | 부두 | deck/edge/corner/post/ladder | water layer |
| P0 | 울타리 | 직선/코너/T/교차/끝/gate 접점 | blocked |
| P1 | 벽/담장 | top/face/corner/pillar/gate | height/collision |

## 8. 실내

| 우선 | Tile family | 필요한 소재/variant | 비고 |
|---|---|---|---|
| P0 | 바닥 | 목재/돌/타일/카펫 | edge, damaged, wet |
| P1 | 특수 바닥 | 흙/금속/동굴 | 환경별 palette |
| P0 | 벽 | 벽지/목재/석조 | 상/중/하단, corner |
| P1 | 특수 벽 | 동굴/금속 | corner, damaged |
| P0 | baseboard/trim | straight/corner/end | 벽 연결 |
| P1 | beam/pillar | vertical/horizontal/corner | sorting |
| P0 | 문틀/창틀 | 4방향 연결 | object와 anchor 공유 |
| P1 | 주방 counter | straight/corner/end | object top 연결 |
| P1 | rug/carpet | autotile/edge/corner | walkable |
| P1 | 실내 계단/난간 | 4방향/landing | layer transition |
| P1 | cutaway mask | 지붕/벽/방 구분 | camera trigger |

## 9. Gameplay·디버그 타일

| 우선 | Tile/overlay | 필요한 상태 | 용도 |
|---|---|---|---|
| P0 | 건축 가능 overlay | valid/invalid | 배치 미리보기 |
| P0 | 경작 overlay | till/water/seed/fertilizer | 농사 feedback |
| P0 | interaction trigger | enter/exit/action | 에디터 전용 |
| P0 | collision overlay | walkable/blocked/partial | 에디터 전용 |
| P1 | NPC path | route/node/wait | 에디터 전용 |
| P1 | spawn | player/NPC/monster/item | 에디터 전용 |
| P1 | 낚시 구역 | allowed/blocked/depth/flow | 에디터 전용 |
| P1 | 함정/압력판 | idle/armed/triggered | 던전 gameplay |

## 10. 타일 완료 조건

| 검사 | 합격 기준 |
|---|---|
| 반복 | 동일 tile 3×3 반복 시 seam 없음 |
| 인접 | 지원하는 모든 adjacency 조합에 빈틈/잘못된 경계 없음 |
| 애니메이션 | 연결된 tile이 같은 위상과 frame 수를 사용 |
| 계절 | topology와 collision은 유지되고 표현만 변경 |
| 규격 | tile rect, PPU, filter mode, compression 일치 |
| 물리 | walkable/collision/terrain metadata 누락 없음 |
| Unity | RuleTile paint/erase와 인접 갱신 정상 |
