from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

from .image_features import (
    foreground_soft_mask,
    lab_to_rgb,
    load_rgb,
    rgb_to_lab,
    robust_lab_stats,
)

DIRECTIONS = ("front", "back", "left", "right")
EXPECTED_RENDER_FRAMES = 17
APPEARANCE_VERSION = "8.0.0"


class AppearancePostprocessError(RuntimeError):
    pass


def _collect_frames(directory: Path) -> list[Path]:
    frames = sorted(directory.glob("frame_*.png"))
    if len(frames) != EXPECTED_RENDER_FRAMES:
        raise AppearancePostprocessError(
            f"{directory}: expected {EXPECTED_RENDER_FRAMES} frames, got {len(frames)}"
        )
    return frames


def _sample_lab_pixels(
    rgb: np.ndarray,
    mask: np.ndarray,
    *,
    max_samples: int,
) -> np.ndarray:
    lab = rgb_to_lab(rgb)
    valid = mask >= 0.42
    pixels = lab[valid]
    if len(pixels) == 0:
        return np.empty((0, 3), dtype=np.float32)

    # Keep dark outlines in the palette but prevent them from overwhelming the
    # garment/hair/skin colors that define identity.
    luma = pixels[:, 0]
    mid = pixels[(luma >= 7.0) & (luma <= 97.5)]
    dark = pixels[luma < 7.0]
    bright = pixels[luma > 97.5]
    if len(mid) > 0:
        dark_limit = min(len(dark), max(64, len(mid) // 12))
        bright_limit = min(len(bright), max(64, len(mid) // 12))
        parts = [mid]
        if dark_limit:
            parts.append(dark[np.linspace(0, len(dark) - 1, dark_limit, dtype=np.int64)])
        if bright_limit:
            parts.append(bright[np.linspace(0, len(bright) - 1, bright_limit, dtype=np.int64)])
        pixels = np.concatenate(parts, axis=0)

    if len(pixels) > max_samples:
        indices = np.linspace(0, len(pixels) - 1, max_samples, dtype=np.int64)
        pixels = pixels[indices]
    return pixels.astype(np.float32)


def _palette_metric(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32)
    scale = np.array([0.34, 1.0, 1.0], dtype=np.float32)
    return points * scale


def _deterministic_kmeans(points: np.ndarray, k: int, iterations: int = 18) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32)
    if points.ndim != 2 or points.shape[1] != 3 or len(points) == 0:
        raise AppearancePostprocessError("reference palette has no foreground pixels")
    k = max(2, min(int(k), len(points)))
    metric = _palette_metric(points)

    # Deterministic farthest-point initialization. Start close to the robust
    # median, then repeatedly add the point farthest from existing centers.
    median = np.median(metric, axis=0)
    first = int(np.argmin(np.sum((metric - median) ** 2, axis=1)))
    center_indices = [first]
    min_distance = np.sum((metric - metric[first]) ** 2, axis=1)
    for _ in range(1, k):
        index = int(np.argmax(min_distance))
        center_indices.append(index)
        distance = np.sum((metric - metric[index]) ** 2, axis=1)
        min_distance = np.minimum(min_distance, distance)

    centers = points[np.asarray(center_indices, dtype=np.int64)].copy()
    for _ in range(max(1, int(iterations))):
        center_metric = _palette_metric(centers)
        distances = np.sum(
            (metric[:, None, :] - center_metric[None, :, :]) ** 2,
            axis=2,
        )
        labels = np.argmin(distances, axis=1)
        updated = centers.copy()
        for index in range(k):
            members = points[labels == index]
            if len(members):
                # Median is more stable than mean when antialiased edge colors
                # or a small highlight enters a reference crop.
                updated[index] = np.median(members, axis=0)
        if np.max(np.abs(updated - centers)) < 1e-3:
            centers = updated
            break
        centers = updated

    # Stable ordering makes reports and tests deterministic.
    order = np.lexsort((centers[:, 2], centers[:, 1], centers[:, 0]))
    return centers[order].astype(np.float32)


def build_reference_palette(
    references: dict[str, Path],
    *,
    palette_size: int = 12,
    max_samples_per_direction: int = 14_000,
) -> tuple[np.ndarray, dict[str, dict]]:
    samples = []
    reference_stats: dict[str, dict] = {}
    for direction in DIRECTIONS:
        path = Path(references[direction])
        rgb = load_rgb(path)
        mask, background = foreground_soft_mask(rgb)
        lab = rgb_to_lab(rgb)
        stats = robust_lab_stats(lab, mask)
        stats.update(
            {
                "path": str(path),
                "size": [int(rgb.shape[1]), int(rgb.shape[0])],
                "background_rgb": [float(x) for x in background],
            }
        )
        reference_stats[direction] = stats
        sampled = _sample_lab_pixels(
            rgb,
            mask,
            max_samples=max_samples_per_direction,
        )
        if len(sampled):
            samples.append(sampled)

    if not samples:
        raise AppearancePostprocessError("none of the four references produced a foreground palette")
    points = np.concatenate(samples, axis=0)
    palette = _deterministic_kmeans(points, palette_size)
    return palette, reference_stats


def _nearest_palette(lab: np.ndarray, palette: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    flat = np.asarray(lab, dtype=np.float32).reshape(-1, 3)
    metric = _palette_metric(flat)
    palette_metric = _palette_metric(palette)
    labels = np.empty(len(flat), dtype=np.int16)
    distances = np.empty(len(flat), dtype=np.float32)
    chunk = 32_768
    for start in range(0, len(flat), chunk):
        end = min(len(flat), start + chunk)
        d = np.sum(
            (metric[start:end, None, :] - palette_metric[None, :, :]) ** 2,
            axis=2,
        )
        label = np.argmin(d, axis=1)
        labels[start:end] = label.astype(np.int16)
        distances[start:end] = np.sqrt(d[np.arange(len(label)), label]).astype(np.float32)
    return palette[labels].reshape(lab.shape), distances.reshape(lab.shape[:2])


def _frame_signature(lab: np.ndarray, mask: np.ndarray, palette: np.ndarray) -> dict:
    valid = mask >= 0.42
    if not np.any(valid):
        return {
            "valid": False,
            "foreground_fraction": 0.0,
            "median_lab": [0.0, 0.0, 0.0],
            "palette_distance_mean": 0.0,
            "palette_distance_p95": 0.0,
        }
    values = np.asarray(lab[valid], dtype=np.float32)
    if len(values) > 12_000:
        values = values[np.linspace(0, len(values) - 1, 12_000, dtype=np.int64)]
    median = np.median(values, axis=0)
    metric = _palette_metric(values)
    palette_metric = _palette_metric(palette)
    distance = np.sqrt(
        np.min(
            np.sum((metric[:, None, :] - palette_metric[None, :, :]) ** 2, axis=2),
            axis=1,
        )
    )
    return {
        "valid": True,
        "foreground_fraction": float(np.mean(valid)),
        "median_lab": [float(x) for x in median],
        "palette_distance_mean": float(np.mean(distance)),
        "palette_distance_p95": float(np.percentile(distance, 95.0)),
    }


def _temporal_metrics(signatures: list[dict]) -> dict:
    valid = [item for item in signatures if item.get("valid")]
    if not valid:
        return {
            "valid": False,
            "temporal_chroma_spread": 0.0,
            "temporal_luma_spread": 0.0,
            "mean_palette_distance": 0.0,
            "max_palette_distance_p95": 0.0,
        }
    medians = np.asarray([item["median_lab"] for item in valid], dtype=np.float32)
    center = np.median(medians, axis=0)
    chroma = np.linalg.norm(medians[:, 1:3] - center[None, 1:3], axis=1)
    luma = np.abs(medians[:, 0] - float(center[0]))
    return {
        "valid": True,
        "median_of_frame_medians": [float(x) for x in center],
        "temporal_chroma_spread": float(np.max(chroma)),
        "temporal_chroma_rms": float(np.sqrt(np.mean(chroma**2))),
        "temporal_luma_spread": float(np.max(luma)),
        "temporal_luma_rms": float(np.sqrt(np.mean(luma**2))),
        "mean_palette_distance": float(
            np.mean([item["palette_distance_mean"] for item in valid])
        ),
        "max_palette_distance_p95": float(
            np.max([item["palette_distance_p95"] for item in valid])
        ),
    }


def stabilize_frame(
    rgb: np.ndarray,
    palette: np.ndarray,
    reference_stats: dict,
    *,
    chroma_strength: float,
    brightness_strength: float,
    contrast_strength: float,
    max_delta_e: float,
) -> tuple[np.ndarray, dict]:
    rgb = np.asarray(rgb, dtype=np.uint8)
    mask, background = foreground_soft_mask(rgb)
    lab = rgb_to_lab(rgb)
    before = _frame_signature(lab, mask, palette)
    valid = mask >= 0.42
    if not np.any(valid):
        return rgb.copy(), {
            "applied": False,
            "reason": "foreground_not_found",
            "background_rgb": [float(x) for x in background],
            "before": before,
            "after": before,
            "mean_delta_e": 0.0,
            "p95_delta_e": 0.0,
        }

    target, _ = _nearest_palette(lab, palette)
    corrected = lab.copy()

    # Preserve natural shading while pulling hue/chroma toward the shared
    # four-view reference palette.
    corrected[..., 1:3] = lab[..., 1:3] + float(chroma_strength) * (
        target[..., 1:3] - lab[..., 1:3]
    )

    ref_median = np.asarray(reference_stats.get("median", [50.0, 0.0, 0.0]), dtype=np.float32)
    ref_iqr = max(float(reference_stats.get("iqr_l", 20.0)), 1.0)
    frame_l = lab[..., 0][valid]
    frame_median = float(np.median(frame_l))
    q25, q75 = np.percentile(frame_l, [25.0, 75.0])
    frame_iqr = max(float(q75 - q25), 1.0)

    median_delta = float(np.clip(ref_median[0] - frame_median, -12.0, 12.0))
    desired_gain = float(np.clip(ref_iqr / frame_iqr, 0.86, 1.14))
    gain = 1.0 + float(contrast_strength) * (desired_gain - 1.0)
    corrected[..., 0] = (
        frame_median
        + gain * (lab[..., 0] - frame_median)
        + float(brightness_strength) * median_delta
    )

    # Do not repaint black outlines or near-white highlights aggressively.
    luma = lab[..., 0]
    tone_protection = np.ones_like(luma, dtype=np.float32)
    tone_protection *= np.clip((luma - 4.0) / 18.0, 0.18, 1.0)
    tone_protection *= np.clip((101.0 - luma) / 14.0, 0.35, 1.0)
    blend = np.clip(mask * tone_protection, 0.0, 1.0)

    delta = corrected - lab
    delta_e = np.linalg.norm(delta, axis=-1)
    limiter = np.minimum(1.0, float(max_delta_e) / np.maximum(delta_e, 1e-6))
    corrected = lab + delta * limiter[..., None]
    corrected_rgb = lab_to_rgb(corrected)
    output = np.uint8(
        np.clip(
            rgb.astype(np.float32) * (1.0 - blend[..., None])
            + corrected_rgb.astype(np.float32) * blend[..., None],
            0.0,
            255.0,
        )
        + 0.5
    )

    output_lab = rgb_to_lab(output)
    after = _frame_signature(output_lab, mask, palette)
    applied_delta = np.linalg.norm(output_lab - lab, axis=-1)[valid]
    return output, {
        "applied": True,
        "reason": "ok",
        "background_rgb": [float(x) for x in background],
        "frame_luma_median_before": frame_median,
        "reference_luma_median": float(ref_median[0]),
        "luma_gain": gain,
        "luma_offset": float(brightness_strength) * median_delta,
        "before": before,
        "after": after,
        "mean_delta_e": float(np.mean(applied_delta)),
        "p95_delta_e": float(np.percentile(applied_delta, 95.0)),
        "max_delta_e": float(np.max(applied_delta)),
    }



def _apply_temporal_offset(
    rgb: np.ndarray,
    mask: np.ndarray,
    *,
    target_median_lab: np.ndarray,
    current_median_lab: np.ndarray,
    chroma_strength: float,
    luma_strength: float,
    max_delta_e: float = 5.0,
) -> tuple[np.ndarray, dict]:
    lab = rgb_to_lab(rgb)
    current = np.asarray(current_median_lab, dtype=np.float32)
    target = np.asarray(target_median_lab, dtype=np.float32)
    offset = np.zeros(3, dtype=np.float32)
    offset[0] = float(luma_strength) * float(np.clip(target[0] - current[0], -6.0, 6.0))
    offset[1:3] = float(chroma_strength) * np.clip(target[1:3] - current[1:3], -8.0, 8.0)
    norm = float(np.linalg.norm(offset))
    if norm > max_delta_e:
        offset *= float(max_delta_e) / max(norm, 1e-6)

    luma = lab[..., 0]
    tone_protection = np.ones_like(luma, dtype=np.float32)
    tone_protection *= np.clip((luma - 4.0) / 18.0, 0.18, 1.0)
    tone_protection *= np.clip((101.0 - luma) / 14.0, 0.35, 1.0)
    blend = np.clip(mask * tone_protection, 0.0, 1.0)
    shifted = lab + offset[None, None, :]
    shifted_rgb = lab_to_rgb(shifted)
    output = np.uint8(
        np.clip(
            rgb.astype(np.float32) * (1.0 - blend[..., None])
            + shifted_rgb.astype(np.float32) * blend[..., None],
            0.0,
            255.0,
        )
        + 0.5
    )
    return output, {
        "target_median_lab": [float(x) for x in target],
        "current_median_lab": [float(x) for x in current],
        "requested_offset_lab": [float(x) for x in offset],
        "offset_delta_e": float(np.linalg.norm(offset)),
    }

def stabilize_appearance_attempt(
    rendered_root: Path,
    references: dict[str, Path],
    *,
    enabled: bool = True,
    palette_size: int = 12,
    chroma_strength: float = 0.55,
    brightness_strength: float = 0.18,
    contrast_strength: float = 0.16,
    max_delta_e: float = 14.0,
    temporal_chroma_strength: float = 0.38,
    temporal_luma_strength: float = 0.16,
    max_temporal_chroma_spread: float = 13.0,
    max_temporal_luma_spread: float = 12.0,
    max_mean_correction_delta_e: float = 9.0,
) -> dict:
    """Apply reference-palette stabilization to all 17 rendered frames.

    The OTA worker's translation-stabilized images remain available under each
    direction's ``preappearance/`` directory. Corrected frames replace only the
    top-level ``frame_XXX.png`` files used by phase selection and final packing.
    """

    rendered_root = Path(rendered_root)
    palette, reference_stats = build_reference_palette(
        references,
        palette_size=palette_size,
    )
    palette_rgb = lab_to_rgb(palette.reshape(1, -1, 3))[0]

    report = {
        "version": APPEARANCE_VERSION,
        "enabled": bool(enabled),
        "rendered_root": str(rendered_root),
        "config": {
            "palette_size": int(palette_size),
            "chroma_strength": float(chroma_strength),
            "brightness_strength": float(brightness_strength),
            "contrast_strength": float(contrast_strength),
            "max_delta_e": float(max_delta_e),
            "temporal_chroma_strength": float(temporal_chroma_strength),
            "temporal_luma_strength": float(temporal_luma_strength),
            "max_temporal_chroma_spread": float(max_temporal_chroma_spread),
            "max_temporal_luma_spread": float(max_temporal_luma_spread),
            "max_mean_correction_delta_e": float(max_mean_correction_delta_e),
        },
        "palette_lab": [[float(x) for x in row] for row in palette],
        "palette_rgb": [[int(x) for x in row] for row in palette_rgb],
        "reference_stats": reference_stats,
        "directions": {},
    }

    all_errors: list[str] = []
    direction_scores = []
    for direction in DIRECTIONS:
        directory = rendered_root / direction
        frames = _collect_frames(directory)
        backup = directory / "preappearance"
        backup.mkdir(parents=True, exist_ok=True)

        # Always source V8 processing from the OTA position-stabilized frame,
        # not from a prior V8 output when a report is regenerated.
        source_paths = []
        for frame in frames:
            source = backup / frame.name
            if not source.exists():
                shutil.copy2(frame, source)
            source_paths.append(source)

        before_signatures = []
        first_pass_signatures = []
        frame_reports = []
        first_pass_outputs: list[np.ndarray] = []
        first_pass_masks: list[np.ndarray] = []
        for index, source in enumerate(source_paths):
            rgb = load_rgb(source)
            mask, _ = foreground_soft_mask(rgb)
            before_signature = _frame_signature(rgb_to_lab(rgb), mask, palette)
            if enabled:
                output, frame_report = stabilize_frame(
                    rgb,
                    palette,
                    reference_stats[direction],
                    chroma_strength=chroma_strength,
                    brightness_strength=brightness_strength,
                    contrast_strength=contrast_strength,
                    max_delta_e=max_delta_e,
                )
            else:
                output = rgb.copy()
                frame_report = {
                    "applied": False,
                    "reason": "disabled",
                    "before": before_signature,
                    "after": before_signature,
                    "mean_delta_e": 0.0,
                    "p95_delta_e": 0.0,
                    "max_delta_e": 0.0,
                }
            first_pass_outputs.append(output)
            first_pass_masks.append(mask)
            before_signatures.append(frame_report["before"])
            first_pass_signatures.append(frame_report["after"])
            frame_reports.append({"index": index, **frame_report})

        valid_medians = [
            item["median_lab"]
            for item in first_pass_signatures
            if item.get("valid")
        ]
        temporal_target = (
            np.median(np.asarray(valid_medians, dtype=np.float32), axis=0)
            if valid_medians
            else np.zeros(3, dtype=np.float32)
        )

        after_signatures = []
        for index, (source, output, mask, signature) in enumerate(
            zip(source_paths, first_pass_outputs, first_pass_masks, first_pass_signatures)
        ):
            if enabled and signature.get("valid"):
                output, temporal_report = _apply_temporal_offset(
                    output,
                    mask,
                    target_median_lab=temporal_target,
                    current_median_lab=np.asarray(signature["median_lab"], dtype=np.float32),
                    chroma_strength=temporal_chroma_strength,
                    luma_strength=temporal_luma_strength,
                )
            else:
                temporal_report = {
                    "target_median_lab": [float(x) for x in temporal_target],
                    "current_median_lab": signature.get("median_lab", [0.0, 0.0, 0.0]),
                    "requested_offset_lab": [0.0, 0.0, 0.0],
                    "offset_delta_e": 0.0,
                }

            Image.fromarray(output, mode="RGB").save(directory / f"frame_{index:03d}.png")
            final_mask, _ = foreground_soft_mask(output)
            final_signature = _frame_signature(rgb_to_lab(output), final_mask, palette)
            original = load_rgb(source)
            original_lab = rgb_to_lab(original)
            final_lab = rgb_to_lab(output)
            valid = final_mask >= 0.42
            total_delta = np.linalg.norm(final_lab - original_lab, axis=-1)[valid]
            frame_reports[index]["first_pass_after"] = frame_reports[index].pop("after")
            frame_reports[index]["temporal_alignment"] = temporal_report
            frame_reports[index]["after"] = final_signature
            frame_reports[index]["mean_delta_e"] = (
                float(np.mean(total_delta)) if len(total_delta) else 0.0
            )
            frame_reports[index]["p95_delta_e"] = (
                float(np.percentile(total_delta, 95.0)) if len(total_delta) else 0.0
            )
            frame_reports[index]["max_delta_e"] = (
                float(np.max(total_delta)) if len(total_delta) else 0.0
            )
            after_signatures.append(final_signature)

        before_metrics = _temporal_metrics(before_signatures)
        after_metrics = _temporal_metrics(after_signatures)
        mean_correction = float(
            np.mean([item.get("mean_delta_e", 0.0) for item in frame_reports])
        )
        direction_errors = []
        if enabled and after_metrics["temporal_chroma_spread"] > max_temporal_chroma_spread:
            direction_errors.append(
                f"temporal chroma spread {after_metrics['temporal_chroma_spread']:.3f} "
                f"exceeds {max_temporal_chroma_spread:.3f}"
            )
        if enabled and after_metrics["temporal_luma_spread"] > max_temporal_luma_spread:
            direction_errors.append(
                f"temporal luma spread {after_metrics['temporal_luma_spread']:.3f} "
                f"exceeds {max_temporal_luma_spread:.3f}"
            )
        if enabled and mean_correction > max_mean_correction_delta_e:
            direction_errors.append(
                f"mean correction deltaE {mean_correction:.3f} exceeds "
                f"{max_mean_correction_delta_e:.3f}"
            )

        score = float(
            after_metrics["temporal_chroma_spread"]
            + 0.55 * after_metrics["temporal_luma_spread"]
            + 0.35 * after_metrics["mean_palette_distance"]
            + 0.20 * mean_correction
        )
        direction_scores.append(score)
        direction_report = {
            "ok": not direction_errors,
            "errors": direction_errors,
            "before": before_metrics,
            "after": after_metrics,
            "mean_correction_delta_e": mean_correction,
            "score": score,
            "frames": frame_reports,
        }
        report["directions"][direction] = direction_report
        with (directory / "appearance_meta.json").open("w", encoding="utf-8") as f:
            json.dump(direction_report, f, ensure_ascii=False, indent=2)
        all_errors.extend([f"{direction}: {error}" for error in direction_errors])

    report["ok"] = not all_errors
    report["errors"] = all_errors
    report["score"] = float(np.mean(direction_scores)) if direction_scores else float("inf")
    with (rendered_root / "appearance_qc.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report
