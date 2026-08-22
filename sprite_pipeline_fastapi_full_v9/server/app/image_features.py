from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


@dataclass(frozen=True)
class ForegroundGeometry:
    valid: bool
    width: int
    height: int
    foreground_fraction: float
    centroid_x: float | None
    centroid_y: float | None
    ground_y: float | None
    top_y: float | None
    bbox_width: float | None
    bbox_height: float | None
    area_pixels: float
    background_rgb: tuple[float, float, float]

    def as_dict(self) -> dict:
        return {
            "valid": self.valid,
            "width": self.width,
            "height": self.height,
            "foreground_fraction": self.foreground_fraction,
            "centroid_x": self.centroid_x,
            "centroid_y": self.centroid_y,
            "ground_y": self.ground_y,
            "top_y": self.top_y,
            "bbox_width": self.bbox_width,
            "bbox_height": self.bbox_height,
            "area_pixels": self.area_pixels,
            "background_rgb": list(self.background_rgb),
        }


def load_rgb(path: Path | str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


def estimate_background_rgb(rgb: np.ndarray, border_fraction: float = 0.035) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float32)
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("RGB image must have shape [H,W,3]")
    h, w = rgb.shape[:2]
    band = max(2, int(round(min(h, w) * float(border_fraction))))
    border = np.concatenate(
        [
            rgb[:band].reshape(-1, 3),
            rgb[-band:].reshape(-1, 3),
            rgb[:, :band].reshape(-1, 3),
            rgb[:, -band:].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(border, axis=0).astype(np.float32)


def foreground_soft_mask(
    rgb: np.ndarray,
    *,
    inner_distance: float | None = None,
    feather_distance: float = 24.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Estimate a soft foreground mask for clean sprite/reference canvases.

    The background is inferred from the image border. The returned mask is
    deliberately conservative near antialiased edges, then lightly dilated and
    blurred with Pillow so color correction does not leave a bright fringe.
    """

    rgb_u8 = np.asarray(rgb, dtype=np.uint8)
    rgb_f = rgb_u8.astype(np.float32)
    h, w = rgb_u8.shape[:2]
    background = estimate_background_rgb(rgb_u8)

    distance = np.linalg.norm(rgb_f - background[None, None, :], axis=-1)
    border_band = max(2, int(round(min(h, w) * 0.035)))
    border_distance = np.concatenate(
        [
            distance[:border_band].reshape(-1),
            distance[-border_band:].reshape(-1),
            distance[:, :border_band].reshape(-1),
            distance[:, -border_band:].reshape(-1),
        ]
    )
    noise_floor = float(np.percentile(border_distance, 97.5)) if border_distance.size else 0.0
    if inner_distance is None:
        inner = max(9.0, noise_floor + 4.0)
    else:
        inner = float(inner_distance)
    outer = max(inner + 4.0, inner + float(feather_distance))

    soft = np.clip((distance - inner) / max(outer - inner, 1e-6), 0.0, 1.0)

    # Near-white backgrounds occasionally contain tiny compression ripples.
    # A luma contrast term suppresses those while preserving pale clothing.
    luma = 0.2126 * rgb_f[..., 0] + 0.7152 * rgb_f[..., 1] + 0.0722 * rgb_f[..., 2]
    bg_luma = float(0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2])
    if bg_luma >= 205.0:
        contrast = np.clip((bg_luma - luma - 3.0) / 18.0, 0.0, 1.0)
        soft = np.maximum(soft, contrast * 0.72)

    mask_image = Image.fromarray(np.uint8(np.clip(soft, 0.0, 1.0) * 255.0), mode="L")
    mask_image = mask_image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.15))
    soft = np.asarray(mask_image, dtype=np.float32) / 255.0

    # If the inferred mask is implausible, use a direct high-contrast fallback.
    hard_fraction = float(np.mean(soft >= 0.40))
    if hard_fraction < 0.004 or hard_fraction > 0.82:
        fallback_inner = max(11.0, noise_floor + 7.0)
        fallback = np.clip((distance - fallback_inner) / 22.0, 0.0, 1.0)
        mask_image = Image.fromarray(np.uint8(fallback * 255.0), mode="L")
        mask_image = mask_image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
        soft = np.asarray(mask_image, dtype=np.float32) / 255.0

    return np.clip(soft, 0.0, 1.0).astype(np.float32), background


def foreground_geometry(rgb: np.ndarray, mask: np.ndarray | None = None) -> ForegroundGeometry:
    rgb_u8 = np.asarray(rgb, dtype=np.uint8)
    h, w = rgb_u8.shape[:2]
    if mask is None:
        mask, background = foreground_soft_mask(rgb_u8)
    else:
        mask = np.asarray(mask, dtype=np.float32)
        background = estimate_background_rgb(rgb_u8)

    hard = mask >= 0.38
    fraction = float(np.mean(hard))
    if fraction < 0.004:
        return ForegroundGeometry(
            valid=False,
            width=w,
            height=h,
            foreground_fraction=fraction,
            centroid_x=None,
            centroid_y=None,
            ground_y=None,
            top_y=None,
            bbox_width=None,
            bbox_height=None,
            area_pixels=0.0,
            background_rgb=tuple(float(x) for x in background),
        )

    yy, xx = np.nonzero(hard)
    weights = np.clip(mask[yy, xx], 0.05, 1.0).astype(np.float64)
    weight_sum = float(np.sum(weights))
    centroid_x = float(np.sum(xx * weights) / max(weight_sum, 1e-8))
    centroid_y = float(np.sum(yy * weights) / max(weight_sum, 1e-8))

    # Robust percentiles ignore one-pixel antialiasing specks.
    top_y = float(np.percentile(yy, 0.4))
    ground_y = float(np.percentile(yy, 99.6))
    left_x = float(np.percentile(xx, 0.4))
    right_x = float(np.percentile(xx, 99.6))
    bbox_width = max(0.0, right_x - left_x + 1.0)
    bbox_height = max(0.0, ground_y - top_y + 1.0)

    return ForegroundGeometry(
        valid=True,
        width=w,
        height=h,
        foreground_fraction=fraction,
        centroid_x=centroid_x,
        centroid_y=centroid_y,
        ground_y=ground_y,
        top_y=top_y,
        bbox_width=bbox_width,
        bbox_height=bbox_height,
        area_pixels=float(np.sum(mask)),
        background_rgb=tuple(float(x) for x in background),
    )


def _srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float32)
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float32)
    return np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.maximum(rgb, 0.0) ** (1.0 / 2.4) - 0.055)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """Convert uint8/float RGB to CIE Lab (D65)."""
    arr = np.asarray(rgb, dtype=np.float32)
    if arr.max(initial=0.0) > 1.5:
        arr = arr / 255.0
    arr = np.clip(arr, 0.0, 1.0)
    linear = _srgb_to_linear(arr)
    matrix = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ],
        dtype=np.float32,
    )
    xyz = linear @ matrix.T
    white = np.array([0.95047, 1.00000, 1.08883], dtype=np.float32)
    scaled = xyz / white
    delta = 6.0 / 29.0
    f = np.where(
        scaled > delta**3,
        np.cbrt(np.maximum(scaled, 0.0)),
        scaled / (3.0 * delta**2) + 4.0 / 29.0,
    )
    l = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return np.stack([l, a, b], axis=-1).astype(np.float32)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    """Convert CIE Lab (D65) to uint8 RGB."""
    lab = np.asarray(lab, dtype=np.float32)
    fy = (lab[..., 0] + 16.0) / 116.0
    fx = fy + lab[..., 1] / 500.0
    fz = fy - lab[..., 2] / 200.0
    delta = 6.0 / 29.0

    def inv_f(value: np.ndarray) -> np.ndarray:
        return np.where(value > delta, value**3, 3.0 * delta**2 * (value - 4.0 / 29.0))

    white = np.array([0.95047, 1.00000, 1.08883], dtype=np.float32)
    xyz = np.stack([inv_f(fx), inv_f(fy), inv_f(fz)], axis=-1) * white
    inv_matrix = np.array(
        [
            [3.2404542, -1.5371385, -0.4985314],
            [-0.9692660, 1.8760108, 0.0415560],
            [0.0556434, -0.2040259, 1.0572252],
        ],
        dtype=np.float32,
    )
    linear = xyz @ inv_matrix.T
    srgb = _linear_to_srgb(linear)
    return np.uint8(np.clip(srgb, 0.0, 1.0) * 255.0 + 0.5)


def robust_lab_stats(lab: np.ndarray, mask: np.ndarray) -> dict[str, float | list[float]]:
    lab = np.asarray(lab, dtype=np.float32)
    mask = np.asarray(mask, dtype=np.float32)
    valid = mask >= 0.40
    if not np.any(valid):
        return {
            "valid": False,
            "median": [0.0, 0.0, 0.0],
            "iqr_l": 0.0,
            "foreground_fraction": 0.0,
        }
    pixels = lab[valid]
    median = np.median(pixels, axis=0)
    q25, q75 = np.percentile(pixels[:, 0], [25.0, 75.0])
    return {
        "valid": True,
        "median": [float(x) for x in median],
        "iqr_l": float(max(q75 - q25, 1e-4)),
        "foreground_fraction": float(np.mean(valid)),
    }
