import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, css, editRoute, runpodServer, manifestRoute, healthRoute, postprocessRoute] = await Promise.all([
  source("../app/page.tsx"),
  source("../app/globals.css"),
  source("../app/api/runpod/edit/route.ts"),
  source("../lib/runpod-server.ts"),
  source("../app/api/assets/manifest/route.ts"),
  source("../app/api/runpod/health/route.ts"),
  source("../app/api/assets/postprocess/route.ts"),
]);

test("T2I와 I2I 화면을 분리한다", () => {
  assert.match(page, /data-testid="tool-t2i"/);
  assert.match(page, /data-testid="tool-i2i"/);
  assert.match(page, /toolMode === "t2i"/);
  assert.match(page, /REFERENCE A/);
  assert.match(page, /REFERENCE B/);
});

test("T2I 도구에 문서의 전체 8개 대분류를 제공한다", () => {
  for (const category of ["tile", "object", "character", "creature", "item", "vfx", "ui", "guide"]) {
    assert.match(page, new RegExp(`${category}: \\[`, "s"));
  }
  assert.match(page, /전체 카탈로그 8분류/);
  assert.match(page, /I2I_CATEGORIES: AssetCategory\[\] = \["character", "object", "tile"\]/);
});

test("레이아웃과 모든 발을 검은 크롭 범위의 바닥선에 맞춘다", () => {
  assert.match(page, /GUIDE_FRAME_OCCUPANCY = 0\.8/);
  assert.match(page, /GUIDE_OUTER_MARGIN = "10%"/);
  assert.match(page, /Math\.max\(12, Math\.min\(width, height\) \* 0\.024\)/);
  assert.match(page, /data-content-policy="contained"/);
  assert.match(page, /data-crop="outline-bounds"/);
  assert.match(page, /data-ground-contact="aligned"/);
  assert.match(css, /\.layout-frame\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.pose-guide \{ inset: 0 11% 0;/);
  assert.match(css, /\.pose-walk_empty \.pose-leg \{[^}]*bottom: 0;[^}]*transform-origin: 50% 100%;/);
  const guideSource = page.slice(page.indexOf("async function createLayoutGuide"), page.indexOf("async function normalizeReferenceOnWhite"));
  assert.ok(guideSource.lastIndexOf('context.strokeStyle = "#000000"') > guideSource.lastIndexOf("context.arc(centerX, headY"));
  assert.match(guideSource, /draw it last in front of every pose\/object guide/);
  for (const index of [0, 1, 2, 3]) {
    assert.match(css, new RegExp(`\\.pose-walk_empty\\.frame-${index} \\.pose-leg-left`));
    assert.match(css, new RegExp(`\\.pose-walk_empty\\.frame-${index} \\.pose-leg-right`));
  }
});

test("걷기 4프레임을 모든 방향의 명시적 export 이름으로 만든다", () => {
  assert.match(page, /Walk_\$\{DIRECTION_EXPORT_NAMES\[direction\]\}_\$\{String\(index \+ 1\)\.padStart\(2, "0"\)\}/);
  assert.match(page, /front: "Down"/);
  assert.match(page, /back: "Up"/);
  assert.match(page, /left: "Left"/);
  assert.match(page, /right: "Right"/);
  assert.match(page, /화면 왼쪽 발 전진/);
  assert.match(page, /화면 오른쪽 발 전진/);
  assert.match(page, /data-testid=\{`frame-\$\{index \+ 1\}`\}/);
});

test("요청한 캐릭터 동작 7개와 프레임 수를 제공한다", () => {
  const actions = {
    walk_empty: 4,
    weapon_1h: 2,
    weapon_2h: 2,
    tool_swing: 4,
    bow_shoot: 3,
    carry_front: 1,
    carry_overhead: 1,
  };
  for (const [action, frames] of Object.entries(actions)) {
    assert.match(page, new RegExp(`id: "${action}", label: ".+", frames: ${frames}`));
    assert.match(css, new RegExp(`\\.pose-${action}`));
  }
  assert.match(css, /\.pose-weapon_2h \.pose-equipment \{[^}]*width: 70%;[^}]*left: 15%;[^}]*transform: none;/);
});

