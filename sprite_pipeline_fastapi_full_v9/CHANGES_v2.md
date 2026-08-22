# v2 review notes

Reviewed against the Kimodo NPZ/output semantics and One-to-All reference preprocessing.

Known corrections:

1. Canonical heading now comes from Kimodo `global_root_heading` (hip-heading fallback), not root trajectory.
2. Left/right camera projection signs were reversed in v1 and are corrected.
3. BODY_18 view visibility is preserved instead of assigning confidence=1 to every projected joint.
4. Back-view face BODY points are disabled before pose drawing.
5. The v1 custom symmetric bone retargeter was removed because it distorted profile views.
6. OTA uses its own WanPose detector on each reference and combines that confidence with adapter visibility.
7. Pose geometry is validated and previewed before OTA.

This source bundle is syntax/unit checked locally. Full model inference still must be
validated on the RunPod model environment because the model weights/CUDA runtime are not
available inside this artifact-build environment.
