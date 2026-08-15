# 실패 경로 산출물

현재 활성 실행 경로에서 제외한 바이너리 산출물을 삭제하지 않고 보존한다.

## `sprite_pipeline_fastapi_full.zip`

- 상태: V1, 사용 중단
- SHA-256: `ce3e534282bea3fb111120926d1042c14ccb04f31b002edecfdf30e7ff330b38`
- 관련 기록: [`docs/failures/RUNPOD_FASTAPI_SERVER_IMPLEMENTATION.md`](../../docs/failures/RUNPOD_FASTAPI_SERVER_IMPLEMENTATION.md)
- 대체 파일: 저장소 루트의 [`sprite_pipeline_fastapi_full_v2.zip`](../../sprite_pipeline_fastapi_full_v2.zip)

V1은 초기 Kimodo → Motion Adapter → One-to-All 연결 코드다. V2에서 heading 계산, 좌우 projection sign, pose visibility, 후면 face point와 OTA reference control을 수정했으므로 새 RunPod 환경에는 V1을 배치하지 않는다.
