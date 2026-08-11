import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  requestImageEdit,
  RunPodConfigurationError,
  RunPodUpstreamError,
  type ImageEditSettings,
} from "@/lib/runpod-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const CATEGORIES = new Set(["tile", "object", "character", "creature", "item", "vfx", "ui", "guide"]);

type AssetRequest = {
  category?: unknown;
  assetName?: unknown;
  prompt?: unknown;
  negativePrompt?: unknown;
  seed?: unknown;
  size?: unknown;
};

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "asset";
}

function validSize(value: string) {
  return /^(512|768|1024)x(512|768|1024)$/.test(value);
}

function numericSeed(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4821;
  return Math.min(2_147_483_647, Math.max(0, Math.round(parsed)));
}

export async function GET(request: Request) {
  try {
    const categoryValue = new URL(request.url).searchParams.get("category") ?? "item";
    const category = CATEGORIES.has(categoryValue) ? categoryValue : "item";
    const outputDirectory = path.join(process.cwd(), "public", "generated", "base-assets", safeSegment(category));
    const files = (await readdir(outputDirectory)).filter((file) => file.endsWith(".json")).sort().reverse();
    const metadataFilename = files[0];
    if (!metadataFilename) return NextResponse.json({ error: `저장된 ${category} 기준 에셋이 없습니다.` }, { status: 404 });
    const metadata = JSON.parse(await readFile(path.join(outputDirectory, metadataFilename), "utf8")) as {
      generationId: string; requestId: string; model: string; elapsedMs: number; category: BaseAssetCategoryLike; assetName: string;
      input: { filename: string; size: string }; settings: ImageEditSettings; output: { filename: string; size: string };
    };
    return NextResponse.json({
      ok: true,
      generationId: metadata.generationId,
      requestId: metadata.requestId,
      model: metadata.model,
      category: metadata.category,
      assetName: metadata.assetName,
      prompt: metadata.settings.prompt,
      seed: metadata.settings.seed,
      inputImageUrl: `/generated/base-assets/${safeSegment(category)}/${metadata.input.filename}`,
      imageUrl: `/generated/base-assets/${safeSegment(category)}/${metadata.output.filename}`,
      metadataUrl: `/generated/base-assets/${safeSegment(category)}/${metadataFilename}`,
      inputSize: metadata.input.size,
      outputSize: metadata.output.size,
      elapsedMs: metadata.elapsedMs,
      postprocessed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "최근 기준 에셋 조회 실패";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

type BaseAssetCategoryLike = "tile" | "object" | "character" | "creature" | "item" | "vfx" | "ui" | "guide";

function guideRatio(assetName: string) {
  const matched = assetName.match(/(\d)x(\d)/i);
  if (!matched) {
    if (assetName.includes("4방향") || assetName.includes("edge-corner")) return { columns: 1, rows: 1 };
    return { columns: 1, rows: 2 };
  }
  return { columns: Number(matched[1]), rows: Number(matched[2]) };
}

function poseLines(assetName: string, x: number, y: number, width: number, height: number) {
  const cx = x + width / 2;
  const headY = y + width * 0.09;
  const shoulderY = y + height * 0.36;
  const hipY = y + height * 0.62;
  const floorY = y + height;
  const stroke = Math.max(5, Math.round(width * 0.025));
  const head = `<circle cx="${cx}" cy="${headY}" r="${width * 0.09}"/>`;
  const directionMark = assetName === "right"
    ? `<path d="M ${cx + width * 0.05} ${headY} H ${cx + width * 0.13}"/>`
    : assetName === "left"
      ? `<path d="M ${cx - width * 0.05} ${headY} H ${cx - width * 0.13}"/>`
      : "";
  const body = `<path d="M ${cx} ${headY + width * 0.09} L ${cx} ${hipY}"/>`;
  let limbs = `<path d="M ${cx} ${shoulderY} L ${x + width * 0.28} ${y + height * 0.53} M ${cx} ${shoulderY} L ${x + width * 0.72} ${y + height * 0.53} M ${cx} ${hipY} L ${x + width * 0.38} ${floorY} M ${cx} ${hipY} L ${x + width * 0.62} ${floorY}"/>`;

  if (assetName.includes("걷기")) {
    limbs = `<path d="M ${cx} ${shoulderY} L ${x + width * 0.25} ${y + height * 0.5} M ${cx} ${shoulderY} L ${x + width * 0.75} ${y + height * 0.46} M ${cx} ${hipY} L ${x + width * 0.22} ${floorY} M ${cx} ${hipY} L ${x + width * 0.78} ${floorY}"/>`;
  } else if (assetName.includes("한손")) {
    limbs += `<path d="M ${x + width * 0.72} ${y + height * 0.53} L ${x + width * 0.86} ${floorY}"/>`;
  } else if (assetName.includes("양손")) {
    limbs = `<path d="M ${cx} ${shoulderY} L ${x + width * 0.42} ${y + height * 0.52} L ${cx} ${y + height * 0.58} M ${cx} ${shoulderY} L ${x + width * 0.58} ${y + height * 0.52} L ${cx} ${y + height * 0.58} M ${cx} ${y + height * 0.58} L ${cx} ${floorY} M ${cx} ${hipY} L ${x + width * 0.36} ${floorY} M ${cx} ${hipY} L ${x + width * 0.64} ${floorY}"/>`;
  } else if (assetName.includes("휘두르기")) {
    limbs = `<path d="M ${cx} ${shoulderY} L ${x + width * 0.36} ${y + height * 0.26} L ${x + width * 0.72} ${y + height * 0.12} M ${cx} ${shoulderY} L ${x + width * 0.54} ${y + height * 0.28} L ${x + width * 0.72} ${y + height * 0.12} M ${cx} ${hipY} L ${x + width * 0.34} ${floorY} M ${cx} ${hipY} L ${x + width * 0.68} ${floorY}"/>`;
  } else if (assetName.includes("활")) {
    limbs = `<path d="M ${cx} ${shoulderY} L ${x + width * 0.75} ${shoulderY} M ${cx} ${shoulderY} L ${x + width * 0.3} ${y + height * 0.43} M ${cx} ${hipY} L ${x + width * 0.38} ${floorY} M ${cx} ${hipY} L ${x + width * 0.62} ${floorY} M ${x + width * 0.8} ${y + height * 0.28} Q ${x + width * 0.95} ${shoulderY} ${x + width * 0.8} ${y + height * 0.52}"/>`;
  }

  return `<g fill="none" stroke="#111" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${head}${directionMark}${body}${limbs}</g>`;
}

async function renderGuide(assetName: string, width: number, height: number) {
  const margin = Math.round(Math.min(width, height) * 0.12);
  const { columns, rows } = guideRatio(assetName);
  const maxWidth = width - margin * 2;
  const maxHeight = height - margin * 2;
  const scale = Math.min(maxWidth / columns, maxHeight / rows);
  const rectWidth = Math.round(columns * scale);
  const rectHeight = Math.round(rows * scale);
  const x = Math.round((width - rectWidth) / 2);
  const y = Math.round((height - rectHeight) / 2);
  const stroke = Math.max(6, Math.round(Math.min(width, height) * 0.008));
  let content = `<rect x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}" fill="none" stroke="#111" stroke-width="${stroke}"/>`;

  if (assetName.includes("edge-corner")) {
    content += Array.from({ length: 2 }, (_, index) => {
      const offset = (index + 1) / 3;
      return `<path d="M ${x + rectWidth * offset} ${y} V ${y + rectHeight} M ${x} ${y + rectHeight * offset} H ${x + rectWidth}" fill="none" stroke="#111" stroke-width="${stroke / 2}"/>`;
    }).join("");
  } else if (assetName.includes("4방향")) {
    content += `<path d="M ${x + rectWidth / 2} ${y} V ${y + rectHeight} M ${x} ${y + rectHeight / 2} H ${x + rectWidth}" fill="none" stroke="#111" stroke-width="${stroke / 2}"/>`;
    const cellWidth = rectWidth / 2;
    const cellHeight = rectHeight / 2;
    content += [
      { direction: "front", cellX: x, cellY: y, widthRatio: 0.6 },
      { direction: "back", cellX: x + cellWidth, cellY: y, widthRatio: 0.6 },
      { direction: "right", cellX: x, cellY: y + cellHeight, widthRatio: 0.4 },
      { direction: "left", cellX: x + cellWidth, cellY: y + cellHeight, widthRatio: 0.4 },
    ].map(({ direction, cellX, cellY, widthRatio }) => {
      const poseWidth = cellWidth * widthRatio;
      return poseLines(direction, cellX + (cellWidth - poseWidth) / 2, cellY, poseWidth, cellHeight);
    }).join("");
  } else if (assetName.includes("포즈")) {
    content += poseLines(assetName, x + rectWidth * 0.16, y, rectWidth * 0.68, rectHeight);
  } else {
    for (let column = 1; column < columns; column += 1) {
      const lineX = x + (rectWidth * column) / columns;
      content += `<path d="M ${lineX} ${y} V ${y + rectHeight}" fill="none" stroke="#111" stroke-width="${stroke / 2}"/>`;
    }
    for (let row = 1; row < rows; row += 1) {
      const lineY = y + (rectHeight * row) / rows;
      content += `<path d="M ${x} ${lineY} H ${x + rectWidth}" fill="none" stroke="#111" stroke-width="${stroke / 2}"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${content}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const localRequestId = `asset-${randomUUID()}`;

  try {
    const body = (await request.json()) as AssetRequest;
    const category = typeof body.category === "string" && CATEGORIES.has(body.category) ? body.category : "object";
    const assetName = typeof body.assetName === "string" && body.assetName.trim() ? body.assetName.trim() : "base asset";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const negativePrompt = typeof body.negativePrompt === "string" && body.negativePrompt.trim()
      ? body.negativePrompt.trim()
      : "text, labels, watermark, frame, border, cropped subject, multiple unrelated subjects";
    const size = typeof body.size === "string" && validSize(body.size) ? body.size : "1024x1024";
    const seed = numericSeed(body.seed);
    if (!prompt) return NextResponse.json({ error: "prompt가 필요합니다." }, { status: 400 });
    if (prompt.length > 2_000) return NextResponse.json({ error: "prompt는 2000자 이하여야 합니다." }, { status: 400 });

    const [width, height] = size.split("x").map(Number);
    const inputBuffer = await sharp({
      create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const inputImage = new File([new Uint8Array(inputBuffer)], "blank-white-canvas.png", { type: "image/png" });
    const settings: ImageEditSettings = {
      prompt,
      negativePrompt,
      size,
      seed,
      numInferenceSteps: 40,
      trueCfgScale: 4,
      guidanceScale: 1,
      outputFormat: "png",
    };

    console.info("[BaseAsset][REQUEST_START]", {
      localRequestId,
      category,
      assetName,
      input: { name: inputImage.name, bytes: inputImage.size, size },
      promptCharacters: prompt.length,
      seed,
      steps: settings.numInferenceSteps,
    });

    const result = category === "guide"
      ? {
          requestId: localRequestId,
          model: "local-guide-renderer/v1",
          imageBase64: (await renderGuide(assetName, width, height)).toString("base64"),
          revisedPrompt: null,
          created: Math.floor(Date.now() / 1000),
          responseSize: size,
          outputFormat: "png",
        }
      : await requestImageEdit([inputImage], settings);
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const generationId = `${category.toUpperCase()}-${timestamp}-${randomUUID().slice(0, 8)}`;
    const categoryDirectory = safeSegment(category);
    const outputDirectory = path.join(process.cwd(), "public", "generated", "base-assets", categoryDirectory);
    const inputFilename = `${generationId}-input.png`;
    const outputFilename = `${generationId}.png`;
    const metadataFilename = `${generationId}.json`;
    const outputBuffer = Buffer.from(result.imageBase64, "base64");
    const outputMetadata = await sharp(outputBuffer).metadata();
    const actualSize = outputMetadata.width && outputMetadata.height
      ? `${outputMetadata.width}x${outputMetadata.height}`
      : result.responseSize ?? size;

    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(outputDirectory, inputFilename), inputBuffer),
      writeFile(path.join(outputDirectory, outputFilename), outputBuffer),
      writeFile(path.join(outputDirectory, metadataFilename), JSON.stringify({
        generationId,
        requestId: result.requestId,
        model: result.model,
        createdAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        phase: "base-asset",
        postprocessed: false,
        category,
        assetName,
        input: { filename: inputFilename, size, bytes: inputBuffer.length },
        settings,
        output: { filename: outputFilename, size: actualSize, bytes: outputBuffer.length },
      }, null, 2)),
    ]);

    console.info("[BaseAsset][REQUEST_COMPLETE]", {
      localRequestId,
      generationId,
      category,
      assetName,
      outputSize: actualSize,
      outputBytes: outputBuffer.length,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      generationId,
      requestId: result.requestId,
      model: result.model,
      category,
      assetName,
      prompt,
      seed,
      inputImageUrl: `/generated/base-assets/${categoryDirectory}/${inputFilename}`,
      imageUrl: `/generated/base-assets/${categoryDirectory}/${outputFilename}`,
      metadataUrl: `/generated/base-assets/${categoryDirectory}/${metadataFilename}`,
      inputSize: size,
      outputSize: actualSize,
      elapsedMs: Date.now() - startedAt,
      postprocessed: false,
    });
  } catch (error) {
    const status = error instanceof RunPodConfigurationError ? 503 : error instanceof RunPodUpstreamError ? error.status : 500;
    const message = error instanceof Error ? error.message : "기준 에셋 생성 실패";
    const requestId = error instanceof RunPodUpstreamError ? error.requestId : localRequestId;
    console.error("[BaseAsset][REQUEST_FAILED]", { localRequestId, requestId, status, message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}
