# 오브젝트 카탈로그

농장 생활 RPG형 2D 게임의 기본 뼈대에 필요한 오브젝트를 **카테고리별 표**로 관리한다. 각 행은 개별 이미지가 아니라 상태·방향·계절·애니메이션을 포함하는 object family다.

## 1. 표의 기준

| 열 | 의미 |
|---|---|
| 우선 | P0 playable skeleton, P1 content complete, P2 polish |
| Object family | 안정적인 asset ID의 기준 단위 |
| 필요한 대상 | 생성해야 할 실제 오브젝트 종류 |
| 필수 variant/state | 함께 완성해야 하는 상태와 변형 |
| Unity/배치 정보 | pivot, collision, sorting, anchor 등 필수 metadata |

## 2. 나무와 식생

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 일반 나무 | 참나무, 소나무 | 씨앗/묘목/어린나무/성목, 계절 4종, 흔들림/벌목/넘어짐/그루터기 | trunk collision, canopy sorting, shadow anchor |
| P0 | 과실수 | 기본 과실수 archetype 2종 | 성장 단계, 꽃/미성숙/수확 가능/수확 후, 계절 | fruit anchors, trunk collision |
| P0 | 관목 | 작은/큰 관목 | 계절, 열매/꽃, 수확 전/후 | partial collision, sorting point |
| P0 | 풀/잡초 | 짧은 풀, 긴 풀, 잡초 3 silhouette | 계절, 베기 전/후, 흔들림 | walkable, cut event |
| P1 | 꽃 | 야생화와 재배 화분용 꽃 | 색/계절, 봉오리/개화/수확 후 | pickup anchor |
| P1 | 수생 식물 | 갈대, 수련, 해초 | 계절, sway loop | water placement mask |
| P1 | 균류 | 작은 버섯, 큰 버섯, 군락 | 색/계절, 채집 전/후 | pickup/collision |
| P2 | 특수 식생 | 선인장, 덩굴, 마법 식물 | 환경별 성장/발광 | emissive, wall/ground anchor |

## 3. 바위·장애물·채집물

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 작은 돌 | 돌 3~5 silhouette | 정상/타격/파괴, 파편 | 1-cell collision, hit event |
| P0 | 큰 바위 | 대형 바위, 암석 군집 | 균열 단계/파괴 | multi-cell footprint, sorting |
| P0 | 나무 잔해 | 가지, 통나무, 썩은 그루터기 | 정상/타격/제거 | footprint, tool requirement |
| P0 | 잡초 장애물 | 가시덤불, 무성한 잡초 | 정상/베기/제거 | partial/full collision |
| P1 | 광석 노드 | 구리/철/금/희귀 광석 | 정상/균열/파괴 | loot table ID, hit event |
| P1 | 보석/수정 | 수정 군집, 보석 노드 | 색/크기/발광 | emissive, loot anchor |
| P1 | 계절 장애물 | 눈더미, 진흙 웅덩이 | 계절/날씨, 제거 전/후 | movement cost/collision |
| P1 | 육지 채집물 | 허브, 열매, 버섯, 야생 채소 | 계절, 보통/희귀, 채집 전/후 | pickup trigger |
| P1 | 해변 채집물 | 조개, 산호, 표류물, 해초 | 색/크기, 채집 전/후 | shoreline placement |
| P2 | 희귀 노드 | 운석, 거대 수정, 고대 유물 | 정상/채집/잔해 | unique spawn, large footprint |

## 4. 작물

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 잎채소 | 빠른 수확 작물 archetype | seed/growth 1..N/mature/harvested/dead | cell center, crop layer |
| P0 | 뿌리채소 | 땅속 수확 archetype | growth 1..N/mature/pulled/dead | harvest VFX anchor |
| P0 | 반복 수확 | 줄기에서 열매가 다시 자라는 작물 | growth/mature/fruit-ready/picked/regrow/dead | fruit anchors |
| P0 | 지지대 작물 | 덩굴/격자 archetype | growth/mature/harvest/regrow/dead | blocked/partial path policy |
| P0 | 곡물 | 밀/벼형 archetype | growth/mature/cut/stubble/dead | scythe event |
| P0 | 재배 꽃 | 꽃 작물 archetype | growth/bud/bloom/harvested/dead | pickup anchor |
| P1 | 과실 관목 | berry crop archetype | growth/flower/fruit/picked | repeat harvest |
| P1 | 거대 작물 | 2×2 이상 특수 작물 | spawn/grown/harvest/destroy | multi-cell footprint |
| P2 | 병충해 | 감염/시듦 overlay | severity 단계 | overlay, gameplay status |

