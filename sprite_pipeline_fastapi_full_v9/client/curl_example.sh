#!/usr/bin/env bash
set -euo pipefail

: "${POD_ID:?Set POD_ID}"
: "${API_TOKEN:?Set API_TOKEN}"

BASE_URL="https://${POD_ID}-8000.proxy.runpod.net"
SUBJECT_PROFILE="${SUBJECT_PROFILE:-character}"
MOTION_BACKEND="${MOTION_BACKEND:-auto}"
PROMPT="${PROMPT:-A person walks naturally forward with a relaxed balanced and steady gait.}"
SEED="${SEED:-42}"

form_args=(
  -F "front=@front.png"
  -F "back=@back.png"
  -F "left=@left.png"
  -F "right=@right.png"
  -F "subject_profile=${SUBJECT_PROFILE}"
  -F "motion_backend=${MOTION_BACKEND}"
  -F "prompt=${PROMPT}"
  -F "seed=${SEED}"
)

# For an independent animal-motion-v1 file:
# SUBJECT_PROFILE=quadruped MOTION_BACKEND=animal_npz MOTION_NPZ=walk.npz ./client/curl_example.sh
if [[ -n "${MOTION_NPZ:-}" ]]; then
  form_args+=( -F "motion_npz=@${MOTION_NPZ}" )
fi

curl --fail-with-body -X POST \
  "${BASE_URL}/v1/jobs" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${form_args[@]}"
