# 마스터 에셋 카탈로그

농장 생활 RPG형 2D 게임의 기본 뼈대를 만들기 위한 최상위 제작 인덱스다. 특정 게임의 미술을 복제하지 않고 장르의 기능적 요구를 기준으로 분류한다.

## 1. 문서 구조

| 문서 | 관리 대상 | 형식 |
|---|---|---|
| [타일 카탈로그](TILE_CATALOG.md) | 지표면, 전이, 물, 절벽, 길, 구조 연결, 실내 타일 | 카테고리별 표 |
| [오브젝트 카탈로그](OBJECT_CATALOG.md) | 자연물, 농장, 설비, 건물, 마을, 실내, 광산, 장치 | 카테고리별 표 |
| 이 문서 | 캐릭터, 동물, 몬스터, 아이템, VFX, UI, 가이드, 전체 완료 조건 | 최상위 체크리스트 |

## 2. 우선순위

| 등급 | 의미 | 완료 기준 |
|---|---|---|
| P0 | Playable skeleton | 농사, 이동, 상호작용, 하루 루프를 플레이하는 데 필수 |
| P1 | Content complete | 마을, 실내, 광산, 전투, 생산 활동을 구성하는 데 필요 |
| P2 | Polish | 계절 장식, 희귀 variant, 풍부한 배경과 연출 |

## 3. 모든 에셋의 공통 필드

| 영역 | 필수 필드 |
|---|---|
| 식별 | asset ID, 표시 이름, category, tags, priority |
| 규격 | Unity size profile, cell size, width/height, ratio, canvas, output scale, PPU |
| 렌더 | 시점, 팔레트, 외곽선, 광원, 그림자 정책 |
| 변형 | 방향, 계절, 성장, 상태, 손상, animation |
| 배치 | pivot, 바닥 접점, sorting point, layer |
| 물리 | walkable, collision, trigger, nav cost |
| 생성 | prompt preset, model/revision, seed, guide IDs |
| 검수 | 상태, 반려 사유, 자동 검사, Unity 검증 여부 |

## 4. 전체 에셋 분류

| 대분류 | 세부 분류 | 대표 산출물 | 상세 문서 |
|---|---|---|---|
| Tile | 지형/물/전이/높이/길/실내 | tileset PNG, RuleTile manifest | [타일 카탈로그](TILE_CATALOG.md) |
| Object | 자연/농장/설비/건물/실내/광산 | sprite, prefab manifest | [오브젝트 카탈로그](OBJECT_CATALOG.md) |
| Character | 플레이어/NPC/초상화/장비 레이어 | 방향·동작 sprite sheet | 이 문서 5장 |
| Creature | 가축/반려동물/야생동물/몬스터 | 방향·동작 sprite sheet | 이 문서 6장 |
| Item | 도구/무기/재료/음식/장비/퀘스트 | icon, world drop, held sprite | 이 문서 7장 |
| VFX | 상호작용/전투/환경/날씨 | loop/one-shot sheet | 이 문서 8장 |
| UI | HUD/인벤토리/대화/지도/커서 | atlas, nine-slice, icon | 이 문서 9장 |
| Guide | 레이아웃/포즈/autotile/footprint | guide PNG, mask, metadata | 이 문서 10장 |

## 5. 캐릭터

### 5.1 캐릭터 family

| 우선 | 분류 | 필요한 대상 | 필수 변형 |
|---|---|---|---|
| P0 | 플레이어 | body base, 머리, 기본 의상 | 피부/머리/의상, 4방향, 핵심 동작 |
| P0 | 주요 NPC | 농부, 상인, 대장장이 등 기능 NPC | 4방향 idle/walk, portrait, 표정 |
| P1 | 서비스 NPC | 의사, 여관, 길드, 운송 등 | 4방향 idle/walk, 직업 소품 |
| P1 | 주민 | 연령대와 체형 archetype | 4방향 idle/walk, 일상 동작 |
| P2 | 방문객/축제 NPC | 계절 및 이벤트 인물 | 행사 의상, emote |
| P2 | 비인간형 | 게임 설정에 맞는 종족 | 종족 특징, 전용 silhouette |

### 5.2 레이어

| 레이어 | 필수 규칙 |
|---|---|
| body/skin | 모든 frame에서 canvas, pivot, 신체 비율 고정 |
| hair front/back | 모자와 겹침 순서, 방향별 앞/뒤 분리 |
| top/bottom/one-piece | body frame과 정확히 같은 rect 사용 |
| shoes | 발 접점과 walk contact frame 일치 |
| hat/accessory | 머리 anchor와 좌우 비대칭 metadata |
| held item/tool/weapon | 손 anchor, 궤적, 앞/뒤 sorting 정의 |
| shadow | 캐릭터와 분리, 발 위치 기준 고정 |

