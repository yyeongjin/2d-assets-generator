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
  jobOutputRoute,
  podServer,
  runtime,
  client,
  manifest,
  guide,
  readme,
  assetRoute,
  imageHealthRoute,
  runpodServer,
  directionSplitRoute,
  characterRoute,
] = await Promise.all([
  source("../app/page.tsx"),
  source("../app/globals.css"),
  source("../app/layout.tsx"),
  source("../.env.example"),
  source("../lib/scail2-server.ts"),
  source("../app/api/scail2/health/route.ts"),
  source("../app/api/scail2/jobs/route.ts"),
  source("../app/api/scail2/jobs/[jobId]/route.ts"),
  source("../app/api/scail2/jobs/[jobId]/output/route.ts"),
  source("../../runpod/scail2_api/server.py"),
  source("../../runpod/scail2_api/runtime.py"),
  source("../../runpod/scail2_client/client.py"),
  source("../../runpod/scail2_client/example-manifest.json"),
  source("../../docs/failures/RUNPOD_SCAIL2_GUIDE.md"),
  source("../../README.md"),
  source("../app/api/runpod/asset/route.ts"),
  source("../app/api/runpod/health/route.ts"),
  source("../lib/runpod-server.ts"),
  source("../app/api/assets/split-directions/route.ts"),
  source("../app/api/runpod/character/route.ts"),
]);

test("활성 화면은 기준 에셋 이미지 생성과 SCAIL-2 동작 생성을 분리한다", () => {
  const activeSources = [page, layout, envExample, guide, readme].join("\n");
  assert.match(activeSources, /SCAIL-2/);
  assert.doesNotMatch(activeSources, /Qwen|2511/i);
  assert.match(page, /\/api\/runpod\/asset/);
  assert.match(page, /\/api\/runpod\/health/);
  assert.match(page, /\/api\/runpod\/character/);
  assert.doesNotMatch(page, /\/api\/runpod\/(edit|motion-sheet|video)/);
  assert.doesNotMatch(page, /아이템 착용/);
});

test("캐릭터 조건·랜덤 조합·저장된 4방향 캐릭터 화면을 유지한다", () => {
  assert.match(page, /data-testid="character-generator"/);
  assert.match(page, /캐릭터 조건 · 랜덤 4방향 생성/);
  for (const label of ["역할", "성별 표현", "연령", "체형", "머리", "의상", "특징"]) assert.match(page, new RegExp(label));
  assert.match(page, /data-testid="random-character"/);
  assert.match(page, /data-testid={`random-character-\${group\.key}`}/);
  assert.match(page, /data-testid="character-prompt"/);
  assert.match(page, /data-testid="generate-character-sheet"/);
  assert.match(page, /data-testid="character-sheet-inventory"/);
  assert.match(page, /storedCharacterSheets/);
  assert.match(page, /selectStoredCharacter\(result\)/);
  assert.match(page, /setDirectionSheetInventoryId\(inventoryResult\.generationId\)/);
  assert.match(page, /setDirectionSheetSourceMode\("inventory"\)/);
  assert.match(page, /front → back → right → left/);
  assert.match(characterRoute, /requestImageEdit\(\[inputImage\], settings\)/);
  assert.match(characterRoute, /public.*generated.*character-sheets/s);
  assert.match(characterRoute, /cells: \["front", "back", "right", "left"\]/);
  assert.match(css, /\.character-generator-workbench/);
  assert.match(css, /\.character-sheet-inventory/);
});

