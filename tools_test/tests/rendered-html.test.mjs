import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  page,
  css,
  envExample,
  motionServer,
  healthRoute,
  jobsRoute,
  jobRoute,
  outputRoute,
  guide,
  readme,
  assetRoute,
  directionSplitRoute,
  characterRoute,
  scailFailure,
] = await Promise.all([
  source("../app/page.tsx"),
  source("../app/globals.css"),
  source("../.env.example"),
  source("../lib/motion-pipeline-server.ts"),
  source("../app/api/motion-pipeline/health/route.ts"),
  source("../app/api/motion-pipeline/jobs/route.ts"),
  source("../app/api/motion-pipeline/jobs/[jobId]/route.ts"),
  source("../app/api/motion-pipeline/jobs/[jobId]/output/route.ts"),
  source("../../docs/RUNPOD_KIMODO_ONE_TO_ALL_GUIDE.md"),
  source("../../README.md"),
  source("../app/api/runpod/asset/route.ts"),
  source("../app/api/assets/split-directions/route.ts"),
  source("../app/api/runpod/character/route.ts"),
  source("../../docs/failures/SCAIL2_WALK_CYCLE_STRATEGY.md"),
]);

test("활성 동작 화면은 네 방향 RGB를 단일 작업으로 전송한다", () => {
  assert.match(page, /data-testid="motion-request-workbench"/);
  assert.match(page, /4방향 이미지 한 번에 전송/);
  assert.match(page, /for \(const direction of DIRECTIONS\) form\.set\(direction\.id, await resolveDirectionImage\(direction\.id\)\)/);
  assert.match(page, /form\.set\("action", "walk"\)/);
  assert.match(page, /form\.set\("prompt", motionPrompt\)/);
  assert.match(page, /form\.set\("seed", String\(seed\)\)/);
  assert.match(page, /data-testid={`motion-image-\${direction\.id}`}/);
  assert.match(page, /data-testid="queue-motion-job"/);
  for (const key of ["front", "back", "left", "right"]) assert.match(page, new RegExp(`id: "${key}"`));
  for (const removed of ["reference_mask", "driving_video", "driving_mask", "REFERENCE MASK", "DRIVING RGB", "SCAIL-2 4 Jobs"]) {
    assert.doesNotMatch(page, new RegExp(removed));
  }
});

test("동작 pipeline 단계와 result.zip 구조를 화면에 표시한다", () => {
  for (const label of ["4방향 RGB", "Kimodo Motion", "Motion Adapter", "One-to-All \\+ Pack"]) assert.match(page, new RegExp(label));
  assert.match(page, /data-testid="architecture-map"/);
  assert.match(page, /Kimodo \+ One-to-All resident/);
  assert.match(page, /GPU concurrency 1/);
  assert.match(page, /data-testid="motion-job-board"/);
  assert.match(page, /data-testid="motion-result-layout"/);
  assert.match(page, /result\.zip 로컬 저장/);
  assert.match(page, /4 folders · 8 frames · 32 PNG/);
  assert.match(css, /\.motion-image-grid/);
  assert.match(css, /\.motion-job-flow/);
  assert.match(css, /\.motion-job-result/);
});

test("캐릭터 조건·랜덤 조합·4방향 이미지 생성과 인벤토리를 유지한다", () => {
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
  assert.match(page, /front → back → right → left/);
  assert.match(characterRoute, /requestImageEdit\(\[inputImage\], settings\)/);
  assert.match(characterRoute, /cells: \["front", "back", "right", "left"\]/);
});

