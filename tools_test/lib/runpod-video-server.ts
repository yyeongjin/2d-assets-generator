import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

export type VideoDirection = "front" | "back" | "right" | "left";

export type RunPodVideoConfig = {
  baseUrl: string;
  apiKey?: string;
  modelId?: string;
  timeoutMs: number;
  pollIntervalMs: number;
};

export type VideoGenerationSettings = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  numInferenceSteps: number;
  guidanceScale: number;
  flowShift: number;
  seed: number;
};

export type VideoGenerationResult = {
  jobId: string;
  requestId: string;
  model: string;
  status: string;
  videoBuffer: Buffer;
  contentType: string;
  elapsedMs: number;
};

type ModelsResponse = { data?: Array<{ id?: string }> };
type VideoJob = {
  id?: string;
  status?: string;
  error?: string | { message?: string };
};

export class RunPodVideoConfigurationError extends Error {}
export class RunPodVideoUpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId: string,
  ) {
    super(message);
  }
}

export function getRunPodVideoConfig(): RunPodVideoConfig {
  const rawBaseUrl = process.env.RUNPOD_VIDEO_BASE_URL?.trim();
  if (!rawBaseUrl) {
    throw new RunPodVideoConfigurationError("RUNPOD_VIDEO_BASE_URL 환경변수가 필요합니다.");
  }

  const parsed = new URL(rawBaseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RunPodVideoConfigurationError("RUNPOD_VIDEO_BASE_URL은 http 또는 https URL이어야 합니다.");
  }

  const timeout = Number(process.env.RUNPOD_VIDEO_REQUEST_TIMEOUT_MS ?? "1200000");
  const pollInterval = Number(process.env.RUNPOD_VIDEO_POLL_INTERVAL_MS ?? "3000");
  return {
    baseUrl: parsed.toString().replace(/\/$/, ""),
    apiKey: process.env.RUNPOD_VIDEO_API_KEY?.trim() || undefined,
    modelId: process.env.RUNPOD_VIDEO_MODEL_ID?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) ? Math.max(60_000, timeout) : 1_200_000,
    pollIntervalMs: Number.isFinite(pollInterval) ? Math.max(1_000, pollInterval) : 3_000,
  };
}

function upstreamHeaders(config: RunPodVideoConfig): HeadersInit {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

async function readError(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) return response.statusText || "빈 오류 응답";
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: string | { message?: string }; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message || parsed.message || (typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail));
  } catch {
    return body.slice(0, 1_000);
  }
}

function jobError(job: VideoJob, fallback: string) {
  if (typeof job.error === "string") return job.error;
  return job.error?.message || fallback;
}

export async function discoverVideoModel(config: RunPodVideoConfig): Promise<string> {
  if (config.modelId) return config.modelId;
  const response = await fetch(`${config.baseUrl}/v1/models`, {
    headers: upstreamHeaders(config),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30_000)),
  });
  const requestId = response.headers.get("x-request-id") ?? "video-model-discovery";
  if (!response.ok) {
    throw new RunPodVideoUpstreamError(await readError(response), response.status, requestId);
  }
  const body = (await response.json()) as ModelsResponse;
  const model = body.data?.find((item) => item.id)?.id;
  if (!model) {
    throw new RunPodVideoUpstreamError("/v1/models 응답에 비디오 모델 ID가 없습니다.", 502, requestId);
  }
  return model;
}

