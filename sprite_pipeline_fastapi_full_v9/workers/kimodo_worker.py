import json
import math
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch

from kimodo import load_model
from kimodo.constraints import Root2DConstraintSet
from kimodo.exports.motion_io import save_kimodo_npz
from kimodo.model.registry import get_model_info
from kimodo.tools import seed_everything

try:
    from .fixture_io import normalized_fixture_arrays, sha256_file
except ImportError:
    from fixture_io import normalized_fixture_arrays, sha256_file

HOST = "127.0.0.1"
PORT = 9101
MODEL_NAME = os.environ.get("KIMODO_MODEL", "Kimodo-SOMA-RP-v1.1")
DEVICE = "cuda:0"
WORKER_VERSION = "8.0.0"

MODEL = None
RESOLVED_MODEL = None
MODEL_LOCK = threading.Lock()

MOTION_SOURCE = os.environ.get("KIMODO_MOTION_SOURCE", "official_example").strip().lower()
DEFAULT_OFFICIAL_WALK_MOTION = Path(
    "/workspace/sprite-pipeline/kimodo/kimodo/assets/demo/examples/"
    "kimodo-soma-rp/05_root_path/motion.npz"
)
OFFICIAL_WALK_MOTION = Path(
    os.environ.get(
        "KIMODO_FIXTURE_MOTION",
        os.environ.get("KIMODO_OFFICIAL_WALK_MOTION", str(DEFAULT_OFFICIAL_WALK_MOTION)),
    )
)
FIXTURE_LABEL = os.environ.get(
    "KIMODO_FIXTURE_LABEL",
    "kimodo-soma-rp/05_root_path" if MOTION_SOURCE != "fixture" else OFFICIAL_WALK_MOTION.stem,
).strip()
OFFICIAL_WALK_META = Path(
    os.environ.get(
        "KIMODO_FIXTURE_META",
        os.environ.get(
            "KIMODO_OFFICIAL_WALK_META",
            str(OFFICIAL_WALK_MOTION.with_name("meta.json")),
        ),
    )
)

def _fixture_source_kind() -> str:
    return "fixture" if MOTION_SOURCE == "fixture" else "official_example"


# Current Kimodo SOMA output is exported as SOMA77.
SOMA77 = {
    "Hips": 0,
    "LeftLeg": 67,
    "LeftShin": 68,
    "LeftFoot": 69,
    "LeftToeBase": 70,
    "RightLeg": 72,
    "RightShin": 73,
    "RightFoot": 74,
    "RightToeBase": 75,
}


def load_runtime():
    global MODEL, RESOLVED_MODEL

    if MOTION_SOURCE in {"official_example", "official", "fixture"}:
        if not OFFICIAL_WALK_MOTION.exists():
            raise RuntimeError(
                "Kimodo motion fixture is missing: " + str(OFFICIAL_WALK_MOTION)
            )
        arrays, normalized_fields = normalized_fixture_arrays(OFFICIAL_WALK_MOTION)
        shape = tuple(arrays["posed_joints"].shape)
        MODEL = None
        source_kind = _fixture_source_kind()
        RESOLVED_MODEL = (
            "official-demo:kimodo-soma-rp/05_root_path"
            if source_kind == "official_example"
            else f"fixture:{FIXTURE_LABEL}"
        )
        print(
            f"[kimodo-worker] V8 source={source_kind} fixture={OFFICIAL_WALK_MOTION}",
            flush=True,
        )
        print(f"[kimodo-worker] fixture posed_joints={shape}", flush=True)
        if normalized_fields:
            print(
                f"[kimodo-worker] fixture job-copy normalization={normalized_fields}",
                flush=True,
            )
        print(
            "[kimodo-worker] Kimodo diffusion model is NOT loaded in fixture mode; "
            "the selected pre-generated fixture is used as the stable gait source.",
            flush=True,
        )
        return

    if MOTION_SOURCE not in {"generated", "model"}:
        raise RuntimeError(
            f"Unsupported KIMODO_MOTION_SOURCE={MOTION_SOURCE!r}; "
            "use official_example, fixture, or generated"
        )

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available")

    print(f"[kimodo-worker] source=generated loading {MODEL_NAME}", flush=True)

    MODEL, RESOLVED_MODEL = load_model(
        MODEL_NAME,
        device=DEVICE,
        default_family="Kimodo",
        return_resolved_name=True,
    )

    info = get_model_info(RESOLVED_MODEL)
    display = info.display_name if info else RESOLVED_MODEL

    print(f"[kimodo-worker] ready: {display} fps={MODEL.fps}", flush=True)
    print(f"[kimodo-worker] GPU: {torch.cuda.get_device_name(0)}", flush=True)
    print(
        "[kimodo-worker] allocated GiB:",
        round(torch.cuda.memory_allocated() / 1024**3, 2),
        flush=True,
    )


