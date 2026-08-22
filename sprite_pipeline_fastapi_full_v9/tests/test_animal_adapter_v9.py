import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sprite_animal_adapter_v9", ROOT / "adapter" / "animal_service.py"
)
ADAPTER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ADAPTER)


def _write_refs(root: Path) -> tuple[dict[str, Path], dict]:
    refs: dict[str, Path] = {}
    geometry: dict[str, dict] = {}
    for direction in ADAPTER.DIRECTIONS:
        image = Image.new("RGB", (200, 180), "white")
        draw = ImageDraw.Draw(image)
        if direction in {"left", "right"}:
            box = (18, 52, 182, 154)
        else:
            box = (46, 20, 154, 160)
        draw.rounded_rectangle(box, radius=18, fill=(80, 120, 145))
        path = root / f"{direction}.png"
        image.save(path)
        refs[direction] = path
        geometry[direction] = {
            "bbox": list(box),
            "width": 200.0,
            "height": 180.0,
        }
    return refs, {"reference_geometry": geometry}


def _build(profile: str):
    temporary = tempfile.TemporaryDirectory()
    root = Path(temporary.name)
    refs, classification = _write_refs(root)
    output = root / "pose"
    result = ADAPTER.build_animal_pose_controls(
        refs,
        output,
        profile,
        "walk in place",
        classification,
    )
    return temporary, output, result


class AnimalAdapterV9Tests(unittest.TestCase):
    def test_quadruped_build_writes_bypass_metadata(self):
        temporary, output, result = _build("quadruped")
        self.addCleanup(temporary.cleanup)
        meta = json.loads((output / "adapter_meta.json").read_text())
        self.assertEqual(set(result), set(ADAPTER.DIRECTIONS))
        self.assertEqual(meta["adapter_version"], "9.0.0-animal")
        self.assertEqual(meta["adapter_kind"], "animal_synthetic_control")
        self.assertTrue(meta["kimodo_bypassed"])
        self.assertTrue(meta["human_reference_pose_detector_bypassed"])
        self.assertTrue(meta["validation"]["ok"])

    def test_quadruped_controls_have_exact_closed_endpoint(self):
        temporary, output, _ = _build("quadruped")
        self.addCleanup(temporary.cleanup)
        for direction in ADAPTER.DIRECTIONS:
            payload = json.loads((output / direction / "keypoints.json").read_text())
            frames = np.asarray(payload["frames"], dtype=np.float32)
            scores = np.asarray(payload["scores"], dtype=np.float32)
            self.assertEqual(frames.shape, (17, 18, 2))
            self.assertTrue(np.array_equal(frames[0], frames[-1]))
            self.assertTrue(np.array_equal(scores[0], scores[-1]))

    def test_quadruped_has_four_independently_moving_foot_chains(self):
        temporary, output, _ = _build("quadruped")
        self.addCleanup(temporary.cleanup)
        payload = json.loads((output / "left" / "keypoints.json").read_text())
        frames = np.asarray(payload["frames"], dtype=np.float32)[:16]
        feet = frames[:, [4, 7, 10, 13], :]
        travel = np.linalg.norm(np.ptp(feet, axis=0), axis=1)
        self.assertEqual(int(np.sum(travel > 0.012)), 4)
        phase_signatures = [tuple(np.round(feet[:, i, 0], 4)) for i in range(4)]
        self.assertEqual(len(set(phase_signatures)), 4)

    def test_quadruped_side_control_keeps_horizontal_torso(self):
        temporary, output, _ = _build("quadruped")
        self.addCleanup(temporary.cleanup)
        validation = json.loads((output / "adapter_validation.json").read_text())
        self.assertGreater(validation["directions"]["left"]["side_body_ratio"], 2.0)
        self.assertGreater(validation["directions"]["right"]["side_body_ratio"], 2.0)

    def test_biped_animal_control_keeps_two_walking_leg_chains(self):
        temporary, output, _ = _build("biped_animal")
        self.addCleanup(temporary.cleanup)
        payload = json.loads((output / "right" / "keypoints.json").read_text())
        frames = np.asarray(payload["frames"], dtype=np.float32)[:16]
        legs = frames[:, [10, 13], :]
        travel = np.linalg.norm(np.ptp(legs, axis=0), axis=1)
        self.assertEqual(int(np.sum(travel > 0.012)), 2)
        self.assertEqual(payload["geometry_source"], "compact_biped_creature_scaffold")

    def test_non_animal_profile_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            refs, classification = _write_refs(root)
            with self.assertRaises(ValueError):
                ADAPTER.build_animal_pose_controls(
                    refs,
                    root / "pose",
                    "character",
                    "walk",
                    classification,
                )


if __name__ == "__main__":
    unittest.main()
