import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSegment(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value) ? value : "";
}

export async function GET() {
  const rawBundleRoot = path.join(process.cwd(), "public", "generated", "bundles");
  const assetRoot = path.join(process.cwd(), "public", "assets", "generated");
  try {
    const rawBundles = await readdir(rawBundleRoot, { withFileTypes: true }).catch(() => []);
    for (const bundleId of rawBundles.filter((entry) => entry.isDirectory() && entry.name.startsWith("character-farmer-")).map((entry) => entry.name).sort().reverse()) {
      const expected = {
        front: "front/Idle_Down_01.png",
        back: "back/Idle_Up_01.png",
        left: "left/Idle_Left_01.png",
        right: "right/Idle_Right_01.png",
      } as const;
      try {
        await Promise.all(Object.values(expected).map((relativePath) => access(path.join(rawBundleRoot, bundleId, relativePath))));
        return NextResponse.json({
          ok: true,
          bundleId,
          phase: "i2i-raw",
          references: Object.fromEntries(Object.entries(expected).map(([direction, relativePath]) => [direction, `/generated/bundles/${bundleId}/${relativePath}`])),
        });
      } catch {
        // Keep scanning older raw bundles until a complete four-direction set is found.
      }
    }

    const bundles = (await readdir(assetRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("character-farmer-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const bundleId of bundles) {
      try {
        const legacyMetadata = {
          front: "front/Idle_Down_01.json",
          back: "back/Idle_Up_01.json",
          left: "left/Idle_Left_01.json",
          right: "right/Idle_Right_01.json",
        } as const;
        const entries = await Promise.all(Object.entries(legacyMetadata).map(async ([direction, relativePath]) => {
          const metadata = JSON.parse(await readFile(path.join(assetRoot, bundleId, relativePath), "utf8")) as { generationId?: string; sourceGenerationId?: string };
          if (!metadata.generationId) throw new Error("generationId missing");
          const rawUrl = metadata.generationId.endsWith("-mirror") && metadata.sourceGenerationId
            ? `/generated/runpod/${metadata.sourceGenerationId}-mirror.png`
            : `/generated/runpod/${metadata.generationId}.png`;
          await access(path.join(process.cwd(), "public", rawUrl));
          return [direction, rawUrl];
        }));
        return NextResponse.json({
          ok: true,
          bundleId,
          phase: "legacy-raw-restore",
          references: Object.fromEntries(entries),
        });
      } catch {
        // Keep scanning older bundles until a complete direction set is found.
      }
    }
    return NextResponse.json({ error: "불러올 방향 기준 묶음이 없습니다." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "방향 기준 검색 실패";
    console.error("[AssetForge][DIRECTION_BUNDLE_FAILED]", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { bundleId?: unknown; manifest?: unknown };
    const bundleId = safeSegment(body.bundleId);
    if (!bundleId || !body.manifest || typeof body.manifest !== "object") {
      return NextResponse.json({ error: "bundleId와 manifest가 필요합니다." }, { status: 400 });
    }

    const rawBundleDirectory = path.join(process.cwd(), "public", "generated", "bundles", bundleId);
    await mkdir(rawBundleDirectory, { recursive: true });
    await writeFile(path.join(rawBundleDirectory, "manifest.json"), JSON.stringify(body.manifest, null, 2));
    console.info("[AssetForge][RAW_MANIFEST_SAVED]", { bundleId });
    return NextResponse.json({ ok: true, manifestUrl: `/generated/bundles/${bundleId}/manifest.json` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "manifest 저장 실패";
    console.error("[AssetForge][MANIFEST_FAILED]", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
