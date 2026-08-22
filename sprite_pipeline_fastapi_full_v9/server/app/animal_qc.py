from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping

import numpy as np
from PIL import Image, ImageFilter

from .subject_profile import DIRECTIONS, foreground_mask

QC_VERSION = "9.0.0-animal-qc"


def _connected_components(mask: np.ndarray) -> tuple[int, float]:
    h, w = mask.shape
    scale = min(1.0, 224.0 / max(h, w))
    if scale < 1.0:
        small = Image.fromarray((mask.astype(np.uint8) * 255), mode="L").resize(
            (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
            Image.Resampling.NEAREST,
        )
        work = np.asarray(small) > 0
    else:
        work = mask.astype(bool, copy=False)

    hh, ww = work.shape
    visited = np.zeros_like(work, dtype=bool)
    sizes: list[int] = []
    for y in range(hh):
        for x in range(ww):
            if not work[y, x] or visited[y, x]:
                continue
            stack = [(y, x)]
            visited[y, x] = True
            size = 0
            while stack:
                cy, cx = stack.pop()
                size += 1
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < hh and 0 <= nx < ww and work[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            sizes.append(size)

    if not sizes:
        return 0, 0.0
    sizes.sort(reverse=True)
    total = float(sum(sizes))
    main = float(sizes[0])
    significant = sum(size >= max(6, int(main * 0.11)) for size in sizes)
    return int(significant), float(main / max(1.0, total))


def _shape_descriptor(mask: np.ndarray, size: int = 48) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return np.zeros((size, size), dtype=np.float32)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    crop = Image.fromarray((mask[y0 : y1 + 1, x0 : x1 + 1].astype(np.uint8) * 255), mode="L")
    # Letterbox into a square descriptor so aspect ratio remains part of shape.
    scale = min(size / max(1, crop.width), size / max(1, crop.height))
    nw = max(1, int(round(crop.width * scale)))
    nh = max(1, int(round(crop.height * scale)))
    resized = crop.resize((nw, nh), Image.Resampling.BILINEAR)
    canvas = Image.new("L", (size, size), 0)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2))
    canvas = canvas.filter(ImageFilter.BoxBlur(1.1))
    return np.asarray(canvas, dtype=np.float32) / 255.0


def image_metrics(path: Path) -> dict:
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image, dtype=np.uint8)
    mask = foreground_mask(image)
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return {
            "path": str(path),
            "empty": True,
            "aspect": 0.0,
            "coverage": 0.0,
            "occupancy": 0.0,
            "center": [0.5, 0.5],
            "ground": 1.0,
            "height_ratio": 0.0,
            "width_ratio": 0.0,
            "component_count": 0,
            "main_component_fraction": 0.0,
            "touches_edge": False,
            "mean_rgb": [255.0, 255.0, 255.0],
            "descriptor": _shape_descriptor(mask),
        }

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bw = max(1, x1 - x0 + 1)
    bh = max(1, y1 - y0 + 1)
    area = int(mask.sum())
    components, main_fraction = _connected_components(mask)
    colors = rgb[mask].astype(np.float32)
    # Trim the lightest quartile so white anti-aliasing does not dominate identity.
    luma = colors.mean(axis=1)
    cutoff = float(np.percentile(luma, 78)) if len(luma) else 255.0
    identity_colors = colors[luma <= cutoff] if np.any(luma <= cutoff) else colors
    mean_rgb = identity_colors.mean(axis=0) if len(identity_colors) else np.array([255.0] * 3)
    edge_margin = max(1, int(round(min(h, w) * 0.008)))
    touches_edge = bool(
        x0 <= edge_margin
        or y0 <= edge_margin
        or x1 >= w - 1 - edge_margin
        or y1 >= h - 1 - edge_margin
    )
    return {
        "path": str(path),
        "empty": False,
        "bbox": [x0, y0, x1, y1],
        "aspect": float(bw / bh),
        "coverage": float(area / max(1, w * h)),
        "occupancy": float(area / max(1, bw * bh)),
        "center": [float((x0 + x1) * 0.5 / w), float((y0 + y1) * 0.5 / h)],
        "ground": float(y1 / max(1, h - 1)),
        "height_ratio": float(bh / h),
        "width_ratio": float(bw / w),
        "component_count": components,
        "main_component_fraction": main_fraction,
        "touches_edge": touches_edge,
        "mean_rgb": mean_rgb.astype(float).tolist(),
        "descriptor": _shape_descriptor(mask),
    }


def _shape_distance(a: dict, b: dict) -> float:
    return float(np.mean(np.abs(np.asarray(a["descriptor"]) - np.asarray(b["descriptor"]))))


