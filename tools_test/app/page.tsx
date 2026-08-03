"use client";

/* eslint-disable @next/next/no-img-element -- blob previews and runtime-generated PNG URLs are intentionally shown without optimization. */

import { useEffect, useMemo, useState } from "react";

type ToolMode = "t2i" | "i2i";
type AssetCategory = "tile" | "object" | "character" | "creature" | "item" | "vfx" | "ui" | "guide";
type Direction = "front" | "back" | "left" | "right";
type Family = {
  id: string;
  name: string;
  group: string;
  profile: string;
  visualX: number;
  visualY: number;
  footprint: string;
};
type OptionDefinition = { key: string; title: string; values: string[] };
type HistoryItem = {
  id: string;
  asset: string;
  detail: string;
  job: "완료" | "대기" | "실패";
  assetState: "기준 선택" | "후처리" | "시트 생성" | "Unity 확인" | "반려";
  time: string;
};
type EndpointState = {
  status: "확인 중" | "연결됨" | "오류";
  model?: string;
  latencyMs?: number;
  message?: string;
};
type GeneratedAsset = {
  generationId: string;
  requestId: string;
  model: string;
  imageUrl: string;
  metadataUrl: string;
  bundleImageUrl?: string | null;
  bundleMetadataUrl?: string | null;
  mirroredImageUrl?: string | null;
  mirroredBundleImageUrl?: string | null;
  mirroredBundleMetadataUrl?: string | null;
  elapsedMs: number;
  outputBytes: number;
  size: string;
  seed: number;
  referenceImages?: Array<{ name: string; type: string; bytes: number; filename: string; url: string; width?: number; height?: number; size?: string }>;
  layout?: { frameX: number; frameY: number; frameWidth: number; frameHeight: number; baselineY: number; strokeWidth: number };
  selection?: { category: AssetCategory; direction: Direction; action: string; frameId: string; frameIndex: number };
};
type DirectionReference = { file: File | null; preview: string; name: string; stage: "source" | "generated" };
type BatchProgress = {
  status: "idle" | "direction" | "review" | "actions" | "complete" | "failed";
  bundleId: string;
  completed: number;
  total: number;
  current: string;
  manifestUrl?: string;
};

const GUIDE_LONG_EDGE = 1024;
const CHARACTER_TOP_ANCHOR = 0;
const CHARACTER_HEIGHT_OCCUPANCY = "100%";

const INITIAL_DIRECTION_REFERENCES: Record<Direction, DirectionReference> = {
  front: { file: null, preview: "/test-inputs/reference-character-front.png", name: "reference-character-front.png", stage: "source" },
  back: { file: null, preview: "", name: "back.ref 미등록", stage: "generated" },
  left: { file: null, preview: "", name: "left.ref 미등록", stage: "generated" },
  right: { file: null, preview: "", name: "right.ref 미등록", stage: "generated" },
};

const SCALE_PRESETS = [
  { id: "T16", pixels: 16, description: "고전형" },
  { id: "T32", pixels: 32, description: "기본" },
  { id: "T64", pixels: 64, description: "고밀도" },
];

const CATEGORY_META: Record<AssetCategory, { label: string; short: string; description: string }> = {
  tile: { label: "타일", short: "TL", description: "지형·물·전이·길·실내·디버그 타일" },
  object: { label: "오브젝트", short: "OB", description: "자연물·농장·설비·건물·가구·장치" },
  character: { label: "캐릭터", short: "CH", description: "플레이어·NPC·초상화·장비 레이어" },
  creature: { label: "생명체", short: "CR", description: "가축·반려동물·야생동물·몬스터" },
  item: { label: "아이템", short: "IT", description: "도구·무기·재료·음식·장비·퀘스트" },
  vfx: { label: "VFX", short: "FX", description: "이동·도구·농사·상태·환경 효과" },
  ui: { label: "UI", short: "UI", description: "HUD·인벤토리·대화·지도·커서" },
  guide: { label: "가이드", short: "GD", description: "규격·포즈·autotile·footprint 템플릿" },
};

const T2I_CATEGORIES = Object.keys(CATEGORY_META) as AssetCategory[];
const I2I_CATEGORIES: AssetCategory[] = ["character", "object", "tile"];

const PROFILE_SHAPES: Record<string, { visualX: number; visualY: number; footprint: string }> = {
  "tile.1x1": { visualX: 1, visualY: 1, footprint: "1×1" },
  "character.standard": { visualX: 1, visualY: 2, footprint: "1×1" },
  "character.large": { visualX: 2, visualY: 3, footprint: "2×1" },
  "portrait.standard": { visualX: 4, visualY: 4, footprint: "—" },
  "object.1x1": { visualX: 1, visualY: 1, footprint: "1×1" },
  "object.1x2": { visualX: 1, visualY: 2, footprint: "1×1" },
  "object.2x1": { visualX: 2, visualY: 1, footprint: "2×1" },
  "object.2x2": { visualX: 2, visualY: 2, footprint: "2×2" },
  "object.2x3": { visualX: 2, visualY: 3, footprint: "2×2" },
  "nature.tree.3x5": { visualX: 3, visualY: 5, footprint: "1×1" },
  "crop.1x1": { visualX: 1, visualY: 1, footprint: "1×1" },
  "crop.1x2": { visualX: 1, visualY: 2, footprint: "1×1" },
  "crop.2x2": { visualX: 2, visualY: 2, footprint: "2×2" },
  "machine.1x2": { visualX: 1, visualY: 2, footprint: "1×1" },
  "machine.2x2": { visualX: 2, visualY: 2, footprint: "2×2" },
  "machine.2x4": { visualX: 2, visualY: 4, footprint: "2×2" },
  "furniture.2x1": { visualX: 2, visualY: 1, footprint: "2×1" },
  "furniture.2x2": { visualX: 2, visualY: 2, footprint: "2×2" },
  "outdoor.3x2": { visualX: 3, visualY: 2, footprint: "3×2" },
  "building.6x7": { visualX: 6, visualY: 7, footprint: "6×5" },
  "creature.2x2": { visualX: 2, visualY: 2, footprint: "1×1" },
  "item.1x1": { visualX: 1, visualY: 1, footprint: "—" },
  "vfx.2x2": { visualX: 2, visualY: 2, footprint: "—" },
  "ui.4x4": { visualX: 4, visualY: 4, footprint: "—" },
  "guide.2x2": { visualX: 2, visualY: 2, footprint: "—" },
};

function makeFamilies(prefix: string, group: string, names: string[], profile: string): Family[] {
  const shape = PROFILE_SHAPES[profile] ?? PROFILE_SHAPES["object.1x1"];
  return names.map((name, index) => ({ id: `${prefix}-${index}`, name, group, profile, ...shape }));
}
const FAMILY_CATALOG: Record<AssetCategory, Family[]> = {
  tile: [
    ...makeFamilies("tile-surface", "자연 지표면", ["잔디", "흙", "경작지", "모래", "얕은 물", "깊은 물", "자갈", "암반", "눈", "얼음", "늪·습지", "낙엽·꽃잎", "재·화산"], "tile.1x1"),
    ...makeFamilies("tile-water", "물·해안", ["해안선", "얕은↔깊은 물", "강물", "연못", "폭포", "관개수로", "독·용암"], "tile.1x1"),
    ...makeFamilies("tile-height", "전이·높이", ["잔디↔흙", "잔디↔모래", "흙↔암반", "눈↔노출 지면", "절벽", "단독 암주", "옹벽", "자연 계단", "경사로", "동굴 입구", "구멍·void"], "tile.1x1"),
    ...makeFamilies("tile-path", "길·포장", ["흙길", "나무 길", "돌길", "벽돌길", "마을 도로", "광산 레일", "장식 border"], "tile.1x1"),
    ...makeFamilies("tile-structure", "구조 연결", ["나무 다리", "돌·밧줄 다리", "계단", "사다리", "부두", "울타리", "벽·담장"], "tile.1x1"),
    ...makeFamilies("tile-indoor", "실내", ["바닥", "특수 바닥", "벽", "특수 벽", "baseboard·trim", "beam·pillar", "문틀·창틀", "주방 counter", "rug·carpet", "실내 계단·난간", "cutaway mask"], "tile.1x1"),
    ...makeFamilies("tile-debug", "Gameplay·디버그", ["건축 가능 overlay", "경작 overlay", "interaction trigger", "collision overlay", "NPC path", "spawn", "낚시 구역", "함정·압력판"], "tile.1x1"),
  ],
  object: [
    ...makeFamilies("obj-tree", "나무·식생", ["일반 나무", "과실수"], "nature.tree.3x5"),
    ...makeFamilies("obj-plant", "나무·식생", ["관목", "풀·잡초", "꽃", "수생 식물", "균류", "특수 식생"], "object.1x1"),
    ...makeFamilies("obj-rock", "바위·채집", ["작은 돌", "나무 잔해", "잡초 장애물", "광석 노드", "보석·수정", "계절 장애물", "육지 채집물", "해변 채집물"], "object.1x1"),
    ...makeFamilies("obj-rock-big", "바위·채집", ["큰 바위", "희귀 노드"], "object.2x2"),
    ...makeFamilies("obj-crop", "작물", ["잎채소", "뿌리채소", "반복 수확", "곡물", "재배 꽃", "과실 관목", "병충해"], "crop.1x1"),
    ...makeFamilies("obj-crop-tall", "작물", ["지지대 작물"], "crop.1x2"),
    ...makeFamilies("obj-crop-giant", "작물", ["거대 작물"], "crop.2x2"),
    ...makeFamilies("obj-farm-small", "농장 경계·배치", ["울타리", "sprinkler", "화단·화분", "벌통", "자동화 장치"], "object.1x1"),
    ...makeFamilies("obj-farm-tall", "농장 경계·배치", ["표지판", "scarecrow", "횃불·농장등", "사료 설비"], "object.1x2"),
    ...makeFamilies("obj-farm-wide", "농장 경계·배치", ["울타리 문", "양식장"], "object.2x1"),
    ...makeFamilies("obj-machine-small", "보관·제작·가공", ["상자", "판매함"], "object.1x1"),
    ...makeFamilies("obj-machine", "보관·제작·가공", ["용광로", "기본 가공기", "숯가마", "착유기", "양조기", "재봉·방직", "자원 설비"], "machine.1x2"),
    ...makeFamilies("obj-machine-wide", "보관·제작·가공", ["작업대", "제분기", "염색 설비", "물 설비", "전력 설비"], "machine.2x2"),
    ...makeFamilies("obj-building-farm", "농장 건물", ["농가", "농가 업그레이드", "축사", "축사 확장", "온실", "풍차", "창고·작업장", "우물", "특수 생산 건물"], "building.6x7"),
    ...makeFamilies("obj-silo", "농장 건물", ["사일로"], "machine.2x4"),
    ...makeFamilies("obj-building-town", "마을·공공·상업", ["상점", "대장간", "진료소", "여관·식당", "주민 주택", "공공 시설", "문화 시설", "기능 시설", "축제 건물 장식"], "building.6x7"),
    ...makeFamilies("obj-outdoor-small", "거리·야외 소품", ["우편·게시", "폐기·보관", "도로 소품", "장식"], "object.1x2"),
    ...makeFamilies("obj-outdoor", "거리·야외 소품", ["휴식 시설", "조명", "조경", "시장", "운반 소품", "기념물"], "outdoor.3x2"),
    ...makeFamilies("obj-indoor-small", "실내 구조·가구", ["문", "창문", "수직 이동", "수납 가구", "주방", "작업", "난방·조명", "욕실", "장식"], "object.1x2"),
    ...makeFamilies("obj-indoor", "실내 구조·가구", ["침대", "테이블·의자", "거실", "상업 가구"], "furniture.2x2"),
    ...makeFamilies("obj-mine", "광산·동굴·던전", ["출입 장치", "광산 운송", "지지 구조", "광원", "파괴 용기", "보상", "함정", "환경 장식", "보스 장치"], "object.2x2"),
    ...makeFamilies("obj-device", "이동수단·월드 장치", ["수상 이동", "육상 이동", "차량", "승강 장치", "포털", "제어 장치", "작동 구조", "시간·날씨 장치"], "outdoor.3x2"),
  ],
  character: [
    ...makeFamilies("char-main", "캐릭터 family", ["플레이어", "주요 NPC", "서비스 NPC", "주민", "방문객·축제 NPC", "비인간형"], "character.standard"),
    ...makeFamilies("char-large", "캐릭터 family", ["대형 인간형"], "character.large"),
    ...makeFamilies("char-portrait", "초상화·레이어", ["대화 초상화"], "portrait.standard"),
    ...makeFamilies("char-layer", "초상화·레이어", ["body·skin", "hair front·back", "의상", "신발", "모자·액세서리", "held item·tool·weapon", "shadow"], "character.standard"),
  ],
  creature: [
    ...makeFamilies("creature", "동물·몬스터", ["가축", "가축 확장", "반려동물", "야생동물", "기본 몬스터", "몬스터 확장", "elite·boss"], "creature.2x2"),
  ],
  item: [
    ...makeFamilies("item", "아이템 표현", ["농기구", "무기", "농사", "자원", "채집·낚시", "가공품", "소비품", "장비", "퀘스트", "특수"], "item.1x1"),
  ],
  vfx: [
    ...makeFamilies("vfx", "VFX", ["이동", "도구", "농사", "제작", "상태", "환경", "자연", "연출"], "vfx.2x2"),
  ],
  ui: [
    ...makeFamilies("ui", "UI", ["HUD", "인벤토리", "패널", "대화", "입력·커서", "지도", "알림", "관계", "디버그 overlay"], "ui.4x4"),
  ],
  guide: [
    ...makeFamilies("guide", "생성 가이드", ["실제 규격 프레임", "공통 바닥선", "캐릭터·오브젝트 점유", "방향 포즈", "동작 포즈", "공통 점유", "오브젝트 상태", "타일 edge·corner·blob", "건물 footprint"], "guide.2x2"),
  ],
};

