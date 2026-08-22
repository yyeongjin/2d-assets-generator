import math
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from server.app import loop_postprocess as LOOP


def _write_cycle(root: Path, corrupt_frame_zero: bool) -> None:
    for direction_index, direction in enumerate(LOOP.DIRECTIONS):
        directory = root / direction
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(17):
            phase = 0 if index == 16 else index
            angle = 2.0 * math.pi * phase / 16.0
            x = 32 + int(round(12 * math.cos(angle)))
            y = 32 + int(round(12 * math.sin(angle)))
            image = Image.new("RGB", (64, 64), (245, 245, 245))
            draw = ImageDraw.Draw(image)
            draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(45, 65, 90))
            draw.rectangle((29, 44, 35, 58), fill=(90 + 10 * direction_index, 120, 150))
            if corrupt_frame_zero and index == 0:
                draw.rectangle((0, 0, 24, 24), fill=(255, 0, 0))
            image.save(directory / f"frame_{index:03d}.png")


def _write_position_jump(root: Path) -> None:
    for direction in LOOP.DIRECTIONS:
        directory = root / direction
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(17):
            image = Image.new("RGB", (96, 96), (255, 255, 255))
            draw = ImageDraw.Draw(image)
            dx = 0
            dy = 0
            if direction == "front" and index in {0, 1, 16}:
                dx = 8
                dy = 7
            draw.rectangle((38 + dx, 18 + dy, 58 + dx, 79 + dy), fill=(30, 120, 55))
            draw.ellipse((40 + dx, 8 + dy, 56 + dx, 24 + dy), fill=(190, 110, 70))
            image.save(directory / f"frame_{index:03d}.png")


class LoopPostprocessV8Tests(unittest.TestCase):
    def test_phase_selection_avoids_reference_anchored_bad_frame_zero(self):
        with tempfile.TemporaryDirectory() as td:
            rendered = Path(td) / "rendered"
            _write_cycle(rendered, corrupt_frame_zero=True)

            report = LOOP.evaluate_render_attempt(
                rendered,
                max_seam_ratio=2.5,
                max_transition_ratio=3.5,
                max_mean_seam_ratio=2.0,
                max_front_back_centroid_seam_ratio=0.20,
                max_front_back_ground_seam_ratio=0.20,
                max_front_back_height_seam_ratio=0.20,
                max_color_seam_delta_e=100.0,
            )

            self.assertTrue(report["ok"])
            self.assertNotEqual(report["selected_candidate"], "even_start")
            self.assertNotIn(0, report["selected_phase_indices"])
            self.assertEqual(len(report["selected_phase_indices"]), 8)

    def test_front_position_and_ground_jump_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            rendered = Path(td) / "rendered"
            _write_position_jump(rendered)
            report = LOOP.evaluate_render_attempt(
                rendered,
                max_seam_ratio=20.0,
                max_transition_ratio=20.0,
                max_mean_seam_ratio=20.0,
                max_color_seam_delta_e=100.0,
            )
            self.assertFalse(report["ok"])
            joined = "\n".join(report["errors"])
            self.assertIn("front centroid seam ratio", joined)
            self.assertIn("front ground seam ratio", joined)

    def test_copy_selected_frames_uses_report_indices(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            rendered = root / "rendered"
            result = root / "result"
            _write_cycle(rendered, corrupt_frame_zero=False)
            report = LOOP.evaluate_render_attempt(
                rendered,
                max_seam_ratio=3.0,
                max_transition_ratio=4.0,
                max_mean_seam_ratio=2.5,
                max_front_back_centroid_seam_ratio=0.20,
                max_front_back_ground_seam_ratio=0.20,
                max_front_back_height_seam_ratio=0.20,
                max_color_seam_delta_e=100.0,
            )
            LOOP.copy_selected_frames(
                rendered,
                result,
                report["selected_phase_indices"],
            )
            for direction in LOOP.DIRECTIONS:
                self.assertEqual(len(list((result / direction).glob("*.png"))), 8)


if __name__ == "__main__":
    unittest.main()
