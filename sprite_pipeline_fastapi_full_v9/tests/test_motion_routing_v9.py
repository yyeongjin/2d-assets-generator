import io
import unittest
from unittest.mock import patch

import numpy as np

from server.app import motion_routing as motion_routing_module
from server.app.motion_routing import (
    inspect_animal_motion_npz_bytes,
    normalize_motion_backend,
    resolve_motion_backend,
)


def make_npz(profile: str = "quadruped", frames: int = 12) -> bytes:
    buffer = io.BytesIO()
    payload = {
        "schema_version": np.array("animal-motion-v1"),
        "subject_profile": np.array(profile),
        "coordinate_space": np.array("subject_box"),
    }
    base = np.zeros((frames, 18, 2), dtype=np.float32)
    for index in range(frames):
        phase = index / frames
        base[index, :, 0] = np.linspace(0.15, 0.85, 18)
        base[index, :, 1] = 0.4 + 0.2 * np.sin(2 * np.pi * phase)
    for direction in ("front", "back", "left", "right"):
        payload[direction] = base.copy()
    np.savez_compressed(buffer, **payload)
    return buffer.getvalue()


class MotionRoutingV9Tests(unittest.TestCase):
    def test_character_stays_on_kimodo(self):
        route = resolve_motion_backend("character", "auto", False)
        self.assertEqual(route.resolved_backend, "kimodo")
        self.assertEqual(route.reason, "character_v8_compatibility_path")

    def test_character_rejects_animal_npz(self):
        with self.assertRaises(ValueError):
            resolve_motion_backend("character", "animal_npz", True)

    def test_animal_auto_prefers_uploaded_npz(self):
        route = resolve_motion_backend("quadruped", "auto", True)
        self.assertEqual(route.resolved_backend, "animal_npz")

    def test_animal_auto_uses_safe_procedural_fallback(self):
        route = resolve_motion_backend("biped_animal", "auto", False)
        self.assertEqual(route.resolved_backend, "animal_procedural")

    def test_animal_rejects_kimodo(self):
        with self.assertRaises(ValueError):
            resolve_motion_backend("quadruped", "kimodo", False)

    def test_backend_aliases(self):
        self.assertEqual(normalize_motion_backend("uploaded npz"), "animal_npz")
        self.assertEqual(normalize_motion_backend("procedural"), "animal_procedural")

    def test_npz_contract_inspection(self):
        result = inspect_animal_motion_npz_bytes(make_npz(), "quadruped")
        self.assertEqual(result["subject_profile"], "quadruped")
        self.assertEqual(result["coordinate_space"], "subject_box")
        self.assertEqual(result["frame_counts"]["front"], 12)
        self.assertEqual(len(result["sha256"]), 64)

    def test_npz_profile_mismatch_is_rejected(self):
        with self.assertRaises(ValueError):
            inspect_animal_motion_npz_bytes(make_npz("biped_animal"), "quadruped")

    def test_npz_rejects_unknown_schema(self):
        buffer = io.BytesIO()
        points = np.zeros((8, 18, 2), dtype=np.float32)
        np.savez_compressed(
            buffer,
            schema_version=np.array("animal-motion-v99"),
            subject_profile=np.array("quadruped"),
            front=points,
            back=points,
            left=points,
            right=points,
        )
        with self.assertRaisesRegex(ValueError, "unsupported schema_version"):
            inspect_animal_motion_npz_bytes(buffer.getvalue(), "quadruped")

    def test_npz_decodes_byte_string_metadata(self):
        buffer = io.BytesIO()
        points = np.zeros((8, 18, 2), dtype=np.float32)
        np.savez_compressed(
            buffer,
            schema_version=np.array(b"animal-motion-v1"),
            subject_profile=np.array(b"quadruped"),
            coordinate_space=np.array(b"subject_box"),
            provider=np.array(b"animal-provider"),
            motion_name=np.array(b"walk"),
            front=points,
            back=points,
            left=points,
            right=points,
        )
        result = inspect_animal_motion_npz_bytes(buffer.getvalue(), "quadruped")
        self.assertEqual(result["provider"], "animal-provider")
        self.assertEqual(result["motion_name"], "walk")

    def test_npz_rejects_excessive_uncompressed_payload(self):
        raw = make_npz()
        with patch.object(
            motion_routing_module,
            "MAX_ANIMAL_NPZ_UNCOMPRESSED_SIZE",
            128,
        ):
            with self.assertRaisesRegex(ValueError, "uncompressed data exceeds"):
                inspect_animal_motion_npz_bytes(raw, "quadruped")


if __name__ == "__main__":
    unittest.main()
