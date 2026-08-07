import { randomUUID } from "node:crypto";

export type RunPodConfig = {
  baseUrl: string;
  apiKey?: string;
  modelId?: string;
  timeoutMs: number;
};

export type ImageEditSettings = {
  prompt: string;
  negativePrompt?: string;
  size: string;
  seed: number;
  numInferenceSteps: number;
  trueCfgScale: number;
  guidanceScale: number;
  outputFormat: "png" | "jpg" | "jpeg" | "webp";
};

export type ImageEditResult = {
  requestId: string;
  model: string;
  imageBase64: string;
  revisedPrompt: string | null;
  created: number | null;
  responseSize: string | null;
  outputFormat: string | null;
};

type ModelsResponse = {
  data?: Array<{ id?: string }>;
};

type EditResponse = {
  created?: number;
  data?: Array<{ b64_json?: string; revised_prompt?: string | null }>;
  output_format?: string | null;
  size?: string | null;
};

export class RunPodConfigurationError extends Error {}
export class RunPodUpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId: string,
  ) {
    super(message);
  }
}

export function getRunPodConfig(): RunPodConfig {
  const rawBaseUrl = process.env.RUNPOD_BASE_URL?.trim();
  if (!rawBaseUrl) {
    throw new RunPodConfigurationError("RUNPOD_BASE_URL 환경변수가 필요합니다.");
  }

  const parsed = new URL(rawBaseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RunPodConfigurationError("RUNPOD_BASE_URL은 http 또는 https URL이어야 합니다.");
  }

  const timeout = Number(process.env.RUNPOD_REQUEST_TIMEOUT_MS ?? "600000");
  return {
    baseUrl: parsed.toString().replace(/\/$/, ""),
    apiKey: process.env.RUNPOD_API_KEY?.trim() || undefined,
    modelId: process.env.RUNPOD_MODEL_ID?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) ? Math.max(10_000, timeout) : 600_000,
  };
}

function upstreamHeaders(config: RunPodConfig): HeadersInit {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

async function readError(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) return response.statusText || "빈 오류 응답";
  if (response.status === 524 || response.headers.get("content-type")?.includes("text/html")) {
    return `RunPod proxy timeout (HTTP ${response.status})`;
  }
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: { message?: string }; message?: string };
    return parsed.error?.message || parsed.message || (typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail));
  } catch {
    return body.slice(0, 1000);
  }
}

export async function discoverModel(config: RunPodConfig): Promise<string> {
  if (config.modelId) return config.modelId;

  const response = await fetch(`${config.baseUrl}/v1/models`, {
    headers: upstreamHeaders(config),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30_000)),
  });
  const requestId = response.headers.get("x-request-id") ?? "model-discovery";
  if (!response.ok) {
    throw new RunPodUpstreamError(await readError(response), response.status, requestId);
  }

  const body = (await response.json()) as ModelsResponse;
  const model = body.data?.find((item) => item.id)?.id;
  if (!model) {
    throw new RunPodUpstreamError("/v1/models 응답에 모델 ID가 없습니다.", 502, requestId);
  }
  return model;
}

export async function checkRunPodHealth() {
  const config = getRunPodConfig();
  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl}/health`, {
    headers: upstreamHeaders(config),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30_000)),
  });
  const model = response.ok ? await discoverModel(config) : null;
  return {
    ok: response.ok,
    status: response.status,
    model,
    latencyMs: Date.now() - startedAt,
    authentication: config.apiKey ? "bearer-env" : "proxy",
  };
}

export async function requestImageEdit(images: File[], settings: ImageEditSettings): Promise<ImageEditResult> {
  const startedAt = Date.now();
  const config = getRunPodConfig();
  const model = await discoverModel(config);
  const requestIdFallback = `local-${randomUUID()}`;
  const body = new FormData();
  body.set("model", model);
  for (const image of images) {
    body.append("image", image, image.name || "reference.png");
  }
  body.set("prompt", settings.prompt);
  body.set("negative_prompt", settings.negativePrompt || " ");
  body.set("size", settings.size);
  body.set("n", "1");
  body.set("response_format", "b64_json");
  body.set("output_format", settings.outputFormat);
  body.set("num_inference_steps", String(settings.numInferenceSteps));
  body.set("true_cfg_scale", String(settings.trueCfgScale));
  body.set("guidance_scale", String(settings.guidanceScale));
  body.set("seed", String(settings.seed));

  console.info("[RunPod][IMAGE_EDIT_START]", {
    model,
    references: images.map((image) => ({ name: image.name, type: image.type, bytes: image.size })),
    size: settings.size,
    promptCharacters: settings.prompt.length,
    seed: settings.seed,
    steps: settings.numInferenceSteps,
  });

  const response = await fetch(`${config.baseUrl}/v1/images/edits`, {
    method: "POST",
    headers: upstreamHeaders(config),
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const requestId = response.headers.get("x-request-id") ?? requestIdFallback;
  if (!response.ok) {
    const message = await readError(response);
    console.error("[RunPod][IMAGE_EDIT_FAILED]", { requestId, status: response.status, message });
    throw new RunPodUpstreamError(message, response.status, requestId);
  }

  const responseBody = (await response.json()) as EditResponse;
  const first = responseBody.data?.[0];
  if (!first?.b64_json) {
    throw new RunPodUpstreamError("응답에 data[0].b64_json이 없습니다.", 502, requestId);
  }

  console.info("[RunPod][IMAGE_EDIT_COMPLETE]", {
    requestId,
    model,
    outputFormat: responseBody.output_format ?? settings.outputFormat,
    size: responseBody.size ?? settings.size,
    base64Characters: first.b64_json.length,
    elapsedMs: Date.now() - startedAt,
  });
  return {
    requestId,
    model,
    imageBase64: first.b64_json,
    revisedPrompt: first.revised_prompt ?? null,
    created: responseBody.created ?? null,
    responseSize: responseBody.size ?? null,
    outputFormat: responseBody.output_format ?? null,
  };
}