def _rising_edges(values: np.ndarray, threshold: float = 0.5) -> np.ndarray:
    state = np.asarray(values) > threshold
    if len(state) < 2:
        return np.empty((0,), dtype=np.int64)
    # A clip beginning in contact is not a new heel strike.
    return np.flatnonzero(state[1:] & ~state[:-1]) + 1


def _find_cycle(foot_contacts: np.ndarray, total: int) -> tuple[int, int] | None:
    if foot_contacts.ndim != 2 or foot_contacts.shape[0] != total:
        return None

    # SOMA77 exported contact order:
    # [L heel, L toe, L toe-end, R heel, R toe, R toe-end].
    heel_channels = [0, 3] if foot_contacts.shape[1] >= 6 else [0, 2]
    candidates: list[tuple[float, int, int]] = []
    for channel in heel_channels:
        edges = _rising_edges(foot_contacts[:, channel])
        for a, b in zip(edges[:-1], edges[1:]):
            period = int(b - a)
            if 18 <= period <= 60:
                midpoint = (a + b) * 0.5
                score = abs(midpoint - total * 0.55) + abs(period - 40) * 0.15
                candidates.append((float(score), int(a), int(b)))

    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    _, start, end = candidates[0]
    return start, end


def _interp(array: np.ndarray, positions: np.ndarray) -> np.ndarray:
    low = np.floor(positions).astype(np.int64)
    high = np.clip(low + 1, 0, array.shape[0] - 1)
    alpha = (positions - low).astype(np.float32)
    alpha = alpha.reshape((len(alpha),) + (1,) * (array.ndim - 1))
    return array[low] * (1.0 - alpha) + array[high] * alpha


