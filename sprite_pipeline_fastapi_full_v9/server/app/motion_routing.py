from __future__ import annotations

import hashlib
import io
import os
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

DIRECTIONS = ("front", "back", "left", "right")
VALID_MOTION_BACKENDS = ("auto", "kimodo", "animal_procedural", "animal_npz")
SUPPORTED_ANIMAL_NPZ_SCHEMAS = ("animal-motion-v1",)


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError:
        value = default
    return max(minimum, min(value, maximum))


def _motion_npz_size_limit() -> int:
    raw = os.environ.get("SPRITE_ANIMAL_MOTION_NPZ_MAX_BYTES", "67108864")
    try:
        value = int(raw)
    except ValueError:
        value = 64 * 1024 * 1024
    return max(1 * 1024 * 1024, min(value, 512 * 1024 * 1024))


MAX_ANIMAL_NPZ_SIZE = _motion_npz_size_limit()
MAX_ANIMAL_NPZ_UNCOMPRESSED_SIZE = _bounded_env_int(
    "SPRITE_ANIMAL_MOTION_NPZ_MAX_UNCOMPRESSED_BYTES",
    256 * 1024 * 1024,
    4 * 1024 * 1024,
    1024 * 1024 * 1024,
)
MAX_ANIMAL_NPZ_MEMBERS = _bounded_env_int(
    "SPRITE_ANIMAL_MOTION_NPZ_MAX_MEMBERS", 64, 8, 256
)

_BACKEND_ALIASES = {
    "auto": "auto",
    "kimodo": "kimodo",
    "human": "kimodo",
    "human_kimodo": "kimodo",
    "procedural": "animal_procedural",
    "animal_procedural": "animal_procedural",
    "animal-procedural": "animal_procedural",
    "synthetic": "animal_procedural",
    "npz": "animal_npz",
    "uploaded_npz": "animal_npz",
    "animal_npz": "animal_npz",
    "animal-npz": "animal_npz",
}


@dataclass(frozen=True)
class MotionRoute:
    requested_backend: str
    resolved_backend: str
    reason: str
    motion_npz_required: bool


def normalize_motion_backend(value: str | None) -> str:
    normalized = (value or "auto").strip().lower().replace(" ", "_")
    backend = _BACKEND_ALIASES.get(normalized)
    if backend is None:
        raise ValueError(
            "motion_backend must be one of: " + ", ".join(VALID_MOTION_BACKENDS)
        )
    return backend


def resolve_motion_backend(
    subject_profile: str,
    requested_backend: str | None,
    has_motion_npz: bool,
) -> MotionRoute:
    requested = normalize_motion_backend(requested_backend)
    is_character = subject_profile == "character"

    if is_character:
        if has_motion_npz:
            raise ValueError(
                "motion_npz is an animal-only V9 input; character requests keep the V8 Kimodo path"
            )
        if requested not in {"auto", "kimodo"}:
            raise ValueError(
                f"motion_backend={requested} is not valid for subject_profile=character"
            )
        return MotionRoute(
            requested_backend=requested,
            resolved_backend="kimodo",
            reason="character_v8_compatibility_path",
            motion_npz_required=False,
        )

    if subject_profile not in {"quadruped", "biped_animal"}:
        raise ValueError(f"Unsupported subject_profile: {subject_profile}")

    if requested == "kimodo":
        raise ValueError(
            "Kimodo is disabled for animal profiles because it produces human/humanoid motion"
        )

    if requested == "auto":
        if has_motion_npz:
            return MotionRoute(
                requested_backend=requested,
                resolved_backend="animal_npz",
                reason="uploaded_animal_npz_present",
                motion_npz_required=True,
            )
        return MotionRoute(
            requested_backend=requested,
            resolved_backend="animal_procedural",
            reason="animal_safe_local_fallback",
            motion_npz_required=False,
        )

    if requested == "animal_npz":
        if not has_motion_npz:
            raise ValueError("motion_backend=animal_npz requires a motion_npz upload")
        return MotionRoute(
            requested_backend=requested,
            resolved_backend="animal_npz",
            reason="explicit_animal_npz",
            motion_npz_required=True,
        )

    if requested == "animal_procedural":
        if has_motion_npz:
            raise ValueError(
                "motion_npz was supplied but motion_backend=animal_procedural; use auto or animal_npz"
            )
        return MotionRoute(
            requested_backend=requested,
            resolved_backend="animal_procedural",
            reason="explicit_animal_procedural",
            motion_npz_required=False,
        )

    raise ValueError(f"Unsupported motion backend: {requested}")


def _scalar_string(data: np.lib.npyio.NpzFile, key: str, default: str = "") -> str:
    if key not in data.files:
        return default
    value = np.asarray(data[key])
    if value.size != 1:
        raise ValueError(f"{key} must be a scalar string")
    scalar = value.reshape(-1)[0]
    if isinstance(scalar, (bytes, np.bytes_)):
        try:
            text = bytes(scalar).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(f"{key} must be valid UTF-8") from exc
    else:
        text = str(scalar)
    if len(text) > 256:
        raise ValueError(f"{key} is too long")
    return text


def _direction_array(data: np.lib.npyio.NpzFile, direction: str) -> np.ndarray:
    for key in (direction, f"{direction}_keypoints", f"keypoints_{direction}"):
        if key in data.files:
            return np.asarray(data[key], dtype=np.float32)
    raise ValueError(
        f"missing {direction} controls; expected one of {direction}, {direction}_keypoints, keypoints_{direction}"
    )