각 crop family는 world sprite와 produce의 `inventory icon`, `world drop`, `held-front`, `held-overhead` 표현을 연결한다.

## 5. 농장 경계·배치물

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 울타리 | 나무, 돌 | N/E/S/W 연결, corner/T/cross/end, 손상 단계 | adjacency, collision |
| P0 | 울타리 문 | 나무, 돌 | 4방향, open/closed/broken | hinge pivot, nav toggle |
| P0 | 표지판 | 빈 판, 아이콘 판, 방향 표지 | 4방향, 내용 overlay | text/icon anchor |
| P0 | scarecrow | 기본 1종 | idle/sway, 계절 장식 | coverage radius, collision |
| P0 | sprinkler | 기본/업그레이드 | idle/working | coverage cells, water event |
| P0 | 횃불/농장등 | 횃불, lamp | off/on, flame loop | light/emissive anchor |
| P1 | 화단/화분 | 작은/큰 화분, planter | empty/planted/growth | plant anchor |
| P1 | 사료 설비 | 사료통, 급수통 | empty/partial/full | animal interaction |
| P1 | 벌통 | 기본 벌통 | empty/working/ready/collect | output anchor |
| P1 | 양식장 | 연못/수조 소품 | empty/stocked/ready | water/interaction area |
| P2 | 자동화 장치 | sensor, collector, conveyor node | off/on/connected/error | connection ports |

## 6. 보관·제작·가공 설비

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 상자 | 나무 상자, 색 variant | closed/open, empty/full | lid animation, interaction |
| P0 | 판매함 | 출하/배송 상자 | closed/open, empty/full, collect | daily collection trigger |
| P0 | 작업대 | 기본 crafting bench | idle/in-use | interaction side, surface anchor |
| P0 | 용광로 | 광석 제련 설비 | empty/loaded/processing/ready/collect | flame/emissive, output anchor |
| P0 | 기본 가공기 | jar/cheese archetype 2종 | idle/loaded/processing/ready | progress state |
| P1 | 숯가마 | 목재 가공 | idle/loaded/smoking/ready | smoke anchor |
| P1 | 제분기 | 곡물 분쇄 | idle/working/ready | rotating part, output |
| P1 | 착유기 | 유제품 가공 | idle/loaded/working/ready | input/output anchor |
| P1 | 양조기 | 음료/숙성 | empty/loaded/bubbling/ready | loop, output |
| P1 | 재봉/방직 | 재봉틀, 방직기 | idle/working/ready | moving part, output |
| P1 | 염색 설비 | 염색통/테이블 | empty/loaded/colored/ready | palette parameter |
| P1 | 자원 설비 | 퇴비통, 씨앗 제조기, 재활용기 | idle/loaded/processing/ready | input/output |
| P1 | 물 설비 | 우물, 펌프, 물탱크 | empty/filled/pumping | water source, interaction |
| P2 | 전력 설비 | 발전기, 배터리 | off/on/charging/full/error | connection, emissive |

설비의 공통 상태는 `idle / input_loaded / processing / ready / collect / broken`에서 필요한 것만 선택한다.

## 7. 농장 건물

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 농가 | 기본 주택 | construction/complete, door/window, 계절 | footprint, entrance, sorting |
| P1 | 농가 업그레이드 | 확장 1..N | 건설/완공, 계절 | footprint migration |
| P0 | 축사 | barn 또는 coop 최소 1종 | construction/complete, door open/closed | animal entrance, interior link |
| P1 | 축사 확장 | barn, coop, stable | upgrade 단계, 계절 | footprint, capacity metadata |
| P0 | 온실 | 기본 greenhouse | broken/repaired, door, glass lighting | interior link, transparency |
| P1 | 사일로 | 저장탑 | empty/partial/full | capacity indicator |
| P1 | 풍차 | 기본 windmill | idle/turning, 계절 | blade pivot, large sorting |
| P1 | 창고/작업장 | storage, workshop | construction/complete, door | interior link |
| P1 | 우물 | roofed well | idle/draw water | interaction anchor |
| P2 | 특수 생산 건물 | 양식장, 벌꿀집 등 | tier/state | gameplay별 metadata |

