import asyncio
import importlib.util
import json
import os
import zipfile
from pathlib import Path

import httpx
from PIL import Image

from .animal_qc import evaluate_animal_render_attempt, write_animal_qc
from .appearance_postprocess import stabilize_appearance_attempt
from .jobs import JobStore
from .loop_postprocess import (
    copy_selected_frames,
    evaluate_render_attempt,
    write_report,
)

ROOT = Path(os.environ.get("SPRITE_PIPELINE_ROOT", "/workspace/sprite-pipeline"))
KIMODO_WORKER_URL = os.environ.get("KIMODO_WORKER_URL", "http://127.0.0.1:9101")
OTA_WORKER_URL = os.environ.get("OTA_WORKER_URL", "http://127.0.0.1:9102")
DIRECTIONS = ("front", "back", "left", "right")
PIPELINE_VERSION = "9.0.0"

VIEW_PROMPTS = {
    "front": "fixed exact front view, facing the camera, hips and shoulders square to camera",
    "back": "fixed exact back view, facing directly away from the camera, hips and shoulders square to camera",
    "left": "fixed exact left-side profile view, facing screen-right",
    "right": "fixed exact right-side profile view, facing screen-left",
}


class PipelineError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def request_json(client: httpx.AsyncClient, method: str, url: str, **kwargs) -> dict:
    try:
        response = await client.request(method, url, **kwargs)
    except httpx.ConnectError as exc:
        raise PipelineError("WORKER_UNREACHABLE", f"Worker unreachable: {url}") from exc

    if response.status_code >= 400:
        raise PipelineError("WORKER_FAILED", f"{url} returned {response.status_code}: {response.text}")
    return response.json()


def _load_adapter_function(filename: str, module_name: str, function_name: str):
    # Load by absolute file path. Do not put /workspace/sprite-pipeline on
    # PYTHONPATH: that directory also contains the Kimodo repo folder named
    # `kimodo`, which can shadow the real installed Kimodo Python package.
    path = ROOT / "adapter" / filename
    try:
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return getattr(module, function_name)
    except Exception as exc:
        raise PipelineError("MOTION_ADAPTER_IMPORT_FAILED", f"{path}: {exc}") from exc


def load_adapter():
    return _load_adapter_function("service.py", "sprite_motion_adapter", "build_pose_controls")


def load_animal_adapter():
    return _load_adapter_function(
        "animal_service.py",
        "sprite_animal_motion_adapter",
        "build_animal_pose_controls",
    )


def create_sprite_sheet(result_root: Path) -> Path:
    first = Image.open(result_root / "front" / "0.png").convert("RGBA")
    width, height = first.size
    sheet = Image.new("RGBA", (width * 8, height * 4), (0, 0, 0, 0))

    for row, direction in enumerate(DIRECTIONS):
        for column in range(8):
            image = Image.open(result_root / direction / f"{column}.png").convert("RGBA")
            if image.size != (width, height):
                image = image.resize((width, height), Image.Resampling.LANCZOS)
            sheet.alpha_composite(image, (column * width, row * height))

    output = result_root / "sprite_sheet.png"
    sheet.save(output)
    return output


