# V7 다른 캐릭터 3종 종단 검증 기록

이 문서는 V7 파이프라인을 RunPod L40S에서 실제로 실행해 `4방향 RGB 입력 → 공식 Kimodo walk fixture → Motion Adapter → One-to-All → 방향별 8 PNG → result.zip` 전 과정을 완료한 결과를 보존합니다. V5와 V6 기록은 비교 baseline으로 그대로 유지하며, 이 기록이 이전 결과를 대체하거나 삭제하지 않습니다.

## 공통 실행 결과

- pipeline version: `7.0.0`
- seed: `4821`
- 방향: `front`, `back`, `left`, `right`
- 방향별 프레임: 8장
- 전체 프레임: 32장
- source control: 17 frames
- 선택 phase: `16, 2, 4, 6, 8, 10, 12, 14`
- 선택 후보: `even_end`
- One-to-All 재시도: 없음 (`selected_attempt=0`)
- loop QC: 세 작업 모두 통과
- result.zip 무결성: 세 작업 모두 확인

V7의 자동 검사는 동작 연결과 loop 경계를 판정합니다. 색상·얼굴·액세서리·체형은 별도 육안 및 색상 표본 비교로 확인했으며, 아직 모든 에셋에 대한 제작 승인을 뜻하지는 않습니다.

## 1. 밀짚모자 상점 주인

- source asset: `CHARACTER-20260804114151-6b37261d`
- job ID: `8f5869627b2a4b5c8baf2a14af6c39c3`
- result ZIP SHA-256: `b167d4a16bdea8e0a992a80177cef158c6d88ed395b5198fdeb097160d6d1d91`
- loop score: `1.756840`
- worst seam ratio: `1.060338`
- mean seam ratio: `0.719747`
- worst transition ratio: `1.350337`
- 관찰: 밀짚모자와 붉은 상의, 어두운 하의가 네 방향과 32프레임에서 식별 가능하게 유지됐습니다. 세 작업 중 loop 경계 수치가 가장 안정적입니다.
- [결과 ZIP](v7-other-characters/shopkeeper/result.zip) · [sprite sheet](v7-other-characters/shopkeeper/sprite-sheet.png) · [metadata](v7-other-characters/shopkeeper/metadata.json) · [원본 4방향 시트](v7-other-characters/shopkeeper/source.png)

![밀짚모자 상점 주인 V7 걷기](v7-other-characters/shopkeeper/walk-cycle.gif)

## 2. 짧고 다부진 초록색 여행자

- source asset: `CHARACTER-20260804113611-028b7836`
- job ID: `520eb002b37045adabf4f4921a62b92e`
- result ZIP SHA-256: `6a35c70baae00b61b98f163a9d466c1f0f8d88edd384d9620abfbb6ed8118349`
- loop score: `2.241474`
- worst seam ratio: `1.614865`
- mean seam ratio: `0.909020`
- worst transition ratio: `1.614865`
- 관찰: 초록색 상의와 베이지색 하의는 32프레임에서 큰 색상 이탈 없이 유지됐습니다. 표본 색상 비교에서 초록색 중앙값은 `RGB(0, 85, 0)`, 프레임 최대 거리는 약 `11`, 베이지색 중앙값은 `RGB(189, 159, 78)`, 최대 거리는 약 `20.8`이었습니다. 다만 정면 loop seam은 통과 한계 `1.65`에 가까워 후속 개선 대상으로 남깁니다.
- [결과 ZIP](v7-other-characters/short-traveler/result.zip) · [sprite sheet](v7-other-characters/short-traveler/sprite-sheet.png) · [metadata](v7-other-characters/short-traveler/metadata.json) · [원본 4방향 시트](v7-other-characters/short-traveler/source.png)

![짧고 다부진 초록색 여행자 V7 걷기](v7-other-characters/short-traveler/walk-cycle.gif)

## 3. 은색 단발 대장장이

- source asset: `CHARACTER-20260804113857-738e8125`
- job ID: `e79e1e3aeb404a01883434f7d653334c`
- result ZIP SHA-256: `a8a7c6e9f5073d6e34f0ec9476f07ad84766c2d31fd8424cd705b867ee970f62`
- loop score: `1.966717`
- worst seam ratio: `1.171047`
- mean seam ratio: `0.860471`
- worst transition ratio: `1.368746`
- 관찰: 갈색 앞치마, 크림색 셔츠와 은색 머리가 전 프레임에서 안정적으로 유지됐습니다. 표본 최대 RGB 거리는 갈색 약 `18.8`, 크림색 약 `11`, 은색 약 `10.8`이었습니다.
- [결과 ZIP](v7-other-characters/blacksmith/result.zip) · [sprite sheet](v7-other-characters/blacksmith/sprite-sheet.png) · [metadata](v7-other-characters/blacksmith/metadata.json) · [원본 4방향 시트](v7-other-characters/blacksmith/source.png)

![은색 단발 대장장이 V7 걷기](v7-other-characters/blacksmith/walk-cycle.gif)

## 동일 입력·seed 결정론 확인

대장장이 입력을 같은 seed `4821`로 다시 실행한 두 번째 job은 `effdb9e10aa048fb954d597955fb50e1`입니다. 두 작업의 ZIP 자체는 job metadata와 생성 시각 때문에 체크섬이 달랐지만, 방향별 출력 PNG 32장은 모두 바이트 단위로 동일했습니다. 따라서 현재 V7 설정에서 같은 입력과 seed의 최종 이미지 출력은 재현됐습니다.

## 현재 판정

- V7 실제 L40S 종단 렌더: 성공
- 캐릭터 3종 모두 4방향 32 PNG와 result.zip 생성: 성공
- 세 작업 모두 loop QC: 통과
- 주요 의상 색상 일관성: 이번 표본에서 양호
- 동일 입력·seed 재현성: 대장장이 32 PNG로 확인
- 남은 문제: 초록색 여행자의 정면 loop seam이 임계값에 가깝고, 더 다양한 체형·액세서리·생명체에서 외형 일관성을 계속 확인해야 함

이 결과는 V7이 이전보다 가능성이 높다는 실제 근거이지만, 모든 에셋 유형의 제작 품질을 보장하는 최종 승인 기록은 아닙니다.
