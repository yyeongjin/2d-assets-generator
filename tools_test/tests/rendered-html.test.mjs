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
  assetRoute,
  imageHealthRoute,
  runpodServer,
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
  source("../app/api/runpod/asset/route.ts"),
  source("../app/api/runpod/health/route.ts"),
  source("../lib/runpod-server.ts"),
]);

test("활성 화면은 기준 에셋 이미지 생성과 SCAIL-2 동작 생성을 분리한다", () => {
  const activeSources = [page, layout, envExample, guide, readme].join("\n");
  assert.match(activeSources, /SCAIL-2/);
  assert.doesNotMatch(activeSources, /Qwen|2511/i);
  assert.match(page, /\/api\/runpod\/asset/);
  assert.match(page, /\/api\/runpod\/health/);
  assert.doesNotMatch(page, /\/api\/runpod\/(character|edit|motion-sheet|video)/);
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
  assert.equal(page.match(/for \(const direction of DIRECTIONS\) await submitJob\(direction.id\)/g)?.length, 1);
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
  assert.match(runpodServer, /process\.env\.RUNPOD_BASE_URL/);
  assert.match(runpodServer, /process\.env\.RUNPOD_API_KEY/);
  assert.match(runpodServer, /process\.env\.RUNPOD_MODEL_ID/);
  assert.match(envExample, /RUNPOD_BASE_URL=https:\/\/your-image-pod-8000\.proxy\.runpod\.net/);
  assert.match(envExample, /RUNPOD_API_KEY=/);
  assert.match(imageHealthRoute, /checkRunPodHealth/);
  assert.match(podServer, /SCAIL_API_TOKEN/);
  assert.match(podServer, /secrets\.compare_digest/);
  assert.match(podServer, /path escapes SCAIL_DATA_ROOT/);
  const realRunPodProxy = /https:\/\/[a-z0-9]+-8000\.proxy\.runpod\.net/i;
  const secret = /rpa_[A-Za-z0-9]+/;
  for (const checked of [page, envExample, scailServer, healthRoute, jobsRoute, jobRoute, imageHealthRoute, runpodServer, guide, readme]) {
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

test("기존 8대 에셋 카탈로그와 타일·오브젝트 목록표를 유지한다", () => {
  assert.match(page, /data-testid="asset-catalog"/);
  for (const id of ["tile", "object", "character", "creature", "item", "vfx", "ui", "guide"]) {
    assert.match(page, new RegExp(`id: "${id}"`));
    assert.match(page, new RegExp(`asset-catalog-\\$\\{catalog.id\\}`));
  }
  for (const tile of ["잔디 center", "경작지", "해안선", "잔디-흙 전이", "나무 다리", "실내 석조 벽"]) assert.match(page, new RegExp(tile));
  for (const object of ["일반 나무", "작은 돌", "울타리 문", "허수아비", "용광로", "농가", "온실", "테이블"]) assert.match(page, new RegExp(object));
  assert.match(page, /TILE_CATALOG\.md/);
  assert.match(page, /OBJECT_CATALOG\.md/);
  assert.match(page, /ASSET_CATALOG\.md/);
  assert.match(page, /<table>/);
  assert.match(css, /\.asset-catalog-table-wrap/);
});

test("카탈로그 각 행에서 이미지 인벤토리를 열고 생성·업로드·선택·제거한다", () => {
  assert.match(page, /data-testid={`select-asset-\${selectedAssetCatalog\.id}-\${index}`}/);
  assert.match(page, /data-testid="asset-generation-panel"/);
  assert.match(page, /data-testid="catalog-asset-prompt"/);
  assert.match(page, /data-testid="check-image-endpoint"/);
  assert.match(page, /data-testid="generate-catalog-asset"/);
  assert.match(page, /data-testid="catalog-asset-output"/);
  assert.match(page, /data-testid="catalog-asset-upload-input"/);
  assert.match(page, /data-testid="upload-catalog-asset"/);
  assert.match(page, /data-testid="catalog-asset-inventory"/);
  assert.match(page, /select-inventory-/);
  assert.match(page, /removeInventoryAsset/);
  assert.match(page, /이미지 인벤토리/);
  assert.doesNotMatch(page, /loadLatestCatalogAsset|최근 결과/);
  assert.doesNotMatch(page, /승인됨|반려됨/);
  assert.match(page, /buildAssetPrompt/);
  assert.match(page, /목록 랜덤/);
  assert.match(assetRoute, /"character"/);
  assert.match(assetRoute, /requestImageEdit/);
  assert.match(assetRoute, /category === "guide"/);
  assert.match(assetRoute, /inventory.*=== "1"/);
  assert.match(assetRoute, /export async function PUT/);
  assert.match(assetRoute, /source: "uploaded"/);
  assert.match(assetRoute, /export async function DELETE/);
  assert.match(assetRoute, /INVENTORY_REMOVED/);
  assert.doesNotMatch(assetRoute, /approved|rejected|export async function PATCH/);
  assert.match(css, /\.asset-generation-panel/);
  assert.match(css, /\.asset-generator-output/);
  assert.match(css, /\.asset-image-inventory/);
});
