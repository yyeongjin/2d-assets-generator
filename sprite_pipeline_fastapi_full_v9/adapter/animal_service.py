from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Mapping

import numpy as np
from PIL import Image, ImageDraw

DIRECTIONS = ("front", "back", "left", "right")
TARGET_FRAMES = 17
UNIQUE_CYCLE_FRAMES = 16
ADAPTER_VERSION = "9.0.0-animal"

# BODY_18 slot connections used by One-to-All's pose renderer. V9 deliberately
# changes the geometry assigned to these slots for animals instead of feeding a
# projected human skeleton into a four-legged or compact non-human reference.
BODY_EDGES = (
    (1, 0),
    (0, 14), (14, 16),
    (0, 15), (15, 17),
    (1, 2), (2, 3), (3, 4),
    (1, 5), (5, 6), (6, 7),
    (1, 8), (8, 9), (9, 10),
    (1, 11), (11, 12), (12, 13),
)


def _reference_box(
    direction: str,
    refs: Mapping[str, Path],
    classification: dict | None,
) -> tuple[float, float, float, float]:
    geometry = (classification or {}).get("reference_geometry", {}).get(direction, {})
    bbox = geometry.get("bbox")
    width = float(geometry.get("width", 0.0) or 0.0)
    height = float(geometry.get("height", 0.0) or 0.0)
    if bbox and width > 0 and height > 0:
        x0, y0, x1, y1 = [float(v) for v in bbox]
        return (
            max(0.03, x0 / width),
            max(0.03, y0 / height),
            min(0.97, (x1 + 1.0) / width),
            min(0.97, (y1 + 1.0) / height),
        )

    image = Image.open(refs[direction])
    w, h = image.size
    # Conservative full-body fallback with enough border for moving feet.
    return (0.16, 0.08, 0.84, 0.93 if h >= w else 0.88)


def _phase(index: int) -> float:
    return 2.0 * math.pi * (index % UNIQUE_CYCLE_FRAMES) / UNIQUE_CYCLE_FRAMES


def _limb_chain(
    root_x: float,
    root_y: float,
    ground_y: float,
    phase: float,
    stride: float,
    lift: float,
    bend_sign: float,
) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float]]:
    swing = math.sin(phase)
    swing_positive = max(0.0, -math.cos(phase))
    foot_x = root_x + stride * swing
    foot_y = ground_y - lift * swing_positive
    knee_x = root_x + stride * 0.40 * swing + bend_sign * stride * 0.22
    knee_y = root_y + (foot_y - root_y) * 0.52 - lift * 0.15 * swing_positive
    return (root_x, root_y), (knee_x, knee_y), (foot_x, foot_y)


def _head_points(
    head_x: float,
    head_y: float,
    scale_x: float,
    scale_y: float,
    facing: float,
) -> dict[int, tuple[float, float]]:
    # BODY slots 14-17 become two ears/cheeks and a muzzle cue. The shape stays
    # compact so the control never resembles a human head-and-shoulder rig.
    return {
        0: (head_x, head_y),
        14: (head_x - 0.10 * scale_x, head_y - 0.16 * scale_y),
        16: (head_x - 0.16 * scale_x, head_y - 0.28 * scale_y),
        15: (head_x + 0.10 * scale_x, head_y - 0.16 * scale_y),
        17: (head_x + facing * 0.20 * scale_x, head_y + 0.04 * scale_y),
    }


def _quadruped_side(
    direction: str,
    box: tuple[float, float, float, float],
) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = box
    bw = x1 - x0
    bh = y1 - y0
    cx = (x0 + x1) * 0.5
    ground = min(0.975, y1)
    facing = 1.0 if direction == "left" else -1.0
    front_x = cx + facing * bw * 0.28
    rear_x = cx - facing * bw * 0.28
    head_x = cx + facing * bw * 0.43
    body_y_base = y0 + bh * 0.46
    head_y_base = y0 + bh * 0.30
    stride = bw * 0.105
    lift = bh * 0.105

    # Four independent walk phases: near-front, far-front, near-rear, far-rear.
    offsets = (0.0, math.pi, 1.5 * math.pi, 0.5 * math.pi)
    frames = np.zeros((TARGET_FRAMES, 18, 2), dtype=np.float32)
    scores = np.ones((TARGET_FRAMES, 18), dtype=np.float32)

    for frame_index in range(UNIQUE_CYCLE_FRAMES):
        p = _phase(frame_index)
        bob = bh * 0.012 * math.cos(2.0 * p)
        body_y = body_y_base + bob
        head_y = head_y_base + bob * 0.7
        frame = frames[frame_index]
        frame[1] = (cx, body_y)
        for index, point in _head_points(head_x, head_y, bw, bh, facing).items():
            frame[index] = point

        chains = (
            (2, 3, 4, front_x, offsets[0], -facing),
            (5, 6, 7, front_x - facing * bw * 0.035, offsets[1], facing),
            (8, 9, 10, rear_x, offsets[2], facing),
            (11, 12, 13, rear_x + facing * bw * 0.035, offsets[3], -facing),
        )
        for a, b, c, root_x, phase_offset, bend_sign in chains:
            root, knee, foot = _limb_chain(
                root_x,
                body_y + bh * 0.025,
                ground,
                p + phase_offset,
                stride,
                lift,
                bend_sign,
            )
            frame[a], frame[b], frame[c] = root, knee, foot

    frames[-1] = frames[0]
    scores[-1] = scores[0]
    return np.clip(frames, 0.005, 0.995), scores


