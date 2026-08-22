import importlib.util
import math
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("sprite_adapter_v8", ROOT / "adapter" / "service.py")
ADAPTER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ADAPTER)


def _set_pair(
    joints: np.ndarray,
    right_index: int,
    left_index: int,
    center: np.ndarray,
    width: float,
    heading_deg: np.ndarray,
    y: float,
) -> None:
    heading = np.radians(heading_deg).astype(np.float32)
    lateral = np.stack(
        [-np.cos(heading) * width, np.zeros_like(heading), np.sin(heading) * width],
        axis=-1,
    )
    right = center + 0.5 * lateral
    left = center - 0.5 * lateral
    right[:, 1] = y
    left[:, 1] = y
    joints[:, right_index] = right
    joints[:, left_index] = left


def _synthetic_soma30(
    hip_heading_deg: np.ndarray,
    shoulder_heading_deg: np.ndarray | None = None,
    head_heading_deg: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    idx = ADAPTER.SOMA30
    frames = len(hip_heading_deg)
    joints = np.zeros((frames, 30, 3), dtype=np.float32)
    roots = np.zeros((frames, 3), dtype=np.float32)
    roots[:, 1] = 0.95
    joints[:, idx["Hips"]] = roots

    center = roots.copy()
    _set_pair(joints, idx["RightLeg"], idx["LeftLeg"], center, 0.24, hip_heading_deg, 0.90)

    shoulder_heading_deg = hip_heading_deg if shoulder_heading_deg is None else shoulder_heading_deg
    _set_pair(
        joints,
        idx["RightArm"],
        idx["LeftArm"],
        center,
        0.42,
        shoulder_heading_deg,
        1.45,
    )
    _set_pair(
        joints,
        idx["RightShoulder"],
        idx["LeftShoulder"],
        center,
        0.30,
        shoulder_heading_deg,
        1.47,
    )

    head_heading_deg = shoulder_heading_deg if head_heading_deg is None else head_heading_deg
    _set_pair(
        joints,
        idx["RightEye"],
        idx["LeftEye"],
        center,
        0.065,
        head_heading_deg,
        1.73,
    )

    joints[:, idx["Spine1"], 1] = 1.05
    joints[:, idx["Spine2"], 1] = 1.20
    joints[:, idx["Chest"], 1] = 1.35
    joints[:, idx["Neck1"], 1] = 1.52
    joints[:, idx["Neck2"], 1] = 1.58
    joints[:, idx["Head"], 1] = 1.68
    joints[:, idx["Jaw"], 1] = 1.66

    for name, x in (("RightFoot", -0.10), ("RightToeBase", -0.10), ("LeftFoot", 0.10), ("LeftToeBase", 0.10)):
        joints[:, idx[name], 0] = x
        joints[:, idx[name], 1] = 0.0
    joints[:, idx["RightShin"], 0] = -0.10
    joints[:, idx["RightShin"], 1] = 0.48
    joints[:, idx["LeftShin"], 0] = 0.10
    joints[:, idx["LeftShin"], 1] = 0.48

    return joints, roots, idx


class AdapterV8Tests(unittest.TestCase):
    def test_closed_cycle_has_sixteen_unique_phases_and_exact_duplicate_endpoint(self):
        unique, closed = ADAPTER._closed_cycle_positions(12, 44)
        self.assertEqual(unique.shape, (16,))
        self.assertEqual(closed.shape, (17,))
        self.assertEqual(float(closed[0]), float(closed[-1]))
        self.assertLess(float(unique[-1]), 44.0)

        source = np.arange(80, dtype=np.float32)[:, None]
        sampled = ADAPTER._sample_closed_cycle(source, unique)
        self.assertTrue(np.array_equal(sampled[0], sampled[-1]))

    def test_heading_delta_has_explicit_target_minus_current_semantics(self):
        joints, _, idx = _synthetic_soma30(np.array([0.0], dtype=np.float32))
        rotated = ADAPTER._rotate_y_heading_delta(joints, math.radians(-12.0))
        heading = math.degrees(float(ADAPTER._heading_angles_from_joints(rotated, idx)[0]))
        self.assertAlmostEqual(heading, -12.0, places=4)

    def test_canonicalize_removes_negative_source_heading_instead_of_doubling_it(self):
        source_heading = -10.0
        joints, roots, idx = _synthetic_soma30(
            np.full(17, source_heading, dtype=np.float32),
            np.full(17, source_heading, dtype=np.float32),
            np.full(17, source_heading, dtype=np.float32),
        )
        canonical = ADAPTER._canonicalize(joints, roots, math.radians(source_heading), idx)
        heading = ADAPTER._angle_alignment_stats(
            ADAPTER._heading_angles_from_joints(canonical, idx)
        )
        self.assertLess(abs(heading["mean_deg"]), 1e-4)

    def test_front_back_lock_limits_torso_and_head_without_mutating_natural_cycle(self):
        phases = np.linspace(-12.0, 12.0, 17, dtype=np.float32)
        shoulders = phases + 4.0
        head = phases - 8.0
        joints, _, idx = _synthetic_soma30(phases, shoulders, head)
        original = joints.copy()

        locked, report = ADAPTER._front_back_cardinal_lock(joints, idx)

        self.assertTrue(np.array_equal(joints, original))
        self.assertFalse(np.array_equal(locked, original))
        self.assertLessEqual(
            report["torso_after"]["p95_abs_deg"],
            ADAPTER.FRONT_BACK_TORSO_YAW_LIMIT_DEG + 1e-3,
        )
        self.assertLessEqual(
            report["head_after"]["p95_abs_deg"],
            ADAPTER.FRONT_BACK_HEAD_YAW_LIMIT_DEG + 1e-3,
        )

    def test_opposite_view_projection_is_exactly_mirrored(self):
        joints, _, idx = _synthetic_soma30(np.linspace(-3.0, 3.0, 17, dtype=np.float32))
        body = ADAPTER._body18(joints, idx)
        top = float(body[..., 1].max())
        front, _, _ = ADAPTER._project(body, "front", 0.78 / top, 0.93)
        back, _, _ = ADAPTER._project(body, "back", 0.78 / top, 0.93)
        self.assertLess(float(np.max(np.abs(front[..., 0] + back[..., 0] - 1.0))), 1e-6)
        self.assertLess(float(np.max(np.abs(front[..., 1] - back[..., 1]))), 1e-6)


if __name__ == "__main__":
    unittest.main()
