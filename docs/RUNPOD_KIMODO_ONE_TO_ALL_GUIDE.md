맞아. 다운로드 말고 **채팅에 바로 수정본**으로 보여줄게.

그리고 이번 수정본에서는 가장 큰 누락이었던 **`FastAPI 실제 구현 → 실제 실행 → 8000 LISTEN 확인 → RunPod 외부 포트 확인 → 그 다음 외부 Client 요청`** 순서를 제대로 넣었습니다. 기존 문서는 FastAPI :8000 구조를 써놓고  실제 클라이언트 요청을 먼저 설명한 뒤  Uvicorn 실행을 거의 맨 뒤에 둔 게 문제였습니다. 

# 최종 RunPod 배포 가이드 — 수정본

## 1. 최종 구조

```text
[외부 Client]
front.png
back.png
left.png
right.png
prompt
seed
        │
        │ HTTPS
        ▼
RunPod HTTP Proxy
https://<POD_ID>-8000.proxy.runpod.net
        │
        ▼
RunPod Pod
0.0.0.0:8000
FastAPI
        │
        ▼
Job Queue
        │
        ▼
Kimodo Worker
        │
        │ 3D motion 1회 생성
        ▼
Motion Adapter
        │
        ├─ gait cycle 검출
        ├─ 17 phase
        ├─ in-place
        ├─ body retarget
        └─ front/back/left/right projection
        │
        ▼
One-to-All Worker
        │
        ├─ front
        ├─ back
        ├─ left
        └─ right
        ▼
4 × 17 frames
        │
        ▼
8 frame × 4 direction
        │
        ▼
32 PNG
sprite_sheet.png
metadata.json
result.zip
```

RunPod가 **서버**입니다.

외부 PC/백엔드가 **클라이언트**입니다.

---

# 2. RunPod 환경

현재 기준:

```text
GPU      NVIDIA L40S 48GB
CUDA     12.8 호환 driver
RAM      64GB+
Disk     200GB
HTTP     8000
HF_TOKEN RunPod 환경변수
```

프로젝트:

```text
/workspace/sprite-pipeline/

├── kimodo/
│   └── .venv/
├── one-to-all/
│   └── .venv/
├── server/
│   ├── .venv/
│   └── app/
├── workers/
├── adapter/
├── jobs/
├── logs/
└── run/
```

---

# 3. Kimodo 환경

```bash
cd /workspace/sprite-pipeline/kimodo

rm -rf .venv

uv venv --python 3.11 .venv
```

설치:

```bash
uv pip install \
  --python .venv/bin/python \
  --torch-backend=cu128 \
  "torch==2.11.0" \
  "torchvision==0.26.0" \
  "torchaudio==2.11.0" \
  "transformers==5.1.0" \
  "peft==0.18.1" \
  "accelerate==1.13.0" \
  "huggingface-hub==1.6.0" \
  "safetensors==0.7.0" \
  "numpy==1.26.4" \
  "scipy==1.15.3" \
  "tokenizers==0.22.2" \
  -e ".[soma]"
```

확인:

```bash
uv pip check --python .venv/bin/python

.venv/bin/python -c '
import torch
print(torch.__version__)
print(torch.version.cuda)
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0))
'
```

기준:

```text
2.11.0+cu128
12.8
True
NVIDIA L40S
```

48GB이므로:

```bash
export TEXT_ENCODER_DEVICE=cpu
```

**사용하지 않음.**

Kimodo smoke:

```bash
mkdir -p /workspace/sprite-pipeline/jobs/smoke

.venv/bin/kimodo_gen \
  "A person walks naturally forward with a relaxed, balanced and steady gait." \
  --model Kimodo-SOMA-RP-v1.1 \
  --duration 3.0 \
  --diffusion_steps 100 \
  --num_samples 1 \
  --seed 42 \
  --output /workspace/sprite-pipeline/jobs/smoke/kimodo_walk
```

성공 기준:

```text
Saving the npz output to
/workspace/sprite-pipeline/jobs/smoke/kimodo_walk.npz
```

이건 실제 로그에서도 이미 성공한 상태입니다. 

