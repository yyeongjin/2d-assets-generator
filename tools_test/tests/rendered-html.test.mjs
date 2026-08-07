import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, css, characterRoute, assetRoute, editRoute, motionRoute, runpodServer, healthRoute, envExample] = await Promise.all([
  source("../app/page.tsx"),
  source("../app/globals.css"),
  source("../app/api/runpod/character/route.ts"),
  source("../app/api/runpod/asset/route.ts"),
  source("../app/api/runpod/edit/route.ts"),
  source("../app/api/runpod/motion-sheet/route.ts"),
  source("../lib/runpod-server.ts"),
  source("../app/api/runpod/health/route.ts"),
  source("../.env.example"),
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

test("화면에서 이미지 endpoint 연결을 확인한다", () => {
  const healthFunction = page.slice(page.indexOf("async function checkHealth"), page.indexOf("async function generateCharacterSheet"));
  assert.match(healthFunction, /\/api\/runpod\/health/);
  assert.match(page, /data-testid="check-image-runpod"/);
  assert.match(healthRoute, /checkRunPodHealth/);
});

test("2x2 시트를 중앙에서 정확히 네 방향으로 자른다", () => {
  assert.match(motionRoute, /const leftWidth = Math\.floor\(width \/ 2\)/);
  assert.match(motionRoute, /const topHeight = Math\.floor\(height \/ 2\)/);
  assert.match(motionRoute, /direction === "front".*left: 0, top: 0/s);
  assert.match(motionRoute, /direction === "back".*left: leftWidth, top: 0/s);
  assert.match(motionRoute, /direction === "right".*left: 0, top: topHeight/s);
  assert.match(motionRoute, /left: leftWidth, top: topHeight/);
  assert.match(motionRoute, /\.extract\(crop\)/);
  assert.match(page, /원본 2×2 시트의 정확한 사분면/);
});

test("버튼 한 번으로 네 방향 이미지 요청을 비동기 순차 처리한다", () => {
  assert.match(page, /for \(const \[index, direction\] of DIRECTIONS\.entries\(\)\)/);
  assert.doesNotMatch(page, /Promise\.allSettled\(requests\)/);
  assert.match(page, /data-testid="generate-four-motion-sheets"/);
  assert.match(page, /\/api\/runpod\/motion-sheet/);
  assert.match(page, /한 요청 완료 후 다음 방향 자동 요청/);
  assert.doesNotMatch(page, /class .*Queue|processQueue|queueStore/);
});

test("사용자가 공통 및 네 방향 독립 프롬프트를 수정하고 방향별 4프레임 원본을 비교한다", () => {
  assert.match(page, /data-testid="motion-sheet-prompt"/);
  assert.match(page, /data-testid="direction-prompt-grid"/);
  assert.match(page, /data-testid={`motion-sheet-prompt-\${direction\.id}`}/);
  assert.match(page, /data-testid={`generate-motion-\${direction\.id}`}/);
  assert.match(page, /이 프롬프트로 요청/);
  assert.match(page, /이 프롬프트로 다시 요청/);
  assert.doesNotMatch(page, /data-testid={`retry-motion-\${direction\.id}`}/);
  assert.match(page, /strict orthographic front view only/);
  assert.match(page, /strict orthographic back view only/);
  assert.match(page, /strict orthographic right-profile view only/);
  assert.match(page, /strict orthographic left-profile view only/);
  assert.match(page, /Top-left: contact pose, character-left leg forward/);
  assert.match(page, /Bottom-right: up pose/);
  assert.match(page, /Character-left leg stretched far forward/);
  assert.match(page, /Character-right knee lifted clearly forward/);
  assert.match(page, /Character-right leg stretched far forward/);
  assert.match(page, /Character-left knee lifted clearly forward/);
  assert.match(page, /서버가 문장을 덧붙이지 않고 그대로 전송/);
  assert.match(page, /form\.set\("prompt", directionPrompt\)/);
  assert.match(page, /referenceImageUrl/);
  assert.match(page, /result\.imageUrl/);
  assert.match(page, /data-testid="motion-sheet-results"/);
  assert.match(css, /\.walk-sheet-preview \.split-x/);
  assert.match(css, /\.motion-output-preview \.split-x/);
  assert.match(motionRoute, /frameLayout: \{ columns: 2, rows: 2 \}/);
});

test("걷기 프롬프트는 픽셀화나 자동 후처리를 요청하지 않는다", () => {
  const promptSource = page.slice(page.indexOf("const DEFAULT_DIRECTION_PROMPTS"), page.indexOf("function buildPrompt"));
  assert.match(promptSource, /contact pose/);
  assert.match(promptSource, /passing pose/);
  assert.match(promptSource, /up pose/);
  assert.doesNotMatch(promptSource, /pixel/i);
  assert.match(motionRoute, /postprocessed: false/);
  assert.doesNotMatch(motionRoute, /chromakey|colorkey|rembg|pixelate/i);
  assert.match(motionRoute, /requestImageEdit\(\[reference\], settings\)/);
  assert.match(motionRoute, /const prompt = basePrompt/);
  assert.doesNotMatch(motionRoute, /Every one of the four cells shows/);
});

test("현재 화면에는 기각한 비디오 생성 영역을 렌더링하지 않는다", () => {
  assert.doesNotMatch(page, /<video|VIDEO EXPERIMENT|VIDEO 기각|\/api\/runpod\/video/);
  assert.match(page, /IMAGE MOTION SHEETS/);
});

test("RunPod 설정과 디버그 로그에 비밀을 하드코딩하지 않는다", () => {
  assert.match(runpodServer, /process\.env\.RUNPOD_BASE_URL/);
  assert.match(runpodServer, /process\.env\.RUNPOD_API_KEY/);
  assert.doesNotMatch(runpodServer, /rpa_[A-Za-z0-9]+/);
  assert.doesNotMatch(page, /rpa_[A-Za-z0-9]+/);
  assert.doesNotMatch(characterRoute, /rpa_[A-Za-z0-9]+/);
  assert.doesNotMatch(motionRoute, /rpa_[A-Za-z0-9]+/);
  assert.match(runpodServer, /promptCharacters/);
  assert.match(characterRoute, /\[CharacterSheet\]\[REQUEST_START\]/);
  assert.match(characterRoute, /\[CharacterSheet\]\[REQUEST_COMPLETE\]/);
  assert.match(characterRoute, /\[CharacterSheet\]\[REQUEST_FAILED\]/);
  assert.match(healthRoute, /\[RunPod\]\[HEALTH_OK\]/);
  const realRunPodProxy = /https:\/\/[a-z0-9]+-8000\.proxy\.runpod\.net/i;
  assert.doesNotMatch(motionRoute, realRunPodProxy);
  assert.doesNotMatch(page, realRunPodProxy);
  assert.doesNotMatch(envExample, realRunPodProxy);
  assert.match(motionRoute, /\[MotionSheet\]\[REQUEST_START\]/);
  assert.match(motionRoute, /\[MotionSheet\]\[REQUEST_COMPLETE\]/);
  assert.match(motionRoute, /\[MotionSheet\]\[REQUEST_FAILED\]/);
});
