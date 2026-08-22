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
cp -a "$BUNDLE/.env.example" "$TARGET/.env.v8.example"
cp -a "$BUNDLE/CHANGES_v8.md" "$TARGET/CHANGES_v8.md"
cp -a "$BUNDLE/MIGRATE_V7_TO_V8.md" "$TARGET/MIGRATE_V7_TO_V8.md"
cp -a "$BUNDLE/README.md" "$TARGET/README_V8.md"
if [[ -f "$BUNDLE/V8_BUILD_REPORT.txt" ]]; then
  cp -a "$BUNDLE/V8_BUILD_REPORT.txt" "$TARGET/V8_BUILD_REPORT.txt"
fi
if [[ -f "$BUNDLE/V8_BACKTEST_SUMMARY.json" ]]; then
  cp -a "$BUNDLE/V8_BACKTEST_SUMMARY.json" "$TARGET/V8_BACKTEST_SUMMARY.json"
fi
cp -a "$BUNDLE/VERSION" "$TARGET/VERSION"

printf 'V8 overlay installed at %s\n' "$TARGET"
printf 'Existing venvs, model repositories, checkpoints, .env, and jobs were not replaced.\n'
printf 'Restart Motion worker, OTA worker, and FastAPI after the checks below.\n'
printf 'Run next:\n'
printf '  cd %q\n' "$TARGET"
printf "  %q -m unittest discover -s tests -p 'test_*.py' -v\n" "$TARGET/server/.venv/bin/python"
printf '  PYTHON_BIN=%q ./scripts/check_official_walk.sh\n' "$TARGET/server/.venv/bin/python"
