#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import stat
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path, PurePosixPath
from typing import Any

ADAPTER_VERSION = "0.1.0"
SCENE_JOB_LIMITATIONS = [
    "The receipt proves only native loading and deterministic probe contact/reset for the checksum-bound compiled scene.",
    "It grants no physical-prediction, robot-training, navigation, collision-fidelity, or measured-geometry authority.",
    "The integrity boundary assumes app-controlled local staging and does not defend against a hostile same-user process.",
]
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
EXPECTED_PACKAGES = {
    "superdex_physics": ("superdex-physics", "1.0.0"),
    "superdex_robotics": ("superdex-robotics", "1.0.0"),
}


def _package_version(distribution: str) -> str | None:
    try:
        return version(distribution)
    except PackageNotFoundError:
        return None


def _runtime() -> dict[str, Any]:
    return {
        "python_version": platform.python_version(),
        "platform": platform.system(),
        "machine": platform.machine(),
        "packages": {
            key: _package_version(distribution)
            for key, (distribution, _) in EXPECTED_PACKAGES.items()
        },
    }


def _supported_runtime(runtime: dict[str, Any]) -> bool:
    machine = runtime["machine"].lower()
    return sys.version_info[:2] == (3, 12) and (
        (runtime["platform"] == "Darwin" and machine == "arm64")
        or (runtime["platform"] == "Linux" and machine in {"x86_64", "amd64"})
        or (runtime["platform"] == "Windows" and machine in {"x86_64", "amd64"})
    )


def _vec(values: Any) -> list[float]:
    return [float(values[index]) for index in range(len(values))]


def _magnitude(values: list[float]) -> float:
    return math.sqrt(sum(value * value for value in values))


def _cube_shape(physics: Any, size: float = 0.4) -> Any:
    half = size / 2.0
    vertices = [
        -half, -half, -half, half, -half, -half,
        half, half, -half, -half, half, -half,
        -half, -half, half, half, -half, half,
        half, half, half, -half, half, half,
    ]
    triangles = [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
        0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
        0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
    ]
    return physics.create_tri_mesh_shape(vertices, triangles)