---

# 4. One-to-All 환경

```bash
cd /workspace/sprite-pipeline/one-to-all

rm -rf .venv

uv venv --python 3.12 .venv
```

```bash
uv pip install \
  --python .venv/bin/python \
  --torch-backend=cu124 \
  "torch==2.5.1" \
  "torchvision==0.20.1" \
  "torchaudio==2.5.1" \
  -r requirements.txt
```

확인:

```bash
uv pip check --python .venv/bin/python

.venv/bin/python -c '
import torch
import diffusers
import transformers
import accelerate

print(torch.__version__)
print(torch.version.cuda)
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0))
print(diffusers.__version__)
print(transformers.__version__)
print(accelerate.__version__)
'
```

기준:

```text
torch        2.5.1+cu124
cuda         12.4
cuda avail   True
GPU          NVIDIA L40S
diffusers    0.33.0
transformers 4.40.1
accelerate   0.29.3
```

---

# 5. FlashAttention

```bash
cd /workspace/sprite-pipeline/one-to-all

MAX_JOBS=8 \
uv pip install \
  --python .venv/bin/python \
  --no-build-isolation \
  flash-attn
```

확인:

```bash
.venv/bin/python -c '
import flash_attn
print("FlashAttention OK")
'
```

---

# 6. One-to-All 모델 다운로드

```bash
cd /workspace/sprite-pipeline/one-to-all
```

```bash
.venv/bin/hf download \
  Wan-AI/Wan2.1-T2V-1.3B-Diffusers \
  --local-dir pretrained_models/Wan2.1-T2V-1.3B-Diffusers
```

```bash
.venv/bin/hf download \
  MochunniaN1/One-to-All-1.3b_2 \
  --local-dir checkpoints/One-to-All-1.3b_2
```

```bash
.venv/bin/hf download \
  Wan-AI/Wan2.2-Animate-14B \
  --include "process_checkpoint/det/*" \
  --include "process_checkpoint/pose2d/*" \
  --local-dir pretrained_models
```

```bash
.venv/bin/hf download \
  FrancisRing/StableAnimator \
  --include "DWPose/*" \
  --local-dir pretrained_models
```

---

# 7. One-to-All GPU load 확인

`inference_1.3b.py`는 파일명에 `.`이 있으므로:

```python
from inference_1.3b import build_pipe
```

금지.

실행:

```bash
cd /workspace/sprite-pipeline/one-to-all/video-generation

../.venv/bin/python -c '
import importlib.util
import torch

spec = importlib.util.spec_from_file_location(
    "ota_inference",
    "inference_1.3b.py"
)

mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

pipe = mod.build_pipe(
    "cuda",
    "../checkpoints/One-to-All-1.3b_2"
)

print("ONE-TO-ALL OK")
print("GPU:", torch.cuda.get_device_name(0))
print(
    "allocated GiB:",
    round(torch.cuda.memory_allocated()/1024**3, 2)
)
print(
    "reserved GiB:",
    round(torch.cuda.memory_reserved()/1024**3, 2)
)

input("press enter to exit")
'
```

성공:

```text
ONE-TO-ALL OK
GPU: NVIDIA L40S
allocated GiB: ...
reserved GiB: ...
```

---

# 8. 여기서부터가 서버 구현

**이 부분이 기존 가이드에서 빠졌던 핵심.**

먼저:

```bash
cd /workspace/sprite-pipeline/server
```

이미 `uv init` 되어 있으므로 다시:

```bash
uv init
```

할 필요 없음.

현재 패키지도 이미 설치됨:

```bash
uv add \
  fastapi \
  "uvicorn[standard]" \
  python-multipart \
  aiofiles \
  pillow \
  numpy \
  httpx
```

---

# 9. FastAPI 디렉터리

```bash
cd /workspace/sprite-pipeline/server

mkdir -p app

touch app/__init__.py
touch app/main.py
touch app/jobs.py
touch app/pipeline.py
```

구조:

```text
server/

├── pyproject.toml
├── .venv/
└── app/
    ├── __init__.py
    ├── main.py
    ├── jobs.py
    └── pipeline.py
```