const OPTION_GROUPS: Record<AssetCategory, OptionDefinition[]> = {
  tile: [
    { key: "environment", title: "환경", values: ["농장", "마을", "광산", "실내", "해안"] },
    { key: "season", title: "계절", values: ["봄", "여름", "가을", "겨울"] },
    { key: "weather", title: "날씨", values: ["맑음", "젖음", "눈", "안개"] },
    { key: "topology", title: "연결", values: ["center", "edge", "outer corner", "inner corner", "transition", "47-tile blob"] },
    { key: "state", title: "상태", values: ["기본", "손상", "애니메이션", "계절 overlay"] },
    { key: "physics", title: "물리", values: ["walkable", "farmable", "fishable", "collision"] },
  ],
  object: [
    { key: "material", title: "소재", values: ["목재", "석재", "금속", "천", "유리", "자연 소재"] },
    { key: "environment", title: "배치 환경", values: ["농장", "마을", "실내", "광산", "물가"] },
    { key: "state", title: "상태", values: ["기본", "열림", "작동 중", "완료", "가득 참", "손상"] },
    { key: "facing", title: "방향 수", values: ["고정", "2방향", "4방향"] },
  ],
  character: [
    { key: "gender", title: "성별 표현", values: ["여성", "남성", "중성"] },
    { key: "age", title: "연령대", values: ["어린이", "청년", "성인", "노년"] },
    { key: "height", title: "키", values: ["작음", "보통", "큼"] },
    { key: "build", title: "체형", values: ["슬림", "보통", "탄탄", "큰 체형"] },
    { key: "skin", title: "피부색", values: ["밝음", "중간", "짙음", "비인간색"] },
    { key: "face", title: "얼굴·표정", values: ["둥근 얼굴", "각진 얼굴", "기본 표정", "미소"] },
    { key: "hair", title: "머리", values: ["단발 흑발", "장발 갈색", "곱슬 은발", "묶은 적갈색", "수염"] },
    { key: "outfit", title: "의상", values: ["농부 작업복", "대장장이 앞치마", "여행자 코트", "마을 평상복"] },
    { key: "role", title: "역할", values: ["플레이어", "농부", "상인", "대장장이", "의사", "주민"] },
    { key: "feature", title: "특징", values: ["없음", "모자", "안경", "직업 소품", "좌우 비대칭"] },
  ],
  creature: [
    { key: "archetype", title: "체형", values: ["조류", "사족보행", "비행", "수중", "인간형", "슬라임형"] },
    { key: "age", title: "성장", values: ["baby", "adult", "elite"] },
    { key: "state", title: "기본 동작", values: ["idle", "walk", "eat", "sleep", "attack"] },
    { key: "variant", title: "변형", values: ["기본색", "밝은색", "어두운색", "희귀색"] },
  ],
  item: [
    { key: "representation", title: "표현", values: ["inventory icon", "world drop", "held-front", "held-overhead", "equipped overlay"] },
    { key: "tier", title: "등급", values: ["기본", "구리", "철", "금", "희귀"] },
    { key: "material", title: "소재", values: ["목재", "석재", "금속", "식물", "음식", "천"] },
    { key: "state", title: "상태", values: ["기본", "사용 중", "손상", "고급"] },
  ],
  vfx: [
    { key: "timing", title: "재생", values: ["one-shot", "loop", "hold"] },
    { key: "direction", title: "방향", values: ["무방향", "4방향", "방사형", "진행 방향"] },
    { key: "blend", title: "합성", values: ["alpha", "additive", "emissive"] },
    { key: "intensity", title: "강도", values: ["약함", "보통", "강함"] },
  ],
  ui: [
    { key: "state", title: "상태", values: ["normal", "hover", "selected", "disabled", "warning"] },
    { key: "layout", title: "구조", values: ["icon", "nine-slice", "atlas", "marker", "glyph"] },
    { key: "scale", title: "UI 배율", values: ["1x", "2x", "4x"] },
    { key: "theme", title: "테마", values: ["농장", "마을", "광산", "축제"] },
  ],
  guide: [
    { key: "guideType", title: "가이드 종류", values: ["layout", "pose", "autotile", "footprint", "building"] },
    { key: "cells", title: "점유", values: ["1×1", "1×2", "2×1", "2×2", "3×2"] },
    { key: "mark", title: "표시", values: ["outline", "baseline", "joint", "anchor", "motion path"] },
  ],
};

const DIRECTIONS: Array<{ id: Direction; label: string }> = [
  { id: "front", label: "정면" },
  { id: "back", label: "후면" },
  { id: "left", label: "좌측" },
  { id: "right", label: "우측" },
];

const DIRECTION_LAYOUTS: Record<Direction, { occupancy: string; height: string; safeMargin: string; reference: string; note: string }> = {
  front: { occupancy: "78%", height: CHARACTER_HEIGHT_OCCUPANCY, safeMargin: "11%", reference: "character.farmer.front.ref", note: "어깨·양팔·양발이 보이는 정면 실루엣" },
  back: { occupancy: "76%", height: CHARACTER_HEIGHT_OCCUPANCY, safeMargin: "12%", reference: "character.farmer.back.ref", note: "얼굴 없이 등·후두부 중심의 후면 실루엣" },
  left: { occupancy: "56%", height: CHARACTER_HEIGHT_OCCUPANCY, safeMargin: "22%", reference: "character.farmer.left.ref", note: "몸통 폭을 줄이고 겹친 팔다리를 표시하는 측면 실루엣" },
  right: { occupancy: "56%", height: CHARACTER_HEIGHT_OCCUPANCY, safeMargin: "22%", reference: "character.farmer.right.ref", note: "좌측 기준을 수평 반전해 동일 픽셀로 저장" },
};

const ACTIONS = [
  { id: "walk_empty", label: "빈손 걷기", frames: 4 },
  { id: "weapon_1h", label: "한손 무기 들기", frames: 2 },
  { id: "weapon_2h", label: "양손 무기 들기", frames: 2 },
  { id: "tool_swing", label: "도구 휘두르기", frames: 4 },
  { id: "bow_shoot", label: "활 쏘기", frames: 3 },
  { id: "carry_front", label: "물건을 앞에 들기", frames: 1 },
  { id: "carry_overhead", label: "물건을 머리 위에 들기", frames: 1 },
];

const ACTION_EXPORT_PREFIX: Record<string, string> = {
  weapon_1h: "Weapon1H",
  weapon_2h: "Weapon2H",
  tool_swing: "ToolSwing",
  bow_shoot: "BowShoot",
  carry_front: "CarryFront",
  carry_overhead: "CarryOverhead",
};

const ACTION_INSTRUCTIONS: Record<string, string> = {
  walk_empty: "Empty hands.",
  weapon_1h: "Hold one one-handed weapon.",
  weapon_2h: "Hold one weapon with both hands.",
  tool_swing: "Swing one tool.",
  bow_shoot: "Shoot one bow.",
  carry_front: "Hold one object in front.",
  carry_overhead: "Hold one object overhead.",
};

type ActionPreset = (typeof ACTIONS)[number];
type FramePhase = { id: string; label: string; prompt: string };

const DIRECTION_EXPORT_NAMES: Record<Direction, string> = {
  front: "Down",
  back: "Up",
  left: "Left",
  right: "Right",
};

const DIRECTION_PROMPT_RULES: Record<Direction, string> = {
  front: "Strict front view. Both eyes aligned.",
  back: "Strict back view. No face or eyes visible.",
  left: "Strict full left profile. Nose points left. Exactly one eye visible. No right eye.",
  right: "Strict full right profile. Nose points right. Exactly one eye visible. No left eye.",
};

function makeFramePhases(actionPreset: ActionPreset, direction: Direction): FramePhase[] {
  if (actionPreset.id === "walk_empty") {
    const side = direction === "left" || direction === "right";
    const labels = side ? ["앞발 전진", "중간", "뒷발 전진", "중간"] : ["화면 왼쪽 발 전진", "중간", "화면 오른쪽 발 전진", "중간"];
    return labels.map((label, index) => ({
      id: `Walk_${DIRECTION_EXPORT_NAMES[direction]}_${String(index + 1).padStart(2, "0")}`,
      label,
      prompt: label,
    }));
  }
  const exportPrefix = ACTION_EXPORT_PREFIX[actionPreset.id] ?? actionPreset.id;
  return Array.from({ length: actionPreset.frames }, (_, index) => ({
    id: `${exportPrefix}_${DIRECTION_EXPORT_NAMES[direction]}_${String(index + 1).padStart(2, "0")}`,
    label: `프레임 ${index + 1}`,
    prompt: `frame ${index + 1}`,
  }));
}

function characterActionPrompt(direction: Direction, actionPreset: ActionPreset, frame: FramePhase) {
  return `Keep image 1 colors, face, hair, clothing, and proportions exact. Change only direction and pose. ${DIRECTION_PROMPT_RULES[direction]} Match pose ${frame.id} from image 2. Fill the black rectangle vertically: head touches the top edge and feet touch the bottom edge. Keep everything inside. ${ACTION_INSTRUCTIONS[actionPreset.id]} Remove guide marks.`;
}

function directionReferencePrompt(direction: Direction) {
  return `Keep image 1 colors, face, hair, clothing, and proportions exact. Change only direction. ${DIRECTION_PROMPT_RULES[direction]} Match the idle pose from image 2. Fill the black rectangle vertically: head touches the top edge and feet touch the bottom edge. Keep everything inside. Remove guide marks.`;
}

function guideCanvasSize(visualX: number, visualY: number) {
  const unit = Math.max(128, Math.floor(GUIDE_LONG_EDGE / Math.max(visualX, visualY) / 64) * 64);
  return { width: visualX * unit, height: visualY * unit };
}

function guideFrameGeometry(visualX: number, visualY: number) {
  const { width, height } = guideCanvasSize(visualX, visualY);
  const strokeWidth = Math.max(6, Math.min(width, height) * 0.012);
  const availableWidth = width - strokeWidth;
  const availableHeight = height - strokeWidth;
  const frameUnit = Math.min(availableWidth / visualX, availableHeight / visualY);
  const frameWidth = visualX * frameUnit;
  const frameHeight = visualY * frameUnit;
  const frameX = (width - frameWidth) * 0.5;
  const frameY = (height - frameHeight) * 0.5;
  return {
    width,
    height,
    frame: {
      frameX: Math.round(frameX),
      frameY: Math.round(frameY),
      frameWidth: Math.round(frameWidth),
      frameHeight: Math.round(frameHeight),
      baselineY: Math.round(frameY + frameHeight),
      strokeWidth: Math.round(strokeWidth),
    },
  };
}

const DEFAULT_HISTORY: HistoryItem[] = [
  { id: "GEN-024", asset: "character.farmer_02", detail: "T32 · front.ref · tool_swing", job: "완료", assetState: "기준 선택", time: "방금" },
  { id: "GEN-023", asset: "object.furnace", detail: "32×64 · processing", job: "완료", assetState: "Unity 확인", time: "12분 전" },
  { id: "GEN-022", asset: "tile.grass", detail: "32×32 · transition", job: "완료", assetState: "후처리", time: "28분 전" },
  { id: "GEN-021", asset: "object.market_stall", detail: "96×64 · closed", job: "실패", assetState: "반려", time: "41분 전" },
];

const INITIAL_SELECTIONS = Object.fromEntries(
  Object.entries(OPTION_GROUPS).flatMap(([category, groups]) => groups.map((group) => [`${category}.${group.key}`, group.values[0]])),
);

function pick<T>(values: T[]) {
  return values[Math.floor(Math.random() * values.length)];
}

function debugLog(event: string, details: Record<string, unknown> = {}) {
  console.info(`[AssetForge][${event}]`, details);
}