def _run_smoke(physics: Any) -> dict[str, Any]:
    timestep = 1.0 / 60.0
    frames = 180
    repetitions = 3
    tolerance = 1e-6
    scene = probe = initial_state = None
    queries: list[Any] = []

    physics.initialize(num_worker_threads=0)
    try:
        scene = physics.create_scene("world-studio-superdex-smoke")
        scene.set_gravity([0, -9.8, 0])
        floor = scene.create_rigid_actor(
            name="floor",
            shape=physics.create_plane_shape([0, 1, 0], 0),
            is_static=True,
        )
        probe = scene.create_rigid_actor(
            name="probe",
            shape=_cube_shape(physics),
            is_static=False,
            density=1000.0,
            world_from_local=physics.TransformRT(translation=[0, 0.75, 0]),
            collider_type=physics.ColliderType.BOX,
        )
        for query_type in (
            physics.QueryType.CONTACT_POINTS,
            physics.QueryType.TOTAL_CONTACT_FORCE,
        ):
            if not probe.is_query_supported(query_type):
                raise RuntimeError("Required rigid contact query is unavailable.")
            queries.append(probe.register_query(query_type))

        initial_state = scene.capture_state()
        initial_pose = probe.get_root_transform()
        initial_position = _vec(initial_pose.translation)
        initial_rotation = _vec(initial_pose.rotation)
        runs = []

        for repetition in range(1, repetitions + 1):
            first_contact_frame = None
            contact_frames = max_contact_points = 0
            max_point_force = max_total_force = 0.0
            for frame in range(1, frames + 1):
                scene.step(timestep)
                if probe.get_convergence_status() == physics.ConvergenceStatus.DIVERGED:
                    raise RuntimeError("Synthetic contact solver diverged.")
                contacts = list(probe.get_contact_points_world())
                if contacts:
                    contact_frames += 1
                    first_contact_frame = first_contact_frame or frame
                max_contact_points = max(max_contact_points, len(contacts))
                max_point_force = max(
                    [max_point_force]
                    + [_magnitude(_vec(contact.force)) for contact in contacts]
                )
                max_total_force = max(
                    max_total_force,
                    _magnitude(_vec(probe.get_contact_force_from_actor_world(floor))),
                )

            final_position = _vec(probe.get_root_transform().translation)
            scene.restore_state(initial_state, False)
            reset_pose = probe.get_root_transform()
            run = {
                "repetition": repetition,
                "first_contact_frame": first_contact_frame,
                "contact_frames": contact_frames,
                "max_contact_points": max_contact_points,
                "max_point_force_n": max_point_force,
                "max_total_force_n": max_total_force,
                "final_position_m": final_position,
                "reset_position_error_m": math.dist(
                    initial_position, _vec(reset_pose.translation)
                ),
                "reset_rotation_component_error": math.dist(
                    initial_rotation, _vec(reset_pose.rotation)
                ),
                "reset_linear_velocity_m_s": _magnitude(
                    _vec(probe.get_linear_velocity())
                ),
                "reset_angular_velocity_rad_s": _magnitude(
                    _vec(probe.get_angular_velocity())
                ),
            }
            if not all(
                math.isfinite(value)
                for value in (
                    *final_position,
                    run["max_point_force_n"],
                    run["max_total_force_n"],
                    run["reset_position_error_m"],
                    run["reset_rotation_component_error"],
                    run["reset_linear_velocity_m_s"],
                    run["reset_angular_velocity_rad_s"],
                )
            ):
                raise RuntimeError("Synthetic contact/reset result is non-finite.")
            runs.append(run)

        repeatable = all(run == {**runs[0], "repetition": index + 1} for index, run in enumerate(runs))
        passed = repeatable and all(
            run["first_contact_frame"] is not None
            and run["max_contact_points"] > 0
            and run["max_point_force_n"] > 0
            and run["max_total_force_n"] > 0
            and max(abs(value) for value in run["final_position_m"]) <= 2
            and max(
                run["reset_position_error_m"],
                run["reset_rotation_component_error"],
                run["reset_linear_velocity_m_s"],
                run["reset_angular_velocity_rad_s"],
            )
            <= tolerance
            for run in runs
        )
        if not passed:
            raise RuntimeError("Synthetic contact/reset acceptance failed.")
        return {
            "schema": "world_studio.superdex_smoke_result.v0.1",
            "fixture_id": "synthetic-rigid-contact-reset-v1",
            "timestep_seconds": timestep,
            "frames_per_repetition": frames,
            "repetitions": repetitions,
            "reset_tolerance": tolerance,
            "runs": runs,
            "repeatable": repeatable,
            "passed": passed,
            "authority": "software_capability_only",
        }
    finally:
        if probe is not None:
            for query in queries:
                probe.cancel_query(query)
        if scene is not None and initial_state is not None:
            scene.release_state(initial_state)
        if scene is not None:
            physics.destroy_scene(scene)
        if physics.is_initialized():
            physics.shutdown()


class SceneJobError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _strict_json_bytes(data: bytes) -> Any:
    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON member")
            result[key] = value
        return result

    def reject_constant(_: str) -> None:
        raise ValueError("non-finite JSON number")

    return json.loads(
        data.decode("utf-8"),
        object_pairs_hook=object_pairs,
        parse_constant=reject_constant,
    )


def _exact_keys(value: dict[str, Any], expected: set[str]) -> None:
    if set(value) != expected:
        raise ValueError("unexpected fields")


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or IDENTIFIER.fullmatch(value) is None:
        raise ValueError("invalid identifier")
    return value


def _checksum(value: Any) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None:
        raise ValueError("invalid checksum")
    return value


def _safe_relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError("invalid relative path")
    parsed = PurePosixPath(value)
    if (
        parsed.is_absolute()
        or str(parsed) != value
        or any(part in {"", ".", ".."} for part in parsed.parts)
        or "\\" in value
        or "\0" in value
    ):
        raise ValueError("unsafe relative path")
    return value