def _quadruped_front_back(
    direction: str,
    box: tuple[float, float, float, float],
) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = box
    bw = x1 - x0
    bh = y1 - y0
    cx = (x0 + x1) * 0.5
    ground = min(0.975, y1)
    body_y_base = y0 + bh * 0.48
    head_y_base = y0 + bh * 0.27
    head_x = cx
    stride = bw * 0.035
    lift = bh * 0.10
    lateral = bw * 0.26
    depth_offset = bw * 0.075
    facing = -1.0 if direction == "back" else 1.0

    frames = np.zeros((TARGET_FRAMES, 18, 2), dtype=np.float32)
    scores = np.ones((TARGET_FRAMES, 18), dtype=np.float32)
    if direction == "back":
        # Back references must not receive strong face-like dots.
        scores[:, [16, 17]] = 0.15

    offsets = (0.0, math.pi, 1.5 * math.pi, 0.5 * math.pi)
    roots = (
        cx - lateral, cx + lateral, cx - lateral + depth_offset, cx + lateral - depth_offset
    )
    slots = ((2, 3, 4), (5, 6, 7), (8, 9, 10), (11, 12, 13))

    for frame_index in range(UNIQUE_CYCLE_FRAMES):
        p = _phase(frame_index)
        bob = bh * 0.012 * math.cos(2.0 * p)
        body_y = body_y_base + bob
        frame = frames[frame_index]
        frame[1] = (cx, body_y)
        for index, point in _head_points(head_x, head_y_base + bob, bw, bh, facing).items():
            frame[index] = point

        for chain_index, ((a, b, c), root_x, phase_offset) in enumerate(
            zip(slots, roots, offsets)
        ):
            lateral_swing = stride * math.sin(p + phase_offset)
            phase_lift = max(0.0, -math.cos(p + phase_offset))
            foot_x = root_x + lateral_swing
            foot_y = ground - lift * phase_lift
            knee_x = root_x + lateral_swing * 0.45
            knee_y = body_y + (foot_y - body_y) * 0.53
            frame[a] = (root_x, body_y + bh * (0.02 if chain_index < 2 else 0.055))
            frame[b] = (knee_x, knee_y)
            frame[c] = (foot_x, foot_y)

    frames[-1] = frames[0]
    scores[-1] = scores[0]
    return np.clip(frames, 0.005, 0.995), scores