---

# 10. 서버 endpoint는 이것들이 실제로 구현되어야 함

```text
GET  /health

POST /v1/jobs

GET  /v1/jobs/{job_id}

GET  /v1/jobs/{job_id}/result
```

단순 `/health` 서버만 만드는 게 아닙니다.

최종 API 역할:

```text
POST /v1/jobs
↓
파일 저장
↓
job_id 생성
↓
queue 등록
↓
202 반환

background worker
↓
Kimodo
↓
Adapter
↓
OTA
↓
result.zip

GET /v1/jobs/{id}
↓
status 반환

GET /v1/jobs/{id}/result
↓
ZIP 반환
```

---

# 11. FastAPI를 반드시 실제로 실행

**여기가 기존 가이드에서 빠졌던 단계.**

서버 코드 구현이 된 다음:

```bash
cd /workspace/sprite-pipeline/server

uv run uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1
```

이 명령을 실행해야:

```text
0.0.0.0:8000
```

서버가 생깁니다.

---

# 12. 반드시 LISTEN 확인

새 RunPod 터미널:

```bash
ss -lntp | grep ':8000'
```

반드시:

```text
LISTEN ... 0.0.0.0:8000 ...
```

이 나와야 합니다.

지금 네가 전에 보여준:

```text
9091
8888
7270
8081
8001
7861
3001
19123
```

상태처럼 `8000`이 없으면 **서버 안 떠 있는 것**입니다.

그 상태에서는 외부 요청 절대 안 됨.

---

# 13. RunPod 내부 API 확인

이제야:

```bash
curl http://127.0.0.1:8000/health
```

를 확인합니다.

그리고 `/v1/jobs` route 자체가 등록됐는지도:

```bash
curl http://127.0.0.1:8000/openapi.json
```

에서 확인할 수 있습니다.

간단히:

```bash
curl -s http://127.0.0.1:8000/openapi.json | grep '/v1/jobs'
```

여기서:

```text
/v1/jobs
/v1/jobs/{job_id}
/v1/jobs/{job_id}/result
```

가 있어야 합니다.

**없으면 외부로 포트를 열어도 생성 API가 없는 것.**

---

# 14. RunPod 8000 포트 expose

그 다음에 RunPod Pod 설정에서:

```text
HTTP Port
8000
```

을 expose.

최종 공개 주소:

```text
https://<POD_ID>-8000.proxy.runpod.net
```

---

# 15. 외부 클라이언트 테스트는 그 다음

이 명령은 **RunPod 안에서 치는 명령이 아님.**

네 PC / 앱 서버 / 게임 backend 등 외부 클라이언트에서 실행.

먼저:

```bash
curl \
  "https://${POD_ID}-8000.proxy.runpod.net/health"
```

성공해야:

```text
외부 Client
↓
RunPod Proxy
↓
FastAPI :8000
```

연결 완료.

---

# 16. 실제 Client → RunPod 생성 요청

클라이언트가 보내는 데이터:

```text
front.png
back.png
left.png
right.png
prompt
seed
```

`action=walk` 없음.

요청:

```bash
curl -X POST \
  "https://${POD_ID}-8000.proxy.runpod.net/v1/jobs" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F "front=@front.png" \
  -F "back=@back.png" \
  -F "left=@left.png" \
  -F "right=@right.png" \
  -F "prompt=A person walks naturally forward with a relaxed, balanced and steady gait." \
  -F "seed=42"
```

응답:

```json
{
  "job_id": "01K2ABCDEF123456",
  "status": "queued"
}
```

이 응답은 **생성이 끝났다는 뜻이 아님.**

Queue에 들어갔다는 뜻.

---

# 17. 상태 조회

외부 Client:

```bash
curl \
  "https://${POD_ID}-8000.proxy.runpod.net/v1/jobs/${JOB_ID}" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

처리 중:

```json
{
  "job_id": "01K2ABCDEF123456",
  "status": "processing",
  "stage": "render_left",
  "progress": 72
}
```

stage:

```text
queued
kimodo
motion_adapter
render_front
render_back
render_left
render_right
postprocess
succeeded
failed
```

---

# 18. 결과 다운로드

성공 후 외부 Client:

```bash
curl -L \
  "https://${POD_ID}-8000.proxy.runpod.net/v1/jobs/${JOB_ID}/result" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -o result.zip
