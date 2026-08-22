from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

from .image_features import (
    foreground_geometry,
    foreground_soft_mask,
    load_rgb,
    rgb_to_lab,
    robust_lab_stats,
)

DIRECTIONS = ("front", "back", "left", "right")
EXPECTED_RENDER_FRAMES = 17
FINAL_FRAMES = 8
LOOP_VERSION = "8.0.0"

# All candidates preserve two control-phase steps between neighboring sprite
# frames. ``even_end`` replaces One-to-All's reference-anchored frame 0 with
# frame 16, which receives the exact same phase-zero driving control.
PHASE_CANDIDATES: dict[str, tuple[int, ...]] = {
    "even_start": (0, 2, 4, 6, 8, 10, 12, 14),
    "odd": (1, 3, 5, 7, 9, 11, 13, 15),
    "even_end": (16, 2, 4, 6, 8, 10, 12, 14),
}


class LoopPostprocessError(RuntimeError):
    pass


def collect_frames(directory: Path) -> list[Path]:
    frames = sorted(directory.glob("frame_*.png"))
    if len(frames) != EXPECTED_RENDER_FRAMES:
        raise LoopPostprocessError(
            f"{directory.name}: expected {EXPECTED_RENDER_FRAMES} rendered frames, got {len(frames)}"
        )
    return frames


def _load_feature(path: Path, size: int = 96) -> dict:
    native = load_rgb(path)
    mask, _ = foreground_soft_mask(native)
    geometry = foreground_geometry(native, mask).as_dict()
    lab_stats = robust_lab_stats(rgb_to_lab(native), mask)

    image = Image.fromarray(native, mode="RGB").resize(
        (size, size),
        Image.Resampling.BILINEAR,
    )
    rgb = np.asarray(image, dtype=np.float32) / 255.0
    luma = (
        0.299 * rgb[..., 0]
        + 0.587 * rgb[..., 1]
        + 0.114 * rgb[..., 2]
    ).astype(np.float32)

    gx = np.zeros_like(luma)
    gy = np.zeros_like(luma)
    gx[:, 1:] = np.abs(luma[:, 1:] - luma[:, :-1])
    gy[1:, :] = np.abs(luma[1:, :] - luma[:-1, :])
    edge = np.sqrt(gx * gx + gy * gy).astype(np.float32)

    # A soft center weight keeps a fixed background from dominating while still
    # retaining hats, feet, and side-view limb silhouettes near the canvas edge.
    axis = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    xx, yy = np.meshgrid(axis, axis)
    weight = np.exp(-0.55 * (xx * xx + yy * yy)).astype(np.float32)
    weight /= np.mean(weight)

    return {
        "rgb": rgb,
        "luma": luma,
        "edge": edge,
        "weight": weight,
        "geometry": geometry,
        "median_lab": lab_stats.get("median", [0.0, 0.0, 0.0]),
    }


def _transition_cost(a: dict, b: dict) -> float:
    weight = a["weight"]
    luma = float(np.mean(np.abs(a["luma"] - b["luma"]) * weight))
    edge = float(np.mean(np.abs(a["edge"] - b["edge"]) * weight))
    rgb = float(np.mean(np.abs(a["rgb"] - b["rgb"]) * weight[..., None]))
    color_delta_e = float(
        np.linalg.norm(
            np.asarray(a["median_lab"], dtype=np.float32)
            - np.asarray(b["median_lab"], dtype=np.float32)
        )
    )
    color_term = min(color_delta_e / 30.0, 1.0)
    return float(0.44 * luma + 0.31 * edge + 0.15 * rgb + 0.10 * color_term)