test("화면은 준비된 4방향 입력에서 로컬 32 PNG까지 네 단계를 표시한다", () => {
  for (const label of ["Canonical 4방향", "Master Walk 17F", "SCAIL-2 4 Jobs", "Local 8-Phase Pick"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /data-testid="architecture-map"/);
  assert.match(page, /LOCAL CLIENT/);
  assert.match(page, /same-origin Next proxy/);
  assert.match(page, /ON-DEMAND POD/);
  assert.match(page, /RESULT ENDPOINT/);
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

test("저장 또는 업로드한 2×2 시트를 네 방향 RGB reference로 실제 분할한다", () => {
  assert.match(page, /data-testid="direction-sheet-splitter"/);
  assert.match(page, /data-testid="direction-sheet-upload"/);
  assert.match(page, /data-testid="direction-sheet-inventory-picker"/);
  assert.match(page, /data-testid="split-uploaded-direction-sheet"/);
  assert.match(page, /data-testid="split-inventory-direction-sheet"/);
  assert.match(page, /\["character", "creature"\]\.map/);
  assert.match(page, /\/api\/assets\/split-directions\?inventory=1/);
  assert.match(page, /setDirectionSheetInventory/);
  assert.match(page, /select-direction-sheet-\$\{result\.generationId\}/);
  assert.match(page, /directionSheetInventory\.find\(\(item\) => item\.generationId === directionSheetInventoryId\)/);
  assert.match(page, /\/api\/assets\/split-directions/);
  assert.match(page, /const DIRECTION_SHEET_ORDER: Direction\[\] = \["front", "back", "right", "left"\]/);
  assert.match(page, /resolveDirectionFile/);
  assert.match(page, /new File\(\[blob\], `\$\{direction\}-ref\.png`/);
  assert.match(page, /mask와 driver 경로는 그대로 유지합니다/);
  assert.match(page, /local_reference_image: directionSplit\?\.directions\[direction\.id\]\.localClientPath/);
  assert.match(page, /data-testid={`direction-crop-\${directionId}`}/);

  assert.match(directionSplitRoute, /const DIRECTIONS = \["front", "back", "right", "left"\]/);
  assert.match(directionSplitRoute, /export async function GET/);
  assert.match(directionSplitRoute, /public.*generated.*character-sheets/s);
  assert.match(directionSplitRoute, /metadata\.cells\?\.join\(","\) !== "front,back,right,left"/);
  assert.match(directionSplitRoute, /inventoryKind: "four-direction-sheet"/);
  assert.match(directionSplitRoute, /direction === "front".*left: 0, top: 0/s);
  assert.match(directionSplitRoute, /direction === "back".*left: leftWidth, top: 0/s);
  assert.match(directionSplitRoute, /direction === "right".*left: 0, top: topHeight/s);
  assert.match(directionSplitRoute, /left: leftWidth, top: topHeight/);
  assert.match(directionSplitRoute, /\.extract\(crop\)/);
  assert.match(directionSplitRoute, /references\/\$\{projectId\}\/\$\{direction\}\/ref\.jpg/);
  assert.doesNotMatch(directionSplitRoute, /referenceMask|drivingVideo|drivingMask/);
  assert.match(css, /\.direction-split-workbench/);
  assert.match(css, /\.direction-reference-preview/);
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
  const promptSource = page.slice(page.indexOf("const PROMPTS"), page.indexOf("function createJobs"));
  assert.match(promptSource, /fixed orthographic front view/);
  assert.match(promptSource, /fixed orthographic back view/);
  assert.match(promptSource, /fixed orthographic left-profile view/);
  assert.match(promptSource, /fixed orthographic right-profile view/);
  assert.doesNotMatch(promptSource, /pixel/i);
  assert.match(page, /data-testid={`scail-prompt-\${activeDirection}`}/);
  assert.match(page, /replace_flag=false/);
});

test("생성값은 896×512·40 steps·shift 3·CFG 5·UniPC로 시작한다", () => {
  assert.match(page, /form\.set\("target_width", "896"\)/);
  assert.match(page, /form\.set\("target_height", "512"\)/);
  assert.match(page, /form\.set\("sample_steps", "40"\)/);
  assert.match(page, /form\.set\("sample_shift", "3"\)/);
  assert.match(page, /form\.set\("sample_guide_scale", "5"\)/);
  assert.match(page, /form\.set\("sample_solver", "unipc"\)/);
  assert.match(manifest, /"width": 896/);
  assert.match(manifest, /"height": 512/);
});

test("Next proxy와 Pod API는 job id를 반환하고 상태를 polling한다", () => {
  assert.match(page, /\/api\/scail2\/health/);
  assert.match(page, /\/api\/scail2\/jobs/);
  assert.match(page, /pollJob/);
  assert.match(jobsRoute, /status: 202/);
  assert.match(jobRoute, /encodeURIComponent\(jobId\)/);
  assert.match(jobRoute, /export async function DELETE/);
  assert.match(jobRoute, /method: "DELETE"/);
  assert.match(jobOutputRoute, /\/output/);
  assert.match(jobOutputRoute, /new Response\(response\.body/);
  assert.match(podServer, /queue: asyncio\.Queue\[str\]/);
  assert.match(podServer, /async def gpu_worker/);
  assert.match(podServer, /await queue\.put\(job_id\)/);
  assert.match(podServer, /@app\.post\("\/v1\/jobs"/);
  assert.match(podServer, /@app\.get\("\/v1\/jobs\/\{job_id\}"/);
  assert.match(podServer, /@app\.get\("\/v1\/jobs\/\{job_id\}\/output"/);
  assert.match(podServer, /@app\.delete\("\/v1\/jobs\/\{job_id\}"/);
  assert.match(podServer, /JOB_DELETED/);
  assert.match(page, /RunPod 임시 파일 삭제/);
  assert.match(page, /deleteRemoteJob/);
});

test("SCAIL-2 pipeline은 한 번 로드하고 Pod는 raw MP4만 생성한다", () => {
  assert.match(runtime, /def load_model_once/);
  assert.match(runtime, /wan\.SCAIL2Pipeline/);
  assert.match(runtime, /SCAIL_REPO_ROOT \/ SCAIL_CONFIG_PATHS\["SCAIL-14B"\]/);
  assert.match(runtime, /_require_file\(config_path, "SCAIL config"\)/);
  assert.match(runtime, /scail_config_path=str\(config_path\)/);
  assert.match(runtime, /EXPECTED_DRIVING_FRAMES = 17/);
  assert.match(runtime, /def validate_driving_pair/);
  assert.match(podServer, /runtime\.validate_driving_pair/);
  assert.match(runtime, /_animation_raw\.mp4/);
  assert.doesNotMatch(runtime, /ffmpeg|extract_frames|select=eq/);
  assert.doesNotMatch(podServer, /extract_frame/);
  assert.match(client, /def extract_frames/);
  assert.match(client, /ffmpeg/);
});

test("로컬 클라이언트가 multipart 업로드·원본 다운로드·8 phase 추출을 맡는다", () => {
  assert.match(client, /files=files/);
  assert.match(client, /def download_output/);
  assert.match(client, /def delete_remote_job/);
  assert.match(client, /requests\.delete/);
  assert.match(client, /--keep-remote-job/);
  assert.match(client, /iter_content/);
  assert.match(client, /SCAIL2_BASE_URL/);
  assert.match(client, /SCAIL2_API_TOKEN/);
  assert.doesNotMatch(client, /boto3|RUNPOD_S3|bucket/i);
  assert.match(manifest, /"indices": \[0, 2, 4, 6, 8, 10, 12, 14\]/);
  assert.match(page, /const EXTRACT_INDICES = \[0, 2, 4, 6, 8, 10, 12, 14\]/);
  assert.match(page, /Frame 16은 출력 PNG에서 제외/);
});

test("다운로드 manifest에는 로컬 파일 경로만 들어간다", () => {
  for (const key of [
    "local_reference_image",
    "local_reference_mask",
    "local_driving_video",
    "local_driving_mask",
  ]) {
    assert.match(page, new RegExp(key));
    assert.match(manifest, new RegExp(`"${key}"`));
  }
  for (const serverPathKey of ["data_root", "reference_image", "reference_mask", "driving_video", "driving_mask"]) {
    assert.doesNotMatch(manifest, new RegExp(`"${serverPathKey}"`));
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

test("가이드는 RunPod 생성과 로컬 후처리 경계를 명시한다", () => {
  const runPodSection = guide.slice(0, guide.indexOf("# 로컬에서 할 작업"));
  assert.match(guide, /RunPod에서 할 작업/);
  assert.match(guide, /로컬에서 할 작업/);
  assert.match(runPodSection, /github\.com\/zai-org\/SCAIL-2/);
  assert.doesNotMatch(runPodSection, /github\.com\/yyeongjin\/2d-assets-generator/);
  assert.doesNotMatch(runPodSection, /\bscp\b/);
  assert.match(runPodSection, /cat <<'PY' > \/workspace\/scail2_api\/server\.py/);
  assert.match(runPodSection, /\/workspace\/scail2_api/);
  assert.match(guide, /결과 MP4 download/);
  assert.match(guide, /로컬 클라이언트/);
  assert.match(guide, /A100.*80GB/);
  assert.match(guide, /180~200GB/);
  assert.match(guide, /flash-attn --no-build-isolation/);
  assert.match(guide, /nvcc -V/);
  assert.match(guide, /DELETE \/v1\/jobs\/JOB_ID/);
  assert.match(guide, /같은 origin의 `\/api\/scail2\/\*`/);
  assert.doesNotMatch(guide, /SCAIL_LOAD_ON_START/);
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