def create_metadata(
    job_id: str,
    prompt: str,
    seed: int,
    result_root: Path,
    pose_root: Path,
    loop_report: dict,
    subject_profile: str,
    profile_classification: dict,
    motion_backend: str,
    motion_routing: dict,
    motion_input: dict,
):
    adapter_meta = {}
    adapter_meta_path = pose_root / "adapter_meta.json"
    if adapter_meta_path.exists():
        with adapter_meta_path.open("r", encoding="utf-8") as f:
            adapter_meta = json.load(f)

    motion_qc = {}
    motion_qc_path = result_root.parent / "motion" / "motion.qc.json"
    if motion_qc_path.exists():
        with motion_qc_path.open("r", encoding="utf-8") as f:
            motion_qc = json.load(f)

    metadata = {
        "pipeline_version": PIPELINE_VERSION,
        "job_id": job_id,
        "animation": "walk",
        "prompt": prompt,
        "seed": seed,
        "subject_profile": subject_profile,
        "profile_classification": profile_classification,
        "motion_backend": motion_backend,
        "motion_engine": motion_backend,
        "motion_routing": motion_routing,
        "motion_input": motion_input,
        "motion_qc": motion_qc,
        "kimodo_motion_qc": {
            "worker_version": motion_qc.get("worker_version"),
            "motion_source": motion_qc.get("motion_source", "generated"),
            "fixture": motion_qc.get("fixture"),
            "fixture_label": motion_qc.get("fixture_label"),
            "fixture_sha256": motion_qc.get("fixture_sha256"),
            "job_motion_sha256": motion_qc.get("job_motion_sha256"),
            "normalized_fields": motion_qc.get("normalized_fields", []),
            "official_example": motion_qc.get("official_example"),
            "official_prompt": motion_qc.get("official_prompt"),
            "fixture_prompt": motion_qc.get("fixture_prompt"),
            "fixture_seed": motion_qc.get("fixture_seed"),
            "fixture_duration": motion_qc.get("fixture_duration"),
            "fixture_meta": motion_qc.get("fixture_meta"),
            "selected_generation_seed": motion_qc.get("selected_generation_seed"),
            "selected_qc": motion_qc.get("selected_qc"),
        },
        "directions": list(DIRECTIONS),
        "frames_per_direction": 8,
        "source_motion_frames": 17,
        "selected_phase_indices": list(loop_report["selected_phase_indices"]),
        "loop": True,
        "loop_postprocess": {
            "version": loop_report.get("version"),
            "ok": loop_report.get("ok"),
            "selected_attempt": loop_report.get("selected_attempt"),
            "selected_render_seed": loop_report.get("selected_render_seed"),
            "selected_candidate": loop_report.get("selected_candidate"),
            "selected_phase_indices": loop_report.get("selected_phase_indices"),
            "selected_score": loop_report.get("selected_score"),
            "selected_metrics": loop_report.get("selected_metrics"),
            "thresholds": loop_report.get("thresholds"),
            "attempts": loop_report.get("attempts", []),
        },
        "animal_qc": {
            "version": loop_report.get("animal", {}).get("version"),
            "enabled": loop_report.get("animal", {}).get("enabled", False),
            "ok": loop_report.get("animal", {}).get("ok"),
            "score": loop_report.get("animal", {}).get("score"),
            "errors": loop_report.get("animal", {}).get("errors", []),
            "directions": {
                direction: {
                    "ok": loop_report.get("animal", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("ok"),
                    "errors": loop_report.get("animal", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("errors", []),
                    "metrics": loop_report.get("animal", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("metrics", {}),
                }
                for direction in DIRECTIONS
            },
        },
        "appearance_postprocess": {
            "version": loop_report.get("appearance", {}).get("version"),
            "enabled": loop_report.get("appearance", {}).get("enabled"),
            "ok": loop_report.get("appearance", {}).get("ok"),
            "score": loop_report.get("appearance", {}).get("score"),
            "errors": loop_report.get("appearance", {}).get("errors", []),
            "config": loop_report.get("appearance", {}).get("config", {}),
            "palette_rgb": loop_report.get("appearance", {}).get("palette_rgb", []),
            "directions": {
                direction: {
                    "ok": loop_report.get("appearance", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("ok"),
                    "errors": loop_report.get("appearance", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("errors", []),
                    "before": loop_report.get("appearance", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("before", {}),
                    "after": loop_report.get("appearance", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("after", {}),
                    "mean_correction_delta_e": loop_report.get("appearance", {})
                    .get("directions", {})
                    .get(direction, {})
                    .get("mean_correction_delta_e"),
                }
                for direction in DIRECTIONS
            },
        },
        "motion_adapter": {
            "version": adapter_meta.get("adapter_version"),
            "kind": adapter_meta.get("adapter_kind", "kimodo_human_projection"),
            "subject_profile": adapter_meta.get("subject_profile", subject_profile),
            "kimodo_bypassed": adapter_meta.get("kimodo_bypassed", False),
            "human_reference_pose_detector_bypassed": adapter_meta.get(
                "human_reference_pose_detector_bypassed", False
            ),
            "cycle_start": adapter_meta.get("cycle_start"),
            "cycle_end": adapter_meta.get("cycle_end"),
            "heading_source": adapter_meta.get("heading_source"),
            "canonical_heading_degrees": adapter_meta.get("canonical_heading_degrees"),
            "canonicalization_delta_degrees": adapter_meta.get("canonicalization_delta_degrees"),
            "gait_quality": adapter_meta.get("gait_quality"),
            "cardinal_quality": adapter_meta.get("cardinal_quality"),
            "cardinal_config": adapter_meta.get("cardinal_config"),
            "control_endpoint_duplicates_phase_zero": adapter_meta.get(
                "control_endpoint_duplicates_phase_zero"
            ),
            "control_source_positions": adapter_meta.get("control_source_positions"),
            "validation": adapter_meta.get("validation"),
        },
    }
    path = result_root / "metadata.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    return path


def create_zip(
    result_root: Path,
    pose_root: Path,
    selected_render_root: Path,
) -> Path:
    output = result_root / "result.zip"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for direction in DIRECTIONS:
            for index in range(8):
                source = result_root / direction / f"{index}.png"
                zf.write(source, arcname=f"{direction}/{index}.png")
        zf.write(result_root / "sprite_sheet.png", arcname="sprite_sheet.png")
        zf.write(result_root / "metadata.json", arcname="metadata.json")
        loop_qc = result_root / "loop_qc.json"
        if loop_qc.exists():
            zf.write(loop_qc, arcname="debug/loop_qc.json")
        appearance_qc = selected_render_root / "appearance_qc.json"
        if appearance_qc.exists():
            zf.write(appearance_qc, arcname="debug/appearance_qc.json")
        animal_qc = result_root / "animal_qc.json"
        if animal_qc.exists():
            zf.write(animal_qc, arcname="debug/animal_qc.json")
        profile_classification = result_root.parent / "profile_classification.json"
        if profile_classification.exists():
            zf.write(profile_classification, arcname="debug/profile_classification.json")

        motion_qc = result_root.parent / "motion" / "motion.qc.json"
        if motion_qc.exists():
            zf.write(motion_qc, arcname="debug/motion_qc.json")

        # Debug controls are deliberately included so a bad diffusion result can
        # be separated from a bad motion projection without rerunning Kimodo.
        preview = pose_root / "pose_preview.png"
        if preview.exists():
            zf.write(preview, arcname="debug/pose_preview.png")
        for name in ("adapter_meta.json", "adapter_validation.json"):
            p = pose_root / name
            if p.exists():
                zf.write(p, arcname=f"debug/{name}")
        for direction in DIRECTIONS:
            d = pose_root / direction
            for name in (
                "reference_pose.png",
                "control_000.png",
                "control_008.png",
                "control_016.png",
                "control_meta.json",
                "keypoints.json",
            ):
                p = d / name
                if p.exists():
                    zf.write(p, arcname=f"debug/{direction}/{name}")
            render_meta = selected_render_root / direction / "render_meta.json"
            if render_meta.exists():
                zf.write(render_meta, arcname=f"debug/{direction}/render_meta.json")
            appearance_meta = selected_render_root / direction / "appearance_meta.json"
            if appearance_meta.exists():
                zf.write(
                    appearance_meta,
                    arcname=f"debug/{direction}/appearance_meta.json",
                )
    return output



def create_failure_debug_zip(root: Path) -> Path:
    output = root / "failure_debug.zip"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for relative in (
            "request.json",
            "status.json",
            "profile_classification.json",
            "loop_qc_failed.json",
            "motion/motion.qc.json",
            "pose/pose_preview.png",
            "pose/adapter_meta.json",
            "pose/adapter_validation.json",
            "input/animal_motion.npz",
        ):
            path = root / relative
            if path.exists() and path.is_file():
                zf.write(path, arcname=relative)
        for direction in DIRECTIONS:
            for relative in (
                f"input/{direction}.png",
                f"pose/{direction}/keypoints.json",
                f"pose/{direction}/control_meta.json",
                f"pose/{direction}/reference_pose.png",
            ):
                path = root / relative
                if path.exists() and path.is_file():
                    zf.write(path, arcname=relative)
        rendered_root = root / "rendered"
        if rendered_root.exists():
            for path in sorted(rendered_root.rglob("*.json")):
                zf.write(path, arcname=str(path.relative_to(root)))
            # Include only representative frames to keep failed artifacts compact.
            for attempt in sorted(rendered_root.glob("attempt_*")):
                for direction in DIRECTIONS:
                    directory = attempt / direction
                    for name in ("frame_000.png", "frame_004.png", "frame_008.png", "frame_012.png", "frame_016.png"):
                        path = directory / name
                        if path.exists():
                            zf.write(path, arcname=str(path.relative_to(root)))
    return output

def build_render_prompt(
    direction: str,
    user_prompt: str,
    subject_profile: str = "character",
) -> str:
    if subject_profile == "quadruped":
        identity = (
            "Exactly one same four-legged animal from the reference. Preserve species, head, muzzle, ears, tail, coat pattern, colors, body length, belly height, and exactly four legs. "
            "Keep a horizontal quadruped torso and natural animal joints. Never turn it into a person, humanoid, upright mascot, centaur, or two-legged character. "
            "No duplicated animal, no extra legs, no missing legs, no fused legs, no detached body parts. "
        )
    elif subject_profile == "biped_animal":
        identity = (
            "Exactly one same non-human biped animal or creature from the reference. Preserve species, head shape, eyes, snout or beak, tail, scales or fur, colors, compact body proportions, and exactly two walking legs. "
            "Keep the creature visibly non-human; do not replace it with a realistic person or human skeleton. No duplicated subject, extra limbs, missing limbs, detached body parts, or species change. "
        )
    else:
        identity = (
            "Same character identity, identical hat, identical clothing, identical colors and "
            "body proportions as the reference image. "
        )

    if direction == "back":
        identity += "Keep the back of the head visible and do not reveal the face. "
    elif direction in {"left", "right"}:
        identity += "Preserve the exact side-profile identity and facing direction shown in the reference. "
    else:
        identity += "Preserve the exact front-facing identity shown in the reference. "

    return (
        identity
        + "Full body visible. "
        + f"{VIEW_PROMPTS[direction]}. Walking in place with a fixed camera, fixed framing, "
        + "no camera movement, no zoom, no viewpoint rotation. "
        + "Seamless cyclic walk loop, stable subject position, constant palette, stable lighting, and consistent appearance at the repeated phase-zero pose. "
        + f"Motion instruction: {user_prompt}"
    )


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_float(
    name: str,
    default: float,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    value = os.environ.get(name)
    try:
        parsed = default if value is None else float(value)
    except ValueError as exc:
        raise PipelineError("INVALID_ENV", f"{name} must be numeric") from exc
    if minimum is not None and parsed < minimum:
        raise PipelineError("INVALID_ENV", f"{name} must be >= {minimum}")
    if maximum is not None and parsed > maximum:
        raise PipelineError("INVALID_ENV", f"{name} must be <= {maximum}")
    return float(parsed)


def env_int(
    name: str,
    default: int,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    value = os.environ.get(name)
    try:
        parsed = default if value is None else int(value)
    except ValueError as exc:
        raise PipelineError("INVALID_ENV", f"{name} must be an integer") from exc
    if minimum is not None and parsed < minimum:
        raise PipelineError("INVALID_ENV", f"{name} must be >= {minimum}")
    if maximum is not None and parsed > maximum:
        raise PipelineError("INVALID_ENV", f"{name} must be <= {maximum}")
    return int(parsed)


def ota_guidance(direction: str, subject_profile: str = "character") -> tuple[float, float]:
    if subject_profile == "quadruped":
        if direction in {"front", "back"}:
            return (
                env_float("OTA_ANIMAL_FRONT_BACK_IMAGE_GUIDANCE_SCALE", 3.25, 0.0, 10.0),
                env_float("OTA_ANIMAL_FRONT_BACK_POSE_GUIDANCE_SCALE", 1.05, 0.0, 10.0),
            )
        return (
            env_float("OTA_ANIMAL_SIDE_IMAGE_GUIDANCE_SCALE", 3.35, 0.0, 10.0),
            env_float("OTA_ANIMAL_SIDE_POSE_GUIDANCE_SCALE", 1.15, 0.0, 10.0),
        )
    if subject_profile == "biped_animal":
        return (
            env_float("OTA_BIPED_ANIMAL_IMAGE_GUIDANCE_SCALE", 3.10, 0.0, 10.0),
            env_float("OTA_BIPED_ANIMAL_POSE_GUIDANCE_SCALE", 1.20, 0.0, 10.0),
        )
    if direction in {"front", "back"}:
        return (
            env_float("OTA_FRONT_BACK_IMAGE_GUIDANCE_SCALE", 2.5, 0.0, 10.0),
            env_float("OTA_FRONT_BACK_POSE_GUIDANCE_SCALE", 1.5, 0.0, 10.0),
        )
    return (
        env_float("OTA_SIDE_IMAGE_GUIDANCE_SCALE", 2.5, 0.0, 10.0),
        env_float("OTA_SIDE_POSE_GUIDANCE_SCALE", 1.5, 0.0, 10.0),
    )


async def run_job(job_id: str, store: JobStore):
    request = store.get_request(job_id)
    if request is None:
        raise PipelineError("REQUEST_NOT_FOUND", job_id)

    root = store.job_dir(job_id)
    prompt = request["prompt"]
    seed = int(request["seed"])
    refs = {d: Path(request["inputs"][d]) for d in DIRECTIONS}
    subject_profile = str(request.get("subject_profile", "character"))
    profile_classification = dict(request.get("profile_classification", {}))
    motion_backend = str(
        request.get(
            "motion_backend",
            "kimodo" if subject_profile == "character" else "animal_procedural",
        )
    )
    motion_routing = dict(request.get("motion_routing", {}))
    motion_input = dict(request.get("motion_input", {}))
    with (root / "profile_classification.json").open("w", encoding="utf-8") as f:
        json.dump(profile_classification, f, ensure_ascii=False, indent=2)

    motion_path = root / "motion" / "motion.npz"
    pose_root = root / "pose"
    rendered_root = root / "rendered"
    result_root = root / "result"

    timeout = httpx.Timeout(
        connect=10.0,
        read=env_float("SPRITE_WORKER_READ_TIMEOUT_SECONDS", 1800.0, 30.0, 7200.0),
        write=120.0,
        pool=30.0,
    )

    async with httpx.AsyncClient(timeout=timeout) as client:
        if motion_backend == "kimodo":
            if subject_profile != "character":
                raise PipelineError(
                    "INVALID_MOTION_ROUTE",
                    "Kimodo backend is allowed only for character jobs",
                )
            store.update(job_id, status="processing", stage="kimodo", progress=5)
            kimodo = await request_json(
                client,
                "POST",
                f"{KIMODO_WORKER_URL}/generate",
                json={
                    "prompt": prompt,
                    "seed": seed,
                    "duration": env_float("KIMODO_GENERATED_DURATION", 4.0, 1.0, 12.0),
                    "diffusion_steps": 100,
                    "max_motion_attempts": env_int("KIMODO_MAX_MOTION_ATTEMPTS", 8, 1, 16),
                    "output_path": str(motion_path),
                },
            )

            motion_path = Path(kimodo["motion_path"])
            if not motion_path.exists():
                raise PipelineError("KIMODO_OUTPUT_MISSING", str(motion_path))

            store.update(job_id, stage="motion_adapter", progress=20)
            adapter = load_adapter()
            try:
                pose_dirs = await asyncio.to_thread(adapter, motion_path, refs, pose_root)
            except Exception as exc:
                raise PipelineError("MOTION_ADAPTER_FAILED", str(exc)) from exc
        else:
            if subject_profile not in {"quadruped", "biped_animal"}:
                raise PipelineError(
                    "INVALID_MOTION_ROUTE",
                    f"Animal backend {motion_backend} cannot handle {subject_profile}",
                )
            if motion_backend not in {"animal_procedural", "animal_npz"}:
                raise PipelineError(
                    "INVALID_MOTION_ROUTE",
                    f"Unsupported animal motion backend: {motion_backend}",
                )
            uploaded_motion = None
            if motion_backend == "animal_npz":
                uploaded_path = str(motion_input.get("path", "")).strip()
                if not uploaded_path:
                    raise PipelineError(
                        "ANIMAL_NPZ_MISSING",
                        "animal_npz backend requires a saved motion NPZ",
                    )
                uploaded_motion = Path(uploaded_path)
                if not uploaded_motion.is_absolute():
                    uploaded_motion = root / uploaded_motion
                uploaded_motion = uploaded_motion.resolve()
                root_resolved = root.resolve()
                if not uploaded_motion.is_relative_to(root_resolved):
                    raise PipelineError(
                        "ANIMAL_NPZ_PATH_INVALID",
                        "animal motion input must stay inside the job directory",
                    )
                if not uploaded_motion.exists():
                    raise PipelineError("ANIMAL_NPZ_MISSING", str(uploaded_motion))

            store.update(
                job_id,
                status="processing",
                stage=(
                    "animal_npz_adapter"
                    if motion_backend == "animal_npz"
                    else "animal_procedural_adapter"
                ),
                progress=12,
            )
            adapter = load_animal_adapter()
            try:
                pose_dirs = await asyncio.to_thread(
                    adapter,
                    refs,
                    pose_root,
                    subject_profile,
                    prompt,
                    profile_classification,
                    uploaded_motion,
                    motion_backend,
                )
            except Exception as exc:
                raise PipelineError("ANIMAL_ADAPTER_FAILED", str(exc)) from exc
            motion_qc = {
                "worker_version": PIPELINE_VERSION,
                "motion_source": motion_backend,
                "subject_profile": subject_profile,
                "motion_backend": motion_backend,
                "motion_input": motion_input,
                "kimodo_bypassed": True,
                "human_pose_projection_bypassed": True,
                "num_frames": 17,
                "closed_loop": True,
            }
            motion_path.parent.mkdir(parents=True, exist_ok=True)
            with (motion_path.parent / "motion.qc.json").open("w", encoding="utf-8") as f:
                json.dump(motion_qc, f, ensure_ascii=False, indent=2)

        black_pose_cfg = env_bool("OTA_BLACK_POSE_CFG", True)
        max_loop_attempts = env_int("OTA_LOOP_MAX_ATTEMPTS", 2, 1, 4)
        seed_stride = env_int("OTA_LOOP_SEED_STRIDE", 100003, 1, 2_000_000_000)
        strict_loop_qc = env_bool("SPRITE_LOOP_QC_STRICT", True)
        animal_strict = (
            subject_profile != "character"
            and env_bool("SPRITE_ANIMAL_QC_STRICT", True)
        )
        loop_thresholds = {
            "max_seam_ratio": env_float("SPRITE_LOOP_MAX_SEAM_RATIO", 1.45, 1.0, 5.0),
            "max_transition_ratio": env_float(
                "SPRITE_LOOP_MAX_TRANSITION_RATIO", 2.25, 1.0, 8.0
            ),
            "max_mean_seam_ratio": env_float(
                "SPRITE_LOOP_MAX_MEAN_SEAM_RATIO", 1.20, 1.0, 5.0
            ),
            "max_front_back_centroid_seam_ratio": env_float(
                "SPRITE_LOOP_MAX_FRONT_BACK_CENTROID_SEAM_RATIO",
                0.011,
                0.0,
                0.10,
            ),
            "max_front_back_ground_seam_ratio": env_float(
                "SPRITE_LOOP_MAX_FRONT_BACK_GROUND_SEAM_RATIO",
                0.011,
                0.0,
                0.10,
            ),
            "max_front_back_height_seam_ratio": env_float(
                "SPRITE_LOOP_MAX_FRONT_BACK_HEIGHT_SEAM_RATIO",
                0.025,
                0.0,
                0.15,
            ),
            "max_color_seam_delta_e": env_float(
                "SPRITE_LOOP_MAX_COLOR_SEAM_DELTA_E",
                12.0,
                0.0,
                60.0,
            ),
        }
        appearance_enabled = env_bool("SPRITE_APPEARANCE_STABILIZE", True)
        appearance_strict = env_bool("SPRITE_APPEARANCE_QC_STRICT", True)
        appearance_config = {
            "enabled": appearance_enabled,
            "palette_size": env_int("SPRITE_APPEARANCE_PALETTE_SIZE", 12, 4, 24),
            "chroma_strength": env_float(
                "SPRITE_APPEARANCE_CHROMA_STRENGTH", 0.55, 0.0, 1.0
            ),
            "brightness_strength": env_float(
                "SPRITE_APPEARANCE_BRIGHTNESS_STRENGTH", 0.18, 0.0, 1.0
            ),
            "contrast_strength": env_float(
                "SPRITE_APPEARANCE_CONTRAST_STRENGTH", 0.16, 0.0, 1.0
            ),
            "max_delta_e": env_float(
                "SPRITE_APPEARANCE_MAX_DELTA_E", 14.0, 1.0, 40.0
            ),
            "temporal_chroma_strength": env_float(
                "SPRITE_APPEARANCE_TEMPORAL_CHROMA_STRENGTH", 0.38, 0.0, 1.0
            ),
            "temporal_luma_strength": env_float(
                "SPRITE_APPEARANCE_TEMPORAL_LUMA_STRENGTH", 0.16, 0.0, 1.0
            ),
            "max_temporal_chroma_spread": env_float(
                "SPRITE_APPEARANCE_MAX_TEMPORAL_CHROMA_SPREAD",
                13.0,
                0.0,
                60.0,
            ),
            "max_temporal_luma_spread": env_float(
                "SPRITE_APPEARANCE_MAX_TEMPORAL_LUMA_SPREAD",
                12.0,
                0.0,
                60.0,
            ),
            "max_mean_correction_delta_e": env_float(
                "SPRITE_APPEARANCE_MAX_MEAN_CORRECTION_DELTA_E",
                9.0,
                0.0,
                40.0,
            ),
        }

        attempt_reports = []
        selected_report = None
        selected_render_root = None
        best_report = None
        best_render_root = None

        for attempt in range(max_loop_attempts):
            render_seed = seed + attempt * seed_stride
            attempt_root = rendered_root / f"attempt_{attempt:02d}"

            for direction_index, direction in enumerate(DIRECTIONS):
                progress = int(
                    25
                    + 58
                    * (attempt * len(DIRECTIONS) + direction_index)
                    / max(1, max_loop_attempts * len(DIRECTIONS))
                )
                store.update(
                    job_id,
                    stage=f"render_{direction}_attempt_{attempt + 1}",
                    progress=progress,
                )
                output_dir = attempt_root / direction
                output_dir.mkdir(parents=True, exist_ok=True)
                image_guidance_scale, pose_guidance_scale = ota_guidance(direction, subject_profile)

                ota = await request_json(
                    client,
                    "POST",
                    f"{OTA_WORKER_URL}/render",
                    json={
                        "direction": direction,
                        "reference_image": str(refs[direction]),
                        "pose_dir": str(pose_dirs[direction]),
                        "output_dir": str(output_dir),
                        "prompt": build_render_prompt(direction, prompt, subject_profile),
                        "seed": render_seed,
                        "num_frames": 17,
                        "image_guidance_scale": image_guidance_scale,
                        "pose_guidance_scale": pose_guidance_scale,
                        "black_pose_cfg": black_pose_cfg,
                        "subject_profile": subject_profile,
                    },
                )

                if int(ota["num_frames"]) != 17:
                    raise PipelineError(
                        "OTA_INVALID_FRAME_COUNT",
                        f"{direction}: {ota['num_frames']}",
                    )

            store.update(
                job_id,
                stage=f"appearance_attempt_{attempt + 1}",
                progress=min(88, 82 + attempt),
            )
            try:
                appearance_report = await asyncio.to_thread(
                    stabilize_appearance_attempt,
                    attempt_root,
                    refs,
                    **appearance_config,
                )
            except Exception as exc:
                raise PipelineError("APPEARANCE_POSTPROCESS_FAILED", str(exc)) from exc

            store.update(
                job_id,
                stage=f"loop_qc_attempt_{attempt + 1}",
                progress=min(91, 86 + attempt),
            )
            try:
                report = await asyncio.to_thread(
                    evaluate_render_attempt,
                    attempt_root,
                    **loop_thresholds,
                )
            except Exception as exc:
                raise PipelineError("LOOP_POSTPROCESS_FAILED", str(exc)) from exc

            report["loop_only_ok"] = bool(report["ok"])
            report["appearance"] = appearance_report
            report["appearance_strict"] = appearance_strict
            if appearance_strict and not appearance_report.get("ok", False):
                report["ok"] = False
                report["errors"] = list(report["errors"]) + [
                    f"appearance: {error}"
                    for error in appearance_report.get("errors", [])
                ]

            try:
                animal_report = await asyncio.to_thread(
                    evaluate_animal_render_attempt,
                    attempt_root,
                    refs,
                    subject_profile,
                )
            except Exception as exc:
                raise PipelineError("ANIMAL_QC_ERROR", str(exc)) from exc
            report["animal"] = animal_report
            report["animal_strict"] = animal_strict
            write_animal_qc(animal_report, attempt_root / "animal_qc.json")
            if animal_strict and not animal_report.get("ok", False):
                report["ok"] = False
                report["errors"] = list(report["errors"]) + [
                    f"animal: {error}"
                    for error in animal_report.get("errors", [])
                ]

            report["selected_score"] = float(
                report["selected_score"]
                + 0.035 * float(appearance_report.get("score", 0.0))
                + 0.12 * float(animal_report.get("score", 0.0))
            )
            report["attempt"] = attempt
            report["render_seed"] = render_seed
            write_report(report, attempt_root / "loop_qc.json")
            attempt_reports.append(report)

            if best_report is None or report["selected_score"] < best_report["selected_score"]:
                best_report = report
                best_render_root = attempt_root

            if report["ok"]:
                selected_report = report
                selected_render_root = attempt_root
                break

        if selected_report is None:
            assert best_report is not None and best_render_root is not None
            selected_report = best_report
            selected_render_root = best_render_root
            if strict_loop_qc or appearance_strict or animal_strict:
                failure_report = dict(selected_report)
                failure_report["attempts"] = [
                    {
                        "attempt": item["attempt"],
                        "render_seed": item["render_seed"],
                        "ok": item["ok"],
                        "selected_candidate": item["selected_candidate"],
                        "selected_score": item["selected_score"],
                        "appearance_ok": bool(item.get("appearance", {}).get("ok", False)),
                        "animal_ok": bool(item.get("animal", {}).get("ok", True)),
                        "errors": item["errors"],
                    }
                    for item in attempt_reports
                ]
                write_report(failure_report, root / "loop_qc_failed.json")
                debug_zip = create_failure_debug_zip(root)
                store.update(
                    job_id,
                    debug_path=str(debug_zip),
                    debug_url=f"/v1/jobs/{job_id}/debug",
                )
                code = (
                    "ANIMAL_QC_FAILED"
                    if animal_strict and not selected_report.get("animal", {}).get("ok", True)
                    else "LOOP_QC_FAILED"
                )
                raise PipelineError(
                    code,
                    "No One-to-All render passed V9 appearance + loop + animal QC after "
                    f"{max_loop_attempts} attempt(s): "
                    + "; ".join(selected_report["errors"]),
                )

        final_loop_report = dict(selected_report)
        final_loop_report["selected_attempt"] = int(selected_report["attempt"])
        final_loop_report["selected_render_seed"] = int(selected_report["render_seed"])
        final_loop_report["strict"] = bool(
            strict_loop_qc or appearance_strict or animal_strict
        )
        final_loop_report["strict_loop_qc"] = strict_loop_qc
        final_loop_report["strict_appearance_qc"] = appearance_strict
        final_loop_report["strict_animal_qc"] = animal_strict
        final_loop_report["accepted_by_override"] = bool(
            not selected_report["ok"]
            and not strict_loop_qc
            and not appearance_strict
            and not animal_strict
        )
        final_loop_report["attempts"] = [
            {
                "attempt": int(item["attempt"]),
                "render_seed": int(item["render_seed"]),
                "ok": bool(item["ok"]),
                "selected_candidate": item["selected_candidate"],
                "selected_phase_indices": item["selected_phase_indices"],
                "selected_score": item["selected_score"],
                "appearance_ok": bool(item.get("appearance", {}).get("ok", False)),
                "animal_ok": bool(item.get("animal", {}).get("ok", True)),
                "errors": item["errors"],
            }
            for item in attempt_reports
        ]

        store.update(job_id, stage="postprocess", progress=94)
        write_report(final_loop_report, result_root / "loop_qc.json")
        write_report(
            final_loop_report.get("appearance", {}),
            result_root / "appearance_qc.json",
        )
        write_animal_qc(
            final_loop_report.get("animal", {}),
            result_root / "animal_qc.json",
        )
        copy_selected_frames(
            selected_render_root,
            result_root,
            final_loop_report["selected_phase_indices"],
        )
        create_sprite_sheet(result_root)
        create_metadata(
            job_id,
            prompt,
            seed,
            result_root,
            pose_root,
            final_loop_report,
            subject_profile,
            profile_classification,
            motion_backend,
            motion_routing,
            motion_input,
        )
        zip_path = create_zip(result_root, pose_root, selected_render_root)

        store.update(
            job_id,
            status="succeeded",
            stage="succeeded",
            progress=100,
            error=None,
            result_path=str(zip_path),
        )
