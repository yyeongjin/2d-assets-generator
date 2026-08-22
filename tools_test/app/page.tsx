"use client";

/* eslint-disable @next/next/no-img-element -- generated local files are shown without image optimization. */

import { useEffect, useMemo, useRef, useState } from "react";

type Direction = "front" | "back" | "left" | "right";
type AssetCatalogId = "tile" | "object" | "character" | "creature" | "item" | "vfx" | "ui" | "guide";
type EndpointStatus = "꺼짐" | "확인 중" | "연결됨" | "오류";
type JobStatus = "입력 준비" | "대기열" | "처리 중" | "완료" | "실패";
type MotionProfile = "auto" | "character" | "quadruped" | "biped_animal";
type MotionBackend = "auto" | "kimodo" | "animal_procedural" | "animal_npz";
type DirectionUploadFiles = Partial<Record<Direction, File>>;

type JobState = {
  status: JobStatus;
  jobId?: string;
  outputUrl?: string;
  debugUrl?: string;
  runtimeSeconds?: number;
  error?: string;
};

type EndpointState = {
  status: EndpointStatus;
  kimodoState?: string;
  oneToAllState?: string;
  queueDepth?: number;
  characterReady?: boolean;
  animalReady?: boolean;
  message?: string;
};

type ImageEndpointState = {
  status: EndpointStatus;
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

type SelectionKey = "role" | "gender" | "age" | "body" | "hair" | "clothes" | "detail";
type CharacterSelections = Record<SelectionKey, string>;

type BaseAssetResult = {
  ok: true;
  generationId: string;
  requestId: string;
  model: string;
  createdAt: string;
  source: "generated" | "uploaded";
  category: AssetCatalogId;
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

type DirectionSplitCell = {
  direction: Direction;
  crop: { left: number; top: number; width: number; height: number };
  width: number;
  height: number;
  url: string;
  localClientPath: string;
  referencePath: string;
};

type DirectionSplitResult = {
  ok: true;
  splitId: string;
  requestId: string;
  projectId: string;
  sourceImageUrl: string;
  metadataUrl: string;
  source: { label: string; width: number; height: number; layout: "2x2"; order: Direction[] };
  directions: Record<Direction, DirectionSplitCell>;
  elapsedMs: number;
};

const DIRECTIONS = [
  { id: "front", label: "정면", code: "F", camera: "0°" },
  { id: "back", label: "후면", code: "B", camera: "180°" },
  { id: "left", label: "왼쪽", code: "L", camera: "-90°" },
  { id: "right", label: "오른쪽", code: "R", camera: "+90°" },
] as const;

const DIRECTION_SHEET_ORDER: Direction[] = ["front", "back", "right", "left"];

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

const DEFAULT_CHARACTER_SELECTIONS: CharacterSelections = {
  role: "farm worker",
  gender: "masculine",
  age: "young adult",
  body: "average height and build",
  hair: "short dark hair",
  clothes: "blue work shirt, dark trousers, brown boots",
  detail: "no accessories",
};

const PHASES = [
  "L Contact",
  "L Loading",
  "R Passing",
  "L Heel Rise",
  "R Contact",
  "R Loading",
  "L Passing",
  "R Heel Rise",
] as const;

const EXTRACT_INDICES = [0, 2, 4, 6, 8, 10, 12, 14] as const;

const ASSET_CATALOG: Array<{
  id: AssetCatalogId;
  code: string;
  label: string;
  summary: string;
  source: string;
  sourceHref: string;
  items: string[];
}> = [
  { id: "tile", code: "TL", label: "타일", summary: "지표·물·전이·길·실내", source: "타일 카탈로그", sourceHref: "/docs/TILE_CATALOG.md", items: ["잔디 center", "흙 center", "경작지", "모래", "얕은 물", "깊은 물", "해안선", "잔디-흙 전이", "절벽", "흙길", "나무 길", "돌길", "나무 다리", "계단", "실내 목재 바닥", "실내 석조 벽"] },
  { id: "object", code: "OB", label: "오브젝트", summary: "자연물·농장·설비·건물·가구", source: "오브젝트 카탈로그", sourceHref: "/docs/OBJECT_CATALOG.md", items: ["일반 나무", "과실수", "관목", "작은 돌", "큰 바위", "작물", "울타리", "울타리 문", "허수아비", "스프링클러", "상자", "작업대", "용광로", "농가", "축사", "온실", "우편함", "침대", "테이블", "의자"] },
  { id: "character", code: "CH", label: "캐릭터", summary: "플레이어·NPC·초상화·장비 레이어", source: "마스터 에셋 카탈로그", sourceHref: "/docs/ASSET_CATALOG.md#5-캐릭터", items: ["플레이어 body base", "주요 NPC", "서비스 NPC", "주민", "방문객·축제 NPC", "비인간형", "초상화", "머리 레이어", "의상 레이어", "신발 레이어", "모자·액세서리", "held item 레이어", "shadow 레이어"] },
  { id: "creature", code: "CR", label: "생명체", summary: "가축·반려동물·야생동물·몬스터", source: "마스터 에셋 카탈로그", sourceHref: "/docs/ASSET_CATALOG.md#6-동물과-몬스터", items: ["닭", "소", "양", "돼지", "개", "고양이", "새", "개구리", "물고기", "슬라임", "비행 몬스터", "사족 몬스터"] },
  { id: "item", code: "IT", label: "아이템", summary: "도구·무기·재료·음식·장비", source: "마스터 에셋 카탈로그", sourceHref: "/docs/ASSET_CATALOG.md#7-아이템-표현", items: ["괭이", "물뿌리개", "도끼", "곡괭이", "낚싯대", "낫", "망치", "한손검", "양손검", "둔기", "창", "활", "방패", "씨앗 주머니", "목재", "돌", "광석", "음식", "모자"] },
  { id: "vfx", code: "FX", label: "VFX", summary: "이동·도구·농사·환경·날씨", source: "마스터 에셋 카탈로그", sourceHref: "/docs/ASSET_CATALOG.md#8-vfx", items: ["먼지", "잔디 파편", "물 튀김", "눈 발자국", "휘두르기 궤적", "타격 불꽃", "수확 효과", "회복 효과", "비", "눈", "낙엽", "물결", "불꽃", "연기"] },
  { id: "ui", code: "UI", label: "UI", summary: "HUD·인벤토리·패널·대화·커서", source: "마스터 에셋 카탈로그", sourceHref: "/docs/ASSET_CATALOG.md#9-ui", items: ["체력 아이콘", "스태미나 아이콘", "시간 아이콘", "날씨 아이콘", "인벤토리 슬롯", "선택 슬롯", "대화 상자", "상점 패널", "제작 패널", "기본 커서", "상호작용 커서", "지도 마커", "관계 하트"] },
  { id: "guide", code: "GD", label: "가이드", summary: "규격·방향·동작·점유·autotile", source: "마스터 에셋 카탈로그", sourceHref: "/docs/ASSET_CATALOG.md#10-생성-가이드-라이브러리", items: ["1x1 점유", "1x2 점유", "2x1 점유", "2x2 점유", "3x2 점유", "4방향 배치", "걷기 접촉 포즈", "한손 무기 포즈", "양손 무기 포즈", "도구 휘두르기 포즈", "활쏘기 포즈", "타일 edge-corner guide"] },
];

const DEFAULT_MOTION_PROMPT = "Create one natural, seamless in-place walk cycle. Keep the supplied character identity, clothing, colors, proportions, scale, framing, and ground baseline consistent across all four directions.";

function buildAssetPrompt(category: AssetCatalogId, item: string) {
  const subject = item.trim();
  if (category === "tile") return `Create one clean seamless square top-down 2D game tile for ${subject}. Fill the full canvas edge to edge. Orthographic top-down view, plain even lighting, no text, no border.`;
  if (category === "object") return `Create one clean 2D game asset for ${subject}. Straight-on front view, centered full object, plain white background, consistent neutral lighting, no text, no border.`;
  if (category === "character") return `Create one clean full-body 2D game character base asset for ${subject}. Strict orthographic front view, neutral standing pose, centered on a plain white background, same ground baseline, no text, no border.`;
  if (category === "creature") return `Create one clean full-body 2D game creature asset for ${subject}. Strict side view, neutral standing pose, centered on a plain white background, feet on one ground baseline, no text, no border.`;
  if (category === "item") return `Create one clean isolated 2D game item icon for ${subject}. Front-facing readable silhouette, centered on a plain white background, no text, no border.`;
  if (category === "vfx") return `Create one clean isolated 2D game VFX asset for ${subject}. Centered on a plain white background with a clear readable silhouette, no text, no border.`;
  if (category === "ui") return `Create one clean 2D game UI asset for ${subject}. Centered, flat front view, plain white background, no text outside the asset, no border.`;
  return `Create the black outline generation guide for ${subject} on a plain white canvas. Keep every line inside the canvas and use no fill, label, or decoration.`;
}

function buildCharacterPrompt(selections: CharacterSelections) {
  const description = Object.values(selections).join(", ");
  return [
    `Create one 2x2 turnaround sheet of one full-body ${description} on a plain white background.`,
    "Top-left: front view. Top-right: back view. Bottom-left: right profile facing right. Bottom-right: left profile facing left.",
    "Show each character head-to-toe at equal height with feet on the same line.",
    "Keep identity, clothes, colors, and proportions identical. No text, borders, handheld items, shadows, or cropping.",
  ].join(" ");
}

function randomChoice<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export default function Home() {
  const [projectId, setProjectId] = useState("character-001");
  const [activeDirection, setActiveDirection] = useState<Direction>("front");
  const [assetCatalogId, setAssetCatalogId] = useState<AssetCatalogId>("tile");
  const [directionUploadFiles, setDirectionUploadFiles] = useState<DirectionUploadFiles>({});
  const [directionUploadPreviewUrls, setDirectionUploadPreviewUrls] = useState<Partial<Record<Direction, string>>>({});
  const directionPreviewUrlsRef = useRef<Partial<Record<Direction, string>>>({});
  const [motionPrompt, setMotionPrompt] = useState(DEFAULT_MOTION_PROMPT);
  const [motionProfile, setMotionProfile] = useState<MotionProfile>("auto");
  const [motionBackend, setMotionBackend] = useState<MotionBackend>("auto");
  const [motionNpzFile, setMotionNpzFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobState>({ status: "입력 준비" });
  const [endpoint, setEndpoint] = useState<EndpointState>({ status: "꺼짐" });
  const [imageEndpoint, setImageEndpoint] = useState<ImageEndpointState>({ status: "꺼짐" });
  const [notice, setNotice] = useState("정면·후면·왼쪽·오른쪽 RGB 이미지 네 장을 한 작업으로 RunPod endpoint에 전송합니다.");
  const [submitting, setSubmitting] = useState(false);
  const [seed, setSeed] = useState(4821);
  const [assetCatalogItem, setAssetCatalogItem] = useState(ASSET_CATALOG[0].items[0]);
  const [assetPrompt, setAssetPrompt] = useState(() => buildAssetPrompt("tile", ASSET_CATALOG[0].items[0]));
  const [assetResult, setAssetResult] = useState<BaseAssetResult | null>(null);
  const [assetInventory, setAssetInventory] = useState<BaseAssetResult[]>([]);
  const [assetNotice, setAssetNotice] = useState("항목을 선택하고 이미지 endpoint를 확인하세요. 가이드는 로컬에서 바로 생성됩니다.");
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [assetUploadFile, setAssetUploadFile] = useState<File | null>(null);
  const [directionSheetFile, setDirectionSheetFile] = useState<File | null>(null);
  const [directionSheetPreviewUrl, setDirectionSheetPreviewUrl] = useState("");
  const [directionSheetSourceMode, setDirectionSheetSourceMode] = useState<"inventory" | "upload">("inventory");
  const [directionSheetInventory, setDirectionSheetInventory] = useState<BaseAssetResult[]>([]);
  const [directionSheetInventoryId, setDirectionSheetInventoryId] = useState("");
  const [directionSplit, setDirectionSplit] = useState<DirectionSplitResult | null>(null);
  const [splittingDirections, setSplittingDirections] = useState(false);
  const [directionSplitNotice, setDirectionSplitNotice] = useState("2×2 시트를 선택하면 좌상 정면 · 우상 후면 · 좌하 오른쪽 · 우하 왼쪽으로 분할합니다.");
  const [characterSelections, setCharacterSelections] = useState<CharacterSelections>(DEFAULT_CHARACTER_SELECTIONS);
  const [characterPrompt, setCharacterPrompt] = useState(() => buildCharacterPrompt(DEFAULT_CHARACTER_SELECTIONS));
  const [characterSeed, setCharacterSeed] = useState(4821);
  const [characterSheet, setCharacterSheet] = useState<CharacterSheetResult | null>(null);
  const [characterNotice, setCharacterNotice] = useState("조건을 선택하거나 전체 랜덤으로 조합한 뒤 이미지 endpoint에 4방향 시트를 요청하세요.");
  const [generatingCharacter, setGeneratingCharacter] = useState(false);

  const selectedAssetCatalog = useMemo(
    () => ASSET_CATALOG.find((catalog) => catalog.id === assetCatalogId) ?? ASSET_CATALOG[0],
    [assetCatalogId],
  );
  const selectedCharacterLabels = useMemo(() => CHARACTER_OPTIONS.map((group) => {
    const selected = group.values.find((value) => value.prompt === characterSelections[group.key]);
    return { label: group.label, value: selected?.label ?? characterSelections[group.key] };
  }), [characterSelections]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/runpod/asset?category=${encodeURIComponent(assetCatalogId)}&inventory=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { ok?: boolean; items?: BaseAssetResult[]; error?: string };
        if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
        setAssetInventory(body.items ?? []);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAssetNotice(`인벤토리 조회 실패 · ${error instanceof Error ? error.message : "unknown"}`);
      });
    return () => controller.abort();
  }, [assetCatalogId]);

  useEffect(() => () => {
    if (directionSheetPreviewUrl) URL.revokeObjectURL(directionSheetPreviewUrl);
  }, [directionSheetPreviewUrl]);

  useEffect(() => () => {
    Object.values(directionPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(["character", "creature"].map(async (category) => {
      const response = await fetch(`/api/runpod/asset?category=${category}&inventory=1`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { ok?: boolean; items?: BaseAssetResult[]; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body.items ?? [];
    }).concat((async () => {
      const response = await fetch("/api/assets/split-directions?inventory=1", { cache: "no-store", signal: controller.signal });
      const body = await response.json() as { ok?: boolean; items?: BaseAssetResult[]; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body.items ?? [];
    })()))
      .then(([characters, creatures, legacySheets]) => {
        const items = Array.from(new Map([...legacySheets, ...characters, ...creatures].map((item) => [item.generationId, item])).values());
        setDirectionSheetInventory(items);
        setDirectionSheetInventoryId((current) => items.some((item) => item.generationId === current) ? current : items[0]?.generationId ?? "");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDirectionSplitNotice(`4방향 후보 인벤토리 조회 실패 · ${error instanceof Error ? error.message : "unknown"}`);
      });
    return () => controller.abort();
  }, []);

  function updateCharacterSelection(key: SelectionKey, value: string) {
    const next = { ...characterSelections, [key]: value };
    setCharacterSelections(next);
    setCharacterPrompt(buildCharacterPrompt(next));
    setCharacterNotice("선택한 캐릭터 조건을 실제 전송 프롬프트에 반영했습니다.");
  }

  function randomizeAllCharacterOptions() {
    const next = CHARACTER_OPTIONS.reduce((current, group) => ({
      ...current,
      [group.key]: randomChoice(group.values).prompt,
    }), {} as CharacterSelections);
    setCharacterSelections(next);
    setCharacterPrompt(buildCharacterPrompt(next));
    setCharacterSeed(Math.floor(Math.random() * 2_147_483_647));
    setCharacterNotice("캐릭터 조건과 seed를 전부 랜덤 선택했습니다.");
  }

  function selectStoredCharacter(result: BaseAssetResult) {
    setCharacterSheet({
      ok: true,
      generationId: result.generationId,
      requestId: result.requestId,
      model: result.model,
      prompt: result.prompt,
      seed: result.seed,
      inputImageUrl: result.inputImageUrl,
      imageUrl: result.imageUrl,
      metadataUrl: result.metadataUrl,
      inputSize: result.inputSize,
      outputSize: result.outputSize,
      elapsedMs: result.elapsedMs,
      cells: ["front", "back", "right", "left"],
      postprocessed: false,
    });
    setDirectionSheetInventoryId(result.generationId);
    setDirectionSheetSourceMode("inventory");
    setCharacterNotice(`${result.generationId} 캐릭터를 열고 4방향 분할 대상으로 선택했습니다. 현재 생성 조건과 프롬프트는 유지됩니다.`);
  }

  async function checkCharacterImageEndpoint() {
    setImageEndpoint({ status: "확인 중" });
    setCharacterNotice("캐릭터 생성용 이미지 endpoint를 확인 중입니다.");
    try {
      const response = await fetch("/api/runpod/health", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; model?: string; latencyMs?: number; message?: string; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
      setImageEndpoint({ status: "연결됨", model: body.model, latencyMs: body.latencyMs });
      setCharacterNotice(`이미지 endpoint 연결 완료 · ${body.model ?? "model 확인됨"} · ${body.latencyMs ?? 0}ms`);
      console.info("[CHARACTER_CONSOLE][HEALTH_OK]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "이미지 endpoint 연결 실패";
      setImageEndpoint({ status: "오류", message });
      setCharacterNotice(`이미지 endpoint 연결 실패 · ${message}`);
      console.error("[CHARACTER_CONSOLE][HEALTH_FAILED]", { message });
    }
  }

  async function generateCharacterSheet() {
    if (generatingCharacter || !characterPrompt.trim()) return;
    if (imageEndpoint.status !== "연결됨") {
      setCharacterNotice("먼저 이미지 endpoint 연결을 확인하세요.");
      return;
    }
    setGeneratingCharacter(true);
    setCharacterNotice("빈 흰 캔버스와 현재 프롬프트를 전송했습니다. 4방향 원본 응답을 기다리는 중입니다.");
    try {
      const response = await fetch("/api/runpod/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: characterPrompt, seed: characterSeed, size: "1024x1024" }),
      });
      const body = await response.json() as CharacterSheetResult & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const roleLabel = selectedCharacterLabels.find((item) => item.label === "역할")?.value ?? "캐릭터";
      const inventoryResult: BaseAssetResult = {
        ok: true,
        generationId: body.generationId,
        requestId: body.requestId,
        model: body.model,
        createdAt: new Date().toISOString(),
        source: "generated",
        category: "character",
        assetName: `${roleLabel} 4방향 캐릭터`,
        prompt: body.prompt,
        seed: body.seed,
        inputImageUrl: body.inputImageUrl,
        imageUrl: body.imageUrl,
        metadataUrl: body.metadataUrl,
        inputSize: body.inputSize,
        outputSize: body.outputSize,
        elapsedMs: body.elapsedMs,
        postprocessed: false,
      };
      setCharacterSheet(body);
      setDirectionSheetInventory((current) => [inventoryResult, ...current.filter((item) => item.generationId !== inventoryResult.generationId)]);
      setDirectionSheetInventoryId(inventoryResult.generationId);
      setDirectionSheetSourceMode("inventory");
      setCharacterNotice(`4방향 캐릭터 생성 완료 · ${body.outputSize} · 인벤토리 저장 및 분할 대상으로 선택됨`);
      console.info("[CHARACTER_CONSOLE][GENERATION_COMPLETE]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "4방향 캐릭터 생성 실패";
      setCharacterNotice(`4방향 캐릭터 생성 실패 · ${message}`);
      console.error("[CHARACTER_CONSOLE][GENERATION_FAILED]", { message });
    } finally {
      setGeneratingCharacter(false);
    }
  }

  function selectAssetCatalog(category: AssetCatalogId) {
    const catalog = ASSET_CATALOG.find((item) => item.id === category) ?? ASSET_CATALOG[0];
    const firstItem = catalog.items[0];
    setAssetCatalogId(category);
    setAssetInventory([]);
    setAssetCatalogItem(firstItem);
    setAssetPrompt(buildAssetPrompt(category, firstItem));
    setAssetResult(null);
    setAssetNotice(`${catalog.label} 첫 항목을 선택했습니다. 표의 각 행에서 다른 항목을 고를 수 있습니다.`);
  }

  function selectAssetItem(item: string) {
    setAssetCatalogItem(item);
    setAssetPrompt(buildAssetPrompt(assetCatalogId, item));
    const stored = assetInventory.find((result) => result.assetName === item) ?? null;
    setAssetResult(stored);
    setAssetNotice(stored ? `${item}의 최근 저장 결과를 열었습니다.` : `${item} 생성 설정을 열었습니다. 프롬프트를 수정한 뒤 생성하세요.`);
  }

  function randomizeAssetItem() {
    const item = selectedAssetCatalog.items[Math.floor(Math.random() * selectedAssetCatalog.items.length)];
    selectAssetItem(item);
    setSeed(Math.floor(Math.random() * 2_147_483_647));
  }

  async function checkImageEndpoint() {
    setImageEndpoint({ status: "확인 중" });
    setAssetNotice("기준 에셋 이미지 endpoint를 확인 중입니다.");
    try {
      const response = await fetch("/api/runpod/health", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; model?: string; latencyMs?: number; message?: string; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
      setImageEndpoint({ status: "연결됨", model: body.model, latencyMs: body.latencyMs });
      setAssetNotice(`이미지 endpoint 연결 완료 · ${body.model ?? "model 확인됨"} · ${body.latencyMs ?? 0}ms`);
      console.info("[ASSET_CONSOLE][HEALTH_OK]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "이미지 endpoint 연결 실패";
      setImageEndpoint({ status: "오류", message });
      setAssetNotice(`이미지 endpoint 연결 실패 · ${message}`);
      console.error("[ASSET_CONSOLE][HEALTH_FAILED]", { message });
    }
  }

  async function generateCatalogAsset() {
    if (generatingAsset || !assetPrompt.trim()) return;
    if (assetCatalogId !== "guide" && imageEndpoint.status !== "연결됨") {
      setAssetNotice("먼저 이미지 endpoint 연결을 확인하세요.");
      return;
    }
    setGeneratingAsset(true);
    setAssetNotice(`${assetCatalogItem} 생성 요청 중입니다.`);
    try {
      const response = await fetch("/api/runpod/asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: assetCatalogId,
          assetName: assetCatalogItem,
          prompt: assetPrompt,
          seed,
          size: "1024x1024",
        }),
      });
      const body = await response.json() as BaseAssetResult & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setAssetResult(body);
      setAssetInventory((current) => [body, ...current.filter((item) => item.generationId !== body.generationId)]);
      if (body.category === "character" || body.category === "creature") {
        setDirectionSheetInventory((current) => [body, ...current.filter((item) => item.generationId !== body.generationId)]);
        setDirectionSheetInventoryId(body.generationId);
        setDirectionSheetSourceMode("inventory");
      }
      setAssetNotice(`${body.assetName} 생성 완료 · ${body.outputSize} · ${(body.elapsedMs / 1000).toFixed(1)}초`);
      console.info("[ASSET_CONSOLE][GENERATION_COMPLETE]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "기준 에셋 생성 실패";
      setAssetNotice(`${assetCatalogItem} 생성 실패 · ${message}`);
      console.error("[ASSET_CONSOLE][GENERATION_FAILED]", { category: assetCatalogId, assetName: assetCatalogItem, message });
    } finally {
      setGeneratingAsset(false);
    }
  }

  async function uploadCatalogAsset() {
    if (!assetUploadFile || uploadingAsset) {
      setAssetNotice("먼저 이 항목에 저장할 이미지 파일을 선택하세요.");
      return;
    }
    setUploadingAsset(true);
    setAssetNotice(`${assetCatalogItem} 이미지 업로드 중입니다.`);
    try {
      const formData = new FormData();
      formData.set("category", assetCatalogId);
      formData.set("assetName", assetCatalogItem);
      formData.set("file", assetUploadFile);
      const response = await fetch("/api/runpod/asset", { method: "PUT", body: formData });
      const body = await response.json() as BaseAssetResult & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setAssetInventory((current) => [body, ...current.filter((item) => item.generationId !== body.generationId)]);
      setAssetResult(body);
      if (body.category === "character" || body.category === "creature") {
        setDirectionSheetInventory((current) => [body, ...current.filter((item) => item.generationId !== body.generationId)]);
        setDirectionSheetInventoryId(body.generationId);
        setDirectionSheetSourceMode("inventory");
      }
      setAssetUploadFile(null);
      setAssetNotice(`${body.assetName}에 업로드한 이미지를 저장했습니다.`);
    } catch (error) {
      setAssetNotice(`이미지 업로드 실패 · ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setUploadingAsset(false);
    }
  }

  async function removeInventoryAsset(result: BaseAssetResult) {
    if (!window.confirm(`${result.assetName}의 ${result.generationId} 결과와 입력·JSON 기록을 제거할까요?`)) return;
    try {
      const response = await fetch("/api/runpod/asset", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: result.category, generationId: result.generationId }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setAssetInventory((current) => current.filter((item) => item.generationId !== result.generationId));
      const remainingDirectionSheets = directionSheetInventory.filter((item) => item.generationId !== result.generationId);
      setDirectionSheetInventory(remainingDirectionSheets);
      if (directionSheetInventoryId === result.generationId) setDirectionSheetInventoryId(remainingDirectionSheets[0]?.generationId ?? "");
      if (assetResult?.generationId === result.generationId) setAssetResult(null);
      setAssetNotice(`${result.assetName} 결과를 인벤토리에서 제거했습니다.`);
    } catch (error) {
      setAssetNotice(`인벤토리 제거 실패 · ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  async function splitDirectionSheet(source: "upload" | "inventory") {
    const inventorySource = directionSheetInventory.find((item) => item.generationId === directionSheetInventoryId) ?? null;
    if (source === "upload" && !directionSheetFile) {
      setDirectionSplitNotice("먼저 2×2 4방향 시트 파일을 선택하세요.");
      return;
    }
    if (source === "inventory" && !inventorySource) {
      setDirectionSplitNotice("캐릭터 또는 생명체 인벤토리에서 4방향 시트를 먼저 선택하세요.");
      return;
    }
    setSplittingDirections(true);
    setDirectionSplitNotice("4방향 시트를 중앙 기준으로 분할하고 있습니다.");
    try {
      const form = new FormData();
      form.set("projectId", projectId);
      if (source === "upload" && directionSheetFile) form.set("file", directionSheetFile);
      if (source === "inventory" && inventorySource) form.set("imageUrl", inventorySource.imageUrl);
      const response = await fetch("/api/assets/split-directions", { method: "POST", body: form });
      const body = await response.json() as DirectionSplitResult & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setDirectionSplit(body);
      setJob({ status: "입력 준비" });
      setActiveDirection("front");
      setDirectionSplitNotice(`${body.source.width}×${body.source.height} 시트를 정면·후면·왼쪽·오른쪽 RGB 네 장으로 분할했습니다.`);
      setNotice(`${body.splitId} 분할 완료 · 네 방향 이미지가 단일 동작 요청 입력에 연결됐습니다.`);
      console.info("[MOTION_PIPELINE][DIRECTION_SPLIT_COMPLETE]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "4방향 시트 분할 실패";
      setDirectionSplitNotice(`분할 실패 · ${message}`);
      console.error("[MOTION_PIPELINE][DIRECTION_SPLIT_FAILED]", { message });
    } finally {
      setSplittingDirections(false);
    }
  }

  function resetMotionRequest() {
    Object.values(directionPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    directionPreviewUrlsRef.current = {};
    setDirectionUploadFiles({});
    setDirectionUploadPreviewUrls({});
    setMotionNpzFile(null);
    setJob({ status: "입력 준비" });
    setNotice(`${projectId || "CHARACTER_ID"} 명시적 업로드와 동물 NPZ를 초기화했습니다. 분할된 네 방향 이미지는 계속 사용할 수 있습니다.`);
  }

  function updateDirectionUpload(direction: Direction, file: File | null) {
    setDirectionUploadFiles((current) => {
      const next = { ...current };
      if (file) next[direction] = file;
      else delete next[direction];
      return next;
    });
    setDirectionUploadPreviewUrls((current) => {
      const previous = current[direction];
      if (previous) URL.revokeObjectURL(previous);
      const next = { ...current };
      if (file) next[direction] = URL.createObjectURL(file);
      else delete next[direction];
      directionPreviewUrlsRef.current = next;
      return next;
    });
    setJob({ status: "입력 준비" });
  }

  async function resolveDirectionImage(direction: Direction): Promise<File> {
    const selectedFile = directionUploadFiles[direction];
    if (selectedFile) return selectedFile;

    const splitCell = directionSplit?.directions[direction];
    if (splitCell) {
      const response = await fetch(splitCell.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${direction} RGB 이미지를 읽지 못했습니다.`);
      const blob = await response.blob();
      return new File([blob], `${direction}.png`, { type: blob.type || "image/png" });
    }

    throw new Error(`${DIRECTIONS.find((item) => item.id === direction)?.label} 이미지를 선택하세요.`);
  }

  async function checkHealth() {
    setEndpoint({ status: "확인 중" });
    setNotice("V9 동물·캐릭터 motion worker와 One-to-All GPU queue 상태를 확인 중입니다.");
    try {
      const response = await fetch("/api/motion-pipeline/health", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; kimodo_state?: string; one_to_all_state?: string; character_ready?: boolean; animal_ready?: boolean; queue_depth?: number; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setEndpoint({
        status: "연결됨",
        kimodoState: body.kimodo_state,
        oneToAllState: body.one_to_all_state,
        characterReady: Boolean(body.character_ready),
        animalReady: Boolean(body.animal_ready),
        queueDepth: body.queue_depth,
      });
      setNotice(`Pod 연결 완료 · 사람 ${body.character_ready ? "ready" : "down"} · 동물 ${body.animal_ready ? "ready" : "down"} · queue ${body.queue_depth ?? 0}`);
      console.info("[MOTION_PIPELINE][HEALTH_OK]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pod 연결 실패";
      setEndpoint({ status: "오류", message });
      setNotice(`Pod 연결 실패 · ${message}`);
      console.error("[MOTION_PIPELINE][HEALTH_FAILED]", { message });
    }
  }

  async function pollJob(jobId: string) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      try {
        const response = await fetch(`/api/motion-pipeline/jobs/${jobId}`, { cache: "no-store" });
        const body = await response.json() as {
          status?: string;
          stage?: string;
          output_url?: string;
          result_url?: string;
          debug_url?: string;
          runtime_seconds?: number;
          error?: string | { code?: string; message?: string };
        };
        const apiError = typeof body.error === "string"
          ? body.error
          : body.error?.message || body.error?.code;
        if (!response.ok) throw new Error(apiError || `HTTP ${response.status}`);
        const status: JobStatus = body.status === "completed" || body.status === "succeeded"
          ? "완료"
          : body.status === "failed"
            ? "실패"
            : body.status === "running" || body.status === "processing"
              ? "처리 중"
              : "대기열";
        setJob((current) => ({
          ...current,
          status,
          outputUrl: body.status === "completed" || body.status === "succeeded"
            ? `/api/motion-pipeline/jobs/${jobId}/output`
            : undefined,
          debugUrl: body.status === "failed" && body.debug_url
            ? `/api/motion-pipeline/jobs/${jobId}/debug`
            : undefined,
          runtimeSeconds: body.runtime_seconds,
          error: apiError,
        }));
        if (status === "처리 중" && body.stage) setNotice(`${jobId} · ${body.stage}`);
        if (status === "완료" || status === "실패") {
          setNotice(`4방향 동작 작업 ${status}.${status === "완료" ? " result.zip을 이 화면에서 내려받을 수 있습니다." : ""}`);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "작업 조회 실패";
        setJob((current) => ({ ...current, status: "실패", error: message }));
        setNotice(`작업 조회 실패 · ${message}`);
        return;
      }
    }
  }

  async function submitMotionJob() {
    if (submitting || endpoint.status !== "연결됨") return;
    setSubmitting(true);
    setNotice("네 방향 RGB 이미지를 하나의 동작 생성 작업으로 등록합니다.");
    setJob({ status: "대기열" });
    try {
      const form = new FormData();
      for (const direction of DIRECTIONS) form.set(direction.id, await resolveDirectionImage(direction.id));
      form.set("action", "walk");
      form.set("prompt", motionPrompt);
      form.set("subject_profile", motionProfile);
      form.set("motion_backend", motionBackend);
      if (motionNpzFile) form.set("motion_npz", motionNpzFile);
      form.set("seed", String(seed));
      const response = await fetch("/api/motion-pipeline/jobs", {
        method: "POST",
        body: form,
      });
      const body = await response.json() as { job_id?: string; error?: string };
      if (!response.ok || !body.job_id) throw new Error(body.error || "작업 등록 실패");
      setJob({ status: "대기열", jobId: body.job_id });
      console.info("[MOTION_PIPELINE][JOB_QUEUED]", { jobId: body.job_id });
      void pollJob(body.job_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "작업 등록 실패";
      setJob({ status: "실패", error: message });
      setNotice(`4방향 작업 등록 실패 · ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteRemoteJob() {
    if (!job.jobId || !["완료", "실패"].includes(job.status)) return;
    if (job.outputUrl && !window.confirm("result.zip을 로컬에 저장했나요? 삭제하면 RunPod 결과를 다시 받을 수 없습니다.")) return;
    try {
      const response = await fetch(`/api/motion-pipeline/jobs/${job.jobId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json() as { error?: string; detail?: string };
        throw new Error(body.error || body.detail || `HTTP ${response.status}`);
      }
      setJob({ status: "입력 준비" });
      setNotice("RunPod의 4방향 입력과 결과 임시 파일을 삭제했습니다.");
      console.info("[MOTION_PIPELINE][REMOTE_JOB_DELETED]", { jobId: job.jobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "RunPod 작업 삭제 실패";
      setNotice(`RunPod 작업 삭제 실패 · ${message}`);
      console.error("[MOTION_PIPELINE][REMOTE_JOB_DELETE_FAILED]", { jobId: job.jobId, message });
    }
  }

  function downloadManifest() {
    const payload = {
      project_id: projectId,
      inputs: Object.fromEntries(DIRECTIONS.map((direction) => [direction.id,
        directionSplit?.directions[direction.id].localClientPath ?? `inputs/${projectId}/${direction.id}.png`,
      ])),
      request: {
        action: "walk",
        subject_profile: motionProfile,
        motion_backend: motionBackend,
        motion_npz: motionNpzFile?.name ?? null,
        prompt: motionPrompt,
        seed,
      },
      expected_output: { archive: "result.zip", directions: 4, frames_per_direction: 8, total_png: 32 },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectId || "motion-pipeline"}-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const profileBackendCompatible = motionProfile === "character"
    ? ["auto", "kimodo"].includes(motionBackend) && !motionNpzFile
    : motionProfile === "auto"
      ? motionBackend !== "kimodo" || !motionNpzFile
      : motionBackend !== "kimodo";
  const npzRequirementMet = motionBackend !== "animal_npz" || Boolean(motionNpzFile);
  const selectedRouteReady = motionProfile === "character" || motionBackend === "kimodo"
    ? Boolean(endpoint.characterReady)
    : ["quadruped", "biped_animal"].includes(motionProfile) || ["animal_procedural", "animal_npz"].includes(motionBackend)
      ? Boolean(endpoint.animalReady)
      : Boolean(endpoint.characterReady || endpoint.animalReady);
  const canSubmit = Boolean(
    motionPrompt.trim()
    && profileBackendCompatible
    && npzRequirementMet
    && selectedRouteReady
    && DIRECTIONS.every((direction) => directionUploadFiles[direction.id] || directionSplit?.directions[direction.id]),
  );
  const selectedItemInventory = assetInventory.filter((result) => result.assetName === assetCatalogItem);
  const storedCharacterSheets = directionSheetInventory.filter((item) => item.category === "character" && item.imageUrl.startsWith("/generated/character-sheets/"));
  const selectedInventoryDirectionSheet = directionSheetInventory.find((item) => item.generationId === directionSheetInventoryId) ?? null;
  const directionSheetSourceUrl = directionSheetSourceMode === "inventory"
    ? selectedInventoryDirectionSheet?.imageUrl ?? directionSheetPreviewUrl
    : directionSheetPreviewUrl || selectedInventoryDirectionSheet?.imageUrl;

  return (
    <main className="app-shell scail-console">
      <header className="topbar scail-console-topbar">
        <div className="brand"><span>M4</span><div><small>LOCAL 4-DIRECTION MOTION CLIENT</small><h1>Asset Motion Workbench</h1></div></div>
        <div className="topology-title">browser / local Next proxy / resident GPU workers</div>
        <div className="endpoint-cluster"><div className="runpod-state" data-status={endpoint.status}><i /><strong>MOTION POD {endpoint.status}</strong></div><button type="button" className="secondary-button" onClick={checkHealth} data-testid="check-motion-pipeline">Pod 연결 확인</button></div>
      </header>

      <nav className="phase-rail" aria-label="production stages">
        <div className="phase is-ready"><span>01</span><div><strong>4방향 RGB</strong><small>front · back · left · right</small></div></div>
        <div className="phase is-active"><span>02</span><div><strong>Motion Routing</strong><small>Kimodo · animal NPZ</small></div></div>
        <div className="phase"><span>03</span><div><strong>Profile Adapter</strong><small>V8 human · V9 animal</small></div></div>
        <div className="phase"><span>04</span><div><strong>One-to-All + Pack</strong><small>4×8 = 32 PNG</small></div></div>
      </nav>

      <section className="architecture-map" data-testid="architecture-map">
        <article><small>LOCAL CLIENT</small><strong>4 direction images</strong><span>한 multipart 요청 · same-origin proxy</span></article><b>→</b>
        <article className="is-primary"><small>RUNPOD 48GB</small><strong>Kimodo + One-to-All resident</strong><span>FastAPI :8000 · GPU concurrency 1</span></article><b>→</b>
        <article><small>RESULT ENDPOINT</small><strong>client downloads result.zip</strong><span>4 folders · 8 frames · 32 PNG</span></article>
      </section>

      <section className="character-generator-workbench" data-testid="character-generator">
        <header className="character-generator-heading">
          <div><small>CHARACTER BASE ASSET GENERATOR</small><h2>캐릭터 조건 · 랜덤 4방향 생성</h2><p>역할과 외형을 직접 고르거나 랜덤 조합합니다. 생성된 2×2 시트는 캐릭터 인벤토리에 저장되고 다음 분할 단계에서 바로 선택됩니다.</p></div>
          <div><span data-status={imageEndpoint.status}>IMAGE {imageEndpoint.status}</span><button type="button" onClick={checkCharacterImageEndpoint} disabled={imageEndpoint.status === "확인 중"} data-testid="check-character-endpoint">{imageEndpoint.status === "확인 중" ? "확인 중…" : "이미지 endpoint 확인"}</button></div>
        </header>
        <div className="character-generator-grid">
          <aside className="panel controls-panel">
            <div className="panel-heading"><div><small>01 / CHARACTER INPUT</small><h2>캐릭터 조건</h2></div><button type="button" className="random-button" onClick={randomizeAllCharacterOptions} data-testid="random-character">전체 랜덤</button></div>
            <div className="option-list">
              {CHARACTER_OPTIONS.map((group) => <section className="option-field" key={group.key}>
                <div><strong>{group.label}</strong><button type="button" onClick={() => updateCharacterSelection(group.key, randomChoice(group.values).prompt)} data-testid={`random-character-${group.key}`}>랜덤</button></div>
                <div className="chip-row">{group.values.map((value) => <button key={value.prompt} type="button" role="checkbox" aria-checked={characterSelections[group.key] === value.prompt} className={characterSelections[group.key] === value.prompt ? "chip is-selected" : "chip"} onClick={() => updateCharacterSelection(group.key, value.prompt)} data-testid={`option-${group.key}-${value.label}`}>{value.label}</button>)}</div>
              </section>)}
            </div>
            <section className="seed-field"><label htmlFor="character-seed">GENERATION SEED</label><input id="character-seed" type="number" min="0" max="2147483647" value={characterSeed} onChange={(event) => setCharacterSeed(Number(event.target.value))} /></section>
            <section className="prompt-field"><div><label htmlFor="character-prompt">실제 전송 프롬프트</label><button type="button" onClick={() => setCharacterPrompt(buildCharacterPrompt(characterSelections))}>옵션으로 복원</button></div><textarea id="character-prompt" value={characterPrompt} onChange={(event) => setCharacterPrompt(event.target.value)} rows={8} data-testid="character-prompt" /><small>{characterPrompt.length}자 · 생성 전 직접 수정 가능</small></section>
          </aside>

          <section className="panel result-panel">
            <div className="panel-heading"><div><small>RAW MODEL OUTPUT</small><h2>4방향 기준 캐릭터</h2></div><span className="raw-badge">후처리 없음</span></div>
            <div className="selected-summary">{selectedCharacterLabels.map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}</div>
            <section className="request-pipeline" data-testid="character-request-pipeline">
              <article><span className="source-label">실제 전송 INPUT</span><div className="blank-canvas" aria-label="1024 정사각형 흰 캔버스"><i /></div><strong>빈 흰 캔버스 1장</strong><small>1024×1024 · 이미지 편집 입력</small><small>별도 레이아웃 이미지는 사용하지 않음</small></article>
              <b>+</b>
              <article className="prompt-card"><span className="source-label">PROMPT</span><p>{characterPrompt}</p><strong>2×2 방향 순서 고정</strong><small>front → back → right → left</small></article>
              <b>→</b>
              <article className="output-card"><span className="source-label">RUNPOD OUTPUT</span>{characterSheet ? <div className="sheet-output"><img src={`${characterSheet.imageUrl}?v=${characterSheet.generationId}`} alt="생성된 4방향 캐릭터 원본" /></div> : <div className="empty-output"><span>{generatingCharacter ? "생성 중" : "대기"}</span><small>{generatingCharacter ? "RunPod 응답을 기다립니다" : "생성 결과가 여기에 표시됩니다"}</small></div>}{characterSheet ? <><strong>{characterSheet.generationId}</strong><small>{characterSheet.outputSize} · {(characterSheet.elapsedMs / 1000).toFixed(1)}초</small><a href={characterSheet.metadataUrl} target="_blank" rel="noreferrer">metadata JSON</a></> : null}</article>
            </section>
            <div className="direction-map" data-testid="direction-cell-order">
              {[{ cell: "TL", label: "정면", id: "front" }, { cell: "TR", label: "후면", id: "back" }, { cell: "BL", label: "오른쪽", id: "right" }, { cell: "BR", label: "왼쪽", id: "left" }].map((direction) => <div key={direction.id}><span>{direction.cell}</span><strong>{direction.label}</strong><small>{direction.id}</small></div>)}
            </div>
            <div className="generation-actions"><div><strong>{characterNotice}</strong><small>{imageEndpoint.model ?? imageEndpoint.message ?? "연결 확인 후 생성할 수 있습니다."}</small></div><button type="button" onClick={generateCharacterSheet} disabled={generatingCharacter || imageEndpoint.status !== "연결됨" || !characterPrompt.trim()} data-testid="generate-character-sheet">{generatingCharacter ? "4방향 생성 중…" : "4방향 캐릭터 생성"}</button></div>
            <section className="character-sheet-inventory" data-testid="character-sheet-inventory">
              <header><div><small>SAVED CHARACTER SHEETS</small><strong>만든 캐릭터</strong></div><span>{storedCharacterSheets.length}장</span></header>
              {storedCharacterSheets.length ? <div>{storedCharacterSheets.map((result) => <button type="button" key={result.generationId} className={directionSheetInventoryId === result.generationId ? "is-selected" : ""} onClick={() => selectStoredCharacter(result)} data-testid={`select-character-sheet-${result.generationId}`}><img src={result.imageUrl} alt={`${result.assetName} 저장 이미지`} /><span><strong>{result.assetName}</strong><small>{result.generationId}</small></span></button>)}</div> : <p>저장된 4방향 캐릭터가 없습니다. 위 조건으로 첫 캐릭터를 생성하세요.</p>}
            </section>
          </section>
        </div>
      </section>

      <section className="direction-split-workbench" data-testid="direction-sheet-splitter">
        <header>
          <div><small>CANONICAL SHEET PREPARATION</small><h2>2×2 4방향 시트 분할</h2><p>기존 분할 규칙을 유지합니다. 한 시트를 네 방향 RGB로 자르고 아래 단일 동작 요청의 네 입력칸에 연결합니다.</p></div>
          <strong>TL FRONT · TR BACK · BL RIGHT · BR LEFT</strong>
        </header>
        <div className="direction-split-body">
          <article className="direction-sheet-source">
            <span>SOURCE 2×2</span>
            <div className="direction-sheet-preview">
              {directionSheetSourceUrl
                ? <><img src={directionSheetSourceUrl} alt="분할할 2×2 4방향 시트" /><i className="split-x" /><i className="split-y" /></>
                : <small>파일을 고르거나 캐릭터·생명체 인벤토리 이미지를 선택하세요.</small>}
            </div>
            <div className="direction-sheet-inventory-picker" data-testid="direction-sheet-inventory-picker">
              <header><strong>캐릭터·생명체 이미지 인벤토리</strong><small>{directionSheetInventory.length}장</small></header>
              {directionSheetInventory.length ? <div>{directionSheetInventory.map((result) => <button type="button" key={result.generationId} className={directionSheetInventoryId === result.generationId ? "is-selected" : ""} onClick={() => { setDirectionSheetInventoryId(result.generationId); setDirectionSheetSourceMode("inventory"); setDirectionSplitNotice(`${result.assetName} 이미지를 4방향 분할 대상으로 선택했습니다.`); }} data-testid={`select-direction-sheet-${result.generationId}`} title={`${result.assetName} · ${result.generationId}`}><img src={result.imageUrl} alt={`${result.assetName} 4방향 시트 후보`} /><span>{result.category === "character" ? "CH" : "CR"}</span></button>)}</div> : <small>저장된 캐릭터·생명체 이미지가 없습니다.</small>}
            </div>
            <label><span>보조 입력 · 로컬 4방향 시트</span><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0] ?? null; setDirectionSheetFile(file); setDirectionSheetPreviewUrl(file ? URL.createObjectURL(file) : ""); if (file) setDirectionSheetSourceMode("upload"); }} data-testid="direction-sheet-upload" /></label>
            <div className="direction-split-actions">
              <button type="button" onClick={() => splitDirectionSheet("inventory")} disabled={!selectedInventoryDirectionSheet || splittingDirections} data-testid="split-inventory-direction-sheet">선택 인벤토리 분할</button>
              <button type="button" onClick={() => splitDirectionSheet("upload")} disabled={!directionSheetFile || splittingDirections} data-testid="split-uploaded-direction-sheet">업로드 파일 분할</button>
            </div>
            <small className="direction-sheet-selection">{directionSheetSourceMode === "inventory" && selectedInventoryDirectionSheet ? `${selectedInventoryDirectionSheet.assetName} · ${selectedInventoryDirectionSheet.generationId}` : directionSheetFile ? `${directionSheetFile.name} · local file` : "선택된 4방향 시트 없음"}</small>
          </article>

          <div className="direction-crop-grid" data-testid="direction-crop-results">
            {DIRECTION_SHEET_ORDER.map((directionId) => {
              const direction = DIRECTIONS.find((item) => item.id === directionId) ?? DIRECTIONS[0];
              const crop = directionSplit?.directions[directionId];
              return <button type="button" key={directionId} className={activeDirection === directionId ? "is-active" : ""} onClick={() => setActiveDirection(directionId)} data-testid={`direction-crop-${directionId}`}>
                <span>{direction.code} · {direction.camera}</span>
                <div>{crop ? <img src={`${crop.url}?split=${directionSplit?.splitId}`} alt={`${direction.label} 분할 RGB reference`} /> : <small>{direction.label} crop 대기</small>}</div>
                <strong>{direction.label}</strong>
                <small>{crop ? `${crop.width}×${crop.height}` : directionId === "front" ? "좌상" : directionId === "back" ? "우상" : directionId === "right" ? "좌하" : "우하"}</small>
              </button>;
            })}
          </div>
        </div>
        <footer><i />{directionSplitNotice}<span>분할 결과 또는 방향별 업로드 중 하나를 요청 입력으로 사용합니다.</span></footer>
      </section>

      <section className="scail-console-grid motion-request-workbench" data-testid="motion-request-workbench">
        <aside className="scail-project-panel">
          <header><small>PROJECT REQUEST</small><h2>단일 작업 설정</h2></header>
          <label><span>캐릭터 ID</span><input value={projectId} onChange={(event) => setProjectId(event.target.value)} data-testid="motion-project-id" /></label>
          <button type="button" onClick={resetMotionRequest} data-testid="reset-motion-inputs">방향별 업로드 초기화</button>
          <button type="button" onClick={downloadManifest} data-testid="download-motion-manifest">요청 manifest 저장</button>
          <div className="input-rule"><strong>입력은 RGB 네 장</strong><p>정면·후면·왼쪽·오른쪽 이미지만 보냅니다. mask와 driving video는 클라이언트 입력이 아닙니다.</p></div>
          <div className="input-rule"><strong>서버 내부 처리</strong><p>사람·캐릭터는 기존 V8 Kimodo 경로를 그대로 유지합니다. 동물은 사람 motion을 금지하고 기본 동물 cycle 또는 독립 animal-motion-v1 NPZ를 선택해 V9 adapter와 animal QC를 거칩니다.</p></div>
          <div className="input-rule"><strong>결과 수신</strong><p>서버가 만든 result.zip을 로컬 클라이언트가 직접 내려받습니다.</p></div>
          <div className="notice-box"><i />{notice}</div>
        </aside>

        <section className="scail-direction-panel">
          <div className="direction-editor">
            <header><div><small>POST /v1/jobs · MULTIPART</small><h2>4방향 이미지 한 번에 전송</h2></div><span>GPU QUEUE · 1</span></header>
            <div className="motion-image-grid" data-testid="motion-direction-inputs">
              {DIRECTIONS.map((direction) => {
                const uploaded = directionUploadFiles[direction.id];
                const split = directionSplit?.directions[direction.id];
                const preview = directionUploadPreviewUrls[direction.id] ?? (split ? `${split.url}?split=${directionSplit?.splitId}` : "");
                return <label key={direction.id} className={uploaded || split ? "is-ready" : ""}>
                  <span><b>{direction.code} · {direction.label}</b><small>{direction.id} · {direction.camera}</small></span>
                  <div>{preview ? <img src={preview} alt={`${direction.label} 동작 입력`} /> : <small>이미지 대기</small>}</div>
                  <input type="file" accept="image/*" onChange={(event) => updateDirectionUpload(direction.id, event.target.files?.[0] ?? null)} data-testid={`motion-image-${direction.id}`} />
                  <small>{uploaded?.name ?? (split ? "분할된 RGB 사용" : "PNG·JPG·WEBP 선택")}</small>
                </label>;
              })}
            </div>
            <label className="prompt-editor"><span>동작 설명 · 직접 수정 가능</span><textarea rows={5} value={motionPrompt} onChange={(event) => setMotionPrompt(event.target.value)} data-testid="motion-prompt" /></label>
            <div className="scail-params motion-params">
              <label><small>PROFILE</small><select value={motionProfile} onChange={(event) => { const next = event.target.value as MotionProfile; setMotionProfile(next); if (next === "character") { setMotionBackend("auto"); setMotionNpzFile(null); } }} data-testid="motion-subject-profile"><option value="auto">자동 분류</option><option value="character">사람·캐릭터</option><option value="quadruped">동물·사족</option><option value="biped_animal">동물·이족</option></select></label>
              <label><small>MOTION</small><select value={motionBackend} onChange={(event) => { const next = event.target.value as MotionBackend; setMotionBackend(next); if (next === "kimodo" || next === "animal_procedural") setMotionNpzFile(null); }} data-testid="motion-backend"><option value="auto">자동 라우팅</option><option value="kimodo">Kimodo · 사람 전용</option><option value="animal_procedural">동물 기본 cycle</option><option value="animal_npz">동물 NPZ</option></select></label>
              <label><small>ANIMAL NPZ</small><input type="file" accept=".npz,application/octet-stream,application/zip" disabled={motionProfile === "character" || !["auto", "animal_npz"].includes(motionBackend)} onChange={(event) => setMotionNpzFile(event.target.files?.[0] ?? null)} data-testid="motion-animal-npz" /><strong>{motionNpzFile?.name ?? "선택 없음"}</strong></label>
              <span><small>ACTION</small><strong>walk</strong></span><span><small>INPUT</small><strong>4 RGB</strong></span><span><small>OUTPUT</small><strong>result.zip</strong></span><span><small>FRAMES</small><strong>4 × 8 PNG</strong></span><label><small>SEED</small><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
            </div>
            <div className="job-actions motion-job-actions"><div><strong>{job.status}</strong><small>{job.jobId ?? "job_id 대기"}</small></div><button type="button" onClick={submitMotionJob} disabled={endpoint.status !== "연결됨" || submitting || !canSubmit} data-testid="queue-motion-job">{submitting ? "전송 중…" : "4방향 동작 생성 요청"}</button></div>
          </div>
        </section>
      </section>

      <section className="job-board motion-job-board" data-testid="motion-job-board">
        <header><div><small>POD PIPELINE JOB</small><h2>단일 작업 상태와 결과</h2></div><span>사람 {endpoint.characterReady ? "ready" : "down"} · 동물 {endpoint.animalReady ? "ready" : "down"} · One-to-All {endpoint.oneToAllState ?? "unknown"} · queue {endpoint.queueDepth ?? 0}</span></header>
        <div className="motion-job-flow">
          <article><span>01</span><strong>4 RGB upload</strong><small>front · back · left · right</small></article><b>→</b>
          <article><span>02</span><strong>Motion Source</strong><small>{motionBackend === "animal_npz" ? "animal NPZ" : motionBackend === "animal_procedural" ? "animal cycle" : motionBackend === "kimodo" ? "Kimodo" : "auto route"}</small></article><b>→</b>
          <article><span>03</span><strong>Profile Adapter</strong><small>V8 human · V9 animal</small></article><b>→</b>
          <article><span>04</span><strong>One-to-All</strong><small>serial render</small></article><b>→</b>
          <article className={job.status === "완료" ? "is-ready" : ""}><span>05</span><strong>result.zip</strong><small>32 PNG + sheet + metadata</small></article>
        </div>
        <div className="motion-job-result">
          <div><strong>{job.jobId ?? "작업 미등록"}</strong><span>{job.status}</span>{job.runtimeSeconds ? <small>runtime {job.runtimeSeconds.toFixed(1)}s</small> : null}{job.error ? <small className="job-error">{job.error}</small> : null}</div>
          {job.outputUrl ? <a href={job.outputUrl} download={`${projectId || "motion"}-result.zip`} data-testid="download-motion-result">result.zip 로컬 저장</a> : null}
          {job.debugUrl ? <a href={job.debugUrl} download={`${projectId || "motion"}-failure-debug.zip`} data-testid="download-motion-debug">failure_debug.zip 저장</a> : null}
          {!job.outputUrl && !job.debugUrl ? <small>완료 또는 실패 판정 뒤 다운로드가 활성화됩니다.</small> : null}
          {job.jobId && ["완료", "실패"].includes(job.status) ? <button type="button" onClick={deleteRemoteJob} data-testid="delete-motion-job">RunPod 임시 파일 삭제</button> : null}
        </div>
      </section>

      <section className="frame-board" data-testid="motion-result-layout">
        <header><div><small>RESULT.ZIP CONTENTS</small><h2>4방향 · 방향당 8프레임</h2><p>프레임 추출과 패킹까지 서버 작업에 포함하고, 로컬은 완성된 archive를 내려받습니다.</p></div><code>front / back / left / right</code></header>
        <div className="phase-header"><span>VIEW</span>{PHASES.map((phase, index) => <span key={phase}><b>{index + 1}</b><small>{phase}</small><em>{index}.png</em></span>)}</div>
        {DIRECTIONS.map((direction) => <div className="phase-row" key={direction.id}><strong>{direction.code}<small>{direction.label}</small></strong>{EXTRACT_INDICES.map((frame, index) => <span key={frame} className={job.status === "완료" ? "is-download-ready" : ""}><b>{index}.png</b><small>phase {index + 1}</small></span>)}</div>)}
        <footer><strong>총 32 PNG</strong><span>sprite_sheet.png과 metadata.json도 같은 result.zip에 포함</span><code>GET /v1/jobs/JOB_ID/result</code></footer>
      </section>

      <section className="catalog-workbench asset-catalog-workbench" data-testid="asset-catalog">
        <header className="catalog-workbench-heading">
          <div><small>PRESERVED ASSET CATALOG</small><h2>농장 RPG 전체 에셋 목록</h2><p>동작 생성 작업과 별개로 기존 타일·오브젝트·캐릭터·생명체·아이템·VFX·UI·가이드 목록을 계속 유지합니다.</p></div>
          <nav className="catalog-doc-links" aria-label="상세 카탈로그 문서">
            <a href="https://github.com/yyeongjin/2d-assets-generator/blob/main/docs/TILE_CATALOG.md" target="_blank" rel="noreferrer">타일 상세 표</a>
            <a href="https://github.com/yyeongjin/2d-assets-generator/blob/main/docs/OBJECT_CATALOG.md" target="_blank" rel="noreferrer">오브젝트 상세 표</a>
            <a href="https://github.com/yyeongjin/2d-assets-generator/blob/main/docs/ASSET_CATALOG.md" target="_blank" rel="noreferrer">전체 카탈로그</a>
          </nav>
        </header>
        <div className="catalog-tabs asset-catalog-tabs" role="tablist" aria-label="에셋 대분류">
          {ASSET_CATALOG.map((catalog) => <button key={catalog.id} type="button" role="tab" aria-selected={assetCatalogId === catalog.id} className={assetCatalogId === catalog.id ? "is-active" : ""} onClick={() => selectAssetCatalog(catalog.id)} data-testid={`asset-catalog-${catalog.id}`}><span>{catalog.code}</span><strong>{catalog.label}</strong><small>{catalog.summary}</small></button>)}
        </div>
        <div className="asset-catalog-body">
          <aside className="asset-catalog-summary">
            <span>{selectedAssetCatalog.code}</span>
            <small>SELECTED FAMILY</small>
            <h3>{selectedAssetCatalog.label}</h3>
            <p>{selectedAssetCatalog.summary}</p>
            <strong>{selectedAssetCatalog.items.length}개 기준 대상</strong>
            <a href={`https://github.com/yyeongjin/2d-assets-generator/blob/main${selectedAssetCatalog.sourceHref}`} target="_blank" rel="noreferrer">{selectedAssetCatalog.source} 열기</a>
          </aside>
          <div className="asset-catalog-table-wrap">
            <table>
              <thead><tr><th>번호</th><th>필요 대상</th><th>저장 이미지</th><th>선택</th></tr></thead>
              <tbody>{selectedAssetCatalog.items.map((item, index) => {
                const storedImages = assetInventory.filter((result) => result.assetName === item);
                return <tr key={item} className={assetCatalogItem === item ? "is-selected" : ""}><td>{String(index + 1).padStart(2, "0")}</td><td><strong>{item}</strong><small>{selectedAssetCatalog.label} / {selectedAssetCatalog.summary}</small></td><td>{storedImages.length === 0 ? <span className="inventory-none">비어 있음</span> : <div className="inventory-row-preview">{storedImages.slice(0, 3).map((result) => <img key={result.generationId} src={result.imageUrl} alt="" />)}<b>{storedImages.length}장</b></div>}</td><td><button type="button" onClick={() => selectAssetItem(item)} data-testid={`select-asset-${selectedAssetCatalog.id}-${index}`}>{assetCatalogItem === item ? "열림" : "인벤토리"}</button></td></tr>;
              })}</tbody>
            </table>
          </div>
          <aside className="asset-generation-panel" data-testid="asset-generation-panel">
            <header>
              <div><small>BASE ASSET GENERATOR</small><h3>{assetCatalogItem}</h3></div>
              <span data-status={imageEndpoint.status}>{assetCatalogId === "guide" ? "로컬 생성" : `이미지 ${imageEndpoint.status}`}</span>
            </header>
            <button type="button" className="asset-endpoint-button" onClick={checkImageEndpoint} data-testid="check-image-endpoint">이미지 endpoint 확인</button>
            <label className="asset-prompt-editor"><span>항목별 생성 프롬프트</span><textarea rows={8} value={assetPrompt} onChange={(event) => setAssetPrompt(event.target.value)} data-testid="catalog-asset-prompt" /></label>
            <div className="asset-generator-params"><span><small>CANVAS</small><strong>1024×1024</strong></span><label><small>SEED</small><input type="number" min="0" max="2147483647" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label></div>
            <div className="asset-generator-actions">
              <button type="button" onClick={randomizeAssetItem}>목록 랜덤</button>
              <button type="button" className="is-primary" onClick={generateCatalogAsset} disabled={generatingAsset || !assetPrompt.trim() || (assetCatalogId !== "guide" && imageEndpoint.status !== "연결됨")} data-testid="generate-catalog-asset">{generatingAsset ? "생성 중…" : `${assetCatalogItem} 생성`}</button>
            </div>
            <div className="asset-upload-box">
              <label><span>내 이미지 저장</span><input key={`${assetCatalogId}-${assetCatalogItem}-${assetUploadFile ? assetUploadFile.name : "empty"}`} type="file" accept="image/*" onChange={(event) => setAssetUploadFile(event.target.files?.[0] ?? null)} data-testid="catalog-asset-upload-input" /><small>{assetUploadFile ? `${assetUploadFile.name} · ${(assetUploadFile.size / 1024).toFixed(0)}KB` : "PNG·JPG·WEBP · 최대 20MB"}</small></label>
              <button type="button" onClick={uploadCatalogAsset} disabled={!assetUploadFile || uploadingAsset} data-testid="upload-catalog-asset">{uploadingAsset ? "저장 중…" : "선택 이미지 저장"}</button>
            </div>
            <p className="asset-generator-notice">{assetNotice}</p>
            {assetResult ? <div className="asset-generator-output" data-testid="catalog-asset-output"><img src={assetResult.imageUrl} alt={`${assetResult.assetName} 저장 이미지`} /><div><strong>{assetResult.assetName}</strong><small>{assetResult.generationId}</small><span>{assetResult.source === "uploaded" ? "직접 업로드" : "모델 생성"} · {assetResult.outputSize}</span><a href={assetResult.metadataUrl} target="_blank" rel="noreferrer">JSON 기록 열기</a></div></div> : <div className="asset-generator-empty">아래 인벤토리에서 이미지를 선택하거나 새로 생성·업로드하세요.</div>}
            <div className="asset-image-inventory" data-testid="catalog-asset-inventory"><header><strong>{assetCatalogItem} 이미지 인벤토리</strong><span>{selectedItemInventory.length}장 저장</span></header>{selectedItemInventory.length === 0 ? <small>이 항목에 저장된 이미지가 없습니다.</small> : <div>{selectedItemInventory.map((result) => <article key={result.generationId} className={assetResult?.generationId === result.generationId ? "is-current" : ""}><button type="button" className="inventory-image-select" onClick={() => { setAssetResult(result); if (result.source === "generated") { setAssetPrompt(result.prompt); setSeed(result.seed); } setAssetNotice(`${result.assetName}의 ${result.source === "uploaded" ? "업로드" : "생성"} 이미지를 선택했습니다.`); }} data-testid={`select-inventory-${result.generationId}`}><img src={result.imageUrl} alt={`${result.assetName} ${result.generationId}`} /><span>{result.source === "uploaded" ? "업로드" : "생성"}</span></button><button type="button" className="inventory-image-remove" onClick={() => removeInventoryAsset(result)} aria-label={`${result.assetName} ${result.generationId} 제거`}>제거</button></article>)}</div>}</div>
          </aside>
        </div>
        <footer><strong>각 행의 ‘인벤토리’에서 항목을 선택합니다.</strong><span>생성본과 직접 업로드한 사진을 여러 장 저장하고, 원하는 이미지를 선택하거나 개별 제거할 수 있습니다.</span></footer>
      </section>

      <section className="deployment-note">
        <div><small>RUNPOD</small><h2>48GB On-Demand Pod</h2><p>Kimodo + One-to-All 1.3B GPU 상주 · HTTP 8000 · 추론 직렬 처리</p></div>
        <code>4 RGB multipart → job_id → status → result.zip</code>
        <div><strong>로컬 환경변수</strong><small>MOTION_PIPELINE_BASE_URL · MOTION_PIPELINE_API_TOKEN</small><a href="https://github.com/yyeongjin/2d-assets-generator/blob/main/docs/RUNPOD_KIMODO_ONE_TO_ALL_GUIDE.md" target="_blank" rel="noreferrer">설치·실행 가이드</a></div>
      </section>
    </main>
  );
}
