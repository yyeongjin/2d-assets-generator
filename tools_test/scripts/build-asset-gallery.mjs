import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const toolRoot = path.resolve(import.meta.dirname, "..");
const generatedRoot = path.join(toolRoot, "public", "generated");
const catalogRoot = path.join(toolRoot, "public", "assets", "catalog");
const sinceTimestamp = process.env.ASSET_GALLERY_SINCE ?? "";

const sources = [
  { directory: path.join(generatedRoot, "character-sheets"), category: "characters" },
  { directory: path.join(generatedRoot, "runpod"), category: "equipment" },
  { directory: path.join(generatedRoot, "base-assets", "object"), category: "objects" },
  { directory: path.join(generatedRoot, "base-assets", "creature"), category: "creatures" },
  { directory: path.join(generatedRoot, "base-assets", "tile"), category: "tiles" },
  { directory: path.join(generatedRoot, "base-assets", "item"), category: "items" },
  { directory: path.join(generatedRoot, "base-assets", "vfx"), category: "vfx" },
  { directory: path.join(generatedRoot, "base-assets", "ui"), category: "ui" },
  { directory: path.join(generatedRoot, "base-assets", "guide"), category: "guides" },
];

const categoryLabels = {
  characters: "캐릭터",
  equipment: "아이템 착용",
  objects: "오브젝트",
  creatures: "생명체",
  tiles: "타일",
  items: "아이템",
  vfx: "VFX",
  ui: "UI",
  guides: "가이드",
};

async function listJson(directory) {
  try {
    return (await readdir(directory))
      .filter((name) => {
        if (!name.endsWith(".json")) return false;
        if (!sinceTimestamp) return true;
        const timestamp = name.match(/-(\d{14})-/)?.[1] ?? "";
        return timestamp >= sinceTimestamp;
      })
      .map((name) => path.join(directory, name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function displayName(category, metadata) {
  if (metadata.assetName) return metadata.assetName;
  if (category === "characters") return "4방향 기준 캐릭터";
  if (category === "equipment") return "4방향 아이템 착용";
  return metadata.generationId;
}

function uniqueKey(category, metadata) {
  if (category === "characters" || category === "equipment") return `${category}:${metadata.generationId}`;
  return `${category}:${displayName(category, metadata)}`;
}

function markdownImage(category, generationId) {
  return `<img src="./${category}/${generationId}.png" alt="${generationId}" width="220">`;
}

const discovered = [];

for (const source of sources) {
  for (const jsonPath of await listJson(source.directory)) {
    const metadata = JSON.parse(await readFile(jsonPath, "utf8"));
    const generationId = metadata.generationId;
    const outputName = metadata.output?.filename ?? `${generationId}.png`;
    const imagePath = path.join(source.directory, outputName);

    if (!generationId || outputName.includes("reference-") || outputName.includes("input")) continue;

    discovered.push({
      category: source.category,
      metadata,
      jsonPath,
      imagePath,
      generationId,
      createdAt: new Date(metadata.createdAt ?? 0),
      name: displayName(source.category, metadata),
    });
  }
}

const latestByAsset = new Map();
for (const asset of discovered.sort((a, b) => a.createdAt - b.createdAt)) {
  latestByAsset.set(uniqueKey(asset.category, asset.metadata), asset);
}

const assets = [...latestByAsset.values()].sort((a, b) => {
  const categoryOrder = sources.findIndex((source) => source.category === a.category)
    - sources.findIndex((source) => source.category === b.category);
  return categoryOrder || a.name.localeCompare(b.name, "ko");
});

await rm(catalogRoot, { recursive: true, force: true });
await mkdir(catalogRoot, { recursive: true });

await Promise.all([...new Set(assets.map((asset) => asset.category))]
  .map((category) => mkdir(path.join(catalogRoot, category), { recursive: true })));

await Promise.all(assets.flatMap((asset) => {
  const destination = path.join(catalogRoot, asset.category);
  return [
    copyFile(asset.imagePath, path.join(destination, `${asset.generationId}.png`)),
    copyFile(asset.jsonPath, path.join(destination, `${asset.generationId}.json`)),
  ];
}));

const grouped = Map.groupBy(assets, (asset) => asset.category);
const rootLines = [
  "# 생성 에셋 카탈로그",
  "",
  "> RunPod 모델의 원본 출력입니다. 크롭·리사이즈·픽셀화 등 자동 후처리를 적용하지 않았습니다.",
  "",
  `에셋 ${assets.length}종 · 캐릭터와 착용 결과는 모두 표시하고, 나머지는 같은 종류의 가장 최근 결과만 표시`,
  "",
];

for (const source of sources) {
  const categoryAssets = grouped.get(source.category) ?? [];
  if (categoryAssets.length === 0) continue;

  const label = categoryLabels[source.category];
  rootLines.push(`## [${label}](./${source.category}/README.md)`, "", "| 미리보기 | 에셋 | 크기 · 생성 ID |", "| --- | --- | --- |");

  const categoryLines = [
    `# ${label}`,
    "",
    `[전체 카탈로그로 돌아가기](../README.md)`,
    "",
    "| 미리보기 | 에셋 | 크기 · 생성 ID |",
    "| --- | --- | --- |",
  ];

  for (const asset of categoryAssets) {
    const size = asset.metadata.output?.size ?? asset.metadata.settings?.size ?? "크기 미상";
    const rootImage = markdownImage(source.category, asset.generationId);
    const categoryImage = `<img src="./${asset.generationId}.png" alt="${asset.name}" width="260">`;
    rootLines.push(`| ${rootImage} | ${asset.name} | ${size}<br>\`${asset.generationId}\` |`);
    categoryLines.push(`| ${categoryImage} | ${asset.name} | ${size}<br>\`${asset.generationId}\` |`);
  }

  rootLines.push("");
  categoryLines.push("");
  await writeFile(path.join(catalogRoot, source.category, "README.md"), categoryLines.join("\n"));
}

await writeFile(path.join(catalogRoot, "README.md"), rootLines.join("\n"));
console.log(`Asset gallery: ${assets.length} unique assets -> ${catalogRoot}`);
