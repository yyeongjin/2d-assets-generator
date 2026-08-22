import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adapter import animal_service as ADAPTER
from server.app import motion_routing as ROUTING


class BundledAnimalNpzExamplesV9Tests(unittest.TestCase):
    def _refs(self, root: Path):
        refs = {}
        geometry = {}
        for direction in ADAPTER.DIRECTIONS:
            image = Image.new("RGB", (240, 200), "white")
            draw = ImageDraw.Draw(image)
            box = (
                (20, 60, 220, 180)
                if direction in {"left", "right"}
                else (62, 20, 178, 186)
            )
            draw.rounded_rectangle(box, radius=18, fill=(100, 130, 155))
            path = root / f"{direction}.png"
            image.save(path)
            refs[direction] = path
            geometry[direction] = {
                "bbox": list(box),
                "width": 240.0,
                "height": 200.0,
            }
        return refs, {"reference_geometry": geometry}

    def _verify_example(self, profile: str, filename: str):
        source = ROOT / "examples" / "animal-motion-v1" / filename
        self.assertTrue(source.is_file())
        report = ROUTING.inspect_animal_motion_npz(source, profile)
        self.assertEqual(report["schema_version"], "animal-motion-v1")
        self.assertEqual(report["subject_profile"], profile)
        self.assertEqual(report["provider"], "v9-contract-example")
        self.assertTrue(all(count == 16 for count in report["frame_counts"].values()))

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            refs, classification = self._refs(root)
            output = root / "pose"
            ADAPTER.build_animal_pose_controls(
                refs,
                output,
                profile,
                "contract example",
                classification,
                source,
                "animal_npz",
            )
            meta = json.loads((output / "adapter_meta.json").read_text())
            self.assertEqual(meta["motion_backend"], "animal_npz")
            self.assertTrue(meta["validation"]["ok"])
            for direction in ADAPTER.DIRECTIONS:
                payload = json.loads(
                    (output / direction / "keypoints.json").read_text()
                )
                frames = np.asarray(payload["frames"], dtype=np.float32)
                self.assertEqual(frames.shape, (17, 18, 2))
                self.assertTrue(np.array_equal(frames[0], frames[-1]))

    def test_quadruped_contract_example(self):
        self._verify_example(
            "quadruped", "quadruped_walk_contract_example.npz"
        )

    def test_biped_animal_contract_example(self):
        self._verify_example(
            "biped_animal", "biped_animal_walk_contract_example.npz"
        )


if __name__ == "__main__":
    unittest.main()
