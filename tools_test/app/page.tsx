"use client";

/* eslint-disable @next/next/no-img-element -- generated local files are shown without image optimization. */

import { useEffect, useMemo, useState } from "react";

type Direction = "front" | "back" | "left" | "right";
type AssetCatalogId = "tile" | "object" | "character" | "creature" | "item" | "vfx" | "ui" | "guide";
type EndpointStatus = "꺼짐" | "확인 중" | "연결됨" | "오류";
type JobStatus = "입력 준비" | "대기열" | "생성 중" | "영상 완료" | "실패";

type DirectionInput = {
  referenceImage: string;
  referenceMask: string;
  drivingVideo: string;
  drivingMask: string;
};

type JobState = {
  status: JobStatus;
  jobId?: string;
  outputPath?: string;
  runtimeSeconds?: number;
  error?: string;
};

type EndpointState = {
  status: EndpointStatus;
  modelState?: string;
  queueDepth?: number;
  message?: string;
};

type ImageEndpointState = {
  status: EndpointStatus;
  model?: string;
  latencyMs?: number;
  message?: string;
};

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

const PROMPTS: Record<Direction, string> = {
  front: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic front view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
  back: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic back view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
  left: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic left-profile view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
  right: "A full-body 2D game character performs one seamless in-place walk cycle in a fixed orthographic right-profile view. The camera, framing, character scale, identity, costume, colors, and ground baseline remain constant.",
};

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

function createInputs(projectId: string): Record<Direction, DirectionInput> {
  const safeId = projectId.trim() || "CHARACTER_ID";
  return Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, {
    referenceImage: `references/${safeId}/${direction.id}/ref.jpg`,
    referenceMask: `references/${safeId}/${direction.id}/ref_mask.jpg`,
    drivingVideo: `drivers/master-walk-17f/${direction.id}/rendered_v2.mp4`,
    drivingMask: `drivers/master-walk-17f/${direction.id}/rendered_mask_v2.mp4`,
  }])) as Record<Direction, DirectionInput>;
}

function createJobs(): Record<Direction, JobState> {
  return Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, { status: "입력 준비" }])) as Record<Direction, JobState>;
}

