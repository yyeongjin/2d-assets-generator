# 기각된 RunPod 코드

이 디렉터리는 SCAIL-2를 4방향 정지 이미지 기반 동작 생성기로 사용하려 했던 API와 로컬 client 구현을 보존한다.

현재 활성 코드가 아니며 다음 이유로 `runpod/`에서 이동했다.

- SCAIL-2는 정지 이미지와 동작 이름만으로 새 걷기 동작을 만드는 모델이 아님
- 방향별 Driving RGB video와 mask가 먼저 필요함
- 프로젝트가 필요로 하는 motion synthesis 단계를 해결하지 않음
- 생성 결과의 캐릭터 identity, 높이, baseline과 phase 고정을 보장하지 않음

코드는 삭제하지 않는다. 다시 검토할 때는 먼저 다음 문서를 확인한다.

- [SCAIL-2 기각 판단](../../docs/failures/SCAIL2_WALK_CYCLE_STRATEGY.md)
- [RunPod 서버·클라이언트 실험](../../docs/failures/RUNPOD_SCAIL2_GUIDE.md)
