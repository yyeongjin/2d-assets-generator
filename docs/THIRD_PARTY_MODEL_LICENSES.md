# 사용 모델·보조 체크포인트 라이선스 등록부

> 최종 확인: 2026-08-22  
> 범위: 이 저장소에서 실제로 다운로드·실행했거나 현재 RunPod 파이프라인이 요구하는 모델과 보조 체크포인트

이 문서는 법률 자문이 아니라 배포 전 확인용 등록부다. 모델 코드의 라이선스와 가중치의 라이선스가 다르면 반드시 따로 기록한다. 모델 카드의 단일 `license` 태그가 그 안에 묶인 모든 제3자 구성 요소의 조건을 덮어쓴다고 가정하지 않는다.

## 현재 배포 상태

- 저장소와 저장소 안의 ZIP 20개를 검사한 결과 `safetensors`, `ckpt`, `pt`, `pth`, `onnx`, `bin`, `gguf`, `torchscript` 모델 파일은 포함되어 있지 않다.
- 현재 ZIP은 서버 코드, 작은 계약용 NPZ fixture와 테스트 결과만 배포한다.
- 실제 모델은 RunPod에서 원 출처로부터 다운로드한다. 따라서 현재 Git 배포는 모델 **사용**에는 해당하지만 모델 가중치 **재배포**는 하지 않는다.
- 향후 가중치를 Pod image, ZIP, release asset 또는 별도 mirror에 넣으면 아래 재배포 조건을 다시 적용하고 라이선스·NOTICE 파일을 패키지에 포함해야 한다.
- 생성 결과물은 모델 가중치와 같지 않다. 다만 입력 이미지의 저작권·상표·초상권과 출력물 사용 가능 여부는 별도로 검토해야 한다.
- 저장소 자체의 루트 `LICENSE`는 현재 없다. 제3자 모델 등록부가 이 프로젝트 소스의 라이선스를 대신하지 않으므로, 공개 배포 조건은 저장소 소유자가 별도로 선택해야 한다.

## 1. 현재 사람·캐릭터 생성 경로

