#!/usr/bin/env bash
set -euo pipefail

ROOT="${SPRITE_PIPELINE_ROOT:-/workspace/sprite-pipeline}"
RUN_DIR="${SPRITE_RUN_DIR:-$ROOT/run}"

stop_process() {
  local name="$1" pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    printf '%s: no pid file\n' "$name"
    return
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    rm -f "$pid_file"
    printf '%s: invalid pid file removed\n' "$name"
    return
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    printf '%s: already stopped\n' "$name"
    return
  fi
  kill "$pid"
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid"
  fi
  rm -f "$pid_file"
  printf '%s stopped\n' "$name"
}

# Stop the API first so no new GPU work is accepted.
stop_process "FastAPI" "$RUN_DIR/api.pid"
stop_process "One-to-All" "$RUN_DIR/ota-worker.pid"
stop_process "Kimodo" "$RUN_DIR/kimodo-worker.pid"