function OptionGroup({
  category,
  definition,
  selected,
  locked,
  onSelect,
  onRandom,
  onLock,
}: {
  category: AssetCategory;
  definition: OptionDefinition;
  selected: string;
  locked: boolean;
  onSelect: (value: string) => void;
  onRandom: () => void;
  onLock: () => void;
}) {
  return (
    <section className="option-group" data-testid={`option-group-${category}-${definition.key}`}>
      <div className="option-heading">
        <span>{definition.title}</span>
        <div className="option-tools">
          <button type="button" className="micro-button" onClick={onRandom} disabled={locked}>랜덤</button>
          <button type="button" className={locked ? "lock-button is-locked" : "lock-button"} onClick={onLock} aria-pressed={locked}>{locked ? "잠금됨" : "잠금"}</button>
        </div>
      </div>
      <div className="check-grid">
        {definition.values.map((value) => (
          <button key={value} type="button" role="checkbox" aria-checked={selected === value} className={selected === value ? "check-option is-checked" : "check-option"} onClick={() => onSelect(value)}>
            <span className="check-box" aria-hidden="true">{selected === value ? "✓" : ""}</span><span>{value}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PoseGuide({ action, direction, frameIndex = 0, compact = false }: { action: string; direction: Direction; frameIndex?: number; compact?: boolean }) {
  return (
    <div className={`pose-guide direction-${direction} pose-${action} frame-${frameIndex}${compact ? " is-compact" : ""}`} aria-label={`${direction} ${action} frame ${frameIndex + 1} 포즈 가이드`} data-testid="asset-pose" data-direction={direction} data-action={action} data-frame={frameIndex} data-ground-contact="aligned" data-occupancy={DIRECTION_LAYOUTS[direction].occupancy}>
      <span className="pose-back-shape" />
      <span className="pose-head" />
      <span className="pose-face-mark" />
      <span className="pose-torso" />
      <span className="pose-arm pose-arm-left" />
      <span className="pose-arm pose-arm-right" />
      <span className="pose-leg pose-leg-left" />
      <span className="pose-leg pose-leg-right" />
      <span className="pose-equipment" />
      <span className="pose-item" />
    </div>
  );
}

function objectSchematicKind(family: Family) {
  if (family.profile.includes("tree")) return "tree";
  if (family.profile.includes("2x4") || family.profile.includes("building")) return "silo";
  if (family.profile.includes("furniture") || family.profile.includes("outdoor")) return "table";
  if (family.profile.includes("machine")) return "furnace";
  return "chest";
}

function ObjectSchematic({ family, compact = false }: { family: Family; compact?: boolean }) {
  const kind = objectSchematicKind(family);
  return (
    <div className={`object-schematic schematic-${kind}${compact ? " is-compact" : ""}`} aria-label={`${family.name} 배치 가이드`} data-testid="asset-object" data-family={family.id} data-ground-contact="aligned">
      <span className="schematic-part part-a" /><span className="schematic-part part-b" /><span className="schematic-part part-c" />
    </div>
  );
}

function TileGuide({ topology, compact = false }: { topology: string; compact?: boolean }) {
  return (
    <div className={`tile-guide topology-${topology.replaceAll(" ", "-")}${compact ? " is-compact" : ""}`} data-testid="asset-tile" data-topology={topology}>
      {Array.from({ length: 9 }, (_, index) => <span key={index} className={`tile-cell tile-cell-${index}`} />)}
    </div>
  );
}

async function createLayoutGuide(
  visualX: number,
  visualY: number,
  category: AssetCategory,
  direction: Direction,
  action: string,
  frameIndex: number,
): Promise<{ blob: Blob; width: number; height: number; frame: NonNullable<GeneratedAsset["layout"]> }> {
  const { width, height, frame } = guideFrameGeometry(visualX, visualY);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context를 만들 수 없습니다.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const { frameX, frameY, frameWidth, frameHeight, baselineY: baseline, strokeWidth } = frame;
  context.strokeStyle = "#000000";
  context.lineWidth = strokeWidth;
  context.strokeRect(frameX, frameY, frameWidth, frameHeight);

  context.strokeStyle = "#555555";
  context.fillStyle = "#555555";
  context.lineWidth = Math.max(8, Math.min(width, height) * 0.025);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (category === "character") {
    const side = direction === "left" || direction === "right";
    const centerX = frameX + frameWidth * 0.5;
    const occupancy = Number.parseFloat(DIRECTION_LAYOUTS[direction].occupancy) / 100;
    const placementWidth = frameWidth * occupancy;
    const placementTop = frameY + frameHeight * CHARACTER_TOP_ANCHOR;
    context.save();
    context.strokeStyle = "#777777";
    context.lineWidth = Math.max(4, Math.min(width, height) * 0.009);
    context.setLineDash([Math.max(8, width * 0.02), Math.max(5, width * 0.012)]);
    context.strokeRect(centerX - placementWidth * 0.5, placementTop, placementWidth, baseline - placementTop);
    context.setLineDash([]);
    context.fillStyle = "#777777";
    context.fillRect(centerX - placementWidth * 0.18, placementTop, placementWidth * 0.36, context.lineWidth);
    context.fillRect(centerX - placementWidth * 0.18, baseline - context.lineWidth, placementWidth * 0.36, context.lineWidth);
    context.restore();
    const headRadius = frameWidth * (side ? 0.105 : 0.135);
    const headY = frameY + headRadius;
    const shoulderY = frameY + frameHeight * 0.35;
    const hipY = frameY + frameHeight * 0.61;
    const stride = action === "walk_empty" ? frameWidth * (side ? 0.18 : 0.24) : frameWidth * 0.13;
    let leftFootOffset = -stride;
    let rightFootOffset = stride;
    if (action === "walk_empty") {
      if (side) {
        const forward = direction === "left" ? -1 : 1;
        const phases = [
          [forward * stride, -forward * stride * 0.35],
          [-forward * stride * 0.12, forward * stride * 0.12],
          [-forward * stride, forward * stride * 0.35],
          [forward * stride * 0.12, -forward * stride * 0.12],
        ];
        [leftFootOffset, rightFootOffset] = phases[frameIndex % phases.length];
      } else {
        const phases = [
          [-stride, stride * 0.25],
          [-stride * 0.12, stride * 0.12],
          [-stride * 0.25, stride],
          [stride * 0.12, -stride * 0.12],
        ];
        [leftFootOffset, rightFootOffset] = phases[frameIndex % phases.length];
      }
    }

    let leftHandX = centerX - frameWidth * (side ? 0.12 : 0.25);
    let leftHandY = frameY + frameHeight * 0.5;
    let rightHandX = centerX + frameWidth * (side ? 0.11 : 0.25);
    let rightHandY = frameY + frameHeight * 0.48;
    const phase = frameIndex % Math.max(1, ACTIONS.find((item) => item.id === action)?.frames ?? 1);

    if (action === "weapon_1h") {
      rightHandX = centerX + frameWidth * 0.3;
      rightHandY = frameY + frameHeight * (phase === 0 ? 0.39 : 0.48);
    } else if (action === "weapon_2h" || action === "tool_swing") {
      const raised = action === "tool_swing" && phase < 2;
      leftHandX = centerX - frameWidth * 0.15;
      rightHandX = centerX + frameWidth * 0.15;
      leftHandY = rightHandY = frameY + frameHeight * (raised ? 0.28 : 0.43);
    } else if (action === "bow_shoot") {
      leftHandX = centerX + frameWidth * 0.24;
      rightHandX = centerX - frameWidth * (phase === 2 ? 0.08 : 0.2);
      leftHandY = rightHandY = frameY + frameHeight * 0.4;
    } else if (action === "carry_front") {
      leftHandX = centerX - frameWidth * 0.2;
      rightHandX = centerX + frameWidth * 0.2;
      leftHandY = rightHandY = frameY + frameHeight * 0.49;
    } else if (action === "carry_overhead") {
      leftHandX = centerX - frameWidth * 0.18;
      rightHandX = centerX + frameWidth * 0.18;
      leftHandY = rightHandY = frameY + frameHeight * 0.16;
    }

    context.beginPath();
    context.arc(centerX, headY, headRadius, 0, Math.PI * 2);
    context.stroke();
    if (direction === "left" || direction === "right") {
      const facing = direction === "left" ? -1 : 1;
      context.beginPath();
      context.moveTo(centerX + facing * headRadius * 0.9, headY - headRadius * 0.1);
      context.lineTo(centerX + facing * headRadius * 1.35, headY + headRadius * 0.12);
      context.lineTo(centerX + facing * headRadius * 0.88, headY + headRadius * 0.25);
      context.stroke();
      context.beginPath();
      context.arc(centerX + facing * headRadius * 0.45, headY - headRadius * 0.18, context.lineWidth * 0.48, 0, Math.PI * 2);
      context.fill();
    }
    context.beginPath();
    context.moveTo(centerX, headY + headRadius);
    context.lineTo(centerX, hipY);
    context.moveTo(centerX, shoulderY);
    context.lineTo(leftHandX, leftHandY);
    context.moveTo(centerX, shoulderY);
    context.lineTo(rightHandX, rightHandY);
    context.moveTo(centerX, hipY);
    context.lineTo(centerX + leftFootOffset, baseline);
    context.moveTo(centerX, hipY);
    context.lineTo(centerX + rightFootOffset, baseline);
    context.moveTo(centerX + leftFootOffset - frameWidth * 0.05, baseline);
    context.lineTo(centerX + leftFootOffset + frameWidth * 0.08, baseline);
    context.moveTo(centerX + rightFootOffset - frameWidth * 0.05, baseline);
    context.lineTo(centerX + rightFootOffset + frameWidth * 0.08, baseline);
    context.stroke();
    context.beginPath();
    context.arc(centerX, hipY, context.lineWidth * 0.7, 0, Math.PI * 2);
    context.fill();

    context.lineWidth = Math.max(6, Math.min(width, height) * 0.018);
    if (action === "weapon_1h") {
      context.beginPath();
      context.moveTo(rightHandX, rightHandY);
      context.lineTo(rightHandX + frameWidth * 0.18, rightHandY - frameHeight * 0.19);
      context.stroke();
    } else if (action === "weapon_2h") {
      context.beginPath();
      context.moveTo(centerX - frameWidth * 0.34, leftHandY + frameHeight * 0.1);
      context.lineTo(centerX + frameWidth * 0.34, rightHandY - frameHeight * 0.1);
      context.stroke();
    } else if (action === "tool_swing") {
      const angle = [-0.32, -0.1, 0.16, 0.34][phase] ?? 0;
      context.beginPath();
      context.moveTo(centerX - frameWidth * angle, leftHandY - frameHeight * 0.08);
      context.lineTo(centerX + frameWidth * angle, frameY + frameHeight * 0.67);
      context.stroke();
      context.beginPath();
      context.moveTo(centerX + frameWidth * angle - frameWidth * 0.12, frameY + frameHeight * 0.67);
      context.lineTo(centerX + frameWidth * angle + frameWidth * 0.12, frameY + frameHeight * 0.67);
      context.stroke();
    } else if (action === "bow_shoot") {
      const bowX = centerX + frameWidth * 0.28;
      context.beginPath();
      context.arc(bowX, leftHandY, frameWidth * 0.19, Math.PI * 0.5, Math.PI * 1.5);
      context.stroke();
      context.beginPath();
      context.moveTo(bowX, leftHandY - frameWidth * 0.19);
      context.lineTo(rightHandX, rightHandY);
      context.lineTo(bowX, leftHandY + frameWidth * 0.19);
      context.moveTo(rightHandX, rightHandY);
      context.lineTo(bowX + frameWidth * 0.18, leftHandY);
      context.stroke();
    } else if (action === "carry_front" || action === "carry_overhead") {
      const itemWidth = frameWidth * 0.42;
      const itemHeight = frameHeight * 0.16;
      const itemY = action === "carry_overhead" ? frameY + frameHeight * 0.035 : frameY + frameHeight * 0.43;
      context.strokeRect(centerX - itemWidth * 0.5, itemY, itemWidth, itemHeight);
    }
  } else if (category === "tile") {
    const cellWidth = frameWidth / 3;
    const cellHeight = frameHeight / 3;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        context.globalAlpha = row === 1 || column === 1 ? 0.5 : 0.15;
        context.fillRect(frameX + column * cellWidth, frameY + row * cellHeight, cellWidth, cellHeight);
      }
    }
    context.globalAlpha = 1;
  } else {
    const objectWidth = frameWidth * 0.72;
    const objectHeight = frameHeight * 0.62;
    context.strokeRect(frameX + (frameWidth - objectWidth) * 0.5, baseline - objectHeight, objectWidth, objectHeight);
    context.beginPath();
    context.moveTo(frameX + frameWidth * 0.22, baseline - objectHeight * 0.55);
    context.lineTo(frameX + frameWidth * 0.78, baseline - objectHeight * 0.55);
    context.stroke();
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("레이아웃 PNG 생성 실패")), "image/png");
  });
  debugLog("GUIDE_CREATED", {
    category,
    direction,
    action,
    frameIndex,
    canvas: `${width}x${height}`,
    frame: `${Math.round(frameWidth)}x${Math.round(frameHeight)}@${Math.round(frameX)},${Math.round(frameY)}`,
    baseline: Math.round(baseline),
  });
  return {
    blob,
    width,
    height,
    frame,
  };
}

