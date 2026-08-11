#!/usr/bin/env bash
set -euo pipefail

: "${SCAIL_API_TOKEN:?SCAIL_API_TOKEN must be set}"

export SCAIL_REPO_ROOT="${SCAIL_REPO_ROOT:-/workspace/SCAIL-2}"
export SCAIL_CHECKPOINT_DIR="${SCAIL_CHECKPOINT_DIR:-/workspace/models/SCAIL-2}"
export SCAIL_SAFETENSORS_PATH="${SCAIL_SAFETENSORS_PATH:-/workspace/models/SCAIL-2.safetensors}"
export SCAIL_DATA_ROOT="${SCAIL_DATA_ROOT:-/workspace/scail2-data}"
export SCAIL_OUTPUT_ROOT="${SCAIL_OUTPUT_ROOT:-/workspace/scail2-data/outputs}"
export SCAIL_LOAD_ON_START="${SCAIL_LOAD_ON_START:-1}"

exec uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1
