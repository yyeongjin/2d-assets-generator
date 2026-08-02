# 캐릭터·오브젝트 상대 크기 규격

## 1. 기준점

농장 RPG의 기능적 비율을 잡기 위해 다음 실제 규격을 기준점으로 사용한다.

- Stardew Valley의 map tile은 [16×16 px](https://stardewvalleywiki.com/Modding%3AMaps)이다.
- NPC와 Farmer의 한 frame은 [16×32 px](https://stardewvalleywiki.com/Modding%3AFarmer_sprite)이다.
- 일반 object가 한 tile 높이인 것과 달리 [big craftable은 두 tile 높이](https://stardewvalleywiki.com/Modding%3ABig_craftables)다.
- NPC portrait는 [64×64 px](https://stardewvalleywiki.com/Modding%3ANPC_data)다.

따라서 기능적 기본 비율은 다음과 같다.

```text
기준 tile             = T × T
기준 character frame = T × 2T
일반 object           = T × T
세로 object           = T × 2T
portrait              = 4T × 4T
```

이 규격은 특정 게임의 그림을 복제하기 위한 것이 아니라, 타일·캐릭터·오브젝트가 서로 어울리는 상대 크기를 잡기 위한 기준이다.

## 2. 해상도 체크박스

| 체크박스 | T | Tile | Character | Object 1×1 | Object 1×2 | Portrait |
|---|---:|---:|---:|---:|---:|---:|
| `T16` | 16 px | 16×16 | 16×32 | 16×16 | 16×32 | 64×64 |
| `T32` | 32 px | 32×32 | 32×64 | 32×32 | 32×64 | 128×128 |
| `T64` | 64 px | 64×64 | 64×128 | 64×64 | 64×128 | 256×256 |
| `Custom` | 사용자 값 | T×T | T×2T | T×T | T×2T | 4T×4T |

프로젝트에서 하나를 선택하면 `pixels_per_cell = T`, `asset_ppu = T`로 설정한다. Tilemap 한 cell을 Unity world 1 unit으로 사용할 때 한 tile과 한 world unit이 일치한다.

Unity의 [Pixel Perfect Camera 문서](https://docs.unity3d.com/kr/current/Manual/urp/2d-pixelperfect.html)에 따라 모든 Sprite PPU와 Pixel Perfect Camera의 Asset PPU는 같은 값을 사용한다. 픽셀 아트는 Point filter, 무압축, 픽셀 단위 pivot을 적용한다.

## 3. 크기 계산

```text
target_width_px  = visual_cells_x × T
target_height_px = visual_cells_y × T
target_ratio     = visual_cells_x / visual_cells_y

footprint_width_world  = footprint_cells_x
footprint_height_world = footprint_cells_y

guide_frame_width / guide_frame_height = target_ratio
guide_baseline_y = guide_frame_y + guide_frame_height
```

`footprint`는 충돌과 배치에 쓰는 바닥 크기이고, `visual canvas`는 실제 그림이 차지하는 크기다. 둘을 분리해야 나무, 문, 건물처럼 바닥 면적보다 위로 크게 보이는 오브젝트의 상대 비율을 유지할 수 있다.

## 4. 캐릭터 규격

아래 표부터는 위에서 확인한 `타일 1T`, `캐릭터 1T×2T`, `일반 오브젝트 1T`, `세로 오브젝트 2T` 관계를 확장한 이 프로젝트의 기본 scale profile이다. 에셋별 예외는 profile revision으로 관리하되 같은 family의 방향·상태 사이에서는 변경하지 않는다.

| 프리셋 | Visual canvas | Footprint | Pivot/baseline | 용도 |
|---|---:|---:|---|---|
| `character.standard` | 1T × 2T | 1×1 cell | bottom-center | 플레이어와 일반 NPC 기본 |
| `character.short` | 1T × 2T | 1×1 cell | standard와 동일 | 어린이/작은 체형, canvas 안 점유율만 낮춤 |
| `character.tall` | 1T × 2T | 1×1 cell | standard와 동일 | 큰 체형, canvas 안 점유율만 높임 |
| `character.large` | 2T × 3T | 1×1 또는 2×1 | bottom-center | 거인형 NPC/대형 인간형 |
| `portrait.standard` | 4T × 4T | 해당 없음 | center | 대화 초상화 |

일반 플레이어와 NPC는 같은 `1T × 2T` frame을 유지한다. 키 차이는 frame 자체를 바꾸기보다 윤곽선 안의 점유율로 표현해 방향·동작 시트의 rect를 동일하게 유지한다.

## 5. 자연물·채집물 규격

| Object family | 기본 프리셋 | Visual canvas | Footprint | 기준 |
|---|---|---:|---:|---|
| 작은 돌/가지/잡초 | `object.1x1` | 1T × 1T | 1×1 | 한 cell 안에 배치 |
| 채집 식물/버섯/조개 | `object.1x1` | 1T × 1T | 1×1 | 실제 그림은 frame보다 작게 점유 가능 |
| 관목 | `object.2x2` | 2T × 2T | 1×1 또는 2×1 | 수관 overflow 포함 |
| 큰 바위 | `object.2x2` | 2T × 2T | 2×2 | visual과 collision 대응 |
| 일반 나무 | `nature.tree.3x5` | 3T × 5T | 1×1 | 줄기 바닥은 1 cell, 수관은 위/좌우 overflow |
| 과실수 | `nature.fruit_tree.3x5` | 3T × 5T | 1×1 | 일반 나무와 같은 외곽 비율 |
| 대형 특수 나무 | `nature.tree_large.4x6` | 4T × 6T | 2×2 | 큰 수관과 그림자 분리 |

## 6. 작물·농장 배치물 규격

| Object family | 기본 프리셋 | Visual canvas | Footprint | 기준 |
|---|---|---:|---:|---|
| 일반 작물 | `crop.1x1` | 1T × 1T | 1×1 | 모든 성장 단계 rect 동일 |
| 지지대 작물 | `crop.tall.1x2` | 1T × 2T | 1×1 | 위쪽 overflow |
| 거대 작물 | `crop.giant.2x2` | 2T × 2T | 2×2 | multi-cell 수확 |
| 울타리 한 조각 | `fence.1x1` | 1T × 1T | 1×1 | adjacency 기준 |
| gate | `gate.2x1` | 2T × 1T | 2×1 | 두 cell 통로 |
| 표지판/횃불 | `object.1x2` | 1T × 2T | 1×1 | 세로 overflow |
| scarecrow | `object.1x2` | 1T × 2T | 1×1 | coverage는 metadata |
| sprinkler | `object.1x1` | 1T × 1T | 1×1 | coverage는 metadata |
| 상자 | `object.1x1` | 1T × 1T | 1×1 | open 상태도 기본 frame 유지 |

## 7. 제작 설비 규격

| Object family | 기본 프리셋 | Visual canvas | Footprint | 기준 |
|---|---|---:|---:|---|
| 소형 설비 | `machine.1x1` | 1T × 1T | 1×1 | 작은 제작 도구 |
| 세로 설비 | `machine.1x2` | 1T × 2T | 1×1 | 용광로, 가공기 기본 |
| 넓은 설비 | `machine.2x2` | 2T × 2T | 2×1 또는 2×2 | 작업대, 제분기 |
| 대형 설비 | `machine.3x3` | 3T × 3T | 2×2 | 풍차 부품 등 큰 장치 |
| 저장 탱크/사일로 | `machine.2x4` | 2T × 4T | 2×2 | 상부 visual overflow |

## 8. 실내 오브젝트 규격

| Object family | 기본 프리셋 | Visual canvas | Footprint | 기준 |
|---|---|---:|---:|---|
| 의자/stool | `furniture.1x1` | 1T × 1T | 1×1 | sit anchor 포함 |
| 1인 침대 | `furniture.1x2` | 1T × 2T | 1×2 | 누운 방향 기준 |
| 2인 침대 | `furniture.2x2` | 2T × 2T | 2×2 | 두 sleep anchor |
| 작은 테이블 | `furniture.2x2` | 2T × 2T | 2×2 | surface anchors |
| 큰 테이블 | `furniture.3x2` | 3T × 2T | 3×2 | 방향별 sprite 필요 |
| sofa | `furniture.2x1` | 2T × 1T | 2×1 | sit anchors |
| cabinet/책장 | `furniture.1x2` | 1T × 2T | 1×1 | 벽 방향, 세로 overflow |
| 주방 counter | `furniture.1x1` | 1T × 1T | 1×1 | 연결형은 adjacency 사용 |
| 문 | `door.1x2` | 1T × 2T | 1×1 | 아랫변이 이동 통로 기준 |
| 창문 | `window.1x1` | 1T × 1T | 해당 없음 | wall anchor |

## 9. 거리·광산·이동 장치 규격

| Object family | 기본 프리셋 | Visual canvas | Footprint | 기준 |
|---|---|---:|---:|---|
| bench | `outdoor.2x1` | 2T × 1T | 2×1 | sit anchors |
| 가로등/전봇대 | `outdoor.1x3` | 1T × 3T | 1×1 | 상부 overflow, light anchor |
| 시장 좌판 | `outdoor.3x2` | 3T × 2T | 3×2 | vendor anchor |
| 분수/동상 | `outdoor.2x3` | 2T × 3T | 2×2 | sorting/collision 분리 |
| minecart | `vehicle.2x1` | 2T × 1T | 2×1 | rail alignment |
| wagon/boat | `vehicle.3x2` | 3T × 2T | 3×2 | 방향별 canvas 고정 |
| elevator/gate | `device.2x2` | 2T × 2T | 2×1 | open/closed collision |
| portal | `device.2x3` | 2T × 3T | 2×1 | VFX overflow |

## 10. 건물 규격

건물은 하나의 공통 크기로 만들지 않는다. 실제 gameplay footprint를 체크박스로 선택하고, facade/roof가 차지하는 visual height를 따로 정한다.

| 설정 | 계산 |
|---|---|
| `building.WxH` | footprint `W×H` cells 선택 |
| visual width | 기본 `W×T`, 좌우 장식은 overflow로 추가 |
| visual height | footprint 높이 + facade/roof 높이 |
| entrance | footprint 안 출입 cell 지정 |
| pivot | entrance 또는 footprint bottom-center 기준 |
| sorting point | 캐릭터가 앞/뒤로 이동할 기준선 |

농가, 축사, 온실, 상점 등은 오브젝트 카탈로그의 각 building family에 실제 footprint 프리셋을 연결한다.

## 11. 체크박스 적용 결과

규격 체크박스를 선택하면 다음 값이 한 번에 바뀐다.

| 적용 대상 | 자동 설정 |
|---|---|
| T2I | 출력 ratio, prompt의 크기/점유 조건, 후보 canvas |
| I2I | Reference B 윤곽선 width/height/ratio와 바닥선 |
| 후처리 | 최종 target width/height, crop, visual overflow |
| Sprite | rect, pivot, PPU, sheet cell 크기 |
| Object | footprint, collision 기본값, sorting point 후보 |
| Unity | TextureImporter PPU/filter/compression, Sprite rect/pivot |
| 히스토리 | 선택한 scale profile ID와 revision 저장 |

모든 생성 결과는 사용한 `T`, scale profile, 실제 width/height, ratio를 상태 카드와 히스토리에 표시한다.
