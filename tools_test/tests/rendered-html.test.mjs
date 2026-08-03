import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, css, editRoute, runpodServer] = await Promise.all([
  source("../app/page.tsx"),
  source("../app/globals.css"),
  source("../app/api/runpod/edit/route.ts"),
  source("../lib/runpod-server.ts"),
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
  assert.match(page, /data-content-policy="contained"/);
  assert.match(page, /data-crop="outline-bounds"/);
  assert.match(page, /data-ground-contact="aligned"/);
  assert.match(css, /\.layout-frame\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.pose-guide \{ inset: 4% 11% 0;/);
  assert.match(css, /\.pose-walk_empty \.pose-leg \{[^}]*bottom: 0;[^}]*transform-origin: 50% 100%;/);
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
  assert.match(page, /같은 방향 기준 A \+ 방향·동작 가이드 B/);
  assert.match(page, /activeReference\.name/);
  assert.match(page, /INITIAL_DIRECTION_REFERENCES/);
  assert.match(page, /back: \{ file: null, preview: "", name: "back\.ref 미등록" \}/);
  assert.match(page, /DIRECTION_REFERENCE_REGISTERED/);
  assert.match(page, /isGenerating \|\| !hasActiveReference/);
  assert.match(css, /\.pose-guide\.direction-left, \.pose-guide\.direction-right \{ inset: 4% 22% 0; \}/);
});

test("타일 I2I는 캐릭터 포즈가 아닌 topology 가이드를 쓴다", () => {
  assert.match(page, /function TileGuide/);
  assert.match(page, /data-topology=\{topology\}/);
  assert.match(page, /47-tile blob/);
  assert.match(css, /\.tile-guide\[data-topology="transition"\]/);
});

test("RunPod 설정은 환경변수만 사용하고 두 참조 이미지를 edit endpoint로 전송한다", () => {
  assert.match(runpodServer, /process\.env\.RUNPOD_BASE_URL/);
  assert.match(runpodServer, /process\.env\.RUNPOD_API_KEY/);
  assert.doesNotMatch(runpodServer, /rpa_[A-Za-z0-9]+/);
  assert.match(runpodServer, /\/v1\/images\/edits/);
  assert.match(runpodServer, /for \(const image of images\)/);
  assert.match(editRoute, /form\.getAll\("image"\)/);
  assert.match(editRoute, /pngDimensions/);
  assert.match(editRoute, /referenceImages/);
});

test("A·B·OUTPUT의 실제 캔버스와 브라우저 디버그 로그를 표시한다", () => {
  assert.match(page, /normalizeReferenceOnWhite/);
  assert.match(page, /실제 전송 이미지 A/);
  assert.match(page, /실제 전송 이미지 B/);
  assert.match(page, /REFERENCE_A_RENDERED/);
  assert.match(page, /REFERENCE_B_RENDERED/);
  assert.match(page, /OUTPUT_RENDERED/);
  assert.match(page, /REQUEST_PREPARE/);
  assert.match(page, /REQUEST_COMPLETE/);
  assert.match(css, /\.sent-reference \{[^}]*padding: 5px;/);
  assert.match(css, /\.result-canvas-shell \{[^}]*height: 150px;[^}]*padding: 5px;/);
});

test("I2I 프롬프트는 정체성·포즈·프레임 내부·접지만 지시한다", () => {
  assert.match(page, /Keep image 1 unchanged\. Match only this pose from image 2/);
  assert.match(page, /Put the character inside the black frame\. Feet touch the bottom line\./);
  assert.doesNotMatch(page, /Keep image 1 unchanged[^`\n]*ratio/i);
});