export async function checkRunPodVideoHealth() {
  const config = getRunPodVideoConfig();
  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl}/health`, {
    headers: upstreamHeaders(config),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30_000)),
  });
  const model = response.ok ? await discoverVideoModel(config) : null;
  return {
    ok: response.ok,
    status: response.status,
    model,
    latencyMs: Date.now() - startedAt,
    authentication: config.apiKey ? "bearer-env" : "proxy",
  };
}

export async function requestWalkVideo(reference: File, settings: VideoGenerationSettings): Promise<VideoGenerationResult> {
  const startedAt = Date.now();
  const config = getRunPodVideoConfig();
  const model = await discoverVideoModel(config);
  const requestIdFallback = `video-${randomUUID()}`;
  const body = new FormData();
  body.set("model", model);
  body.set("prompt", settings.prompt);
  body.set("negative_prompt", settings.negativePrompt || "camera movement, zoom, changing subject, changing clothes, changing colors, leaving frame");
  body.set("input_reference", reference, reference.name || "walk-reference.png");
  body.set("width", String(settings.width));
  body.set("height", String(settings.height));
  body.set("num_frames", String(settings.numFrames));
  body.set("fps", String(settings.fps));
  body.set("num_inference_steps", String(settings.numInferenceSteps));
  body.set("guidance_scale", String(settings.guidanceScale));
  body.set("flow_shift", String(settings.flowShift));
  body.set("seed", String(settings.seed));

  console.info("[RunPodVideo][SUBMIT_START]", {
    model,
    reference: { name: reference.name, type: reference.type, bytes: reference.size },
    promptCharacters: settings.prompt.length,
    size: `${settings.width}x${settings.height}`,
    frames: settings.numFrames,
    fps: settings.fps,
    steps: settings.numInferenceSteps,
    guidanceScale: settings.guidanceScale,
    flowShift: settings.flowShift,
    seed: settings.seed,
  });

  const submitResponse = await fetch(`${config.baseUrl}/v1/videos`, {
    method: "POST",
    headers: upstreamHeaders(config),
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(config.timeoutMs, 120_000)),
  });
  const requestId = submitResponse.headers.get("x-request-id") ?? requestIdFallback;
  if (!submitResponse.ok) {
    const message = await readError(submitResponse);
    console.error("[RunPodVideo][SUBMIT_FAILED]", { requestId, status: submitResponse.status, message });
    throw new RunPodVideoUpstreamError(message, submitResponse.status, requestId);
  }

  let job = (await submitResponse.json()) as VideoJob;
  if (!job.id) {
    throw new RunPodVideoUpstreamError("비디오 생성 응답에 job ID가 없습니다.", 502, requestId);
  }
  const jobId = job.id;
  const deadline = startedAt + config.timeoutMs;

  console.info("[RunPodVideo][JOB_CREATED]", { requestId, jobId, status: job.status ?? "queued" });
  while (job.status !== "completed") {
    if (["failed", "cancelled", "expired"].includes(job.status ?? "")) {
      throw new RunPodVideoUpstreamError(jobError(job, `비디오 job 상태: ${job.status}`), 502, requestId);
    }
    if (Date.now() >= deadline) {
      throw new RunPodVideoUpstreamError(`비디오 job 시간 초과 · 마지막 상태 ${job.status ?? "unknown"}`, 504, requestId);
    }

    await sleep(config.pollIntervalMs);
    const pollResponse = await fetch(`${config.baseUrl}/v1/videos/${encodeURIComponent(jobId)}`, {
      headers: upstreamHeaders(config),
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(30_000, Math.max(1_000, deadline - Date.now()))),
    });
    if (!pollResponse.ok) {
      throw new RunPodVideoUpstreamError(await readError(pollResponse), pollResponse.status, requestId);
    }
    job = (await pollResponse.json()) as VideoJob;
    console.info("[RunPodVideo][JOB_STATUS]", { requestId, jobId, status: job.status ?? "unknown", elapsedMs: Date.now() - startedAt });
  }

  const contentResponse = await fetch(`${config.baseUrl}/v1/videos/${encodeURIComponent(jobId)}/content`, {
    headers: upstreamHeaders(config),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(60_000, deadline - Date.now())),
  });
  if (!contentResponse.ok) {
    throw new RunPodVideoUpstreamError(await readError(contentResponse), contentResponse.status, requestId);
  }
  const videoBuffer = Buffer.from(await contentResponse.arrayBuffer());
  if (!videoBuffer.length) {
    throw new RunPodVideoUpstreamError("완료된 비디오 파일이 비어 있습니다.", 502, requestId);
  }

  console.info("[RunPodVideo][DOWNLOAD_COMPLETE]", {
    requestId,
    jobId,
    model,
    bytes: videoBuffer.length,
    elapsedMs: Date.now() - startedAt,
  });
  return {
    jobId,
    requestId,
    model,
    status: job.status,
    videoBuffer,
    contentType: contentResponse.headers.get("content-type") || "video/mp4",
    elapsedMs: Date.now() - startedAt,
  };
}
