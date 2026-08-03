import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSegment(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value) ? value : "";
}

function targetSize(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 8 && number <= 2048 ? number : fallback;
}

type RawManifestAsset = {
  generationId?: string;
  direction?: string;
  action?: string;
  frameId?: string;
  seed?: number;
  rawUrl?: string;
  metadataUrl?: string;
  size?: string;
};

type RawManifest = {
  schemaVersion?: number;
  bundleId?: string;
  type?: string;
  status?: string;
  expectedAssets?: number;
  assets?: RawManifestAsset[];
};

type RawMetadata = {
  generationId?: string;
  selection?: Record<string, unknown>;
  layout?: { frameX?: number; frameY?: number; frameWidth?: number; frameHeight?: number };
  settings?: { size?: string; seed?: number };
  output?: { filename?: string; size?: string };
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { bundleId?: unknown; targetWidth?: unknown; targetHeight?: unknown };
    const bundleId = safeSegment(body.bundleId);
    const width = targetSize(body.targetWidth, 32);
    const height = targetSize(body.targetHeight, 64);
    if (!bundleId) return NextResponse.json({ error: "bundleId가 필요합니다." }, { status: 400 });

    const rawRoot = path.join(process.cwd(), "public", "generated", "bundles", bundleId);
    const manifest = JSON.parse(await readFile(path.join(rawRoot, "manifest.json"), "utf8")) as RawManifest;
    const expectedAssets = manifest.expectedAssets ?? 68;
    if (manifest.type !== "character-i2i-raw-set" || manifest.status !== "generation-complete" || !Array.isArray(manifest.assets) || manifest.assets.length !== expectedAssets) {
      return NextResponse.json({ error: `I2I 원본 ${expectedAssets}프레임이 모두 생성된 뒤에만 후처리할 수 있습니다.` }, { status: 409 });
    }

    const outputRoot = path.join(process.cwd(), "public", "assets", "generated", bundleId);
    const processedAssets: Array<Record<string, unknown>> = [];
    for (const item of manifest.assets) {
      const direction = safeSegment(item.direction);
      const frameId = safeSegment(item.frameId);
      if (!direction || !frameId) throw new Error("원본 manifest의 direction 또는 frameId가 잘못됐습니다.");

      const rawImagePath = path.join(rawRoot, direction, `${frameId}.png`);
      const rawMetadataPath = path.join(rawRoot, direction, `${frameId}.json`);
      const metadata = JSON.parse(await readFile(rawMetadataPath, "utf8")) as RawMetadata;
      const image = sharp(rawImagePath);
      const imageMetadata = await image.metadata();
      const sourceWidth = imageMetadata.width ?? 512;
      const sourceHeight = imageMetadata.height ?? 1024;
      const [guideWidth, guideHeight] = (metadata.settings?.size ?? metadata.output?.size ?? `${sourceWidth}x${sourceHeight}`).split("x").map(Number);
      const layout = metadata.layout ?? {};
      const scaleX = sourceWidth / (guideWidth || sourceWidth);
      const scaleY = sourceHeight / (guideHeight || sourceHeight);
      const cropLeft = Math.max(0, Math.round((layout.frameX ?? 0) * scaleX));
      const cropTop = Math.max(0, Math.round((layout.frameY ?? 0) * scaleY));
      const cropWidth = Math.min(sourceWidth - cropLeft, Math.max(1, Math.round((layout.frameWidth ?? sourceWidth) * scaleX)));
      const cropHeight = Math.min(sourceHeight - cropTop, Math.max(1, Math.round((layout.frameHeight ?? sourceHeight) * scaleY)));

      const resized = await image
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .resize(width, height, { fit: "fill", kernel: sharp.kernel.nearest })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let offset = 0; offset < resized.data.length; offset += 4) {
        const red = resized.data[offset];
        const green = resized.data[offset + 1];
        const blue = resized.data[offset + 2];
        const brightest = Math.max(red, green, blue);
        const darkest = Math.min(red, green, blue);
        if (darkest > 238 || (brightest - darkest < 12 && darkest > 50)) resized.data[offset + 3] = 0;
      }
      const outputBuffer = await sharp(resized.data, { raw: resized.info }).png().toBuffer();
      const directionRoot = path.join(outputRoot, direction);
      await mkdir(directionRoot, { recursive: true });
      await writeFile(path.join(directionRoot, `${frameId}.png`), outputBuffer);
      await writeFile(path.join(directionRoot, `${frameId}.json`), JSON.stringify({
        phase: "manual-postprocess",
        generationId: metadata.generationId ?? item.generationId,
        processedAt: new Date().toISOString(),
        source: { image: `/generated/bundles/${bundleId}/${direction}/${frameId}.png`, metadata: `/generated/bundles/${bundleId}/${direction}/${frameId}.json` },
        selection: metadata.selection,
        crop: { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight },
        output: { filename: `${frameId}.png`, bytes: outputBuffer.length, size: `${width}x${height}`, format: "png" },
      }, null, 2));
      processedAssets.push({ direction, action: item.action, frameId, sourceGenerationId: metadata.generationId ?? item.generationId, url: `/assets/generated/${bundleId}/${direction}/${frameId}.png` });
    }

    const postprocessManifest = {
      schemaVersion: 1,
      bundleId,
      type: "character-unity-postprocess-set",
      status: "complete",
      createdAt: new Date().toISOString(),
      sourceManifest: `/generated/bundles/${bundleId}/manifest.json`,
      trigger: "manual",
      output: { width, height, resizeKernel: "nearest", paletteReduction: false, pivot: { x: 0.5, y: 0 } },
      assets: processedAssets,
    };
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify(postprocessManifest, null, 2));
    console.info("[AssetForge][MANUAL_POSTPROCESS_COMPLETE]", { bundleId, processed: processedAssets.length, output: `${width}x${height}` });
    return NextResponse.json({ ok: true, processed: processedAssets.length, manifestUrl: `/assets/generated/${bundleId}/manifest.json` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "후처리 실패";
    console.error("[AssetForge][MANUAL_POSTPROCESS_FAILED]", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
