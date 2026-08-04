import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, css, characterRoute, assetRoute, editRoute, runpodServer, healthRoute] = await Promise.all([
  source("../app/page.tsx"),
  source("../app/globals.css"),
  source("../app/api/runpod/character/route.ts"),
  source("../app/api/runpod/asset/route.ts"),
  source("../app/api/runpod/edit/route.ts"),
  source("../lib/runpod-server.ts"),
  source("../app/api/runpod/health/route.ts"),
]);

test("4방향 기준 캐릭터를 한 번의 요청으로 생성한다", () => {
  assert.match(page, /data-testid="generate-character-sheet"/);
  assert.match(page, /\/api\/runpod\/character/);
  assert.match(page, /Top-left: front view\. Top-right: back view\. Bottom-left: right profile facing right\. Bottom-right: left profile facing left/);
  assert.match(characterRoute, /blank-white-canvas\.png/);
  assert.match(characterRoute, /DEFAULT_SIZE = "1024x1024"/);
  assert.match(characterRoute, /requestImageEdit\(\[inputImage\], settings\)/);
  assert.match(characterRoute, /cells: \["front", "back", "right", "left"\]/);
});

test("1단계에는 레이아웃 Reference B가 없다", () => {
  assert.match(page, /레이아웃 B가 아님/);
  assert.match(page, /빈 흰 캔버스 1장/);
  assert.doesNotMatch(characterRoute, /mask_image/);
  assert.doesNotMatch(characterRoute, /layout/);
  assert.doesNotMatch(characterRoute, /\.extract\(|\.resize\(|\.flop\(/);
  assert.match(characterRoute, /postprocessed: false/);
});

test("모델 prompt에 픽셀화 지시를 넣지 않는다", () => {
  const promptSource = page.slice(page.indexOf("function buildPrompt"), page.indexOf("function randomChoice"));
  const routePromptSource = characterRoute.slice(characterRoute.indexOf("const DEFAULT_PROMPT"), characterRoute.indexOf("type CharacterRequest"));
  assert.doesNotMatch(promptSource, /pixel/i);
  assert.doesNotMatch(routePromptSource, /pixel/i);
  assert.match(page, /pixel\/pixel art 지시 없음/);
});

test("캐릭터 옵션과 랜덤 선택을 제공한다", () => {
  for (const key of ["role", "gender", "age", "body", "hair", "clothes", "detail"]) {
    assert.match(page, new RegExp(`key: "${key}"`));
  }
  assert.match(page, /data-testid="random-character"/);
  assert.match(page, /randomizeAll/);
  assert.match(page, /GENERATION SEED/);
  assert.match(page, /data-testid="character-prompt"/);
});

test("생성 입력과 원본 출력 크기를 화면과 메타데이터에 표시한다", () => {
  assert.match(page, /실제 전송 INPUT/);
  assert.match(page, /RUNPOD OUTPUT/);
  assert.match(page, /CHARACTER_OUTPUT_RENDERED/);
  assert.match(characterRoute, /inputImageUrl/);
  assert.match(characterRoute, /outputSize: actualSize/);
  assert.match(characterRoute, /metadataFilename/);
  assert.match(characterRoute, /requestImageEdit/);
});

test("4방향 승인 뒤 실제 아이템을 Reference B로 전송한다", () => {
  assert.match(page, /data-testid="approve-character-sheet"/);
  assert.match(page, /data-testid="equip-stage"/);
  assert.match(page, /REFERENCE A/);
  assert.match(page, /REFERENCE B/);
  assert.match(page, /form\.append\("image", sheetBlob/);
  assert.match(page, /form\.append\("image", itemFile/);
  assert.match(page, /form\.append\("image", generatedItemBlob/);
  assert.match(page, /Add exactly one image 2 sword/);
  assert.match(page, /data-testid="generate-equipped-sheet"/);
  assert.match(editRoute, /form\.getAll\("image"\)/);
});

test("기준 에셋 7분류를 RunPod 또는 로컬 가이드 렌더러로 생성한다", () => {
  for (const category of ["tile", "object", "creature", "item", "vfx", "ui", "guide"]) {
    assert.match(page, new RegExp(`id: "${category}"`));
  }
  assert.match(page, /data-testid=\{`catalog-tab-\$\{group\.id\}`\}/);
  assert.match(page, /\/api\/runpod\/asset/);
  assert.match(assetRoute, /requestImageEdit\(\[inputImage\], settings\)/);
  assert.match(assetRoute, /category === "guide"/);
  assert.match(assetRoute, /local-guide-renderer\/v1/);
  assert.match(assetRoute, /renderGuide/);
  assert.match(assetRoute, /assetName\.includes\("4방향"\)/);
  assert.match(assetRoute, /assetName\.includes\("포즈"\)/);
});

test("타일 원본을 바꾸지 않고 2x2 반복 미리보기를 표시한다", () => {
  assert.match(page, /data-testid="tile-repeat-preview"/);
  assert.match(page, /2×2 REPEAT CHECK/);
  assert.match(css, /\.tile-repeat-debug/);
  assert.match(page, /postprocessed: false/);
});

test("오브젝트 기준 에셋은 측면이 아닌 정면으로 요청한다", () => {
  const objectPrompt = page.slice(page.indexOf('if (category === "object")'), page.indexOf('if (category === "creature")'));
  assert.match(objectPrompt, /True straight-on front view/);
  assert.match(objectPrompt, /No side view, three-quarter angle, perspective/);
  assert.match(page, /FRONT_ELEVATION_OBJECTS/);
  assert.match(page, /Flat orthographic front elevation only/);
  assert.match(page, /No side wall, side roof, ground, path, plants, scenery, perspective/);
});

test("에셋 대분류 8종과 상태 히스토리를 표시한다", () => {
  for (const code of ["TL", "OB", "CH", "CR", "IT", "FX", "UI", "GD"]) {
    assert.match(page, new RegExp(`\\["${code}"`));
  }
  assert.match(page, /상태 · 히스토리/);
  assert.match(page, /data-testid="history-list"/);
  assert.match(css, /\.catalog-scope/);
  assert.match(css, /\.history-list/);
});

test("RunPod 설정과 디버그 로그에 비밀을 하드코딩하지 않는다", () => {
  assert.match(runpodServer, /process\.env\.RUNPOD_BASE_URL/);
  assert.match(runpodServer, /process\.env\.RUNPOD_API_KEY/);
  assert.doesNotMatch(runpodServer, /rpa_[A-Za-z0-9]+/);
  assert.doesNotMatch(page, /rpa_[A-Za-z0-9]+/);
  assert.doesNotMatch(characterRoute, /rpa_[A-Za-z0-9]+/);
  assert.match(runpodServer, /promptCharacters/);
  assert.match(characterRoute, /\[CharacterSheet\]\[REQUEST_START\]/);
  assert.match(characterRoute, /\[CharacterSheet\]\[REQUEST_COMPLETE\]/);
  assert.match(characterRoute, /\[CharacterSheet\]\[REQUEST_FAILED\]/);
  assert.match(healthRoute, /\[RunPod\]\[HEALTH_OK\]/);
});
