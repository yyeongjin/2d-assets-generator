from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class OperationalScriptsV9Tests(unittest.TestCase):
    def test_start_all_is_an_executable_launcher_not_an_instruction_stub(self):
        script = (ROOT / "scripts" / "start_all.sh").read_text(encoding="utf-8")
        self.assertNotIn("exit 2", script)
        self.assertIn("START_KIMODO", script)
        self.assertIn("ota-worker.pid", script)
        self.assertIn("api.pid", script)
        self.assertIn("wait_ready", script)
        self.assertIn("uvicorn app.main:app", script)

    def test_stop_all_stops_api_before_gpu_workers(self):
        script = (ROOT / "scripts" / "stop_all.sh").read_text(encoding="utf-8")
        api = script.index('stop_process "FastAPI"')
        ota = script.index('stop_process "One-to-All"')
        kimodo = script.index('stop_process "Kimodo"')
        self.assertLess(api, ota)
        self.assertLess(ota, kimodo)


if __name__ == "__main__":
    unittest.main()
