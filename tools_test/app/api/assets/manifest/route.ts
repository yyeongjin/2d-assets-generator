import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSegment(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value) ? value : "";
}

export async function GET() {
  const assetRoot = path.join(process.cwd(), "public", "assets", "generated");
  try {
    const bundles = (await readdir(assetRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("character-farmer-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const bundleId of bundles) {
      const expected = {
        back: "back/Idle_Up_01.png",
        left: "left/Idle_Left_01.png",
        right: "right/Idle_Right_01.png",
      } as const;
      try {
        await Promise.all(Object.values(expected).map((relativePath) => access(path.join(assetRoot, bundleId, relativePath))));
        return NextResponse.json({
          ok: true,
          bundleId,
          references: Object.fromEntries(Object.entries(expected).map(([direction, relativePath]) => [direction, `/assets/generated/${bundleId}/${relativePath}`])),
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

    const assetDirectory = path.join(process.cwd(), "public", "assets", "generated", bundleId);
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(path.join(assetDirectory, "manifest.json"), JSON.stringify(body.manifest, null, 2));
    console.info("[AssetForge][MANIFEST_SAVED]", { bundleId });
    return NextResponse.json({ ok: true, manifestUrl: `/assets/generated/${bundleId}/manifest.json` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "manifest 저장 실패";
    console.error("[AssetForge][MANIFEST_FAILED]", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
