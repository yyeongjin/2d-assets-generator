const DEFAULT_TIMEOUT_MS = 300_000;

function configuration() {
  const baseUrl = process.env.MOTION_PIPELINE_BASE_URL?.trim().replace(/\/+$/, "");
  const apiToken = process.env.MOTION_PIPELINE_API_TOKEN?.trim();
  const timeoutValue = Number(process.env.MOTION_PIPELINE_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : DEFAULT_TIMEOUT_MS;

  if (!baseUrl) throw new Error("MOTION_PIPELINE_BASE_URL 환경변수가 없습니다.");
  return { baseUrl, apiToken, timeoutMs };
}

export async function requestMotionPipeline(path: string, init: RequestInit = {}) {
  const { baseUrl, apiToken, timeoutMs } = configuration();
  const headers = new Headers(init.headers);
  if (apiToken) headers.set("Authorization", `Bearer ${apiToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`동작 생성 API가 ${timeoutMs}ms 안에 응답하지 않았습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function responseJson(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return { error: (await response.text()).slice(0, 500) || `HTTP ${response.status}` };
}