test("저장 또는 업로드한 2×2 시트를 네 방향 입력으로 실제 분할한다", () => {
  assert.match(page, /data-testid="direction-sheet-splitter"/);
  assert.match(page, /data-testid="direction-sheet-upload"/);
  assert.match(page, /data-testid="direction-sheet-inventory-picker"/);
  assert.match(page, /data-testid="split-uploaded-direction-sheet"/);
  assert.match(page, /data-testid="split-inventory-direction-sheet"/);
  assert.match(page, /\["character", "creature"\]\.map/);
  assert.match(page, /\/api\/assets\/split-directions/);
  assert.match(page, /const DIRECTION_SHEET_ORDER: Direction\[\] = \["front", "back", "right", "left"\]/);
  assert.match(page, /resolveDirectionImage/);
  assert.match(page, /new File\(\[blob\], `\${direction}\.png`/);
  assert.match(directionSplitRoute, /const DIRECTIONS = \["front", "back", "right", "left"\]/);
  assert.match(directionSplitRoute, /\.extract\(crop\)/);
  assert.match(css, /\.direction-split-workbench/);
});

test("Next proxy는 네 이미지 multipart를 검사하고 단일 job을 중계한다", () => {
  assert.match(page, /\/api\/motion-pipeline\/health/);
  assert.match(page, /\/api\/motion-pipeline\/jobs/);
  assert.match(page, /pollJob/);
  assert.match(jobsRoute, /const DIRECTIONS = \["front", "back", "left", "right"\]/);
  assert.match(jobsRoute, /file instanceof File/);
  assert.match(jobsRoute, /file\.type\.startsWith\("image\/"\)/);
  assert.match(jobsRoute, /requestMotionPipeline\("\/v1\/jobs"/);
  assert.match(jobsRoute, /status: 202/);
  assert.match(jobRoute, /encodeURIComponent\(jobId\)/);
  assert.match(jobRoute, /export async function DELETE/);
  assert.match(outputRoute, /application\/zip/);
  assert.match(outputRoute, /result\.zip/);
  assert.match(outputRoute, /new Response\(response\.body/);
});

test("endpoint와 token은 새 환경변수에서만 읽는다", () => {
  assert.match(motionServer, /process\.env\.MOTION_PIPELINE_BASE_URL/);
  assert.match(motionServer, /process\.env\.MOTION_PIPELINE_API_TOKEN/);
  assert.match(motionServer, /process\.env\.MOTION_PIPELINE_REQUEST_TIMEOUT_MS/);
  assert.match(envExample, /MOTION_PIPELINE_BASE_URL=https:\/\/your-motion-pod-8000\.proxy\.runpod\.net/);
  assert.match(envExample, /MOTION_PIPELINE_API_TOKEN=/);
  assert.match(healthRoute, /kimodo_state/);
  assert.match(healthRoute, /one_to_all_state/);
  const realRunPodProxy = /https:\/\/[a-z0-9]+-8000\.proxy\.runpod\.net/i;
  const secret = /rpa_[A-Za-z0-9]+/;
  for (const checked of [page, envExample, motionServer, healthRoute, jobsRoute, jobRoute, outputRoute, guide, readme]) {
    assert.doesNotMatch(checked, realRunPodProxy);
    assert.doesNotMatch(checked, secret);
  }
});

test("새 가이드는 RunPod와 로컬의 경계·48GB 상주 전략·API 계약을 기록한다", () => {
  assert.match(guide, /RunPod에서 할 작업/);
  assert.match(guide, /로컬 `:3000`에서 할 작업/);
  assert.match(guide, /NVIDIA L40S 48GB/);
  assert.match(guide, /RAM\s+64GB\+/);
  assert.match(guide, /Disk\s+200GB 권장/);
  assert.match(guide, /github\.com\/nv-tlabs\/kimodo/);
  assert.match(guide, /github\.com\/ssj9596\/One-to-All-Animation/);
  assert.match(guide, /Kimodo-SOMA-RP-v1\.1/);
  assert.match(guide, /One-to-All-1\.3b_2/);
  assert.match(guide, /KIMODO_MOTION_SOURCE=official_example/);
  assert.match(guide, /Kimodo diffusion 모델을 VRAM에 올리지 않음/);
  assert.match(guide, /\/v1\/jobs/);
  for (const field of ["front=@front.png", "back=@back.png", "left=@left.png", "right=@right.png"]) assert.match(guide, new RegExp(field.replace(".", "\\.")));
  assert.match(guide, /\/v1\/jobs\/\$\{JOB_ID\}\/result/);
  assert.match(guide, /result\.zip/);
  assert.doesNotMatch(guide, /github\.com\/yyeongjin\/2d-assets-generator\.git/);
  assert.doesNotMatch(guide, /\bscp\b/);
  assert.doesNotMatch(guide, /\bS3\b/);
});

test("기존 8대 에셋 카탈로그와 타일·오브젝트 목록표를 유지한다", () => {
  assert.match(page, /data-testid="asset-catalog"/);
  for (const id of ["tile", "object", "character", "creature", "item", "vfx", "ui", "guide"]) {
    assert.match(page, new RegExp(`id: "${id}"`));
    assert.match(page, /asset-catalog-\${catalog\.id}/);
  }
  for (const tile of ["잔디 center", "경작지", "해안선", "잔디-흙 전이", "나무 다리", "실내 석조 벽"]) assert.match(page, new RegExp(tile));
  for (const object of ["일반 나무", "작은 돌", "울타리 문", "허수아비", "용광로", "농가", "온실", "테이블"]) assert.match(page, new RegExp(object));
  assert.match(page, /TILE_CATALOG\.md/);
  assert.match(page, /OBJECT_CATALOG\.md/);
  assert.match(page, /ASSET_CATALOG\.md/);
  assert.match(page, /<table>/);
});

test("카탈로그 각 항목의 생성·업로드·선택·제거 인벤토리를 유지한다", () => {
  assert.match(page, /data-testid="asset-generation-panel"/);
  assert.match(page, /data-testid="catalog-asset-prompt"/);
  assert.match(page, /data-testid="generate-catalog-asset"/);
  assert.match(page, /data-testid="catalog-asset-upload-input"/);
  assert.match(page, /data-testid="upload-catalog-asset"/);
  assert.match(page, /data-testid="catalog-asset-inventory"/);
  assert.match(page, /removeInventoryAsset/);
  assert.match(page, /목록 랜덤/);
  assert.match(assetRoute, /export async function PUT/);
  assert.match(assetRoute, /source: "uploaded"/);
  assert.match(assetRoute, /export async function DELETE/);
  assert.doesNotMatch(page, /승인됨|반려됨/);
});

test("기각된 SCAIL-2 기록은 failures 문서에 보존한다", () => {
  assert.match(readme, /docs\/failures\/SCAIL2_WALK_CYCLE_STRATEGY\.md/);
  assert.match(readme, /docs\/failures\/RUNPOD_SCAIL2_GUIDE\.md/);
  assert.match(scailFailure, /SCAIL-2/);
  assert.match(scailFailure, /기각/);
});
