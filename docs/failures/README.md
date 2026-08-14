# 실패·기각 기록

이 디렉터리는 현재 제작 경로에서 사용하지 않는 모델, 실행 가이드와 생성 실험을 보존한다. 파일은 성공 가이드가 아니며, 같은 실패를 반복하지 않고 이후 후보를 비교하기 위한 자료다.

## 동작 생성

- [SCAIL-2 4방향 걷기 생성 경로 기각](SCAIL2_WALK_CYCLE_STRATEGY.md)
- [RunPod SCAIL-2 서버·클라이언트 실험](RUNPOD_SCAIL2_GUIDE.md)
- [RunPod Wan2.2 걷기 영상 실험](RUNPOD_WAN_VIDEO.md)
- [Qwen 정면 걷기 프레임 실패](QWEN_WALK_FRAME_FAILURES.md)

## 보존된 코드

기각한 SCAIL-2 RunPod API와 로컬 client 코드는 [`failures/runpod/`](../../failures/runpod/)에 보존한다. `runpod/` 활성 경로에서는 제거했으며 다시 사용할 때는 기각 사유를 먼저 확인한다.

## 최신 개선 경로와의 구분

Kimodo → Motion Adapter → One-to-All 경로는 아직 기각하지 않았다. 서버 종단 실행은 성공했으며, 현재 pose visibility/confidence와 방향별 identity 문제를 [추후 개선 사항](../KIMODO_ONE_TO_ALL_FUTURE_IMPROVEMENTS.md)에 기록한다.