def _biped_animal(
    direction: str,
    box: tuple[float, float, float, float],
) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = box
    bw = x1 - x0
    bh = y1 - y0
    cx = (x0 + x1) * 0.5
    ground = min(0.975, y1)
    side = direction in {"left", "right"}
    facing = 1.0 if direction == "left" else -1.0 if direction == "right" else 1.0

    neck_y = y0 + bh * 0.36
    hip_y = y0 + bh * 0.62
    head_y = y0 + bh * 0.20
    shoulder_half = bw * (0.16 if not side else 0.055)
    hip_half = bw * (0.12 if not side else 0.040)
    stride = bw * (0.075 if not side else 0.11)
    lift = bh * 0.09

    frames = np.zeros((TARGET_FRAMES, 18, 2), dtype=np.float32)
    scores = np.ones((TARGET_FRAMES, 18), dtype=np.float32)
    if side:
        scores[:, [5, 6, 7, 11, 12, 13]] *= 0.62
    if direction == "back":
        scores[:, [14, 15, 16, 17]] *= 0.18

    for frame_index in range(UNIQUE_CYCLE_FRAMES):
        p = _phase(frame_index)
        bob = bh * 0.014 * math.cos(2.0 * p)
        frame = frames[frame_index]
        frame[1] = (cx, neck_y + bob)
        for index, point in _head_points(
            cx + (facing * bw * 0.035 if side else 0.0),
            head_y + bob,
            bw * 0.72,
            bh * 0.72,
            facing,
        ).items():
            frame[index] = point

        # Short non-human forelimbs. In profile, the far arm extends backward as
        # a tail/spine cue instead of forcing a second human arm silhouette.
        arm_swing = math.sin(p) * bh * 0.035
        if side:
            front_shoulder = (cx + facing * shoulder_half, neck_y + bh * 0.06 + bob)
            frame[2] = front_shoulder
            frame[3] = (front_shoulder[0] + facing * bw * 0.11, front_shoulder[1] + bh * 0.12 + arm_swing)
            frame[4] = (front_shoulder[0] + facing * bw * 0.15, front_shoulder[1] + bh * 0.20 + arm_swing)
            frame[5] = (cx - facing * shoulder_half, neck_y + bh * 0.10 + bob)
            frame[6] = (cx - facing * bw * 0.18, hip_y - bh * 0.03 + bob)
            frame[7] = (cx - facing * bw * 0.34, hip_y + bh * 0.02 + bob)
        else:
            for side_sign, slots, phase_offset in (
                (-1.0, (2, 3, 4), math.pi),
                (1.0, (5, 6, 7), 0.0),
            ):
                a, b, c = slots
                sx = cx + side_sign * shoulder_half
                swing = math.sin(p + phase_offset) * bw * 0.055
                frame[a] = (sx, neck_y + bh * 0.07 + bob)
                frame[b] = (sx + swing, neck_y + bh * 0.20 + bob)
                frame[c] = (sx + swing * 1.25, neck_y + bh * 0.30 + bob)

        for side_sign, slots, phase_offset in (
            (-1.0, (8, 9, 10), 0.0),
            (1.0, (11, 12, 13), math.pi),
        ):
            a, b, c = slots
            root_x = cx + side_sign * hip_half
            root, knee, foot = _limb_chain(
                root_x,
                hip_y + bob,
                ground,
                p + phase_offset,
                stride,
                lift,
                -side_sign * facing,
            )
            frame[a], frame[b], frame[c] = root, knee, foot

    frames[-1] = frames[0]
    scores[-1] = scores[0]
    return np.clip(frames, 0.005, 0.995), scores


def _build_direction(
    subject_profile: str,
    direction: str,
    box: tuple[float, float, float, float],
) -> tuple[np.ndarray, np.ndarray]:
    if subject_profile == "quadruped":
        if direction in {"left", "right"}:
            return _quadruped_side(direction, box)
        return _quadruped_front_back(direction, box)
    if subject_profile == "biped_animal":
        return _biped_animal(direction, box)
    raise ValueError(f"Unsupported animal subject profile: {subject_profile}")


def _validate(outputs: dict[str, dict], subject_profile: str) -> dict:
    errors: list[str] = []
    direction_metrics: dict[str, dict] = {}
    for direction, data in outputs.items():
        frames = np.asarray(data["frames"], dtype=np.float32)
        scores = np.asarray(data["scores"], dtype=np.float32)
        endpoint_exact = bool(
            np.array_equal(frames[0], frames[-1])
            and np.array_equal(scores[0], scores[-1])
        )
        finite = bool(np.all(np.isfinite(frames)) and np.all(np.isfinite(scores)))
        in_bounds = bool(np.all((frames >= 0.0) & (frames <= 1.0)))
        feet = frames[:UNIQUE_CYCLE_FRAMES, [4, 7, 10, 13], :]
        foot_travel = np.ptp(feet, axis=0)
        active_feet = int(np.sum(np.linalg.norm(foot_travel, axis=1) > 0.012))
        side_body_ratio = None
        if direction in {"left", "right"}:
            body_x = frames[:UNIQUE_CYCLE_FRAMES, [2, 5, 8, 11], 0]
            body_y = frames[:UNIQUE_CYCLE_FRAMES, [2, 5, 8, 11], 1]
            span_x = float(np.median(np.ptp(body_x, axis=1)))
            span_y = float(np.median(np.ptp(body_y, axis=1)))
            side_body_ratio = span_x / max(0.01, span_y + 0.01)

        if not endpoint_exact:
            errors.append(f"{direction}: loop endpoint is not exact")
        if not finite:
            errors.append(f"{direction}: non-finite control value")
        if not in_bounds:
            errors.append(f"{direction}: control outside normalized canvas")
        required_active = 4 if subject_profile == "quadruped" else 2
        if active_feet < required_active:
            errors.append(
                f"{direction}: only {active_feet} moving foot chains, expected {required_active}"
            )
        if (
            subject_profile == "quadruped"
            and direction in {"left", "right"}
            and (side_body_ratio or 0.0) < 2.0
        ):
            errors.append(f"{direction}: quadruped torso is not horizontal enough")

        direction_metrics[direction] = {
            "endpoint_exact": endpoint_exact,
            "finite": finite,
            "in_bounds": in_bounds,
            "active_feet": active_feet,
            "side_body_ratio": side_body_ratio,
            "foot_travel": foot_travel.tolist(),
        }

    return {
        "version": ADAPTER_VERSION,
        "ok": not errors,
        "subject_profile": subject_profile,
        "errors": errors,
        "directions": direction_metrics,
    }


