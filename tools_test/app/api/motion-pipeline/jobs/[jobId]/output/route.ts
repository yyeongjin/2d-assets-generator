import { requestMotionPipeline } from "@/lib/motion-pipeline-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(jobId)) return new Response("잘못된 job_id입니다.", { status: 400 });

  try {
    const response = await requestMotionPipeline(`/v1/jobs/${encodeURIComponent(jobId)}/output`);
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500) || `HTTP ${response.status}`;
      return new Response(message, { status: response.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const headers = new Headers();
    headers.set("Content-Type", response.headers.get("Content-Type") ?? "application/zip");
    headers.set("Content-Disposition", response.headers.get("Content-Disposition") ?? `attachment; filename="${jobId}-result.zip"`);
    const contentLength = response.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동작 생성 결과 다운로드 실패";
    console.error("[MOTION_PIPELINE][OUTPUT_DOWNLOAD_ERROR]", { jobId, message });
    return new Response(message, { status: 502 });
  }
}