export default function Home() {
  const [projectId, setProjectId] = useState("character-001");
  const [activeDirection, setActiveDirection] = useState<Direction>("front");
  const [assetCatalogId, setAssetCatalogId] = useState<AssetCatalogId>("tile");
  const [inputs, setInputs] = useState<Record<Direction, DirectionInput>>(() => createInputs("character-001"));
  const [prompts, setPrompts] = useState<Record<Direction, string>>(PROMPTS);
  const [jobs, setJobs] = useState<Record<Direction, JobState>>(() => createJobs());
  const [endpoint, setEndpoint] = useState<EndpointState>({ status: "꺼짐" });
  const [imageEndpoint, setImageEndpoint] = useState<ImageEndpointState>({ status: "꺼짐" });
  const [notice, setNotice] = useState("방향별 canonical reference와 master walk driver를 Network Volume에 준비하세요.");
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

  const selectedDirection = useMemo(
    () => DIRECTIONS.find((direction) => direction.id === activeDirection) ?? DIRECTIONS[0],
    [activeDirection],
  );
  const selectedAssetCatalog = useMemo(
    () => ASSET_CATALOG.find((catalog) => catalog.id === assetCatalogId) ?? ASSET_CATALOG[0],
    [assetCatalogId],
  );

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
      setInputs((current) => Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, {
        ...current[direction.id],
        referenceImage: body.directions[direction.id].referencePath,
      }])) as Record<Direction, DirectionInput>);
      setJobs(createJobs());
      setActiveDirection("front");
      setDirectionSplitNotice(`${body.source.width}×${body.source.height} 시트를 4개 RGB reference로 분할했습니다. mask와 driver 경로는 그대로 유지합니다.`);
      setNotice(`${body.splitId} 분할 완료 · 방향별 REFERENCE RGB 경로를 적용했습니다.`);
      console.info("[SCAIL_CONSOLE][DIRECTION_SPLIT_COMPLETE]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "4방향 시트 분할 실패";
      setDirectionSplitNotice(`분할 실패 · ${message}`);
      console.error("[SCAIL_CONSOLE][DIRECTION_SPLIT_FAILED]", { message });
    } finally {
      setSplittingDirections(false);
    }
  }

  function applyProjectPaths() {
    setInputs(createInputs(projectId));
    setJobs(createJobs());
    setDirectionSplit(null);
    setNotice(`${projectId || "CHARACTER_ID"} 경로 템플릿을 적용했습니다. 실제 파일은 로컬 클라이언트가 S3 API로 업로드합니다.`);
  }

  function updateInput(key: keyof DirectionInput, value: string) {
    setInputs((current) => ({
      ...current,
      [activeDirection]: { ...current[activeDirection], [key]: value },
    }));
    setJobs((current) => ({ ...current, [activeDirection]: { status: "입력 준비" } }));
  }

  async function checkHealth() {
    setEndpoint({ status: "확인 중" });
    setNotice("SCAIL-2 Pod와 단일 GPU worker 상태를 확인 중입니다.");
    try {
      const response = await fetch("/api/scail2/health", { cache: "no-store" });
      const body = await response.json() as { ok?: boolean; model_state?: string; queue_depth?: number; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setEndpoint({ status: "연결됨", modelState: body.model_state, queueDepth: body.queue_depth });
      setNotice(`Pod 연결 완료 · model ${body.model_state ?? "unknown"} · queue ${body.queue_depth ?? 0}`);
      console.info("[SCAIL_CONSOLE][HEALTH_OK]", body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pod 연결 실패";
      setEndpoint({ status: "오류", message });
      setNotice(`Pod 연결 실패 · ${message}`);
      console.error("[SCAIL_CONSOLE][HEALTH_FAILED]", { message });
    }
  }

  async function pollJob(direction: Direction, jobId: string) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      try {
        const response = await fetch(`/api/scail2/jobs/${jobId}`, { cache: "no-store" });
        const body = await response.json() as { status?: string; output_path?: string; runtime_seconds?: number; error?: string };
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        const status: JobStatus = body.status === "completed"
          ? "영상 완료"
          : body.status === "failed"
            ? "실패"
            : body.status === "running"
              ? "생성 중"
              : "대기열";
        setJobs((current) => ({
          ...current,
          [direction]: {
            ...current[direction],
            status,
            outputPath: body.output_path,
            runtimeSeconds: body.runtime_seconds,
            error: body.error,
          },
        }));
        if (status === "영상 완료" || status === "실패") {
          setNotice(`${DIRECTIONS.find((item) => item.id === direction)?.label} 작업 ${status}. 영상 완료 뒤 로컬 클라이언트가 다운로드와 8 phase 추출을 수행합니다.`);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "작업 조회 실패";
        setJobs((current) => ({ ...current, [direction]: { ...current[direction], status: "실패", error: message } }));
        setNotice(`${direction} 작업 조회 실패 · ${message}`);
        return;
      }
    }
  }

  async function submitJob(direction: Direction) {
    const directionInputs = inputs[direction];
    const response = await fetch("/api/scail2/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction,
        prompt: prompts[direction],
        reference_image: directionInputs.referenceImage,
        reference_mask: directionInputs.referenceMask,
        driving_video: directionInputs.drivingVideo,
        driving_mask: directionInputs.drivingMask,
        target_width: 896,
        target_height: 512,
        sample_steps: 40,
        sample_shift: 3,
        sample_guide_scale: 5,
        sample_solver: "unipc",
        seed,
      }),
    });
    const body = await response.json() as { job_id?: string; error?: string };
    if (!response.ok || !body.job_id) throw new Error(body.error || "작업 등록 실패");
    setJobs((current) => ({ ...current, [direction]: { status: "대기열", jobId: body.job_id } }));
    console.info("[SCAIL_CONSOLE][JOB_QUEUED]", { direction, jobId: body.job_id });
    void pollJob(direction, body.job_id);
  }

  async function submitSelected() {
    if (submitting || endpoint.status !== "연결됨") return;
    setSubmitting(true);
    setNotice(`${selectedDirection.label} 한 cycle job을 등록합니다.`);
    try {
      await submitJob(activeDirection);
    } catch (error) {
      const message = error instanceof Error ? error.message : "작업 등록 실패";
      setJobs((current) => ({ ...current, [activeDirection]: { status: "실패", error: message } }));
      setNotice(`${selectedDirection.label} 등록 실패 · ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAll() {
    if (submitting || endpoint.status !== "연결됨") return;
    setSubmitting(true);
    setNotice("정면 → 후면 → 왼쪽 → 오른쪽 순서로 job_id를 등록합니다. GPU worker는 한 작업씩 실행합니다.");
    try {
      for (const direction of DIRECTIONS) await submitJob(direction.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "4방향 등록 실패";
      setNotice(`4방향 등록 중단 · ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  function downloadManifest() {
    const payload = {
      project_id: projectId,
      data_root: "/workspace/scail2-data",
      views: Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, {
        local_reference_image: directionSplit?.directions[direction.id].localClientPath ?? `inputs/${projectId}/${direction.id}/ref.jpg`,
        local_reference_mask: `inputs/${projectId}/${direction.id}/ref_mask.jpg`,
        local_driving_video: `inputs/master-walk-17f/${direction.id}/rendered_v2.mp4`,
        local_driving_mask: `inputs/master-walk-17f/${direction.id}/rendered_mask_v2.mp4`,
        reference_image: inputs[direction.id].referenceImage,
        reference_mask: inputs[direction.id].referenceMask,
        driving_video: inputs[direction.id].drivingVideo,
        driving_mask: inputs[direction.id].drivingMask,
        prompt: prompts[direction.id],
      }])),
      generation: { width: 896, height: 512, steps: 40, shift: 3, cfg: 5, solver: "unipc", seed },
      local_extract: { indices: EXTRACT_INDICES },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectId || "scail2"}-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedJob = jobs[activeDirection];
  const canSubmit = Object.values(inputs[activeDirection]).every((value) => value.trim()) && prompts[activeDirection].trim();
  const selectedItemInventory = assetInventory.filter((result) => result.assetName === assetCatalogItem);
  const selectedInventoryDirectionSheet = directionSheetInventory.find((item) => item.generationId === directionSheetInventoryId) ?? null;
  const directionSheetSourceUrl = directionSheetSourceMode === "inventory"
    ? selectedInventoryDirectionSheet?.imageUrl ?? directionSheetPreviewUrl
    : directionSheetPreviewUrl || selectedInventoryDirectionSheet?.imageUrl;
  const selectedDirectionCrop = directionSplit?.directions[activeDirection];

  return (
    <main className="app-shell scail-console">
      <header className="topbar scail-console-topbar">
        <div className="brand"><span>S2</span><div><small>LOCAL SCAIL PRODUCTION CLIENT</small><h1>4-View Walk Factory</h1></div></div>
        <div className="topology-title">local assets / network volume / one GPU worker</div>
        <div className="endpoint-cluster"><div className="runpod-state" data-status={endpoint.status}><i /><strong>SCAIL-2 {endpoint.status}</strong></div><button type="button" className="secondary-button" onClick={checkHealth} data-testid="check-scail-runpod">Pod 연결 확인</button></div>
      </header>

      <nav className="phase-rail" aria-label="production stages">
        <div className="phase is-ready"><span>01</span><div><strong>Canonical 4방향</strong><small>준비된 입력 이미지·마스크</small></div></div>
        <div className="phase is-ready"><span>02</span><div><strong>Master Walk 17F</strong><small>한 motion · 네 고정 camera</small></div></div>
        <div className="phase is-active"><span>03</span><div><strong>SCAIL-2 4 Jobs</strong><small>방향당 한 cycle 영상</small></div></div>
        <div className="phase"><span>04</span><div><strong>Local 8-Phase Pick</strong><small>4×8 = 32 PNG</small></div></div>
      </nav>

      <section className="architecture-map" data-testid="architecture-map">
        <article><small>LOCAL PC</small><strong>4 refs + 4 drivers</strong><span>S3-compatible upload</span></article><b>→</b>
        <article><small>NETWORK VOLUME</small><strong>/workspace/scail2-data</strong><span>prepared inputs + raw outputs</span></article><b>→</b>
        <article className="is-primary"><small>ON-DEMAND POD</small><strong>SCAIL-2 loaded once</strong><span>FastAPI :8000 · serial GPU queue</span></article><b>→</b>
        <article><small>LOCAL CLIENT</small><strong>download raw videos</strong><span>0·2·4·6·8·10·12·14</span></article>
      </section>

      <section className="direction-split-workbench" data-testid="direction-sheet-splitter">
        <header>
          <div><small>CANONICAL SHEET PREPARATION</small><h2>2×2 4방향 시트 분할</h2><p>기존 분할 규칙을 복원했습니다. 한 시트를 네 방향 RGB reference로 자르고 아래 방향별 입력칸에 연결합니다.</p></div>
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
        <footer><i />{directionSplitNotice}<span>REFERENCE MASK · DRIVING RGB · DRIVING MASK는 변경하지 않습니다.</span></footer>
      </section>

      <section className="scail-console-grid">
        <aside className="scail-project-panel">
          <header><small>PROJECT MANIFEST</small><h2>입력 구조</h2></header>
          <label><span>캐릭터 ID</span><input value={projectId} onChange={(event) => setProjectId(event.target.value)} data-testid="scail-project-id" /></label>
          <button type="button" onClick={applyProjectPaths} data-testid="apply-scail-path-template">Volume 경로 적용</button>
          <button type="button" onClick={downloadManifest} data-testid="download-scail-manifest">로컬 manifest 저장</button>
          <div className="input-rule"><strong>Reference</strong><p>정면·후면·좌·우 standing neutral 이미지와 각 reference mask를 별도로 준비합니다.</p></div>
          <div className="input-rule"><strong>Master Motion</strong><p>하나의 rig·하나의 17-frame closed walk를 네 고정 camera로 렌더합니다.</p></div>
          <div className="input-rule"><strong>전처리 분리</strong><p>SCAIL-Pose mask 생성은 asset 준비 단계에서 한 번 수행합니다. generation endpoint가 매번 전처리하지 않습니다.</p></div>
          <div className="notice-box"><i />{notice}</div>
        </aside>

        <section className="scail-direction-panel">
          <div className="scail-direction-tabs" role="tablist" aria-label="방향 선택">
            {DIRECTIONS.map((direction) => <button type="button" role="tab" aria-selected={activeDirection === direction.id} className={activeDirection === direction.id ? "is-active" : ""} key={direction.id} onClick={() => setActiveDirection(direction.id)} data-testid={`scail-direction-${direction.id}`}><span>{direction.code}</span><strong>{direction.label}</strong><small>{direction.camera} · {jobs[direction.id].status}</small></button>)}
          </div>

          <div className="direction-editor">
            <header><div><small>{selectedDirection.code} / {selectedDirection.camera}</small><h2>{selectedDirection.label} 한 cycle 입력</h2></div><span>Animation Mode · replace_flag=false</span></header>
            <div className="direction-input-grid">
              {([
                ["referenceImage", "REFERENCE RGB", "ref.jpg"],
                ["referenceMask", "REFERENCE MASK", "ref_mask.jpg"],
                ["drivingVideo", "DRIVING RGB 17F", "rendered_v2.mp4"],
                ["drivingMask", "DRIVING MASK 17F", "rendered_mask_v2.mp4"],
              ] as const).map(([key, title, filename]) => <label key={key}><span><b>{title}</b><small>{filename}</small></span><input value={inputs[activeDirection][key]} onChange={(event) => updateInput(key, event.target.value)} data-testid={`scail-path-${activeDirection}-${key}`} /></label>)}
            </div>
            {selectedDirectionCrop ? <div className="direction-reference-preview" data-testid={`active-direction-reference-${activeDirection}`}><img src={`${selectedDirectionCrop.url}?split=${directionSplit?.splitId}`} alt={`${selectedDirection.label} REFERENCE RGB 미리보기`} /><div><small>분할된 REFERENCE RGB</small><strong>{selectedDirectionCrop.localClientPath}</strong><span>업로드 대상 · {selectedDirectionCrop.referencePath}</span></div></div> : null}
            <label className="prompt-editor"><span>생성될 영상 설명</span><textarea rows={5} value={prompts[activeDirection]} onChange={(event) => setPrompts((current) => ({ ...current, [activeDirection]: event.target.value }))} data-testid={`scail-prompt-${activeDirection}`} /></label>
            <div className="scail-params"><span><small>SIZE</small><strong>896×512</strong></span><span><small>STEPS</small><strong>40</strong></span><span><small>SHIFT</small><strong>3.0</strong></span><span><small>CFG</small><strong>5.0</strong></span><span><small>SOLVER</small><strong>UniPC</strong></span><label><small>SEED</small><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label></div>
            <div className="job-actions"><div><strong>{selectedJob.status}</strong><small>{selectedJob.jobId ?? "job_id 대기"}</small></div><button type="button" onClick={submitSelected} disabled={endpoint.status !== "연결됨" || submitting || !canSubmit} data-testid="queue-selected-scail-job">{selectedDirection.label} cycle 등록</button><button type="button" onClick={submitAll} disabled={endpoint.status !== "연결됨" || submitting} data-testid="queue-all-scail-jobs">4방향 순서대로 등록</button></div>
          </div>
        </section>
      </section>

      <section className="job-board" data-testid="scail-job-board">
        <header><div><small>POD JOB QUEUE</small><h2>4방향 원본 영상</h2></div><span>model {endpoint.modelState ?? "unknown"} · queue {endpoint.queueDepth ?? 0}</span></header>
        <div className="job-card-grid">
          {DIRECTIONS.map((direction) => {
            const job = jobs[direction.id];
            return <article key={direction.id} className={`job-card is-${job.status.replace(" ", "-")}`}><header><span>{direction.code}</span><div><strong>{direction.label} 17F cycle</strong><small>{job.status}</small></div></header><div className="job-flow"><span>ref</span><b>+</b><span>driver</span><b>→</b><span>raw mp4</span></div><strong>{job.jobId ?? "작업 미등록"}</strong><small>{job.outputPath ?? "Network Volume output 대기"}</small>{job.runtimeSeconds ? <p>runtime {job.runtimeSeconds.toFixed(1)}s</p> : null}{job.error ? <p className="job-error">{job.error}</p> : null}</article>;
          })}
        </div>
      </section>

      <section className="frame-board" data-testid="local-frame-extraction">
        <header><div><small>LOCAL POST GENERATION</small><h2>동일 phase 32프레임</h2><p>Pod는 raw video까지만 생성합니다. 로컬 클라이언트가 영상을 내려받은 뒤 PNG를 추출합니다.</p></div><code>0 · 2 · 4 · 6 · 8 · 10 · 12 · 14</code></header>
        <div className="phase-header"><span>VIEW</span>{PHASES.map((phase, index) => <span key={phase}><b>{index + 1}</b><small>{phase}</small><em>F{EXTRACT_INDICES[index]}</em></span>)}</div>
        {DIRECTIONS.map((direction) => <div className="phase-row" key={direction.id}><strong>{direction.code}<small>{direction.label}</small></strong>{EXTRACT_INDICES.map((frame) => <span key={frame} className={jobs[direction.id].status === "영상 완료" ? "is-download-ready" : ""}><b>PNG</b><small>source F{frame}</small></span>)}</div>)}
        <footer><strong>Frame 16은 출력 PNG에서 제외</strong><span>Frame 0과 같은 pose인지 loop closure 검증에만 사용</span><code>python runpod/scail2_client/client.py manifest.json --views front</code></footer>
      </section>

      <section className="catalog-workbench asset-catalog-workbench" data-testid="asset-catalog">
        <header className="catalog-workbench-heading">
          <div><small>PRESERVED ASSET CATALOG</small><h2>농장 RPG 전체 에셋 목록</h2><p>SCAIL-2 동작 작업과 별개로 기존 타일·오브젝트·캐릭터·생명체·아이템·VFX·UI·가이드 목록을 계속 유지합니다.</p></div>
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
        <div><small>RUNPOD</small><h2>On-Demand Pod</h2><p>A100 80GB 시작 · Network Volume 약 180~200GB · HTTP 8000</p></div>
        <code>POST /v1/jobs → job_id → GET /v1/jobs/&#123;id&#125;</code>
        <div><strong>로컬 환경변수</strong><small>SCAIL2_BASE_URL · SCAIL2_API_TOKEN</small><a href="https://github.com/yyeongjin/2d-assets-generator/blob/main/docs/RUNPOD_SCAIL2_GUIDE.md" target="_blank" rel="noreferrer">설치·실행 가이드</a></div>
      </section>
    </main>
  );
}