def _geometry_transition(a: dict, b: dict) -> dict:
    ga = a["geometry"]
    gb = b["geometry"]
    if not ga.get("valid") or not gb.get("valid"):
        return {
            "valid": False,
            "centroid_px": None,
            "centroid_ratio": None,
            "ground_px": None,
            "ground_ratio": None,
            "height_px": None,
            "height_ratio": None,
            "area_relative": None,
            "color_delta_e": None,
        }

    width = max(1.0, float(min(ga["width"], gb["width"])))
    height = max(1.0, float(min(ga["height"], gb["height"])))
    min_dimension = min(width, height)
    centroid_px = float(
        np.hypot(
            float(ga["centroid_x"]) - float(gb["centroid_x"]),
            float(ga["centroid_y"]) - float(gb["centroid_y"]),
        )
    )
    ground_px = abs(float(ga["ground_y"]) - float(gb["ground_y"]))
    height_px = abs(float(ga["bbox_height"]) - float(gb["bbox_height"]))
    area_a = max(float(ga["area_pixels"]), 1.0)
    area_b = max(float(gb["area_pixels"]), 1.0)
    area_relative = abs(area_a - area_b) / max(0.5 * (area_a + area_b), 1.0)
    color_delta_e = float(
        np.linalg.norm(
            np.asarray(a["median_lab"], dtype=np.float32)
            - np.asarray(b["median_lab"], dtype=np.float32)
        )
    )
    return {
        "valid": True,
        "centroid_px": centroid_px,
        "centroid_ratio": centroid_px / min_dimension,
        "ground_px": ground_px,
        "ground_ratio": ground_px / height,
        "height_px": height_px,
        "height_ratio": height_px / height,
        "area_relative": float(area_relative),
        "color_delta_e": color_delta_e,
    }


def _series_summary(values: list[float | None]) -> dict:
    finite = np.asarray([float(x) for x in values if x is not None], dtype=np.float32)
    if len(finite) != FINAL_FRAMES:
        return {
            "valid": False,
            "values": [None if x is None else float(x) for x in values],
            "internal_median": None,
            "internal_mean": None,
            "seam": None,
            "seam_ratio": None,
        }
    internal = finite[:-1]
    seam = float(finite[-1])
    median = float(np.median(internal))
    return {
        "valid": True,
        "values": [float(x) for x in finite],
        "internal_median": median,
        "internal_mean": float(np.mean(internal)),
        "seam": seam,
        "seam_ratio": float(seam / max(median, 1e-6)),
    }


def _direction_candidate_metrics(
    features: list[dict],
    indices: tuple[int, ...],
) -> dict:
    selected = [features[index] for index in indices]
    costs = [
        _transition_cost(selected[index], selected[(index + 1) % FINAL_FRAMES])
        for index in range(FINAL_FRAMES)
    ]
    geometry_transitions = [
        _geometry_transition(selected[index], selected[(index + 1) % FINAL_FRAMES])
        for index in range(FINAL_FRAMES)
    ]

    internal = np.asarray(costs[:-1], dtype=np.float32)
    seam = float(costs[-1])
    median_internal = float(np.median(internal))
    mean_internal = float(np.mean(internal))
    denominator = max(median_internal, 1e-5)
    seam_ratio = seam / denominator
    transition_ratios = np.asarray(costs, dtype=np.float32) / denominator
    max_transition_ratio = float(np.max(transition_ratios))
    first_transition_ratio = float(transition_ratios[0])
    coefficient_of_variation = float(
        np.std(costs) / max(float(np.mean(costs)), 1e-5)
    )

    geometry = {
        name: _series_summary([item[name] for item in geometry_transitions])
        for name in (
            "centroid_px",
            "centroid_ratio",
            "ground_px",
            "ground_ratio",
            "height_px",
            "height_ratio",
            "area_relative",
            "color_delta_e",
        )
    }

    return {
        "transition_costs": [float(x) for x in costs],
        "median_internal_cost": median_internal,
        "mean_internal_cost": mean_internal,
        "seam_cost": seam,
        "seam_ratio": float(seam_ratio),
        "max_transition_ratio": max_transition_ratio,
        "first_transition_ratio": first_transition_ratio,
        "coefficient_of_variation": coefficient_of_variation,
        "geometry_transitions": geometry_transitions,
        "geometry": geometry,
    }


