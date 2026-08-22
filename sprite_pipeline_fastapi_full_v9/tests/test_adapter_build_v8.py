import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sprite_adapter_v8_build", ROOT / "adapter" / "service.py"
)
ADAPTER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ADAPTER)


def _rotate_local(x: np.ndarray, z: np.ndarray, heading: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Map body-local lateral/forward coordinates to Kimodo world X/Z."""
    c = np.cos(heading)
    s = np.sin(heading)
    return c * x + s * z, -s * x + c * z


def _synthetic_walk(path: Path) -> None:
    idx = ADAPTER.SOMA30
    total = 80
    t = np.arange(total, dtype=np.float32)
    phase = 2.0 * np.pi * (t - 4.0) / 32.0
    heading = np.radians(-8.0 + 4.0 * np.sin(phase)).astype(np.float32)

    root = np.zeros((total, 3), dtype=np.float32)
    root[:, 1] = 0.95 + 0.018 * np.cos(2.0 * phase)
    root[:, 2] = 0.035 * t

    joints = np.zeros((total, 30, 3), dtype=np.float32)
    joints[:, idx["Hips"]] = root

    def place(name: str, lx, ly, lz):
        lx = np.broadcast_to(np.asarray(lx, dtype=np.float32), (total,))
        lz = np.broadcast_to(np.asarray(lz, dtype=np.float32), (total,))
        wx, wz = _rotate_local(lx, lz, heading)
        joints[:, idx[name], 0] = root[:, 0] + wx
        joints[:, idx[name], 1] = np.asarray(ly, dtype=np.float32)
        joints[:, idx[name], 2] = root[:, 2] + wz

    # Center chain.
    for name, height in (
        ("Spine1", 1.08),
        ("Spine2", 1.22),
        ("Chest", 1.37),
        ("Neck1", 1.50),
        ("Neck2", 1.58),
        ("Head", 1.69),
        ("Jaw", 1.65),
    ):
        place(name, 0.0, height, 0.0)

    # Hip/shoulder/eye pairs. Small counter-rotation is intentional and should
    # be limited only in the front/back control copy.
    def pair(right: str, left: str, width: float, height: float, local_heading_delta_deg):
        local_h = heading + np.radians(local_heading_delta_deg).astype(np.float32)
        c = np.cos(local_h)
        s = np.sin(local_h)
        # right-left vector = [-width*cos(h), 0, width*sin(h)]
        rx = root[:, 0] - 0.5 * width * c
        rz = root[:, 2] + 0.5 * width * s
        lx = root[:, 0] + 0.5 * width * c
        lz = root[:, 2] - 0.5 * width * s
        joints[:, idx[right], 0] = rx
        joints[:, idx[right], 1] = height
        joints[:, idx[right], 2] = rz
        joints[:, idx[left], 0] = lx
        joints[:, idx[left], 1] = height
        joints[:, idx[left], 2] = lz

    pair("RightLeg", "LeftLeg", 0.24, 0.90, 0.0)
    shoulder_delta = 3.0 * np.sin(phase + np.pi / 3.0)
    pair("RightShoulder", "LeftShoulder", 0.32, 1.46, shoulder_delta)
    pair("RightArm", "LeftArm", 0.42, 1.43, shoulder_delta)
    pair("RightEye", "LeftEye", 0.065, 1.73, -4.0 + 2.0 * np.sin(phase))

    # Walking legs stay in separate body-local lanes.
    left_forward = 0.20 * np.sin(phase)
    right_forward = -left_forward
    left_lift = 0.075 * np.maximum(0.0, -np.sin(phase))
    right_lift = 0.075 * np.maximum(0.0, np.sin(phase))

    for side, lane, forward, lift in (
        ("Left", 0.105, left_forward, left_lift),
        ("Right", -0.105, right_forward, right_lift),
    ):
        wx, wz = _rotate_local(
            np.full(total, lane, dtype=np.float32),
            forward,
            heading,
        )
        foot_name = f"{side}Foot"
        toe_name = f"{side}ToeBase"
        shin_name = f"{side}Shin"
        leg_name = f"{side}Leg"

        joints[:, idx[foot_name], 0] = root[:, 0] + wx
        joints[:, idx[foot_name], 1] = lift
        joints[:, idx[foot_name], 2] = root[:, 2] + wz

        twx, twz = _rotate_local(
            np.full(total, lane, dtype=np.float32),
            forward + 0.12,
            heading,
        )
        joints[:, idx[toe_name], 0] = root[:, 0] + twx
        joints[:, idx[toe_name], 1] = lift * 0.8
        joints[:, idx[toe_name], 2] = root[:, 2] + twz

        # Knee halfway between hip and ankle with a slight forward bend.
        knee = 0.52 * joints[:, idx[leg_name]] + 0.48 * joints[:, idx[foot_name]]
        kwx, kwz = _rotate_local(
            np.zeros(total, dtype=np.float32),
            np.full(total, 0.06, dtype=np.float32),
            heading,
        )
        knee[:, 0] += kwx
        knee[:, 2] += kwz
        joints[:, idx[shin_name]] = knee

    # Arms swing opposite the legs.
    for side, sign in (("Left", 1.0), ("Right", -1.0)):
        shoulder = joints[:, idx[f"{side}Arm"]]
        swing = sign * 0.10 * np.sin(phase)
        ex, ez = _rotate_local(
            np.full(total, 0.05 * sign, dtype=np.float32), swing, heading
        )
        fore = shoulder.copy()
        fore[:, 0] += ex
        fore[:, 1] -= 0.28
        fore[:, 2] += ez
        joints[:, idx[f"{side}ForeArm"]] = fore
        hand = fore.copy()
        hand[:, 1] -= 0.24
        joints[:, idx[f"{side}Hand"]] = hand

    # Square-wave heel contacts with complete same-foot cycles at 4->36->68.
    contacts = np.zeros((total, 4), dtype=np.float32)
    left_contact = ((t - 4.0) % 32.0) < 16.0
    right_contact = ((t - 20.0) % 32.0) < 16.0
    contacts[:, 0] = left_contact.astype(np.float32)
    contacts[:, 1] = left_contact.astype(np.float32)
    contacts[:, 2] = right_contact.astype(np.float32)
    contacts[:, 3] = right_contact.astype(np.float32)

    np.savez_compressed(
        path,
        posed_joints=joints,
        root_positions=root,
        foot_contacts=contacts,
    )


class AdapterBuildV8Tests(unittest.TestCase):
    def test_full_adapter_build_emits_cardinal_front_back_controls(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            motion = root / "motion.npz"
            _synthetic_walk(motion)

            refs = {}
            for direction in ADAPTER.DIRECTIONS:
                path = root / f"{direction}.png"
                Image.new("RGB", (64, 96), "white").save(path)
                refs[direction] = path

            output = root / "pose"
            result = ADAPTER.build_pose_controls(motion, refs, output)
            self.assertEqual(set(result), set(ADAPTER.DIRECTIONS))

            meta = json.loads((output / "adapter_meta.json").read_text())
            self.assertEqual(meta["adapter_version"], "8.0.0")
            self.assertTrue(meta["control_endpoint_duplicates_phase_zero"])
            self.assertTrue(meta["validation"]["ok"])
            self.assertLessEqual(
                meta["cardinal_quality"]["front_back_lock"]["torso_after"]["p95_abs_deg"],
                ADAPTER.FRONT_BACK_TORSO_YAW_LIMIT_DEG + 0.1,
            )
            self.assertLessEqual(
                meta["cardinal_quality"]["front_back_lock"]["head_after"]["p95_abs_deg"],
                ADAPTER.FRONT_BACK_HEAD_YAW_LIMIT_DEG + 0.1,
            )

            front = json.loads((output / "front" / "keypoints.json").read_text())
            left = json.loads((output / "left" / "keypoints.json").read_text())
            self.assertEqual(front["geometry_source"], "front_back_cardinal_lock")
            self.assertEqual(left["geometry_source"], "natural_canonical_cycle")
            self.assertEqual(front["num_frames"], 17)
            self.assertTrue(front["control_endpoint_duplicates_phase_zero"])
            self.assertTrue(
                np.array_equal(
                    np.asarray(front["frames"], dtype=np.float32)[0],
                    np.asarray(front["frames"], dtype=np.float32)[-1],
                )
            )
            self.assertTrue(
                np.array_equal(
                    np.asarray(front["scores"], dtype=np.float32)[0],
                    np.asarray(front["scores"], dtype=np.float32)[-1],
                )
            )
            self.assertTrue((output / "pose_preview.png").exists())


if __name__ == "__main__":
    unittest.main()
