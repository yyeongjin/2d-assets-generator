from __future__ import annotations

import re
from pathlib import Path
from typing import Mapping

import numpy as np
from PIL import Image

DIRECTIONS = ("front", "back", "left", "right")
VALID_SUBJECT_PROFILES = ("auto", "character", "quadruped", "biped_animal")

_PROFILE_ALIASES = {
    "auto": "auto",
    "human": "character",
    "humanoid": "character",
    "character": "character",
    "person": "character",
    "quadruped": "quadruped",
    "four_legged": "quadruped",
    "four-legged": "quadruped",
    "4leg": "quadruped",
    "4-legged": "quadruped",
    "animal_quadruped": "quadruped",
    "biped": "biped_animal",
    "biped_animal": "biped_animal",
    "biped-animal": "biped_animal",
    "creature_biped": "biped_animal",
}

_QUADRUPED_TERMS = {
    "quadruped", "four legged", "four-legged", "4-legged", "4 legged",
    "dog", "puppy", "wolf", "fox", "coyote", "cat", "kitten", "tiger",
    "lion", "panther", "cow", "cattle", "bull", "ox", "pig", "boar",
    "sheep", "goat", "horse", "pony", "donkey", "deer", "elk", "moose",
    "rabbit", "hare", "bear", "raccoon", "hippo", "rhino", "elephant",
    "camel", "alpaca", "llama", "zebra", "giraffe", "mouse", "rat",
    "개", "강아지", "늑대", "여우", "고양이", "호랑이", "사자", "소",
    "황소", "돼지", "멧돼지", "양", "염소", "말", "사슴", "토끼",
    "곰", "코끼리", "낙타", "기린", "쥐", "4족", "사족", "네발",
}

_BIPED_ANIMAL_TERMS = {
    "biped animal", "biped creature", "two-legged creature", "two legged creature",
    "dinosaur", "raptor", "t-rex", "trex", "theropod", "penguin", "bird",
    "duck", "goose", "chicken", "rooster", "ostrich", "owl", "lizard man",
    "upright lizard", "frog man", "toad", "kobold", "murloc", "avian",
    "공룡", "랩터", "티라노", "펭귄", "새", "오리", "거위", "닭",
    "타조", "올빼미", "직립 도마뱀", "이족", "두발 생명체",
}

_GENERIC_ANIMAL_TERMS = {
    "animal", "creature", "monster", "beast", "pet", "wildlife", "nonhuman",
    "non-human", "reptile", "amphibian", "dragon", "blob creature",
    "동물", "생명체", "몬스터", "괴물", "짐승", "비인간", "파충류", "용",
}


def normalize_subject_profile(value: str | None) -> str:
    normalized = (value or "auto").strip().lower().replace(" ", "_")
    profile = _PROFILE_ALIASES.get(normalized)
    if profile is None:
        allowed = ", ".join(VALID_SUBJECT_PROFILES)
        raise ValueError(f"subject_profile must be one of: {allowed}")
    return profile


def _contains_term(text: str, term: str) -> bool:
    if re.search(r"[가-힣]", term):
        return term in text
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text) is not None


def _matched_terms(text: str, terms: set[str]) -> list[str]:
    return sorted(term for term in terms if _contains_term(text, term))


def foreground_mask(image: Image.Image) -> np.ndarray:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    if int(alpha.min()) < 250:
        mask = alpha > 20
        if np.any(mask):
            return mask

    rgb = rgba[..., :3].astype(np.float32)
    h, w = rgb.shape[:2]
    border = np.concatenate(
        [rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]],
        axis=0,
    )
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb - background[None, None, :], axis=-1)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

    border_distance = np.linalg.norm(border - background[None, :], axis=-1)
    adaptive = float(np.percentile(border_distance, 98)) + 12.0
    threshold = float(np.clip(adaptive, 18.0, 46.0))
    mask = distance > threshold

    # Light neutral drop-shadows should not define the animal's geometry.
    neutral_shadow = (chroma < 13.0) & (luma > 202.0)
    mask &= ~neutral_shadow

    # Keep dark outlines even when a nearly-black border made the adaptive
    # threshold conservative.
    if float(background.mean()) > 220.0:
        mask |= luma < 188.0

    if not np.any(mask):
        mask = distance > max(8.0, threshold * 0.5)
    return mask


def silhouette_metrics(path: Path) -> dict[str, float | list[float] | list[int]]:
    image = Image.open(path)
    mask = foreground_mask(image)
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return {
            "width": float(w),
            "height": float(h),
            "bbox": [0, 0, w - 1, h - 1],
            "bbox_width": float(w),
            "bbox_height": float(h),
            "aspect": float(w / max(1, h)),
            "coverage": 0.0,
            "occupancy": 0.0,
            "center": [0.5, 0.5],
            "ground": 1.0,
        }

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bw = max(1, x1 - x0 + 1)
    bh = max(1, y1 - y0 + 1)
    area = int(mask.sum())
    return {
        "width": float(w),
        "height": float(h),
        "bbox": [x0, y0, x1, y1],
        "bbox_width": float(bw),
        "bbox_height": float(bh),
        "aspect": float(bw / bh),
        "coverage": float(area / max(1, w * h)),
        "occupancy": float(area / max(1, bw * bh)),
        "center": [float((x0 + x1) * 0.5 / w), float((y0 + y1) * 0.5 / h)],
        "ground": float(y1 / max(1, h - 1)),
    }


def classify_subject(
    requested_profile: str | None,
    prompt: str,
    refs: Mapping[str, Path],
) -> dict:
    requested = normalize_subject_profile(requested_profile)
    text = (prompt or "").strip().lower()
    metrics = {
        direction: silhouette_metrics(Path(refs[direction]))
        for direction in DIRECTIONS
        if direction in refs
    }

    quad_hits = _matched_terms(text, _QUADRUPED_TERMS)
    biped_hits = _matched_terms(text, _BIPED_ANIMAL_TERMS)
    generic_hits = _matched_terms(text, _GENERIC_ANIMAL_TERMS)

    side_aspects = [
        float(metrics[d]["aspect"])
        for d in ("left", "right")
        if d in metrics
    ]
    front_aspects = [
        float(metrics[d]["aspect"])
        for d in ("front", "back")
        if d in metrics
    ]
    side_aspect = float(np.median(side_aspects)) if side_aspects else 0.0
    front_aspect = float(np.median(front_aspects)) if front_aspects else 0.0

    if requested != "auto":
        resolved = requested
        reason = "explicit_profile"
    elif quad_hits:
        resolved = "quadruped"
        reason = "quadruped_prompt_keyword"
    elif biped_hits:
        resolved = "biped_animal"
        reason = "biped_animal_prompt_keyword"
    elif generic_hits:
        if side_aspect >= 1.08 or (side_aspect >= 0.98 and front_aspect >= 0.90):
            resolved = "quadruped"
            reason = "generic_animal_plus_wide_side_silhouette"
        else:
            resolved = "biped_animal"
            reason = "generic_animal_plus_upright_silhouette"
    else:
        resolved = "character"
        reason = "character_default"

    return {
        "requested_profile": requested,
        "resolved_profile": resolved,
        "reason": reason,
        "prompt_matches": {
            "quadruped": quad_hits,
            "biped_animal": biped_hits,
            "generic_animal": generic_hits,
        },
        "aggregate_geometry": {
            "side_aspect": side_aspect,
            "front_back_aspect": front_aspect,
        },
        "reference_geometry": metrics,
    }