def evaluate_candidate(
    features_by_direction: dict[str, list[dict]],
    name: str,
    indices: tuple[int, ...],
    max_seam_ratio: float,
    max_transition_ratio: float,
    max_mean_seam_ratio: float,
    max_front_back_centroid_seam_ratio: float,
    max_front_back_ground_seam_ratio: float,
    max_front_back_height_seam_ratio: float,
    max_color_seam_delta_e: float,
) -> dict:
    directions = {
        direction: _direction_candidate_metrics(features_by_direction[direction], indices)
        for direction in DIRECTIONS
    }

    seam_ratios = np.asarray(
        [directions[direction]["seam_ratio"] for direction in DIRECTIONS],
        dtype=np.float32,
    )
    max_ratios = np.asarray(
        [directions[direction]["max_transition_ratio"] for direction in DIRECTIONS],
        dtype=np.float32,
    )
    first_ratios = np.asarray(
        [directions[direction]["first_transition_ratio"] for direction in DIRECTIONS],
        dtype=np.float32,
    )
    cvs = np.asarray(
        [directions[direction]["coefficient_of_variation"] for direction in DIRECTIONS],
        dtype=np.float32,
    )
    absolute_costs = np.asarray(
        [directions[direction]["seam_cost"] for direction in DIRECTIONS],
        dtype=np.float32,
    )
    color_seams = np.asarray(
        [
            directions[direction]["geometry"]["color_delta_e"]["seam"]
            if directions[direction]["geometry"]["color_delta_e"]["valid"]
            else max_color_seam_delta_e * 2.0
            for direction in DIRECTIONS
        ],
        dtype=np.float32,
    )
    front_back_centroid = np.asarray(
        [
            directions[direction]["geometry"]["centroid_ratio"]["seam"]
            if directions[direction]["geometry"]["centroid_ratio"]["valid"]
            else max_front_back_centroid_seam_ratio * 2.0
            for direction in ("front", "back")
        ],
        dtype=np.float32,
    )
    front_back_ground = np.asarray(
        [
            directions[direction]["geometry"]["ground_ratio"]["seam"]
            if directions[direction]["geometry"]["ground_ratio"]["valid"]
            else max_front_back_ground_seam_ratio * 2.0
            for direction in ("front", "back")
        ],
        dtype=np.float32,
    )

    worst_seam = float(np.max(seam_ratios))
    mean_seam = float(np.mean(seam_ratios))
    worst_transition = float(np.max(max_ratios))
    score = float(
        np.mean(seam_ratios)
        + 0.45 * np.max(seam_ratios)
        + 0.30 * np.mean(max_ratios)
        + 0.10 * np.mean(first_ratios)
        + 0.08 * np.mean(cvs)
        + 2.0 * np.mean(absolute_costs)
        + 12.0 * np.mean(front_back_centroid)
        + 7.0 * np.mean(front_back_ground)
        + 0.025 * np.mean(color_seams)
    )

    errors = []
    if worst_seam > max_seam_ratio:
        errors.append(
            f"worst direction seam ratio {worst_seam:.3f} exceeds {max_seam_ratio:.3f}"
        )
    if mean_seam > max_mean_seam_ratio:
        errors.append(
            f"mean seam ratio {mean_seam:.3f} exceeds {max_mean_seam_ratio:.3f}"
        )
    if worst_transition > max_transition_ratio:
        errors.append(
            f"worst transition ratio {worst_transition:.3f} exceeds {max_transition_ratio:.3f}"
        )

    for direction in ("front", "back"):
        geometry = directions[direction]["geometry"]
        centroid = geometry["centroid_ratio"]
        ground = geometry["ground_ratio"]
        height = geometry["height_ratio"]
        if not centroid["valid"] or centroid["seam"] > max_front_back_centroid_seam_ratio:
            value = None if not centroid["valid"] else float(centroid["seam"])
            errors.append(
                f"{direction} centroid seam ratio {value} exceeds "
                f"{max_front_back_centroid_seam_ratio:.4f}"
            )
        if not ground["valid"] or ground["seam"] > max_front_back_ground_seam_ratio:
            value = None if not ground["valid"] else float(ground["seam"])
            errors.append(
                f"{direction} ground seam ratio {value} exceeds "
                f"{max_front_back_ground_seam_ratio:.4f}"
            )
        if not height["valid"] or height["seam"] > max_front_back_height_seam_ratio:
            value = None if not height["valid"] else float(height["seam"])
            errors.append(
                f"{direction} height seam ratio {value} exceeds "
                f"{max_front_back_height_seam_ratio:.4f}"
            )

    for direction in DIRECTIONS:
        color = directions[direction]["geometry"]["color_delta_e"]
        if not color["valid"] or color["seam"] > max_color_seam_delta_e:
            value = None if not color["valid"] else float(color["seam"])
            errors.append(
                f"{direction} color seam deltaE {value} exceeds {max_color_seam_delta_e:.3f}"
            )

    return {
        "name": name,
        "indices": list(indices),
        "ok": not errors,
        "errors": errors,
        "score": score,
        "worst_seam_ratio": worst_seam,
        "mean_seam_ratio": mean_seam,
        "worst_transition_ratio": worst_transition,
        "directions": directions,
    }