### 5.3 방향과 동작

| 우선 | 동작 ID | 방향 | 요구 |
|---|---|---|---|
| P0 | `idle` | 4방향 | 발 접점과 중심 고정 |
| P0 | `walk_empty` | 4방향 | contact/pass/recoil/up, loop |
| P0 | `tool_swing` | 4방향 | 준비-타격-회수, 도구 궤적 |
| P0 | `interact_pickup` | 4방향 | 대상 anchor와 손 위치 |
| P0 | `carry_front` | 4방향 | 양손 앞, 얼굴 가림 제한 |
| P0 | `carry_overhead` | 4방향 | 머리 위 여백과 물체 anchor |
| P0 | `hurt` | 4방향 | knockback 방향, recovery |
| P1 | `run` | 4방향 | walk와 다른 timing |
| P1 | `weapon_1h` | 4방향 | 주 사용 손과 손잡이 고정 |
| P1 | `weapon_2h` | 4방향 | 두 손 간 거리와 무기 축 유지 |
| P1 | `bow_shoot` | 4방향 | draw/hold/release |
| P1 | `fish` | 필요한 방향 | cast/wait/bite/reel |
| P1 | `farm_actions` | 4방향 | water/plant/harvest 개별 clip |
| P1 | `sit_sleep_eat` | 필요한 방향 | 가구 interaction anchor |
| P2 | `emote` | front 중심 | happy/sad/angry/surprised 등 |

## 6. 동물과 몬스터

| 우선 | 분류 | 대상 family | 필수 동작/변형 |
|---|---|---|---|
| P0 | 가축 | 닭류, 소류 | baby/adult, idle/walk/eat/sleep/produce |
| P1 | 가축 확장 | 양/염소류, 돼지류 | 색 variant, happy/interact |
| P0 | 반려동물 | 개/고양이 | idle/walk/sleep/interact |
| P1 | 야생동물 | 새, 나비/벌, 개구리, 물고기 | fly/swim/flee, 계절 variant |
| P0 | 기본 몬스터 | slime archetype | move/telegraph/attack/hurt/death |
| P1 | 몬스터 확장 | flying/quadruped/humanoid/burrowing | archetype별 공격 방식 |
| P2 | elite/boss | 대형 개체 | phase, 특수 공격, palette/size variant |

## 7. 아이템 표현

모든 아이템은 필요에 따라 `inventory icon`, `world drop`, `held-front`, `held-overhead`, `equipped/use overlay`를 갖는다.

| 우선 | 분류 | 필요한 family | 추가 규칙 |
|---|---|---|---|
| P0 | 농기구 | 괭이, 물뿌리개, 도끼, 곡괭이, 낚싯대, 낫, 망치 | tier, held pivot, swing anchor |
| P1 | 무기 | 한손검, 양손검, 둔기, 창, 활, 방패 | 장비/공격 표현 |
| P0 | 농사 | 씨앗, 묘목, 비료, 작물, 과일, 꽃 | world/held/icon 대응 |
| P0 | 자원 | 목재, 섬유, 돌, 광석, 주괴, 석탄 | stack/quality는 UI overlay |
| P1 | 채집/낚시 | 허브, 버섯, 생선, 갑각류, 해산물 | 크기/희귀도 family |
| P1 | 가공품 | 잼, 절임, 치즈, 직물, 주괴, 공예품 | 원재료 identity 유지 |
| P1 | 소비품 | 조리 재료, 음식, 음료, 약 | dish/container 구분 |
| P1 | 장비 | 모자, 상의, 하의, 신발, 액세서리 | character layer와 연결 |
| P1 | 퀘스트 | 책, 지도, 열쇠, 편지, 특수 물품 | 고유 ID, 드롭 제한 |
| P2 | 특수 | 화폐, 토큰, 선물, 축제 아이템 | 이벤트 theme |

## 8. VFX

| 우선 | 분류 | 필요한 효과 | 필수 metadata |
|---|---|---|---|
| P0 | 이동 | 먼지, 잔디, 물 splash, 눈 발자국 | 지면 type, FPS, loop |
| P0 | 도구 | swing trail, hit spark, 파편 | 방향, anchor, event frame |
| P0 | 농사 | 심기, 물 주기, 수확, pickup | 대상 cell, 완료 frame |
| P1 | 제작 | processing, ready, collect | 설비 anchor, loop |
| P1 | 상태 | heal, buff, debuff, poison, stun | attach point, duration |
| P1 | 환경 | 비, 눈, 바람, 안개, 낙엽 | world/screen space, blend |
| P1 | 자연 | 물결, 거품, 폭포, 불꽃, 연기, 증기 | loop, layer, emissive |
| P2 | 연출 | 번개, 폭죽, 마법, 레벨업 | one-shot, camera effect |

## 9. UI

