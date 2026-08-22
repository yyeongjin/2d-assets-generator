import unittest
from pathlib import Path
import tempfile

from PIL import Image, ImageDraw

from server.app.animal_qc import evaluate_animal_render_attempt


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "v8_animal_failures"
DIRECTIONS = ("front", "back", "left", "right")


def _write_stable_animal(root: Path) -> tuple[Path, dict[str, Path]]:
    render_root = root / "rendered"
    refs: dict[str, Path] = {}
    for direction in DIRECTIONS:
        image = Image.new("RGB", (160, 160), "white")
        draw = ImageDraw.Draw(image)
        if direction in {"left", "right"}:
            draw.rounded_rectangle((22, 58, 138, 116), radius=15, fill=(116, 86, 64))
            draw.rectangle((32, 108, 46, 146), fill=(116, 86, 64))
            draw.rectangle((112, 108, 126, 146), fill=(116, 86, 64))
        else:
            draw.rounded_rectangle((48, 34, 112, 123), radius=16, fill=(116, 86, 64))
            draw.rectangle((51, 114, 67, 148), fill=(116, 86, 64))
            draw.rectangle((93, 114, 109, 148), fill=(116, 86, 64))
        ref_path = root / f"{direction}.png"
        image.save(ref_path)
        refs[direction] = ref_path
        directory = render_root / direction
        directory.mkdir(parents=True)
        for index in range(17):
            image.save(directory / f"frame_{index:03d}.png")
    return render_root, refs


class AnimalQCV9Tests(unittest.TestCase):
    def test_stable_single_animal_passes(self):
        with tempfile.TemporaryDirectory() as td:
            render_root, refs = _write_stable_animal(Path(td))
            report = evaluate_animal_render_attempt(render_root, refs, "quadruped")
        self.assertTrue(report["ok"], "\n".join(report["errors"]))
        self.assertTrue(all(report["directions"][d]["ok"] for d in DIRECTIONS))

    def _assert_failure_fixture_rejected(self, animal: str, profile: str):
        root = FIXTURES / animal
        refs = {direction: root / "refs" / f"{direction}.png" for direction in DIRECTIONS}
        report = evaluate_animal_render_attempt(root / "rendered", refs, profile)
        self.assertFalse(report["ok"])
        self.assertGreater(len(report["errors"]), 0)

    def test_v8_pig_humanization_is_rejected(self):
        self._assert_failure_fixture_rejected("pig", "quadruped")

    def test_v8_dog_duplication_is_rejected(self):
        self._assert_failure_fixture_rejected("dog", "quadruped")

    def test_v8_dinosaur_identity_failure_is_rejected(self):
        self._assert_failure_fixture_rejected("dinosaur", "biped_animal")


if __name__ == "__main__":
    unittest.main()
