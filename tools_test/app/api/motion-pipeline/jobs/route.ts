import { NextResponse } from "next/server";
import { requestMotionPipeline, responseJson } from "@/lib/motion-pipeline-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIRECTIONS = ["front", "back", "left", "right"] as const;

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const payload = await request.formData();
    for (const direction of DIRECTIONS) {
      const file = payload.get(direction);
      if (!(file instanceof File) || !file.type.startsWith("image/")) {
        return NextResponse.json({ error: `${direction} 이미지가 필요합니다.` }, { status: 400 });
      }
    }

    const action = String(payload.get("action") ?? "walk");
    const seed = String(payload.get("seed") ?? "");
    console.info("[MOTION_PIPELINE][JOB_SUBMIT]", { action, seed, inputs: DIRECTIONS, transport: "multipart" });
    const response = await requestMotionPipeline("/v1/jobs", { method: "POST", body: payload });
    const body = await responseJson(response);
    if (!response.ok) {
      console.error("[MOTION_PIPELINE][JOB_REJECTED]", { status: response.status, elapsedMs: Date.now() - startedAt });
      return NextResponse.json(body, { status: response.status });
    }
    console.info("[MOTION_PIPELINE][JOB_ACCEPTED]", { elapsedMs: Date.now() - startedAt });
    return NextResponse.json(body, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동작 생성 작업 등록 실패";
    console.error("[MOTION_PIPELINE][JOB_ERROR]", { message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
