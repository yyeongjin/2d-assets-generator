# V7 changes

V7 keeps every V6 cardinal-view correction and fixes the remaining 8→1 loop seam.

## 1. Exact closed 17-frame control sequence

V6 sampled the selected Kimodo gait cycle with `linspace(start, end, 17)`. The first and last samples represented the same heel-strike phase but were not identical joint arrays.

V7 now builds:

```text
16 unique phases on [cycle_start, cycle_end)
+
control_016 = exact copy of control_000
```

The 17-frame count remains compatible with Wan/One-to-All, while the driving pose is mathematically closed. Adapter validation rejects any direction whose frame/depth/score endpoint differs from phase zero.

## 2. Rendered-frame stabilization

One-to-All can drift even when the driving skeleton is stationary. V7 runs the already-loaded BODY_18 detector on the 17 generated images and applies translation-only stabilization:

```text
X anchor = left/right hip center
Y anchor = lowest detected ankle
Target   = matching cyclic driving-control anchor
```

No scale, rotation, bone length, limb pose, or character proportions are rewritten. Raw frames remain under `rendered/attempt_XX/<direction>/raw/`, and applied shifts are recorded in `render_meta.json`.

## 3. Automatic 8-frame phase selection

V6 always copied frames `0,2,4,...14`. V7 scores three phase-preserving candidates across all four directions:

```text
even_start = 0,2,4,6,8,10,12,14
odd        = 1,3,5,7,9,11,13,15
even_end   = 16,2,4,6,8,10,12,14
```

`even_end` uses frame 16 as phase zero when One-to-All's frame 0 is overly anchored to the reference image. One global candidate is selected for front/back/left/right so all directions keep identical gait phase timing.

## 4. Final 8→1 loop QC and deterministic retry

The final candidate is scored on all eight transitions, including frame 8→1. V7 records per-direction seam ratios, maximum transition ratios, and the selected candidate in `loop_qc.json`.

Default behavior:

```text
OTA_LOOP_MAX_ATTEMPTS=2
attempt 1 seed = user seed
attempt 2 seed = user seed + 100003
```

The second One-to-All render runs only when the first attempt fails loop QC. With strict mode enabled, no result ZIP is published when every attempt fails.

## 5. Result provenance

`metadata.json` now records:

- selected render attempt and render seed
- selected 8 source frame indices
- every attempted loop candidate summary
- exact closed-control status
- loop thresholds and final loop QC

The result ZIP adds:

```text
debug/loop_qc.json
debug/<direction>/render_meta.json
```

## 6. Preserved V6 behavior

V7 does not remove or weaken:

- `delta = -heading` Kimodo canonicalization
- front/back torso yaw limit
- front/back head yaw limit
- natural left/right canonical geometry
- gait crossover and cardinal projection hard gates
- official `05_root_path` fixture normalization
- separate Kimodo, One-to-All, and FastAPI environments
