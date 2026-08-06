import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: false, rejected: true, message: "비디오 생성 방식은 기각되었습니다." }, { status: 410 });
}