async function normalizeReferenceOnWhite(
  source: Blob,
  targetWidth: number,
  targetHeight: number,
  fillFrame?: NonNullable<GeneratedAsset["layout"]>,
) {
  const bitmap = await createImageBitmap(source);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = bitmap.width;
  sourceCanvas.height = bitmap.height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    bitmap.close();
    throw new Error("Reference A 외곽 분석 실패");
  }
  sourceContext.fillStyle = "#ffffff";
  sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceContext.drawImage(bitmap, 0, 0);

  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;
  if (fillFrame) {
    const pixels = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let minX = bitmap.width;
    let minY = bitmap.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        const offset = (y * bitmap.width + x) * 4;
        const foreground = pixels[offset + 3] > 16 && (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245);
        if (!foreground) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX >= minX && maxY >= minY) {
      sourceX = minX;
      sourceY = minY;
      sourceWidth = maxX - minX + 1;
      sourceHeight = maxY - minY + 1;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Reference A 흰 배경 합성 실패");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const targetFrame = fillFrame ?? { frameX: 0, frameY: 0, frameWidth: targetWidth, frameHeight: targetHeight, baselineY: targetHeight, strokeWidth: 0 };
  const scale = Math.min(targetFrame.frameWidth / sourceWidth, targetFrame.frameHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const drawX = Math.round(targetFrame.frameX + (targetFrame.frameWidth - width) * 0.5);
  const drawY = Math.round(targetFrame.frameY + targetFrame.frameHeight - height);
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, drawX, drawY, width, height);
  debugLog("REFERENCE_A_NORMALIZED", {
    source: `${bitmap.width}x${bitmap.height}`,
    foreground: `${sourceWidth}x${sourceHeight}@${sourceX},${sourceY}`,
    target: `${targetWidth}x${targetHeight}`,
    drawn: `${width}x${height}@${drawX},${drawY}`,
    frame: fillFrame ? `${fillFrame.frameWidth}x${fillFrame.frameHeight}@${fillFrame.frameX},${fillFrame.frameY}` : "canvas",
  });
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Reference A PNG 변환 실패")), "image/png");
  });
}

