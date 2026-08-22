from __future__ import annotations

import io
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from server.app import jobs as jobs_module
from server.app import main as main_module
from server.app.jobs import JobStore


def png_bytes() -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (64, 64), "white").save(stream, "PNG")
    return stream.getvalue()


def animal_npz_bytes(profile: str = "quadruped") -> bytes:
    stream = io.BytesIO()
    phases = np.linspace(0.0, 2.0 * np.pi, 8, endpoint=False, dtype=np.float32)
    base = np.zeros((8, 18, 2), dtype=np.float32)
    base[..., 0] = np.linspace(0.12, 0.88, 18, dtype=np.float32)
    base[..., 1] = 0.5
    # Move all points slightly so the validation input is not static.
    base[..., 1] += 0.03 * np.sin(phases)[:, None]
    np.savez_compressed(
        stream,
        schema_version=np.array("animal-motion-v1"),
        subject_profile=np.array(profile),
        coordinate_space=np.array("subject_box"),
        front=base,
        back=base,
        left=base,
        right=base,
    )
    return stream.getvalue()


class ApiHttpV9Tests(unittest.TestCase):
    def _files(self, include_npz: bool = False) -> dict[str, tuple[str, bytes, str]]:
        image = png_bytes()
        files: dict[str, tuple[str, bytes, str]] = {
            direction: (f"{direction}.png", image, "image/png")
            for direction in ("front", "back", "left", "right")
        }
        if include_npz:
            files["motion_npz"] = (
                "animal_walk.npz",
                animal_npz_bytes(),
                "application/octet-stream",
            )
        return files

    def test_health_keeps_animal_route_ready_when_kimodo_is_down(self) -> None:
        with patch.object(
            main_module,
            "workers_health",
            AsyncMock(
                return_value=(
                    {"status": "down"},
                    {"status": "ready"},
                )
            ),
        ):
            client = TestClient(main_module.app)
            response = client.get("/health")
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["status"], "ready")
            self.assertFalse(body["character_ready"])
            self.assertTrue(body["animal_ready"])
            self.assertFalse(body["capabilities"]["motion_backends"]["kimodo"])
            self.assertTrue(body["capabilities"]["motion_backends"]["animal_npz"])
            self.assertEqual(body["capabilities"]["animal_npz"]["max_members"], 64)

    def test_http_character_job_keeps_v8_kimodo_route(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(jobs_module, "JOBS_ROOT", Path(tmp)):
                test_store = JobStore()
                with (
                    patch.object(main_module, "store", test_store),
                    patch.object(
                        main_module,
                        "workers_health",
                        AsyncMock(
                            return_value=(
                                {"status": "ready"},
                                {"status": "ready"},
                            )
                        ),
                    ),
                    patch.dict(
                        os.environ,
                        {"API_TOKEN": "test-token", "ALLOW_UNAUTHENTICATED_API": "false"},
                        clear=False,
                    ),
                ):
                    client = TestClient(main_module.app)
                    response = client.post(
                        "/v1/jobs",
                        headers={"Authorization": "Bearer test-token"},
                        files=self._files(),
                        data={
                            "prompt": "A person walks naturally in place.",
                            "subject_profile": "character",
                            "motion_backend": "kimodo",
                            "seed": "42",
                        },
                    )
                    self.assertEqual(response.status_code, 202, response.text)
                    body = response.json()
                    self.assertEqual(body["subject_profile"], "character")
                    self.assertEqual(body["motion_backend"], "kimodo")
                    self.assertEqual(
                        body["motion_routing"]["reason"],
                        "character_v8_compatibility_path",
                    )
                    job_id = body["job_id"]
                    status = client.get(
                        f"/v1/jobs/{job_id}",
                        headers={"Authorization": "Bearer test-token"},
                    )
                    self.assertEqual(status.status_code, 200)
                    self.assertEqual(status.json()["motion_backend"], "kimodo")
                    deleted = client.delete(
                        f"/v1/jobs/{job_id}",
                        headers={"Authorization": "Bearer test-token"},
                    )
                    self.assertEqual(deleted.status_code, 204)

    def test_http_auto_profile_uses_declared_animal_npz_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(jobs_module, "JOBS_ROOT", Path(tmp)):
                test_store = JobStore()
                with (
                    patch.object(main_module, "store", test_store),
                    patch.object(
                        main_module,
                        "workers_health",
                        AsyncMock(
                            return_value=(
                                {"status": "down"},
                                {"status": "ready"},
                            )
                        ),
                    ),
                    patch.dict(
                        os.environ,
                        {"API_TOKEN": "test-token", "ALLOW_UNAUTHENTICATED_API": "false"},
                        clear=False,
                    ),
                ):
                    client = TestClient(main_module.app)
                    response = client.post(
                        "/v1/jobs",
                        headers={"Authorization": "Bearer test-token"},
                        files=self._files(include_npz=True),
                        data={
                            "prompt": "walk in place",
                            "subject_profile": "auto",
                            "motion_backend": "auto",
                            "seed": "11",
                        },
                    )
                    self.assertEqual(response.status_code, 202, response.text)
                    body = response.json()
                    self.assertEqual(body["subject_profile"], "quadruped")
                    self.assertEqual(body["motion_backend"], "animal_npz")
                    self.assertEqual(
                        body["profile_classification"]["reason"],
                        "animal_npz_declared_profile",
                    )
                    self.assertEqual(
                        body["profile_classification"]["classifier_resolved_profile"],
                        "character",
                    )
                    client.delete(
                        f"/v1/jobs/{body['job_id']}",
                        headers={"Authorization": "Bearer test-token"},
                    )

    def test_http_animal_npz_job_does_not_require_kimodo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(jobs_module, "JOBS_ROOT", Path(tmp)):
                test_store = JobStore()
                with (
                    patch.object(main_module, "store", test_store),
                    patch.object(
                        main_module,
                        "workers_health",
                        AsyncMock(
                            return_value=(
                                {"status": "down"},
                                {"status": "ready"},
                            )
                        ),
                    ),
                    patch.dict(
                        os.environ,
                        {"API_TOKEN": "test-token", "ALLOW_UNAUTHENTICATED_API": "false"},
                        clear=False,
                    ),
                ):
                    client = TestClient(main_module.app)
                    response = client.post(
                        "/v1/jobs",
                        headers={"Authorization": "Bearer test-token"},
                        files=self._files(include_npz=True),
                        data={
                            "prompt": "The same dog walks naturally on four legs.",
                            "subject_profile": "quadruped",
                            "motion_backend": "animal_npz",
                            "seed": "7",
                        },
                    )
                    self.assertEqual(response.status_code, 202, response.text)
                    body = response.json()
                    self.assertEqual(body["subject_profile"], "quadruped")
                    self.assertEqual(body["motion_backend"], "animal_npz")
                    self.assertEqual(
                        body["motion_input"]["schema_version"], "animal-motion-v1"
                    )
                    self.assertEqual(len(body["motion_input"]["sha256"]), 64)
                    self.assertEqual(body["motion_input"]["path"], "input/animal_motion.npz")
                    self.assertFalse(Path(body["motion_input"]["path"]).is_absolute())
                    job_id = body["job_id"]
                    test_store.update(
                        job_id,
                        status="failed",
                        stage="animal_qc_failed",
                        error={"code": "ANIMAL_QC_FAILED"},
                    )
                    debug = client.get(
                        f"/v1/jobs/{job_id}/debug",
                        headers={"Authorization": "Bearer test-token"},
                    )
                    self.assertEqual(debug.status_code, 200)
                    self.assertEqual(debug.headers["content-type"], "application/zip")
                    with zipfile.ZipFile(io.BytesIO(debug.content)) as archive:
                        self.assertIn("input/animal_motion.npz", archive.namelist())
                        self.assertIn("request.json", archive.namelist())
                    result = client.get(
                        f"/v1/jobs/{job_id}/result",
                        headers={"Authorization": "Bearer test-token"},
                    )
                    self.assertEqual(result.status_code, 409)
                    self.assertEqual(result.json()["detail"]["debug_url"], f"/v1/jobs/{job_id}/debug")
                    deleted = client.delete(
                        f"/v1/jobs/{job_id}",
                        headers={"Authorization": "Bearer test-token"},
                    )
                    self.assertEqual(deleted.status_code, 204)

    def test_http_rejects_cross_profile_backend_mix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(jobs_module, "JOBS_ROOT", Path(tmp)):
                test_store = JobStore()
                with (
                    patch.object(main_module, "store", test_store),
                    patch.dict(
                        os.environ,
                        {"API_TOKEN": "test-token", "ALLOW_UNAUTHENTICATED_API": "false"},
                        clear=False,
                    ),
                ):
                    client = TestClient(main_module.app)
                    response = client.post(
                        "/v1/jobs",
                        headers={"Authorization": "Bearer test-token"},
                        files=self._files(),
                        data={
                            "prompt": "dog",
                            "subject_profile": "quadruped",
                            "motion_backend": "kimodo",
                        },
                    )
                    self.assertEqual(response.status_code, 400)
                    self.assertIn("Kimodo is disabled", response.json()["detail"])
                    self.assertEqual(list(Path(tmp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