| 구성 요소 | 프로젝트에서의 역할 | 코드 | 가중치·모델 | 현재 판정 |
|---|---|---|---|---|
| [NVIDIA Kimodo](https://github.com/nv-tlabs/kimodo) | 사람 걷기 motion과 공식 `05_root_path/motion.npz` fixture | Apache-2.0 | [Kimodo-SOMA-RP-v1.1](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1): NVIDIA Open Model License | 사용 가능. 가중치나 파생 모델을 재배포하면 NVIDIA 라이선스 사본과 지정 문구 필요 |
| [One-to-All Animation](https://github.com/ssj9596/One-to-All-Animation) | 네 방향 pose control을 RGB 프레임으로 렌더 | Apache-2.0 | [One-to-All-1.3b_2](https://huggingface.co/MochunniaN1/One-to-All-1.3b_2): Apache-2.0 | 사용 가능. 재배포 시 Apache-2.0 고지 유지 |
| [Wan2.1 T2V 1.3B](https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers) | One-to-All 1.3B 기반 모델 | Apache-2.0 | Apache-2.0 | 사용 가능. One-to-All만 기록하고 기반 모델을 누락하지 않음 |

### Kimodo generated 모드에서만 추가되는 모델

현재 안정 경로인 `KIMODO_MOTION_SOURCE=official_example`은 아래 LLM stack을 로드하지 않는다. 새로운 Kimodo motion을 만드는 `generated` 모드를 켤 때만 적용한다.

| 구성 요소 | 표시 라이선스 | 추가 조건과 판정 |
|---|---|---|
| [LLM2Vec Meta-Llama-3-8B-Instruct mntp](https://huggingface.co/McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp) | MIT | LLM2Vec 코드·adapter의 MIT 표기만으로 기반 Meta Llama 조건이 사라지지 않음 |
| [LLM2Vec Meta-Llama-3-8B-Instruct mntp-supervised](https://huggingface.co/McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised) | MIT | 위와 동일 |
| [Meta-Llama-3-8B-Instruct](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct) | Meta Llama 3 Community License | gated access·AUP 적용. 제품/서비스 또는 모델 재배포 시 Meta의 표시·NOTICE 조건 확인 필요 |

Meta Llama 3을 사용한 제품·서비스를 배포할 때 공식 약관이 요구하는 `Built with Meta Llama 3` 표시와 다음 NOTICE를 보존한다.

```text
Meta Llama 3 is licensed under the Meta Llama 3 Community License,
Copyright © Meta Platforms, Inc. All Rights Reserved.
```

월간 활성 사용자 7억 명을 초과하는 제품·서비스에는 별도 라이선스 요청 조건이 있다. 또한 Llama 출력으로 다른 LLM을 개선하는 사용 제한도 있으므로 generated 모드를 별도 기능으로 취급한다.

## 2. One-to-All 전처리용 보조 체크포인트

One-to-All 자체의 Apache-2.0 표기와 별개로 실제 전처리 파일의 원 출처도 등록한다.

| 실제 파일·구성 | 내려받은 출처 | 원 프로젝트 | 판정 |
|---|---|---|---|
| `vitpose_h_wholebody.onnx` | [Wan2.2-Animate-14B](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) | [ViTPose](https://github.com/ViTAE-Transformer/ViTPose) | aggregate와 원 코드 모두 Apache-2.0으로 확인 |
| `dw-ll_ucoco_384.onnx` | [StableAnimator](https://huggingface.co/FrancisRing/StableAnimator) | [DWPose](https://github.com/IDEA-Research/DWPose) | Apache-2.0 |
| `yolox_l.onnx` | [StableAnimator](https://huggingface.co/FrancisRing/StableAnimator) | [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) | Apache-2.0 |
| `yolov10m.onnx` | [Wan2.2-Animate-14B](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B/tree/main/process_checkpoint/det) | [YOLOv10](https://github.com/THU-MIG/yolov10) | **재배포 보류**. aggregate는 Apache-2.0으로 표시하지만 원 저장소는 AGPL-3.0 |

### YOLOv10m 조치

`yolov10m.onnx`의 정확한 파일별 라이선스가 원 저작권자로부터 명시적으로 확인되기 전에는 다음 원칙을 적용한다.

- 현재처럼 RunPod가 원 출처에서 실행 시 다운로드하는 실험은 기록을 남긴다.
- 해당 ONNX를 저장소 ZIP, 컨테이너 이미지나 유료 비공개 배포본에 넣지 않는다.
- 상용·비공개 배포 전 Apache 계열 대체 detector로 교체하거나 권리자에게 서면 확인을 받는다.
- AGPL 적용 범위에 관한 법적 결론을 이 문서가 대신하지 않는다.

## 3. 과거에 실제 실행했지만 현재 기각된 모델

기각 기록도 삭제하지 않는다. 현재 프로덕션 경로에서 빠졌다는 사실과 라이선스 기록은 별개다.

| 모델 | 사용 이력 | 코드·가중치 표시 | 판정 |
|---|---|---|---|
| [Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) | 4방향 기준 이미지, 오브젝트와 개별 걷기 frame 생성 실험 | Apache-2.0 | 상업 사용을 막는 모델 조건은 확인되지 않음. 현재 걷기 경로에서는 기각 |
| [Wan2.2-TI2V-5B-Diffusers](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers) | 이미지→걷기 영상 실험 | Apache-2.0 | 현재 방식은 기각. 재배포 시 Apache 고지 유지 |
| [SCAIL-2](https://huggingface.co/zai-org/SCAIL-2) | reference/driving 기반 동작 전이 실험 | 모델 카드 MIT, [추론 코드](https://github.com/zai-org/SCAIL-2) Apache-2.0 | 현재 방식은 기각. bundled Wan VAE·T5 등 제3자 모듈 조건을 별도로 확인해야 함 |

FLUX.1 Kontext, FLUX.2 Klein과 검색 중 검토한 sprite LoRA는 후보 조사만 했고 이 저장소의 실행·결과 기록에서 실제 사용을 확인하지 못했으므로 `사용 모델` 표에는 넣지 않았다. 나중에 실제로 다운로드하거나 호출하면 사용 전에 이 문서를 갱신한다.

## 4. SCAIL-2 전처리를 다시 사용할 경우의 추가 조건

SCAIL-2는 현재 기각됐지만 공식 SCAIL-Pose 경로를 다시 실행하면 다음 항목이 추가된다.

| 구성 요소 | 코드 | 가중치 | 판정 |
|---|---|---|---|
| [SCAIL-Pose](https://github.com/zai-org/SCAIL-Pose) | Apache-2.0 | 여러 외부 모델 조합 | 각 가중치 조건을 개별 적용 |
| [NLF](https://github.com/isarandi/nlf) | MIT | 공식 release 모델은 **비상업 연구용** | 상용 에셋 파이프라인 사용·재배포 금지 상태로 취급 |
| [SAM 3](https://huggingface.co/facebook/sam3) | SAM License | SAM License, gated access | 사용·수정·재배포 권한은 있으나 재배포 시 동일 약관과 약관 사본 제공 필요 |
| DWPose / YOLOX | Apache-2.0 | Apache-2.0 출처 | Apache 고지 유지 |

SCAIL-Pose 코드가 Apache-2.0이라는 사실은 `nlf_l_multi_0.3.2.torchscript`의 비상업 제한을 없애지 않는다. 이 때문에 NLF가 필요한 SCAIL pose-driven 전처리는 현재 상용 후보에서 제외한다. SCAIL-2의 end-to-end + SAM3 경로를 별도로 검토할 때도 SAM License 동의와 재배포 조건을 적용한다.

## 5. 라이선스별 배포 체크

### Apache-2.0

- 라이선스 사본 포함
- 수정한 파일에는 변경 사실 표시
- 기존 copyright·patent·trademark·attribution 고지 유지
- 원 배포물에 `NOTICE`가 있으면 파생 배포물에도 관련 NOTICE 유지

### MIT

- 저작권 표시와 라이선스 문구를 배포물에 포함
- 모델이 다른 기반 모델의 파생물이라면 기반 모델 조건도 함께 적용

### NVIDIA Open Model License — Kimodo 가중치

상업적 사용과 파생 모델 배포는 허용되지만, 모델·파생 모델 재배포 시 라이선스 사본과 아래 문구를 포함한다.

```text
Licensed by NVIDIA Corporation under the NVIDIA Open Model License
```

NVIDIA는 모델 출력의 소유권을 주장하지 않지만, 출력과 입력의 제3자 권리를 대신 보증하지 않는다.

### Meta Llama 3 Community License

- 약관과 Acceptable Use Policy 준수
- 배포 형태에 따라 `Built with Meta Llama 3` 표시
- 공식 NOTICE 보존
- 7억 MAU 조항과 다른 LLM 개선 제한 확인

### SAM License

- gated model 접근 시 약관에 동의한 계정만 다운로드
- SAM Materials 또는 파생물을 제3자에게 제공할 때 동일 약관 적용과 약관 사본 제공
- 연구 결과 공개 시 SAM 사용 사실 표시

### 비상업 연구 전용

- NLF 공식 release weight를 상업적 에셋 생성, 유료 서비스 또는 상용 배포에 사용하지 않음
- 코드의 MIT와 모델 가중치의 비상업 조건을 혼동하지 않음

## 6. 새 모델 등록 규칙

새 모델·LoRA·VAE·text encoder·pose detector·segmenter·upscaler를 추가하기 전에 다음을 채운다.

1. 정확한 repository ID와 다운로드 revision 또는 commit
2. 프로젝트에서의 역할과 실제 파일명
3. 코드 라이선스와 가중치 라이선스
4. 기반 모델과 포함된 제3자 구성 요소
5. gated access, AUP, 비상업, copyleft, attribution과 NOTICE 조건
6. 가중치를 실행 시 다운로드하는지, 배포물에 포함하는지
7. 상용 사용·가중치 재배포·생성 결과 사용의 판정을 각각 분리
8. 불명확하면 `재배포 보류`로 등록하고 ZIP·image에 포함하지 않음

## 7. 배포 전 체크리스트

- [ ] 이 문서의 현재 모델 ID와 실제 RunPod 다운로드 명령이 일치한다.
- [ ] 저장소·ZIP·container image에 의도하지 않은 모델 파일이 없다.
- [ ] 포함하는 모든 모델의 라이선스와 NOTICE를 배포물에 넣었다.
- [ ] Kimodo 가중치가 포함되면 NVIDIA 지정 문구를 넣었다.
- [ ] Kimodo generated 모드를 쓰면 Meta Llama 3 조건을 적용했다.
- [ ] NLF 비상업 가중치를 상용 경로에서 사용하지 않는다.
- [ ] `yolov10m.onnx`는 권리 확인 전 비공개·상용 배포물에 포함하지 않는다.
- [ ] 입력 에셋과 생성 결과의 저작권·상표·초상권을 별도로 확인했다.

## 공식 근거

- [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)
- [Meta Llama 3 Community License](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
- [SAM License](https://huggingface.co/facebook/sam3/blob/main/LICENSE)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [NLF 공식 저장소와 모델 사용 범위](https://github.com/isarandi/nlf)
- [YOLOv10 공식 AGPL-3.0 LICENSE](https://github.com/THU-MIG/yolov10/blob/main/LICENSE)
