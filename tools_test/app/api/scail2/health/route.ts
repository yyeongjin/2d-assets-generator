import { NextResponse } from "next/server";
import { requestScail2, responseJson } from "@/lib/scail2-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const response = await requestScail2("/health");
    const body = await responseJson(response) as Record<string, unknown>;
    if (!response.ok) {
      console.error("[SCAIL2][HEALTH_FAILED]", { status: response.status, elapsedMs: Date.now() - startedAt });
      return NextResponse.json({ ok: false, message: body.error ?? `HTTP ${response.status}` }, { status: 502 });
    }
    console.info("[SCAIL2][HEALTH_OK]", { modelState: body.model_state, queueDepth: body.queue_depth, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ ...body, ok: true, latency_ms: Date.now() - startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCAIL-2 health 확인 실패";
    console.error("[SCAIL2][HEALTH_ERROR]", { message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, message }, { status: 502 });
  }
}
