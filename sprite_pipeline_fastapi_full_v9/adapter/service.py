import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

DIRECTIONS = ("front", "back", "left", "right")
TARGET_FRAMES = 17
UNIQUE_CYCLE_FRAMES = 16
ADAPTER_VERSION = "8.0.0"


def _env_float(
    name: str,
    default: float,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    raw = os.environ.get(name)
    try:
        value = default if raw is None else float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be numeric, got {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise RuntimeError(f"{name} must be >= {minimum}, got {value}")
    if maximum is not None and value > maximum:
        raise RuntimeError(f"{name} must be <= {maximum}, got {value}")
    return float(value)


# Front/back-only cardinal controls. Side views keep Kimodo's phase-local yaw.
CANONICAL_HEADING_TOLERANCE_DEG = _env_float(
    "SPRITE_CANONICAL_HEADING_TOLERANCE_DEG", 1.0, 0.1, 10.0
)
FRONT_BACK_TORSO_YAW_LIMIT_DEG = _env_float(
    "SPRITE_FRONT_BACK_TORSO_YAW_LIMIT_DEG", 2.5, 0.0, 15.0
)
FRONT_BACK_HEAD_YAW_LIMIT_DEG = _env_float(
    "SPRITE_FRONT_BACK_HEAD_YAW_LIMIT_DEG", 5.0, 0.0, 20.0
)
BODY18_SHOULDER_BLEND = _env_float(
    "SPRITE_BODY18_SHOULDER_BLEND", 0.35, 0.0, 1.0
)

# OpenPose/DWPose BODY_18 edges (0-based).
BODY_EDGES = (
    (1, 0),
    (0, 14), (14, 16),
    (0, 15), (15, 17),
    (1, 2), (2, 3), (3, 4),
    (1, 5), (5, 6), (6, 7),
    (1, 8), (8, 9), (9, 10),
    (1, 11), (11, 12), (12, 13),
)

SOMA30 = {
    "Hips": 0, "Spine1": 1, "Spine2": 2, "Chest": 3,
    "Neck1": 4, "Neck2": 5, "Head": 6, "Jaw": 7,
    "LeftEye": 8, "RightEye": 9,
    "LeftShoulder": 10, "LeftArm": 11, "LeftForeArm": 12, "LeftHand": 13,
    "RightShoulder": 16, "RightArm": 17, "RightForeArm": 18, "RightHand": 19,
    "LeftLeg": 22, "LeftShin": 23, "LeftFoot": 24, "LeftToeBase": 25,
    "RightLeg": 26, "RightShin": 27, "RightFoot": 28, "RightToeBase": 29,
}

SOMA77 = {
    "Hips": 0, "Spine1": 1, "Spine2": 2, "Chest": 3,
    "Neck1": 4, "Neck2": 5, "Head": 6, "HeadEnd": 7, "Jaw": 8,
    "LeftEye": 9, "RightEye": 10,
    "LeftShoulder": 11, "LeftArm": 12, "LeftForeArm": 13, "LeftHand": 14,
    "RightShoulder": 39, "RightArm": 40, "RightForeArm": 41, "RightHand": 42,
    "LeftLeg": 67, "LeftShin": 68, "LeftFoot": 69, "LeftToeBase": 70, "LeftToeEnd": 71,
    "RightLeg": 72, "RightShin": 73, "RightFoot": 74, "RightToeBase": 75, "RightToeEnd": 76,
}

# Projection convention for the four user-facing reference views.
# Kimodo SOMA coordinates are Y-up and +Z-forward after canonicalization.
# screen axis = image-right direction in world coordinates.
# depth axis = camera-near direction in world coordinates.
VIEW_AXES = {
    "front": (np.array([1.0, 0.0, 0.0], np.float32), np.array([0.0, 0.0, 1.0], np.float32)),
    "back":  (np.array([-1.0, 0.0, 0.0], np.float32), np.array([0.0, 0.0, -1.0], np.float32)),
    # User convention: left(-90) profile faces screen-right, right(+90) faces screen-left.
    "left":  (np.array([0.0, 0.0, 1.0], np.float32), np.array([1.0, 0.0, 0.0], np.float32)),
    "right": (np.array([0.0, 0.0, -1.0], np.float32), np.array([-1.0, 0.0, 0.0], np.float32)),
}


def _index_map(num_joints: int) -> dict[str, int]:
    if num_joints >= 77:
        return SOMA77
    if num_joints >= 30:
        return SOMA30
    raise RuntimeError(f"Unsupported SOMA joint count: {num_joints}")


def _rising_edges(values: np.ndarray, threshold: float = 0.5) -> np.ndarray:
    state = values > threshold
    if len(state) == 0:
        return np.empty((0,), dtype=np.int64)
    # Do not invent a heel-strike at frame 0 merely because the clip begins
    # while the foot is already in contact. Only real 0->1 transitions count.
    prev = np.concatenate([state[:1], state[:-1]])
    return np.flatnonzero(state & ~prev)


def _fallback_cycle(joints: np.ndarray, idx: dict[str, int]) -> tuple[int, int]:
    # Use the full left-foot trajectory relative to the pelvis. Looking only at
    # vertical height can accidentally prefer a half-cycle; xyz relative motion
    # carries the forward/back swing and is much more phase-specific.
    signal = joints[:, idx["LeftFoot"], :] - joints[:, idx["Hips"], :]
    total = len(signal)
    min_lag = min(18, max(8, total // 5))
    max_lag = min(55, max(min_lag + 1, int(total * 0.70)))
    best_lag = None
    best_error = float("inf")

    # Normalize dimensions so vertical scale does not dominate the trajectory.
    centered = signal - np.mean(signal, axis=0, keepdims=True)
    std = np.std(centered, axis=0, keepdims=True)
    normalized = centered / np.maximum(std, 1e-4)

    for lag in range(min_lag, max_lag + 1):
        if total <= lag + 4:
            continue
        error = float(np.mean((normalized[:-lag] - normalized[lag:]) ** 2))
        # Mild prior against implausibly short gait cycles.
        error += 0.002 * abs(lag - 30)
        if error < best_error:
            best_error = error
            best_lag = lag

    if best_lag is None:
        best_lag = max(18, min(30, total - 1))

    start = max(0, (total - best_lag) // 2)
    end = min(total - 1, start + best_lag)
    return start, end


def _find_cycle(
    joints: np.ndarray,
    foot_contacts: np.ndarray | None,
    idx: dict[str, int],
) -> tuple[int, int, str]:
    total = joints.shape[0]
    if (
        foot_contacts is not None
        and foot_contacts.ndim == 2
        and foot_contacts.shape[0] == total
        and foot_contacts.shape[1] >= 4
    ):
        # Exported SOMA77 uses [L heel, L toe, L toe-end, R heel, R toe, R toe-end].
        # Older SOMA30 files use [L heel, L toe, R heel, R toe].
        heel_channels = [0, 3] if foot_contacts.shape[1] >= 6 else [0, 2]
        candidates = []
        for channel in heel_channels:
            edges = _rising_edges(foot_contacts[:, channel])
            for a, b in zip(edges[:-1], edges[1:]):
                period = int(b - a)
                if 18 <= period <= 60:
                    midpoint = float(a + b) / 2.0
                    score = abs(midpoint - total * 0.55) + abs(period - 40) * 0.15
                    candidates.append((score, int(a), int(b), int(channel)))

        if candidates:
            candidates.sort(key=lambda x: x[0])
            _, start, end, channel = candidates[0]
            return start, end, f"heel_rising_edges_ch{channel}"

    start, end = _fallback_cycle(joints, idx)
    return start, end, "fallback_foot_autocorr"

def _interpolate(array: np.ndarray, positions: np.ndarray) -> np.ndarray:
    count = array.shape[0]
    low = np.floor(positions).astype(np.int64)
    high = np.clip(low + 1, 0, count - 1)
    alpha = (positions - low).astype(np.float32)
    alpha = alpha.reshape((len(alpha),) + (1,) * (array.ndim - 1))
    return array[low] * (1.0 - alpha) + array[high] * alpha


def _closed_cycle_positions(
    start: int,
    end: int,
    unique_frames: int = UNIQUE_CYCLE_FRAMES,
) -> tuple[np.ndarray, np.ndarray]:
    """Return 16 unique phase positions plus an exact duplicate endpoint.

    V6 sampled ``linspace(start, end, 17)``. The source gait endpoints were the
    same semantic heel-strike, but not bit-identical poses. One-to-All therefore
    received a slightly open sequence and amplified the 8->1 discontinuity.

    V8 samples one full period on ``[start, end)`` and appends phase zero as the
    seventeenth control. The duplicate is deliberate: Wan/One-to-All requires a
    ``4n+1`` frame count, while the final sprite uses eight evenly spaced phases.
    """
    if unique_frames < 4:
        raise RuntimeError("unique_frames must be >= 4")
    period = int(end) - int(start)
    if period <= 0:
        raise RuntimeError(f"Invalid cycle range: {start}..{end}")

    unique = (
        float(start)
        + float(period)
        * np.arange(unique_frames, dtype=np.float32)
        / float(unique_frames)
    ).astype(np.float32)
    closed = np.concatenate([unique, unique[:1]], axis=0)
    return unique, closed


def _sample_closed_cycle(array: np.ndarray, unique_positions: np.ndarray) -> np.ndarray:
    unique = _interpolate(array, unique_positions)
    return np.concatenate([unique, unique[:1]], axis=0).astype(np.float32)


def _rotate_y_heading_delta(
    xyz: np.ndarray,
    delta_angles: np.ndarray | float,
) -> np.ndarray:
    """Rotate positions by a Kimodo heading delta around world Y.

    With this matrix, Kimodo's hip-derived heading changes by ``+delta``.
    Therefore the correction from current heading ``h`` to target ``t`` is
    ``delta = t - h``. V5 passed ``h`` while targeting zero and doubled yaw.
    """
    result = xyz.copy()
    angles = np.asarray(delta_angles, dtype=np.float32)
    x = xyz[..., 0]
    z = xyz[..., 2]

    if angles.ndim == 0:
        c = float(np.cos(float(angles)))
        si = float(np.sin(float(angles)))
    else:
        if angles.shape[0] != xyz.shape[0]:
            raise RuntimeError(
                f"heading frame count mismatch: {angles.shape[0]} vs {xyz.shape[0]}"
            )
        c = np.cos(angles)[:, None]
        si = np.sin(angles)[:, None]

    result[..., 0] = c * x + si * z
    result[..., 2] = -si * x + c * z
    return result


def _rotate_joint_subset_about_pivot(
    joints: np.ndarray,
    joint_indices: list[int],
    pivots: np.ndarray,
    delta_angles: np.ndarray,
) -> np.ndarray:
    result = joints.copy()
    selected = result[:, joint_indices, :] - pivots[:, None, :]
    selected = _rotate_y_heading_delta(selected, delta_angles)
    result[:, joint_indices, :] = selected + pivots[:, None, :]
    return result


def _pair_heading_angles(
    joints: np.ndarray,
    right_index: int,
    left_index: int,
) -> np.ndarray:
    diff = joints[:, right_index] - joints[:, left_index]
    return np.arctan2(diff[:, 2], -diff[:, 0]).astype(np.float32)


def _heading_angles_from_joints(joints: np.ndarray, idx: dict[str, int]) -> np.ndarray:
    # Matches Kimodo's official heading definition.
    return _pair_heading_angles(joints, idx["RightLeg"], idx["LeftLeg"])


def _circular_mean_radians(angles: np.ndarray) -> float:
    angles = np.asarray(angles, dtype=np.float32)
    return float(np.arctan2(np.mean(np.sin(angles)), np.mean(np.cos(angles))))


def _wrap_radians(angles: np.ndarray) -> np.ndarray:
    return np.angle(np.exp(1j * np.asarray(angles, dtype=np.float32))).astype(np.float32)


def _angle_alignment_stats(angles: np.ndarray) -> dict:
    wrapped = _wrap_radians(angles)
    degrees = np.degrees(wrapped)
    return {
        "mean_deg": float(np.degrees(_circular_mean_radians(wrapped))),
        "std_deg": float(np.std(degrees)),
        "p95_abs_deg": float(np.percentile(np.abs(degrees), 95)),
        "max_abs_deg": float(np.max(np.abs(degrees))),
        "angles_deg": degrees.tolist(),
    }


def _shoulder_landmarks(
    joints: np.ndarray,
    idx: dict[str, int],
) -> tuple[np.ndarray, np.ndarray]:
    # Blend clavicle and upper-arm origins for a stable OpenPose shoulder point.
    w = BODY18_SHOULDER_BLEND
    right = w * joints[:, idx["RightShoulder"]] + (1.0 - w) * joints[:, idx["RightArm"]]
    left = w * joints[:, idx["LeftShoulder"]] + (1.0 - w) * joints[:, idx["LeftArm"]]
    return right, left


def _torso_heading_angles(joints: np.ndarray, idx: dict[str, int]) -> np.ndarray:
    hip = _heading_angles_from_joints(joints, idx)
    right_shoulder, left_shoulder = _shoulder_landmarks(joints, idx)
    diff = right_shoulder - left_shoulder
    shoulder = np.arctan2(diff[:, 2], -diff[:, 0]).astype(np.float32)

    # Hip anchors the body; shoulders dominate perceived front/back orientation.
    x = 0.55 * np.cos(hip) + 0.45 * np.cos(shoulder)
    y = 0.55 * np.sin(hip) + 0.45 * np.sin(shoulder)
    return np.arctan2(y, x).astype(np.float32)


def _head_heading_angles(joints: np.ndarray, idx: dict[str, int]) -> np.ndarray:
    return _pair_heading_angles(joints, idx["RightEye"], idx["LeftEye"])


def _sample_heading_angle(
    joints: np.ndarray,
    idx: dict[str, int],
    global_root_heading: np.ndarray | None,
    unique_positions: np.ndarray,
) -> tuple[float, np.ndarray, str]:
    """Use final posed-joint geometry as the projection source of truth."""
    del global_root_heading  # retained in signature for bundle compatibility
    full_angles = _heading_angles_from_joints(joints, idx)
    full_vec = np.stack([np.cos(full_angles), np.sin(full_angles)], axis=-1)
    vec16 = _interpolate(full_vec.astype(np.float32), unique_positions)
    vec16 /= np.maximum(np.linalg.norm(vec16, axis=-1, keepdims=True), 1e-8)
    angles16 = np.arctan2(vec16[:, 1], vec16[:, 0]).astype(np.float32)
    angles17 = np.concatenate([angles16, angles16[:1]], axis=0)
    # Compute the canonical heading from the unique cycle only. Counting phase
    # zero twice would bias the mean toward the first heel-strike.
    return _circular_mean_radians(angles16), angles17, "hip_heading_unique_cycle_mean"


def _canonicalize(
    joints: np.ndarray,
    roots: np.ndarray,
    heading_angle: float,
    idx: dict[str, int],
) -> np.ndarray:
    result = joints.copy()

    # In-place walk: remove XZ travel but retain vertical bob.
    result[..., 0] -= roots[:, None, 0]
    result[..., 2] -= roots[:, None, 2]

    # Target is +Z/0 rad: delta = target - current = -heading.
    result = _rotate_y_heading_delta(result, -heading_angle)

    ys = [
        result[:, idx[name], 1]
        for name in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase")
        if name in idx
    ]
    ground = float(np.min(np.concatenate(ys))) if ys else float(np.min(result[..., 1]))
    result[..., 1] -= ground
    return result.astype(np.float32)


def _front_back_cardinal_lock(
    canonical_joints: np.ndarray,
    idx: dict[str, int],
) -> tuple[np.ndarray, dict]:
    """Limit torso/head yaw only for front/back projection."""
    result = canonical_joints.copy()

    hip_before = _heading_angles_from_joints(result, idx)
    torso_before = _torso_heading_angles(result, idx)
    head_before = _head_heading_angles(result, idx)

    torso_limit = np.deg2rad(FRONT_BACK_TORSO_YAW_LIMIT_DEG)
    torso_target = np.clip(_wrap_radians(torso_before), -torso_limit, torso_limit)
    torso_delta = _wrap_radians(torso_target - torso_before)

    pelvis = result[:, idx["Hips"], :].copy()
    result = (
        _rotate_y_heading_delta(result - pelvis[:, None, :], torso_delta)
        + pelvis[:, None, :]
    )

    head_after_torso = _head_heading_angles(result, idx)
    head_limit = np.deg2rad(FRONT_BACK_HEAD_YAW_LIMIT_DEG)
    head_target = np.clip(_wrap_radians(head_after_torso), -head_limit, head_limit)
    head_delta = _wrap_radians(head_target - head_after_torso)

    head_names = ["Head", "Jaw", "LeftEye", "RightEye"]
    if "HeadEnd" in idx:
        head_names.append("HeadEnd")
    result = _rotate_joint_subset_about_pivot(
        result,
        [idx[name] for name in head_names],
        result[:, idx["Neck2"], :].copy(),
        head_delta,
    )

    report = {
        "enabled": True,
        "torso_yaw_limit_deg": FRONT_BACK_TORSO_YAW_LIMIT_DEG,
        "head_yaw_limit_deg": FRONT_BACK_HEAD_YAW_LIMIT_DEG,
        "hip_before": _angle_alignment_stats(hip_before),
        "torso_before": _angle_alignment_stats(torso_before),
        "head_before": _angle_alignment_stats(head_before),
        "hip_after": _angle_alignment_stats(_heading_angles_from_joints(result, idx)),
        "torso_after": _angle_alignment_stats(_torso_heading_angles(result, idx)),
        "head_after": _angle_alignment_stats(_head_heading_angles(result, idx)),
        "torso_correction_deg": np.degrees(torso_delta).tolist(),
        "head_correction_deg": np.degrees(head_delta).tolist(),
    }
    return result.astype(np.float32), report


def _evaluate_cardinal_quality(
    canonical_joints: np.ndarray,
    idx: dict[str, int],
) -> tuple[dict, np.ndarray]:
    postcanonical_hip = _angle_alignment_stats(
        _heading_angles_from_joints(canonical_joints, idx)
    )
    locked, lock_report = _front_back_cardinal_lock(canonical_joints, idx)

    errors = []
    if abs(postcanonical_hip["mean_deg"]) > CANONICAL_HEADING_TOLERANCE_DEG:
        errors.append(
            "post-canonical hip mean is not zero "
            f"({postcanonical_hip['mean_deg']:.3f} deg)"
        )
    if (
        lock_report["torso_after"]["p95_abs_deg"]
        > FRONT_BACK_TORSO_YAW_LIMIT_DEG + 0.1
    ):
        errors.append(
            "front/back torso yaw exceeds cardinal limit "
            f"({lock_report['torso_after']['p95_abs_deg']:.3f} deg p95)"
        )
    if (
        lock_report["head_after"]["p95_abs_deg"]
        > FRONT_BACK_HEAD_YAW_LIMIT_DEG + 0.1
    ):
        errors.append(
            "front/back head yaw exceeds cardinal limit "
            f"({lock_report['head_after']['p95_abs_deg']:.3f} deg p95)"
        )

    return {
        "ok": not errors,
        "errors": errors,
        "canonical_heading_tolerance_deg": CANONICAL_HEADING_TOLERANCE_DEG,
        "postcanonical_hip": postcanonical_hip,
        "front_back_lock": lock_report,
    }, locked


def _circular_stats_degrees(angles: np.ndarray) -> tuple[float, float]:
    angles = np.asarray(angles, dtype=np.float32)
    c = float(np.mean(np.cos(angles)))
    si = float(np.mean(np.sin(angles)))
    mean = float(np.arctan2(si, c))
    wrapped = np.angle(np.exp(1j * (angles - mean)))
    std = float(np.std(wrapped))
    return float(np.degrees(mean)), float(np.degrees(std))


def _safe_normalize(v: np.ndarray, fallback: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(v, axis=-1, keepdims=True)
    out = np.divide(v, np.maximum(norms, 1e-8), where=np.ones_like(v, dtype=bool))
    bad = (norms[..., 0] <= 1e-8)
    if np.any(bad):
        out[bad] = fallback
    return out.astype(np.float32)


def _body18(joints: np.ndarray, idx: dict[str, int]) -> np.ndarray:
    """Map SOMA world joints to DWPose/OpenPose BODY_18 in 3D.

    Eyes come from real SOMA joints. Nose/ears are geometric head landmarks, not
    fake 2D offsets, so their projection changes correctly between views.
    """
    frames = joints.shape[0]
    body = np.zeros((frames, 18, 3), dtype=np.float32)

    def j(name: str) -> np.ndarray:
        return joints[:, idx[name], :]

    head = j("Head")
    jaw = j("Jaw")
    right_eye = j("RightEye")
    left_eye = j("LeftEye")
    eye_mid = (right_eye + left_eye) * 0.5

    # The eye midpoint is physically in front of the head center in SOMA, so
    # it gives a model-agnostic head-forward vector after FK.
    face_forward = eye_mid - head
    face_forward[..., 1] = 0.0
    face_forward = _safe_normalize(
        face_forward,
        np.array([0.0, 0.0, 1.0], dtype=np.float32),
    )

    eye_vec = right_eye - left_eye
    eye_distance = np.linalg.norm(eye_vec, axis=-1)
    eye_axis = _safe_normalize(
        eye_vec,
        np.array([-1.0, 0.0, 0.0], dtype=np.float32),
    )

    head_height = np.linalg.norm(head - j("Neck2"), axis=-1)
    face_depth = np.maximum(0.018, 0.22 * head_height)
    ear_out = np.maximum(0.012, 0.42 * eye_distance)
    ear_back = np.maximum(0.006, 0.12 * eye_distance)

    nose = eye_mid + face_forward * face_depth[:, None]
    nose[:, 1] = eye_mid[:, 1] * 0.80 + jaw[:, 1] * 0.20

    right_ear = right_eye + eye_axis * ear_out[:, None] - face_forward * ear_back[:, None]
    left_ear = left_eye - eye_axis * ear_out[:, None] - face_forward * ear_back[:, None]

    right_shoulder, left_shoulder = _shoulder_landmarks(joints, idx)

    body[:, 0] = nose
    body[:, 1] = (j("Neck1") + j("Neck2")) / 2.0
    body[:, 2] = right_shoulder
    body[:, 3] = j("RightForeArm")
    body[:, 4] = j("RightHand")
    body[:, 5] = left_shoulder
    body[:, 6] = j("LeftForeArm")
    body[:, 7] = j("LeftHand")
    body[:, 8] = j("RightLeg")
    body[:, 9] = j("RightShin")
    body[:, 10] = j("RightFoot")
    body[:, 11] = j("LeftLeg")
    body[:, 12] = j("LeftShin")
    body[:, 13] = j("LeftFoot")
    body[:, 14] = right_eye
    body[:, 15] = left_eye
    body[:, 16] = right_ear
    body[:, 17] = left_ear
    return body


def _geometry_visibility(
    direction: str,
    depth: np.ndarray,
    projected: np.ndarray,
) -> np.ndarray:
    """View-dependent visibility prior before reference-pose confidence is applied."""
    frames = depth.shape[0]
    score = np.ones((frames, 18), dtype=np.float32)

    face = [0, 14, 15, 16, 17]
    if direction == "front":
        score[:, 14:16] *= 0.90
        score[:, 16:18] *= 0.75
    elif direction == "back":
        score[:, face] = 0.0
    elif direction == "left":
        # Camera is on anatomical-left (+X) side.
        score[:, 0] *= 0.90
        score[:, 14] *= 0.12  # right eye, far side
        score[:, 16] *= 0.08  # right ear, far side
        score[:, 15] *= 0.95  # left eye, near side
        score[:, 17] *= 1.00  # left ear, near side
        # Keep both arm/leg chains strong. One-to-All expects a complete driving
        # skeleton; making the far leg faint caused one-legged/hopping outputs.
        score[:, [2, 3, 4, 8, 9, 10]] *= 0.90
    elif direction == "right":
        score[:, 0] *= 0.90
        score[:, 15] *= 0.12
        score[:, 17] *= 0.08
        score[:, 14] *= 0.95
        score[:, 16] *= 1.00
        score[:, [5, 6, 7, 11, 12, 13]] *= 0.90
    else:
        raise ValueError(direction)

    # A real 2D pose detector also loses confidence when symmetric limbs overlap.
    # Preserve that distributional cue from the 3D motion: if a pair projects
    # almost on top of itself, attenuate the farther joint using camera depth.
    symmetric_pairs = (
        (2, 5), (3, 6), (4, 7),
        (8, 11), (9, 12), (10, 13),
        (14, 15), (16, 17),
    )
    for a, b in symmetric_pairs:
        delta = depth[:, a] - depth[:, b]
        screen_gap = np.linalg.norm(projected[:, a] - projected[:, b], axis=-1)
        threshold = 0.075 if direction in {"left", "right"} else 0.035
        overlap = screen_gap < threshold
        a_far = overlap & (delta < -0.012)
        b_far = overlap & (delta > 0.012)
        # Do not erase occluded body chains. A DWPose detector often still
        # predicts them, and the animation model needs both legs to avoid hops.
        score[a_far, a] *= 0.80
        score[b_far, b] *= 0.80

    return np.clip(score, 0.0, 1.0)


def _project(
    body: np.ndarray,
    direction: str,
    scale: float,
    baseline: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    screen_axis, depth_axis = VIEW_AXES[direction]
    horizontal = np.tensordot(body, screen_axis, axes=([-1], [0]))
    depth = np.tensordot(body, depth_axis, axes=([-1], [0]))
    vertical = body[..., 1]

    pelvis_x = (horizontal[:, 8] + horizontal[:, 11]) / 2.0
    center_x = float(np.median(pelvis_x))
    x = 0.5 + (horizontal - center_x) * scale
    y = baseline - vertical * scale

    result = np.stack([x, y], axis=-1)
    result[..., 0] = np.clip(result[..., 0], 0.01, 0.99)
    result[..., 1] = np.clip(result[..., 1], 0.01, 0.99)
    visibility = _geometry_visibility(direction, depth, result)
    return result.astype(np.float32), depth.astype(np.float32), visibility


def _joint_angle_deg(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    v1 = a - b
    v2 = c - b
    denom = np.linalg.norm(v1, axis=-1) * np.linalg.norm(v2, axis=-1)
    cosang = np.sum(v1 * v2, axis=-1) / np.maximum(denom, 1e-8)
    return np.degrees(np.arccos(np.clip(cosang, -1.0, 1.0)))


def _evaluate_gait_quality(
    joints17: np.ndarray,
    roots: np.ndarray,
    idx: dict[str, int],
    heading_angles: np.ndarray,
) -> dict:
    """Validate 3D gait before any camera projection.

    Foot lane coordinates are measured in the instantaneous hip frame, so a
    crossover here is present in Kimodo's 3D motion itself rather than being
    introduced by front/back projection.
    """
    left_hip = joints17[:, idx["LeftLeg"], :][:, [0, 2]]
    right_hip = joints17[:, idx["RightLeg"], :][:, [0, 2]]
    lateral = right_hip - left_hip
    lateral /= np.maximum(np.linalg.norm(lateral, axis=-1, keepdims=True), 1e-8)
    pelvis = joints17[:, idx["Hips"], :][:, [0, 2]]

    left_foot = joints17[:, idx["LeftFoot"], :][:, [0, 2]]
    right_foot = joints17[:, idx["RightFoot"], :][:, [0, 2]]
    left_lane = np.sum((left_foot - pelvis) * lateral, axis=-1)
    right_lane = np.sum((right_foot - pelvis) * lateral, axis=-1)

    cross_margin = 0.025
    left_cross = left_lane > cross_margin
    right_cross = right_lane < -cross_margin
    cross_any_fraction = float(np.mean(left_cross | right_cross))
    max_cross = float(max(0.0, np.max(left_lane), -np.min(right_lane)))
    min_step_width = float(np.min(right_lane - left_lane))

    ground = np.minimum.reduce([
        joints17[:, idx["LeftFoot"], 1],
        joints17[:, idx["LeftToeBase"], 1],
        joints17[:, idx["RightFoot"], 1],
        joints17[:, idx["RightToeBase"], 1],
    ])
    max_ankle_lift = float(max(
        np.max(joints17[:, idx["LeftFoot"], 1] - ground),
        np.max(joints17[:, idx["RightFoot"], 1] - ground),
    ))

    left_knee = _joint_angle_deg(
        joints17[:, idx["LeftLeg"]],
        joints17[:, idx["LeftShin"]],
        joints17[:, idx["LeftFoot"]],
    )
    right_knee = _joint_angle_deg(
        joints17[:, idx["RightLeg"]],
        joints17[:, idx["RightShin"]],
        joints17[:, idx["RightFoot"]],
    )
    max_knee_flex = float(max(
        np.max(180.0 - left_knee),
        np.max(180.0 - right_knee),
    ))

    heading_angles = np.asarray(heading_angles, dtype=np.float32)
    mean = float(np.arctan2(np.mean(np.sin(heading_angles)), np.mean(np.cos(heading_angles))))
    wrapped = np.angle(np.exp(1j * (heading_angles - mean)))
    heading_range_deg = float(np.degrees(np.max(wrapped) - np.min(wrapped)))
    heading_std_deg = float(np.degrees(np.std(wrapped)))

    root_x = roots[:, 0] - roots[0, 0]
    max_lateral_root_drift = float(np.max(np.abs(root_x)))

    errors = []
    if cross_any_fraction > 0.12:
        errors.append(f"3D gait crosses body midline in {cross_any_fraction:.0%} of phases")
    if max_cross > 0.060:
        errors.append(f"3D gait max cross-over is {max_cross:.3f} m")
    if min_step_width < -0.040:
        errors.append(f"3D left/right foot lane order reverses ({min_step_width:.3f} m)")
    if max_ankle_lift > 0.260:
        errors.append(f"3D ankle lift is too high ({max_ankle_lift:.3f} m)")
    if max_knee_flex > 100.0:
        errors.append(f"3D knee flexion is too high ({max_knee_flex:.1f} deg)")
    # Root path curvature and global heading changes are not gait defects for
    # an in-place sprite. They are removed by canonicalization. Keep them as
    # diagnostics, but do not reject an otherwise clean local walk cycle.

    return {
        "ok": not errors,
        "errors": errors,
        "cross_any_fraction": cross_any_fraction,
        "max_cross_m": max_cross,
        "min_step_width_m": min_step_width,
        "max_ankle_lift_m": max_ankle_lift,
        "max_knee_flex_deg": max_knee_flex,
        "max_lateral_root_drift_m": max_lateral_root_drift,
        "heading_std_deg": heading_std_deg,
        "heading_range_deg": heading_range_deg,
        "left_foot_lane_m": left_lane.tolist(),
        "right_foot_lane_m": right_lane.tolist(),
    }


def _cycle_candidates(
    joints: np.ndarray,
    foot_contacts: np.ndarray | None,
    idx: dict[str, int],
) -> list[tuple[int, int, str]]:
    """Return every plausible same-foot gait cycle in the clip.

    Official Kimodo demo motions can be long and can follow curved root paths.
    V6 scans all complete heel-strike cycles instead of choosing the one nearest
    the temporal midpoint, then selects the cleanest local gait cycle.
    """
    total = joints.shape[0]
    out: list[tuple[int, int, str]] = []
    if (
        foot_contacts is not None
        and foot_contacts.ndim == 2
        and foot_contacts.shape[0] == total
        and foot_contacts.shape[1] >= 4
    ):
        heel_channels = [0, 3] if foot_contacts.shape[1] >= 6 else [0, 2]
        for channel in heel_channels:
            edges = _rising_edges(foot_contacts[:, channel])
            for a, b in zip(edges[:-1], edges[1:]):
                period = int(b - a)
                if 18 <= period <= 60:
                    out.append((int(a), int(b), f"heel_rising_edges_ch{channel}"))

    if not out:
        a, b = _fallback_cycle(joints, idx)
        out.append((a, b, "fallback_foot_autocorr"))

    # Remove duplicates while preserving order.
    dedup = []
    seen = set()
    for item in out:
        key = item[:2]
        if key not in seen:
            seen.add(key)
            dedup.append(item)
    return dedup


def _cycle_neutrality_score(
    q: dict,
    period: int,
    cardinal_quality: dict | None = None,
) -> float:
    """Lower is better; gait dominates, then cardinal correction cost."""
    score = float(
        120.0 * q["cross_any_fraction"]
        + 260.0 * q["max_cross_m"]
        + 180.0 * max(0.0, -q["min_step_width_m"])
        + 35.0 * max(0.0, q["max_ankle_lift_m"] - 0.20)
        + 0.18 * max(0.0, q["max_knee_flex_deg"] - 90.0)
        + 0.03 * q["heading_range_deg"]
        + 0.05 * abs(period - 34)
    )
    if cardinal_quality is not None:
        lock = cardinal_quality["front_back_lock"]
        torso_correction = np.asarray(lock["torso_correction_deg"], dtype=np.float32)
        head_correction = np.asarray(lock["head_correction_deg"], dtype=np.float32)
        score += 0.08 * float(np.mean(np.abs(torso_correction)))
        score += 0.03 * float(np.mean(np.abs(head_correction)))
    return score


def _select_best_cycle(
    joints: np.ndarray,
    roots: np.ndarray,
    foot_contacts: np.ndarray | None,
    idx: dict[str, int],
    global_root_heading: np.ndarray | None,
) -> dict:
    evaluations = []
    for start, end, source in _cycle_candidates(joints, foot_contacts, idx):
        unique_positions, positions = _closed_cycle_positions(start, end)
        joints17 = _sample_closed_cycle(joints, unique_positions)
        roots17 = _sample_closed_cycle(roots, unique_positions)
        heading_angle, heading_angles17, heading_source = _sample_heading_angle(
            joints, idx, global_root_heading, unique_positions
        )
        gait = _evaluate_gait_quality(joints17, roots17, idx, heading_angles17)
        canonical_joints = _canonicalize(joints17, roots17, heading_angle, idx)
        cardinal_quality, front_back_joints = _evaluate_cardinal_quality(
            canonical_joints,
            idx,
        )
        score = _cycle_neutrality_score(
            gait,
            end - start,
            cardinal_quality,
        )
        evaluations.append({
            "start": int(start),
            "end": int(end),
            "period": int(end - start),
            "source": source,
            "score": score,
            "gait_quality": gait,
            "unique_positions": unique_positions,
            "positions": positions,
            "joints17": joints17,
            "roots17": roots17,
            "heading_angle": heading_angle,
            "heading_angles17": heading_angles17,
            "heading_source": heading_source,
            "canonical_joints17": canonical_joints,
            "front_back_joints17": front_back_joints,
            "cardinal_quality": cardinal_quality,
        })

    # A candidate must pass both 3D gait and cardinal-view invariants before its
    # score is considered. This prevents a low-crossing but visibly twisted
    # front/back cycle from winning.
    evaluations.sort(
        key=lambda e: (
            not e["gait_quality"]["ok"],
            not e["cardinal_quality"]["ok"],
            e["score"],
            e["start"],
        )
    )
    selected = evaluations[0]
    selected["candidate_summary"] = [
        {
            "start": e["start"],
            "end": e["end"],
            "period": e["period"],
            "source": e["source"],
            "score": round(float(e["score"]), 6),
            "ok": bool(e["gait_quality"]["ok"] and e["cardinal_quality"]["ok"]),
            "gait_ok": bool(e["gait_quality"]["ok"]),
            "cardinal_ok": bool(e["cardinal_quality"]["ok"]),
            "errors": e["gait_quality"]["errors"] + e["cardinal_quality"]["errors"],
            "cross_any_fraction": e["gait_quality"]["cross_any_fraction"],
            "max_cross_m": e["gait_quality"]["max_cross_m"],
            "min_step_width_m": e["gait_quality"]["min_step_width_m"],
            "postcanonical_hip_mean_deg": e["cardinal_quality"]["postcanonical_hip"]["mean_deg"],
            "front_back_torso_before_p95_abs_deg": e["cardinal_quality"]["front_back_lock"]["torso_before"]["p95_abs_deg"],
            "front_back_head_before_p95_abs_deg": e["cardinal_quality"]["front_back_lock"]["head_before"]["p95_abs_deg"],
            "front_back_torso_after_p95_abs_deg": e["cardinal_quality"]["front_back_lock"]["torso_after"]["p95_abs_deg"],
            "front_back_head_after_p95_abs_deg": e["cardinal_quality"]["front_back_lock"]["head_after"]["p95_abs_deg"],
        }
        for e in evaluations
    ]
    return selected


def _validate_views(
    outputs: dict[str, dict],
    gait_quality: dict,
    cardinal_quality: dict,
) -> dict:
    diagnostics = {}
    errors = list(gait_quality.get("errors", [])) + list(
        cardinal_quality.get("errors", [])
    )

    front = outputs["front"]["frames"]
    back = outputs["back"]["frames"]
    left = outputs["left"]["frames"]
    right = outputs["right"]["frames"]

    # In Kimodo's canonical +Z-forward frame, anatomical right is screen-left
    # in front view and screen-right in back view.
    front_shoulders = float(np.median(front[:, 2, 0] - front[:, 5, 0]))
    back_shoulders = float(np.median(back[:, 2, 0] - back[:, 5, 0]))
    left_face = float(np.median(left[:, 0, 0] - left[:, 1, 0]))
    right_face = float(np.median(right[:, 0, 0] - right[:, 1, 0]))
    front_back_mirror_error = float(
        np.max(np.abs(front[..., 0] + back[..., 0] - 1.0))
    )
    front_back_y_error = float(np.max(np.abs(front[..., 1] - back[..., 1])))
    left_right_mirror_error = float(
        np.max(np.abs(left[..., 0] + right[..., 0] - 1.0))
    )
    left_right_y_error = float(np.max(np.abs(left[..., 1] - right[..., 1])))

    closure = {}
    for direction, data in outputs.items():
        frame_error = float(np.max(np.abs(data["frames"][-1] - data["frames"][0])))
        depth_error = float(np.max(np.abs(data["depth"][-1] - data["depth"][0])))
        score_error = float(np.max(np.abs(data["scores"][-1] - data["scores"][0])))
        closure[direction] = {
            "frame_max_abs_error": frame_error,
            "depth_max_abs_error": depth_error,
            "score_max_abs_error": score_error,
        }
        if max(frame_error, depth_error, score_error) > 1e-7:
            errors.append(
                f"{direction} control endpoint is not an exact phase-zero duplicate "
                f"(frame={frame_error:.3e}, depth={depth_error:.3e}, score={score_error:.3e})"
            )

    diagnostics.update({
        "front_right_minus_left_shoulder_x": front_shoulders,
        "back_right_minus_left_shoulder_x": back_shoulders,
        "left_nose_minus_neck_x": left_face,
        "right_nose_minus_neck_x": right_face,
        "front_back_mirror_x_max_error": front_back_mirror_error,
        "front_back_y_max_error": front_back_y_error,
        "left_right_mirror_x_max_error": left_right_mirror_error,
        "left_right_y_max_error": left_right_y_error,
        "control_loop_closure": closure,
        "postcanonical_hip_mean_deg": cardinal_quality["postcanonical_hip"]["mean_deg"],
        "front_back_torso_after_p95_abs_deg": cardinal_quality["front_back_lock"]["torso_after"]["p95_abs_deg"],
        "front_back_head_after_p95_abs_deg": cardinal_quality["front_back_lock"]["head_after"]["p95_abs_deg"],
    })

    if not front_shoulders < -0.002:
        errors.append("front shoulder orientation is not front-facing")
    if not back_shoulders > 0.002:
        errors.append("back shoulder orientation is not back-facing")
    if not left_face > 0.002:
        errors.append("left profile does not face screen-right")
    if not right_face < -0.002:
        errors.append("right profile does not face screen-left")
    if front_back_mirror_error > 1e-5 or front_back_y_error > 1e-5:
        errors.append("front/back projections are not exact opposite cardinal views")
    if left_right_mirror_error > 1e-5 or left_right_y_error > 1e-5:
        errors.append("left/right projections are not exact opposite profile views")

    for direction, data in outputs.items():
        frames = data["frames"]
        if not np.all(np.isfinite(frames)):
            errors.append(f"{direction} contains non-finite coordinates")
        if float(frames.min()) < 0.0 or float(frames.max()) > 1.0:
            errors.append(f"{direction} contains coordinates outside [0,1]")

    return {
        "ok": not errors,
        "errors": errors,
        "diagnostics": diagnostics,
        "gait_quality": gait_quality,
        "cardinal_quality": cardinal_quality,
    }


def _save_preview(outputs: dict[str, dict], path: Path) -> None:
    cell_w, cell_h = 150, 190
    margin = 28
    canvas = Image.new(
        "RGB",
        (cell_w * TARGET_FRAMES, cell_h * len(DIRECTIONS) + margin),
        "white",
    )
    draw = ImageDraw.Draw(canvas)

    for row, direction in enumerate(DIRECTIONS):
        frames = outputs[direction]["frames"]
        scores = outputs[direction]["scores"]
        for col in range(TARGET_FRAMES):
            ox = col * cell_w
            oy = margin + row * cell_h
            pts = frames[col]
            scr = np.empty_like(pts)
            scr[:, 0] = ox + pts[:, 0] * (cell_w - 10) + 5
            scr[:, 1] = oy + pts[:, 1] * (cell_h - 10) + 5

            for a, b in BODY_EDGES:
                if scores[col, a] <= 0.12 or scores[col, b] <= 0.12:
                    continue
                draw.line(
                    [tuple(scr[a]), tuple(scr[b])],
                    fill="black",
                    width=2,
                )
            for i, p in enumerate(scr):
                if scores[col, i] <= 0.12:
                    continue
                r = 2
                draw.ellipse((p[0]-r, p[1]-r, p[0]+r, p[1]+r), fill="black")

        draw.text((4, margin + row * cell_h + 4), direction, fill="red")

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)


def build_pose_controls(
    motion_npz: Path | str,
    refs: dict[str, Path] | dict[str, str],
    output_root: Path | str,
) -> dict[str, str]:
    motion_npz = Path(motion_npz)
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    for direction in DIRECTIONS:
        ref = Path(refs[direction])
        if not ref.exists():
            raise RuntimeError(f"Missing {direction} reference image: {ref}")

    with np.load(motion_npz, allow_pickle=False) as data:
        posed_joints = np.asarray(data["posed_joints"], dtype=np.float32)
        root_positions_derived = "root_positions" not in data.files
        root_positions = (
            np.asarray(data["root_positions"], dtype=np.float32)
            if "root_positions" in data.files
            else np.asarray(posed_joints[..., 0, :], dtype=np.float32)
        )
        foot_contacts = (
            np.asarray(data["foot_contacts"], dtype=np.float32)
            if "foot_contacts" in data.files
            else None
        )
        global_root_heading = (
            np.asarray(data["global_root_heading"], dtype=np.float32)
            if "global_root_heading" in data.files
            else None
        )

    if posed_joints.ndim == 4 and posed_joints.shape[0] == 1:
        posed_joints = posed_joints[0]
    if root_positions.ndim == 3 and root_positions.shape[0] == 1:
        root_positions = root_positions[0]
    if foot_contacts is not None and foot_contacts.ndim == 3 and foot_contacts.shape[0] == 1:
        foot_contacts = foot_contacts[0]
    if global_root_heading is not None and global_root_heading.ndim == 3 and global_root_heading.shape[0] == 1:
        global_root_heading = global_root_heading[0]

    if posed_joints.ndim != 3:
        raise RuntimeError(f"posed_joints must be [T,J,3], got {posed_joints.shape}")
    if root_positions.ndim != 2 or root_positions.shape[-1] != 3:
        raise RuntimeError(f"root_positions must be [T,3], got {root_positions.shape}")
    if posed_joints.shape[0] != root_positions.shape[0]:
        raise RuntimeError("posed_joints/root_positions frame counts differ")

    idx = _index_map(posed_joints.shape[1])
    selected_cycle = _select_best_cycle(
        posed_joints, root_positions, foot_contacts, idx, global_root_heading
    )
    cycle_start = selected_cycle["start"]
    cycle_end = selected_cycle["end"]
    cycle_source = selected_cycle["source"] + "+best_gait_and_cardinal_cycle"
    unique_positions = selected_cycle["unique_positions"]
    positions = selected_cycle["positions"]
    joints17 = selected_cycle["joints17"]
    roots17 = selected_cycle["roots17"]
    heading_angle = selected_cycle["heading_angle"]
    heading_angles17 = selected_cycle["heading_angles17"]
    heading_source = selected_cycle["heading_source"]
    heading_mean_deg, heading_std_deg = _circular_stats_degrees(heading_angles17)
    gait_quality = selected_cycle["gait_quality"]
    cardinal_quality = selected_cycle["cardinal_quality"]
    canonical_joints17 = selected_cycle["canonical_joints17"]
    front_back_joints17 = selected_cycle["front_back_joints17"]
    natural_body = _body18(canonical_joints17, idx)
    front_back_body = _body18(front_back_joints17, idx)

    ground = float(min(
        natural_body[:, 10, 1].min(),
        natural_body[:, 13, 1].min(),
        front_back_body[:, 10, 1].min(),
        front_back_body[:, 13, 1].min(),
    ))
    natural_body[..., 1] -= ground
    front_back_body[..., 1] -= ground
    top = float(max(natural_body[..., 1].max(), front_back_body[..., 1].max()))
    if top <= 1e-5:
        raise RuntimeError("Invalid projected body height")

    # This is only a canonical control-space normalization. OTA worker performs
    # one global scale/translation to the actual direction-specific reference.
    scale = 0.78 / top
    baseline = 0.93

    outputs: dict[str, dict] = {}
    for direction in DIRECTIONS:
        body = front_back_body if direction in {"front", "back"} else natural_body
        frames, depth, scores = _project(body, direction, scale, baseline)
        outputs[direction] = {
            "frames": frames,
            "depth": depth,
            "scores": scores,
            "geometry_source": (
                "front_back_cardinal_lock"
                if direction in {"front", "back"}
                else "natural_canonical_cycle"
            ),
        }

    validation = _validate_views(outputs, gait_quality, cardinal_quality)
    _save_preview(outputs, output_root / "pose_preview.png")

    if not validation["ok"]:
        with (output_root / "adapter_validation.json").open("w", encoding="utf-8") as f:
            json.dump(validation, f, ensure_ascii=False, indent=2)
        raise RuntimeError(
            "Motion Adapter view validation failed: " + "; ".join(validation["errors"])
        )

    result_dirs: dict[str, str] = {}
    for direction in DIRECTIONS:
        direction_dir = output_root / direction
        direction_dir.mkdir(parents=True, exist_ok=True)
        data = outputs[direction]
        payload = {
            "adapter_version": ADAPTER_VERSION,
            "direction": direction,
            "num_frames": TARGET_FRAMES,
            "cycle_start": int(cycle_start),
            "cycle_end": int(cycle_end),
            "cycle_source": cycle_source,
            "unique_cycle_frames": UNIQUE_CYCLE_FRAMES,
            "control_endpoint_duplicates_phase_zero": True,
            "cycle_unique_source_positions": unique_positions.tolist(),
            "control_source_positions": positions.tolist(),
            "source_num_frames": int(posed_joints.shape[0]),
            "source_num_joints": int(posed_joints.shape[1]),
            "heading_source": heading_source,
            "canonical_heading_degrees": float(np.degrees(heading_angle)),
            "canonicalization_delta_degrees": float(-np.degrees(heading_angle)),
            "canonical_heading_mean_degrees": heading_mean_deg,
            "canonical_heading_std_degrees": heading_std_deg,
            "geometry_source": data["geometry_source"],
            "postcanonical_hip_mean_degrees": cardinal_quality["postcanonical_hip"]["mean_deg"],
            "front_back_torso_before_p95_abs_degrees": cardinal_quality["front_back_lock"]["torso_before"]["p95_abs_deg"],
            "front_back_torso_after_p95_abs_degrees": cardinal_quality["front_back_lock"]["torso_after"]["p95_abs_deg"],
            "front_back_head_before_p95_abs_degrees": cardinal_quality["front_back_lock"]["head_before"]["p95_abs_deg"],
            "front_back_head_after_p95_abs_degrees": cardinal_quality["front_back_lock"]["head_after"]["p95_abs_deg"],
            "frames": data["frames"].tolist(),
            "scores": data["scores"].tolist(),
            "depth": data["depth"].tolist(),
        }
        with (direction_dir / "keypoints.json").open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        result_dirs[direction] = str(direction_dir)

    meta = {
        "adapter_version": ADAPTER_VERSION,
        "motion_npz": str(motion_npz),
        "root_positions_derived_from_hips": root_positions_derived,
        "cycle_start": int(cycle_start),
        "cycle_end": int(cycle_end),
        "cycle_source": cycle_source,
        "target_frames": TARGET_FRAMES,
        "unique_cycle_frames": UNIQUE_CYCLE_FRAMES,
        "control_endpoint_duplicates_phase_zero": True,
        "cycle_unique_source_positions": unique_positions.tolist(),
        "control_source_positions": positions.tolist(),
        "directions": list(DIRECTIONS),
        "heading_source": heading_source,
        "canonical_heading_degrees": float(np.degrees(heading_angle)),
        "canonicalization_delta_degrees": float(-np.degrees(heading_angle)),
        "canonical_heading_mean_degrees": heading_mean_deg,
        "canonical_heading_std_degrees": heading_std_deg,
        "gait_quality": gait_quality,
        "cardinal_quality": cardinal_quality,
        "cardinal_config": {
            "canonical_heading_tolerance_deg": CANONICAL_HEADING_TOLERANCE_DEG,
            "front_back_torso_yaw_limit_deg": FRONT_BACK_TORSO_YAW_LIMIT_DEG,
            "front_back_head_yaw_limit_deg": FRONT_BACK_HEAD_YAW_LIMIT_DEG,
            "body18_shoulder_blend": BODY18_SHOULDER_BLEND,
        },
        "cycle_candidates": selected_cycle.get("candidate_summary", []),
        "validation": validation,
        "preview": str(output_root / "pose_preview.png"),
    }
    with (output_root / "adapter_meta.json").open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    with (output_root / "adapter_validation.json").open("w", encoding="utf-8") as f:
        json.dump(validation, f, ensure_ascii=False, indent=2)

    return result_dirs
