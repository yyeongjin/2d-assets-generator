import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from server.app.subject_profile import classify_subject, normalize_subject_profile


DIRECTIONS = ("front", "back", "left", "right")


def _write_refs(root: Path, *, wide_side: bool) -> dict[str, Path]:
    refs: dict[str, Path] = {}
    for direction in DIRECTIONS:
        image = Image.new("RGB", (160, 160), "white")
        draw = ImageDraw.Draw(image)
        if direction in {"left", "right"} and wide_side:
            draw.rounded_rectangle((20, 58, 140, 116), radius=16, fill=(90, 120, 150))
            draw.rectangle((34, 110, 48, 146), fill=(90, 120, 150))
            draw.rectangle((112, 110, 126, 146), fill=(90, 120, 150))
        else:
            draw.rounded_rectangle((52, 20, 108, 135), radius=18, fill=(90, 120, 150))
            draw.rectangle((57, 126, 73, 151), fill=(90, 120, 150))
            draw.rectangle((87, 126, 103, 151), fill=(90, 120, 150))
        path = root / f"{direction}.png"
        image.save(path)
        refs[direction] = path
    return refs


class SubjectProfileV9Tests(unittest.TestCase):
    def test_alias_normalization(self):
        self.assertEqual(normalize_subject_profile("four-legged"), "quadruped")
        self.assertEqual(normalize_subject_profile("biped animal"), "biped_animal")

    def test_invalid_profile_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_subject_profile("unknown-creature-mode")

    def test_korean_quadruped_keyword(self):
        with tempfile.TemporaryDirectory() as td:
            refs = _write_refs(Path(td), wide_side=False)
            result = classify_subject("auto", "네발 돼지 걷기", refs)
        self.assertEqual(result["resolved_profile"], "quadruped")
        self.assertEqual(result["reason"], "quadruped_prompt_keyword")

    def test_biped_dinosaur_keyword(self):
        with tempfile.TemporaryDirectory() as td:
            refs = _write_refs(Path(td), wide_side=True)
            result = classify_subject("auto", "small raptor dinosaur walk", refs)
        self.assertEqual(result["resolved_profile"], "biped_animal")
        self.assertEqual(result["reason"], "biped_animal_prompt_keyword")

    def test_explicit_character_profile_overrides_animal_prompt(self):
        with tempfile.TemporaryDirectory() as td:
            refs = _write_refs(Path(td), wide_side=True)
            result = classify_subject("character", "dog mascot walk", refs)
        self.assertEqual(result["resolved_profile"], "character")
        self.assertEqual(result["reason"], "explicit_profile")

    def test_generic_animal_uses_wide_side_silhouette(self):
        with tempfile.TemporaryDirectory() as td:
            refs = _write_refs(Path(td), wide_side=True)
            result = classify_subject("auto", "fantasy animal creature", refs)
        self.assertEqual(result["resolved_profile"], "quadruped")
        self.assertIn("wide_side", result["reason"])

    def test_unmarked_subject_preserves_character_default(self):
        with tempfile.TemporaryDirectory() as td:
            refs = _write_refs(Path(td), wide_side=False)
            result = classify_subject("auto", "blacksmith walking in place", refs)
        self.assertEqual(result["resolved_profile"], "character")
        self.assertEqual(result["reason"], "character_default")


if __name__ == "__main__":
    unittest.main()
