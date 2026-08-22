import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np

from workers.fixture_io import normalized_fixture_arrays, sha256_file


class FixtureIoTests(unittest.TestCase):
    def test_missing_root_and_heading_are_derived_for_soma30(self):
        frames = 4
        joints = np.zeros((frames, 30, 3), dtype=np.float32)
        joints[:, 0, :] = np.array(
            [[0.0, 0.9, 0.0], [0.1, 0.91, 0.2], [0.2, 0.9, 0.4], [0.3, 0.89, 0.6]],
            dtype=np.float32,
        )

        # Kimodo 0-rad heading: right-hip - left-hip points along -X.
        joints[:, 22, 0] = 0.12   # LeftLeg
        joints[:, 26, 0] = -0.12  # RightLeg

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "fixture.npz"
            np.savez_compressed(path, posed_joints=joints)
            arrays, fields = normalized_fixture_arrays(path)

        np.testing.assert_allclose(arrays["root_positions"], joints[:, 0, :])
        np.testing.assert_allclose(
            arrays["global_root_heading"],
            np.tile(np.array([[1.0, 0.0]], dtype=np.float32), (frames, 1)),
            atol=1e-6,
        )
        self.assertEqual(
            fields,
            [
                "root_positions<-posed_joints[...,Hips,:]",
                "global_root_heading<-hip_vector",
            ],
        )

    def test_existing_fields_are_preserved(self):
        joints = np.zeros((2, 30, 3), dtype=np.float32)
        roots = np.full((2, 3), 7.0, dtype=np.float32)
        heading = np.array([[0.0, 1.0], [0.0, 1.0]], dtype=np.float32)

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "fixture.npz"
            np.savez_compressed(
                path,
                posed_joints=joints,
                root_positions=roots,
                global_root_heading=heading,
            )
            arrays, fields = normalized_fixture_arrays(path)

        self.assertEqual(fields, [])
        np.testing.assert_array_equal(arrays["root_positions"], roots)
        np.testing.assert_array_equal(arrays["global_root_heading"], heading)

    def test_sha256_file_matches_hashlib(self):
        payload = b"sprite-pipeline-v8\n"
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "payload.bin"
            path.write_bytes(payload)
            actual = sha256_file(path)
        self.assertEqual(actual, hashlib.sha256(payload).hexdigest())


if __name__ == "__main__":
    unittest.main()
