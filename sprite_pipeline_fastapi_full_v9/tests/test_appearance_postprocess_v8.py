import math
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from server.app.appearance_postprocess import stabilize_appearance_attempt


class AppearancePostprocessV8Tests(unittest.TestCase):
    def _write_references_and_frames(self, root: Path):
        references = {}
        for direction_index, direction in enumerate(("front", "back", "left", "right")):
            reference = Image.new("RGB", (96, 96), (255, 255, 255))
            draw = ImageDraw.Draw(reference)
            draw.ellipse((38, 8, 58, 28), fill=(195, 112, 72))
            draw.rectangle((34, 26, 62, 62), fill=(18, 92 + direction_index, 34))
            draw.rectangle((37, 62, 47, 88), fill=(184, 151, 83))
            draw.rectangle((49, 62, 59, 88), fill=(184, 151, 83))
            path = root / f"{direction}.png"
            reference.save(path)
            references[direction] = path

            directory = root / "rendered" / direction
            directory.mkdir(parents=True, exist_ok=True)
            for index in range(17):
                phase = 2.0 * math.pi * (0 if index == 16 else index) / 16.0
                image = Image.new("RGB", (96, 96), (255, 255, 255))
                draw = ImageDraw.Draw(image)
                color_drift = int(round(28 * math.sin(phase)))
                light_drift = int(round(13 * math.cos(phase)))
                shirt = (
                    max(0, min(255, 18 + color_drift)),
                    max(0, min(255, 92 + light_drift)),
                    max(0, min(255, 34 - color_drift)),
                )
                draw.ellipse((38, 8, 58, 28), fill=(195, 112, 72))
                draw.rectangle((34, 26, 62, 62), fill=shirt)
                draw.rectangle((37, 62, 47, 88), fill=(184, 151, 83))
                draw.rectangle((49, 62, 59, 88), fill=(184, 151, 83))
                image.save(directory / f"frame_{index:03d}.png")
        return references

    def test_shared_reference_palette_reduces_temporal_color_drift(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            references = self._write_references_and_frames(root)
            report = stabilize_appearance_attempt(
                root / "rendered",
                references,
                max_temporal_chroma_spread=20.0,
                max_temporal_luma_spread=20.0,
            )
            self.assertTrue(report["ok"])
            self.assertEqual(report["version"], "8.0.0")
            self.assertGreaterEqual(len(report["palette_rgb"]), 4)

            for direction in ("front", "back", "left", "right"):
                metrics = report["directions"][direction]
                self.assertLess(
                    metrics["after"]["temporal_chroma_spread"],
                    metrics["before"]["temporal_chroma_spread"],
                )
                directory = root / "rendered" / direction
                self.assertTrue((directory / "preappearance" / "frame_000.png").exists())
                self.assertTrue((directory / "appearance_meta.json").exists())
                corrected = np.asarray(
                    Image.open(directory / "frame_000.png").convert("RGB")
                )
                self.assertTrue(np.array_equal(corrected[0, 0], [255, 255, 255]))

    def test_disabled_mode_preserves_rendered_pixels(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            references = self._write_references_and_frames(root)
            before = np.asarray(
                Image.open(root / "rendered" / "front" / "frame_004.png").convert("RGB")
            )
            report = stabilize_appearance_attempt(
                root / "rendered",
                references,
                enabled=False,
            )
            after = np.asarray(
                Image.open(root / "rendered" / "front" / "frame_004.png").convert("RGB")
            )
            self.assertTrue(report["ok"])
            self.assertTrue(np.array_equal(before, after))


if __name__ == "__main__":
    unittest.main()