```

결과:

```text
result.zip

├── front/
│   ├── 0.png
│   ├── 1.png
│   ├── ...
│   └── 7.png
├── back/
│   └── 0.png ... 7.png
├── left/
│   └── 0.png ... 7.png
├── right/
│   └── 0.png ... 7.png
├── sprite_sheet.png
└── metadata.json
```

---

# 19. Production에서는 FastAPI background 실행

Foreground 테스트가 끝나고 실제 운영할 때:

```bash
cd /workspace/sprite-pipeline/server

mkdir -p /workspace/sprite-pipeline/logs
mkdir -p /workspace/sprite-pipeline/run
```

실행:

```bash
nohup env PYTHONUNBUFFERED=1 \
  uv run uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  > /workspace/sprite-pipeline/logs/api.log 2>&1 &

echo $! > /workspace/sprite-pipeline/run/api.pid
```

확인:

```bash
cat /workspace/sprite-pipeline/run/api.pid
```

```bash
ss -lntp | grep ':8000'
```

```bash
curl http://127.0.0.1:8000/health
```

로그:

```bash
tail -f /workspace/sprite-pipeline/logs/api.log
```

종료:

```bash
kill "$(cat /workspace/sprite-pipeline/run/api.pid)"
```

---

# 20. 모델 worker도 background 상주

최종 프로세스:

```text
RunPod

PID 1-ish
├─ Kimodo worker
│    └─ Kimodo + LLM2Vec GPU resident
│
├─ OTA worker
│    └─ One-to-All GPU resident
│
└─ FastAPI :8000
     └─ Client HTTP API
```

원칙:

```text
Kimodo resident
OTA resident

하지만 inference 동시 실행은 안 함.

GPU concurrency = 1
```

처리:

```text
Job A

Kimodo
↓
Adapter
↓
OTA front
↓
OTA back
↓
OTA left
↓
OTA right
↓
ZIP
```

그다음 Job B.

---

# 21. 서버 job 디렉터리

```text
jobs/<job_id>/

├── input/
│   ├── front.png
│   ├── back.png
│   ├── left.png
│   └── right.png
│
├── motion/
│   └── motion.npz
│
├── pose/
│   ├── front/
│   ├── back/
│   ├── left/
│   └── right/
│
├── rendered/
│   ├── front/
│   ├── back/
│   ├── left/
│   └── right/
│
├── result/
│   ├── front/
│   ├── back/
│   ├── left/
│   ├── right/
│   ├── sprite_sheet.png
│   ├── metadata.json
│   └── result.zip
│
└── status.json
```

---

# 22. 최종 실행 순서

이 순서가 최종입니다.

```text
① Kimodo 설치
↓
② Kimodo 실제 NPZ 생성 확인
↓
③ One-to-All 설치
↓
④ One-to-All GPU load 확인
↓
⑤ Motion Adapter 구현
↓
⑥ Kimodo resident worker 구현
↓
⑦ OTA resident worker 구현
↓
⑧ FastAPI 실제 /v1/jobs 구현
↓
⑨ uvicorn app.main:app --host 0.0.0.0 --port 8000 실행
↓
⑩ ss -lntp | grep :8000
↓
⑪ RunPod 내부 API 검사
↓
⑫ RunPod에서 HTTP 8000 expose
↓
⑬ 외부 Client에서 /health 검사
↓
⑭ 외부 Client에서 POST /v1/jobs
↓
⑮ polling
↓
⑯ result.zip 다운로드
```

**특히 `⑨ FastAPI 실행`이 없으면 8000은 존재하지 않습니다.**

그리고 `⑧ /v1/jobs 구현`이 없으면 FastAPI를 실행해도 `/health` 같은 정의된 route 외에는 아무것도 못 합니다.

즉 둘 다 필수입니다:

```text
API 코드 구현
+
API 프로세스 실행
```

이게 수정된 기준입니다.