모든 건물은 footprint, entrance cell, door animation, collision, sorting point, shadow, 계절 overlay를 필수로 갖는다.

## 8. 마을·공공·상업 건물

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P1 | 상점 | 잡화점/씨앗 상점 | open/closed, sign, lit/unlit | entrance, opening hours |
| P1 | 대장간 | forge/shop | open/closed, smoke/fire | entrance, chimney anchor |
| P1 | 진료소 | clinic | open/closed, sign | entrance, interior link |
| P1 | 여관/식당 | inn/tavern | day/night, sign, smoke | entrance, window light |
| P1 | 주민 주택 | house archetype 3종 | door/window, day/night, season | footprint, interior link |
| P1 | 공공 시설 | town hall/community center | open/closed, repaired state | large footprint |
| P1 | 문화 시설 | school/library/museum | open/closed, sign | entrance, exhibit anchors |
| P1 | 기능 시설 | guild/shrine/transport office | active/inactive | game-system trigger |
| P2 | 축제 건물 장식 | banner/light/stall skin | event별 on/off | overlay layer |

## 9. 거리·야외 소품

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 우편/게시 | 우편함, 게시판 | empty/new-mail, normal/notice | interaction trigger |
| P1 | 휴식 시설 | bench, table, outdoor chair | 2~4방향 | sit anchors, sorting |
| P1 | 폐기/보관 | 쓰레기통, barrel, crate, sack, pallet | closed/open, intact/broken | search/break interaction |
| P1 | 조명 | 가로등, lantern, 전봇대 | off/on, damaged, day/night | light/emissive, wire ports |
| P1 | 조경 | 화분, planter, fountain, statue | 계절, water on/off | water loop, collision |
| P1 | 시장 | 좌판, 천막, display table | open/closed, 상품 overlay | vendor anchor |
| P1 | 운반 소품 | 손수레, cart | empty/full, 방향 | wheel/collision |
| P1 | 도로 소품 | 표지판, 배수구, 맨홀, 깃발 | 방향, open/closed, sway | road placement |
| P2 | 장식 | 현수막, 빨랫줄, 풍경, 바람개비 | 계절/이벤트, sway | wall/pole anchor |
| P2 | 기념물 | 분수, 동상, 묘비, 표지석 | normal/event-lit | large sorting/collision |

## 10. 실내 구조·가구

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P0 | 문 | 목재/상점/실내문 | 4방향, open/closed/locked | hinge, nav/collision toggle |
| P0 | 창문 | 기본 창 | day/night, curtain open/closed | wall anchor, light overlay |
| P1 | 수직 이동 | 계단, 사다리 | 4방향, top/bottom | transition trigger |
| P0 | 침대 | single/double | made/unmade, 사용 중 | sleep anchors, sorting |
| P0 | 테이블/의자 | small/large table, chair, stool | 4방향, 빈/물건 있음 | sit/surface anchors |
| P0 | 수납 가구 | dresser, wardrobe, cabinet, shelf | closed/open, empty/full | interaction/surface anchors |
| P0 | 주방 | fridge, oven, sink, counter | off/on/open/closed | cooking/storage anchors |
| P1 | 거실 | sofa, armchair, coffee table | 방향, 사용 중 | sit anchors |
| P1 | 작업 | desk, bookcase, display cabinet | 방향, open/closed | surface/read anchors |
| P1 | 난방/조명 | fireplace, stove, lamp, clock | off/on, fire loop | light/emissive, smoke |
| P1 | 욕실 | bath, basin, toilet | clean/used, water on/off | interaction anchors |
| P1 | 상업 가구 | shop counter, display, register | open/closed, 상품 overlay | vendor/customer anchors |
| P1 | 장식 | rug, mirror, frame, vase, plant, toy, instrument | 색/방향/계절 | wall/floor/surface anchor |

