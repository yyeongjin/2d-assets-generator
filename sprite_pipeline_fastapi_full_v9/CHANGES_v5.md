# V5 changes

V5 stops relying on a freshly synthesized Kimodo gait for the default V1 walk-cycle path.

## Default motion source: official Kimodo demo fixture

The Kimodo repository already ships a pre-generated SOMA walk example:

`kimodo/assets/demo/examples/kimodo-soma-rp/05_root_path/motion.npz`

Its accompanying metadata uses the prompt `A person is casually walking forward slowly`.

`workers/kimodo_worker.py` now defaults to:

`KIMODO_MOTION_SOURCE=official_example`

In this mode the worker does **not** load the Kimodo diffusion model into VRAM. It copies the
repository-shipped motion into each job and records the source in `motion.qc.json`.

Set `KIMODO_MOTION_SOURCE=generated` to restore V4's constrained/retry generation path.

## Adapter changes

- scans every complete same-foot heel-strike cycle in long motion clips
- ranks cycles by local gait neutrality instead of picking a temporal midpoint cycle
- prefers cycles with low foot crossover, sane step width, normal foot lift and knee flexion
- root-path curvature and global heading change are diagnostics only; they are not treated as
  gait defects because the sprite adapter removes root travel
- writes all candidate cycle scores into `pose/adapter_meta.json`

## Pipeline metadata

`metadata.json` now reports whether the motion came from the official fixture or generated Kimodo.