test("정면·후면·측면은 서로 다른 점유 규격과 방향별 기준을 쓴다", () => {
  assert.match(page, /front: \{ occupancy: "78%"/);
  assert.match(page, /back: \{ occupancy: "76%"/);
  assert.match(page, /left: \{ occupancy: "56%"/);
  assert.match(page, /right: \{ occupancy: "56%"/);
  assert.match(page, /CHARACTER_HEIGHT_OCCUPANCY = "100%"/);
  assert.match(page, /4방향 공통 높이 \{directionLayout\.height\} · 위·아래 변 접촉/);
  assert.match(page, /외형 기준 A → 목표 레이아웃 B/);
  assert.match(page, /activeReference\.name/);
  assert.match(page, /INITIAL_DIRECTION_REFERENCES/);
  assert.match(page, /back: \{ file: null, preview: "", name: "back\.ref 미등록", stage: "generated" \}/);
  assert.match(page, /FRONT_SOURCE_REGISTERED/);
  assert.match(page, /frontSourceReference/);
  assert.match(page, /stage: "source"/);
  assert.match(page, /const generated = reference\.stage === "generated"/);
  assert.match(page, /정면 입력 원본 · 생성 전/);
  assert.match(page, /isGenerating \|\| !hasActiveReference/);
  assert.match(page, /directionReferencePrompt/);
  assert.match(page, /정면 기준으로 \$\{current\} 생성 중/);
  assert.match(page, /Strict full left profile\. Nose points left\. Exactly one eye visible/);
  assert.match(page, /Strict full right profile\. Nose points right\. Exactly one eye visible/);
  assert.match(page, /Strict back view\. No face or eyes visible/);
  assert.match(css, /\.pose-guide\.direction-left, \.pose-guide\.direction-right \{ inset: 0 22% 0; \}/);
});

test("RunPod가 정면 포함 방향 기준과 4방향 동작 68프레임 원본을 먼저 생성한다", () => {
  assert.match(page, /generateDirectionReferences/);
  assert.match(page, /generateAllCharacterActions/);
  assert.match(page, /directionApprovals/);
  assert.match(page, /data-testid="generate-direction-references"/);
  assert.match(page, /data-testid="generate-all-character-assets"/);
  assert.match(page, /data-testid="load-latest-direction-references"/);
  assert.match(page, /data-testid=\{`approve-direction-\$\{item\.id\}`\}/);
  assert.match(page, /requestCharacterAsset/);
  assert.match(page, /assetBundle/);
  assert.match(page, /assetName/);
  assert.match(page, /item\.id === "front" \|\| item\.id === "back" \|\| item\.id === "left"/);
  assert.match(editRoute, /RAW_BUNDLE_SAVED/);
  assert.match(editRoute, /LAYOUT_VALIDATION_FAILED/);
  assert.match(editRoute, /LAYOUT_VIOLATION/);
  assert.match(editRoute, /outlineCoverage/);
  assert.match(editRoute, /edgeContactTolerance = 2/);
  assert.match(editRoute, /contact\.top/);
  assert.match(editRoute, /contact\.bottom/);
  assert.match(editRoute, /retryable: false/);
  assert.match(editRoute, /public", "generated", "bundles"/);
  assert.doesNotMatch(editRoute, /\.extract\(/);
  assert.doesNotMatch(editRoute, /\.resize\(/);
  assert.match(page, /BATCH_REQUEST_RETRY/);
  assert.match(page, /BATCH_ASSET_REUSED/);
  assert.match(page, /loadStoredCharacterAsset/);
  assert.match(manifestRoute, /export async function GET/);
  assert.match(manifestRoute, /Idle_Right_01\.png/);
  assert.match(css, /\.batch-progress/);
});

test("후처리는 68개 원본 생성 완료 뒤 수동 버튼으로만 실행한다", () => {
  assert.match(page, /data-testid="postprocess-character-assets"/);
  assert.match(page, /batchProgress\.status !== "complete"/);
  assert.match(page, /postprocessCompletedBatch/);
  assert.doesNotMatch(page, /postprocessCompletedBatch\(\);/);
  assert.match(postprocessRoute, /manifest\.assets\.length !== expectedAssets/);
  assert.match(postprocessRoute, /status !== "generation-complete"/);
  assert.match(postprocessRoute, /\.extract\(/);
  assert.match(postprocessRoute, /\.resize\(/);
  assert.match(postprocessRoute, /trigger: "manual"/);
  assert.match(postprocessRoute, /paletteReduction: false/);
});

test("타일 I2I는 캐릭터 포즈가 아닌 topology 가이드를 쓴다", () => {
  assert.match(page, /function TileGuide/);
  assert.match(page, /data-topology=\{topology\}/);
  assert.match(page, /47-tile blob/);
  assert.match(css, /\.tile-guide\[data-topology="transition"\]/);
});

test("RunPod 설정은 환경변수만 사용하고 외형 기준 A와 목표 레이아웃 B를 순서대로 전송한다", () => {
  assert.match(runpodServer, /process\.env\.RUNPOD_BASE_URL/);
  assert.match(runpodServer, /process\.env\.RUNPOD_API_KEY/);
  assert.doesNotMatch(runpodServer, /rpa_[A-Za-z0-9]+/);
  assert.match(runpodServer, /\/v1\/images\/edits/);
  assert.match(runpodServer, /for \(const image of images\)/);
  assert.match(editRoute, /form\.getAll\("image"\)/);
  assert.match(page, /form\.append\("image", normalizedReference/);
  assert.match(page, /form\.append\("image", guide\.blob/);
  assert.doesNotMatch(runpodServer, /body\.append\("mask_image"/);
  assert.doesNotMatch(page, /form\.append\("maskImage"/);
  assert.match(page, /MASK 미전송/);
  assert.match(page, /현재 Qwen 파이프라인은 mask_image를 사용하지 않음/);
  assert.match(editRoute, /pngDimensions/);
  assert.match(editRoute, /referenceImages/);
  assert.match(page, /body\.ok !== true/);
  assert.match(healthRoute, /status: health\.ok \? 200 : 503/);
});

test("A·B·OUTPUT의 실제 캔버스와 브라우저 디버그 로그를 표시한다", () => {
  assert.match(page, /normalizeReferenceOnWhite/);
  assert.match(page, /context\.strokeRect\([\s\S]*fillFrame\.frameX - fillFrame\.strokeWidth \* 0\.5/);
  assert.match(page, /REFERENCE_PIPELINE_PREPARED/);
  assert.match(page, /preparedReferenceA/);
  assert.match(page, /preparedReferenceB/);
  assert.match(page, /reference-frame-overlay/);
  assert.match(page, /외형 기준 A/);
  assert.match(page, /실제 전송 외형 기준 A/);
  assert.match(page, /실제 전송 목표 레이아웃 B/);
  assert.match(page, /REFERENCE_A_RENDERED/);
  assert.match(page, /REFERENCE_B_RENDERED/);
  assert.match(page, /OUTPUT_RENDERED/);
  assert.match(page, /REQUEST_PREPARE/);
  assert.match(page, /REQUEST_COMPLETE/);
  assert.match(css, /\.sent-reference \{[^}]*padding: 5px;/);
  assert.match(css, /\.result-canvas-shell \{[^}]*height: 150px;[^}]*padding: 5px;/);
});

test("I2I 프롬프트는 외형 기준 A와 안쪽 레이아웃 B의 정체성·포즈·접지만 지시한다", () => {
  const characterPromptSource = page.slice(page.indexOf("function characterActionPrompt"), page.indexOf("function directionReferencePrompt"));
  assert.match(page, /Keep image 1's character unchanged/);
  assert.match(page, /Match only image 2's gray pose/);
  assert.match(page, /Preserve face, hair, clothes, colors, and proportions/);
  assert.match(page, /inner black frame visible at its exact position and size/);
  assert.match(page, /do not move or scale it to the canvas edges/);
  assert.match(page, /Place the character only inside that frame/);
  assert.match(page, /Hair touches the top; soles touch the bottom\./);
  assert.match(page, /negativePrompt", "redesign, restyle, realistic, 3D, shading/);
  assert.doesNotMatch(page, /moved rectangle, resized rectangle/);
  assert.doesNotMatch(page, /Remove the outline/);
  assert.doesNotMatch(page, /drawn frame, border lines/);
  assert.match(page, /Strict full left profile/);
  assert.doesNotMatch(page, /Keep image 1[^`\n]*ratio/i);
  assert.doesNotMatch(characterPromptSource, /pixel/i);
  assert.doesNotMatch(page, /setLineDash/);
  assert.doesNotMatch(page, /frontRule\}, \$\{targetWidth\}x\$\{targetHeight\}px/);
  assert.match(page, /RunPod 원본/);
  assert.match(page, /윤곽 보존 실패/);
  assert.match(css, /\.output-plan\.is-invalid/);
  assert.match(css, /content: "EXPECTED"/);
  assert.match(page, /전 프레임 완료 후 후처리 시작/);
});
