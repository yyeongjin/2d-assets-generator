import importlib.util
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sprite_ota_worker_v8",
    ROOT / "workers" / "ota_worker.py",
)
WORKER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(WORKER)


class OtaStabilizationV8Tests(unittest.TestCase):
    def test_body_anchor_uses_hip_center_and_lowest_ankle(self):
        candidate = np.zeros((18, 2), dtype=np.float32)
        score = np.ones(18, dtype=np.float32)
        candidate[8] = [0.40, 0.60]
        candidate[11] = [0.60, 0.62]
        candidate[10] = [0.44, 0.91]
        candidate[13] = [0.56, 0.94]
        anchor = WORKER._body_anchor(candidate, score)
        self.assertIsNotNone(anchor)
        self.assertAlmostEqual(anchor[0], 0.50, places=6)
        self.assertAlmostEqual(anchor[1], 0.94, places=6)

    def test_circular_fill_handles_missing_endpoint_values(self):
        values = np.array([0.0, 0.0, 2.0, 0.0, 4.0], dtype=np.float32)
        valid = np.array([False, False, True, False, True])
        filled = WORKER._fill_circular(values, valid)
        self.assertTrue(np.all(np.isfinite(filled)))
        self.assertAlmostEqual(float(filled[2]), 2.0, places=6)
        self.assertAlmostEqual(float(filled[4]), 4.0, places=6)

    def test_circular_smoothing_preserves_constant_translation(self):
        values = np.full(17, 0.03125, dtype=np.float32)
        smoothed = WORKER._circular_smooth(values, strength=0.8, passes=3)
        self.assertTrue(np.allclose(values, smoothed))


if __name__ == "__main__":
    unittest.main()
