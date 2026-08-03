import { NextResponse } from "next/server";
import { checkRunPodHealth } from "@/lib/runpod-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const health = await checkRunPodHealth();
    console.info("[RunPod][HEALTH_OK]", { ...health, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ ...health, latencyMs: Date.now() - startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RunPod health check failed";
    console.error("[RunPod][HEALTH_FAILED]", { message, latencyMs: Date.now() - startedAt });
    return NextResponse.json({ message }, { status: 503 });
  }
}
