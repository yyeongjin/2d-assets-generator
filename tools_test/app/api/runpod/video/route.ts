import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  requestWalkVideo,
  RunPodVideoConfigurationError,
  RunPodVideoUpstreamError,
  type VideoDirection,
  type VideoGenerationSettings,
} from "@/lib/runpod-video-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1_300;

const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;
const DIRECTIONS: VideoDirection[] = ["front", "back", "right", "left"];
const DIRECTION_LABELS: Record<VideoDirection, string> = {
  front: "정면",
  back: "후면",
  right: "오른쪽",
  left: "왼쪽",
};
const VIEW_PROMPTS: Record<VideoDirection, string> = {
  front: "front-view",
  back: "back-view",
  right: "right-facing side-view",
  left: "left-facing side-view",
};

const TRAVEL_ACTIONS: Record<VideoDirection, string> = {
  front: "walks toward the camera",
  back: "walks away from the camera",
  right: "walks to the right across the frame",
  left: "walks to the left across the frame",
};

function textValue(form: FormData, key: string, fallback = "") {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(form: FormData, key: string, fallback: number, min: number, max: number) {
  const value = Number(textValue(form, key, String(fallback)));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function cropForDirection(direction: VideoDirection, width: number, height: number) {
  const leftWidth = Math.floor(width / 2);
  const topHeight = Math.floor(height / 2);
  const rightWidth = width - leftWidth;
  const bottomHeight = height - topHeight;
  if (direction === "front") return { left: 0, top: 0, width: leftWidth, height: topHeight };
  if (direction === "back") return { left: leftWidth, top: 0, width: rightWidth, height: topHeight };
  if (direction === "right") return { left: 0, top: topHeight, width: leftWidth, height: bottomHeight };
  return { left: leftWidth, top: topHeight, width: rightWidth, height: bottomHeight };
}

async function extractFrames(videoPath: string, framesDirectory: string, sampleFps: number, maxFrames: number) {
  await mkdir(framesDirectory, { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const framePattern = path.join(framesDirectory, "frame-%03d.png");
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", videoPath,
    "-vf", `fps=${sampleFps}`,
    "-frames:v", String(maxFrames),
    "-start_number", "1",
    framePattern,
  ];

  console.info("[WalkVideo][FRAME_EXTRACTION_START]", { videoPath, framesDirectory, sampleFps, maxFrames, ffmpeg });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg 프레임 추출 실패 (${code}): ${stderr.slice(-1_000)}`)));
  });
  const frames = (await readdir(framesDirectory)).filter((file) => /^frame-\d+\.png$/.test(file)).sort();
  if (!frames.length) throw new Error("FFmpeg가 프레임을 생성하지 않았습니다.");
  console.info("[WalkVideo][FRAME_EXTRACTION_COMPLETE]", { frames: frames.length, framesDirectory });
  return frames;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const localRequestId = `walk-${randomUUID()}`;
  try {
    const form = await request.formData();
    const image = form.get("image");
    const directionValue = textValue(form, "direction");
    if (!(image instanceof File) || !image.type.startsWith("image/") || image.size <= 0 || image.size > MAX_REFERENCE_BYTES) {
      return NextResponse.json({ error: "30MB 이하의 4방향 캐릭터·생명체 시트가 필요합니다." }, { status: 400 });
    }
    if (!DIRECTIONS.includes(directionValue as VideoDirection)) {
      return NextResponse.json({ error: "direction은 front, back, right, left 중 하나여야 합니다." }, { status: 400 });
    }
    const direction = directionValue as VideoDirection;
    const motionModeValue = textValue(form, "motionMode", "travel");
    const motionMode = motionModeValue === "in_place" ? "in_place" : motionModeValue === "tracking" ? "tracking" : "travel";
    const sourceType = textValue(form, "sourceType", "character") === "creature" ? "creature" : "character";
    const sourceId = textValue(form, "sourceId", "unknown-source").replace(/[^A-Za-z0-9._-]/g, "-");
    const sourceBuffer = Buffer.from(await image.arrayBuffer());
    const sourceMetadata = await sharp(sourceBuffer).metadata();
    if (!sourceMetadata.width || !sourceMetadata.height || sourceMetadata.width < 2 || sourceMetadata.height < 2) {
      return NextResponse.json({ error: "4방향 시트 크기를 읽을 수 없습니다." }, { status: 400 });
    }

    const outputWidth = numberValue(form, "width", 480, 256, 1280);
    const outputHeight = numberValue(form, "height", 832, 256, 1280);
    const crop = cropForDirection(direction, sourceMetadata.width, sourceMetadata.height);
    const directionBuffer = await sharp(sourceBuffer)
      .extract(crop)
      .resize(outputWidth, outputHeight, { fit: "contain", background: { r: 255, g: 255, b: 255 }, kernel: "lanczos3" })
      .png()
      .toBuffer();
    const reference = new File([new Uint8Array(directionBuffer)], `${sourceType}-${direction}-walk-reference.png`, { type: "image/png" });
    const prompt = motionMode === "travel"
      ? `Smooth natural walk: the character ${TRAVEL_ACTIONS[direction]}, ${VIEW_PROMPTS[direction]}, full body, clear alternating steps, static camera. Keep the same character and white background.`
      : motionMode === "tracking"
        ? `Smooth natural walk, ${VIEW_PROMPTS[direction]}, full body, clear alternating steps. Track the walking character at the same scale. Keep the same character and white background.`
        : `Smooth walk cycle in place, ${VIEW_PROMPTS[direction]}, full body, clear alternating steps, no head tilting, no camera movement. Keep the same character and white background.`;
    const settings: VideoGenerationSettings = {
      prompt,
      negativePrompt: "low quality, blurry, static, dancing, pointing, turning, changing character",
      width: outputWidth,
      height: outputHeight,
      numFrames: numberValue(form, "numFrames", 81, 9, 121),
      fps: numberValue(form, "fps", 16, 1, 30),
      numInferenceSteps: numberValue(form, "numInferenceSteps", 50, 1, 80),
      guidanceScale: numberValue(form, "guidanceScale", 4, 0, 20),
      flowShift: numberValue(form, "flowShift", 12, 0, 30),
      seed: numberValue(form, "seed", 4821, 0, 2_147_483_647),
    };

    console.info("[WalkVideo][REQUEST_START]", {
      localRequestId,
      sourceType,
      sourceId,
      direction,
      motionMode,
      directionLabel: DIRECTION_LABELS[direction],
      sourceSize: `${sourceMetadata.width}x${sourceMetadata.height}`,
      crop,
      preparedSize: `${outputWidth}x${outputHeight}`,
      promptCharacters: prompt.length,
      videoSettings: {
        width: settings.width,
        height: settings.height,
        numFrames: settings.numFrames,
        fps: settings.fps,
        numInferenceSteps: settings.numInferenceSteps,
        guidanceScale: settings.guidanceScale,
        flowShift: settings.flowShift,
        seed: settings.seed,
      },
    });

    const result = await requestWalkVideo(reference, settings);
    const generationId = `WALK-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${direction.toUpperCase()}-${randomUUID().slice(0, 8)}`;
    const relativeDirectory = path.join("generated", "walk-videos", generationId);
    const outputDirectory = path.join("public", "generated", "walk-videos", generationId);
    const framesDirectory = path.join(outputDirectory, "frames");
    const referenceFilename = "reference.png";
    const videoFilename = "walk.mp4";
    const metadataFilename = "metadata.json";
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(outputDirectory, referenceFilename), directionBuffer),
      writeFile(path.join(outputDirectory, videoFilename), result.videoBuffer),
    ]);
    const sampleFps = numberValue(form, "sampleFps", 8, 1, settings.fps);
    const maxFrames = numberValue(form, "maxFrames", 32, 4, 121);
    const frameFiles = await extractFrames(path.join(outputDirectory, videoFilename), framesDirectory, sampleFps, maxFrames);
    const publicBase = `/${relativeDirectory.split(path.sep).join("/")}`;
    const metadata = {
      generationId,
      requestId: result.requestId,
      jobId: result.jobId,
      model: result.model,
      createdAt: new Date().toISOString(),
      experiment: motionMode === "travel" ? "walk-v6-official-sampling-travel" : motionMode === "tracking" ? "walk-v6-official-sampling-tracking" : "walk-v6-official-sampling-in-place",
      elapsedMs: Date.now() - startedAt,
      source: { type: sourceType, id: sourceId, filename: image.name, size: `${sourceMetadata.width}x${sourceMetadata.height}` },
      crop: { direction, label: DIRECTION_LABELS[direction], motionMode, ...crop, preparedSize: `${outputWidth}x${outputHeight}`, referenceFilename },
      settings,
      output: { videoFilename, videoBytes: result.videoBuffer.length, contentType: result.contentType, sampleFps, maxFrames, frameFiles },
      postprocess: { visualChanges: false, operations: ["extract-direction-cell", "extract-frames"] },
    };
    await writeFile(path.join(outputDirectory, metadataFilename), JSON.stringify(metadata, null, 2));

    console.info("[WalkVideo][REQUEST_COMPLETE]", {
      localRequestId,
      generationId,
      jobId: result.jobId,
      direction,
      videoBytes: result.videoBuffer.length,
      frameCount: frameFiles.length,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      ok: true,
      generationId,
      requestId: result.requestId,
      jobId: result.jobId,
      model: result.model,
      sourceType,
      sourceId,
      direction,
      directionLabel: DIRECTION_LABELS[direction],
      motionMode,
      prompt,
      seed: settings.seed,
      referenceImageUrl: `${publicBase}/${referenceFilename}`,
      videoUrl: `${publicBase}/${videoFilename}`,
      frameUrls: frameFiles.map((file) => `${publicBase}/frames/${file}`),
      metadataUrl: `${publicBase}/${metadataFilename}`,
      outputSize: `${outputWidth}x${outputHeight}`,
      frameCount: frameFiles.length,
      sampleFps,
      elapsedMs: Date.now() - startedAt,
      postprocessed: false,
    });
  } catch (error) {
    const status = error instanceof RunPodVideoConfigurationError ? 503 : error instanceof RunPodVideoUpstreamError ? error.status : 500;
    const requestId = error instanceof RunPodVideoUpstreamError ? error.requestId : localRequestId;
    const message = error instanceof Error ? error.message : "걷기 영상 생성 실패";
    console.error("[WalkVideo][REQUEST_FAILED]", { localRequestId, requestId, status, message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}
