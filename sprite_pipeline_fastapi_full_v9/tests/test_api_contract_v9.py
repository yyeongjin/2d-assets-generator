from __future__ import annotations

import asyncio
import inspect
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from server.app import jobs as jobs_module
from server.app.jobs import JobStore
from server.app.main import app, create_job, require_auth
from server.app.pipeline import create_failure_debug_zip


class ApiContractV9Tests(unittest.TestCase):
    def test_route_surface_includes_job_lifecycle_endpoints(self) -> None:
        routes = {
            (method, route.path)
            for route in app.routes
            for method in getattr(route, "methods", set())
        }
        self.assertIn(("POST", "/v1/jobs"), routes)
        self.assertIn(("GET", "/v1/jobs/{job_id}"), routes)
        self.assertIn(("GET", "/v1/jobs/{job_id}/result"), routes)
        self.assertIn(("GET", "/v1/jobs/{job_id}/debug"), routes)
        self.assertIn(("DELETE", "/v1/jobs/{job_id}"), routes)

    def test_create_job_signature_exposes_v9_routing_contract(self) -> None:
        parameters = inspect.signature(create_job).parameters
        for name in (
            "front",
            "back",
            "left",
            "right",
            "prompt",
            "seed",
            "subject_profile",
            "motion_backend",
            "motion_npz",
        ):
            self.assertIn(name, parameters)

    def test_auth_is_fail_closed_without_token(self) -> None:
        with patch.dict(
            "os.environ",
            {"API_TOKEN": "", "ALLOW_UNAUTHENTICATED_API": "false"},
            clear=False,
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(require_auth(None))
        self.assertEqual(raised.exception.status_code, 503)

    def test_auth_accepts_exact_bearer_token(self) -> None:
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="v9-test-token"
        )
        with patch.dict(
            "os.environ",
            {"API_TOKEN": "v9-test-token", "ALLOW_UNAUTHENTICATED_API": "false"},
            clear=False,
        ):
            self.assertIsNone(asyncio.run(require_auth(credentials)))

    def test_auth_rejects_non_ascii_token_without_internal_error(self) -> None:
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="잘못된-토큰"
        )
        with patch.dict(
            "os.environ",
            {"API_TOKEN": "v9-test-token", "ALLOW_UNAUTHENTICATED_API": "false"},
            clear=False,
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(require_auth(credentials))
        self.assertEqual(raised.exception.status_code, 401)

    def test_job_store_recovers_queued_job_and_deletes_finished_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(jobs_module, "JOBS_ROOT", root):
                store = JobStore()
                job_id = "a" * 32
                store.create(
                    job_id=job_id,
                    prompt="test animal",
                    seed=7,
                    inputs={direction: f"/{direction}.png" for direction in ("front", "back", "left", "right")},
                    subject_profile="quadruped",
                    motion_backend="animal_npz",
                    requested_motion_backend="auto",
                    motion_routing={"reason": "uploaded_animal_npz_present"},
                    motion_input={"sha256": "deadbeef"},
                )
                recovered = store.recoverable_jobs()
                self.assertEqual(recovered, [job_id])
                status = store.get(job_id)
                self.assertEqual(status["stage"], "recovered_after_restart")
                self.assertEqual(status["motion_backend"], "animal_npz")
                store.update(job_id, status="failed")
                self.assertTrue(store.delete(job_id))
                self.assertFalse(root.joinpath(job_id).exists())

    def test_processing_job_cannot_be_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(jobs_module, "JOBS_ROOT", root):
                store = JobStore()
                job_id = "b" * 32
                store.create(
                    job_id=job_id,
                    prompt="test",
                    seed=1,
                    inputs={},
                )
                store.update(job_id, status="processing")
                with self.assertRaises(RuntimeError):
                    store.delete(job_id)

    def test_failure_debug_zip_preserves_request_and_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.joinpath("request.json").write_text(
                json.dumps({"motion_backend": "animal_npz"}), encoding="utf-8"
            )
            root.joinpath("status.json").write_text(
                json.dumps({"status": "failed"}), encoding="utf-8"
            )
            output = create_failure_debug_zip(root)
            self.assertTrue(output.exists())
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(
                    set(archive.namelist()), {"request.json", "status.json"}
                )


if __name__ == "__main__":
    unittest.main()