def _content_reference(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("invalid content reference")
    _exact_keys(value, {"path", "sha256", "size_bytes", "media_type"})
    result = {
        "path": _safe_relative_path(value["path"]),
        "sha256": _checksum(value["sha256"]),
        "size_bytes": value["size_bytes"],
        "media_type": value["media_type"],
    }
    if (
        not isinstance(result["size_bytes"], int)
        or isinstance(result["size_bytes"], bool)
        or result["size_bytes"] < 1
        or result["size_bytes"] > 128 * 1024 * 1024
        or not isinstance(result["media_type"], str)
        or not result["media_type"]
    ):
        raise ValueError("invalid content reference bounds")
    return result


def _validate_scene_job_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("scene job request must be an object")
    _exact_keys(
        value,
        {
            "schema",
            "scene_job_id",
            "package_id",
            "package_manifest_sha256",
            "source_world",
            "scene_sha256",
            "scene_actor_names",
            "target_actor_name",
            "probe_initial_position_m",
            "probe_size_m",
            "timestep_seconds",
            "frames_per_repetition",
            "repetitions",
            "reset_tolerance",
            "authority",
            "limitations",
        },
    )
    if value["schema"] != "world_studio.superdex_scene_job_request.v0.1":
        raise ValueError("unsupported scene job request")
    _identifier(value["scene_job_id"])
    _identifier(value["package_id"])
    _checksum(value["package_manifest_sha256"])
    _checksum(value["scene_sha256"])
    source_world = value["source_world"]
    if not isinstance(source_world, dict):
        raise ValueError("invalid source World")
    _exact_keys(source_world, {"kind", "id", "version_id", "version", "manifest_sha256"})
    if source_world["kind"] != "world":
        raise ValueError("invalid source World kind")
    _identifier(source_world["id"])
    _identifier(source_world["version_id"])
    _checksum(source_world["manifest_sha256"])
    if not isinstance(source_world["version"], int) or source_world["version"] < 1:
        raise ValueError("invalid source World version")
    actor_names = value["scene_actor_names"]
    if (
        not isinstance(actor_names, list)
        or not 1 <= len(actor_names) <= 64
        or len(set(actor_names)) != len(actor_names)
    ):
        raise ValueError("invalid scene actor inventory")
    for actor_name in actor_names:
        _identifier(actor_name)
    target = _identifier(value["target_actor_name"])
    if target not in actor_names:
        raise ValueError("target actor is absent")
    for field in ("probe_initial_position_m", "probe_size_m"):
        values = value[field]
        if (
            not isinstance(values, list)
            or len(values) != 3
            or any(not isinstance(item, (int, float)) or isinstance(item, bool) or not math.isfinite(item) for item in values)
        ):
            raise ValueError("invalid probe vector")
    if value["probe_size_m"] != [0.05, 0.05, 0.05]:
        raise ValueError("unsupported probe size")
    if (
        value["timestep_seconds"] != 1.0 / 60.0
        or value["frames_per_repetition"] != 180
        or value["repetitions"] != 3
        or value["reset_tolerance"] != 1e-6
        or value["authority"] != "compiled_scene_execution_only"
        or value["limitations"] != SCENE_JOB_LIMITATIONS
    ):
        raise ValueError("unsupported scene job parameters")
    return value


def _private_input(value: Path) -> Path:
    raw = value.as_posix()
    relative = _safe_relative_path(raw)
    root = Path.cwd().resolve()
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("private input contains a symbolic link")
    resolved = current.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("private input escaped the run root")
    return resolved


def _bytes_sha256(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _stat_fingerprint(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_nlink,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def _read_bounded_regular_file(path: Path, max_bytes: int) -> tuple[bytes, tuple[int, ...]]:
    path_info = path.lstat()
    if (
        path.is_symlink()
        or not stat.S_ISREG(path_info.st_mode)
        or path_info.st_nlink != 1
        or not 1 <= path_info.st_size <= max_bytes
    ):
        raise ValueError("invalid package file")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or not 1 <= before.st_size <= max_bytes
            or _stat_fingerprint(path_info) != _stat_fingerprint(before)
        ):
            raise ValueError("invalid package file descriptor")

        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > max_bytes:
                raise ValueError("package file exceeds its byte bound")

        after = os.fstat(descriptor)
        path_after = path.lstat()
        fingerprint = _stat_fingerprint(before)
        if (
            size != before.st_size
            or _stat_fingerprint(after) != fingerprint
            or _stat_fingerprint(path_after) != fingerprint
        ):
            raise ValueError("package file changed while being read")
        return b"".join(chunks), fingerprint
    finally:
        os.close(descriptor)


def _directory_fingerprint(path: Path) -> tuple[int, ...]:
    info = path.lstat()
    if path.is_symlink() or not stat.S_ISDIR(info.st_mode):
        raise ValueError("invalid package directory")
    return _stat_fingerprint(info)


def _verify_scene_package(package_root: Path, request: dict[str, Any]) -> dict[str, Any]:
    if not package_root.is_dir() or package_root.is_symlink():
        raise ValueError("package root is not a real directory")
    manifest_path = package_root / "manifest.json"
    manifest_bytes, manifest_fingerprint = _read_bounded_regular_file(
        manifest_path, 2 * 1024 * 1024
    )
    if _bytes_sha256(manifest_bytes) != request["package_manifest_sha256"]:
        raise ValueError("package manifest checksum mismatch")
    manifest = _strict_json_bytes(manifest_bytes)
    if not isinstance(manifest, dict):
        raise ValueError("package manifest must be an object")
    _exact_keys(
        manifest,
        {
            "schema",
            "package_id",
            "source_world",
            "source_world_manifest",
            "compiler",
            "target",
            "authority_effect",
            "source_collision_readiness",
            "scene",
            "colliders",
            "report",
            "limitations",
        },
    )
    expected_target = {
        "backend_id": "superdex",
        "backend_version": "1.0.0",
        "adapter_version": "0.1.0",
        "scene_format": "superdex_mochi_scene",
        "coordinate_frame": "right_y_up",
        "actor_kind": "static_rigid",
        "collider_type": "Mesh",
    }
    if (
        manifest["schema"] != "world_studio.superdex_scene_package.v0.1"
        or manifest["package_id"] != request["package_id"]
        or manifest["source_world"] != request["source_world"]
        or manifest["compiler"]
        != {"id": "world-studio-superdex-scene-compiler", "version": "0.1.0"}
        or manifest["target"] != expected_target
        or manifest["authority_effect"] != "preserved_without_promotion"
    ):
        raise ValueError("package identity is unsupported")
    references = [
        _content_reference(manifest["source_world_manifest"]),
        _content_reference(manifest["scene"]),
        _content_reference(manifest["report"]),
    ]
    if references[0]["sha256"] != request["source_world"]["manifest_sha256"]:
        raise ValueError("source World manifest checksum differs")
    colliders = manifest["colliders"]
    if not isinstance(colliders, list) or not 1 <= len(colliders) <= 64:
        raise ValueError("invalid collider inventory")
    actor_names: list[str] = []
    collider_paths: list[str] = []
    for collider in colliders:
        if not isinstance(collider, dict):
            raise ValueError("invalid collider")
        actor_names.append(_identifier(collider.get("actor_name")))
        mesh = _content_reference(collider.get("compiled_mesh"))
        if mesh["media_type"] != "model/obj":
            raise ValueError("unsupported collider media type")
        references.append(mesh)
        collider_paths.append(mesh["path"])
    if actor_names != request["scene_actor_names"]:
        raise ValueError("package actor inventory differs from the job")
    scene_reference = references[1]
    if scene_reference["sha256"] != request["scene_sha256"] or not scene_reference["path"].endswith(".mochi_scene"):
        raise ValueError("native scene identity differs from the job")
    expected_files = {"manifest.json", *(reference["path"] for reference in references)}
    expected_directories: set[str] = set()
    for relative in expected_files:
        parent = PurePosixPath(relative).parent
        while str(parent) != ".":
            expected_directories.add(str(parent))
            parent = parent.parent
    actual_files: set[str] = set()
    actual_directories: set[str] = set()
    for directory, directory_names, file_names in os.walk(package_root, followlinks=False):
        base = Path(directory)
        for name in directory_names:
            child = base / name
            if child.is_symlink():
                raise ValueError("package contains a symbolic link")
            actual_directories.add(child.relative_to(package_root).as_posix())
        for name in file_names:
            child = base / name
            info = child.lstat()
            if child.is_symlink() or not child.is_file() or info.st_nlink != 1:
                raise ValueError("package contains a non-regular file")
            actual_files.add(child.relative_to(package_root).as_posix())
    if actual_files != expected_files or actual_directories != expected_directories:
        raise ValueError("package inventory differs from its manifest")
    directory_snapshot = {
        ".": _directory_fingerprint(package_root),
        **{
            relative: _directory_fingerprint(
                package_root.joinpath(*PurePosixPath(relative).parts)
            )
            for relative in sorted(expected_directories)
        },
    }
    file_snapshot = {
        "manifest.json": (
            manifest_fingerprint,
            _bytes_sha256(manifest_bytes),
        )
    }
    content_bytes: dict[str, bytes] = {}
    total_bytes = 0
    for reference in references:
        content_path = package_root.joinpath(*PurePosixPath(reference["path"]).parts)
        data, fingerprint = _read_bounded_regular_file(
            content_path, reference["size_bytes"]
        )
        if len(data) != reference["size_bytes"] or _bytes_sha256(data) != reference["sha256"]:
            raise ValueError("package content checksum mismatch")
        content_bytes[reference["path"]] = data
        file_snapshot[reference["path"]] = (fingerprint, _bytes_sha256(data))
        total_bytes += len(data)
        if total_bytes > 128 * 1024 * 1024:
            raise ValueError("package byte budget exceeded")
    for relative, (fingerprint, _) in file_snapshot.items():
        path = package_root.joinpath(*PurePosixPath(relative).parts)
        if _stat_fingerprint(path.lstat()) != fingerprint:
            raise ValueError("package file changed during verification")
    if {
        ".": _directory_fingerprint(package_root),
        **{
            relative: _directory_fingerprint(
                package_root.joinpath(*PurePosixPath(relative).parts)
            )
            for relative in sorted(expected_directories)
        },
    } != directory_snapshot:
        raise ValueError("package directory changed during verification")
    scene_data = _strict_json_bytes(content_bytes[scene_reference["path"]])
    rigid = scene_data.get("actors", {}).get("rigid") if isinstance(scene_data, dict) else None
    if not isinstance(rigid, list) or [actor.get("name") for actor in rigid if isinstance(actor, dict)] != actor_names:
        raise ValueError("native scene actor inventory differs")
    if [actor.get("shape") for actor in rigid] != collider_paths:
        raise ValueError("native scene collider paths differ")
    return {
        "manifest": manifest,
        "scene_path": scene_reference["path"],
        "snapshot": {
            "directories": directory_snapshot,
            "files": file_snapshot,
        },
    }


def _run_scene_contact_reset(
    physics: Any,
    package_root: Path,
    package: dict[str, Any],
    request: dict[str, Any],
) -> dict[str, Any]:
    from superdex.physics.utils.scene_helpers import create_scene_from_prefab, find_actor

    timestep = request["timestep_seconds"]
    frames = request["frames_per_repetition"]
    repetitions = request["repetitions"]
    tolerance = request["reset_tolerance"]
    scene = probe = initial_state = None
    queries: list[Any] = []
    physics.initialize(num_worker_threads=0)
    try:
        try:
            before_load = _verify_scene_package(package_root, request)
            if before_load["snapshot"] != package["snapshot"]:
                raise RuntimeError("package changed before native scene load")
            scene = create_scene_from_prefab(
                before_load["scene_path"],
                root_dir=package_root,
                scene_name="world-studio-compiled-scene-contact-reset",
            )
            after_load = _verify_scene_package(package_root, request)
            if after_load["snapshot"] != before_load["snapshot"]:
                raise RuntimeError("package changed during native scene load")
            scene.set_gravity([0, -9.8, 0])
            loaded_names: list[str] = []
            scene.for_each_actor(lambda actor: loaded_names.append(actor.get_name()))
            if set(loaded_names) != set(request["scene_actor_names"]) or len(loaded_names) != len(request["scene_actor_names"]):
                raise RuntimeError("loaded actor inventory mismatch")
            target = find_actor(scene, request["target_actor_name"])
        except Exception as error:
            raise SceneJobError("scene_load_failure") from error

        try:
            probe = scene.create_rigid_actor(
                name="world_studio_contact_probe",
                shape=_cube_shape(physics, request["probe_size_m"][0]),
                is_static=False,
                density=1000.0,
                world_from_local=physics.TransformRT(
                    translation=request["probe_initial_position_m"]
                ),
                collider_type=physics.ColliderType.BOX,
            )
            for query_type in (
                physics.QueryType.CONTACT_POINTS,
                physics.QueryType.TOTAL_CONTACT_FORCE,
            ):
                if not probe.is_query_supported(query_type):
                    raise RuntimeError("required contact query is unavailable")
                queries.append(probe.register_query(query_type))
            initial_state = scene.capture_state()
            initial_pose = probe.get_root_transform()
            initial_position = _vec(initial_pose.translation)
            initial_rotation = _vec(initial_pose.rotation)
            runs = []
            for repetition in range(1, repetitions + 1):
                first_contact_frame = None
                contact_frames = target_contact_frames = max_contact_points = 0
                max_point_force = max_total_force = max_target_force = 0.0
                for frame in range(1, frames + 1):
                    scene.step(timestep)
                    if probe.get_convergence_status() == physics.ConvergenceStatus.DIVERGED:
                        raise RuntimeError("contact solver diverged")
                    contacts = list(probe.get_contact_points_world())
                    target_force = _magnitude(
                        _vec(probe.get_contact_force_from_actor_world(target))
                    )
                    total_force = _magnitude(_vec(probe.get_contact_force_world()))
                    if contacts:
                        contact_frames += 1
                    if target_force > 0:
                        target_contact_frames += 1
                        first_contact_frame = first_contact_frame or frame
                    max_contact_points = max(max_contact_points, len(contacts))
                    max_point_force = max(
                        [max_point_force]
                        + [_magnitude(_vec(contact.force)) for contact in contacts]
                    )
                    max_target_force = max(max_target_force, target_force)
                    max_total_force = max(max_total_force, total_force)
                final_position = _vec(probe.get_root_transform().translation)
                scene.restore_state(initial_state, False)
                reset_pose = probe.get_root_transform()
                run = {
                    "repetition": repetition,
                    "first_contact_frame": first_contact_frame,
                    "contact_frames": contact_frames,
                    "target_contact_frames": target_contact_frames,
                    "max_contact_points": max_contact_points,
                    "max_point_force_n": max_point_force,
                    "max_total_force_n": max_total_force,
                    "max_target_force_n": max_target_force,
                    "final_position_m": final_position,
                    "reset_position_error_m": math.dist(
                        initial_position, _vec(reset_pose.translation)
                    ),
                    "reset_rotation_component_error": math.dist(
                        initial_rotation, _vec(reset_pose.rotation)
                    ),
                    "reset_linear_velocity_m_s": _magnitude(
                        _vec(probe.get_linear_velocity())
                    ),
                    "reset_angular_velocity_rad_s": _magnitude(
                        _vec(probe.get_angular_velocity())
                    ),
                }
                if not all(
                    math.isfinite(value)
                    for value in (
                        *final_position,
                        run["max_point_force_n"],
                        run["max_total_force_n"],
                        run["max_target_force_n"],
                        run["reset_position_error_m"],
                        run["reset_rotation_component_error"],
                        run["reset_linear_velocity_m_s"],
                        run["reset_angular_velocity_rad_s"],
                    )
                ):
                    raise RuntimeError("contact/reset result is non-finite")
                runs.append(run)
            repeatable = all(
                run == {**runs[0], "repetition": index + 1}
                for index, run in enumerate(runs)
            )
            passed = repeatable and all(
                run["first_contact_frame"] is not None
                and run["target_contact_frames"] > 0
                and run["max_contact_points"] > 0
                and run["max_target_force_n"] > 0
                and max(
                    run["reset_position_error_m"],
                    run["reset_rotation_component_error"],
                    run["reset_linear_velocity_m_s"],
                    run["reset_angular_velocity_rad_s"],
                )
                <= tolerance
                for run in runs
            )
            if not passed:
                raise RuntimeError("contact/reset acceptance failed")
            return {
                "fixture_id": "compiled-scene-contact-reset-v1",
                "native_scene_load": "passed",
                "loaded_actor_names": request["scene_actor_names"],
                "timestep_seconds": timestep,
                "frames_per_repetition": frames,
                "repetitions": repetitions,
                "reset_tolerance": tolerance,
                "runs": runs,
                "repeatable": True,
                "passed": True,
            }
        except SceneJobError:
            raise
        except Exception as error:
            raise SceneJobError("contact_failure") from error
    finally:
        if probe is not None:
            for query in queries:
                probe.cancel_query(query)
        if scene is not None and initial_state is not None:
            scene.release_state(initial_state)
        if scene is not None:
            physics.destroy_scene(scene)
        if physics.is_initialized():
            physics.shutdown()


def _report(status: str, runtime: dict[str, Any], **values: Any) -> dict[str, Any]:
    return {
        "schema": "world_studio.superdex_worker_probe.v0.1",
        "status": status,
        "runtime": runtime,
        "capability": values.get("capability"),
        "smoke": values.get("smoke"),
        "failure": values.get("failure"),
    }


def _capability(runtime: dict[str, Any], limitations: list[str]) -> dict[str, Any]:
    return {
        "schema": "world_studio.simulation_backend_capability.v0.1",
        "backend_id": "superdex",
        "backend_version": runtime["packages"]["superdex_physics"],
        "adapter_version": ADAPTER_VERSION,
        "device_classes": ["cpu"],
        "scene_formats": ["superdex_mochi_scene"],
        "coordinate_frames": ["right_y_up"],
        "capabilities": [
            "rigid_body",
            "primitive_contact",
            "contact_points",
            "contact_force_distribution",
            "deterministic_reset",
        ],
        "authority": "software_capability_only",
        "limitations": limitations,
    }


def _scene_report(
    status: str,
    runtime: dict[str, Any],
    request: dict[str, Any],
    job_sha256: str,
    **values: Any,
) -> dict[str, Any]:
    return {
        "schema": "world_studio.superdex_scene_job_receipt.v0.1",
        "status": status,
        "job_sha256": job_sha256,
        "request": request,
        "runtime": runtime,
        "capability": values.get("capability"),
        "execution": values.get("execution"),
        "failure": values.get("failure"),
        "authority": "compiled_scene_execution_only",
        "limitations": SCENE_JOB_LIMITATIONS,
    }


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(report, allow_nan=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _run_scene_mode(
    output: Path,
    job_file: Path,
    package_root_value: Path,
    runtime: dict[str, Any],
) -> int:
    try:
        job_path = _private_input(job_file)
        package_root = _private_input(package_root_value)
        job_bytes = job_path.read_bytes()
        request = _validate_scene_job_request(_strict_json_bytes(job_bytes))
        job_sha256 = _bytes_sha256(job_bytes)
    except Exception:
        return 1

    if not _supported_runtime(runtime):
        _write_report(
            output,
            _scene_report(
                "unavailable",
                runtime,
                request,
                job_sha256,
                failure={
                    "code": "unsupported_runtime",
                    "message": "SuperDex 1.0.0 requires Python 3.12 on a supported CPU platform.",
                },
            ),
        )
        return 2
    for key, (_, expected) in EXPECTED_PACKAGES.items():
        if runtime["packages"][key] != expected:
            _write_report(
                output,
                _scene_report(
                    "unavailable",
                    runtime,
                    request,
                    job_sha256,
                    failure={
                        "code": "package_unavailable",
                        "message": "Pinned SuperDex Physics and Robotics 1.0.0 packages are required.",
                    },
                ),
            )
            return 2
    try:
        package = _verify_scene_package(package_root, request)
    except Exception:
        _write_report(
            output,
            _scene_report(
                "failed",
                runtime,
                request,
                job_sha256,
                failure={
                    "code": "package_invalid",
                    "message": "The staged SuperDex scene package failed checksum or structure validation.",
                },
            ),
        )
        return 1
    try:
        import superdex.physics as physics
        import superdex.robotics  # noqa: F401

        execution = _run_scene_contact_reset(physics, package_root, package, request)
        _write_report(
            output,
            _scene_report(
                "passed",
                runtime,
                request,
                job_sha256,
                capability=_capability(
                    runtime,
                    [
                        "Checksum-bound compiled scene contact/reset fixture only.",
                        "SuperDex Robotics imports successfully but is not exercised by this job.",
                    ],
                ),
                execution=execution,
            ),
        )
        return 0
    except SceneJobError as error:
        code = error.code
    except Exception:
        code = "runtime_failure"
    _write_report(
        output,
        _scene_report(
            "failed",
            runtime,
            request,
            job_sha256,
            failure={
                "code": code,
                "message": "The checksum-bound SuperDex scene contact/reset job failed.",
            },
        ),
    )
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--job-file", type=Path)
    parser.add_argument("--package-root", type=Path)
    parser.add_argument("--supervisor-token")
    args = parser.parse_args()
    runtime = _runtime()

    if args.supervisor_token is not None:
        try:
            _identifier(args.supervisor_token)
        except ValueError:
            parser.error("--supervisor-token must be a bounded identifier")
    if (args.job_file is None) != (args.package_root is None):
        parser.error("--job-file and --package-root must be supplied together")
    if args.job_file is not None:
        return _run_scene_mode(
            args.output,
            args.job_file,
            args.package_root,
            runtime,
        )

    if not _supported_runtime(runtime):
        report = _report(
            "unavailable",
            runtime,
            failure={
                "code": "unsupported_runtime",
                "message": "SuperDex 1.0.0 requires Python 3.12 on a supported CPU platform.",
            },
        )
        _write_report(args.output, report)
        return 2

    for key, (_, expected) in EXPECTED_PACKAGES.items():
        if runtime["packages"][key] != expected:
            report = _report(
                "unavailable",
                runtime,
                failure={
                    "code": "package_unavailable",
                    "message": "Pinned SuperDex Physics and Robotics 1.0.0 packages are required.",
                },
            )
            _write_report(args.output, report)
            return 2

    try:
        import superdex.physics as physics
        import superdex.robotics  # noqa: F401

        smoke = _run_smoke(physics)
        capability = _capability(
            runtime,
            [
                "Synthetic single-body fixture only; no measured-world, robot, tactile, deformable, or performance authority.",
                "SuperDex Robotics imports successfully but is not exercised by this probe.",
            ],
        )
        report = _report("passed", runtime, capability=capability, smoke=smoke)
        _write_report(args.output, report)
        return 0
    except Exception as error:
        report = _report(
            "failed",
            runtime,
            failure={
                "code": "runtime_failure",
                "message": f"SuperDex synthetic probe failed ({type(error).__name__}).",
            },
        )
        _write_report(args.output, report)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
