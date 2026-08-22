#!/usr/bin/env bash
set -euo pipefail

ROOT="${SPRITE_PIPELINE_ROOT:-/workspace/sprite-pipeline}"
WORKER_URL="${KIMODO_WORKER_URL:-http://127.0.0.1:9101}"
PYTHON_BIN="${PYTHON_BIN:-$ROOT/server/.venv/bin/python}"
SEED="${1:-42}"
OUTPUT="${2:-$ROOT/fixtures/v8/neutral_walk_seed_${SEED}.npz}"
DURATION="${KIMODO_GENERATED_DURATION:-4.0}"
ATTEMPTS="${KIMODO_MAX_MOTION_ATTEMPTS:-8}"
PROMPT="${V8_CANDIDATE_PROMPT:-A person walks forward at a steady relaxed pace, keeping the torso and head facing straight forward.}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3)"
fi

mkdir -p "$(dirname "$OUTPUT")"
HEALTH_JSON="$(mktemp)"
REQUEST_JSON="$(mktemp)"
RESPONSE_JSON="$(mktemp)"
trap 'rm -f "$HEALTH_JSON" "$REQUEST_JSON" "$RESPONSE_JSON"' EXIT

curl --fail --silent --show-error "$WORKER_URL/health" -o "$HEALTH_JSON"
"$PYTHON_BIN" - "$HEALTH_JSON" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
if payload.get("status") != "ready":
    raise SystemExit(f"Kimodo worker is not ready: {payload}")
if payload.get("motion_source") not in {"generated", "model"}:
    raise SystemExit(
        "Kimodo worker is not in generated mode. Restart it with "
        "KIMODO_MOTION_SOURCE=generated."
    )
PY

"$PYTHON_BIN" - "$PROMPT" "$SEED" "$DURATION" "$ATTEMPTS" "$OUTPUT" > "$REQUEST_JSON" <<'PY'
import json
import sys

print(json.dumps({
    "prompt": sys.argv[1],
    "seed": int(sys.argv[2]),
    "duration": float(sys.argv[3]),
    "diffusion_steps": 100,
    "max_motion_attempts": int(sys.argv[4]),
    "output_path": sys.argv[5],
}))
PY

curl --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  --data-binary "@$REQUEST_JSON" \
  "$WORKER_URL/generate" \
  -o "$RESPONSE_JSON"

MOTION_PATH="$("$PYTHON_BIN" - "$RESPONSE_JSON" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
if payload.get("status") != "ok":
    raise SystemExit(f"Generation failed: {payload}")
print(payload["motion_path"])
PY
)"

VALIDATION_DIR="${MOTION_PATH%.npz}_v8_validation"
"$PYTHON_BIN" "$ROOT/scripts/validate_v8_fixture.py" \
  --motion "$MOTION_PATH" \
  --output "$VALIDATION_DIR"

META_PATH="${MOTION_PATH%.npz}.meta.json"
"$PYTHON_BIN" - \
  "$REQUEST_JSON" \
  "$RESPONSE_JSON" \
  "$VALIDATION_DIR/v8_validation_summary.json" \
  "$META_PATH" \
  "$SEED" <<'PY'
import datetime
import json
import pathlib
import sys

request_path, response_path, validation_path, output_path, seed = sys.argv[1:]
request = json.load(open(request_path, encoding="utf-8"))
response = json.load(open(response_path, encoding="utf-8"))
validation = json.load(open(validation_path, encoding="utf-8"))
qc_path = response.get("motion_qc_path")
motion_qc = None
if qc_path and pathlib.Path(qc_path).is_file():
    motion_qc = json.load(open(qc_path, encoding="utf-8"))
payload = {
    "schema_version": 1,
    "fixture_label": f"generated-neutral-walk-seed-{seed}",
    "created_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "request": request,
    "worker_response": response,
    "motion_qc": motion_qc,
    "v8_adapter_validation": validation,
}
pathlib.Path(output_path).write_text(
    json.dumps(payload, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
PY

printf '\nCandidate accepted by V8 adapter.\n'
printf 'Motion: %s\n' "$MOTION_PATH"
printf 'Fixture meta: %s\n' "$META_PATH"
printf 'Validation: %s/v8_validation_summary.json\n' "$VALIDATION_DIR"
printf 'To freeze this candidate, launch fixture mode with:\n'
printf 'export KIMODO_MOTION_SOURCE=fixture\n'
printf 'export KIMODO_FIXTURE_LABEL=generated-neutral-walk-seed-%s\n' "$SEED"
printf 'export KIMODO_FIXTURE_MOTION=%q\n' "$MOTION_PATH"
printf 'export KIMODO_FIXTURE_META=%q\n' "$META_PATH"
