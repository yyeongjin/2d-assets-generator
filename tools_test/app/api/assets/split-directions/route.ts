import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const DIRECTIONS = ["front", "back", "right", "left"] as const;
type Direction = typeof DIRECTIONS[number];

function safeProjectId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "character-001";
}

function cropForDirection(direction: Direction, width: number, height: number) {
  const leftWidth = Math.floor(width / 2);
  const topHeight = Math.floor(height / 2);
  const rightWidth = width - leftWidth;
  const bottomHeight = height - topHeight;
  if (direction === "front") return { left: 0, top: 0, width: leftWidth, height: topHeight };
  if (direction === "back") return { left: leftWidth, top: 0, width: rightWidth, height: topHeight };
  if (direction === "right") return { left: 0, top: topHeight, width: leftWidth, height: bottomHeight };
  return { left: leftWidth, top: topHeight, width: rightWidth, height: bottomHeight };
}

function publicImagePath(imageUrl: string) {
  const pathname = decodeURIComponent(new URL(imageUrl, "http://local.test").pathname);
  if (!pathname.startsWith("/generated/")) throw new Error("저장 인벤토리의 /generated 이미지 경로만 사용할 수 있습니다.");
  const publicRoot = path.resolve(process.cwd(), "public");
  const resolved = path.resolve(publicRoot, `.${pathname}`);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) throw new Error("허용되지 않은 이미지 경로입니다.");
  return resolved;
}

type LegacyDirectionSheetMetadata = {
  generationId?: string;
  requestId?: string;
  model?: string;
  createdAt?: string;
  elapsedMs?: number;
  postprocessed?: boolean;
  settings?: { prompt?: string; seed?: number };
  input?: { filename?: string; size?: string };
  output?: { filename?: string; size?: string };
  cells?: string[];
};

export async function GET() {
  const directory = path.join(process.cwd(), "public", "generated", "character-sheets");
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort().reverse();
    const records = await Promise.all(files.map(async (metadataFilename) => {
      try {
        const metadata = JSON.parse(await readFile(path.join(directory, metadataFilename), "utf8")) as LegacyDirectionSheetMetadata;
        if (!metadata.generationId || !metadata.output?.filename || metadata.cells?.join(",") !== "front,back,right,left") return null;
        const outputFilename = path.basename(metadata.output.filename);
        const inputFilename = metadata.input?.filename ? path.basename(metadata.input.filename) : outputFilename;
        return {
          ok: true as const,
          generationId: metadata.generationId,
          requestId: metadata.requestId ?? `legacy-${metadata.generationId}`,
          model: metadata.model ?? "legacy-character-sheet",
          createdAt: metadata.createdAt ?? "",
          source: "generated" as const,
          category: "character" as const,
          assetName: "4방향 캐릭터 시트",
          prompt: metadata.settings?.prompt ?? "",
          seed: metadata.settings?.seed ?? 0,
          inputImageUrl: `/generated/character-sheets/${inputFilename}`,
          imageUrl: `/generated/character-sheets/${outputFilename}`,
          metadataUrl: `/generated/character-sheets/${metadataFilename}`,
          inputSize: metadata.input?.size ?? metadata.output.size ?? "unknown",
          outputSize: metadata.output.size ?? "unknown",
          elapsedMs: metadata.elapsedMs ?? 0,
          postprocessed: false as const,
          inventoryKind: "four-direction-sheet" as const,
        };
      } catch (error) {
        console.error("[DirectionSplit][LEGACY_INVENTORY_SKIPPED]", { metadataFilename, message: error instanceof Error ? error.message : "invalid metadata" });
        return null;
      }
    }));
    return NextResponse.json({ ok: true, items: records.filter((record): record is NonNullable<typeof record> => record !== null) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ ok: true, items: [] });
    return NextResponse.json({ error: error instanceof Error ? error.message : "4방향 캐릭터 인벤토리 조회 실패" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = `direction-split-${randomUUID()}`;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const imageUrlValue = form.get("imageUrl");
    const imageUrl = typeof imageUrlValue === "string" ? imageUrlValue.trim() : "";
    const projectIdValue = form.get("projectId");
    const projectId = safeProjectId(typeof projectIdValue === "string" ? projectIdValue : "character-001");

    let sourceBuffer: Buffer;
    let sourceLabel: string;
    if (file instanceof File && file.size > 0) {
      if (!file.type.startsWith("image/")) return NextResponse.json({ error: "이미지 파일만 분할할 수 있습니다." }, { status: 415 });
      if (file.size > MAX_SOURCE_BYTES) return NextResponse.json({ error: "4방향 시트는 30MB 이하여야 합니다." }, { status: 413 });
      sourceBuffer = Buffer.from(await file.arrayBuffer());
      sourceLabel = file.name;
    } else if (imageUrl) {
      sourceBuffer = await readFile(publicImagePath(imageUrl));
      if (sourceBuffer.length > MAX_SOURCE_BYTES) return NextResponse.json({ error: "4방향 시트는 30MB 이하여야 합니다." }, { status: 413 });
      sourceLabel = imageUrl;
    } else {
      return NextResponse.json({ error: "업로드할 2×2 시트 또는 선택한 인벤토리 이미지가 필요합니다." }, { status: 400 });
    }

    const normalizedSource = await sharp(sourceBuffer).rotate().png().toBuffer();
    const metadata = await sharp(normalizedSource).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 2 || height < 2) return NextResponse.json({ error: "2×2 시트 크기를 읽을 수 없습니다." }, { status: 400 });

    const splitId = `SPLIT-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const outputRoot = path.join(process.cwd(), "public", "generated", "direction-references", projectId, splitId);
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, "source.png"), normalizedSource);

    const directionEntries = await Promise.all(DIRECTIONS.map(async (direction) => {
      const crop = cropForDirection(direction, width, height);
      const directionDirectory = path.join(outputRoot, direction);
      await mkdir(directionDirectory, { recursive: true });
      const referenceBuffer = await sharp(normalizedSource)
        .extract(crop)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
        .toBuffer();
      await writeFile(path.join(directionDirectory, "ref.jpg"), referenceBuffer);
      const publicUrl = `/generated/direction-references/${projectId}/${splitId}/${direction}/ref.jpg`;
      return [direction, {
        direction,
        crop,
        width: crop.width,
        height: crop.height,
        url: publicUrl,
        localClientPath: `tools_test/public${publicUrl}`,
        referencePath: `references/${projectId}/${direction}/ref.jpg`,
      }] as const;
    }));

    const directions = Object.fromEntries(directionEntries) as Record<Direction, typeof directionEntries[number][1]>;
    const manifest = {
      splitId,
      requestId,
      createdAt: new Date().toISOString(),
      projectId,
      source: { label: sourceLabel, width, height, layout: "2x2", order: DIRECTIONS },
      directions,
    };
    await writeFile(path.join(outputRoot, "split-manifest.json"), JSON.stringify(manifest, null, 2));

    console.info("[DirectionSplit][COMPLETE]", { requestId, splitId, projectId, sourceLabel, sourceSize: `${width}x${height}`, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({
      ok: true,
      ...manifest,
      sourceImageUrl: `/generated/direction-references/${projectId}/${splitId}/source.png`,
      metadataUrl: `/generated/direction-references/${projectId}/${splitId}/split-manifest.json`,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "4방향 시트 분할 실패";
    console.error("[DirectionSplit][FAILED]", { requestId, message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: message, requestId }, { status: 400 });
  }
}
