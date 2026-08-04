"use client";

/* eslint-disable @next/next/no-img-element -- RunPod output and local File previews must stay unoptimized for pixel-level inspection. */

import { useMemo, useState } from "react";

type EndpointState = {
  status: "확인 중" | "연결됨" | "오류";
  model?: string;
  latencyMs?: number;
  message?: string;
};

type CharacterSheetResult = {
  ok: true;
  generationId: string;
  requestId: string;
  model: string;
  prompt: string;
  seed: number;
  inputImageUrl: string;
  imageUrl: string;
  metadataUrl: string;
  inputSize: string;
  outputSize: string;
  elapsedMs: number;
  cells: string[];
  postprocessed: false;
};

type EquipResult = {
  generationId: string;
  requestId: string;
  model: string;
  imageUrl: string;
  metadataUrl: string;
  elapsedMs: number;
  size: string;
  seed: number;
  referenceImages?: Array<{ name: string; url: string; size?: string }>;
};

type HistoryItem = {
  id: string;
  phase: string;
  imageUrl: string;
  size: string;
  seed: number;
  status: "완료" | "실패";
  createdAt: string;
};

type BaseAssetCategory = "tile" | "object" | "creature" | "item" | "vfx" | "ui" | "guide";

type BaseAssetResult = {
  ok: true;
  generationId: string;
  requestId: string;
  model: string;
  category: BaseAssetCategory;
  assetName: string;
  prompt: string;
  seed: number;
  inputImageUrl: string;
  imageUrl: string;
  metadataUrl: string;
  inputSize: string;
  outputSize: string;
  elapsedMs: number;
  postprocessed: false;
};

type SelectionKey = "role" | "gender" | "age" | "body" | "hair" | "clothes" | "detail";
type Selections = Record<SelectionKey, string>;

const CHARACTER_OPTIONS: Array<{ key: SelectionKey; label: string; values: Array<{ label: string; prompt: string }> }> = [
  { key: "role", label: "역할", values: [
    { label: "농부", prompt: "farm worker" },
    { label: "여행자", prompt: "traveler" },
    { label: "대장장이", prompt: "blacksmith" },
    { label: "상인", prompt: "shopkeeper" },
  ] },
  { key: "gender", label: "성별 표현", values: [
    { label: "남성형", prompt: "masculine" },
    { label: "여성형", prompt: "feminine" },
    { label: "중성적", prompt: "androgynous" },
  ] },
  { key: "age", label: "연령", values: [
    { label: "청년", prompt: "young adult" },
    { label: "중년", prompt: "middle-aged" },
    { label: "노년", prompt: "older adult" },
  ] },
  { key: "body", label: "체형", values: [
    { label: "보통", prompt: "average height and build" },
    { label: "작고 단단함", prompt: "short and sturdy" },
    { label: "크고 마름", prompt: "tall and lean" },
  ] },
  { key: "hair", label: "머리", values: [
    { label: "짧은 흑발", prompt: "short dark hair" },
    { label: "긴 갈색 머리", prompt: "long brown hair" },
    { label: "묶은 적갈색 머리", prompt: "tied auburn hair" },
    { label: "은색 단발", prompt: "silver bob haircut" },
  ] },
  { key: "clothes", label: "의상", values: [
    { label: "파란 작업복", prompt: "blue work shirt, dark trousers, brown boots" },
    { label: "초록 작업복", prompt: "green work shirt, beige trousers, brown boots" },
    { label: "갈색 앞치마", prompt: "cream shirt, brown leather apron, dark boots" },
    { label: "붉은 외투", prompt: "red short coat, charcoal trousers, black boots" },
  ] },
  { key: "detail", label: "특징", values: [
    { label: "없음", prompt: "no accessories" },
    { label: "밀짚모자", prompt: "straw hat" },
    { label: "붉은 목도리", prompt: "red scarf" },
    { label: "둥근 안경", prompt: "round glasses" },
  ] },
];

const DEFAULT_SELECTIONS: Selections = {
  role: "farm worker",
  gender: "masculine",
  age: "young adult",
  body: "average height and build",
  hair: "short dark hair",
  clothes: "blue work shirt, dark trousers, brown boots",
  detail: "no accessories",
};

const ASSET_GROUPS = [
  ["TL", "타일", "지표·물·길·전이"],
  ["OB", "오브젝트", "자연물·건물·가구"],
  ["CH", "캐릭터", "플레이어·NPC·레이어"],
  ["CR", "생명체", "가축·야생동물·몬스터"],
  ["IT", "아이템", "도구·무기·재료"],
  ["FX", "VFX", "타격·채집·날씨"],
  ["UI", "UI", "아이콘·커서·상태"],
  ["GD", "가이드", "규격·방향·동작"],
] as const;