def _joint_angle_deg(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    v1 = a - b
    v2 = c - b
    denom = np.linalg.norm(v1, axis=-1) * np.linalg.norm(v2, axis=-1)
    cosang = np.sum(v1 * v2, axis=-1) / np.maximum(denom, 1e-8)
    return np.degrees(np.arccos(np.clip(cosang, -1.0, 1.0)))


def _circular_heading_stats(global_root_heading: np.ndarray) -> tuple[float, float, float]:
    vec = np.asarray(global_root_heading[:, :2], dtype=np.float32)
    norm = np.linalg.norm(vec, axis=-1, keepdims=True)
    vec = vec / np.maximum(norm, 1e-8)
    angles = np.unwrap(np.arctan2(vec[:, 1], vec[:, 0]))
    mean = float(np.arctan2(np.mean(np.sin(angles)), np.mean(np.cos(angles))))
    centered = np.angle(np.exp(1j * (angles - mean)))
    return (
        float(np.degrees(mean)),
        float(np.degrees(np.std(centered))),
        float(np.degrees(np.max(angles) - np.min(angles))),
    )


def _evaluate_motion(output: dict) -> dict:
    joints = np.asarray(output["posed_joints"], dtype=np.float32)
    roots = np.asarray(output["root_positions"], dtype=np.float32)
    contacts = np.asarray(output.get("foot_contacts"), dtype=np.float32)
    heading = np.asarray(output.get("global_root_heading"), dtype=np.float32)

    if joints.ndim == 4 and joints.shape[0] == 1:
        joints = joints[0]
    if roots.ndim == 3 and roots.shape[0] == 1:
        roots = roots[0]
    if contacts.ndim == 3 and contacts.shape[0] == 1:
        contacts = contacts[0]
    if heading.ndim == 3 and heading.shape[0] == 1:
        heading = heading[0]

    if joints.ndim != 3 or joints.shape[1] < 77:
        return {"ok": False, "errors": [f"unexpected posed_joints shape {joints.shape}"]}

    total = joints.shape[0]
    cycle = _find_cycle(contacts, total)
    if cycle is None:
        return {"ok": False, "errors": ["no complete same-foot gait cycle detected"]}

    start, end = cycle
    positions = np.linspace(start, end, 17, dtype=np.float32)
    j = _interp(joints, positions)

    # Body-local lateral axis is derived directly from right-hip - left-hip.
    # This is invariant to the character's global yaw, so it exposes a real
    # cross-step instead of a projection artifact.
    left_hip = j[:, SOMA77["LeftLeg"], :][:, [0, 2]]
    right_hip = j[:, SOMA77["RightLeg"], :][:, [0, 2]]
    lateral = right_hip - left_hip
    lateral /= np.maximum(np.linalg.norm(lateral, axis=-1, keepdims=True), 1e-8)
    pelvis = j[:, SOMA77["Hips"], :][:, [0, 2]]

    left_foot = j[:, SOMA77["LeftFoot"], :][:, [0, 2]]
    right_foot = j[:, SOMA77["RightFoot"], :][:, [0, 2]]
    left_lane = np.sum((left_foot - pelvis) * lateral, axis=-1)
    right_lane = np.sum((right_foot - pelvis) * lateral, axis=-1)

    cross_margin = 0.025
    left_cross = left_lane > cross_margin
    right_cross = right_lane < -cross_margin
    cross_any_fraction = float(np.mean(left_cross | right_cross))
    max_cross = float(max(0.0, np.max(left_lane), -np.min(right_lane)))
    min_step_width = float(np.min(right_lane - left_lane))

    ground = np.minimum.reduce(
        [
            j[:, SOMA77["LeftFoot"], 1],
            j[:, SOMA77["LeftToeBase"], 1],
            j[:, SOMA77["RightFoot"], 1],
            j[:, SOMA77["RightToeBase"], 1],
        ]
    )
    left_ankle_lift = j[:, SOMA77["LeftFoot"], 1] - ground
    right_ankle_lift = j[:, SOMA77["RightFoot"], 1] - ground
    max_ankle_lift = float(max(np.max(left_ankle_lift), np.max(right_ankle_lift)))

    left_knee_angle = _joint_angle_deg(
        j[:, SOMA77["LeftLeg"]],
        j[:, SOMA77["LeftShin"]],
        j[:, SOMA77["LeftFoot"]],
    )
    right_knee_angle = _joint_angle_deg(
        j[:, SOMA77["RightLeg"]],
        j[:, SOMA77["RightShin"]],
        j[:, SOMA77["RightFoot"]],
    )
    max_knee_flex = float(
        max(np.max(180.0 - left_knee_angle), np.max(180.0 - right_knee_angle))
    )

    root_x = roots[:, 0] - roots[0, 0]
    root_z = roots[:, 2] - roots[0, 2]
    max_lateral_root_drift = float(np.max(np.abs(root_x)))
    net_forward = float(root_z[-1])

    if heading.ndim == 2 and heading.shape[0] == total and heading.shape[1] >= 2:
        heading_mean_deg, heading_std_deg, heading_range_deg = _circular_heading_stats(heading)
    else:
        heading_mean_deg = heading_std_deg = heading_range_deg = float("nan")

    errors = []
    if cross_any_fraction > 0.12:
        errors.append(f"feet cross body midline in {cross_any_fraction:.0%} of sampled phases")
    if max_cross > 0.060:
        errors.append(f"max foot cross-over is {max_cross:.3f} m")
    if min_step_width < -0.040:
        errors.append(f"left/right foot lane order reverses ({min_step_width:.3f} m)")
    if max_ankle_lift > 0.260:
        errors.append(f"ankle lift is too high for neutral walk ({max_ankle_lift:.3f} m)")
    if max_knee_flex > 100.0:
        errors.append(f"knee flexion is too high for neutral walk ({max_knee_flex:.1f} deg)")
    if max_lateral_root_drift > 0.18:
        errors.append(f"root drifts sideways ({max_lateral_root_drift:.3f} m)")
    if np.isfinite(heading_range_deg) and heading_range_deg > 18.0:
        errors.append(f"heading changes too much ({heading_range_deg:.1f} deg)")
    if net_forward < 0.75:
        errors.append(f"forward displacement too small ({net_forward:.3f} m)")

    return {
        "ok": not errors,
        "errors": errors,
        "cycle_start": int(start),
        "cycle_end": int(end),
        "cycle_period_frames": int(end - start),
        "cross_any_fraction": cross_any_fraction,
        "max_cross_m": max_cross,
        "min_step_width_m": min_step_width,
        "max_ankle_lift_m": max_ankle_lift,
        "max_knee_flex_deg": max_knee_flex,
        "max_lateral_root_drift_m": max_lateral_root_drift,
        "net_forward_m": net_forward,
        "heading_mean_deg": heading_mean_deg,
        "heading_std_deg": heading_std_deg,
        "heading_range_deg": heading_range_deg,
    }


def _build_walk_prompt(user_prompt: str) -> str:
    user_prompt = user_prompt.strip()
    if user_prompt and not user_prompt.endswith((".", "!", "?")):
        user_prompt += "."

    # V1 is a walk-cycle service. This prefix prevents the unconstrained text
    # model from interpreting a generic "walk" as catwalk/cross-step/prancing.
    base = (
        "A person performs an ordinary neutral human walk straight forward at a relaxed steady pace. "
        "Balanced alternating heel-to-toe steps, natural arm swing, low foot clearance, and moderate knee bend. "
        "Each foot stays on its own side of the body midline with normal hip-width step lanes. "
        "The path is straight and the body keeps a constant forward heading. "
        "No leg crossing, no cross-step, no catwalk, no side-step, no skipping, no hopping, "
        "no exaggerated high knees, no dance, no turn, and no sideways drift. "
    )
    if user_prompt:
        base += "Additional motion detail: " + user_prompt
    return base


def _build_root_constraint(num_frames: int, duration: float) -> Root2DConstraintSet:
    # Straight +Z trajectory with explicit +Z heading. Kimodo docs define
    # first_heading_angle=0 as +Z and root2d as [x,z] meters.
    dense = os.environ.get("KIMODO_DENSE_ROOT_CONSTRAINT", "true").strip().lower()
    dense = dense in {"1", "true", "yes", "on"}
    if dense:
        frame_indices = np.arange(num_frames, dtype=np.int64)
    else:
        count = min(7, max(4, int(round(duration * 2.0)) + 1))
        frame_indices = np.linspace(0, num_frames - 1, count).round().astype(np.int64)
        frame_indices = np.unique(frame_indices)

    # Relaxed neutral walking speed. The result is later converted to in-place,
    # so this path exists only to make Kimodo synthesize a clean locomotion gait.
    total_distance = float(np.clip(duration * 0.55, 1.2, 1.8))
    progress = frame_indices.astype(np.float32) / float(max(num_frames - 1, 1))
    smooth_root = np.stack(
        [np.zeros_like(progress), progress * total_distance], axis=-1
    ).astype(np.float32)
    heading = np.tile(np.array([[1.0, 0.0]], dtype=np.float32), (len(frame_indices), 1))

    return Root2DConstraintSet(
        MODEL.skeleton,
        frame_indices=torch.tensor(frame_indices, dtype=torch.long, device=DEVICE),
        smooth_root_2d=torch.tensor(smooth_root, dtype=torch.float32, device=DEVICE),
        global_root_heading=torch.tensor(heading, dtype=torch.float32, device=DEVICE),
    )


def _split_single_output(output: dict) -> dict:
    n_samples = int(output["posed_joints"].shape[0])
    if n_samples != 1:
        raise RuntimeError(f"Expected exactly one sample, got {n_samples}")

    single = {}
    for key, value in output.items():
        if hasattr(value, "shape") and len(value.shape) > 0 and value.shape[0] == 1:
            single[key] = value[0]
        else:
            single[key] = value
    return single


def _fixture_motion(payload: dict) -> dict:
    user_prompt = str(payload.get("prompt", "")).strip()
    if not user_prompt:
        raise ValueError("prompt is required")

    seed = int(payload.get("seed", 42))
    output_path = Path(payload["output_path"])
    if output_path.suffix != ".npz":
        output_path = output_path.with_suffix(".npz")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    qc_path = output_path.with_suffix(".qc.json")

    if not OFFICIAL_WALK_MOTION.exists():
        raise RuntimeError("Kimodo motion fixture missing: " + str(OFFICIAL_WALK_MOTION))

    arrays, normalized_fields = normalized_fixture_arrays(OFFICIAL_WALK_MOTION)
    # Never mutate the repository fixture. Write a normalized job-local copy so
    # a clean Kimodo clone works even when the shipped example omits derived
    # fields such as root_positions/global_root_heading.
    np.savez_compressed(output_path, **arrays)

    official_meta = {}
    if OFFICIAL_WALK_META.exists():
        try:
            official_meta = json.loads(OFFICIAL_WALK_META.read_text(encoding="utf-8"))
        except Exception:
            official_meta = {}

    with np.load(output_path, allow_pickle=False) as data:
        joints = np.asarray(data["posed_joints"])
        frames = int(joints.shape[-3] if joints.ndim == 4 else joints.shape[0])
        joints_count = int(joints.shape[-2])

    source_kind = _fixture_source_kind()
    is_official = source_kind == "official_example"
    meta_request = official_meta.get("request", {}) if isinstance(official_meta, dict) else {}
    fixture_prompt = official_meta.get("text") or meta_request.get("prompt")
    fixture_seed = official_meta.get("seed", meta_request.get("seed"))
    fixture_duration = official_meta.get("duration", meta_request.get("duration"))
    report = {
        "worker_version": WORKER_VERSION,
        "status": "accepted",
        "motion_source": source_kind,
        "fixture": str(OFFICIAL_WALK_MOTION),
        "fixture_label": FIXTURE_LABEL,
        "fixture_sha256": sha256_file(OFFICIAL_WALK_MOTION),
        "job_motion_sha256": sha256_file(output_path),
        "normalized_fields": normalized_fields,
        "official_example": "kimodo-soma-rp/05_root_path" if is_official else None,
        "official_prompt": official_meta.get("text") if is_official else None,
        "official_seed": official_meta.get("seed") if is_official else None,
        "official_duration": fixture_duration if is_official else None,
        "fixture_prompt": fixture_prompt,
        "fixture_seed": fixture_seed,
        "fixture_duration": fixture_duration,
        "fixture_meta": official_meta,
        "client_prompt": user_prompt,
        "client_seed": seed,
        "client_prompt_affects_motion": False,
        "client_seed_affects_motion": False,
        "frames": frames,
        "joints": joints_count,
        "note": (
            "V8 uses the selected pre-generated motion as a deterministic gait fixture. "
            "The client prompt/seed still affect downstream rendering, but do not "
            "regenerate the gait in fixture mode."
        ),
    }
    qc_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "status": "ok",
        "motion_path": str(output_path),
        "motion_qc_path": str(qc_path),
        "frames": frames,
        "fps": 30.0,
        "model": RESOLVED_MODEL,
        "worker_version": WORKER_VERSION,
        "motion_source": source_kind,
        "fixture": str(OFFICIAL_WALK_MOTION),
        "fixture_label": FIXTURE_LABEL,
        "client_seed": seed,
        "selected_generation_seed": fixture_seed,
        "motion_qc": report,
        "allocated_gib": round(torch.cuda.memory_allocated() / 1024**3, 2) if torch.cuda.is_available() else 0.0,
        "reserved_gib": round(torch.cuda.memory_reserved() / 1024**3, 2) if torch.cuda.is_available() else 0.0,
    }


