#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

ADAPTER_VERSION = "0.1.0"
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


def _cube_shape(physics: Any) -> Any:
    vertices = [
        -0.2, -0.2, -0.2, 0.2, -0.2, -0.2,
        0.2, 0.2, -0.2, -0.2, 0.2, -0.2,
        -0.2, -0.2, 0.2, 0.2, -0.2, 0.2,
        0.2, 0.2, 0.2, -0.2, 0.2, 0.2,
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


def _report(status: str, runtime: dict[str, Any], **values: Any) -> dict[str, Any]:
    return {
        "schema": "world_studio.superdex_worker_probe.v0.1",
        "status": status,
        "runtime": runtime,
        "capability": values.get("capability"),
        "smoke": values.get("smoke"),
        "failure": values.get("failure"),
    }


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(report, allow_nan=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    runtime = _runtime()

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
        capability = {
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
            "limitations": [
                "Synthetic single-body fixture only; no measured-world, robot, tactile, deformable, or performance authority.",
                "SuperDex Robotics imports successfully but is not exercised by this probe.",
            ],
        }
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
