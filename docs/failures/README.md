# 실패·기각 기록

이 디렉터리는 현재 제작 경로에서 사용하지 않는 모델, 실행 가이드와 생성 실험을 보존한다. 파일은 성공 가이드가 아니며, 같은 실패를 반복하지 않고 이후 후보를 비교하기 위한 자료다.

실패를 텍스트 판정과 작업 ID만으로 남기지 않는다. 저장소에 남아 있던 대표 입력, 실제 출력, 추출 프레임과 디버깅 화면은 [`assets/`](assets/) 아래에 분류하고 각 실패 문서 본문에서 바로 확인할 수 있도록 표시한다.

## 동작 생성

- [SCAIL-2 4방향 걷기 생성 경로 기각](SCAIL2_WALK_CYCLE_STRATEGY.md)
- [RunPod SCAIL-2 서버·클라이언트 실험](RUNPOD_SCAIL2_GUIDE.md)
- [RunPod Wan2.2 걷기 영상 실험](RUNPOD_WAN_VIDEO.md)
- [Qwen 정면 걷기 프레임 실패](QWEN_WALK_FRAME_FAILURES.md)

## 현재 경로의 단일 시도 실패

- [2026-08-16 Kimodo → Motion Adapter → One-to-All 포즈 시도 실패](KIMODO_ONE_TO_ALL_POSE_ATTEMPT_2026-08-16.md) — 서버와 archive 생성은 성공했지만 걷기 에셋 품질 기준 실패. 현재 경로는 폐기하지 않고 계속 개선한다.

## 보존용 구현 문서

- [RunPod FastAPI 서버 초기 구현](RUNPOD_FASTAPI_SERVER_IMPLEMENTATION.md) — 실제 소스 ZIP과 3세션 실행 가이드로 대체되어 활성 문서에서 제외

## 보존된 산출물

- [`failures/artifacts/sprite_pipeline_fastapi_full.zip`](../../failures/artifacts/sprite_pipeline_fastapi_full.zip) — V2 적용 전 사용한 V1 서버 소스 ZIP

## 보존된 코드

기각한 SCAIL-2 RunPod API와 로컬 client 코드는 [`failures/runpod/`](../../failures/runpod/)에 보존한다. `runpod/` 활성 경로에서는 제거했으며 다시 사용할 때는 기각 사유를 먼저 확인한다.

## 최신 개선 경로와의 구분

Kimodo → Motion Adapter → One-to-All 경로는 아직 기각하지 않았다. 서버 종단 실행은 성공했으며, 현재 pose visibility/confidence와 방향별 identity 문제를 [추후 개선 사항](../KIMODO_ONE_TO_ALL_FUTURE_IMPROVEMENTS.md)에 기록한다.