def evaluate_render_attempt(
    rendered_root: Path,
    *,
    max_seam_ratio: float = 1.45,
    max_transition_ratio: float = 2.25,
    max_mean_seam_ratio: float = 1.20,
    max_front_back_centroid_seam_ratio: float = 0.011,
    max_front_back_ground_seam_ratio: float = 0.011,
    max_front_back_height_seam_ratio: float = 0.025,
    max_color_seam_delta_e: float = 12.0,
) -> dict:
    rendered_root = Path(rendered_root)
    frames_by_direction = {
        direction: collect_frames(rendered_root / direction)
        for direction in DIRECTIONS
    }
    features_by_direction = {
        direction: [_load_feature(path) for path in frames]
        for direction, frames in frames_by_direction.items()
    }

    candidates = [
        evaluate_candidate(
            features_by_direction,
            name,
            indices,
            max_seam_ratio,
            max_transition_ratio,
            max_mean_seam_ratio,
            max_front_back_centroid_seam_ratio,
            max_front_back_ground_seam_ratio,
            max_front_back_height_seam_ratio,
            max_color_seam_delta_e,
        )
        for name, indices in PHASE_CANDIDATES.items()
    ]
    candidates.sort(key=lambda item: (not item["ok"], item["score"], item["name"]))
    selected = candidates[0]

    return {
        "version": LOOP_VERSION,
        "ok": bool(selected["ok"]),
        "errors": list(selected["errors"]),
        "rendered_root": str(rendered_root),
        "thresholds": {
            "max_seam_ratio": float(max_seam_ratio),
            "max_transition_ratio": float(max_transition_ratio),
            "max_mean_seam_ratio": float(max_mean_seam_ratio),
            "max_front_back_centroid_seam_ratio": float(
                max_front_back_centroid_seam_ratio
            ),
            "max_front_back_ground_seam_ratio": float(
                max_front_back_ground_seam_ratio
            ),
            "max_front_back_height_seam_ratio": float(
                max_front_back_height_seam_ratio
            ),
            "max_color_seam_delta_e": float(max_color_seam_delta_e),
        },
        "selected_candidate": selected["name"],
        "selected_phase_indices": selected["indices"],
        "selected_score": selected["score"],
        "selected_metrics": selected,
        "candidates": candidates,
    }


def write_report(report: dict, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return path


def copy_selected_frames(
    rendered_root: Path,
    result_root: Path,
    indices: list[int] | tuple[int, ...],
) -> None:
    rendered_root = Path(rendered_root)
    result_root = Path(result_root)
    if len(indices) != FINAL_FRAMES:
        raise LoopPostprocessError(f"expected {FINAL_FRAMES} selected indices, got {len(indices)}")

    for direction in DIRECTIONS:
        frames = collect_frames(rendered_root / direction)
        destination = result_root / direction
        destination.mkdir(parents=True, exist_ok=True)
        for output_index, source_index in enumerate(indices):
            shutil.copy2(frames[int(source_index)], destination / f"{output_index}.png")
