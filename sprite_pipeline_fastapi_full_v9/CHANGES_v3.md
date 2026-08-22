# V3 debug-driven fixes

This revision is based on inspection of a real failed job's `pose_preview.png` and OTA control rasters.

- Canonicalize Kimodo yaw **per frame** from `global_root_heading`, not one cycle-average angle.
- Do not count frame 0 as a heel-strike merely because contact is already active.
- Preserve both side-view limb chains; far limbs are no longer attenuated to 0.40.
- Do not multiply driving-body confidence by reference-image confidence.
- Keep BODY joints 1..13 at a usable minimum control opacity.
- Continue using direction/reference confidence only for head-view cues.
- Record cycle source and heading mean/std diagnostics in adapter metadata.