const BASE_ASSET_CATALOG: Array<{
  id: BaseAssetCategory;
  code: string;
  label: string;
  summary: string;
  items: string[];
}> = [
  { id: "tile", code: "TL", label: "타일", summary: "지표·물·전이·길·실내", items: ["잔디 center", "흙 center", "경작지", "모래", "얕은 물", "깊은 물", "해안선", "잔디-흙 전이", "절벽", "흙길", "나무 길", "돌길", "나무 다리", "계단", "실내 목재 바닥", "실내 석조 벽"] },
  { id: "object", code: "OB", label: "오브젝트", summary: "자연물·농장·설비·건물·가구", items: ["일반 나무", "과실수", "관목", "작은 돌", "큰 바위", "작물", "울타리", "울타리 문", "허수아비", "스프링클러", "상자", "작업대", "용광로", "농가", "축사", "온실", "우편함", "침대", "테이블", "의자"] },
  { id: "creature", code: "CR", label: "생명체", summary: "가축·반려동물·야생동물·몬스터", items: ["닭", "소", "양", "돼지", "개", "고양이", "새", "개구리", "물고기", "슬라임", "비행 몬스터", "사족 몬스터"] },
  { id: "item", code: "IT", label: "아이템", summary: "도구·무기·재료·음식·장비", items: ["괭이", "물뿌리개", "도끼", "곡괭이", "낚싯대", "낫", "망치", "한손검", "양손검", "둔기", "창", "활", "방패", "씨앗 주머니", "목재", "돌", "광석", "음식", "모자"] },
  { id: "vfx", code: "FX", label: "VFX", summary: "이동·도구·농사·환경·날씨", items: ["먼지", "잔디 파편", "물 튀김", "눈 발자국", "휘두르기 궤적", "타격 불꽃", "수확 효과", "회복 효과", "비", "눈", "낙엽", "물결", "불꽃", "연기"] },
  { id: "ui", code: "UI", label: "UI", summary: "HUD·인벤토리·패널·대화·커서", items: ["체력 아이콘", "스태미나 아이콘", "시간 아이콘", "날씨 아이콘", "인벤토리 슬롯", "선택 슬롯", "대화 상자", "상점 패널", "제작 패널", "기본 커서", "상호작용 커서", "지도 마커", "관계 하트"] },
  { id: "guide", code: "GD", label: "가이드", summary: "규격·방향·동작·점유·autotile", items: ["1x1 점유", "1x2 점유", "2x1 점유", "2x2 점유", "3x2 점유", "4방향 배치", "걷기 접촉 포즈", "한손 무기 포즈", "양손 무기 포즈", "도구 휘두르기 포즈", "활쏘기 포즈", "타일 edge-corner guide"] },
];

const DIRECTIONS = [
  { id: "front", label: "정면", order: "1" },
  { id: "back", label: "후면", order: "2" },
  { id: "right", label: "오른쪽", order: "3" },
  { id: "left", label: "왼쪽", order: "4" },
];

function buildPrompt(selections: Selections) {
  const description = Object.values(selections).join(", ");
  return [
    `Create one 2x2 turnaround sheet of one full-body ${description} on a plain white background.`,
    "Top-left: front view. Top-right: back view. Bottom-left: right profile facing right. Bottom-right: left profile facing left.",
    "Show each character head-to-toe at equal height with feet on the same line.",
    "Keep identity, clothes, colors, and proportions identical. No text, borders, handheld items, shadows, or cropping.",
  ].join(" ");
}

const ASSET_PROMPT_NAMES: Record<string, string> = {
  "잔디 center": "grass terrain center tile", "흙 center": "soil terrain center tile", "경작지": "tilled farmland tile", "모래": "sand terrain tile", "얕은 물": "shallow water tile", "깊은 물": "deep water tile", "해안선": "water shoreline tile", "잔디-흙 전이": "grass to soil transition tile", "절벽": "cliff terrain tile", "흙길": "dirt path tile", "나무 길": "wood plank path tile", "돌길": "stone path tile", "나무 다리": "wooden bridge tile", "계단": "outdoor stairs tile", "실내 목재 바닥": "indoor wooden floor tile", "실내 석조 벽": "indoor stone wall tile",
  "일반 나무": "mature farm tree", "과실수": "fruit tree", "관목": "farm shrub", "작은 돌": "small field rock", "큰 바위": "large boulder", "작물": "mature farm crop", "울타리": "wooden farm fence", "울타리 문": "wooden farm gate", "허수아비": "farm scarecrow", "스프링클러": "farm sprinkler", "상자": "wooden storage chest", "작업대": "crafting workbench", "용광로": "small smelting furnace", "농가": "small farmhouse with a front door and house windows, not a barn", "축사": "small barn", "온실": "glass greenhouse with transparent glass wall panels, glass double doors, and a glass gabled roof, no opaque walls or barn doors", "우편함": "rural mailbox", "침대": "wooden single bed", "테이블": "wooden table", "의자": "wooden chair",
  "닭": "chicken", "소": "cow", "양": "sheep", "돼지": "pig", "개": "farm dog", "고양이": "farm cat", "새": "small wild bird", "개구리": "frog", "물고기": "freshwater fish", "슬라임": "friendly slime creature", "비행 몬스터": "small flying monster", "사족 몬스터": "small quadruped monster",
  "괭이": "farming hoe", "물뿌리개": "watering can", "도끼": "woodcutting axe", "곡괭이": "mining pickaxe", "낚싯대": "fishing rod", "낫": "farming sickle", "망치": "crafting hammer", "한손검": "one-handed sword", "양손검": "two-handed sword", "둔기": "one-handed mace", "창": "spear", "활": "wooden bow", "방패": "round shield", "씨앗 주머니": "seed pouch", "목재": "bundle of wood", "돌": "stone resource", "광석": "ore chunk", "음식": "farm meal", "모자": "straw hat",
  "먼지": "dust puff effect", "잔디 파편": "grass debris effect", "물 튀김": "water splash effect", "눈 발자국": "snow footprint effect", "휘두르기 궤적": "weapon swing trail effect", "타격 불꽃": "impact spark effect", "수확 효과": "harvest pickup effect", "회복 효과": "healing effect", "비": "rain effect", "눈": "snowfall effect", "낙엽": "falling leaves effect", "물결": "water ripple effect", "불꽃": "small flame effect", "연기": "small smoke effect",
  "체력 아이콘": "health icon", "스태미나 아이콘": "stamina icon", "시간 아이콘": "time icon", "날씨 아이콘": "weather icon", "인벤토리 슬롯": "inventory slot", "선택 슬롯": "selected inventory slot", "대화 상자": "dialogue box", "상점 패널": "shop panel", "제작 패널": "crafting panel", "기본 커서": "default game cursor", "상호작용 커서": "interaction cursor", "지도 마커": "map marker", "관계 하트": "relationship heart icon",
  "1x1 점유": "one by one cell footprint guide", "1x2 점유": "one by two cell footprint guide", "2x1 점유": "two by one cell footprint guide", "2x2 점유": "two by two cell footprint guide", "3x2 점유": "three by two cell footprint guide", "4방향 배치": "four-direction turnaround placement guide", "걷기 접촉 포즈": "walk contact pose guide", "한손 무기 포즈": "one-handed weapon pose guide", "양손 무기 포즈": "two-handed weapon pose guide", "도구 휘두르기 포즈": "tool swing pose guide", "활쏘기 포즈": "bow shooting pose guide", "타일 edge-corner guide": "terrain tile edge and corner guide",
};

