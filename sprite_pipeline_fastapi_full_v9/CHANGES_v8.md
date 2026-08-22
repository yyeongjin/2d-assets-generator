# V8 변경 내역

V8은 V6의 정면·후면 cardinal 보정과 V7의 exact closed loop를 그대로 유지합니다. 이번 버전은 **One-to-All이 만든 프레임별 색상·명암 흔들림**과 **이미지 수준의 8→1 위치 점프를 놓치던 QC**만 추가로 다룹니다.

## 1. 네 방향 공통 reference palette

FastAPI는 `front/back/left/right` 네 원본 이미지의 전경 색상을 함께 분석해 하나의 캐릭터 팔레트를 만듭니다.

```text
4방향 원본 RGB
→ border 기반 전경 마스크
→ CIE Lab 표본
→ deterministic k-means palette
→ 17개 OTA 렌더의 hue/chroma 보정
```

- 색조와 채도는 공통 팔레트 쪽으로 보정합니다.
- 밝기와 대비는 약하게만 맞춰 자연스러운 그림자를 남깁니다.
- 검은 외곽선과 흰 하이라이트에는 보정 강도를 낮춥니다.
- 픽셀별 보정량은 `SPRITE_APPEARANCE_MAX_DELTA_E`로 제한합니다.
- 배경은 전경 soft mask 밖에서 그대로 유지합니다.

OTA 위치 보정까지만 적용된 원본은 다음 경로에 남습니다.

```text
rendered/attempt_XX/<direction>/preappearance/frame_000.png ... frame_016.png
```

최종 색상 보정 프레임은 기존 top-level `frame_XXX.png`를 사용하므로 phase 선택과 loop QC는 보정된 결과를 평가합니다.

## 2. 방향별 temporal color alignment

공통 팔레트 보정 뒤에도 한 방향 안에서 전체 색조가 프레임마다 조금씩 이동할 수 있습니다. V8은 17개 프레임의 foreground median Lab을 계산해 방향별 중앙값 쪽으로 작은 전역 오프셋을 적용합니다.

기본값:

```text
chroma temporal strength = 0.38
luma temporal strength   = 0.16
```

이 단계는 관절, 실루엣, 보폭, 프레임 위치를 변경하지 않습니다.

## 3. Appearance QC

각 attempt마다 다음 파일이 생성됩니다.

```text
rendered/attempt_XX/appearance_qc.json
rendered/attempt_XX/<direction>/appearance_meta.json
```

검사 항목:

- 프레임별 foreground median Lab
- temporal chroma spread
- temporal luma spread
- reference palette distance
- 실제 적용된 평균·p95 ΔE
- 보정량 과다 여부

기본 strict 설정에서 appearance QC가 실패하면 같은 Kimodo motion과 같은 adapter control을 유지한 채 OTA seed만 바꿔 재시도합니다.

## 4. 이미지 기반 위치·발 기준선 loop gate

V7은 축소 이미지의 luma/edge/RGB 변화량으로 loop를 검사했습니다. 이 방식은 초록색 여행자 결과처럼 8→1에서 캐릭터가 약 6px 이동해도 전체 이미지 차이가 임계값 아래면 통과할 수 있었습니다.

V8은 각 최종 후보의 foreground mask에서 다음을 추가로 측정합니다.

```text
캐릭터 centroid
ground line
foreground bbox height
foreground area
foreground median Lab
```

정면·후면 8→1 hard gate 기본값:

```text
centroid seam ratio <= 0.011
 ground seam ratio  <= 0.011
 height seam ratio  <= 0.025
```

384×384 결과에서는 centroid와 ground 기본값이 약 4.2px에 해당합니다. 측면은 큰 팔·다리 실루엣 변화가 정상이라 동일한 절대 hard gate를 적용하지 않습니다.

## 5. 더 엄격해진 loop 기본값

```text
SPRITE_LOOP_MAX_SEAM_RATIO=1.45
SPRITE_LOOP_MAX_MEAN_SEAM_RATIO=1.20
SPRITE_LOOP_MAX_TRANSITION_RATIO=2.25
SPRITE_LOOP_MAX_COLOR_SEAM_DELTA_E=12.0
```

V7 실제 검증 표본을 재평가한 기준:

- 밀짚모자 상점 주인: 통과
- 은색 단발 대장장이: 통과
- 초록색 여행자 첫 렌더: 정면 centroid/ground seam으로 거부 후 OTA 재시도 대상

## 6. 보존되는 기존 동작

V8은 다음을 변경하지 않습니다.

- 공식 Kimodo `05_root_path/motion.npz` 기본 fixture
- heading `delta = -heading`
- front/back torso yaw ±2.5°
- front/back head yaw ±5°
- left/right natural canonical motion
- 16개 고유 phase + phase-zero exact duplicate
- `even_start`, `odd`, `even_end` 공통 후보 선택
- OTA 위치 보정의 translation-only 원칙
- Kimodo/OTA/FastAPI 3개 환경과 3개 서비스 구조
- 정면·후면과 측면의 투영에 따른 보폭 차이

즉 V8은 걷기 관절과 보폭을 다시 만드는 버전이 아니라 **appearance consistency와 최종 승인 QC를 강화하는 오버레이**입니다.
