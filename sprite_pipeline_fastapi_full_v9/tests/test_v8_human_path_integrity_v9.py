from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class V8HumanPathIntegrityV9Tests(unittest.TestCase):
    def test_v8_human_motion_adapter_is_byte_identical(self) -> None:
        digest = hashlib.sha256((ROOT / "adapter" / "service.py").read_bytes()).hexdigest()
        self.assertEqual(
            digest,
            "94c53bfda7e283247e94495874ee4af569c7b35d0b6ea0c531193e723441dd18",
        )

    def test_v8_kimodo_worker_is_byte_identical(self) -> None:
        digest = hashlib.sha256((ROOT / "workers" / "kimodo_worker.py").read_bytes()).hexdigest()
        self.assertEqual(
            digest,
            "1b3ef5e103a938ea84f154777470d905032da3aa189d59a4cc007e72ef67d532",
        )


if __name__ == "__main__":
    unittest.main()
