#!/usr/bin/env bash
set -euo pipefail

ROOT="${SPRITE_PIPELINE_ROOT:-/workspace/sprite-pipeline}"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.env"
  set +a
fi

# Recompute values after loading .env so operational overrides are honored.
ROOT="${SPRITE_PIPELINE_ROOT:-$ROOT}"
RUN_DIR="${SPRITE_RUN_DIR:-$ROOT/run}"
LOG_DIR="${SPRITE_LOG_DIR:-$ROOT/logs}"
START_KIMODO="${START_KIMODO:-true}"
STARTUP_TIMEOUT_SECONDS="${SPRITE_STARTUP_TIMEOUT_SECONDS:-900}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

require_file() {
  [[ -f "$1" ]] || { printf 'Missing required file: %s\n' "$1" >&2; exit 1; }
}

is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

start_process() {
  local name="$1" cwd="$2" log="$3" pid_file="$4"
  shift 4
  if is_running "$pid_file"; then
    printf '%s already running (pid %s)\n' "$name" "$(cat "$pid_file")"
    return
  fi
  rm -f "$pid_file"
  (
    cd "$cwd"
    nohup "$@" >>"$log" 2>&1 &
    echo $! >"$pid_file"
  )
  sleep 1
  if ! is_running "$pid_file"; then
    printf '%s failed to start. Last log lines:\n' "$name" >&2
    tail -n 80 "$log" >&2 || true
    exit 1
  fi
  printf '%s started (pid %s, log %s)\n' "$name" "$(cat "$pid_file")" "$log"
}

wait_ready() {
  local name="$1" url="$2" pid_file="$3" log="$4"
  local started now body
  started="$(date +%s)"
  while true; do
    if ! is_running "$pid_file"; then
      printf '%s exited before becoming ready. Last log lines:\n' "$name" >&2
      tail -n 100 "$log" >&2 || true
      exit 1
    fi
    body="$(curl -fsS --max-time 2 "$url" 2>/dev/null || true)"
    if grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' <<<"$body"; then
      printf '%s ready\n' "$name"
      return
    fi
    now="$(date +%s)"
    if (( now - started >= STARTUP_TIMEOUT_SECONDS )); then
      printf '%s did not become ready within %ss. Last log lines:\n' "$name" "$STARTUP_TIMEOUT_SECONDS" >&2
      tail -n 100 "$log" >&2 || true
      exit 1
    fi
    sleep 2
  done
}

KIMODO_ROOT="${KIMODO_ROOT:-$ROOT/kimodo}"
OTA_ROOT="${OTA_ROOT:-$ROOT/one-to-all}"
SERVER_ROOT="${SERVER_ROOT:-$ROOT/server}"
KIMODO_PYTHON="${KIMODO_PYTHON:-$KIMODO_ROOT/.venv/bin/python}"
OTA_PYTHON="${OTA_PYTHON:-$OTA_ROOT/.venv/bin/python}"
SERVER_PYTHON="${SERVER_PYTHON:-$SERVER_ROOT/.venv/bin/python}"

require_file "$ROOT/workers/ota_worker.py"
require_file "$SERVER_ROOT/app/main.py"
require_file "$OTA_PYTHON"
require_file "$SERVER_PYTHON"

if [[ -z "${API_TOKEN:-}" ]] && ! is_true "${ALLOW_UNAUTHENTICATED_API:-false}"; then
  printf 'API_TOKEN is required. Set it in %s/.env or explicitly enable local-only ALLOW_UNAUTHENTICATED_API=true.\n' "$ROOT" >&2
  exit 1
fi

export SPRITE_PIPELINE_ROOT="$ROOT"
export SPRITE_JOBS_ROOT="${SPRITE_JOBS_ROOT:-$ROOT/jobs}"
export KIMODO_WORKER_URL="${KIMODO_WORKER_URL:-http://127.0.0.1:9101}"
export OTA_WORKER_URL="${OTA_WORKER_URL:-http://127.0.0.1:9102}"
export KIMODO_MOTION_SOURCE="${KIMODO_MOTION_SOURCE:-official_example}"
export KIMODO_OFFICIAL_WALK_MOTION="${KIMODO_OFFICIAL_WALK_MOTION:-$KIMODO_ROOT/kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path/motion.npz}"
export OTA_CHECKPOINT_DIR="${OTA_CHECKPOINT_DIR:-$OTA_ROOT/checkpoints/One-to-All-1.3b_2}"

if is_true "$START_KIMODO"; then
  require_file "$ROOT/workers/kimodo_worker.py"
  require_file "$KIMODO_PYTHON"
  case "$KIMODO_MOTION_SOURCE" in
    generated|model)
      ;;
    official_example|official|fixture)
      KIMODO_SELECTED_MOTION="${KIMODO_FIXTURE_MOTION:-$KIMODO_OFFICIAL_WALK_MOTION}"
      require_file "$KIMODO_SELECTED_MOTION"
      ;;
    *)
      printf 'Unsupported KIMODO_MOTION_SOURCE: %s\n' "$KIMODO_MOTION_SOURCE" >&2
      exit 1
      ;;
  esac
  start_process \
    "Kimodo" "$KIMODO_ROOT" "$LOG_DIR/kimodo-worker.log" "$RUN_DIR/kimodo-worker.pid" \
    env PYTHONUNBUFFERED=1 "$KIMODO_PYTHON" "$ROOT/workers/kimodo_worker.py"
fi

start_process \
  "One-to-All" "$OTA_ROOT" "$LOG_DIR/ota-worker.log" "$RUN_DIR/ota-worker.pid" \
  env PYTHONUNBUFFERED=1 "$OTA_PYTHON" "$ROOT/workers/ota_worker.py"

start_process \
  "FastAPI" "$SERVER_ROOT" "$LOG_DIR/api.log" "$RUN_DIR/api.pid" \
  env PYTHONUNBUFFERED=1 "$SERVER_PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1

if is_true "$START_KIMODO"; then
  wait_ready "Kimodo" "http://127.0.0.1:9101/health" "$RUN_DIR/kimodo-worker.pid" "$LOG_DIR/kimodo-worker.log"
fi
wait_ready "One-to-All" "http://127.0.0.1:9102/health" "$RUN_DIR/ota-worker.pid" "$LOG_DIR/ota-worker.log"
wait_ready "FastAPI" "http://127.0.0.1:8000/health" "$RUN_DIR/api.pid" "$LOG_DIR/api.log"

printf '\nSprite Pipeline V9 services are ready.\n'
printf 'Character route: %s\n' "$([[ -f "$RUN_DIR/kimodo-worker.pid" ]] && is_running "$RUN_DIR/kimodo-worker.pid" && echo ready || echo disabled)"
printf 'Animal route: ready\n'
