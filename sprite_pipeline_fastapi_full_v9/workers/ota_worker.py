import importlib.util
import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
import torch
from PIL import Image

ROOT = Path(os.environ.get("SPRITE_PIPELINE_ROOT", "/workspace/sprite-pipeline"))
OTA_ROOT = ROOT / "one-to-all"
VIDEO_ROOT = OTA_ROOT / "video-generation"
CKPT_PATH = Path(os.environ.get(
    "OTA_CHECKPOINT_DIR",
    str(OTA_ROOT / "checkpoints" / "One-to-All-1.3b_2"),
))
INFERENCE_FILE = VIDEO_ROOT / "inference_1.3b.py"

HOST = os.environ.get("OTA_WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("OTA_WORKER_PORT", "9102"))
DEVICE = "cuda"
WORKER_VERSION = "9.0.0"

PIPE = None
INFER_MODULE = None
INFER_UTILS = None
MODEL_LOCK = threading.Lock()

# Keep the official One-to-All negative terms and add fixed-view sprite failure modes.
BASE_NEGATIVE_PROMPT = (
    "black background, Aerial view, aerial view, overexposed, low quality, "
    "deformation, a poor composition, bad hands, bad teeth, bad eyes, "
    "bad limbs, distortion, different character, different person, "
    "different clothes, different outfit, clothing color change, palette shift, hue shift, lighting flicker, brightness flicker, shadow flicker, "
    "three-quarter view, 3/4 view, camera rotation, camera movement, "
    "camera pan, camera zoom, cropped body"
)


def negative_prompt_for_direction(
    direction: str,
    subject_profile: str = "character",
) -> list[str]:
    extra = {
        "front": ", back view, side profile, turned-away body",
        "back": ", front view, visible face, facial features, side profile, turned head toward camera",
        "left": ", front view, back view, right-side profile, face turned toward camera",
        "right": ", front view, back view, left-side profile, face turned toward camera",
    }[direction]
    animal = ""
    if subject_profile == "quadruped":
        animal = (
            ", human, person, humanoid, upright human posture, biped, centaur, mascot suit, "
            "extra animal, duplicate animal, extra legs, missing legs, fused legs, detached torso, "
            "species change, long human arms, human clothing not present in reference"
        )
    elif subject_profile == "biped_animal":
        animal = (
            ", realistic human, human face, human body proportions, species change, extra creature, "
            "duplicate creature, extra legs, missing legs, detached tail, detached body parts"
        )
    return [BASE_NEGATIVE_PROMPT + extra + animal]


def load_runtime():
    global PIPE, INFER_MODULE, INFER_UTILS

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable")

    # One-to-All source uses repo-relative paths. Make its own video-generation
    # directory the cwd instead of depending on the shell that launched us.
    os.chdir(VIDEO_ROOT)
    if str(VIDEO_ROOT) not in sys.path:
        sys.path.insert(0, str(VIDEO_ROOT))

    print("[ota-worker] importing inference_1.3b.py", flush=True)
    spec = importlib.util.spec_from_file_location("ota_inference", str(INFERENCE_FILE))
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    INFER_MODULE = module

    import infer_utils
    INFER_UTILS = infer_utils

    print("[ota-worker] building One-to-All pipe", flush=True)
    PIPE = INFER_MODULE.build_pipe(DEVICE, str(CKPT_PATH))

    print(f"[ota-worker] ready version={WORKER_VERSION}", flush=True)
    print(f"[ota-worker] checkpoint={CKPT_PATH}", flush=True)
    print(f"[ota-worker] GPU: {torch.cuda.get_device_name(0)}", flush=True)
    print(
        "[ota-worker] allocated GiB:",
        round(torch.cuda.memory_allocated() / 1024**3, 2),
        flush=True,
    )


def resize_for_model(image: Image.Image) -> tuple[Image.Image, int, int]:
    h, w = image.height, image.width
    max_short = 384

    if min(h, w) > max_short:
        if h < w:
            scale = max_short / h
            h = max_short
            w = int(w * scale)
        else:
            scale = max_short / w
            w = max_short
            h = int(h * scale)

    h = max(64, int(h // 16 * 16))
    w = max(64, int(w // 16 * 16))
    resized = INFER_UTILS.resizecrop(image, th=h, tw=w)
    return resized, h, w


def body_pose_dict(candidate: np.ndarray, score: np.ndarray) -> dict:
    candidate = np.asarray(candidate, dtype=np.float32)
    score = np.asarray(score, dtype=np.float32).reshape(18)

    if candidate.shape != (18, 2):
        raise ValueError(f"candidate must be [18,2], got {candidate.shape}")

    subset = np.arange(18, dtype=np.float32)
    subset[score <= 0.01] = -1

    return {
        "bodies": {
            "candidate": candidate,
            "subset": subset[None, :],
            "score": score[None, :],
        },
        # Our motion source has body joints only. Do not invent hand/face
        # landmarks. One-to-All still receives the real reference pose in
        # image_pose, and BODY_18 head points are controlled by score.
        "hands": np.zeros((2, 21, 2), dtype=np.float32),
        "hands_score": np.zeros((2, 21), dtype=np.float32),
        "faces": np.zeros((1, 68, 2), dtype=np.float32),
        "faces_score": np.zeros((1, 68), dtype=np.float32),
    }


def load_control_data(pose_dir: Path) -> tuple[np.ndarray, np.ndarray, str]:
    with (pose_dir / "keypoints.json").open("r", encoding="utf-8") as f:
        data = json.load(f)

    frames = np.asarray(data["frames"], dtype=np.float32)
    scores = np.asarray(data.get("scores"), dtype=np.float32)
    direction = str(data.get("direction", pose_dir.name))

    if frames.ndim != 3 or frames.shape[1:] != (18, 2):
        raise RuntimeError(f"Invalid adapter keypoints shape: {frames.shape}")
    if scores.shape != frames.shape[:2]:
        raise RuntimeError(f"Invalid adapter scores shape: {scores.shape}")
    if direction not in {"front", "back", "left", "right"}:
        raise RuntimeError(f"Invalid direction: {direction}")
    if not np.all(np.isfinite(frames)) or not np.all(np.isfinite(scores)):
        raise RuntimeError("Adapter control contains non-finite values")

    return frames, np.clip(scores, 0.0, 1.0), direction


def _reference_body(ref_dwpose: dict) -> tuple[np.ndarray, np.ndarray]:
    candidate = np.asarray(ref_dwpose["bodies"]["candidate"], dtype=np.float32)
    score = np.asarray(ref_dwpose["bodies"]["score"], dtype=np.float32).reshape(-1)
    if candidate.shape[0] < 18 or score.shape[0] < 18:
        raise RuntimeError("Reference pose detector returned fewer than 18 BODY joints")
    return candidate[:18], np.clip(score[:18], 0.0, 1.0)


def _visible_reference_prior(ref_score: np.ndarray, direction: str) -> np.ndarray:
    # Preserve the detector's view-specific confidence instead of replacing all
    # joints with score=1. A small floor keeps detected body joints usable while
    # still making weak/far joints lighter in draw_pose_aligned().
    prior = np.where(
        ref_score > 0.02,
        0.30 + 0.70 * ref_score,
        0.0,
    ).astype(np.float32)

    # Geometry hard guards. Back-view references occasionally hallucinate a
    # face; those head BODY points must not turn the generated character around.
    if direction == "back":
        prior[[0, 14, 15, 16, 17]] = 0.0
    elif direction == "left":
        # Anatomical left side is near the camera.
        prior[14] *= 0.15
        prior[16] *= 0.10
    elif direction == "right":
        prior[15] *= 0.15
        prior[17] *= 0.10

    return np.clip(prior, 0.0, 1.0)


def _reference_center_x(ref_candidate: np.ndarray, ref_score: np.ndarray) -> float:
    if ref_score[1] > 0.05:
        return float(ref_candidate[1, 0])

    centers = []
    if ref_score[2] > 0.05 and ref_score[5] > 0.05:
        centers.append(float((ref_candidate[2, 0] + ref_candidate[5, 0]) * 0.5))
    if ref_score[8] > 0.05 and ref_score[11] > 0.05:
        centers.append(float((ref_candidate[8, 0] + ref_candidate[11, 0]) * 0.5))
    return float(np.mean(centers)) if centers else 0.5


def _reference_baseline(ref_candidate: np.ndarray, ref_score: np.ndarray) -> float:
    ankles = [
        float(ref_candidate[i, 1])
        for i in (10, 13)
        if ref_score[i] > 0.05
    ]
    if ankles:
        return max(ankles)

    visible = ref_candidate[ref_score > 0.05, 1]
    return float(np.max(visible)) if len(visible) else 0.92


def _reference_neck_y(ref_candidate: np.ndarray, ref_score: np.ndarray) -> float:
    if ref_score[1] > 0.05:
        return float(ref_candidate[1, 1])
    shoulders = [
        float(ref_candidate[i, 1])
        for i in (2, 5)
        if ref_score[i] > 0.05
    ]
    if shoulders:
        return float(np.mean(shoulders))
    return 0.30


def align_sequence_globally(
    frames: np.ndarray,
    ref_dwpose: dict,
) -> np.ndarray:
    """Global scale/translate only; never rewrite per-bone motion geometry.

    One-to-All is explicitly trained to decouple reference identity/shape from
    driving-pose skeleton structure. Reconstructing every limb with a custom
    retargeter introduced severe profile/front/back distortion, so this adapter
    only puts the Kimodo pose sequence into the reference's image scale/baseline.
    """
    ref_candidate, ref_score = _reference_body(ref_dwpose)

    target_center_x = float(np.median((frames[:, 8, 0] + frames[:, 11, 0]) * 0.5))
    target_baseline = float(np.median(np.maximum(frames[:, 10, 1], frames[:, 13, 1])))
    target_neck_y = float(np.median(frames[:, 1, 1]))
    target_metric = max(0.05, target_baseline - target_neck_y)

    ref_center_x = _reference_center_x(ref_candidate, ref_score)
    ref_baseline = _reference_baseline(ref_candidate, ref_score)
    ref_neck_y = _reference_neck_y(ref_candidate, ref_score)
    ref_metric = max(0.05, ref_baseline - ref_neck_y)

    scale = float(np.clip(ref_metric / target_metric, 0.65, 1.45))
    out = frames.copy()
    out[..., 0] = ref_center_x + (out[..., 0] - target_center_x) * scale
    out[..., 1] = ref_baseline + (out[..., 1] - target_baseline) * scale
    out[..., 0] = np.clip(out[..., 0], 0.005, 0.995)
    out[..., 1] = np.clip(out[..., 1], 0.005, 0.995)
    return out.astype(np.float32)


def build_control_tensor(
    target_frames: np.ndarray,
    target_scores: np.ndarray,
    h: int,
    w: int,
    pose_dir: Path,
) -> torch.Tensor:
    pose_images = []

    for index, (candidate, score) in enumerate(zip(target_frames, target_scores)):
        pose = body_pose_dict(candidate, score)
        image = INFER_UTILS.draw_pose_aligned(
            pose,
            h,
            w,
            without_face=True,
        )
        imageio.imwrite(pose_dir / f"control_{index:03d}.png", image)
        pose_images.append(image)

    array = np.stack(pose_images, axis=0)
    tensor = (
        torch.from_numpy(array)
        .float()
        .permute(3, 0, 1, 2)
        / 255.0
        * 2.0
        - 1.0
    )
    return tensor.unsqueeze(0)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


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
        raise RuntimeError(f"{name} must be numeric") from exc
    if minimum is not None and value < minimum:
        raise RuntimeError(f"{name} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise RuntimeError(f"{name} must be <= {maximum}")
    return float(value)


def _body_anchor(
    candidate: np.ndarray,
    score: np.ndarray,
    threshold: float = 0.05,
) -> tuple[float, float] | None:
    """Return BODY_18 hip-center X and ground Y in normalized coordinates."""
    candidate = np.asarray(candidate, dtype=np.float32)
    score = np.asarray(score, dtype=np.float32).reshape(-1)
    if candidate.shape[0] < 18 or score.shape[0] < 18:
        return None

    if score[8] > threshold and score[11] > threshold:
        center_x = float((candidate[8, 0] + candidate[11, 0]) * 0.5)
    elif score[1] > threshold:
        center_x = float(candidate[1, 0])
    elif score[2] > threshold and score[5] > threshold:
        center_x = float((candidate[2, 0] + candidate[5, 0]) * 0.5)
    else:
        return None

    ankles = [
        float(candidate[index, 1])
        for index in (10, 13)
        if score[index] > threshold
    ]
    if ankles:
        ground_y = max(ankles)
    else:
        visible = candidate[(score[:18] > threshold), 1]
        if len(visible) == 0:
            return None
        ground_y = float(np.max(visible))

    if not np.isfinite(center_x) or not np.isfinite(ground_y):
        return None
    return center_x, ground_y


def _fill_circular(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32)
    valid = np.asarray(valid, dtype=bool)
    if values.ndim != 1 or valid.shape != values.shape:
        raise RuntimeError("circular fill expects equal 1D arrays")
    if not np.any(valid):
        return np.zeros_like(values)
    if int(np.sum(valid)) == 1:
        return np.full_like(values, float(values[valid][0]))

    n = len(values)
    indices = np.flatnonzero(valid).astype(np.float32)
    samples = values[valid]
    extended_x = np.concatenate([indices - n, indices, indices + n])
    extended_y = np.concatenate([samples, samples, samples])
    return np.interp(np.arange(n, dtype=np.float32), extended_x, extended_y).astype(np.float32)


def _circular_smooth(values: np.ndarray, strength: float, passes: int = 2) -> np.ndarray:
    result = np.asarray(values, dtype=np.float32).copy()
    strength = float(np.clip(strength, 0.0, 1.0))
    for _ in range(max(0, int(passes))):
        neighbor = 0.25 * np.roll(result, 1) + 0.50 * result + 0.25 * np.roll(result, -1)
        result = (1.0 - strength) * result + strength * neighbor
    return result.astype(np.float32)


def _translate_frame(frame: np.ndarray, dx: float, dy: float) -> np.ndarray:
    h, w = frame.shape[:2]
    matrix = np.array(
        [[1.0, 0.0, float(dx) * w], [0.0, 1.0, float(dy) * h]],
        dtype=np.float32,
    )
    cv2 = INFER_UTILS.cv2
    return cv2.warpAffine(
        frame,
        matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )



def _foreground_mask_array(frame: np.ndarray) -> np.ndarray:
    rgb = np.asarray(frame, dtype=np.uint8)[..., :3].astype(np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]], axis=0)
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb - background[None, None, :], axis=-1)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    border_distance = np.linalg.norm(border - background[None, :], axis=-1)
    threshold = float(np.clip(np.percentile(border_distance, 98) + 12.0, 18.0, 46.0))
    mask = distance > threshold
    mask &= ~((chroma < 13.0) & (luma > 202.0))
    if float(background.mean()) > 220.0:
        mask |= luma < 188.0
    return mask


def _silhouette_anchor(frame: np.ndarray) -> tuple[float, float] | None:
    mask = _foreground_mask_array(frame)
    ys, xs = np.nonzero(mask)
    if len(xs) < 16:
        return None
    h, w = mask.shape
    return (
        float((float(xs.min()) + float(xs.max())) * 0.5 / w),
        float(float(ys.max()) / max(1, h - 1)),
    )


def _animal_control_anchor(
    candidate: np.ndarray,
    score: np.ndarray,
) -> tuple[float, float] | None:
    candidate = np.asarray(candidate, dtype=np.float32)
    score = np.asarray(score, dtype=np.float32).reshape(-1)
    visible = score > 0.05
    if candidate.shape[0] < 18 or int(np.sum(visible)) < 4:
        return None
    xs = candidate[visible, 0]
    center_x = float((float(xs.min()) + float(xs.max())) * 0.5)
    foot_indices = [index for index in (4, 7, 10, 13) if score[index] > 0.05]
    if foot_indices:
        ground_y = float(np.max(candidate[foot_indices, 1]))
    else:
        ground_y = float(np.max(candidate[visible, 1]))
    return center_x, ground_y


def stabilize_animal_frames(
    output: np.ndarray,
    target_frames: np.ndarray,
    target_scores: np.ndarray,
    direction: str,
    subject_profile: str,
) -> tuple[np.ndarray, dict]:
    enabled = _env_bool("OTA_STABILIZE_RENDERED_FRAMES", True)
    max_shift = _env_float("OTA_STABILIZE_MAX_SHIFT_RATIO", 0.08, 0.0, 0.25)
    smoothing = _env_float("OTA_STABILIZE_SMOOTHING", 0.35, 0.0, 1.0)
    min_valid_fraction = _env_float("OTA_STABILIZE_MIN_VALID_FRACTION", 0.60, 0.0, 1.0)
    target_anchors = [
        _animal_control_anchor(candidate, score)
        for candidate, score in zip(target_frames, target_scores)
    ]
    generated_anchors = [_silhouette_anchor(frame) for frame in output]
    count = len(output)
    report = {
        "worker_version": WORKER_VERSION,
        "enabled": enabled,
        "direction": direction,
        "subject_profile": subject_profile,
        "anchor_source": "foreground_silhouette",
        "human_pose_detector_bypassed": True,
        "max_shift_ratio": max_shift,
        "smoothing": smoothing,
        "min_valid_fraction": min_valid_fraction,
        "control_endpoint_exact": bool(
            np.array_equal(target_frames[0], target_frames[-1])
            and np.array_equal(target_scores[0], target_scores[-1])
        ),
    }
    if not enabled:
        report.update({"applied": False, "reason": "disabled"})
        return output, report

    valid = np.asarray(
        [a is not None and b is not None for a, b in zip(target_anchors, generated_anchors)],
        dtype=bool,
    )
    valid_fraction = float(np.mean(valid)) if count else 0.0
    report["valid_fraction"] = valid_fraction
    if valid_fraction < min_valid_fraction:
        report.update({
            "applied": False,
            "reason": "insufficient_silhouette_detections",
            "target_anchors": [list(x) if x is not None else None for x in target_anchors],
            "generated_anchors": [list(x) if x is not None else None for x in generated_anchors],
        })
        return output, report

    raw_dx = np.zeros(count, dtype=np.float32)
    raw_dy = np.zeros(count, dtype=np.float32)
    for index, (target, generated) in enumerate(zip(target_anchors, generated_anchors)):
        if target is None or generated is None:
            continue
        raw_dx[index] = float(target[0] - generated[0])
        raw_dy[index] = float(target[1] - generated[1])
    applied_dx = np.clip(
        _circular_smooth(_fill_circular(raw_dx, valid), smoothing),
        -max_shift,
        max_shift,
    )
    applied_dy = np.clip(
        _circular_smooth(_fill_circular(raw_dy, valid), smoothing),
        -max_shift,
        max_shift,
    )
    stabilized = np.stack(
        [_translate_frame(frame, float(dx), float(dy)) for frame, dx, dy in zip(output, applied_dx, applied_dy)],
        axis=0,
    ).astype(np.uint8)
    report.update({
        "applied": True,
        "reason": "ok",
        "raw_shift_x": raw_dx.tolist(),
        "raw_shift_y": raw_dy.tolist(),
        "applied_shift_x": applied_dx.tolist(),
        "applied_shift_y": applied_dy.tolist(),
        "max_abs_shift_x": float(np.max(np.abs(applied_dx))),
        "max_abs_shift_y": float(np.max(np.abs(applied_dy))),
        "target_anchors": [list(x) if x is not None else None for x in target_anchors],
        "generated_anchors": [list(x) if x is not None else None for x in generated_anchors],
    })
    return stabilized, report

def stabilize_generated_frames(
    output: np.ndarray,
    target_frames: np.ndarray,
    target_scores: np.ndarray,
    direction: str,
    subject_profile: str = "character",
) -> tuple[np.ndarray, dict]:
    """Translate generated frames back onto the cyclic control anchors.

    Human/character jobs retain V8 BODY_18 detection. Animal jobs use foreground
    silhouette anchors and never invoke the human pose detector.
    """
    if subject_profile != "character":
        return stabilize_animal_frames(
            output,
            target_frames,
            target_scores,
            direction,
            subject_profile,
        )

    enabled = _env_bool("OTA_STABILIZE_RENDERED_FRAMES", True)
    max_shift = _env_float("OTA_STABILIZE_MAX_SHIFT_RATIO", 0.08, 0.0, 0.25)
    smoothing = _env_float("OTA_STABILIZE_SMOOTHING", 0.35, 0.0, 1.0)
    min_valid_fraction = _env_float("OTA_STABILIZE_MIN_VALID_FRACTION", 0.60, 0.0, 1.0)

    count = int(output.shape[0])
    target_anchors = []
    for candidate, score in zip(target_frames, target_scores):
        target_anchors.append(_body_anchor(candidate, score, threshold=0.01))

    report = {
        "worker_version": WORKER_VERSION,
        "enabled": enabled,
        "direction": direction,
        "max_shift_ratio": max_shift,
        "smoothing": smoothing,
        "min_valid_fraction": min_valid_fraction,
        "control_endpoint_exact": bool(
            np.array_equal(target_frames[0], target_frames[-1])
            and np.array_equal(target_scores[0], target_scores[-1])
        ),
    }

    if not enabled:
        report.update({"applied": False, "reason": "disabled"})
        return output, report

    try:
        pose_metas = INFER_UTILS.wanpose2d(output)
        if len(pose_metas) != count:
            raise RuntimeError(
                f"pose detector returned {len(pose_metas)} frames for {count} images"
            )
        generated_anchors = []
        for meta in pose_metas:
            dwpose = INFER_UTILS.aaposemeta_to_dwpose(meta)
            candidate, score = _reference_body(dwpose)
            generated_anchors.append(_body_anchor(candidate, score))
    except Exception as exc:
        report.update({
            "applied": False,
            "reason": "pose_detection_failed",
            "error": f"{type(exc).__name__}: {exc}",
        })
        return output, report

    valid = np.array(
        [target is not None and generated is not None for target, generated in zip(target_anchors, generated_anchors)],
        dtype=bool,
    )
    valid_fraction = float(np.mean(valid)) if count else 0.0
    report["valid_fraction"] = valid_fraction
    if valid_fraction < min_valid_fraction:
        report.update({
            "applied": False,
            "reason": "insufficient_pose_detections",
            "generated_anchors": [list(x) if x is not None else None for x in generated_anchors],
            "target_anchors": [list(x) if x is not None else None for x in target_anchors],
        })
        return output, report

    raw_dx = np.zeros(count, dtype=np.float32)
    raw_dy = np.zeros(count, dtype=np.float32)
    for index, (target, generated) in enumerate(zip(target_anchors, generated_anchors)):
        if target is None or generated is None:
            continue
        raw_dx[index] = float(target[0] - generated[0])
        raw_dy[index] = float(target[1] - generated[1])

    filled_dx = _fill_circular(raw_dx, valid)
    filled_dy = _fill_circular(raw_dy, valid)
    applied_dx = _circular_smooth(filled_dx, smoothing)
    applied_dy = _circular_smooth(filled_dy, smoothing)
    applied_dx = np.clip(applied_dx, -max_shift, max_shift)
    applied_dy = np.clip(applied_dy, -max_shift, max_shift)

    stabilized = np.stack(
        [
            _translate_frame(frame, float(dx), float(dy))
            for frame, dx, dy in zip(output, applied_dx, applied_dy)
        ],
        axis=0,
    ).astype(np.uint8)

    predicted_anchors = []
    residuals = []
    for index, (target, generated) in enumerate(zip(target_anchors, generated_anchors)):
        if target is None or generated is None:
            predicted_anchors.append(None)
            continue
        predicted = (
            float(generated[0] + applied_dx[index]),
            float(generated[1] + applied_dy[index]),
        )
        predicted_anchors.append(predicted)
        residuals.append(
            float(np.hypot(target[0] - predicted[0], target[1] - predicted[1]))
        )

    report.update({
        "applied": True,
        "reason": "ok",
        "raw_shift_x": raw_dx.tolist(),
        "raw_shift_y": raw_dy.tolist(),
        "applied_shift_x": applied_dx.tolist(),
        "applied_shift_y": applied_dy.tolist(),
        "max_abs_shift_x": float(np.max(np.abs(applied_dx))),
        "max_abs_shift_y": float(np.max(np.abs(applied_dy))),
        "target_anchors": [list(x) if x is not None else None for x in target_anchors],
        "generated_anchors": [list(x) if x is not None else None for x in generated_anchors],
        "predicted_stabilized_anchors": [list(x) if x is not None else None for x in predicted_anchors],
        "residual_anchor_rms": float(np.sqrt(np.mean(np.square(residuals)))) if residuals else None,
        "residual_anchor_max": float(np.max(residuals)) if residuals else None,
    })
    return stabilized, report


def render(payload: dict) -> dict:
    if PIPE is None:
        raise RuntimeError("One-to-All is not loaded")

    reference_path = Path(payload["reference_image"])
    pose_dir = Path(payload["pose_dir"])
    output_dir = Path(payload["output_dir"])

    prompt = str(payload.get("prompt", ""))
    seed = int(payload.get("seed", 42))
    requested_frames = int(payload.get("num_frames", 17))
    image_guidance_scale = float(payload.get("image_guidance_scale", 2.5))
    pose_guidance_scale = float(payload.get("pose_guidance_scale", 1.5))
    black_pose_cfg = bool(payload.get("black_pose_cfg", True))
    subject_profile = str(payload.get("subject_profile", "character")).strip().lower()
    if subject_profile not in {"character", "quadruped", "biped_animal"}:
        raise RuntimeError(f"Unsupported subject_profile: {subject_profile}")

    if requested_frames != 17:
        raise RuntimeError("This sprite worker is locked to 17 control frames")

    output_dir.mkdir(parents=True, exist_ok=True)
    pose_dir.mkdir(parents=True, exist_ok=True)

    image_original = Image.open(reference_path).convert("RGB")
    image_input, h, w = resize_for_model(image_original)

    target_frames, geometry_scores, direction = load_control_data(pose_dir)
    payload_direction = payload.get("direction")
    if payload_direction is not None and str(payload_direction) != direction:
        raise RuntimeError(
            f"Direction mismatch: payload={payload_direction} adapter={direction}"
        )
    if len(target_frames) != requested_frames:
        raise RuntimeError(
            f"Expected {requested_frames} pose frames, got {len(target_frames)}"
        )

    human_reference_pose_detector_bypassed = subject_profile != "character"
    ref_candidate = None
    ref_score = None

    if subject_profile == "character":
        # Preserve the V8 production path exactly for human and humanoid sprites.
        ref_rgb = np.array(image_input)
        ref_pose_meta = INFER_UTILS.wanpose2d([ref_rgb])[0]
        ref_dwpose = INFER_UTILS.aaposemeta_to_dwpose(ref_pose_meta)
        ref_candidate, ref_score = _reference_body(ref_dwpose)

        source_pose_img = INFER_UTILS.draw_pose_aligned(
            ref_dwpose,
            h,
            w,
            without_face=True,
        )

        # Keep the Kimodo gait intact and only place it globally on the detected
        # reference body. Per-bone retargeting is intentionally not used.
        target_frames = align_sequence_globally(target_frames, ref_dwpose)
        target_scores = np.clip(geometry_scores.copy(), 0.0, 1.0)

        ref_prior = _visible_reference_prior(ref_score, direction)
        head_joints = np.array([0, 14, 15, 16, 17], dtype=np.int64)
        target_scores[:, head_joints] *= ref_prior[head_joints][None, :]
        major_body = np.arange(1, 14, dtype=np.int64)
        target_scores[:, major_body] = np.maximum(
            target_scores[:, major_body],
            0.78,
        )
    else:
        # V9 animal path: the reference/body detector is trained for people and
        # can turn a four-legged animal into a narrow humanoid. Animal controls
        # already use the reference silhouette box, so do not run the detector,
        # do not globally align to a human body, and use frame zero as image_pose.
        target_scores = np.clip(geometry_scores.copy(), 0.0, 1.0)
        source_pose = body_pose_dict(target_frames[0], target_scores[0])
        source_pose_img = INFER_UTILS.draw_pose_aligned(
            source_pose,
            h,
            w,
            without_face=True,
        )

    imageio.imwrite(pose_dir / "reference_pose.png", source_pose_img)
    source_pose_tensor = (
        torch.from_numpy(source_pose_img)
        .unsqueeze(0)
        .float()
        .permute(0, 3, 1, 2)
        / 255.0
        * 2.0
        - 1.0
    ).unsqueeze(2)

    with (pose_dir / "control_meta.json").open("w", encoding="utf-8") as f:
        json.dump(
            {
                "worker_version": WORKER_VERSION,
                "direction": direction,
                "subject_profile": subject_profile,
                "human_reference_pose_detector_bypassed": human_reference_pose_detector_bypassed,
                "reference_body_score": ref_score.tolist() if ref_score is not None else None,
                "reference_body_candidate": ref_candidate.tolist() if ref_candidate is not None else None,
                "geometry_scores": geometry_scores.tolist(),
                "control_scores": target_scores.tolist(),
                "image_guidance_scale": image_guidance_scale,
                "pose_guidance_scale": pose_guidance_scale,
                "black_pose_cfg": black_pose_cfg,
                "control_endpoint_exact": bool(
                    np.array_equal(target_frames[0], target_frames[-1])
                    and np.array_equal(target_scores[0], target_scores[-1])
                ),
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    control_video = build_control_tensor(
        target_frames,
        target_scores,
        h,
        w,
        pose_dir,
    )
    mask_tensor = torch.zeros((1, 1, 1, h, w), dtype=torch.float32)

    with MODEL_LOCK:
        with torch.inference_mode():
            output = PIPE(
                image=image_input,
                image_mask=mask_tensor,
                control_video=control_video,
                prompt=prompt,
                negative_prompt=negative_prompt_for_direction(
                    direction,
                    subject_profile,
                ),
                height=h,
                width=w,
                num_frames=requested_frames,
                image_guidance_scale=image_guidance_scale,
                pose_guidance_scale=pose_guidance_scale,
                num_inference_steps=30,
                generator=torch.Generator(device=DEVICE).manual_seed(seed),
                black_image_cfg=True,
                black_pose_cfg=black_pose_cfg,
                controlnet_conditioning_scale=1.0,
                return_tensor=True,
                case1=False,
                token_replace=False,
                prev_frames=None,
                image_pose=source_pose_tensor,
            ).frames

        torch.cuda.synchronize()

    output = (output[0].detach().cpu() / 2.0 + 0.5)
    output = output.float().clamp(0, 1).permute(1, 2, 3, 0).numpy()
    output = (output * 255.0).astype(np.uint8)

    if output.shape[0] != requested_frames:
        raise RuntimeError(f"Unexpected generated frame count: {output.shape[0]}")

    raw_dir = output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(output):
        imageio.imwrite(raw_dir / f"frame_{index:03d}.png", frame)

    output, stabilization = stabilize_generated_frames(
        output,
        target_frames,
        target_scores,
        direction,
        subject_profile,
    )

    with (output_dir / "render_meta.json").open("w", encoding="utf-8") as f:
        json.dump(
            {
                "worker_version": WORKER_VERSION,
                "direction": direction,
                "subject_profile": subject_profile,
                "human_reference_pose_detector_bypassed": human_reference_pose_detector_bypassed,
                "seed": seed,
                "num_frames": requested_frames,
                "image_guidance_scale": image_guidance_scale,
                "pose_guidance_scale": pose_guidance_scale,
                "stabilization": stabilization,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    for index, frame in enumerate(output):
        imageio.imwrite(output_dir / f"frame_{index:03d}.png", frame)

    return {
        "status": "ok",
        "worker_version": WORKER_VERSION,
        "direction": direction,
        "subject_profile": subject_profile,
        "human_reference_pose_detector_bypassed": human_reference_pose_detector_bypassed,
        "frames_dir": str(output_dir),
        "num_frames": int(output.shape[0]),
        "height": h,
        "width": w,
        "stabilization": stabilization,
        "allocated_gib": round(torch.cuda.memory_allocated() / 1024**3, 2),
        "reserved_gib": round(torch.cuda.memory_reserved() / 1024**3, 2),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = f"OTAWorker/{WORKER_VERSION}"

    def log_message(self, fmt, *args):
        print("[ota-worker]", fmt % args, flush=True)

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "status": "ready",
                    "version": WORKER_VERSION,
                    "worker_version": WORKER_VERSION,
                    "checkpoint": str(CKPT_PATH),
                    "gpu": torch.cuda.get_device_name(0),
                    "allocated_gib": round(torch.cuda.memory_allocated() / 1024**3, 2),
                    "reserved_gib": round(torch.cuda.memory_reserved() / 1024**3, 2),
                    "capabilities": ["character", "quadruped", "biped_animal"],
                    "animal_human_pose_detector_bypass": True,
                },
            )
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/render":
            self._send_json(404, {"error": "not found"})
            return

        try:
            self._send_json(200, render(self._read_json()))
        except Exception as exc:
            traceback.print_exc()
            self._send_json(
                500,
                {
                    "status": "error",
                    "error": type(exc).__name__,
                    "message": str(exc),
                },
            )


def main():
    load_runtime()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[ota-worker] listening http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
