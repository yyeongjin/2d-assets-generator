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
    const characterReady = Boolean(
      body.character_ready
      ?? (kimodoState === "ready" && oneToAllState === "ready"),
    );
    const animalReady = Boolean(
      body.animal_ready
      ?? oneToAllState === "ready",
    );
    // V9 deliberately allows the animal route to remain usable while Kimodo is
    // unavailable. The proxy is healthy when at least one advertised route is
    // ready; per-request compatibility is enforced by the API and UI.
    const healthy = body.ok !== false && (characterReady || animalReady);
    const message = healthy ? undefined : body.error ?? "no motion route is ready";
    console[healthy ? "info" : "error"](healthy ? "[MOTION_PIPELINE][HEALTH_OK]" : "[MOTION_PIPELINE][WORKER_FAILED]", {
      kimodoState,
      oneToAllState,
      characterReady,
      animalReady,
      queueDepth,
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      ...body,
      ok: healthy,
      kimodo_state: kimodoState,
      one_to_all_state: oneToAllState,
      character_ready: characterReady,
      animal_ready: animalReady,
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
