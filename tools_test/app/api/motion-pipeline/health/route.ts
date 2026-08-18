import { NextResponse } from "next/server";
import { requestMotionPipeline, responseJson } from "@/lib/motion-pipeline-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const response = await requestMotionPipeline("/health");
    const body = await responseJson(response) as Record<string, unknown>;
    if (!response.ok) {
      console.error("[MOTION_PIPELINE][HEALTH_FAILED]", { status: response.status, elapsedMs: Date.now() - startedAt });
      return NextResponse.json({ ok: false, message: body.error ?? `HTTP ${response.status}` }, { status: 502 });
    }
    const kimodoWorker = body.kimodo_worker as { status?: string } | undefined;
    const otaWorker = body.ota_worker as { status?: string } | undefined;
    const kimodoState = String(body.kimodo_state ?? kimodoWorker?.status ?? "unknown");
    const oneToAllState = String(body.one_to_all_state ?? otaWorker?.status ?? "unknown");
    const queueDepth = Number(body.queue_depth ?? body.queue_size ?? 0);
    const healthy = body.ok !== false
      && body.status !== "degraded"
      && kimodoState !== "failed"
      && kimodoState !== "down"
      && oneToAllState !== "failed"
      && oneToAllState !== "down";
    const message = healthy ? undefined : body.error ?? "resident worker load failed";
    console[healthy ? "info" : "error"](healthy ? "[MOTION_PIPELINE][HEALTH_OK]" : "[MOTION_PIPELINE][WORKER_FAILED]", {
      kimodoState,
      oneToAllState,
      queueDepth,
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      ...body,
      ok: healthy,
      kimodo_state: kimodoState,
      one_to_all_state: oneToAllState,
      queue_depth: queueDepth,
      message,
      latency_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동작 생성 서버 health 확인 실패";
    console.error("[MOTION_PIPELINE][HEALTH_ERROR]", { message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, message }, { status: 502 });
  }
}
