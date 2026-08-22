"""Kimodo fixture normalization helpers that do not require the Kimodo runtime."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_fixture_arrays(path: Path) -> tuple[dict[str, np.ndarray], list[str]]:
    """Load a repository fixture and add required derived fields job-locally."""
    with np.load(path, allow_pickle=False) as data:
        arrays = {name: np.asarray(data[name]) for name in data.files}

    if "posed_joints" not in arrays:
        raise RuntimeError("Official walk fixture has no posed_joints array")

    joints = arrays["posed_joints"]
    if joints.ndim not in {3, 4} or joints.shape[-1] != 3:
        raise RuntimeError(f"Unexpected fixture posed_joints shape: {joints.shape}")

    normalized_fields: list[str] = []
    if "root_positions" not in arrays:
        arrays["root_positions"] = np.asarray(joints[..., 0, :], dtype=np.float32)
        normalized_fields.append("root_positions<-posed_joints[...,Hips,:]")

    if "global_root_heading" not in arrays:
        joint_count = int(joints.shape[-2])
        if joint_count >= 77:
            left_hip, right_hip = 67, 72
        elif joint_count >= 30:
            left_hip, right_hip = 22, 26
        else:
            raise RuntimeError(f"Unsupported fixture joint count: {joint_count}")
        diff = joints[..., right_hip, :] - joints[..., left_hip, :]
        angles = np.arctan2(diff[..., 2], -diff[..., 0])
        arrays["global_root_heading"] = np.stack(
            [np.cos(angles), np.sin(angles)], axis=-1
        ).astype(np.float32)
        normalized_fields.append("global_root_heading<-hip_vector")

    return arrays, normalized_fields
