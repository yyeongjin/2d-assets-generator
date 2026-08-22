import { NextResponse } from "next/server";
import { requestMotionPipeline, responseJson } from "@/lib/motion-pipeline-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIRECTIONS = ["front", "back", "left", "right"] as const;
const SUBJECT_PROFILES = new Set(["auto", "character", "quadruped", "biped_animal"]);
const MOTION_BACKENDS = new Set(["auto", "kimodo", "animal_procedural", "animal_npz"]);
const MAX_ANIMAL_NPZ_BYTES = 64 * 1024 * 1024;

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

    const subjectProfile = String(payload.get("subject_profile") ?? "auto").trim();
    const motionBackend = String(payload.get("motion_backend") ?? "auto").trim();
    if (!SUBJECT_PROFILES.has(subjectProfile)) {
      return NextResponse.json({ error: "잘못된 subject_profile입니다." }, { status: 400 });
    }
    if (!MOTION_BACKENDS.has(motionBackend)) {
      return NextResponse.json({ error: "잘못된 motion_backend입니다." }, { status: 400 });
    }

    const motionNpz = payload.get("motion_npz");
    const hasMotionNpz = motionNpz instanceof File && motionNpz.size > 0;
    if (hasMotionNpz) {
      if (!motionNpz.name.toLowerCase().endsWith(".npz")) {
        return NextResponse.json({ error: "동물 motion 파일은 .npz만 허용합니다." }, { status: 400 });
      }
      if (motionNpz.size > MAX_ANIMAL_NPZ_BYTES) {
        return NextResponse.json({ error: "동물 NPZ는 최대 64MB입니다." }, { status: 413 });
      }
    }
    if (motionBackend === "animal_npz" && !hasMotionNpz) {
      return NextResponse.json({ error: "animal_npz backend에는 motion_npz 파일이 필요합니다." }, { status: 400 });
    }
    if (subjectProfile === "character" && (hasMotionNpz || !["auto", "kimodo"].includes(motionBackend))) {
      return NextResponse.json({ error: "사람·캐릭터 요청은 기존 Kimodo 경로만 사용합니다." }, { status: 400 });
    }
    if (["quadruped", "biped_animal"].includes(subjectProfile) && motionBackend === "kimodo") {
      return NextResponse.json({ error: "동물 요청에는 Kimodo를 사용할 수 없습니다." }, { status: 400 });
    }

    const action = String(payload.get("action") ?? "walk");
    const seed = String(payload.get("seed") ?? "");
    console.info("[MOTION_PIPELINE][JOB_SUBMIT]", {
      action,
      seed,
      subjectProfile,
      motionBackend,
      hasMotionNpz,
      inputs: DIRECTIONS,
      transport: "multipart",
    });
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
