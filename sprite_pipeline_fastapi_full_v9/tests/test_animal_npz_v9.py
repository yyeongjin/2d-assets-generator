import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sprite_animal_adapter_npz_v9", ROOT / "adapter" / "animal_service.py"
)
ADAPTER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ADAPTER)


def write_refs(root: Path) -> tuple[dict[str, Path], dict]:
    refs = {}
    geometry = {}
    for direction in ADAPTER.DIRECTIONS:
        image = Image.new("RGB", (240, 200), "white")
        draw = ImageDraw.Draw(image)
        box = (20, 60, 220, 180) if direction in {"left", "right"} else (62, 20, 178, 186)
        draw.rounded_rectangle(box, radius=18, fill=(100, 130, 155))
        path = root / f"{direction}.png"
        image.save(path)
        refs[direction] = path
        geometry[direction] = {"bbox": list(box), "width": 240.0, "height": 200.0}
    return refs, {"reference_geometry": geometry}


def write_motion(path: Path, profile: str = "quadruped", frame_count: int = 10) -> None:
    payload = {
        "schema_version": np.array("animal-motion-v1"),
        "subject_profile": np.array(profile),
        "coordinate_space": np.array("subject_box"),
    }
    for direction in ADAPTER.DIRECTIONS:
        frames, scores = ADAPTER._build_direction(profile, direction, (0.0, 0.0, 1.0, 1.0))
        # Simulate a provider that returns an arbitrary source frame count.
        indices = np.linspace(0, 15, frame_count, endpoint=False).astype(int)
        payload[direction] = frames[indices]
        payload[f"{direction}_scores"] = scores[indices]
    np.savez_compressed(path, **payload)



class AnimalNpzV9Tests(unittest.TestCase):
    def test_external_npz_is_resampled_and_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            refs, classification = write_refs(root)
            motion = root / "animal_motion.npz"
            write_motion(motion)
            output = root / "pose"
            ADAPTER.build_animal_pose_controls(
                refs,
                output,
                "quadruped",
                "walk",
                classification,
                motion,
                "animal_npz",
            )
            meta = json.loads((output / "adapter_meta.json").read_text())
            self.assertEqual(meta["adapter_kind"], "animal_npz_control")
            self.assertEqual(meta["motion_backend"], "animal_npz")
            self.assertEqual(meta["motion_source"]["source_frames"]["front"], 10)
            for direction in ADAPTER.DIRECTIONS:
                payload = json.loads((output / direction / "keypoints.json").read_text())
                frames = np.asarray(payload["frames"], dtype=np.float32)
                self.assertEqual(frames.shape, (17, 18, 2))
                self.assertTrue(np.array_equal(frames[0], frames[-1]))
                self.assertGreaterEqual(float(frames.min()), 0.0)
                self.assertLessEqual(float(frames.max()), 1.0)

    def test_external_npz_profile_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            refs, classification = write_refs(root)
            motion = root / "animal_motion.npz"
            write_motion(motion, profile="biped_animal")
            with self.assertRaises(RuntimeError):
                ADAPTER.build_animal_pose_controls(
                    refs,
                    root / "pose",
                    "quadruped",
                    "walk",
                    classification,
                    motion,
                    "animal_npz",
                )


if __name__ == "__main__":
    unittest.main()
