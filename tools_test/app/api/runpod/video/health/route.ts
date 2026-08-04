import { NextResponse } from "next/server";
import { checkRunPodVideoHealth } from "@/lib/runpod-video-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const health = await checkRunPodVideoHealth();
    const latencyMs = Date.now() - startedAt;
    console.info(health.ok ? "[RunPodVideo][HEALTH_OK]" : "[RunPodVideo][HEALTH_UNAVAILABLE]", { ...health, latencyMs });
    return NextResponse.json({ ...health, latencyMs, message: health.ok ? undefined : `Upstream health returned HTTP ${health.status}` }, { status: health.ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RunPod video health check failed";
    console.error("[RunPodVideo][HEALTH_FAILED]", { message, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ message }, { status: 503 });
  }
}
