import { NextResponse } from "next/server";
import { requestScail2, responseJson } from "@/lib/scail2-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(jobId)) return NextResponse.json({ error: "잘못된 job_id입니다." }, { status: 400 });
  try {
    const response = await requestScail2(`/v1/jobs/${encodeURIComponent(jobId)}`);
    const body = await responseJson(response);
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCAIL-2 작업 조회 실패";
    console.error("[SCAIL2][JOB_POLL_ERROR]", { jobId, message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
