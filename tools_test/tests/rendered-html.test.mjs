import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("T2I와 I2I 화면을 분리한다", () => {
  assert.match(page, /data-testid="tool-t2i"/);
  assert.match(page, /data-testid="tool-i2i"/);
  assert.match(page, /toolMode === "t2i"/);
  assert.match(page, /REFERENCE A/);
  assert.match(page, /REFERENCE B/);
});

test("T2I 도구에 문서의 전체 8개 대분류를 제공한다", () => {
  for (const category of ["tile", "object", "character", "creature", "item", "vfx", "ui", "guide"]) {
    assert.match(page, new RegExp(`data-testid=\\{\`category-\\$\\{item\\}\`\\}`));
    assert.match(page, new RegExp(`${category}: \\[`, "s"));
  }
  assert.match(page, /전체 카탈로그 8분류/);
  assert.match(page, /I2I_CATEGORIES: AssetCategory\[\] = \["character", "object", "tile"\]/);
});

test("레이아웃을 크롭 범위 안에 가두고 바닥선에 맞춘다", () => {
  assert.match(page, /data-content-policy="contained"/);
  assert.match(page, /data-crop="outline-bounds"/);
  assert.match(page, /data-ground-contact="aligned"/);
  assert.match(page, /data-ground-edge=\{category === "tile" \? "adjacency" : "bottom"\}/);
  assert.match(css, /\.layout-frame\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.pose-walk_empty \.pose-leg-left\s*\{[^}]*top:\s*61%[^}]*bottom:\s*auto[^}]*height:\s*47%/s);
  assert.match(css, /\.pose-walk_empty \.pose-leg-right\s*\{[^}]*top:\s*61%[^}]*bottom:\s*auto[^}]*height:\s*49\.5%/s);
});

test("요청한 캐릭터 동작 7개를 제공한다", () => {
  for (const action of ["walk_empty", "weapon_1h", "weapon_2h", "tool_swing", "bow_shoot", "carry_front", "carry_overhead"]) {
    assert.match(page, new RegExp(`id: "${action}"`));
    assert.match(css, new RegExp(`\\.pose-${action.replaceAll("_", "_")}`));
  }
});

test("정면·후면·측면은 서로 다른 점유 규격과 방향별 기준 이미지를 쓴다", () => {
  assert.match(page, /front: \{ occupancy: "78%"/);
  assert.match(page, /back: \{ occupancy: "76%"/);
  assert.match(page, /left: \{ occupancy: "56%"/);
  assert.match(page, /right: \{ occupancy: "56%"/);
  assert.match(page, /같은 방향 기준 A \+ 방향·동작 가이드 B/);
  assert.match(css, /\.pose-guide\.direction-left, \.pose-guide\.direction-right \{ inset: 4% 22% 0; \}/);
});

test("타일 I2I는 캐릭터 포즈가 아닌 topology 가이드를 쓴다", () => {
  assert.match(page, /function TileGuide/);
  assert.match(page, /data-topology=\{topology\}/);
  assert.match(page, /47-tile blob/);
  assert.match(css, /\.tile-guide\[data-topology="transition"\]/);
});

test("endpoint 호출은 아직 포함하지 않는다", () => {
  assert.doesNotMatch(page, /fetch\s*\(/);
  assert.match(page, /RUNPOD ENDPOINT 미연결/);
});
