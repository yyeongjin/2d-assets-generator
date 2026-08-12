import { NextResponse } from "next/server";
import { requestScail2, responseJson } from "@/lib/scail2-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const payload = await request.formData();
    const direction = String(payload.get("direction") ?? "");
    const seed = String(payload.get("seed") ?? "");
    console.info("[SCAIL2][JOB_SUBMIT]", { direction, seed, transport: "multipart" });
    const response = await requestScail2("/v1/jobs", { method: "POST", body: payload });
    const body = await responseJson(response);
    if (!response.ok) {
      console.error("[SCAIL2][JOB_REJECTED]", { direction, status: response.status, elapsedMs: Date.now() - startedAt });
      return NextResponse.json(body, { status: response.status });
    }
    console.info("[SCAIL2][JOB_ACCEPTED]", { direction, elapsedMs: Date.now() - startedAt });
    return NextResponse.json(body, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCAIL-2 작업 등록 실패";
    console.error("[SCAIL2][JOB_ERROR]", { message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