| 우선 | 분류 | 필요한 에셋 | 상태/규칙 |
|---|---|---|---|
| P0 | HUD | health/stamina/시간/날짜/계절/날씨/화폐 | fill, warning, disabled |
| P0 | 인벤토리 | slot, selection, tooltip, drag ghost | normal/selected/locked/invalid |
| P0 | 패널 | chest, shop, crafting, settings | nine-slice, tab, scrollbar |
| P0 | 대화 | dialogue box, name plate, choice, portrait frame | active/disabled/selected |
| P0 | 입력 | cursor, interaction prompt, button/key glyph | select/move/plant/water/attack/invalid |
| P1 | 지도 | map frame, player/NPC/quest/fast-travel marker | discovered/hidden/selected |
| P1 | 알림 | item gain, quest, status, relationship | icon + text anchor |
| P1 | 관계 | heart, gift, emotion, reputation | empty/fill/locked |
| P2 | 디버그 | pivot, collision, walkable, trigger, spawn overlay | 에디터 전용 색상 규칙 |

## 10. 생성 가이드 라이브러리

| 우선 | 가이드 분류 | 필요한 template |
|---|---|---|
| P0 | 실제 규격 프레임 | 흰 배경 위 실제 width:height ratio의 검은 윤곽선만 표시하고 내부는 흰색 유지 |
| P0 | 공통 바닥선 | 윤곽선 프레임의 아랫변을 모든 방향·동작·상태의 접점 기준으로 사용 |
| P0 | 캐릭터/오브젝트 점유 | 윤곽선 안을 생성 대상이 자연스럽게 채우도록 크기와 위치 통일 |
| P0 | 방향 포즈 | 공통 rect·발 접점 안에서 front/back은 넓은 점유, left/right는 좁은 측면 점유를 쓰는 방향별 관절점·실루엣·safe margin |
| P0 | 동작 포즈 | 7개 동작의 frame별 관절점, 장비 anchor, motion path |
| P0 | 공통 점유 | 1×1, 1×2, 2×1, 2×2, 3×2 cell, 바닥선/중심선/safe margin |
| P0 | 오브젝트 상태 | door/chest open, machine process, crop growth, tree fall |
| P0 | 타일 | edge/corner/blob mask와 transition guide |
| P0 | 건물 | footprint, entrance, sorting point, shadow 영역 |

## 11. 이미지가 아닌 필수 데이터

| 분류 | 필요한 데이터 |
|---|---|
| 타일 | adjacency bitmask, terrain cost, farmable, fishable, height |
| 물리 | collision polygon/box, trigger, nav obstacle |
| 렌더 | pivot, anchor, sorting point, layer, PPU |
| 애니메이션 | clip, FPS, loop, event timing, transition |
| 게임 데이터 | item/recipe/crop 수치, price, loot, spawn, localization key |
| NPC | path, schedule, dialogue, quest logic |
| 연결 | audio cue ID, prefab/RuleTile ID |
| 출처 | 모델/seed/input hash, 라이선스, source provenance |

## 12. P0 플레이 가능 뼈대

| 영역 | 완료해야 할 묶음 |
|---|---|
| 월드 | 잔디/흙/경작지/물/해안/길, 절벽/계단/다리, 실내 바닥/벽/문 |
| 농사 | crop archetype 5종, 나무 2종, 바위/잡초, 울타리/문, sprinkler/scarecrow |
| 설비 | 상자, 판매함, 작업대, 용광로, 가공 설비 2종 |
| 건물 | farm house, barn/coop 1종, greenhouse |
| 캐릭터 | 플레이어 4방향 핵심 동작, NPC 3명 4방향 walk/portrait |
| 생명체 | 가축 2종, 반려동물 1종, 몬스터 1종 |
| 아이템 | 농기구 7종, P0 작물/재료/생산품 icon과 held 표현 |
| UI | HUD, inventory, chest, dialogue, shop/crafting, cursor/icon |
| 피드백 | 물/먼지/타격/파괴/수확 VFX |
| Unity | manifest import, slicing, pivot/PPU, Tilemap, animation, collision, sorting 검증 |

## 13. 완료 정의

| 조건 | 검증 방법 |
|---|---|
| 요구 variant가 모두 존재 | 카탈로그 조합과 파일 비교 |
| 생성 provenance가 완전 | 모델, revision, prompt, seed, input hash 확인 |
| 자동 QA 통과 | category별 검사 리포트 |
| 실제 크기 수동 검수 | 1x preview와 animation loop 확인 |
| manifest/ID 일치 | schema validation과 중복 검사 |
| Unity import 성공 | importer 오류 0건 |
| 게임 장면 동작 확인 | scale, seam, pivot, sorting, collision 테스트 |

모든 조건을 통과한 catalog entry만 `unity_verified`로 표시한다.
