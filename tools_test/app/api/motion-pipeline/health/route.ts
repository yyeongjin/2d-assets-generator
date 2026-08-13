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
    const healthy = body.ok !== false && body.kimodo_state !== "failed" && body.one_to_all_state !== "failed";
    const message = healthy ? undefined : body.error ?? "resident worker load failed";
    console[healthy ? "info" : "error"](healthy ? "[MOTION_PIPELINE][HEALTH_OK]" : "[MOTION_PIPELINE][WORKER_FAILED]", {
      kimodoState: body.kimodo_state,
      oneToAllState: body.one_to_all_state,
      queueDepth: body.queue_depth,
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ...body, ok: healthy, message, latency_ms: Date.now() - startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동작 생성 서버 health 확인 실패";
    console.error("[MOTION_PIPELINE][HEALTH_ERROR]", { message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, message }, { status: 502 });
  }
}
