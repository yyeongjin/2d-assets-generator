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

const DEFAULT_SIZE = "1024x1024";
const DEFAULT_PROMPT = [
  "Create one 2x2 turnaround sheet of one full-body character on a plain white background.",
  "Top-left: front view. Top-right: back view. Bottom-left: right profile facing right. Bottom-right: left profile facing left.",
  "Show each character head-to-toe at equal height with feet on the same line.",
  "Keep identity, clothes, colors, and proportions identical. No text, borders, props, shadows, or cropping.",
].join(" ");

type CharacterRequest = {
  prompt?: unknown;
  seed?: unknown;
  size?: unknown;
};

function validSize(value: string) {
  return /^(512|768|1024)x(512|768|1024)$/.test(value);
}

function numericSeed(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4821;
  return Math.min(2_147_483_647, Math.max(0, Math.round(parsed)));
}

export async function GET() {
  try {
    const outputDirectory = path.join(process.cwd(), "public", "generated", "character-sheets");
    const files = (await readdir(outputDirectory)).filter((file) => /^CHARACTER-.*\.json$/.test(file)).sort().reverse();
    const metadataFilename = files[0];
    if (!metadataFilename) return NextResponse.json({ error: "저장된 캐릭터 기준이 없습니다." }, { status: 404 });
    const metadata = JSON.parse(await readFile(path.join(outputDirectory, metadataFilename), "utf8")) as {
      generationId: string; requestId: string; model: string; elapsedMs: number;
      input: { filename: string; size: string };
      settings: ImageEditSettings;
      output: { filename: string; size: string };
      cells?: string[];
    };
    return NextResponse.json({
      ok: true,
      generationId: metadata.generationId,
      requestId: metadata.requestId,
      model: metadata.model,
      prompt: metadata.settings.prompt,
      seed: metadata.settings.seed,
      inputImageUrl: `/generated/character-sheets/${metadata.input.filename}`,
      imageUrl: `/generated/character-sheets/${metadata.output.filename}`,
      metadataUrl: `/generated/character-sheets/${metadataFilename}`,
      inputSize: metadata.input.size,
      outputSize: metadata.output.size,
      elapsedMs: metadata.elapsedMs,
      cells: metadata.cells ?? ["front", "back", "right", "left"],
      postprocessed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "최근 캐릭터 기준 조회 실패";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const localRequestId = `character-${randomUUID()}`;

  try {
    const body = (await request.json()) as CharacterRequest;
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : DEFAULT_PROMPT;
    const size = typeof body.size === "string" && validSize(body.size) ? body.size : DEFAULT_SIZE;
    const seed = numericSeed(body.seed);
    if (prompt.length > 2_000) {
      return NextResponse.json({ error: "prompt는 2000자 이하여야 합니다." }, { status: 400 });
    }

    const [width, height] = size.split("x").map(Number);
    const inputBuffer = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    }).png().toBuffer();
    const inputImage = new File([new Uint8Array(inputBuffer)], "blank-white-canvas.png", { type: "image/png" });
    const settings: ImageEditSettings = {
      prompt,
      negativePrompt: "different characters, inconsistent clothes, inconsistent scale, cropped body, text, panel borders",
      size,
      seed,
      numInferenceSteps: 40,
      trueCfgScale: 4,
      guidanceScale: 1,
      outputFormat: "png",
    };

    console.info("[CharacterSheet][REQUEST_START]", {
      localRequestId,
      input: { name: inputImage.name, bytes: inputImage.size, size },
      promptCharacters: prompt.length,
      seed,
      steps: settings.numInferenceSteps,
    });

    const result = await requestImageEdit([inputImage], settings);
    const generationId = `CHARACTER-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const outputDirectory = path.join(process.cwd(), "public", "generated", "character-sheets");
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
      writeFile(
        path.join(outputDirectory, metadataFilename),
        JSON.stringify({
          generationId,
          requestId: result.requestId,
          model: result.model,
          createdAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          phase: "four-direction-character-reference",
          postprocessed: false,
          input: { filename: inputFilename, size, bytes: inputBuffer.length },
          settings,
          output: { filename: outputFilename, size: actualSize, bytes: outputBuffer.length },
          cells: ["front", "back", "right", "left"],
        }, null, 2),
      ),
    ]);

    console.info("[CharacterSheet][REQUEST_COMPLETE]", {
      localRequestId,
      generationId,
      upstreamRequestId: result.requestId,
      model: result.model,
      inputSize: size,
      outputSize: actualSize,
      outputBytes: outputBuffer.length,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      generationId,
      requestId: result.requestId,
      model: result.model,
      prompt,
      seed,
      inputImageUrl: `/generated/character-sheets/${inputFilename}`,
      imageUrl: `/generated/character-sheets/${outputFilename}`,
      metadataUrl: `/generated/character-sheets/${metadataFilename}`,
      inputSize: size,
      outputSize: actualSize,
      elapsedMs: Date.now() - startedAt,
      cells: ["front", "back", "right", "left"],
      postprocessed: false,
    });
  } catch (error) {
    const status = error instanceof RunPodConfigurationError ? 503 : error instanceof RunPodUpstreamError ? error.status : 500;
    const message = error instanceof Error ? error.message : "4방향 캐릭터 생성 실패";
    const requestId = error instanceof RunPodUpstreamError ? error.requestId : localRequestId;
    console.error("[CharacterSheet][REQUEST_FAILED]", {
      localRequestId,
      requestId,
      status,
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}
