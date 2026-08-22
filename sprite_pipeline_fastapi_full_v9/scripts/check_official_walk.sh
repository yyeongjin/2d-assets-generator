#!/usr/bin/env bash
set -euo pipefail

ROOT="${SPRITE_PIPELINE_ROOT:-/workspace/sprite-pipeline}"
EX="${KIMODO_OFFICIAL_WALK_DIR:-$ROOT/kimodo/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path}"
PYTHON_BIN="${PYTHON_BIN:-$ROOT/server/.venv/bin/python}"
OUTPUT="${V8_VALIDATION_OUTPUT:-/tmp/sprite-v8-official-check}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3)"
fi

printf '=== OFFICIAL KIMODO WALK ===\n'
ls -lh "$EX/motion.npz" "$EX/meta.json" "$EX/constraints.json"
printf '\n=== META ===\n'
cat "$EX/meta.json"
printf '\n\n=== V8 ADAPTER + CLOSED CONTROL LOOP VALIDATION ===\n'
"$PYTHON_BIN" "$ROOT/scripts/validate_v8_fixture.py" \
  --motion "$EX/motion.npz" \
  --output "$OUTPUT"
printf '\nV8 fixture validation OK: %s\n' "$OUTPUT/v8_validation_summary.json"