def _upper_shape_distance(a: dict, b: dict) -> float:
    aa = np.asarray(a["descriptor"])
    bb = np.asarray(b["descriptor"])
    cutoff = int(round(aa.shape[0] * 0.72))
    return float(np.mean(np.abs(aa[:cutoff] - bb[:cutoff])))


def _color_distance(a: dict, b: dict) -> float:
    delta = np.asarray(a["mean_rgb"], dtype=np.float32) - np.asarray(b["mean_rgb"], dtype=np.float32)
    return float(np.linalg.norm(delta) / np.sqrt(3.0 * 255.0 * 255.0))


def _frame_paths(render_root: Path, direction: str) -> list[Path]:
    directory = render_root / direction
    paths = sorted(directory.glob("frame_*.png"))
    if not paths:
        paths = sorted(directory.glob("[0-9]*.png"), key=lambda p: int(p.stem))
    return paths


def evaluate_animal_render_attempt(
    render_root: Path,
    refs: Mapping[str, Path],
    subject_profile: str,
    *,
    min_frames: int = 8,
) -> dict:
    if subject_profile not in {"quadruped", "biped_animal"}:
        return {
            "version": QC_VERSION,
            "enabled": False,
            "ok": True,
            "subject_profile": subject_profile,
            "errors": [],
            "directions": {},
            "score": 0.0,
        }

    errors: list[str] = []
    direction_reports: dict[str, dict] = {}
    total_score = 0.0

    for direction in DIRECTIONS:
        reference = image_metrics(Path(refs[direction]))
        frame_paths = _frame_paths(Path(render_root), direction)
        if len(frame_paths) < min_frames:
            errors.append(f"{direction}: only {len(frame_paths)} rendered frame(s)")
            direction_reports[direction] = {
                "ok": False,
                "errors": [errors[-1]],
                "reference": _serializable_metrics(reference),
                "frames": [],
            }
            total_score += 10.0
            continue

        frame_metrics = [image_metrics(path) for path in frame_paths]
        dir_errors: list[str] = []
        aspects = np.asarray([m["aspect"] for m in frame_metrics], dtype=np.float32)
        coverages = np.asarray([m["coverage"] for m in frame_metrics], dtype=np.float32)
        height_ratios = np.asarray([m["height_ratio"] for m in frame_metrics], dtype=np.float32)
        width_ratios = np.asarray([m["width_ratio"] for m in frame_metrics], dtype=np.float32)
        component_counts = np.asarray([m["component_count"] for m in frame_metrics], dtype=np.int32)
        main_fractions = np.asarray([m["main_component_fraction"] for m in frame_metrics], dtype=np.float32)
        centers = np.asarray([m["center"] for m in frame_metrics], dtype=np.float32)
        grounds = np.asarray([m["ground"] for m in frame_metrics], dtype=np.float32)
        shape_distances = np.asarray([_shape_distance(reference, m) for m in frame_metrics], dtype=np.float32)
        upper_shape_distances = np.asarray([_upper_shape_distance(reference, m) for m in frame_metrics], dtype=np.float32)
        color_distances = np.asarray([_color_distance(reference, m) for m in frame_metrics], dtype=np.float32)

        ref_aspect = max(0.05, float(reference["aspect"]))
        median_aspect = float(np.median(aspects))
        aspect_ratio = median_aspect / ref_aspect
        area_ratio = float(np.median(coverages) / max(0.002, float(reference["coverage"])))
        height_ratio = float(np.median(height_ratios) / max(0.02, float(reference["height_ratio"])))
        width_ratio = float(np.median(width_ratios) / max(0.02, float(reference["width_ratio"])))
        median_shape = float(np.median(shape_distances))
        median_upper_shape = float(np.median(upper_shape_distances))
        median_color = float(np.median(color_distances))
        max_center_drift = float(np.max(np.linalg.norm(centers - np.asarray(reference["center"]), axis=1)))
        max_ground_drift = float(np.max(np.abs(grounds - float(reference["ground"]))))
        aspect_spread = float(np.percentile(aspects, 95) - np.percentile(aspects, 5))

        if np.any(component_counts > 1):
            dir_errors.append(
                f"duplicate/disconnected subjects in {int(np.sum(component_counts > 1))} frame(s)"
            )
        if float(np.min(main_fractions)) < 0.72:
            dir_errors.append(
                f"body integrity collapsed (main component fraction {float(np.min(main_fractions)):.3f})"
            )
        if any(bool(m["touches_edge"]) for m in frame_metrics):
            dir_errors.append("subject touches or is cropped by the canvas edge")
        if area_ratio < 0.34 or area_ratio > 2.35:
            dir_errors.append(f"foreground area ratio drifted to {area_ratio:.3f}")
        if height_ratio < 0.56 or height_ratio > 1.65:
            dir_errors.append(f"body height ratio drifted to {height_ratio:.3f}")
        if width_ratio < 0.48 or width_ratio > 1.78:
            dir_errors.append(f"body width ratio drifted to {width_ratio:.3f}")
        if aspect_ratio < 0.52 or aspect_ratio > 1.80:
            dir_errors.append(f"reference topology/aspect ratio drifted to {aspect_ratio:.3f}")
        if median_shape > 0.315 and median_upper_shape > 0.285:
            dir_errors.append(
                f"silhouette identity drifted (shape={median_shape:.3f}, upper={median_upper_shape:.3f})"
            )
        if median_color > 0.30:
            dir_errors.append(f"identity palette drifted (normalized RGB distance {median_color:.3f})")
        if max_center_drift > 0.17:
            dir_errors.append(f"subject center drift {max_center_drift:.3f}")
        if max_ground_drift > 0.14:
            dir_errors.append(f"ground baseline drift {max_ground_drift:.3f}")
        if aspect_spread > max(0.38, ref_aspect * 0.42):
            dir_errors.append(f"temporal topology spread {aspect_spread:.3f}")

        if subject_profile == "quadruped":
            if direction in {"left", "right"} and ref_aspect >= 1.04 and median_aspect < 0.90:
                dir_errors.append(
                    f"quadruped humanization: side silhouette became upright ({median_aspect:.3f})"
                )
            if direction in {"front", "back"} and aspect_ratio < 0.64:
                dir_errors.append(
                    f"quadruped humanization: front/back body became too narrow ({aspect_ratio:.3f})"
                )

        seam = None
        if len(frame_metrics) >= 16:
            first = frame_metrics[0]
            last = frame_metrics[-1]
            seam = {
                "shape_distance": _shape_distance(first, last),
                "color_distance": _color_distance(first, last),
                "center_distance": float(
                    np.linalg.norm(np.asarray(first["center"]) - np.asarray(last["center"]))
                ),
                "ground_distance": abs(float(first["ground"]) - float(last["ground"])),
            }
            if seam["shape_distance"] > 0.18:
                dir_errors.append(f"loop shape seam {seam['shape_distance']:.3f}")
            if seam["center_distance"] > 0.045:
                dir_errors.append(f"loop center seam {seam['center_distance']:.3f}")
            if seam["ground_distance"] > 0.035:
                dir_errors.append(f"loop ground seam {seam['ground_distance']:.3f}")
            if seam["color_distance"] > 0.16:
                dir_errors.append(f"loop palette seam {seam['color_distance']:.3f}")

        direction_score = (
            2.2 * abs(np.log(max(0.05, aspect_ratio)))
            + 1.2 * median_shape
            + 0.8 * median_upper_shape
            + 0.7 * median_color
            + 1.0 * max_center_drift
            + 0.8 * max_ground_drift
            + 2.0 * float(np.mean(component_counts > 1))
            + 1.2 * max(0.0, 0.82 - float(np.min(main_fractions)))
        )
        total_score += float(direction_score)
        errors.extend(f"{direction}: {message}" for message in dir_errors)
        direction_reports[direction] = {
            "ok": not dir_errors,
            "errors": dir_errors,
            "reference": _serializable_metrics(reference),
            "metrics": {
                "num_frames": len(frame_metrics),
                "median_aspect": median_aspect,
                "reference_aspect": ref_aspect,
                "aspect_ratio": aspect_ratio,
                "area_ratio": area_ratio,
                "height_ratio": height_ratio,
                "width_ratio": width_ratio,
                "median_shape_distance": median_shape,
                "median_upper_shape_distance": median_upper_shape,
                "median_color_distance": median_color,
                "max_center_drift": max_center_drift,
                "max_ground_drift": max_ground_drift,
                "aspect_spread": aspect_spread,
                "duplicate_frame_count": int(np.sum(component_counts > 1)),
                "minimum_main_component_fraction": float(np.min(main_fractions)),
            },
            "loop_seam": seam,
            "frames": [_serializable_metrics(m) for m in frame_metrics],
            "score": float(direction_score),
        }

    report = {
        "version": QC_VERSION,
        "enabled": True,
        "ok": not errors,
        "subject_profile": subject_profile,
        "errors": errors,
        "directions": direction_reports,
        "score": float(total_score / max(1, len(DIRECTIONS))),
    }
    return report


def _serializable_metrics(metrics: dict) -> dict:
    return {
        key: value
        for key, value in metrics.items()
        if key != "descriptor"
    }


def write_animal_qc(report: dict, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return path