const FRONT_ELEVATION_OBJECTS = new Set(["농가", "축사", "온실"]);

function buildBaseAssetPrompt(category: BaseAssetCategory, item: string) {
  const subject = ASSET_PROMPT_NAMES[item] ?? item;
  if (category === "tile") return `Create one seamless square top-down 2D game tile of ${subject}. Fill edge to edge with a uniform repeating distribution. Flat painted color and simplified shapes. No center composition, vignette, objects, text, border, perspective, or photorealism.`;
  if (category === "object" && FRONT_ELEVATION_OBJECTS.has(item)) return `Create one isolated 2D game sprite of a ${subject}. Flat orthographic front elevation only, centered on white, fully visible. Show only the front wall and front roof. No side wall, side roof, ground, path, plants, scenery, perspective, text, shadow, border, or cropping.`;
  if (category === "object") return `Create one clean 2D game asset of a ${subject}. True straight-on front view, centered on white, fully visible. No side view, three-quarter angle, perspective, character, text, shadow, border, or cropping.`;
  if (category === "creature") return `Create one 2x2 turnaround sheet of the same full-body ${subject} on white. Top-left true front: symmetric chest and both eyes visible. Top-right true rear: back and tail visible, no face. Bottom-left exact right profile facing right. Bottom-right exact left profile facing left. Equal size and foot line. No text, border, shadow, or cropping.`;
  if (category === "vfx") return `Create one 2x2 keyframe sheet of the same 2D game ${subject} on white. Top-left small forming, top-right medium expanding, bottom-left large peak, bottom-right fading particles. One effect only per cell, flat illustrated shapes. No objects, scenery, text, border, or photorealism.`;
  if (category === "ui") return `Create one clean 2D game ${subject}, centered on white with generous margin. Front-facing, simple readable shape. No text, border, shadow, or extra icons.`;
  if (category === "guide") return `Create one clean black-line ${subject} on a white canvas. Keep all marks inside the canvas. No color, shading, text, or decoration.`;
  if (category === "item") return `Create one clean 2D game asset of a ${subject}, small and centered on white with wide empty margin, fully visible and upright. No character, hand, text, border, shadow, or cropping.`;
  return `Create one clean 2D game asset of a ${subject}, centered on white, fully visible and isolated. No character, text, border, shadow, or cropping.`;
}

const DEFAULT_EQUIP_PROMPT = [
  "Keep image 1 unchanged.",
  "Add exactly one image 2 sword to each character's right hand.",
  "Front and back: sword points straight down beside the right leg.",
  "Side views: sword points forward.",
  "Exactly 4 swords, all touching hands.",
  "Clean white background. No loose swords or marks.",
].join(" ");

