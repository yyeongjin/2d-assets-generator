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

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
function textValue(form: FormData, key: string, fallback = "") {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function numericValue(form: FormData, key: string, fallback: number, min: number, max: number) {
  const value = Number(textValue(form, key, String(fallback)));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function validateSize(value: string) {
  if (!/^\d{2,4}x\d{2,4}$/.test(value)) return false;
  const [width, height] = value.split("x").map(Number);
  return width >= 256 && width <= 2048 && height >= 256 && height <= 2048;
}

function imageExtension(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return "png";
}

function pngDimensions(buffer: Buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height, size: `${width}x${height}` };
}

function layoutNumber(form: FormData, key: string) {
  return Math.round(numericValue(form, key, 0, 0, 4096));
}

function safeAssetSegment(value: string) {
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : "";
}

async function validateLayoutContainment(imageBuffer: Buffer, layout: { frameX: number; frameY: number; frameWidth: number; frameHeight: number; strokeWidth: number }) {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let foregroundPixels = 0;
  const whiteThreshold = 245;
  const frame = {
    left: layout.frameX,
    top: layout.frameY,
    right: layout.frameX + layout.frameWidth - 1,
    bottom: layout.frameY + layout.frameHeight - 1,
  };
  const outlineBounds = {
    left: Math.max(0, frame.left - layout.strokeWidth),
    top: Math.max(0, frame.top - layout.strokeWidth),
    right: Math.min(info.width - 1, frame.right + 1 + layout.strokeWidth),
    bottom: Math.min(info.height - 1, frame.bottom + 1 + layout.strokeWidth),
  };
  const isOutlineBand = (x: number, y: number) => (
    (x >= outlineBounds.left && x <= frame.left && y >= outlineBounds.top && y <= outlineBounds.bottom)
    || (x >= frame.right + 1 && x <= outlineBounds.right && y >= outlineBounds.top && y <= outlineBounds.bottom)
    || (y >= outlineBounds.top && y <= frame.top && x >= outlineBounds.left && x <= outlineBounds.right)
    || (y >= frame.bottom + 1 && y <= outlineBounds.bottom && x >= outlineBounds.left && x <= outlineBounds.right)
  );
  minX = info.width;
  minY = info.height;
  maxX = -1;
  maxY = -1;
  foregroundPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (isOutlineBand(x, y)) continue;
      const offset = (y * info.width + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      if (alpha <= 8 || (red >= whiteThreshold && green >= whiteThreshold && blue >= whiteThreshold)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      foregroundPixels += 1;
    }
  }
  const darkCoverage = (left: number, top: number, right: number, bottom: number) => {
    let darkPixels = 0;
    let pixels = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const offset = (y * info.width + x) * 4;
        if (data[offset + 3] > 8 && data[offset] < 80 && data[offset + 1] < 80 && data[offset + 2] < 80) darkPixels += 1;
        pixels += 1;
      }
    }
    return pixels ? darkPixels / pixels : 0;
  };
  const outlineCoverage = {
    left: darkCoverage(outlineBounds.left, outlineBounds.top, frame.left, outlineBounds.bottom),
    top: darkCoverage(outlineBounds.left, outlineBounds.top, outlineBounds.right, frame.top),
    right: darkCoverage(frame.right + 1, outlineBounds.top, outlineBounds.right, outlineBounds.bottom),
    bottom: darkCoverage(outlineBounds.left, frame.bottom + 1, outlineBounds.right, outlineBounds.bottom),
  };
  const outline = { ok: Object.values(outlineCoverage).every((value) => value >= 0.5), bounds: outlineBounds, coverage: outlineCoverage };
  const content = foregroundPixels > 0 ? { left: minX, top: minY, right: maxX, bottom: maxY } : null;
  const overflow = content ? {
    left: Math.max(0, frame.left - content.left),
    top: Math.max(0, frame.top - content.top),
    right: Math.max(0, content.right - frame.right),
    bottom: Math.max(0, content.bottom - frame.bottom),
  } : { left: 0, top: 0, right: 0, bottom: 0 };
  const edgeContactTolerance = 2;
  const contact = content ? {
    topDelta: content.top - frame.top,
    bottomDelta: frame.bottom - content.bottom,
    top: Math.abs(content.top - frame.top) <= edgeContactTolerance,
    bottom: Math.abs(frame.bottom - content.bottom) <= edgeContactTolerance,
  } : { topDelta: 0, bottomDelta: 0, top: false, bottom: false };
  const ok = outline.ok
    && Boolean(content)
    && Object.values(overflow).every((value) => value === 0)
    && contact.top
    && contact.bottom;
  return { ok, canvas: { width: info.width, height: info.height }, frame, outline, content, overflow, contact, edgeContactTolerance, foregroundPixels, whiteThreshold };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const form = await request.formData();
    const images = form.getAll("image").filter((value): value is File => value instanceof File);
    const prompt = textValue(form, "prompt");
    const size = textValue(form, "size", "512x1024");

    if (images.length < 1 || images.length > 3) {
      return NextResponse.json({ error: "Reference 이미지는 1~3장이 필요합니다." }, { status: 400 });
    }
    if (images.some((image) => image.size <= 0 || image.size > MAX_REFERENCE_BYTES || !image.type.startsWith("image/"))) {
      return NextResponse.json({ error: "Reference는 장당 20MB 이하 이미지 파일이어야 합니다." }, { status: 400 });
    }
    if (!prompt || prompt.length > 8_000) {
      return NextResponse.json({ error: "prompt는 1~8000자여야 합니다." }, { status: 400 });
    }
    if (!validateSize(size)) {
      return NextResponse.json({ error: "size는 256~2048 범위의 WIDTHxHEIGHT 형식이어야 합니다." }, { status: 400 });
    }

    const settings: ImageEditSettings = {
      prompt,
      negativePrompt: textValue(form, "negativePrompt"),
      size,
      seed: Math.round(numericValue(form, "seed", 4821, 0, 2_147_483_647)),
      numInferenceSteps: Math.round(numericValue(form, "numInferenceSteps", 40, 1, 100)),
      trueCfgScale: numericValue(form, "trueCfgScale", 4, 0, 20),
      guidanceScale: numericValue(form, "guidanceScale", 1, 0, 20),
      outputFormat: "png",
    };
    const layout = {
      frameX: layoutNumber(form, "frameX"),
      frameY: layoutNumber(form, "frameY"),
      frameWidth: layoutNumber(form, "frameWidth"),
      frameHeight: layoutNumber(form, "frameHeight"),
      baselineY: layoutNumber(form, "baselineY"),
      strokeWidth: layoutNumber(form, "strokeWidth"),
    };
    const selection = {
      category: textValue(form, "category"),
      direction: textValue(form, "direction"),
      action: textValue(form, "action"),
      frameId: textValue(form, "frameId"),
      frameIndex: Math.round(numericValue(form, "frameIndex", 0, 0, 99)),
    };
    const assetBundle = safeAssetSegment(textValue(form, "assetBundle"));
    const assetName = safeAssetSegment(textValue(form, "assetName"));
    const mirrorDirection = safeAssetSegment(textValue(form, "mirrorDirection"));
    const mirrorAssetName = safeAssetSegment(textValue(form, "mirrorAssetName"));
    if (assetBundle) {
      const batchSteps = Number(process.env.RUNPOD_BATCH_INFERENCE_STEPS ?? "20");
      if (selection.action === "direction_reference") settings.numInferenceSteps = 40;
      else if (Number.isFinite(batchSteps)) settings.numInferenceSteps = Math.min(settings.numInferenceSteps, Math.max(1, Math.round(batchSteps)));
    }
    const result = await requestImageEdit(images, settings);

    const generationId = `RUNPOD-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const outputDirectory = path.join(process.cwd(), "public", "generated", "runpod");
    const imageFilename = `${generationId}.png`;
    const metadataFilename = `${generationId}.json`;
    const imageBuffer = Buffer.from(result.imageBase64, "base64");
    const layoutValidation = selection.category === "character" ? await validateLayoutContainment(imageBuffer, layout) : null;
    const referenceImages = await Promise.all(images.map(async (image, index) => {
      const label = String.fromCharCode(97 + index);
      const filename = `${generationId}-reference-${label}.${imageExtension(image.type)}`;
      const buffer = Buffer.from(await image.arrayBuffer());
      const dimensions = pngDimensions(buffer);
      return {
        name: image.name,
        type: image.type,
        bytes: buffer.length,
        filename,
        url: `/generated/runpod/${filename}`,
        ...dimensions,
        buffer,
      };
    }));
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, imageFilename), imageBuffer);
    await Promise.all(referenceImages.map((image) => writeFile(path.join(outputDirectory, image.filename), image.buffer)));
    await writeFile(
      path.join(outputDirectory, metadataFilename),
      JSON.stringify(
        {
          generationId,
          requestId: result.requestId,
          model: result.model,
          createdAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          input: referenceImages.map((image) => ({ name: image.name, type: image.type, bytes: image.bytes, filename: image.filename, url: image.url, width: image.width, height: image.height, size: image.size })),
          layout,
          layoutValidation,
          selection,
          settings,
          output: { filename: imageFilename, bytes: imageBuffer.length, size: result.responseSize, format: result.outputFormat },
        },
        null,
        2,
      ),
    );

    if (layoutValidation && !layoutValidation.ok) {
      const content = layoutValidation.content;
      const outlineDetail = `outline L${layoutValidation.outline.coverage.left.toFixed(2)} T${layoutValidation.outline.coverage.top.toFixed(2)} R${layoutValidation.outline.coverage.right.toFixed(2)} B${layoutValidation.outline.coverage.bottom.toFixed(2)}`;
      const contactDetail = `top ${layoutValidation.contact.topDelta}px, bottom ${layoutValidation.contact.bottomDelta}px`;
      const message = !layoutValidation.outline.ok
        ? `검은 crop outline이 보존되지 않았습니다. ${outlineDetail} · 접촉 오차 ${contactDetail}`
        : !layoutValidation.contact.top || !layoutValidation.contact.bottom
          ? `캐릭터의 머리와 발이 crop rect의 위·아래 변에 닿지 않았습니다. 접촉 오차 ${contactDetail}`
        : content
          ? `생성 결과가 crop rect 밖으로 나갔습니다. content x${content.left}~${content.right} y${content.top}~${content.bottom}, frame x${layoutValidation.frame.left}~${layoutValidation.frame.right} y${layoutValidation.frame.top}~${layoutValidation.frame.bottom}`
          : "생성 결과에서 캐릭터 영역을 찾지 못했습니다.";
      console.warn("[RunPod][LAYOUT_VALIDATION_FAILED]", { generationId, selection, ...layoutValidation });
      return NextResponse.json({
        error: message,
        code: "LAYOUT_VIOLATION",
        retryable: false,
        generationId,
        requestId: result.requestId,
        model: result.model,
        imageUrl: `/generated/runpod/${imageFilename}`,
        metadataUrl: `/generated/runpod/${metadataFilename}`,
        elapsedMs: Date.now() - startedAt,
        outputBytes: imageBuffer.length,
        size: result.responseSize ?? pngDimensions(imageBuffer)?.size ?? size,
        seed: settings.seed,
        referenceImages: referenceImages.map((image) => ({
          name: image.name,
          type: image.type,
          bytes: image.bytes,
          filename: image.filename,
          url: image.url,
          width: image.width,
          height: image.height,
          size: image.size,
        })),
        layout,
        layoutValidation,
        selection,
      }, { status: 422 });
    }

    let bundleImageUrl: string | null = null;
    let bundleMetadataUrl: string | null = null;
    let mirroredImageUrl: string | null = null;
    let mirroredBundleImageUrl: string | null = null;
    let mirroredBundleMetadataUrl: string | null = null;
    if (assetBundle && assetName) {
      const directionDirectory = safeAssetSegment(selection.direction) || "shared";
      const bundleDirectory = path.join(process.cwd(), "public", "generated", "bundles", assetBundle, directionDirectory);
      const bundleFilename = `${assetName}.png`;
      const bundleMetadataFilename = `${assetName}.json`;
      await mkdir(bundleDirectory, { recursive: true });
      await writeFile(path.join(bundleDirectory, bundleFilename), imageBuffer);
      await writeFile(
        path.join(bundleDirectory, bundleMetadataFilename),
        JSON.stringify({ phase: "i2i-raw", generationId, requestId: result.requestId, model: result.model, createdAt: new Date().toISOString(), selection, layout, settings, output: { filename: bundleFilename, bytes: imageBuffer.length, size: result.responseSize, format: "png" } }, null, 2),
      );
      bundleImageUrl = `/generated/bundles/${assetBundle}/${directionDirectory}/${bundleFilename}`;
      bundleMetadataUrl = `/generated/bundles/${assetBundle}/${directionDirectory}/${bundleMetadataFilename}`;
      console.info("[RunPod][RAW_BUNDLE_SAVED]", { assetBundle, direction: directionDirectory, assetName, bundleImageUrl, output: result.responseSize });

      if (mirrorDirection && mirrorAssetName) {
        const mirroredRawFilename = `${generationId}-mirror.png`;
        const mirroredRawBuffer = await sharp(imageBuffer).flop().png().toBuffer();
        const mirroredBundleDirectory = path.join(process.cwd(), "public", "generated", "bundles", assetBundle, mirrorDirection);
        const mirroredBundleFilename = `${mirrorAssetName}.png`;
        const mirroredMetadataFilename = `${mirrorAssetName}.json`;
        const mirroredSelection = { ...selection, direction: mirrorDirection, frameId: mirrorAssetName };
        await mkdir(mirroredBundleDirectory, { recursive: true });
        await writeFile(path.join(outputDirectory, mirroredRawFilename), mirroredRawBuffer);
        await writeFile(path.join(mirroredBundleDirectory, mirroredBundleFilename), mirroredRawBuffer);
        await writeFile(path.join(mirroredBundleDirectory, mirroredMetadataFilename), JSON.stringify({ phase: "i2i-raw", generationId: `${generationId}-mirror`, sourceGenerationId: generationId, transform: "horizontal-flip", createdAt: new Date().toISOString(), selection: mirroredSelection, layout, settings, output: { filename: mirroredBundleFilename, bytes: mirroredRawBuffer.length, size: result.responseSize, format: "png" } }, null, 2));
        mirroredImageUrl = `/generated/runpod/${mirroredRawFilename}`;
        mirroredBundleImageUrl = `/generated/bundles/${assetBundle}/${mirrorDirection}/${mirroredBundleFilename}`;
        mirroredBundleMetadataUrl = `/generated/bundles/${assetBundle}/${mirrorDirection}/${mirroredMetadataFilename}`;
        console.info("[RunPod][RAW_BUNDLE_MIRRORED]", { source: assetName, direction: mirrorDirection, assetName: mirrorAssetName, mirroredBundleImageUrl });
      }
    }

    console.info("[RunPod][OUTPUT_SAVED]", { generationId, imageFilename, metadataFilename, bytes: imageBuffer.length });
    return NextResponse.json({
      ok: true,
      generationId,
      requestId: result.requestId,
      model: result.model,
      imageUrl: `/generated/runpod/${imageFilename}`,
      metadataUrl: `/generated/runpod/${metadataFilename}`,
      bundleImageUrl,
      bundleMetadataUrl,
      mirroredImageUrl,
      mirroredBundleImageUrl,
      mirroredBundleMetadataUrl,
      referenceImages: referenceImages.map((image) => ({ name: image.name, type: image.type, bytes: image.bytes, filename: image.filename, url: image.url, width: image.width, height: image.height, size: image.size })),
      layout,
      layoutValidation,
      selection,
      elapsedMs: Date.now() - startedAt,
      outputBytes: imageBuffer.length,
      size: result.responseSize ?? settings.size,
      seed: settings.seed,
    });
  } catch (error) {
    const status = error instanceof RunPodConfigurationError ? 503 : error instanceof RunPodUpstreamError ? error.status : 500;
    const message = error instanceof Error ? error.message : "이미지 생성 실패";
    const requestId = error instanceof RunPodUpstreamError ? error.requestId : null;
    console.error("[RunPod][ROUTE_FAILED]", { status, requestId, message });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}
