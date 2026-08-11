import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  page,
  css,
  layout,
  envExample,
  scailServer,
  healthRoute,
  jobsRoute,
  jobRoute,
  podServer,
  runtime,
  client,
  manifest,
  guide,
  readme,
] = await Promise.all([
  source("../app/page.tsx"),
  source("../app/globals.css"),
  source("../app/layout.tsx"),
  source("../.env.example"),
  source("../lib/scail2-server.ts"),
  source("../app/api/scail2/health/route.ts"),
  source("../app/api/scail2/jobs/route.ts"),
  source("../app/api/scail2/jobs/[jobId]/route.ts"),
  source("../../runpod/scail2_api/server.py"),
  source("../../runpod/scail2_api/runtime.py"),
  source("../../runpod/scail2_client/client.py"),
  source("../../runpod/scail2_client/example-manifest.json"),
  source("../../docs/RUNPOD_SCAIL2_GUIDE.md"),
  source("../../README.md"),
]);

test("활성 화면과 실행 문서는 SCAIL-2 전용이다", () => {
  const activeSources = [page, layout, envExample, guide, readme].join("\n");
  assert.match(activeSources, /SCAIL-2/);
  assert.doesNotMatch(activeSources, /Qwen|2511/i);
  assert.doesNotMatch(page, /\/api\/runpod\//);
  assert.doesNotMatch(page, /아이템 착용|기준 캐릭터 생성/);
});

test("화면은 준비된 4방향 입력에서 로컬 32 PNG까지 네 단계를 표시한다", () => {
  for (const label of ["Canonical 4방향", "Master Walk 17F", "SCAIL-2 4 Jobs", "Local 8-Phase Pick"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /data-testid="architecture-map"/);
  assert.match(page, /LOCAL PC/);
  assert.match(page, /NETWORK VOLUME/);
  assert.match(page, /ON-DEMAND POD/);
  assert.match(page, /LOCAL CLIENT/);
  assert.match(css, /\.architecture-map/);
});

test("방향별 canonical RGB·mask와 driving RGB·mask를 독립 입력한다", () => {
  for (const direction of ["front", "back", "left", "right"]) {
    assert.match(page, new RegExp(`id: "${direction}"`));
    assert.match(page, new RegExp(`scail-direction-\\$\\{direction.id\\}`));
  }
  for (const key of ["referenceImage", "referenceMask", "drivingVideo", "drivingMask"]) {
    assert.match(page, new RegExp(key));
  }
  assert.match(page, /reference_image/);
  assert.match(page, /reference_mask/);
  assert.match(page, /driving_video/);
  assert.match(page, /driving_mask/);
  assert.doesNotMatch(page, /Reference B|레이아웃 가이드/);
});

test("하나의 17-frame master walk를 네 고정 카메라 job에 사용한다", () => {
  assert.match(page, /하나의 rig·하나의 17-frame closed walk/);
  assert.match(page, /front.*0°/s);
  assert.match(page, /back.*180°/s);
  assert.match(page, /left.*-90°/s);
  assert.match(page, /right.*\+90°/s);
  assert.match(page, /4방향 순서대로 등록/);
  assert.match(page, /for \(const direction of DIRECTIONS\) await submitJob\(direction.id\)/);
});

test("prompt는 방향별 positive description이며 픽셀화를 요구하지 않는다", () => {
  const promptSource = page.slice(page.indexOf("const PROMPTS"), page.indexOf("function createInputs"));
  assert.match(promptSource, /fixed orthographic front view/);
  assert.match(promptSource, /fixed orthographic back view/);
  assert.match(promptSource, /fixed orthographic left-profile view/);
  assert.match(promptSource, /fixed orthographic right-profile view/);
  assert.doesNotMatch(promptSource, /pixel/i);
  assert.match(page, /data-testid={`scail-prompt-\${activeDirection}`}/);
  assert.match(page, /replace_flag=false/);
});

test("생성값은 896×512·40 steps·shift 3·CFG 5·UniPC로 시작한다", () => {
  assert.match(page, /target_width: 896/);
  assert.match(page, /target_height: 512/);
  assert.match(page, /sample_steps: 40/);
  assert.match(page, /sample_shift: 3/);
  assert.match(page, /sample_guide_scale: 5/);
  assert.match(page, /sample_solver: "unipc"/);
  assert.match(manifest, /"width": 896/);
  assert.match(manifest, /"height": 512/);
});

test("Next proxy와 Pod API는 job id를 반환하고 상태를 polling한다", () => {
  assert.match(page, /\/api\/scail2\/health/);
  assert.match(page, /\/api\/scail2\/jobs/);
  assert.match(page, /pollJob/);
  assert.match(jobsRoute, /status: 202/);
  assert.match(jobRoute, /encodeURIComponent\(jobId\)/);
  assert.match(podServer, /queue: asyncio\.Queue\[str\]/);
  assert.match(podServer, /async def gpu_worker/);
  assert.match(podServer, /await queue\.put\(job_id\)/);
  assert.match(podServer, /@app\.post\("\/v1\/jobs"/);
  assert.match(podServer, /@app\.get\("\/v1\/jobs\/\{job_id\}"/);
});

test("SCAIL-2 pipeline은 한 번 로드하고 Pod는 raw MP4만 생성한다", () => {
  assert.match(runtime, /def load_model_once/);
  assert.match(runtime, /wan\.SCAIL2Pipeline/);
  assert.match(runtime, /_animation_raw\.mp4/);
  assert.doesNotMatch(runtime, /ffmpeg|extract_frames|select=eq/);
  assert.doesNotMatch(podServer, /extract_frame/);
  assert.match(client, /def extract_frames/);
  assert.match(client, /ffmpeg/);
});

test("로컬 클라이언트가 S3 업로드·원본 다운로드·8 phase 추출을 맡는다", () => {
  assert.match(client, /RUNPOD_S3_ENDPOINT/);
  assert.match(client, /upload_file/);
  assert.match(client, /download_file/);
  assert.match(client, /SCAIL2_BASE_URL/);
  assert.match(client, /SCAIL2_API_TOKEN/);
  assert.match(manifest, /"indices": \[0, 2, 4, 6, 8, 10, 12, 14\]/);
  assert.match(page, /const EXTRACT_INDICES = \[0, 2, 4, 6, 8, 10, 12, 14\]/);
  assert.match(page, /Frame 16은 출력 PNG에서 제외/);
});

test("다운로드 manifest에는 로컬 파일과 Volume 상대 경로가 함께 들어간다", () => {
  for (const key of [
    "local_reference_image",
    "local_reference_mask",
    "local_driving_video",
    "local_driving_mask",
    "reference_image",
    "reference_mask",
    "driving_video",
    "driving_mask",
  ]) {
    assert.match(page, new RegExp(key));
    assert.match(manifest, new RegExp(`"${key}"`));
  }
});

test("endpoint와 token은 환경변수로만 읽고 실제 값을 하드코딩하지 않는다", () => {
  assert.match(scailServer, /process\.env\.SCAIL2_BASE_URL/);
  assert.match(scailServer, /process\.env\.SCAIL2_API_TOKEN/);
  assert.match(envExample, /SCAIL2_BASE_URL=https:\/\/your-scail-pod-8000\.proxy\.runpod\.net/);
  assert.match(envExample, /SCAIL2_API_TOKEN=/);
  assert.match(podServer, /SCAIL_API_TOKEN/);
  assert.match(podServer, /secrets\.compare_digest/);
  assert.match(podServer, /path escapes SCAIL_DATA_ROOT/);
  const realRunPodProxy = /https:\/\/[a-z0-9]+-8000\.proxy\.runpod\.net/i;
  const secret = /rpa_[A-Za-z0-9]+/;
  for (const checked of [page, envExample, scailServer, healthRoute, jobsRoute, jobRoute, guide, readme]) {
    assert.doesNotMatch(checked, realRunPodProxy);
    assert.doesNotMatch(checked, secret);
  }
});

test("가이드는 SCAIL-Pose 전처리와 로컬 후처리 경계를 명시한다", () => {
  assert.match(guide, /SCAIL-Pose/);
  assert.match(guide, /Pod는 raw MP4까지만/);
  assert.match(guide, /로컬 클라이언트/);
  assert.match(guide, /A100.*80GB/);
  assert.match(guide, /180~200GB/);
});
