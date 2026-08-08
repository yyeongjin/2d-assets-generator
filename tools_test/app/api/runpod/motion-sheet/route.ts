import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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

const DIRECTIONS = ["front", "back", "right", "left"] as const;
type Direction = typeof DIRECTIONS[number];

const DIRECTION_LABELS: Record<Direction, string> = {
  front: "front view facing the camera",
  back: "back view facing away from the camera",
  right: "right profile facing right",
  left: "left profile facing left",
};

const FRAME_LABELS = [
  "Left reach — screen-left foot swings forward before landing",
  "Left contact — screen-left foot lands and takes weight",
  "Right passing — screen-right foot passes the body",
  "Right up — screen-right foot prepares to land",
  "Right reach — screen-right foot swings forward before landing",
  "Right contact — screen-right foot lands and takes weight",
  "Left passing — screen-left foot passes the body",
  "Left up — screen-left foot prepares to land",
] as const;

function textValue(form: FormData, key: string, fallback = "") {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numericSeed(form: FormData) {
  const parsed = Number(textValue(form, "seed", "4821"));
  if (!Number.isFinite(parsed)) return 4821;
  return Math.min(2_147_483_647, Math.max(0, Math.round(parsed)));
}

function numericFrame(form: FormData) {
  const parsed = Number(textValue(form, "frameNumber", "0"));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 0;
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "unknown-source";
}

function cropFor(direction: Direction, width: number, height: number) {
  const leftWidth = Math.floor(width / 2);
  const topHeight = Math.floor(height / 2);
  const rightWidth = width - leftWidth;
  const bottomHeight = height - topHeight;
  if (direction === "front") return { left: 0, top: 0, width: leftWidth, height: topHeight };
  if (direction === "back") return { left: leftWidth, top: 0, width: rightWidth, height: topHeight };
  if (direction === "right") return { left: 0, top: topHeight, width: leftWidth, height: bottomHeight };
  return { left: leftWidth, top: topHeight, width: rightWidth, height: bottomHeight };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const localRequestId = `motion-frame-${randomUUID()}`;

  try {
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0 || image.size > 30 * 1024 * 1024) {
      return NextResponse.json({ error: "30MB 이하의 기준 이미지가 필요합니다." }, { status: 400 });
    }

    const directionValue = textValue(form, "direction");
    if (!DIRECTIONS.includes(directionValue as Direction)) {
      return NextResponse.json({ error: "direction은 front, back, right, left 중 하나여야 합니다." }, { status: 400 });
    }
    const direction = directionValue as Direction;
    const frameNumber = numericFrame(form);
    if (!frameNumber) {
      return NextResponse.json({ error: "frameNumber는 1부터 8 사이의 정수여야 합니다." }, { status: 400 });
    }
    const prompt = textValue(form, "prompt");
    if (!prompt) {
      return NextResponse.json({ error: "선택한 프레임의 독립 프롬프트가 필요합니다." }, { status: 400 });
    }
    if (prompt.length > 2_000) {
      return NextResponse.json({ error: "prompt는 2000자 이하여야 합니다." }, { status: 400 });
    }
    const sourceId = safeId(textValue(form, "sourceId", "unknown-source"));
    const sourceType = textValue(form, "sourceType", "character") === "creature" ? "creature" : "character";
    const referenceKind = textValue(form, "referenceKind", "direction-sheet") === "previous-frame" ? "previous-frame" : "direction-sheet";
    const referenceGenerationId = safeId(textValue(form, "referenceGenerationId", sourceId));
    const seed = numericSeed(form);
    const inputBuffer = Buffer.from(await image.arrayBuffer());
    const inputMetadata = await sharp(inputBuffer).metadata();
    const width = inputMetadata.width ?? 0;
    const height = inputMetadata.height ?? 0;
    if (width < 2 || height < 2) {
      return NextResponse.json({ error: "기준 이미지 크기를 읽을 수 없습니다." }, { status: 400 });
    }

    const crop = referenceKind === "direction-sheet" ? cropFor(direction, width, height) : null;
    const directionBuffer = crop
      ? await sharp(inputBuffer).extract(crop).png().toBuffer()
      : await sharp(inputBuffer).png().toBuffer();
    const reference = new File(
      [new Uint8Array(directionBuffer)],
      `${sourceType}-${direction}-reference.png`,
      { type: "image/png" },
    );
    const settings: ImageEditSettings = {
      prompt,
      negativePrompt: "different character, changed clothes, changed colors, cropped body, text, frame border, multiple characters, sprite sheet, side step, lateral lunge, jumping jack, legs spread sideways, wide lateral stance, neutral standing pose",
      size: "1024x1024",
      seed,
      numInferenceSteps: 40,
      trueCfgScale: 4,
      guidanceScale: 1,
      outputFormat: "png",
    };

    console.info("[MotionFrame][REQUEST_START]", {
      localRequestId,
      sourceId,
      sourceType,
      direction,
      frameNumber,
      referenceKind,
      referenceGenerationId,
      crop,
      referenceBytes: directionBuffer.length,
      promptCharacters: prompt.length,
      seed,
      queue: "upstream-managed",
    });

    const result = await requestImageEdit([reference], settings);
    const generationId = `MOTION-FRAME-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${direction.toUpperCase()}-${String(frameNumber).padStart(2, "0")}-${randomUUID().slice(0, 8)}`;
    const outputDirectory = path.join(process.cwd(), "public", "generated", "motion-frames", sourceId, direction);
    const referenceFilename = `${generationId}-reference.png`;
    const outputFilename = `${generationId}.png`;
    const metadataFilename = `${generationId}.json`;
    const outputBuffer = Buffer.from(result.imageBase64, "base64");
    const outputMetadata = await sharp(outputBuffer).metadata();
    const outputSize = outputMetadata.width && outputMetadata.height
      ? `${outputMetadata.width}x${outputMetadata.height}`
      : result.responseSize ?? settings.size;

    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(outputDirectory, referenceFilename), directionBuffer),
      writeFile(path.join(outputDirectory, outputFilename), outputBuffer),
      writeFile(path.join(outputDirectory, metadataFilename), JSON.stringify({
        generationId,
        requestId: result.requestId,
        model: result.model,
        createdAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        source: { id: sourceId, type: sourceType, referenceKind, referenceGenerationId, originalSize: `${width}x${height}`, crop },
        direction,
        frame: { number: frameNumber, label: FRAME_LABELS[frameNumber - 1] },
        queue: "upstream-managed",
        prompt,
        settings,
        input: { filename: referenceFilename, bytes: directionBuffer.length },
        output: { filename: outputFilename, bytes: outputBuffer.length, size: outputSize },
        postprocessed: false,
      }, null, 2)),
    ]);

    const publicBase = `/generated/motion-frames/${sourceId}/${direction}`;
    console.info("[MotionFrame][REQUEST_COMPLETE]", {
      localRequestId,
      requestId: result.requestId,
      generationId,
      direction,
      frameNumber,
      outputSize,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      ok: true,
      generationId,
      requestId: result.requestId,
      model: result.model,
      sourceId,
      sourceType,
      direction,
      directionLabel: DIRECTION_LABELS[direction],
      frameNumber,
      frameLabel: FRAME_LABELS[frameNumber - 1],
      referenceKind,
      referenceGenerationId,
      prompt,
      seed,
      referenceImageUrl: `${publicBase}/${referenceFilename}`,
      imageUrl: `${publicBase}/${outputFilename}`,
      metadataUrl: `${publicBase}/${metadataFilename}`,
      outputSize,
      elapsedMs: Date.now() - startedAt,
      queue: "upstream-managed",
      postprocessed: false,
    });
  } catch (error) {
    const status = error instanceof RunPodConfigurationError ? 503 : error instanceof RunPodUpstreamError ? error.status : 500;
    const message = error instanceof Error ? error.message : "걷기 프레임 생성 실패";
    const requestId = error instanceof RunPodUpstreamError ? error.requestId : localRequestId;
    console.error("[MotionFrame][REQUEST_FAILED]", { localRequestId, requestId, status, message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}