def _score_array(data: np.lib.npyio.NpzFile, direction: str, frames: int) -> np.ndarray | None:
    for key in (f"{direction}_scores", f"scores_{direction}"):
        if key in data.files:
            scores = np.asarray(data[key], dtype=np.float32)
            if scores.shape != (frames, 18):
                raise ValueError(f"{key} must have shape ({frames}, 18), got {scores.shape}")
            if not np.all(np.isfinite(scores)):
                raise ValueError(f"{key} contains non-finite values")
            return scores
    return None


def inspect_animal_motion_npz_bytes(
    raw: bytes,
    expected_profile: str | None = None,
) -> dict[str, Any]:
    if not raw:
        raise ValueError("motion_npz is empty")
    if len(raw) > MAX_ANIMAL_NPZ_SIZE:
        raise ValueError(f"motion_npz exceeds {MAX_ANIMAL_NPZ_SIZE} bytes")

    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if not members:
                raise ValueError("motion_npz has no arrays")
            if len(members) > MAX_ANIMAL_NPZ_MEMBERS:
                raise ValueError(
                    f"motion_npz has too many members ({len(members)} > {MAX_ANIMAL_NPZ_MEMBERS})"
                )
            names: set[str] = set()
            total_uncompressed = 0
            for member in members:
                name = member.filename
                if name in names:
                    raise ValueError(f"motion_npz has a duplicate member: {name}")
                names.add(name)
                if name.startswith("/") or ".." in Path(name).parts:
                    raise ValueError(f"unsafe NPZ member path: {name}")
                if not name.endswith(".npy"):
                    raise ValueError(f"unexpected NPZ member type: {name}")
                total_uncompressed += int(member.file_size)
                if total_uncompressed > MAX_ANIMAL_NPZ_UNCOMPRESSED_SIZE:
                    raise ValueError(
                        "motion_npz uncompressed data exceeds "
                        f"{MAX_ANIMAL_NPZ_UNCOMPRESSED_SIZE} bytes"
                    )
            bad = archive.testzip()
            if bad:
                raise ValueError(f"motion_npz has a corrupt member: {bad}")
    except zipfile.BadZipFile as exc:
        raise ValueError("motion_npz is not a valid NPZ/ZIP file") from exc

    try:
        with np.load(io.BytesIO(raw), allow_pickle=False) as data:
            profile = _scalar_string(data, "subject_profile", "")
            if profile and profile not in {"quadruped", "biped_animal"}:
                raise ValueError(
                    "subject_profile inside motion_npz must be quadruped or biped_animal"
                )
            if expected_profile and profile and profile != expected_profile:
                raise ValueError(
                    f"motion_npz profile {profile!r} does not match request profile {expected_profile!r}"
                )

            coordinate_space = _scalar_string(data, "coordinate_space", "subject_box")
            if coordinate_space not in {"subject_box", "normalized_canvas"}:
                raise ValueError(
                    "coordinate_space must be subject_box or normalized_canvas"
                )

            frame_counts: dict[str, int] = {}
            ranges: dict[str, list[float]] = {}
            score_keys: list[str] = []
            for direction in DIRECTIONS:
                points = _direction_array(data, direction)
                if points.ndim != 3 or points.shape[1:] != (18, 2):
                    raise ValueError(
                        f"{direction} controls must have shape (frames, 18, 2), got {points.shape}"
                    )
                if not 4 <= points.shape[0] <= 512:
                    raise ValueError(
                        f"{direction} frame count must be between 4 and 512, got {points.shape[0]}"
                    )
                if not np.all(np.isfinite(points)):
                    raise ValueError(f"{direction} controls contain non-finite values")
                minimum = float(np.min(points))
                maximum = float(np.max(points))
                if minimum < -0.25 or maximum > 1.25:
                    raise ValueError(
                        f"{direction} controls must be normalized near 0..1, got {minimum:.4f}..{maximum:.4f}"
                    )
                frame_counts[direction] = int(points.shape[0])
                ranges[direction] = [minimum, maximum]
                if _score_array(data, direction, points.shape[0]) is not None:
                    score_keys.append(direction)

            schema_version = _scalar_string(data, "schema_version", "animal-motion-v1")
            if schema_version not in SUPPORTED_ANIMAL_NPZ_SCHEMAS:
                raise ValueError(
                    "unsupported schema_version; expected one of: "
                    + ", ".join(SUPPORTED_ANIMAL_NPZ_SCHEMAS)
                )
            provider = _scalar_string(data, "provider", "")
            motion_name = _scalar_string(data, "motion_name", "")
            source_model = _scalar_string(data, "source_model", "")
    except (OSError, ValueError) as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError(f"cannot read motion_npz: {exc}") from exc

    return {
        "schema_version": schema_version,
        "subject_profile": profile or expected_profile,
        "coordinate_space": coordinate_space,
        "frame_counts": frame_counts,
        "ranges": ranges,
        "score_directions": score_keys,
        "provider": provider or None,
        "motion_name": motion_name or None,
        "source_model": source_model or None,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "size_bytes": len(raw),
    }


def inspect_animal_motion_npz(path: Path, expected_profile: str | None = None) -> dict[str, Any]:
    return inspect_animal_motion_npz_bytes(path.read_bytes(), expected_profile)