## 11. 광산·동굴·던전

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P1 | 출입 장치 | entrance, ladder, elevator, gate | open/closed/locked/active | scene transition |
| P1 | 광산 운송 | rail prop, minecart | empty/full/moving/broken | track alignment, collision |
| P1 | 지지 구조 | support beam, rope, chain | intact/damaged/sway | wall/ceiling anchor |
| P1 | 광원 | torch, brazier, crystal light | off/on, flame/glow loop | emissive/light anchor |
| P1 | 파괴 용기 | pot, barrel, crate | intact/hit/broken | loot event, fragments |
| P1 | 보상 | chest, altar, key pedestal | locked/open/looted/active | interaction/loot anchor |
| P1 | 함정 | spike, projectile trap, pressure plate | idle/armed/triggered/reset | damage trigger, timing |
| P1 | 환경 장식 | bone, web, crack, moss, mushroom | density/color variants | cosmetic/partial collision |
| P2 | 보스 장치 | boss gate, seal, arena altar | locked/charging/open | encounter trigger |

## 12. 이동수단·월드 장치

| 우선 | Object family | 필요한 대상 | 필수 variant/state | Unity/배치 정보 |
|---|---|---|---|---|
| P1 | 수상 이동 | boat, ferry | docked/moving, 필요한 방향 | boarding anchor, water path |
| P1 | 육상 이동 | cart, wagon | empty/full, 방향, moving | passenger/cargo anchors |
| P2 | 차량 | tractor, bicycle, bus | parked/moving, 방향 | driver/passenger anchors |
| P1 | 승강 장치 | elevator, cable car | idle/door/open/moving/arrived | floor/path metadata |
| P1 | 포털 | portal/shrine warp | inactive/charging/active | VFX/teleport trigger |
| P1 | 제어 장치 | lever, button, switch, indicator | off/on/locked/error | target object IDs |
| P1 | 작동 구조 | gate, bridge, lock | open/closed/transition | collision/nav toggle |
| P2 | 시간/날씨 장치 | clock tower, weather device | state별 display | global system link |

## 13. 공통 상태 템플릿

| 오브젝트 유형 | 권장 상태 집합 |
|---|---|
| 문/문짝 | closed, opening, open, closing, locked, broken |
| 상자/수납 | closed, open, empty, partial, full, locked |
| 제작 설비 | idle, input_loaded, processing, ready, collect, broken |
| 광원 | off, igniting, on_loop, extinguishing, broken |
| 식생 | growth_0..N, mature, harvest_ready, harvested, dead |
| 파괴물 | intact, hit_1..N, breaking, remains |
| 건물 | blueprint, construction_1..N, complete, upgrade, damaged |
| 물 장치 | empty, filling, full, flowing, frozen, broken |
| 운송 장치 | idle, loading, moving, arriving, unloading, disabled |

## 14. P0 오브젝트 생산 순서

| 순서 | 묶음 | 완료 대상 |
|---:|---|---|
| 1 | 자연 장애물 | 일반 나무 2종, 관목, 풀/잡초, 작은/큰 바위, 가지/통나무 |
| 2 | 작물 | 6개 crop archetype의 전체 성장/수확/고사 상태 |
| 3 | 농장 경계 | 나무/돌 울타리, gate, 표지판, scarecrow, sprinkler, farm light |
| 4 | 핵심 설비 | 상자, 판매함, 작업대, 용광로, 기본 가공기 2종 |
| 5 | 핵심 건물 | 농가, 축사 1종, 온실 |
| 6 | 기본 실내 | 문, 창문, 침대, 테이블/의자, 수납, 주방 설비 |
| 7 | 상호작용 QA | 모든 대상의 pivot/collision/sorting/anchor/상태 전환 검증 |

## 15. 오브젝트 완료 조건

| 검사 | 합격 기준 |
|---|---|
| 상태 완전성 | 표에 정의된 필수 state가 누락되지 않음 |
| 정렬 | 모든 state에서 canvas, pivot, 바닥 접점 유지 |
| 상호작용 | interaction/door/surface/hand/output anchor 존재 |
| 물리 | collision과 trigger가 실제 silhouette/기능에 맞음 |
| 렌더 | 큰 오브젝트의 sorting point와 앞/뒤 통과가 정상 |
| 애니메이션 | loop/transition의 frame jump 없음 |
| 식별 | asset ID, 파일명, manifest가 일치 |
| 추적 | 모델, revision, prompt, seed, 입력 hash가 저장됨 |
| Unity | prefab import 후 상태 전환과 배치 테스트 통과 |