function randomChoice<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function nowLabel() {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

export default function Home() {
  const [endpoint, setEndpoint] = useState<EndpointState>({ status: "확인 중" });
  const [selections, setSelections] = useState<Selections>(DEFAULT_SELECTIONS);
  const [prompt, setPrompt] = useState(() => buildPrompt(DEFAULT_SELECTIONS));
  const [seed, setSeed] = useState(4821);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState("RunPod 연결 확인 버튼을 눌러 주세요.");
  const [sheet, setSheet] = useState<CharacterSheetResult | null>(null);
  const [approved, setApproved] = useState(false);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemPreview, setItemPreview] = useState("");
  const [equipResult, setEquipResult] = useState<EquipResult | null>(null);
  const [equipPrompt, setEquipPrompt] = useState(DEFAULT_EQUIP_PROMPT);
  const [isEquipping, setIsEquipping] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState<BaseAssetCategory>("item");
  const [catalogItem, setCatalogItem] = useState("한손검");
  const [catalogPrompt, setCatalogPrompt] = useState(() => buildBaseAssetPrompt("item", "한손검"));
  const [catalogResult, setCatalogResult] = useState<BaseAssetResult | null>(null);
  const [generatedItem, setGeneratedItem] = useState<BaseAssetResult | null>(null);
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const activeCatalog = useMemo(() => BASE_ASSET_CATALOG.find((group) => group.id === catalogCategory) ?? BASE_ASSET_CATALOG[0], [catalogCategory]);

  const selectedLabels = useMemo(() => CHARACTER_OPTIONS.map((group) => {
    const selected = group.values.find((value) => value.prompt === selections[group.key]);
    return { label: group.label, value: selected?.label ?? selections[group.key] };
  }), [selections]);

  function updateSelection(key: SelectionKey, value: string) {
    const next = { ...selections, [key]: value };
    setSelections(next);
    setPrompt(buildPrompt(next));
    setApproved(false);
  }

  function randomizeAll() {
    const next = CHARACTER_OPTIONS.reduce((current, group) => ({
      ...current,
      [group.key]: randomChoice(group.values).prompt,
    }), {} as Selections);
    setSelections(next);
    setPrompt(buildPrompt(next));
    setSeed(Math.floor(Math.random() * 2_000_000_000));
    setApproved(false);
    setNotice("캐릭터 조건과 seed를 랜덤 선택했습니다.");
  }

  function changeCatalogCategory(category: BaseAssetCategory) {
    const group = BASE_ASSET_CATALOG.find((entry) => entry.id === category) ?? BASE_ASSET_CATALOG[0];
    const item = group.items[0];
    setCatalogCategory(category);
    setCatalogItem(item);
    setCatalogPrompt(buildBaseAssetPrompt(category, item));
    setCatalogResult(null);
    setNotice(`${group.label} 기준 에셋 목록을 열었습니다.`);
  }

  function changeCatalogItem(item: string) {
    setCatalogItem(item);
    setCatalogPrompt(buildBaseAssetPrompt(catalogCategory, item));
  }

  function randomizeCatalogItem() {
    const item = randomChoice(activeCatalog.items);
    setCatalogItem(item);
    setCatalogPrompt(buildBaseAssetPrompt(catalogCategory, item));
    setSeed(Math.floor(Math.random() * 2_000_000_000));
    setNotice(`${activeCatalog.label} 유형과 seed를 랜덤 선택했습니다.`);
  }

  async function generateBaseAsset() {
    if (isGeneratingBase || endpoint.status !== "연결됨") return;
    setIsGeneratingBase(true);
    setCatalogResult(null);
    setNotice(`${activeCatalog.label} · ${catalogItem} 기준 에셋을 RunPod에 요청했습니다.`);
    console.info("[AssetForge][BASE_ASSET_REQUEST_START]", { category: catalogCategory, assetName: catalogItem, seed, promptCharacters: catalogPrompt.length });
    try {
      const response = await fetch("/api/runpod/asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: catalogCategory, assetName: catalogItem, prompt: catalogPrompt, seed, size: "1024x1024" }),
      });
      const body = await response.json() as BaseAssetResult & { error?: string };
      if (!response.ok) throw new Error(`${body.error || "기준 에셋 생성 실패"}${body.requestId ? ` · ${body.requestId}` : ""}`);
      setCatalogResult(body);
      if (body.category === "item") {
        setGeneratedItem(body);
        setItemFile(null);
        if (itemPreview.startsWith("blob:")) URL.revokeObjectURL(itemPreview);
        setItemPreview(body.imageUrl);
      }
      const historyItem: HistoryItem = { id: body.generationId, phase: `${activeCatalog.label} 기준`, imageUrl: body.imageUrl, size: body.outputSize, seed: body.seed, status: "완료", createdAt: nowLabel() };
      setHistory((current) => [historyItem, ...current].slice(0, 16));
      setNotice(`${activeCatalog.label} · ${catalogItem} 생성 완료 · ${body.outputSize} · ${(body.elapsedMs / 1000).toFixed(1)}초`);
      console.info("[AssetForge][BASE_ASSET_REQUEST_COMPLETE]", { generationId: body.generationId, category: body.category, assetName: body.assetName, size: body.outputSize, elapsedMs: body.elapsedMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "기준 에셋 생성 실패";
      const historyItem: HistoryItem = { id: `FAILED-${Date.now()}`, phase: `${activeCatalog.label} 기준`, imageUrl: "", size: "-", seed, status: "실패", createdAt: nowLabel() };
      setHistory((current) => [historyItem, ...current].slice(0, 16));
      setNotice(`${activeCatalog.label} 생성 실패 · ${message}`);
      console.error("[AssetForge][BASE_ASSET_REQUEST_FAILED]", { category: catalogCategory, assetName: catalogItem, message });
    } finally {
      setIsGeneratingBase(false);
    }
  }

  async function loadLatestBaseAsset() {
    setNotice(`저장된 최근 ${activeCatalog.label} 기준을 불러오는 중입니다.`);
    try {
      const response = await fetch(`/api/runpod/asset?category=${catalogCategory}`, { cache: "no-store" });
      const body = await response.json() as BaseAssetResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "최근 기준 에셋 조회 실패");
      setCatalogResult(body);
      setCatalogItem(body.assetName);
      setCatalogPrompt(body.prompt);
      setSeed(body.seed);
      if (body.category === "item") {
        setGeneratedItem(body);
        setItemFile(null);
        if (itemPreview.startsWith("blob:")) URL.revokeObjectURL(itemPreview);
        setItemPreview(body.imageUrl);
      }
      setNotice(`최근 ${activeCatalog.label} 기준 불러옴 · ${body.generationId}`);
      console.info("[AssetForge][BASE_ASSET_LATEST_LOADED]", { generationId: body.generationId, category: body.category, assetName: body.assetName });
    } catch (error) {
      const message = error instanceof Error ? error.message : "최근 기준 에셋 조회 실패";
      setNotice(`최근 ${activeCatalog.label} 불러오기 실패 · ${message}`);
    }
  }

  async function checkHealth() {
    setEndpoint({ status: "확인 중" });
    setNotice("RunPod 상태를 확인 중입니다.");
    try {
      const response = await fetch("/api/runpod/health", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; model?: string; latencyMs?: number; message?: string };
      if (!response.ok || body.ok !== true) throw new Error(body.message || `HTTP ${response.status}`);
      setEndpoint({ status: "연결됨", model: body.model, latencyMs: body.latencyMs });
      setNotice(`RunPod 연결 완료 · ${body.model}`);
      console.info("[AssetForge][HEALTH_OK]", { model: body.model, latencyMs: body.latencyMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "연결 실패";
      setEndpoint({ status: "오류", message });
      setNotice(`RunPod 연결 실패 · ${message}`);
      console.error("[AssetForge][HEALTH_FAILED]", { message });
    }
  }

  async function generateCharacterSheet() {
    if (isGenerating) return;
    setIsGenerating(true);
    setApproved(false);
    setEquipResult(null);
    setNotice("빈 흰 캔버스 1장과 프롬프트를 RunPod에 전송했습니다. 원본 응답을 기다리는 중입니다.");
    console.info("[AssetForge][CHARACTER_REQUEST_START]", { seed, promptCharacters: prompt.length, size: "1024x1024" });
    try {
      const response = await fetch("/api/runpod/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, seed, size: "1024x1024" }),
      });
      const body = await response.json() as CharacterSheetResult & { error?: string };
      if (!response.ok) throw new Error(`${body.error || "생성 실패"}${body.requestId ? ` · ${body.requestId}` : ""}`);
      setSheet(body);
      setEndpoint({ status: "연결됨", model: body.model });
      const historyItem: HistoryItem = { id: body.generationId, phase: "4방향 기준", imageUrl: body.imageUrl, size: body.outputSize, seed: body.seed, status: "완료", createdAt: nowLabel() };
      setHistory((current) => [historyItem, ...current].slice(0, 8));
      setNotice(`4방향 원본 생성 완료 · ${body.outputSize} · ${(body.elapsedMs / 1000).toFixed(1)}초`);
      console.info("[AssetForge][CHARACTER_REQUEST_COMPLETE]", { generationId: body.generationId, requestId: body.requestId, outputSize: body.outputSize, elapsedMs: body.elapsedMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "생성 실패";
      const historyItem: HistoryItem = { id: `FAILED-${Date.now()}`, phase: "4방향 기준", imageUrl: "", size: "-", seed, status: "실패", createdAt: nowLabel() };
      setHistory((current) => [historyItem, ...current].slice(0, 8));
      setNotice(`4방향 생성 실패 · ${message}`);
      console.error("[AssetForge][CHARACTER_REQUEST_FAILED]", { message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function loadLatestCharacterSheet() {
    setNotice("저장된 최근 4방향 캐릭터를 불러오는 중입니다.");
    try {
      const response = await fetch("/api/runpod/character", { cache: "no-store" });
      const body = await response.json() as CharacterSheetResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "최근 캐릭터 조회 실패");
      setSheet(body);
      setPrompt(body.prompt);
      setSeed(body.seed);
      setApproved(false);
      setEquipResult(null);
      setNotice(`최근 4방향 기준 불러옴 · ${body.generationId}`);
      console.info("[AssetForge][CHARACTER_LATEST_LOADED]", { generationId: body.generationId, size: body.outputSize });
    } catch (error) {
      const message = error instanceof Error ? error.message : "최근 캐릭터 조회 실패";
      setNotice(`최근 캐릭터 불러오기 실패 · ${message}`);
    }
  }

  function changeItem(file: File | null) {
    if (!file) return;
    if (itemPreview.startsWith("blob:")) URL.revokeObjectURL(itemPreview);
    setItemFile(file);
    setGeneratedItem(null);
    setItemPreview(URL.createObjectURL(file));
    setEquipResult(null);
    setNotice(`Reference B 아이템 등록 · ${file.name}`);
    console.info("[AssetForge][ITEM_REFERENCE_SELECTED]", { name: file.name, bytes: file.size, type: file.type });
  }

  async function equipItem() {
    if (!approved || !sheet || (!itemFile && !generatedItem) || isEquipping) return;
    setIsEquipping(true);
    setEquipResult(null);
    setNotice("4방향 기준 A와 아이템 B를 RunPod에 전송했습니다.");
    try {
      const sheetBlob = await fetch(sheet.imageUrl).then((response) => {
        if (!response.ok) throw new Error("승인한 Reference A를 읽을 수 없습니다.");
        return response.blob();
      });
      const form = new FormData();
      form.append("image", sheetBlob, `${sheet.generationId}-reference-a.png`);
      if (itemFile) {
        form.append("image", itemFile, `reference-b-${itemFile.name}`);
      } else if (generatedItem) {
        const generatedItemBlob = await fetch(generatedItem.imageUrl).then((response) => {
          if (!response.ok) throw new Error("생성한 Reference B 아이템을 읽을 수 없습니다.");
          return response.blob();
        });
        form.append("image", generatedItemBlob, `${generatedItem.generationId}-reference-b.png`);
      }
      form.set("prompt", equipPrompt);
      form.set("negativePrompt", "changed character, changed clothes, different scale, missing item, text, borders, cropped body");
      form.set("size", sheet.outputSize);
      form.set("seed", String(seed));
      form.set("numInferenceSteps", "40");
      form.set("trueCfgScale", "4");
      form.set("guidanceScale", "1");
      form.set("category", "equipment_test");
      form.set("direction", "four-view");
      form.set("action", "equip-item");
      form.set("frameId", "Equipped_4Direction_01");
      form.set("frameIndex", "0");

      console.info("[AssetForge][EQUIP_REQUEST_START]", { referenceA: sheet.generationId, referenceB: itemFile?.name ?? generatedItem?.generationId, seed });
      const response = await fetch("/api/runpod/edit", { method: "POST", body: form });
      const body = await response.json() as EquipResult & { error?: string };
      if (!response.ok) throw new Error(`${body.error || "착용 생성 실패"}${body.requestId ? ` · ${body.requestId}` : ""}`);
      setEquipResult(body);
      const historyItem: HistoryItem = { id: body.generationId, phase: "아이템 착용", imageUrl: body.imageUrl, size: body.size, seed: body.seed, status: "완료", createdAt: nowLabel() };
      setHistory((current) => [historyItem, ...current].slice(0, 8));
      setNotice(`아이템 착용 원본 생성 완료 · ${body.size} · ${(body.elapsedMs / 1000).toFixed(1)}초`);
      console.info("[AssetForge][EQUIP_REQUEST_COMPLETE]", { generationId: body.generationId, requestId: body.requestId, size: body.size, elapsedMs: body.elapsedMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "착용 생성 실패";
      setNotice(`아이템 착용 실패 · ${message}`);
      console.error("[AssetForge][EQUIP_REQUEST_FAILED]", { message });
    } finally {
      setIsEquipping(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span>AF</span><div><small>2D ASSET GENERATOR</small><h1>Asset Forge</h1></div></div>
        <div className="runpod-state" data-status={endpoint.status}><i /> <strong>RUNPOD {endpoint.status}</strong>{endpoint.latencyMs ? <span>{endpoint.latencyMs}ms</span> : null}</div>
        <button type="button" className="secondary-button" onClick={checkHealth} data-testid="check-runpod">연결 확인</button>
      </header>

      <nav className="phase-rail" aria-label="생성 단계">
        <div className="phase is-active"><span>01</span><div><strong>4방향 기준 캐릭터</strong><small>한 번의 생성 · 정면/후면/오른쪽/왼쪽</small></div></div>
        <div className={approved ? "phase is-ready" : "phase"}><span>02</span><div><strong>아이템 착용 검증</strong><small>A: 4방향 캐릭터 · B: 아이템</small></div></div>
        <div className="phase"><span>03</span><div><strong>동작 영상과 프레임</strong><small>방향별 I2V · 이후 연결</small></div></div>
      </nav>

      <div className="workspace">
        <aside className="panel controls-panel">
          <div className="panel-heading"><div><small>01 / CHARACTER INPUT</small><h2>캐릭터 조건</h2></div><button type="button" className="random-button" onClick={randomizeAll} data-testid="random-character">전체 랜덤</button></div>
          <div className="option-list">
            {CHARACTER_OPTIONS.map((group) => (
              <section className="option-field" key={group.key}>
                <div><strong>{group.label}</strong><button type="button" onClick={() => updateSelection(group.key, randomChoice(group.values).prompt)}>랜덤</button></div>
                <div className="chip-row">
                  {group.values.map((value) => <button key={value.prompt} type="button" role="checkbox" aria-checked={selections[group.key] === value.prompt} className={selections[group.key] === value.prompt ? "chip is-selected" : "chip"} onClick={() => updateSelection(group.key, value.prompt)} data-testid={`option-${group.key}-${value.label}`}>{value.label}</button>)}
                </div>
              </section>
            ))}
          </div>
          <section className="seed-field"><label htmlFor="seed">GENERATION SEED</label><input id="seed" type="number" min="0" max="2147483647" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></section>
          <section className="prompt-field"><div><label htmlFor="prompt">실제 전송 프롬프트</label><button type="button" onClick={() => setPrompt(buildPrompt(selections))}>옵션으로 복원</button></div><textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} data-testid="character-prompt" /><small>{prompt.length}자 · pixel/pixel art 지시 없음</small></section>
        </aside>

        <section className="panel result-panel">
          <div className="panel-heading"><div><small>RAW MODEL OUTPUT</small><h2>4방향 기준 캐릭터</h2></div><span className="raw-badge">후처리 없음</span></div>

          <div className="selected-summary">{selectedLabels.map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}</div>

          <section className="request-pipeline" data-testid="character-request-pipeline">
            <article><span className="source-label">실제 전송 INPUT</span><div className="blank-canvas" aria-label="1024 정사각형 흰 캔버스"><i /></div><strong>빈 흰 캔버스 1장</strong><small>1024×1024 · Edit 모델의 필수 입력</small><small>레이아웃 B가 아님</small></article>
            <b>+</b>
            <article className="prompt-card"><span className="source-label">PROMPT</span><p>{prompt}</p><strong>2×2 방향 순서 고정</strong><small>front → back → right → left</small></article>
            <b>→</b>
            <article className="output-card"><span className="source-label">RUNPOD OUTPUT</span>{sheet ? <div className="sheet-output"><img src={`${sheet.imageUrl}?v=${sheet.generationId}`} alt="RunPod가 생성한 4방향 캐릭터 원본" onLoad={(event) => console.info("[AssetForge][CHARACTER_OUTPUT_RENDERED]", { natural: `${event.currentTarget.naturalWidth}x${event.currentTarget.naturalHeight}` })} /></div> : <div className="empty-output"><span>{isGenerating ? "생성 중" : "대기"}</span><small>{isGenerating ? "RunPod 응답을 기다립니다" : "생성 결과가 여기에 표시됩니다"}</small></div>}{sheet ? <><strong>{sheet.generationId}</strong><small>{sheet.outputSize} · {(sheet.elapsedMs / 1000).toFixed(1)}초</small><a href={sheet.metadataUrl} target="_blank" rel="noreferrer">metadata JSON</a></> : null}</article>
          </section>

          <div className="direction-map" data-testid="direction-cell-order">{DIRECTIONS.map((direction) => <div key={direction.id}><span>{direction.order}</span><strong>{direction.label}</strong><small>{direction.id}</small></div>)}</div>

          <div className="generation-actions">
            <div><strong>{notice}</strong><small>{endpoint.model ?? endpoint.message ?? "연결 확인 후 생성할 수 있습니다."}</small></div>
            <div className="action-button-row"><button type="button" className="load-latest-button" onClick={loadLatestCharacterSheet} disabled={isGenerating} data-testid="load-latest-character">최근 결과</button><button type="button" onClick={generateCharacterSheet} disabled={isGenerating || endpoint.status !== "연결됨" || !prompt.trim()} data-testid="generate-character-sheet">{isGenerating ? "4방향 생성 중…" : sheet ? "다시 생성" : "4방향 캐릭터 생성"}</button></div>
          </div>

          {sheet && <section className={approved ? "approval-bar is-approved" : "approval-bar"}><div><strong>{approved ? "Reference A 승인됨" : "네 방향을 확인하세요"}</strong><small>동일 캐릭터 · 방향 순서 · 신체 전체 · 크기와 발 위치를 확인</small></div><button type="button" onClick={() => setApproved((value) => !value)} data-testid="approve-character-sheet">{approved ? "승인 취소" : "4방향 기준 A로 승인"}</button></section>}

          <section className={approved ? "equip-stage is-ready" : "equip-stage"} data-testid="equip-stage">
            <div className="equip-heading"><div><small>02 / EQUIPMENT TEST</small><h3>아이템 착용 검증</h3><p>Reference A의 네 캐릭터는 유지하고 Reference B의 아이템만 네 방향에 추가합니다.</p></div><span>{approved ? "입력 가능" : "1단계 승인 필요"}</span></div>
            <div className="equip-equation">
              <article><span>REFERENCE A</span><div>{sheet ? <img src={sheet.imageUrl} alt="승인할 4방향 캐릭터 A" /> : <small>4방향 캐릭터 대기</small>}</div><strong>{approved ? "승인한 4방향 기준" : "미승인"}</strong></article>
              <b>+</b>
              <article><span>REFERENCE B</span><label className={approved ? "item-upload" : "item-upload is-disabled"}>{itemPreview ? <img src={itemPreview} alt="선택한 아이템 B" /> : <small>아래에서 생성하거나 파일 선택</small>}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!approved} onChange={(event) => changeItem(event.target.files?.[0] ?? null)} /></label><strong>{itemFile?.name ?? generatedItem?.assetName ?? "아이템 미등록"}</strong></article>
              <b>→</b>
              <article><span>RAW OUTPUT</span><div>{equipResult ? <img src={`${equipResult.imageUrl}?v=${equipResult.generationId}`} alt="아이템을 착용한 4방향 캐릭터 원본" /> : <small>착용 결과 대기</small>}</div><strong>{equipResult?.generationId ?? "RunPod 원본"}</strong></article>
            </div>
            <div className="equip-prompt-row"><label htmlFor="equip-prompt">착용 프롬프트</label><button type="button" onClick={() => setEquipPrompt(DEFAULT_EQUIP_PROMPT)}>기본값</button><textarea id="equip-prompt" rows={3} value={equipPrompt} onChange={(event) => setEquipPrompt(event.target.value)} data-testid="equip-prompt" /><small>{equipPrompt.length}자 · 손에 한 자루만 착용</small></div>
            <button type="button" onClick={equipItem} disabled={!approved || (!itemFile && !generatedItem) || isEquipping} data-testid="generate-equipped-sheet">{isEquipping ? "착용 이미지 생성 중…" : "아이템 착용 4방향 생성"}</button>
          </section>
        </section>

        <aside className="panel history-panel">
          <div className="panel-heading"><div><small>03 / STATUS</small><h2>상태 · 히스토리</h2></div><span>{history.length}</span></div>
          <div className="status-counters"><div><strong>{isGenerating || isEquipping ? 1 : 0}</strong><small>진행</small></div><div><strong>{history.filter((item) => item.status === "완료").length}</strong><small>완료</small></div><div><strong>{history.filter((item) => item.status === "실패").length}</strong><small>실패</small></div></div>
          <div className="notice-box"><i />{notice}</div>
          <div className="history-list" data-testid="history-list">{history.length ? history.map((item) => <article key={item.id}><div className="history-thumb">{item.imageUrl ? <img src={item.imageUrl} alt={`${item.phase} 썸네일`} /> : <span>!</span>}</div><div><strong>{item.phase}</strong><small>{item.id}</small><p>{item.size} · seed {item.seed}</p><span>{item.status} · {item.createdAt}</span></div></article>) : <div className="history-empty">아직 생성 기록이 없습니다.</div>}</div>

          <section className="catalog-scope"><div><small>PLANNED ASSET SCOPE</small><h3>에셋 대분류 8종</h3></div>{ASSET_GROUPS.map((item) => <article key={item[0]} className={item[0] === "CH" ? "is-current" : ""}><span>{item[0]}</span><div><strong>{item[1]}</strong><small>{item[2]}</small></div></article>)}</section>
        </aside>
      </div>

      <section className="catalog-workbench" data-testid="catalog-workbench">
        <div className="catalog-workbench-heading">
          <div><small>BASE ASSET CATALOG</small><h2>대분류 기준 에셋 생성</h2><p>문서의 분류를 선택하고 빈 흰 캔버스에서 원본을 생성합니다. 생성 중 자동 후처리는 하지 않습니다.</p></div>
          <button type="button" className="random-button" onClick={randomizeCatalogItem} data-testid="random-base-asset">현재 분류 랜덤</button>
        </div>

        <div className="catalog-tabs" role="tablist" aria-label="기준 에셋 대분류">
          {BASE_ASSET_CATALOG.map((group) => <button key={group.id} type="button" role="tab" aria-selected={catalogCategory === group.id} className={catalogCategory === group.id ? "is-active" : ""} onClick={() => changeCatalogCategory(group.id)} data-testid={`catalog-tab-${group.id}`}><span>{group.code}</span><strong>{group.label}</strong><small>{group.summary}</small></button>)}
        </div>

        <div className="catalog-generator">
          <aside>
            <div className="catalog-list-heading"><div><small>{activeCatalog.code} / {activeCatalog.label}</small><h3>필요 목록 {activeCatalog.items.length}종</h3></div><button type="button" onClick={randomizeCatalogItem}>랜덤</button></div>
            <div className="catalog-item-grid">{activeCatalog.items.map((item) => <button key={item} type="button" role="checkbox" aria-checked={catalogItem === item} className={catalogItem === item ? "is-selected" : ""} onClick={() => changeCatalogItem(item)}>{item}</button>)}</div>
          </aside>

          <div className="catalog-request">
            <label htmlFor="catalog-prompt"><span>실제 전송 프롬프트</span><button type="button" onClick={() => setCatalogPrompt(buildBaseAssetPrompt(catalogCategory, catalogItem))}>선택값으로 복원</button></label>
            <textarea id="catalog-prompt" rows={5} value={catalogPrompt} onChange={(event) => setCatalogPrompt(event.target.value)} data-testid="base-asset-prompt" />
            <small>{catalogPrompt.length}자 · pixel/pixel art 지시 없음 · 1024×1024 원본</small>
            <div className="catalog-run-row"><div><strong>{activeCatalog.label} / {catalogItem}</strong><small>seed {seed} · 빈 흰 캔버스 1장</small></div><div className="action-button-row"><button type="button" className="load-latest-button" onClick={loadLatestBaseAsset} disabled={isGeneratingBase} data-testid="load-latest-base-asset">최근 결과</button><button type="button" onClick={generateBaseAsset} disabled={endpoint.status !== "연결됨" || isGeneratingBase || !catalogPrompt.trim()} data-testid="generate-base-asset">{isGeneratingBase ? `${activeCatalog.label} 생성 중…` : `${activeCatalog.label} 기준 생성`}</button></div></div>
          </div>

          <article className="catalog-output">
            <span>RAW RUNPOD OUTPUT</span>
            <div>{catalogResult ? <img src={`${catalogResult.imageUrl}?v=${catalogResult.generationId}`} alt={`${catalogResult.assetName} 생성 원본`} /> : <small>{isGeneratingBase ? "RunPod 응답을 기다리는 중" : "선택한 분류의 결과가 표시됩니다"}</small>}</div>
            {catalogResult && catalogCategory === "tile" ? <>
              <small className="tile-repeat-label">2×2 REPEAT CHECK · 원본 반복 표시</small>
              <div className="tile-repeat-debug" data-testid="tile-repeat-preview">
                {[0, 1, 2, 3].map((index) => <img key={index} src={`${catalogResult.imageUrl}?v=${catalogResult.generationId}`} alt="" />)}
              </div>
            </> : null}
            <strong>{catalogResult?.assetName ?? `${activeCatalog.label} 대기`}</strong>
            {catalogResult ? <><small>{catalogResult.generationId}</small><small>{catalogResult.outputSize} · {(catalogResult.elapsedMs / 1000).toFixed(1)}초</small><a href={catalogResult.metadataUrl} target="_blank" rel="noreferrer">metadata JSON</a></> : null}
          </article>
        </div>
      </section>
    </main>
  );
}
