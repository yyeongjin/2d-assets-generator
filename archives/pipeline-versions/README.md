# 이전 Sprite Pipeline ZIP 보관소

현재 실행 버전은 저장소 루트의 [`sprite_pipeline_fastapi_full_v7.zip`](../../sprite_pipeline_fastapi_full_v7.zip)입니다. 이 폴더는 이전 버전의 재현과 회귀 비교를 위한 보관소이며, 현재 RunPod 설치에는 사용하지 않습니다.

| 버전 | 파일 | SHA-256 | 기록 의미 |
|---|---|---|---|
| V2 | [sprite_pipeline_fastapi_full_v2.zip](sprite_pipeline_fastapi_full_v2.zip) | `918d3bcca463da460f5423a046aa5344c3c96842ffc735c424fe082c3d9456f5` | 초기 Kimodo → Adapter → One-to-All 연결 비교용 |
| V3 | [sprite_pipeline_fastapi_full_v3.zip](sprite_pipeline_fastapi_full_v3.zip) | `a3becc794a82f1f82cbe1e766a48221c5dd756367fe8fc48339cb4e94f3a54b7` | 생성 motion 품질 실패 분석 비교용 |
| V5 | [sprite_pipeline_fastapi_full_v5.zip](sprite_pipeline_fastapi_full_v5.zip) | `b958ac341a5eaf2e721e5eb7902e0e6cfb1e3e622b3c3df2a3ef91a5643b2e8c` | 공식 Kimodo fixture 종단 성공 baseline |
| V6 | [sprite_pipeline_fastapi_full_v6.zip](sprite_pipeline_fastapi_full_v6.zip) | `92975b29c63f0efe5d5702d45d820a3c7d5eed2c8150b01523a44b7b222ec804` | cardinal 보정과 다중 캐릭터 검증 baseline |

V1은 실패 구현과 함께 [`failures/artifacts/`](../../failures/artifacts/)에 별도로 보존합니다. V4는 배포하지 않았습니다. 이전 ZIP과 관련 문서·GIF·결과물은 삭제하지 않습니다.
