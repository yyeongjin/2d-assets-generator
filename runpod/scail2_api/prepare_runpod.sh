#!/usr/bin/env bash
set -euo pipefail

apt-get update
apt-get install -y git git-lfs curl ffmpeg build-essential

curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"

mkdir -p /workspace/models /workspace/scail2-data /workspace/scail2-server
cd /workspace/scail2-server
uv venv --python 3.12 --seed
source .venv/bin/activate

if [[ ! -d /workspace/SCAIL-2/.git ]]; then
  git clone --branch wan-scail2 --depth 1 https://github.com/zai-org/SCAIL-2.git /workspace/SCAIL-2
fi
cd /workspace/SCAIL-2
git submodule update --init --recursive

uv pip install -r requirements.txt
uv pip install "huggingface_hub[hf_xet]"
uv pip install -r /workspace/scail2-api/requirements-api.txt

if [[ ! -f /workspace/models/SCAIL-2/model/1/fsdp2_rank_0000_checkpoint.pt ]]; then
  hf download zai-org/SCAIL-2 --local-dir /workspace/models/SCAIL-2
fi

if [[ ! -f /workspace/models/SCAIL-2.safetensors ]]; then
  python convert.py \
    --scail-dir /workspace/models/SCAIL-2 \
    --save-path /workspace/models/SCAIL-2.safetensors
fi

echo "SCAIL-2 inference files are ready."