def _save_preview(outputs: dict[str, dict], path: Path) -> None:
    cell_w, cell_h = 256, 230
    sample_indices = (0, 4, 8)
    canvas = Image.new("RGB", (cell_w * 4, cell_h * len(sample_indices)), "white")
    draw = ImageDraw.Draw(canvas)
    for col, direction in enumerate(DIRECTIONS):
        draw.text((col * cell_w + 8, 7), direction, fill=(220, 0, 0))
        for row, frame_index in enumerate(sample_indices):
            frame = np.asarray(outputs[direction]["frames"])[frame_index]
            ox, oy = col * cell_w, row * cell_h
            for a, b in BODY_EDGES:
                ax = ox + int(round(float(frame[a, 0]) * (cell_w - 1)))
                ay = oy + int(round(float(frame[a, 1]) * (cell_h - 1)))
                bx = ox + int(round(float(frame[b, 0]) * (cell_w - 1)))
                by = oy + int(round(float(frame[b, 1]) * (cell_h - 1)))
                draw.line((ax, ay, bx, by), fill=(15, 15, 15), width=3)
            for x, y in frame:
                px = ox + int(round(float(x) * (cell_w - 1)))
                py = oy + int(round(float(y) * (cell_h - 1)))
                draw.ellipse((px - 2, py - 2, px + 2, py + 2), fill=(0, 0, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)



def _npz_scalar_string(data: np.lib.npyio.NpzFile, key: str, default: str = "") -> str:
    if key not in data.files:
        return default
    value = np.asarray(data[key])
    if value.size != 1:
        raise RuntimeError(f"{key} must be a scalar string")
    scalar = value.reshape(-1)[0]
    if isinstance(scalar, (bytes, np.bytes_)):
        try:
            return bytes(scalar).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RuntimeError(f"{key} must be valid UTF-8") from exc
    return str(scalar)


def _npz_direction_array(data: np.lib.npyio.NpzFile, direction: str) -> np.ndarray:
    for key in (direction, f"{direction}_keypoints", f"keypoints_{direction}"):
        if key in data.files:
            array = np.asarray(data[key], dtype=np.float32)
            if array.ndim != 3 or array.shape[1:] != (18, 2):
                raise RuntimeError(
                    f"{key} must have shape (frames, 18, 2), got {array.shape}"
                )
            if not 4 <= array.shape[0] <= 512:
                raise RuntimeError(
                    f"{key} frame count must be between 4 and 512, got {array.shape[0]}"
                )
            if not np.all(np.isfinite(array)):
                raise RuntimeError(f"{key} contains non-finite values")
            return array
    raise RuntimeError(
        f"missing {direction} controls; expected {direction}, {direction}_keypoints, or keypoints_{direction}"
    )


def _npz_score_array(
    data: np.lib.npyio.NpzFile,
    direction: str,
    frame_count: int,
) -> np.ndarray:
    for key in (f"{direction}_scores", f"scores_{direction}"):
        if key in data.files:
            scores = np.asarray(data[key], dtype=np.float32)
            if scores.shape != (frame_count, 18):
                raise RuntimeError(
                    f"{key} must have shape ({frame_count}, 18), got {scores.shape}"
                )
            if not np.all(np.isfinite(scores)):
                raise RuntimeError(f"{key} contains non-finite values")
            return np.clip(scores, 0.0, 1.0)
    return np.ones((frame_count, 18), dtype=np.float32)


def _remove_closed_endpoint(
    frames: np.ndarray,
    scores: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, bool]:
    if len(frames) >= 5 and np.allclose(frames[0], frames[-1], atol=1e-5, rtol=0.0):
        return frames[:-1], scores[:-1], True
    return frames, scores, False


def _periodic_resample(array: np.ndarray, target_count: int) -> np.ndarray:
    source_count = int(array.shape[0])
    if source_count < 2:
        raise RuntimeError("animal motion needs at least two unique frames")
    positions = (
        np.arange(target_count, dtype=np.float32)
        * float(source_count)
        / float(target_count)
    )
    low = np.floor(positions).astype(np.int64) % source_count
    high = (low + 1) % source_count
    alpha = (positions - np.floor(positions)).astype(np.float32)
    alpha = alpha.reshape((target_count,) + (1,) * (array.ndim - 1))
    return (array[low] * (1.0 - alpha) + array[high] * alpha).astype(np.float32)


def _map_external_coordinates(
    frames: np.ndarray,
    coordinate_space: str,
    box: tuple[float, float, float, float],
) -> np.ndarray:
    points = np.clip(np.asarray(frames, dtype=np.float32), -0.25, 1.25)
    if coordinate_space == "normalized_canvas":
        return np.clip(points, 0.005, 0.995)
    if coordinate_space != "subject_box":
        raise RuntimeError(
            "animal motion coordinate_space must be subject_box or normalized_canvas"
        )
    x0, y0, x1, y1 = box
    mapped = points.copy()
    mapped[..., 0] = x0 + np.clip(points[..., 0], 0.0, 1.0) * (x1 - x0)
    mapped[..., 1] = y0 + np.clip(points[..., 1], 0.0, 1.0) * (y1 - y0)
    return np.clip(mapped, 0.005, 0.995)


def _load_external_animal_motion(
    motion_npz: Path,
    refs: Mapping[str, Path],
    classification: dict | None,
    subject_profile: str,
) -> tuple[dict[str, dict], dict]:
    if not motion_npz.exists():
        raise RuntimeError(f"Animal motion NPZ does not exist: {motion_npz}")

    raw = motion_npz.read_bytes()
    source_sha256 = hashlib.sha256(raw).hexdigest()
    outputs: dict[str, dict] = {}
    source_frames: dict[str, int] = {}
    source_closed: dict[str, bool] = {}

    try:
        with np.load(motion_npz, allow_pickle=False) as data:
            declared_profile = _npz_scalar_string(data, "subject_profile", "")
            if declared_profile and declared_profile != subject_profile:
                raise RuntimeError(
                    f"Animal motion profile {declared_profile!r} does not match request {subject_profile!r}"
                )
            coordinate_space = _npz_scalar_string(
                data, "coordinate_space", "subject_box"
            )
            schema_version = _npz_scalar_string(
                data, "schema_version", "animal-motion-v1"
            )
            if schema_version != "animal-motion-v1":
                raise RuntimeError(
                    f"Unsupported animal motion schema: {schema_version!r}"
                )
            provider = _npz_scalar_string(data, "provider", "")
            motion_name = _npz_scalar_string(data, "motion_name", "")
            source_model = _npz_scalar_string(data, "source_model", "")

            for direction in DIRECTIONS:
                source = _npz_direction_array(data, direction)
                scores = _npz_score_array(data, direction, int(source.shape[0]))
                source_frames[direction] = int(source.shape[0])
                source, scores, had_closed_endpoint = _remove_closed_endpoint(
                    source, scores
                )
                source_closed[direction] = had_closed_endpoint
                unique_frames = _periodic_resample(source, UNIQUE_CYCLE_FRAMES)
                unique_scores = _periodic_resample(scores, UNIQUE_CYCLE_FRAMES)
                frames = np.concatenate([unique_frames, unique_frames[:1]], axis=0)
                frame_scores = np.concatenate(
                    [unique_scores, unique_scores[:1]], axis=0
                )
                box = _reference_box(direction, refs, classification)
                frames = _map_external_coordinates(frames, coordinate_space, box)
                outputs[direction] = {
                    "frames": frames.astype(np.float32),
                    "scores": np.clip(frame_scores, 0.0, 1.0).astype(np.float32),
                    "reference_box": box,
                }
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Cannot read animal motion NPZ: {exc}") from exc

    return outputs, {
        "schema_version": schema_version,
        "coordinate_space": coordinate_space,
        "declared_subject_profile": declared_profile or None,
        "source_filename": motion_npz.name,
        "provider": provider or None,
        "motion_name": motion_name or None,
        "source_model": source_model or None,
        "source_sha256": source_sha256,
        "source_size_bytes": len(raw),
        "source_frames": source_frames,
        "source_closed_endpoint": source_closed,
    }


def build_animal_pose_controls(
    refs: Mapping[str, Path],
    output_root: Path,
    subject_profile: str,
    prompt: str = "",
    classification: dict | None = None,
    motion_npz: Path | str | None = None,
    motion_backend: str = "animal_procedural",
) -> dict[str, str]:
    if subject_profile not in {"quadruped", "biped_animal"}:
        raise ValueError(f"Animal adapter cannot handle profile {subject_profile!r}")
    if motion_backend not in {"animal_procedural", "animal_npz"}:
        raise ValueError(f"Animal adapter cannot handle backend {motion_backend!r}")

    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, dict] = {}
    source_meta: dict = {}

    if motion_backend == "animal_npz":
        if motion_npz is None:
            raise RuntimeError("motion_backend=animal_npz requires motion_npz")
        outputs, source_meta = _load_external_animal_motion(
            Path(motion_npz), refs, classification, subject_profile
        )
        adapter_kind = "animal_npz_control"
        geometry_source = "external_animal_motion_npz"
    else:
        for direction in DIRECTIONS:
            reference = Path(refs[direction])
            if not reference.exists():
                raise RuntimeError(f"Missing {direction} reference image: {reference}")
            box = _reference_box(direction, refs, classification)
            frames, scores = _build_direction(subject_profile, direction, box)
            outputs[direction] = {
                "frames": frames,
                "scores": scores,
                "reference_box": box,
            }
        adapter_kind = "animal_synthetic_control"
        geometry_source = (
            "quadruped_four_limb_phase_scaffold"
            if subject_profile == "quadruped"
            else "compact_biped_creature_scaffold"
        )
        source_meta = {
            "schema_version": "animal-procedural-v1",
            "coordinate_space": "normalized_canvas",
            "source_frames": {direction: TARGET_FRAMES for direction in DIRECTIONS},
        }

    validation = _validate(outputs, subject_profile)
    _save_preview(outputs, output_root / "pose_preview.png")
    with (output_root / "adapter_validation.json").open("w", encoding="utf-8") as f:
        json.dump(validation, f, ensure_ascii=False, indent=2)
    if not validation["ok"]:
        raise RuntimeError("Animal adapter validation failed: " + "; ".join(validation["errors"]))

    result: dict[str, str] = {}
    for direction in DIRECTIONS:
        direction_root = output_root / direction
        direction_root.mkdir(parents=True, exist_ok=True)
        data = outputs[direction]
        payload = {
            "adapter_version": ADAPTER_VERSION,
            "adapter_kind": adapter_kind,
            "motion_backend": motion_backend,
            "subject_profile": subject_profile,
            "direction": direction,
            "num_frames": TARGET_FRAMES,
            "unique_cycle_frames": UNIQUE_CYCLE_FRAMES,
            "control_endpoint_duplicates_phase_zero": True,
            "geometry_source": geometry_source,
            "reference_box": list(data["reference_box"]),
            "kimodo_bypassed": True,
            "human_reference_pose_detector_bypassed": True,
            "prompt": prompt,
            "frames": np.asarray(data["frames"]).tolist(),
            "scores": np.asarray(data["scores"]).tolist(),
        }
        with (direction_root / "keypoints.json").open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        result[direction] = str(direction_root)

    meta = {
        "adapter_version": ADAPTER_VERSION,
        "adapter_kind": adapter_kind,
        "motion_backend": motion_backend,
        "subject_profile": subject_profile,
        "target_frames": TARGET_FRAMES,
        "unique_cycle_frames": UNIQUE_CYCLE_FRAMES,
        "control_endpoint_duplicates_phase_zero": True,
        "geometry_source": geometry_source,
        "kimodo_bypassed": True,
        "human_reference_pose_detector_bypassed": True,
        "classification": classification or {},
        "motion_source": source_meta,
        "directions": list(DIRECTIONS),
        "reference_boxes": {
            direction: list(outputs[direction]["reference_box"])
            for direction in DIRECTIONS
        },
        "validation": validation,
        "preview": str(output_root / "pose_preview.png"),
    }
    with (output_root / "adapter_meta.json").open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return result