def generate_motion(payload: dict) -> dict:
    if MOTION_SOURCE in {"official_example", "official", "fixture"}:
        return _fixture_motion(payload)

    if MODEL is None:
        raise RuntimeError("Kimodo model is not loaded")

    user_prompt = str(payload.get("prompt", "")).strip()
    if not user_prompt:
        raise ValueError("prompt is required")

    seed = int(payload.get("seed", 42))
    duration = float(payload.get("duration", 3.0))
    diffusion_steps = int(payload.get("diffusion_steps", 100))
    max_attempts = int(
        payload.get(
            "max_motion_attempts",
            os.environ.get("KIMODO_MAX_MOTION_ATTEMPTS", "8"),
        )
    )
    max_attempts = max(1, min(max_attempts, 16))

    output_path = Path(payload["output_path"])
    if output_path.suffix != ".npz":
        output_path = output_path.with_suffix(".npz")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    qc_path = output_path.with_suffix(".qc.json")

    num_frames = int(round(duration * float(MODEL.fps)))
    if num_frames < 2:
        raise ValueError("duration is too short")

    effective_prompt = _build_walk_prompt(user_prompt)
    attempts = []
    selected_single = None
    selected_seed = None
    selected_qc = None

    with MODEL_LOCK:
        for attempt in range(max_attempts):
            # Prime stride keeps retries deterministic for the same client seed.
            attempt_seed = seed + attempt * 104729
            seed_everything(attempt_seed)
            constraint = _build_root_constraint(num_frames, duration)

            print(
                f"[kimodo-worker] generation attempt {attempt + 1}/{max_attempts} seed={attempt_seed}",
                flush=True,
            )

            with torch.inference_mode():
                output = MODEL(
                    effective_prompt,
                    num_frames,
                    constraint_lst=[constraint],
                    num_denoising_steps=diffusion_steps,
                    num_samples=1,
                    multi_prompt=False,
                    first_heading_angle=torch.tensor([0.0], device=DEVICE),
                    cfg_type="separated",
                    cfg_weight=[2.0, 2.0],
                    post_processing=True,
                    root_margin=0.03,
                    return_numpy=True,
                )

            single = _split_single_output(output)
            qc = _evaluate_motion(single)
            qc["attempt"] = attempt + 1
            qc["generation_seed"] = attempt_seed
            attempts.append(qc)

            print(
                "[kimodo-worker] motion QC:",
                json.dumps(qc, ensure_ascii=False),
                flush=True,
            )

            if qc["ok"]:
                selected_single = single
                selected_seed = attempt_seed
                selected_qc = qc
                break

        if selected_single is None:
            report = {
                "worker_version": WORKER_VERSION,
                "status": "rejected",
                "client_seed": seed,
                "effective_prompt": effective_prompt,
                "attempts": attempts,
            }
            qc_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            raise RuntimeError(
                "Kimodo failed neutral-walk motion QC after "
                f"{max_attempts} attempts: {attempts[-1].get('errors', [])}"
            )

        save_kimodo_npz(str(output_path), selected_single)
        torch.cuda.synchronize()

    report = {
        "worker_version": WORKER_VERSION,
        "status": "accepted",
        "client_seed": seed,
        "selected_generation_seed": selected_seed,
        "effective_prompt": effective_prompt,
        "attempts": attempts,
        "selected_qc": selected_qc,
    }
    qc_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if not output_path.exists():
        raise RuntimeError("Kimodo NPZ was not created")

    return {
        "status": "ok",
        "motion_path": str(output_path),
        "motion_qc_path": str(qc_path),
        "frames": num_frames,
        "fps": float(MODEL.fps),
        "model": RESOLVED_MODEL,
        "worker_version": WORKER_VERSION,
        "client_seed": seed,
        "selected_generation_seed": selected_seed,
        "motion_qc": selected_qc,
        "allocated_gib": round(torch.cuda.memory_allocated() / 1024**3, 2),
        "reserved_gib": round(torch.cuda.memory_reserved() / 1024**3, 2),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = f"KimodoWorker/{WORKER_VERSION}"

    def log_message(self, fmt, *args):
        print("[kimodo-worker]", fmt % args, flush=True)

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "status": "ready",
                    "model": RESOLVED_MODEL,
                    "worker_version": WORKER_VERSION,
                    "motion_source": (
                        _fixture_source_kind()
                        if MOTION_SOURCE in {"official_example", "official", "fixture"}
                        else MOTION_SOURCE
                    ),
                    "fixture": str(OFFICIAL_WALK_MOTION) if MOTION_SOURCE in {"official_example", "official", "fixture"} else None,
                    "fixture_label": FIXTURE_LABEL if MOTION_SOURCE in {"official_example", "official", "fixture"} else None,
                    "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                    "allocated_gib": round(torch.cuda.memory_allocated() / 1024**3, 2) if torch.cuda.is_available() else 0.0,
                },
            )
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/generate":
            self._send_json(404, {"error": "not found"})
            return

        try:
            self._send_json(200, generate_motion(self._read_json()))
        except Exception as exc:
            traceback.print_exc()
            self._send_json(
                500,
                {
                    "status": "error",
                    "error": type(exc).__name__,
                    "message": str(exc),
                },
            )


def main():
    load_runtime()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[kimodo-worker] listening http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
