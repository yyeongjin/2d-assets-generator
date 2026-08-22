# animal-motion-v1 contract examples

이 디렉터리의 NPZ 두 개는 V9 API routing과 외부 motion 입력 계약을 바로 시험하기 위한 작은 기준 파일입니다.

- `quadruped_walk_contract_example.npz`
- `biped_animal_walk_contract_example.npz`

이 파일들은 **학습된 동물 motion 모델의 출력 품질 샘플이 아닙니다.** V9 procedural scaffold에서 만든 normalized control을 `animal-motion-v1` 형식으로 저장한 것으로, multipart 업로드·profile 검증·주기 resample·17번째 endpoint closure·One-to-All 요청 배선을 점검하는 용도입니다.

재생성:

```bash
python scripts/create_animal_motion_npz_example.py \
  --subject-profile quadruped \
  --output examples/animal-motion-v1/quadruped_walk_contract_example.npz

python scripts/create_animal_motion_npz_example.py \
  --subject-profile biped_animal \
  --output examples/animal-motion-v1/biped_animal_walk_contract_example.npz
```

검증:

```bash
python scripts/validate_animal_motion_npz.py \
  examples/animal-motion-v1/quadruped_walk_contract_example.npz \
  --subject-profile quadruped
```

API 예시:

```bash
curl --fail-with-body -X POST "${BASE_URL}/v1/jobs" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F "front=@front.png" \
  -F "back=@back.png" \
  -F "left=@left.png" \
  -F "right=@right.png" \
  -F "prompt=four-legged animal walking in place" \
  -F "subject_profile=quadruped" \
  -F "motion_backend=animal_npz" \
  -F "motion_npz=@examples/animal-motion-v1/quadruped_walk_contract_example.npz"
```