export default function Home() {
  const [toolMode, setToolMode] = useState<ToolMode>("t2i");
  const [category, setCategory] = useState<AssetCategory>("tile");
  const [scaleId, setScaleId] = useState("T32");
  const [familyByCategory, setFamilyByCategory] = useState<Record<AssetCategory, string>>(() => Object.fromEntries(T2I_CATEGORIES.map((item) => [item, FAMILY_CATALOG[item][0].id])) as Record<AssetCategory, string>);
  const [activeGroup, setActiveGroup] = useState(FAMILY_CATALOG.tile[0].group);
  const [direction, setDirection] = useState<Direction>("front");
  const [action, setAction] = useState("walk_empty");
  const [frameIndex, setFrameIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>(INITIAL_SELECTIONS);
  const [lockedFields, setLockedFields] = useState<string[]>(["character.gender"]);
  const [optionSeed, setOptionSeed] = useState(4821);
  const [history, setHistory] = useState<HistoryItem[]>(DEFAULT_HISTORY);
  const [notice, setNotice] = useState("RunPod 연결 상태를 확인 중입니다.");
  const [endpoint, setEndpoint] = useState<EndpointState>({ status: "확인 중" });
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState("/test-inputs/reference-character-front.png");
  const [frontSourceReference, setFrontSourceReference] = useState<DirectionReference>(INITIAL_DIRECTION_REFERENCES.front);
  const [directionReferences, setDirectionReferences] = useState<Record<Direction, DirectionReference>>(INITIAL_DIRECTION_REFERENCES);
  const [directionApprovals, setDirectionApprovals] = useState<Record<Direction, boolean>>({ front: false, back: false, left: false, right: false });
  const [generatedAsset, setGeneratedAsset] = useState<GeneratedAsset | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ status: "idle", bundleId: "", completed: 0, total: 3, current: "" });
  const [batchResults, setBatchResults] = useState<GeneratedAsset[]>([]);
  const [isPostprocessing, setIsPostprocessing] = useState(false);
  const [postprocessManifestUrl, setPostprocessManifestUrl] = useState("");
  const [preparedReferenceA, setPreparedReferenceA] = useState("");
  const [preparedReferenceB, setPreparedReferenceB] = useState("");

  useEffect(() => {
    debugLog("BOOT", { location: window.location.href, devicePixelRatio: window.devicePixelRatio });
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("asset-forge-history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as HistoryItem[];
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHistory(parsed.map((item) => item.detail.includes("PNG 후처리 완료")
          ? { ...item, detail: item.detail.replace("PNG 후처리 완료", "기존 구조 후처리 결과") }
          : item));
      } catch {
        window.localStorage.removeItem("asset-forge-history");
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/runpod/health", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.ok !== true) throw new Error(body.message || `Endpoint 상태 확인 실패 · HTTP ${body.status ?? response.status}`);
        if (active) {
          setEndpoint({ status: "연결됨", model: body.model, latencyMs: body.latencyMs });
          setNotice(`RunPod 연결 완료 · ${body.model}`);
        }
      })
      .catch((error: Error) => {
        if (active) {
          setEndpoint({ status: "오류", message: error.message });
          setNotice(`RunPod 연결 오류 · ${error.message}`);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("asset-forge-history", JSON.stringify(history));
  }, [history]);

  const availableCategories = toolMode === "t2i" ? T2I_CATEGORIES : I2I_CATEGORIES;
  const currentFamilies = FAMILY_CATALOG[category];
  const family = currentFamilies.find((item) => item.id === familyByCategory[category]) ?? currentFamilies[0];
  const catalogGroups = Array.from(new Set(currentFamilies.map((item) => item.group)));
  const visibleFamilies = currentFamilies.filter((item) => item.group === activeGroup);
  const scale = SCALE_PRESETS.find((item) => item.id === scaleId) ?? SCALE_PRESETS[1];
  const targetWidth = family.visualX * scale.pixels;
  const targetHeight = family.visualY * scale.pixels;
  const ratioLabel = `${family.visualX}:${family.visualY}`;
  const actionPreset = ACTIONS.find((item) => item.id === action) ?? ACTIONS[0];
  const framePhases = useMemo(() => makeFramePhases(actionPreset, direction), [actionPreset, direction]);
  const framePhase = framePhases[Math.min(frameIndex, framePhases.length - 1)];
  const directionLayout = DIRECTION_LAYOUTS[direction];
  const activeReference = category === "character"
    ? directionReferences[direction]
    : { file: referenceFile, preview: referencePreview, name: referenceFile?.name ?? "reference-a.png" };
  const hasActiveReference = Boolean(activeReference.preview);
  const topology = selections["tile.topology"];
  const objectState = selections["object.state"];
  const guideSize = guideCanvasSize(family.visualX, family.visualY);

  const frameSize = useMemo(() => {
    const maxWidth = 230;
    const maxHeight = 250;
    const unit = Math.min(maxWidth / family.visualX, maxHeight / family.visualY);
    return { width: family.visualX * unit, height: family.visualY * unit };
  }, [family.visualX, family.visualY]);

  const prompt = useMemo(() => {
    const optionText = OPTION_GROUPS[category].map((group) => selections[`${category}.${group.key}`]).join(", ");
    if (toolMode === "t2i") {
      const frontRule = category === "character" ? ", front view, neutral standing reference" : "";
      return `${CATEGORY_META[category].label} 기준 에셋, ${family.name}, ${optionText}${frontRule}, ${family.profile}`;
    }
    if (category === "character") {
      return `approved ${direction} direction reference, ${direction}, ${actionPreset.id}, preserve identity, ${targetWidth}x${targetHeight}px, occupancy ${directionLayout.occupancy}, feet on crop bottom`;
    }
    if (category === "tile") return `tile variant, ${family.name}, ${topology}, seamless adjacency, ${targetWidth}x${targetHeight}px`;
    return `object variant, ${family.name}, ${objectState}, ${targetWidth}x${targetHeight}px, ${family.profile}, base on crop bottom`;
  }, [actionPreset.id, category, direction, directionLayout.occupancy, family, objectState, selections, targetHeight, targetWidth, toolMode, topology]);

  const generationPrompt = useMemo(() => {
    if (category === "character") {
      return characterActionPrompt(direction, actionPreset, framePhase);
    }
    if (category === "tile") {
      return `Keep image 1 unchanged. Match only the topology from image 2: ${topology}. Put the tile inside the black frame. Keep all four frame lines and every tile pixel inside. Remove the guide marks.`;
    }
    return `Keep image 1 unchanged. Match only the object state from image 2: ${objectState}. Put the object inside the black frame. Keep all four frame lines and every object pixel inside. The base touches the bottom line. Remove the guide marks.`;
  }, [actionPreset, category, direction, framePhase, objectState, topology]);

  useEffect(() => {
    if (toolMode !== "i2i" || !activeReference.preview) return;
    let cancelled = false;
    let referenceAUrl = "";
    let referenceBUrl = "";

    async function prepareReferencePipeline() {
      const referenceBlob = activeReference.file
        ? activeReference.file
        : await fetch(activeReference.preview).then((response) => {
          if (!response.ok) throw new Error(`${activeReference.name} 기준 이미지를 읽을 수 없습니다.`);
          return response.blob();
        });
      const guide = await createLayoutGuide(family.visualX, family.visualY, category, direction, action, frameIndex);
      const normalizedReference = await normalizeReferenceOnWhite(referenceBlob, guide.width, guide.height, category === "character" ? guide.frame : undefined);
      referenceAUrl = URL.createObjectURL(normalizedReference);
      referenceBUrl = URL.createObjectURL(guide.blob);
      if (cancelled) {
        URL.revokeObjectURL(referenceAUrl);
        URL.revokeObjectURL(referenceBUrl);
        return;
      }
      setPreparedReferenceA(referenceAUrl);
      setPreparedReferenceB(referenceBUrl);
      debugLog("REFERENCE_PIPELINE_PREPARED", {
        reference: activeReference.name,
        category,
        direction,
        action,
        frameIndex,
        canvas: `${guide.width}x${guide.height}`,
        frame: `${guide.frame.frameWidth}x${guide.frame.frameHeight}@${guide.frame.frameX},${guide.frame.frameY}`,
      });
    }

    prepareReferencePipeline().catch((error: Error) => {
      debugLog("REFERENCE_PIPELINE_PREPARE_FAILED", { message: error.message });
    });
    return () => {
      cancelled = true;
      if (referenceAUrl) URL.revokeObjectURL(referenceAUrl);
      if (referenceBUrl) URL.revokeObjectURL(referenceBUrl);
    };
  }, [activeReference.file, activeReference.name, activeReference.preview, action, category, direction, family.visualX, family.visualY, frameIndex, toolMode]);

  function changeTool(next: ToolMode) {
    setToolMode(next);
    setGeneratedAsset(null);
    if (next === "i2i" && !I2I_CATEGORIES.includes(category)) changeCategory("character");
    setNotice(next === "t2i" ? "T2I 전체 카탈로그의 기준 에셋 조건을 편집합니다." : "승인된 방향별 기준 이미지로 I2I 변형을 편집합니다.");
  }

  function changeCategory(next: AssetCategory) {
    setCategory(next);
    setGeneratedAsset(null);
    const selected = FAMILY_CATALOG[next].find((item) => item.id === familyByCategory[next]) ?? FAMILY_CATALOG[next][0];
    setActiveGroup(selected.group);
  }

  function selectFamily(next: Family) {
    setFamilyByCategory((current) => ({ ...current, [category]: next.id }));
    setGeneratedAsset(null);
    setNotice(`${CATEGORY_META[category].label} / ${next.name} family를 선택했습니다.`);
  }

  function updateOption(key: string, value: string) {
    setSelections((current) => ({ ...current, [`${category}.${key}`]: value }));
    setGeneratedAsset(null);
  }

  function changeScale(next: string) {
    setScaleId(next);
    setGeneratedAsset(null);
  }

  function changeDirection(next: Direction) {
    debugLog("DIRECTION_SELECTED", { from: direction, to: next });
    setDirection(next);
    setFrameIndex(0);
    setGeneratedAsset(null);
  }

  function changeAction(next: string) {
    debugLog("ACTION_SELECTED", { from: action, to: next });
    setAction(next);
    setFrameIndex(0);
    setGeneratedAsset(null);
  }

  function changeFrame(next: number) {
    debugLog("FRAME_SELECTED", { from: framePhase.id, to: framePhases[next]?.id, index: next });
    setFrameIndex(next);
    setGeneratedAsset(null);
  }

  function randomizeField(definition: OptionDefinition) {
    const key = `${category}.${definition.key}`;
    if (lockedFields.includes(key)) return;
    updateOption(definition.key, pick(definition.values));
    setOptionSeed(Math.floor(Math.random() * 9000) + 1000);
  }

  function randomizeAll() {
    setSelections((current) => {
      const next = { ...current };
      OPTION_GROUPS[category].forEach((definition) => {
        const key = `${category}.${definition.key}`;
        if (!lockedFields.includes(key)) next[key] = pick(definition.values);
      });
      return next;
    });
    setOptionSeed(Math.floor(Math.random() * 9000) + 1000);
    setNotice(`${CATEGORY_META[category].label}의 잠기지 않은 조건을 랜덤 선택했습니다.`);
  }

  function toggleLock(definition: OptionDefinition) {
    const key = `${category}.${definition.key}`;
    setLockedFields((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function saveSnapshot() {
    const detail = toolMode === "t2i" ? `${scaleId} · ${family.profile} · T2I 기준` : category === "character" ? `${scaleId} · ${direction}.ref · ${actionPreset.id}` : `${targetWidth}×${targetHeight} · ${category === "tile" ? topology : objectState}`;
    const item: HistoryItem = { id: `LOCAL-${String(Date.now()).slice(-5)}`, asset: `${category}.${family.id}`, detail, job: "대기", assetState: "후처리", time: "방금" };
    setHistory((current) => [item, ...current].slice(0, 8));
    setNotice("현재 설정을 로컬 히스토리에 저장했습니다.");
  }

  function changeReference(file: File | null) {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    if (category === "character") {
      const previous = frontSourceReference.preview;
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      const source = { file, preview, name: file.name, stage: "source" as const };
      setFrontSourceReference(source);
      setDirectionReferences({
        front: source,
        back: { file: null, preview: "", name: "back.ref 미등록", stage: "generated" },
        left: { file: null, preview: "", name: "left.ref 미등록", stage: "generated" },
        right: { file: null, preview: "", name: "right.ref 미등록", stage: "generated" },
      });
      setDirectionApprovals({ front: false, back: false, left: false, right: false });
      setBatchProgress({ status: "idle", bundleId: "", completed: 0, total: 3, current: "" });
      setBatchResults([]);
      setPostprocessManifestUrl("");
      setDirection("front");
      debugLog("FRONT_SOURCE_REGISTERED", { name: file.name, bytes: file.size, type: file.type });
    } else {
      if (referencePreview.startsWith("blob:")) URL.revokeObjectURL(referencePreview);
      setReferenceFile(file);
      setReferencePreview(preview);
      debugLog("REFERENCE_REGISTERED", { category, name: file.name, bytes: file.size, type: file.type });
    }
    setGeneratedAsset(null);
    setNotice(`Reference A 교체 · ${category === "character" ? "정면 생성 입력 · " : ""}${file.name}`);
  }

  async function referenceToBlob(reference: DirectionReference) {
    if (reference.file) return reference.file;
    const response = await fetch(reference.preview);
    if (!response.ok) throw new Error(`${reference.name} 기준 이미지를 읽을 수 없습니다.`);
    return response.blob();
  }

  async function requestCharacterAsset({
    reference,
    targetDirection,
    targetAction,
    targetFrameIndex,
    seed,
    bundleId,
    directionReference = false,
    mirrorRight = false,
  }: {
    reference: DirectionReference;
    targetDirection: Direction;
    targetAction: string;
    targetFrameIndex: number;
    seed: number;
    bundleId?: string;
    directionReference?: boolean;
    mirrorRight?: boolean;
  }) {
    const targetActionPreset = ACTIONS.find((item) => item.id === targetAction) ?? ACTIONS[0];
    const phases = makeFramePhases(targetActionPreset, targetDirection);
    const targetFrame = directionReference
      ? { id: `Idle_${DIRECTION_EXPORT_NAMES[targetDirection]}_01`, label: "기본 대기", prompt: "idle" }
      : phases[Math.min(targetFrameIndex, phases.length - 1)];
    const referenceBlob = await referenceToBlob(reference);
    const guide = await createLayoutGuide(family.visualX, family.visualY, "character", targetDirection, directionReference ? "idle" : targetAction, targetFrameIndex);
    const normalizedReference = await normalizeReferenceOnWhite(referenceBlob, guide.width, guide.height, guide.frame);
    const requestPrompt = directionReference ? directionReferencePrompt(targetDirection) : characterActionPrompt(targetDirection, targetActionPreset, targetFrame);
    const form = new FormData();
    form.append("image", normalizedReference, reference.name);
    form.append("image", guide.blob, `reference-b-character-${targetDirection}-${targetFrame.id}.png`);
    form.set("prompt", requestPrompt);
    const directionNegative = targetDirection === "back"
      ? ", visible face, visible eyes"
      : targetDirection === "left" || targetDirection === "right"
        ? ", front view, three-quarter view, two visible eyes"
        : "";
    form.set("negativePrompt", `different character, redesign, extra limbs, drawn frame, border lines, guide marks, outside frame, floating feet, shadow, ground, text, scenery${directionNegative}`);
    form.set("size", `${guide.width}x${guide.height}`);
    form.set("seed", String(seed));
    form.set("numInferenceSteps", "40");
    form.set("trueCfgScale", "4");
    form.set("guidanceScale", "1");
    form.set("frameX", String(guide.frame.frameX));
    form.set("frameY", String(guide.frame.frameY));
    form.set("frameWidth", String(guide.frame.frameWidth));
    form.set("frameHeight", String(guide.frame.frameHeight));
    form.set("baselineY", String(guide.frame.baselineY));
    form.set("strokeWidth", String(guide.frame.strokeWidth));
    form.set("category", "character");
    form.set("direction", targetDirection);
    form.set("action", directionReference ? "direction_reference" : targetAction);
    form.set("frameId", targetFrame.id);
    form.set("frameIndex", String(targetFrameIndex));
    if (bundleId) {
      form.set("assetBundle", bundleId);
      form.set("assetName", targetFrame.id);
    }
    if (mirrorRight && targetDirection === "left") {
      form.set("mirrorDirection", "right");
      form.set("mirrorAssetName", targetFrame.id.replace("_Left_", "_Right_"));
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      debugLog("BATCH_REQUEST_SEND", { bundleId, direction: targetDirection, action: targetAction, frameId: targetFrame.id, prompt: requestPrompt, seed, attempt });
      try {
        const response = await fetch("/api/runpod/edit", { method: "POST", body: form });
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        if (!response.ok) throw new Error(`${body.error || "생성 실패"}${body.requestId ? ` · request ${body.requestId}` : ""}`);
        const result = body as GeneratedAsset;
        debugLog("BATCH_REQUEST_COMPLETE", { bundleId, generationId: result.generationId, direction: targetDirection, frameId: targetFrame.id, imageUrl: result.imageUrl, attempt });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("생성 실패");
        debugLog("BATCH_REQUEST_RETRY", { bundleId, direction: targetDirection, frameId: targetFrame.id, attempt, message: lastError.message });
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, attempt * 1_500));
      }
    }
    throw lastError ?? new Error("생성 실패");
  }

  async function loadStoredCharacterAsset(bundleId: string, targetDirection: Direction, frameId: string) {
    const bundleImageUrl = `/generated/bundles/${bundleId}/${targetDirection}/${frameId}.png`;
    const bundleMetadataUrl = `/generated/bundles/${bundleId}/${targetDirection}/${frameId}.json`;
    let metadataUrl = bundleMetadataUrl;
    let response = await fetch(metadataUrl, { cache: "no-store" });
    if (!response.ok) {
      metadataUrl = `/assets/generated/${bundleId}/${targetDirection}/${frameId}.json`;
      response = await fetch(metadataUrl, { cache: "no-store" });
    }
    if (!response.ok) return null;
    const metadata = await response.json() as {
      generationId?: string;
      sourceGenerationId?: string;
      requestId?: string;
      model?: string;
      selection?: GeneratedAsset["selection"];
      layout?: GeneratedAsset["layout"];
      settings?: { seed?: number };
      output?: { bytes?: number; size?: string };
    };
    if (!metadata.generationId || !metadata.selection) return null;
    const isRawBundle = metadataUrl === bundleMetadataUrl;
    const rawImageUrl = isRawBundle
      ? bundleImageUrl
      : metadata.generationId.endsWith("-mirror") && metadata.sourceGenerationId
        ? `/generated/runpod/${metadata.sourceGenerationId}-mirror.png`
        : `/generated/runpod/${metadata.generationId}.png`;
    return {
      generationId: metadata.generationId,
      requestId: metadata.requestId ?? metadata.generationId,
      model: metadata.model ?? endpoint.model ?? "stored-asset",
      imageUrl: rawImageUrl,
      metadataUrl,
      bundleImageUrl: isRawBundle ? bundleImageUrl : null,
      bundleMetadataUrl: isRawBundle ? bundleMetadataUrl : null,
      elapsedMs: 0,
      outputBytes: metadata.output?.bytes ?? 0,
      size: isRawBundle ? metadata.output?.size ?? `${guideSize.width}x${guideSize.height}` : `${guideSize.width}x${guideSize.height}`,
      seed: metadata.settings?.seed ?? optionSeed,
      layout: metadata.layout,
      selection: metadata.selection,
    } satisfies GeneratedAsset;
  }

  function batchHistoryItem(result: GeneratedAsset): HistoryItem {
    return {
      id: result.generationId,
      asset: `${result.selection?.direction}.${result.selection?.frameId}`,
      detail: `I2I 원본 생성 · seed ${result.seed}`,
      job: "완료",
      assetState: "기준 선택",
      time: "방금",
    };
  }

  function mirroredRightResult(result: GeneratedAsset): GeneratedAsset {
    if (!result.mirroredImageUrl || !result.mirroredBundleImageUrl) throw new Error("우측 반전 원본 응답이 없습니다.");
    return {
      ...result,
      generationId: `${result.generationId}-mirror`,
      imageUrl: result.mirroredImageUrl,
      bundleImageUrl: result.mirroredBundleImageUrl,
      bundleMetadataUrl: result.mirroredBundleMetadataUrl,
      selection: result.selection ? { ...result.selection, direction: "right", frameId: result.selection.frameId.replace("_Left_", "_Right_") } : result.selection,
    };
  }

  async function loadLatestDirectionReferences() {
    if (isGenerating) return;
    setNotice("최근 생성한 방향 기준을 불러오는 중입니다.");
    try {
      const response = await fetch("/api/assets/manifest");
      const body = await response.json() as { error?: string; bundleId?: string; references?: Partial<Record<Direction, string>> };
      if (!response.ok || !body.bundleId || !body.references?.front || !body.references.back || !body.references.left || !body.references.right) {
        throw new Error(body.error || "완전한 방향 기준 묶음이 없습니다.");
      }
      setDirectionReferences({
        front: { file: null, preview: body.references.front, name: `${body.bundleId}.front.ref`, stage: "generated" },
        back: { file: null, preview: body.references!.back!, name: `${body.bundleId}.back.ref`, stage: "generated" },
        left: { file: null, preview: body.references!.left!, name: `${body.bundleId}.left.ref`, stage: "generated" },
        right: { file: null, preview: body.references!.right!, name: `${body.bundleId}.right.ref`, stage: "generated" },
      });
      setFrontSourceReference({ file: null, preview: body.references.front, name: `${body.bundleId}.front.source`, stage: "source" });
      setDirectionApprovals({ front: false, back: false, left: false, right: false });
      setBatchProgress({ status: "review", bundleId: body.bundleId, completed: 3, total: 3, current: "불러온 4방향 기준 검수·승인 필요" });
      setDirection("front");
      setNotice(`${body.bundleId} 방향 기준을 불러왔습니다. 검수 후 승인하세요.`);
      debugLog("DIRECTION_BUNDLE_LOADED", { bundleId: body.bundleId, references: body.references });
    } catch (error) {
      const message = error instanceof Error ? error.message : "방향 기준 불러오기 실패";
      setNotice(message);
      debugLog("DIRECTION_BUNDLE_LOAD_FAILED", { message });
    }
  }

  async function generateDirectionReferences() {
    if (isGenerating || endpoint.status !== "연결됨") return;
    const frontReference = frontSourceReference;
    if (!frontReference.preview) {
      setNotice("정면 승인 기준 이미지가 필요합니다.");
      return;
    }

    const bundleId = `character-farmer-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    const total = 3;
    const results: GeneratedAsset[] = [];
    let completed = 0;
    setIsGenerating(true);
    setBatchResults([]);
    setBatchProgress({ status: "direction", bundleId, completed, total, current: "정면 방향 기준" });
    setDirectionApprovals({ front: false, back: false, left: false, right: false });
    setNotice(`방향 기준 생성 시작 · ${bundleId}`);

    try {
      for (const target of DIRECTIONS.filter((item) => item.id === "front" || item.id === "back" || item.id === "left")) {
        setDirection(target.id);
        setAction("walk_empty");
        setFrameIndex(0);
        const current = `${target.label} 기본 대기 이미지`;
        setBatchProgress({ status: "direction", bundleId, completed, total, current });
        setNotice(`${completed + 1}/${total} · 정면 기준으로 ${current} 생성 중`);
        const result = await requestCharacterAsset({
          reference: frontReference,
          targetDirection: target.id,
          targetAction: "walk_empty",
          targetFrameIndex: 0,
          seed: optionSeed,
          bundleId,
          directionReference: true,
          mirrorRight: target.id === "left",
        });
        const generatedReference: DirectionReference = { file: null, preview: result.imageUrl, name: `${target.id}.ref.${result.generationId}.png`, stage: "generated" };
        setDirectionReferences((currentReferences) => ({ ...currentReferences, [target.id]: generatedReference }));
        results.push(result);
        completed += 1;
        setGeneratedAsset(result);
        setBatchResults([...results]);
        setHistory((currentHistory) => [batchHistoryItem(result), ...currentHistory].slice(0, 8));
        if (target.id === "left") {
          const mirrored = mirroredRightResult(result);
          const mirroredReference: DirectionReference = { file: null, preview: mirrored.imageUrl, name: `right.ref.${mirrored.generationId}.png`, stage: "generated" };
          setDirectionReferences((currentReferences) => ({ ...currentReferences, right: mirroredReference }));
          results.push(mirrored);
          setBatchResults([...results]);
          setHistory((currentHistory) => [batchHistoryItem(mirrored), ...currentHistory].slice(0, 8));
        }
      }
      setBatchProgress({ status: "review", bundleId, completed, total, current: "방향 기준 검수·승인 필요" });
      setNotice("정면·후면·좌측 기준 생성과 우측 원본 반전 완료 · 4방향 모두 사각형 점유와 접지선을 확인하고 승인하세요.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "방향 기준 생성 실패";
      setBatchProgress({ status: "failed", bundleId, completed, total, current: message });
      setNotice(`${completed}/${total}에서 중단 · ${message}`);
      debugLog("BATCH_FAILED", { bundleId, completed, message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function regenerateDirectionReference(targetDirection: Direction) {
    if (isGenerating || endpoint.status !== "연결됨") return;
    const sourceDirection: Direction = targetDirection === "right" ? "left" : targetDirection;
    const frontReference = frontSourceReference;
    const bundleId = batchProgress.bundleId || `character-farmer-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    setIsGenerating(true);
    setDirection(sourceDirection);
    setDirectionApprovals((current) => sourceDirection === "left" ? { ...current, left: false, right: false } : { ...current, [sourceDirection]: false });
    setBatchProgress({ status: "direction", bundleId, completed: 0, total: 1, current: `${sourceDirection} 기준 다시 생성` });
    setNotice(`${sourceDirection} 기준을 다시 생성 중입니다.${sourceDirection === "left" ? " 우측은 자동 반전합니다." : ""}`);
    try {
      const result = await requestCharacterAsset({ reference: frontReference, targetDirection: sourceDirection, targetAction: "walk_empty", targetFrameIndex: 0, seed: optionSeed, bundleId, directionReference: true, mirrorRight: sourceDirection === "left" });
      const generatedReference: DirectionReference = { file: null, preview: result.imageUrl, name: `${sourceDirection}.ref.${result.generationId}.png`, stage: "generated" };
      setDirectionReferences((current) => ({ ...current, [sourceDirection]: generatedReference }));
      const replacements = [result];
      if (sourceDirection === "left") {
        const mirrored = mirroredRightResult(result);
        replacements.push(mirrored);
        setDirectionReferences((current) => ({ ...current, left: generatedReference, right: { file: null, preview: mirrored.imageUrl, name: `right.ref.${mirrored.generationId}.png`, stage: "generated" } }));
      }
      setBatchResults((current) => [...current.filter((item) => !(item.selection?.action === "direction_reference" && replacements.some((replacement) => replacement.selection?.direction === item.selection?.direction))), ...replacements]);
      setGeneratedAsset(result);
      setHistory((current) => [...replacements.map(batchHistoryItem), ...current].slice(0, 8));
      setBatchProgress({ status: "review", bundleId, completed: 1, total: 1, current: `${sourceDirection} 기준 검수 필요` });
      setNotice(`${sourceDirection} 기준 재생성 완료${sourceDirection === "left" ? " · 우측 반전 완료" : ""} · 방향과 접지선을 확인하세요.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "방향 기준 재생성 실패";
      setBatchProgress({ status: "failed", bundleId, completed: 0, total: 1, current: message });
      setNotice(`재생성 실패 · ${message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function generateAllCharacterActions() {
    if (isGenerating || endpoint.status !== "연결됨") return;
    if (DIRECTIONS.some((item) => !directionReferences[item.id].preview || !directionApprovals[item.id])) {
      setNotice("4방향 기준 이미지를 모두 검수·승인해야 동작 생성을 시작할 수 있습니다.");
      return;
    }
    const bundleId = batchProgress.bundleId || `character-farmer-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    const runpodDirections = DIRECTIONS.filter((item) => item.id !== "right");
    const total = runpodDirections.length * ACTIONS.reduce((sum, item) => sum + item.frames, 0);
    const results = batchResults.filter((item) => item.selection?.action === "direction_reference");
    let completed = 0;
    setIsGenerating(true);
    setBatchResults([...results]);
    setBatchProgress({ status: "actions", bundleId, completed, total, current: "Walk_Down_01" });
    setNotice(`승인된 방향 기준으로 동작 68프레임 생성 시작 · ${bundleId}`);
    try {
      for (const target of runpodDirections) {
        const reference = directionReferences[target.id];
        for (const targetAction of ACTIONS) {
          for (let targetFrameIndex = 0; targetFrameIndex < targetAction.frames; targetFrameIndex += 1) {
            const targetFrame = makeFramePhases(targetAction, target.id)[targetFrameIndex];
            setDirection(target.id);
            setAction(targetAction.id);
            setFrameIndex(targetFrameIndex);
            setBatchProgress({ status: "actions", bundleId, completed, total, current: targetFrame.id });
            setNotice(`${completed + 1}/${total} · ${targetFrame.id} 생성 중`);
            const existingResult = await loadStoredCharacterAsset(bundleId, target.id, targetFrame.id);
            const mirroredFrameId = targetFrame.id.replace("_Left_", "_Right_");
            const existingMirror = target.id === "left" ? await loadStoredCharacterAsset(bundleId, "right", mirroredFrameId) : null;
            if (existingResult && (target.id !== "left" || existingMirror)) {
              results.push(existingResult);
              if (existingMirror) results.push(existingMirror);
              completed += 1;
              setGeneratedAsset(existingResult);
              setBatchResults([...results]);
              setBatchProgress({ status: "actions", bundleId, completed, total, current: `${targetFrame.id} · 기존 PNG 사용` });
              debugLog("BATCH_ASSET_REUSED", { bundleId, direction: target.id, frameId: targetFrame.id, completed, total });
              continue;
            }
            const result = await requestCharacterAsset({ reference, targetDirection: target.id, targetAction: targetAction.id, targetFrameIndex, seed: optionSeed, bundleId, mirrorRight: target.id === "left" });
            results.push(result);
            if (target.id === "left") results.push(mirroredRightResult(result));
            completed += 1;
            setGeneratedAsset(result);
            setBatchResults([...results]);
            setHistory((currentHistory) => [batchHistoryItem(result), ...currentHistory].slice(0, 8));
          }
        }
      }

      const manifest = {
        schemaVersion: 1,
        bundleId,
        createdAt: new Date().toISOString(),
        type: "character-i2i-raw-set",
        status: "generation-complete",
        expectedAssets: 68,
        sourceReference: directionReferences.front.name,
        model: endpoint.model,
        canvas: `${guideSize.width}x${guideSize.height}`,
        directions: Object.fromEntries(DIRECTIONS.map((item) => [item.id, DIRECTION_EXPORT_NAMES[item.id]])),
        actions: ACTIONS.map((item) => ({ id: item.id, frames: item.frames })),
        assets: results.filter((result) => result.selection?.action !== "direction_reference").map((result) => ({ generationId: result.generationId, direction: result.selection?.direction, action: result.selection?.action, frameId: result.selection?.frameId, seed: result.seed, rawUrl: result.bundleImageUrl ?? result.imageUrl, metadataUrl: result.bundleMetadataUrl ?? result.metadataUrl, size: result.size })),
      };
      const manifestResponse = await fetch("/api/assets/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bundleId, manifest }) });
      const manifestBody = await manifestResponse.json();
      if (!manifestResponse.ok) throw new Error(manifestBody.error || "manifest 저장 실패");
      setBatchProgress({ status: "complete", bundleId, completed, total, current: "완료", manifestUrl: manifestBody.manifestUrl });
      setPostprocessManifestUrl("");
      setNotice(`I2I 원본 68프레임 생성 완료 · 검수 후 후처리 시작 버튼을 누르세요. · ${manifestBody.manifestUrl}`);
      debugLog("BATCH_COMPLETE", { bundleId, completed, manifestUrl: manifestBody.manifestUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "동작 생성 실패";
      setBatchProgress({ status: "failed", bundleId, completed, total, current: message });
      setNotice(`${completed}/${total}에서 중단 · ${message}`);
      debugLog("BATCH_FAILED", { bundleId, completed, message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function postprocessCompletedBatch() {
    if (batchProgress.status !== "complete" || !batchProgress.bundleId || isPostprocessing) return;
    setIsPostprocessing(true);
    setPostprocessManifestUrl("");
    setNotice("완료된 68개 원본의 crop·Unity 리사이즈를 시작합니다.");
    try {
      const response = await fetch("/api/assets/postprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundleId: batchProgress.bundleId, targetWidth, targetHeight }),
      });
      const body = await response.json() as { error?: string; processed?: number; manifestUrl?: string };
      if (!response.ok || !body.manifestUrl) throw new Error(body.error || "후처리 실패");
      setPostprocessManifestUrl(body.manifestUrl);
      setNotice(`${body.processed ?? 0}개 프레임 후처리 완료 · ${body.manifestUrl}`);
      debugLog("POSTPROCESS_COMPLETE", { bundleId: batchProgress.bundleId, processed: body.processed, manifestUrl: body.manifestUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "후처리 실패";
      setNotice(`후처리 실패 · ${message}`);
      debugLog("POSTPROCESS_FAILED", { bundleId: batchProgress.bundleId, message });
    } finally {
      setIsPostprocessing(false);
    }
  }

  async function runImageEdit() {
    if (toolMode !== "i2i" || isGenerating) return;
    if (!hasActiveReference) {
      const message = `${direction}.ref 승인 기준을 먼저 등록해야 합니다.`;
      debugLog("REQUEST_BLOCKED", { direction, action, reason: "missing-direction-reference" });
      setNotice(message);
      return;
    }
    setIsGenerating(true);
    setGeneratedAsset(null);
    setNotice("Reference A/B를 PNG로 조립해 RunPod 생성 요청을 보내는 중입니다.");
    debugLog("REQUEST_PREPARE", { category, direction, action, frameId: framePhase.id, seed: optionSeed });

    try {
      const referenceBlob: Blob = activeReference.file
        ? activeReference.file
        : await fetch(activeReference.preview).then((response) => {
            if (!response.ok) throw new Error("기본 Reference A를 읽을 수 없습니다.");
            return response.blob();
          });
      const guide = await createLayoutGuide(family.visualX, family.visualY, category, direction, action, frameIndex);
      const normalizedReference = await normalizeReferenceOnWhite(referenceBlob, guide.width, guide.height, category === "character" ? guide.frame : undefined);
      const form = new FormData();
      form.append("image", normalizedReference, activeReference.name);
      form.append("image", guide.blob, `reference-b-${category}-${direction}-${action}-${framePhase.id}.png`);
      form.set("prompt", generationPrompt);
      form.set("negativePrompt", "different character, redesign, extra limbs, missing border, outside frame, floating feet, text, scenery");
      form.set("size", `${guide.width}x${guide.height}`);
      form.set("seed", String(optionSeed));
      form.set("numInferenceSteps", "40");
      form.set("trueCfgScale", "4");
      form.set("guidanceScale", "1");
      form.set("frameX", String(guide.frame.frameX));
      form.set("frameY", String(guide.frame.frameY));
      form.set("frameWidth", String(guide.frame.frameWidth));
      form.set("frameHeight", String(guide.frame.frameHeight));
      form.set("baselineY", String(guide.frame.baselineY));
      form.set("strokeWidth", String(guide.frame.strokeWidth));
      form.set("category", category);
      form.set("direction", direction);
      form.set("action", action);
      form.set("frameId", framePhase.id);
      form.set("frameIndex", String(frameIndex));

      debugLog("REQUEST_SEND", {
        referenceA: `${guide.width}x${guide.height}`,
        referenceB: `${guide.width}x${guide.height}`,
        frameId: framePhase.id,
        prompt: generationPrompt,
      });

      const response = await fetch("/api/runpod/edit", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(`${body.error || "생성 실패"}${body.requestId ? ` · request ${body.requestId}` : ""}`);

      const result = body as GeneratedAsset;
      debugLog("REQUEST_COMPLETE", {
        generationId: result.generationId,
        requestId: result.requestId,
        output: result.size,
        references: result.referenceImages?.map((image) => image.size ?? "unknown"),
        selection: result.selection,
      });
      setGeneratedAsset(result);
      const completedItem: HistoryItem = {
        id: result.generationId,
        asset: `${category}.${family.id}`,
        detail: `${scaleId} · ${framePhase.id} · seed ${result.seed}`,
        job: "완료",
        assetState: "후처리",
        time: "방금",
      };
      setHistory((current) => [completedItem, ...current].slice(0, 8));
      setNotice(`생성 완료 · ${result.size} · ${(result.elapsedMs / 1000).toFixed(1)}초 · ${result.requestId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 생성 오류";
      debugLog("REQUEST_FAILED", { message, direction, action, frameId: framePhase.id });
      setNotice(`생성 실패 · ${message}`);
      const failedItem: HistoryItem = {
        id: `FAILED-${String(Date.now()).slice(-6)}`,
        asset: `${category}.${family.id}`,
        detail: `${framePhase.id} · ${message}`,
        job: "실패",
        assetState: "반려",
        time: "방금",
      };
      setHistory((current) => [failedItem, ...current].slice(0, 8));
    } finally {
      setIsGenerating(false);
    }
  }

  const guideContent = category === "character" ? <PoseGuide action={action} direction={direction} frameIndex={frameIndex} /> : category === "tile" ? <TileGuide topology={topology} /> : <ObjectSchematic family={family} />;
  const sentReferenceA = generatedAsset?.referenceImages?.[0]?.url ?? preparedReferenceA ?? activeReference.preview;
  const sentReferenceB = generatedAsset?.referenceImages?.[1]?.url ?? preparedReferenceB;
  const allDirectionReferencesApproved = DIRECTIONS.every((item) => Boolean(directionReferences[item.id].preview) && directionApprovals[item.id]);
  const pipelineDirection = generatedAsset?.selection?.direction ?? direction;
  const pipelineFrameId = generatedAsset?.selection?.frameId ?? framePhase.id;
  const pipelineCanvas = generatedAsset?.size ?? `${guideSize.width}x${guideSize.height}`;
  const pipelineAspect = `${guideSize.width} / ${guideSize.height}`;
  const pipelineFrameGeometry = guideFrameGeometry(family.visualX, family.visualY);
  const pipelineFrameStyle = {
    left: `${(pipelineFrameGeometry.frame.frameX / pipelineFrameGeometry.width) * 100}%`,
    top: `${(pipelineFrameGeometry.frame.frameY / pipelineFrameGeometry.height) * 100}%`,
    width: `${(pipelineFrameGeometry.frame.frameWidth / pipelineFrameGeometry.width) * 100}%`,
    height: `${(pipelineFrameGeometry.frame.frameHeight / pipelineFrameGeometry.height) * 100}%`,
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block"><div className="brand-mark">AF</div><div><p className="eyebrow">2D ASSET WORKBENCH</p><h1>Asset Forge</h1></div></div>
        <div className="project-summary"><span className="project-name">farm-rpg / catalog-layout-debug</span><span className={`endpoint-state endpoint-${endpoint.status}`}><i /> RUNPOD {endpoint.status}{endpoint.latencyMs ? ` · ${endpoint.latencyMs}ms` : ""}</span></div>
        <button type="button" className="save-button" onClick={saveSnapshot} data-testid="save-history">현재 설정 저장</button>
      </header>

      <nav className="workflow-rail" aria-label="에셋 생성 도구">
        <button type="button" className={toolMode === "t2i" ? "workflow-step is-active" : "workflow-step"} onClick={() => changeTool("t2i")} data-testid="tool-t2i"><span>01</span><strong>기준 에셋 생성</strong><small>T2I · 전체 카탈로그 8분류</small></button>
        <i aria-hidden="true">→</i>
        <button type="button" className={toolMode === "i2i" ? "workflow-step is-active" : "workflow-step"} onClick={() => changeTool("i2i")} data-testid="tool-i2i"><span>02</span><strong>방향 · 상태 · 동작 변형</strong><small>I2I · 방향별 승인 기준 사용</small></button>
      </nav>

      <div className="workspace">
        <aside className="sidebar panel">
          <div className="panel-title-row"><div><span className="section-number">01</span><h2>{toolMode === "t2i" ? "전체 에셋 카탈로그" : "변형 기준 입력"}</h2></div>{toolMode === "t2i" && <button type="button" className="random-all" onClick={randomizeAll} data-testid="random-all">유형 랜덤</button>}</div>

          <section className="category-section">
            <div className="option-heading"><span>에셋 대분류</span><span className="field-note">{availableCategories.length} TYPES</span></div>
            <div className="category-grid">
              {availableCategories.map((item) => <button key={item} type="button" className={category === item ? "category-button is-active" : "category-button"} onClick={() => changeCategory(item)} data-testid={`category-${item}`}><span>{CATEGORY_META[item].short}</span>{CATEGORY_META[item].label}</button>)}
            </div>
            <p className="category-description">{CATEGORY_META[category].description}</p>
          </section>

          <section className="option-group scale-options">
            <div className="option-heading"><span>Unity 기준 해상도</span><span className="field-note">1 CELL = 1 UNIT</span></div>
            <div className="scale-grid">{SCALE_PRESETS.map((item) => <button key={item.id} type="button" role="checkbox" aria-checked={scaleId === item.id} className={scaleId === item.id ? "scale-card is-checked" : "scale-card"} onClick={() => changeScale(item.id)} data-testid={`scale-${item.id}`}><span className="check-box">{scaleId === item.id ? "✓" : ""}</span><strong>{item.id}</strong><small>{item.pixels}px · {item.description}</small></button>)}</div>
          </section>

          {toolMode === "i2i" && (
            <section className="reference-input" data-testid="reference-input">
              <div className={(category === "character" ? frontSourceReference.preview : activeReference.preview) ? "reference-input-thumb actual-reference" : "reference-input-thumb reference-missing"}>{(category === "character" ? frontSourceReference.preview : activeReference.preview) ? <img src={category === "character" ? frontSourceReference.preview : activeReference.preview} alt={category === "character" ? "정면 방향 생성 입력 이미지" : "Reference A 승인 기준 이미지"} /> : <PoseGuide action="idle" direction={direction} compact />}</div>
              <div><span className={(category === "character" ? frontSourceReference.preview : activeReference.preview) ? "approved-badge" : "approved-badge is-missing"}>REFERENCE A</span><strong>{category === "character" ? frontSourceReference.name : activeReference.name}</strong><small>{category === "character" ? `정면 방향 생성 입력 · ${frontSourceReference.preview ? "등록됨" : "등록 필요"}` : `${family.name} · 승인 기준`}</small></div>
              <label className="reference-upload">교체<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => changeReference(event.target.files?.[0] ?? null)} /></label>
            </section>
          )}

          <section className="catalog-picker">
            <div className="option-heading"><span>Family 목록</span><span className="field-note">{currentFamilies.length} FAMILIES</span></div>
            <div className="group-tabs">{catalogGroups.map((group) => <button key={group} type="button" className={activeGroup === group ? "is-active" : ""} onClick={() => setActiveGroup(group)}>{group}</button>)}</div>
            <div className="family-list" data-testid="family-list">
              {visibleFamilies.map((item) => <button key={item.id} type="button" role="checkbox" aria-checked={family.id === item.id} className={family.id === item.id ? "family-option is-checked" : "family-option"} onClick={() => selectFamily(item)} data-testid={`family-${item.id}`}><span className="check-box">{family.id === item.id ? "✓" : ""}</span><span><strong>{item.name}</strong><small>{item.profile}</small></span><em>{item.visualX}T×{item.visualY}T</em></button>)}
            </div>
          </section>

          {(toolMode === "t2i" || category !== "character") && <div className="dynamic-options">{OPTION_GROUPS[category].map((definition) => {
            const key = `${category}.${definition.key}`;
            return <OptionGroup key={key} category={category} definition={definition} selected={selections[key]} locked={lockedFields.includes(key)} onSelect={(value) => updateOption(definition.key, value)} onRandom={() => randomizeField(definition)} onLock={() => toggleLock(definition)} />;
          })}</div>}
        </aside>

        <section className="stage panel">
          <div className="panel-title-row stage-heading"><div><span className="section-number">02</span><h2>{toolMode === "t2i" ? "기준 이미지 후보" : "I2I 레이아웃 디버거"}</h2></div><div className="live-indicator"><i /> LIVE PREVIEW</div></div>

          {toolMode === "t2i" ? (
            <div className="t2i-candidate-stage" data-testid="t2i-candidates">
              <div className="coverage-strip">{T2I_CATEGORIES.map((item) => <span key={item} className={category === item ? "is-current" : ""}><b>{CATEGORY_META[item].short}</b>{FAMILY_CATALOG[item].length}</span>)}</div>
              <div className="candidate-stage-heading"><div><span className="field-note">{CATEGORY_META[category].label.toUpperCase()} REFERENCE CANDIDATES</span><h3>{family.name} 기준 후보</h3><p>1번 도구는 레이아웃 이미지 없이 선택 조건과 프롬프트로 기준 이미지만 생성합니다. 승인 결과가 2번 도구의 기준 입력이 됩니다.</p></div><div className="candidate-spec"><small>OUTPUT</small><strong>{targetWidth} × {targetHeight}px</strong><span>{family.profile}</span></div></div>
              <div className="selected-option-summary">{OPTION_GROUPS[category].map((definition) => <span key={definition.key}><small>{definition.title}</small>{selections[`${category}.${definition.key}`]}</span>)}</div>
              <div className="candidate-grid">{["A", "B", "C", "D"].map((item) => <article key={item}><div className="candidate-placeholder"><span>{item}</span><small>T2I MODEL REQUIRED</small></div><strong>후보 {item}</strong><small>현재 Endpoint는 Image Edit 전용</small></article>)}</div>
              <div className="candidate-note"><i />T2I에는 검은 레이아웃 가이드를 넣지 않습니다. 캐릭터는 정면 중립 기준을 먼저 승인합니다.</div>
            </div>
          ) : (
            <>
              <div className="asset-meta-strip"><span><small>PROFILE</small>{family.profile}</span><span><small>MODEL CANVAS</small>{guideSize.width} × {guideSize.height}px</span><span><small>FRAME RATIO</small>{ratioLabel}</span><span><small>INPUT</small>A + B</span><span><small>SAVE</small>RAW PNG</span></div>
              <div className="guide-workspace">
                <div className="guide-rulers"><span>WHITE CANVAS / SAFE AREA</span><span>BLACK CROP OUTLINE / {ratioLabel}</span></div>
                <div className="guide-canvas" data-testid="guide-canvas" data-content-policy="contained"><div className="grid-overlay" /><div className="layout-frame" style={{ width: frameSize.width, height: frameSize.height }} data-testid="layout-frame" data-ratio={ratioLabel} data-output={`${targetWidth}x${targetHeight}`} data-crop="outline-bounds" data-ground-edge={category === "tile" ? "adjacency" : "bottom"}>{guideContent}</div></div>
                <div className="canvas-ground-note"><i aria-hidden="true" />{category === "tile" ? "검은 윤곽 = seamless adjacency 경계 · 모든 타일 픽셀은 안쪽 유지" : "검은 윤곽 아랫변 = 접지선 · 모든 포즈·장비·오브젝트 픽셀은 안쪽 유지"}</div>
                {category === "character" && <div className="direction-layout-note" data-testid="direction-layout-note"><strong>{DIRECTIONS.find((item) => item.id === direction)?.label} 레이아웃</strong><span>크롭 rect {ratioLabel} 고정</span><span>4방향 공통 높이 {directionLayout.height} · 위·아래 변 접촉</span><span>점유폭 {directionLayout.occupancy}</span><span>좌우 안전 여백 {directionLayout.safeMargin}</span><p>{directionLayout.note}</p></div>}
                <div className="postprocess-flow"><span><small>01 REFERENCE A</small>공통 사각형에 맞춘 기준 이미지</span><i>+</i><span><small>02 REFERENCE B</small>{category === "character" ? `${direction} 방향·포즈 가이드` : category === "tile" ? `${topology} 가이드` : `${family.name} 상태 가이드`}</span><i>→</i><span><small>03 I2I RAW</small>{guideSize.width} × {guideSize.height}px 원본 저장</span></div>

                {category === "character" && <section className="frame-phase-strip" data-testid="frame-phase-strip"><div className="option-heading"><span>생성 프레임</span><span className="field-note">{framePhase.id}</span></div><div>{framePhases.map((phase, index) => <button key={phase.id} type="button" role="checkbox" aria-checked={frameIndex === index} className={frameIndex === index ? "frame-phase is-checked" : "frame-phase"} onClick={() => changeFrame(index)} disabled={isGenerating} data-testid={`frame-${index + 1}`}><PoseGuide action={action} direction={direction} frameIndex={index} compact /><span><strong>{phase.id}</strong><small>{phase.label}</small></span></button>)}</div></section>}

                <section className="generation-layout" data-testid="generation-layout">
                  <div className="generation-layout-heading"><div><span className="field-note">REFERENCE PIPELINE</span><strong>{category === "character" ? "같은 방향 기준 A + 방향·동작 가이드 B" : category === "tile" ? "승인 타일 A + topology 가이드 B" : "승인 오브젝트 A + 상태·규격 가이드 B"}</strong></div><small>{category === "character" ? `${pipelineDirection} · ${pipelineFrameId}` : category === "tile" ? topology : objectState}</small></div>
                  <div className="reference-equation">
                    <article data-testid="reference-a"><span className="source-label">REFERENCE A {generatedAsset && <em>REQUEST IMAGE</em>}</span><div className="source-preview source-asset sent-reference" style={{ aspectRatio: pipelineAspect }}>{sentReferenceA ? <img src={sentReferenceA} alt="사각형에 맞춘 실제 전송 Reference A" onLoad={(event) => debugLog("REFERENCE_A_RENDERED", { natural: `${event.currentTarget.naturalWidth}x${event.currentTarget.naturalHeight}`, rendered: `${event.currentTarget.clientWidth}x${event.currentTarget.clientHeight}` })} /> : <PoseGuide action="idle" direction={direction} compact />}<span className="reference-frame-overlay" style={pipelineFrameStyle} aria-label="Reference A 공통 프레임" /></div><strong>{generatedAsset ? "실제 전송 이미지 A" : "공통 사각형에 맞춘 기준 A"}</strong><small>실제 canvas {generatedAsset?.referenceImages?.[0]?.size ?? pipelineCanvas}</small><small>{generatedAsset?.referenceImages?.[0]?.name ?? (category === "character" ? activeReference.name : `${category}.${family.id}.ref`)}</small></article>
                    <b>+</b>
                    <article data-testid="reference-b"><span className="source-label">REFERENCE B {generatedAsset && <em>REQUEST IMAGE</em>}</span><div className="source-preview source-guide sent-reference" style={{ aspectRatio: pipelineAspect }}>{sentReferenceB ? <img src={sentReferenceB} alt="실제 전송 Reference B" onLoad={(event) => debugLog("REFERENCE_B_RENDERED", { natural: `${event.currentTarget.naturalWidth}x${event.currentTarget.naturalHeight}`, rendered: `${event.currentTarget.clientWidth}x${event.currentTarget.clientHeight}` })} /> : <div className="mini-layout-frame">{category === "character" ? <PoseGuide action={action} direction={direction} frameIndex={frameIndex} compact /> : category === "tile" ? <TileGuide topology={topology} compact /> : <ObjectSchematic family={family} compact />}</div>}</div><strong>{sentReferenceB ? "실제 전송 이미지 B" : "자동 레이아웃 가이드"}</strong><small>실제 canvas {generatedAsset?.referenceImages?.[1]?.size ?? pipelineCanvas}</small><small>{generatedAsset?.referenceImages?.[1]?.name ?? `${ratioLabel} · ${category === "character" ? `${framePhase.id} · ${directionLayout.occupancy}` : category === "tile" ? topology : family.footprint}`}</small></article>
                    <b>→</b>
                    <article className={generatedAsset ? "output-plan has-result" : "output-plan"} data-testid="output-layout"><span className="source-label">OUTPUT</span>{generatedAsset ? <><div className="result-canvas-shell" style={{ aspectRatio: pipelineAspect }}><img className="generated-result-image" src={`${generatedAsset.imageUrl}?v=${generatedAsset.generationId}`} alt="RunPod 생성 결과" onLoad={(event) => debugLog("OUTPUT_RENDERED", { natural: `${event.currentTarget.naturalWidth}x${event.currentTarget.naturalHeight}`, rendered: `${event.currentTarget.clientWidth}x${event.currentTarget.clientHeight}` })} /><span className="result-crop-overlay" aria-label="고정 crop bounds 오버레이" /></div><strong>{generatedAsset.generationId}</strong><small>canvas {generatedAsset.size}</small><small>{generatedAsset.selection?.frameId ?? pipelineFrameId}</small>{generatedAsset.layout && <small>frame {generatedAsset.layout.frameWidth}×{generatedAsset.layout.frameHeight} · x{generatedAsset.layout.frameX} y{generatedAsset.layout.frameY} · baseline {generatedAsset.layout.baselineY}</small>}<small>{(generatedAsset.elapsedMs / 1000).toFixed(1)}초</small></> : <><div className="frame-output-title">{isGenerating ? "RUNPOD 생성 중…" : category === "character" ? framePhase.id : category === "tile" ? `${topology} variants` : objectState}</div><div className="frame-slots">{Array.from({ length: category === "character" ? actionPreset.frames : category === "tile" ? 4 : 1 }, (_, index) => <i key={index} className={category === "character" && index === frameIndex ? "is-current" : ""} />)}</div></>}</article>
                  </div>
                </section>
              </div>

              {category === "character" && <div className="direction-reference-strip" data-testid="direction-reference-strip"><div className="option-heading"><span>방향별 무동작 생성 기준</span><button type="button" onClick={loadLatestDirectionReferences} disabled={isGenerating} data-testid="load-latest-direction-references">최근 기준 불러오기</button></div><div>{DIRECTIONS.map((item) => {
                const reference = directionReferences[item.id];
                const approved = directionApprovals[item.id];
                const generated = reference.stage === "generated" && Boolean(reference.preview);
                return <article key={item.id} className={`${direction === item.id ? "is-active" : ""}${approved ? " is-approved" : generated ? " is-review" : " is-missing"}`} data-testid={`direction-reference-${item.id}`}><div className="direction-reference-preview">{reference.preview ? <img src={reference.preview} alt={`${item.label} 기준 이미지`} /> : <PoseGuide action="idle" direction={item.id} compact />}</div><strong>{item.label}</strong><small>{approved ? "승인됨" : generated ? "생성 결과 검수 필요" : item.id === "front" && reference.preview ? "정면 입력 원본 · 생성 전" : "생성 전"}</small><div className="direction-reference-actions"><button type="button" onClick={() => changeDirection(item.id)} disabled={isGenerating} data-testid={`direction-${item.id}`}>보기</button>{generated && <button type="button" className={approved ? "is-approved" : ""} onClick={() => setDirectionApprovals((current) => ({ ...current, [item.id]: !current[item.id] }))} disabled={isGenerating} data-testid={`approve-direction-${item.id}`}>{approved ? "승인 취소" : "승인"}</button>}<button type="button" onClick={() => regenerateDirectionReference(item.id)} disabled={isGenerating || endpoint.status !== "연결됨"} data-testid={`regenerate-direction-${item.id}`}>재생성</button></div></article>;
              })}</div></div>}

              {category === "character" && <div className="variant-controls"><section className="variant-section"><div className="option-heading"><span>방향</span><span className="field-note">LAYOUT OVERRIDE</span></div><div className="direction-grid">{DIRECTIONS.map((item) => <button key={item.id} type="button" role="checkbox" aria-checked={direction === item.id} className={direction === item.id ? "check-option is-checked" : "check-option"} onClick={() => changeDirection(item.id)} disabled={isGenerating} data-testid={`direction-control-${item.id}`}><span className="check-box">{direction === item.id ? "✓" : ""}</span>{item.label}</button>)}</div></section><section className="variant-section"><div className="option-heading"><span>동작 7종</span><span className="field-note">CLICK TO DEBUG</span></div><div className="action-grid">{ACTIONS.map((item) => <button key={item.id} type="button" role="checkbox" aria-checked={action === item.id} className={action === item.id ? "check-option is-checked" : "check-option"} onClick={() => changeAction(item.id)} disabled={isGenerating} data-testid={`action-${item.id}`}><span className="check-box">{action === item.id ? "✓" : ""}</span>{item.label}</button>)}</div></section></div>}
            </>
          )}

          <div className="prompt-preview"><div className="prompt-heading"><span>PROMPT PREVIEW</span><span>OPTION SEED {optionSeed}</span></div><p>{toolMode === "i2i" ? generationPrompt : prompt}</p></div>
          {toolMode === "i2i" && category === "character" && <section className="batch-generation" data-testid="character-batch-generation">
            <div className="batch-generation-heading"><div><span>4-DIRECTION CHARACTER ASSETS</span><strong>정면 입력 A → 정면·후면·좌측 기준 생성 + 우측 원본 반전 → 4방향 승인 → 동작 68프레임 원본 생성</strong><small>정면도 정면 가이드 B로 사각형을 채워 다시 생성 · 모든 방향과 동작은 {guideSize.width}×{guideSize.height}px 원본 저장 · 후처리는 전 프레임 완료 뒤 수동 실행</small></div><div className="batch-buttons"><button type="button" onClick={generateDirectionReferences} disabled={endpoint.status !== "연결됨" || isGenerating || !frontSourceReference.preview} data-testid="generate-direction-references">{isGenerating && batchProgress.status === "direction" ? `${batchProgress.completed}/${batchProgress.total} 방향 생성 중` : "정면·후면·좌측 생성 + 우측 반전"}</button><button type="button" onClick={generateAllCharacterActions} disabled={endpoint.status !== "연결됨" || isGenerating || !allDirectionReferencesApproved} data-testid="generate-all-character-assets">{isGenerating && batchProgress.status === "actions" ? `${batchProgress.completed}/${batchProgress.total} RunPod 생성 중` : allDirectionReferencesApproved ? "승인 기준으로 68개 원본 생성" : "4방향 승인 필요"}</button><button type="button" onClick={postprocessCompletedBatch} disabled={batchProgress.status !== "complete" || isGenerating || isPostprocessing} data-testid="postprocess-character-assets">{isPostprocessing ? "후처리 중" : postprocessManifestUrl ? "후처리 완료" : "전 프레임 완료 후 후처리 시작"}</button></div></div>
            <div className="batch-progress" data-status={batchProgress.status}><i style={{ width: `${batchProgress.total ? (batchProgress.completed / batchProgress.total) * 100 : 0}%` }} /><span>{batchProgress.status === "idle" ? "대기" : `${batchProgress.completed}/${batchProgress.total} · ${batchProgress.current}`}</span></div>
            {batchProgress.bundleId && <div className="batch-bundle"><strong>{batchProgress.bundleId}</strong><span>{batchProgress.manifestUrl && <a href={batchProgress.manifestUrl} target="_blank" rel="noreferrer">원본 manifest</a>}{postprocessManifestUrl && <a href={postprocessManifestUrl} target="_blank" rel="noreferrer">후처리 manifest</a>}</span></div>}
            {batchResults.length > 0 && <div className="batch-result-grid" data-testid="batch-result-grid">{batchResults.map((result) => <article key={result.generationId}><div><img src={result.imageUrl} alt={`${result.selection?.frameId ?? result.generationId} RunPod 원본`} /></div><strong>{result.selection?.frameId}</strong><small>RunPod 원본 · {result.selection?.direction} · {result.selection?.action}</small></article>)}</div>}
          </section>}
          {toolMode === "i2i" && <div className="runpod-generation-bar" data-testid="runpod-generation"><div><span>QWEN-IMAGE-EDIT-2511</span><strong>{endpoint.status === "연결됨" ? endpoint.model : endpoint.message ?? "Endpoint 확인 중"}</strong><small>{hasActiveReference ? "Reference A + 자동 생성 Reference B" : `${direction}.ref 등록 필요`} · 40 steps · CFG 4 · guidance 1 · seed {optionSeed}</small></div><button type="button" onClick={runImageEdit} disabled={endpoint.status !== "연결됨" || isGenerating || !hasActiveReference} data-testid="runpod-generate">{isGenerating ? "이미지 생성 중…" : hasActiveReference ? "실제 이미지 생성" : `${direction}.ref 등록 필요`}</button></div>}
        </section>

        <aside className="history-panel panel">
          <div className="panel-title-row"><div><span className="section-number">03</span><h2>상태 · 히스토리</h2></div><button type="button" className="filter-button">필터</button></div>
          <div className="catalog-status"><strong>문서 카탈로그 연결</strong><span>Tile {FAMILY_CATALOG.tile.length}</span><span>Object {FAMILY_CATALOG.object.length}</span><span>전체 {Object.values(FAMILY_CATALOG).reduce((sum, list) => sum + list.length, 0)}</span></div>
          <div className="status-summary"><div><strong>{history.filter((item) => item.job === "대기").length}</strong><span>대기</span></div><div><strong>0</strong><span>진행</span></div><div><strong>{history.filter((item) => item.job === "완료").length}</strong><span>완료</span></div><div><strong>{history.filter((item) => item.job === "실패").length}</strong><span>실패</span></div></div>
          <div className="notice-box"><i />{notice}</div>
          <div className="history-list" data-testid="history-list">{history.map((item) => <article className="history-item" key={item.id}><div className="history-thumb"><span>{item.asset.slice(0, 2).toUpperCase()}</span></div><div className="history-copy"><div className="history-id"><strong>{item.id}</strong><time>{item.time}</time></div><p>{item.asset}</p><small>{item.detail}</small><div className="status-tags"><span className={`job-tag job-${item.job}`}>{item.job}</span><span className="asset-tag">{item.assetState}</span></div></div></article>)}</div>
          <div className={`endpoint-note endpoint-note-${endpoint.status}`}><span className="endpoint-icon">{endpoint.status === "연결됨" ? "✓" : "!"}</span><div><strong>RunPod {endpoint.status}</strong><p>{endpoint.model ?? endpoint.message ?? "서버 상태와 모델을 확인하고 있습니다."}</p></div></div>
        </aside>
      </div>
    </main>
  );
}
