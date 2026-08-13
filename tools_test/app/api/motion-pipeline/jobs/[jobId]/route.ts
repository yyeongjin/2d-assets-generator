import { NextResponse } from "next/server";
import { requestMotionPipeline, responseJson } from "@/lib/motion-pipeline-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validJobId(jobId: string) {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(jobId);
}

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!validJobId(jobId)) return NextResponse.json({ error: "잘못된 job_id입니다." }, { status: 400 });
  try {
    const response = await requestMotionPipeline(`/v1/jobs/${encodeURIComponent(jobId)}`);
    const body = await responseJson(response);
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동작 생성 작업 조회 실패";
    console.error("[MOTION_PIPELINE][JOB_POLL_ERROR]", { jobId, message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!validJobId(jobId)) return NextResponse.json({ error: "잘못된 job_id입니다." }, { status: 400 });
  try {
    const response = await requestMotionPipeline(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    if (response.status === 204) return new Response(null, { status: 204 });
    const body = await responseJson(response);
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동작 생성 작업 삭제 실패";
    console.error("[MOTION_PIPELINE][JOB_DELETE_ERROR]", { jobId, message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
