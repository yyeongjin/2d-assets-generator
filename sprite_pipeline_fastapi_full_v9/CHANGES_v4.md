# V4 changes

V4 fixes the failure revealed by `latest_motion.npz`: the bad crossover/high-knee gait was already present in Kimodo's raw 3D motion before One-to-All rendering.

## Kimodo worker
- Adds a straight `root2d` + constant-heading constraint using Kimodo's official constraint API.
- Adds a neutral-walk prompt prefix to avoid catwalk/cross-step/prancing interpretations.
- Adds deterministic motion-quality retries (default 3 attempts, derived from the client seed).
- Rejects 3D motions with foot crossover, reversed foot lanes, excessive ankle lift/knee flexion, lateral root drift, excessive heading change, or missing gait cycle.
- Writes `motion/motion.qc.json` with all attempts and selected generation seed.

## Motion adapter
- Uses one cycle-mean heading correction instead of removing the hip-derived heading independently every frame. This preserves natural pelvis yaw.
- Validates the raw 3D gait before projection and blocks OTA when the motion is bad.
- Adds gait metrics to adapter metadata and validation output.

## Pipeline
- Includes Kimodo motion-QC details in final metadata and result debug ZIP.
- Requests up to 3 deterministic Kimodo attempts before failing the job.
