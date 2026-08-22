#!/usr/bin/env bash
set -u

ROOT="${SPRITE_PIPELINE_ROOT:-/workspace/sprite-pipeline}"
RUN_DIR="${SPRITE_RUN_DIR:-$ROOT/run}"

show_process() {
  local name="$1" pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    printf '%-12s stopped\n' "$name"
    return
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    printf '%-12s running pid=%s\n' "$name" "$pid"
  else
    printf '%-12s stale pid file\n' "$name"
  fi
}

show_health() {
  local name="$1" url="$2"
  printf '\n=== %s ===\n' "$name"
  curl -fsS --max-time 3 "$url" 2>/dev/null || printf '{"status":"down"}'
  printf '\n'
}

show_process "FastAPI" "$RUN_DIR/api.pid"
show_process "One-to-All" "$RUN_DIR/ota-worker.pid"
show_process "Kimodo" "$RUN_DIR/kimodo-worker.pid"

show_health "PUBLIC API" "http://127.0.0.1:8000/health"
show_health "ONE-TO-ALL" "http://127.0.0.1:9102/health"
show_health "KIMODO" "http://127.0.0.1:9101/health"

printf '\n=== GPU ===\n'
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null || true
