#!/usr/bin/env bash
set -euo pipefail

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-/workspace/sprite-pipeline}"

if [[ ! -d "$TARGET" ]]; then
  printf 'Target does not exist: %s\n' "$TARGET" >&2
  exit 1
fi

for directory in workers adapter server/app client scripts tests; do
  mkdir -p "$TARGET/$directory"
  cp -a "$BUNDLE/$directory/." "$TARGET/$directory/"
done

cp -a "$BUNDLE/server/requirements.txt" "$TARGET/server/requirements.txt"
cp -a "$BUNDLE/requirements-test.txt" "$TARGET/requirements-test.txt"
cp -a "$BUNDLE/.env.example" "$TARGET/.env.v9.example"
cp -a "$BUNDLE/CHANGES_v9.md" "$TARGET/CHANGES_v9.md"
cp -a "$BUNDLE/MIGRATE_V8_TO_V9.md" "$TARGET/MIGRATE_V8_TO_V9.md"
cp -a "$BUNDLE/README.md" "$TARGET/README_V9.md"
cp -a "$BUNDLE/ANIMAL_MOTION_NPZ_V1.md" "$TARGET/ANIMAL_MOTION_NPZ_V1.md"
cp -a "$BUNDLE/RUNPOD_KIMODO_ONE_TO_ALL_GUIDE.md" "$TARGET/RUNPOD_KIMODO_ONE_TO_ALL_GUIDE.md"
cp -a "$BUNDLE/V9_ANIMAL_ROUTING_SOURCE_AUDIT.md" "$TARGET/V9_ANIMAL_ROUTING_SOURCE_AUDIT.md"
cp -a "$BUNDLE/V9_BUILD_REPORT.txt" "$TARGET/V9_BUILD_REPORT.txt"
cp -a "$BUNDLE/V9_RELEASE_MANIFEST.json" "$TARGET/V9_RELEASE_MANIFEST.json"
cp -a "$BUNDLE/VERSION" "$TARGET/VERSION"

printf 'V9 animal overlay installed at %s\n' "$TARGET"
printf 'Existing model repositories, checkpoints, venvs, .env, and jobs were not replaced.\n'
printf 'Character requests preserve the V8 Kimodo path. Animal requests select procedural or external-NPZ motion independently.\n'
printf 'Run: cd %q && server/.venv/bin/python -m unittest discover -s tests -p "test_*.py" -v\n' "$TARGET"
