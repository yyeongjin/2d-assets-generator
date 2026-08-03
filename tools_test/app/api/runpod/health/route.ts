import { NextResponse } from "next/server";
import { checkRunPodHealth } from "@/lib/runpod-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const health = await checkRunPodHealth();
    const latencyMs = Date.now() - startedAt;
    console.info(health.ok ? "[RunPod][HEALTH_OK]" : "[RunPod][HEALTH_UNAVAILABLE]", { ...health, latencyMs });
    return NextResponse.json({ ...health, latencyMs, message: health.ok ? undefined : `Upstream health returned HTTP ${health.status}` }, { status: health.ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RunPod health check failed";
    console.error("[RunPod][HEALTH_FAILED]", { message, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ message }, { status: 503 });
  }
}
