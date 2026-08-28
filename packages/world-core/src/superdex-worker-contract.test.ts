import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SUPERDEX_SCENE_JOB_LIMITATIONS,
  validateSuperDexSceneJobReceipt,
  validateSuperDexWorkerProbe
} from "./superdex-worker-contract";

const worker = fileURLToPath(new URL("../../../workers/superdex/superdex_worker.py", import.meta.url));

function passedProbe(): Record<string, unknown> {
  const run = {
    first_contact_frame: 20,
    contact_frames: 161,
    max_contact_points: 6,
    max_point_force_n: 1413.8,
    max_total_force_n: 8483.2,
    final_position_m: [0, 0.199, 0],
    reset_position_error_m: 0,
    reset_rotation_component_error: 0,
    reset_linear_velocity_m_s: 0,
    reset_angular_velocity_rad_s: 0
  };
  return {
    schema: "world_studio.superdex_worker_probe.v0.1",
    status: "passed",
    runtime: {
      python_version: "3.12.8",
      platform: "Darwin",
      machine: "arm64",
      packages: { superdex_physics: "1.0.0", superdex_robotics: "1.0.0" }
    },
    capability: {
      schema: "world_studio.simulation_backend_capability.v0.1",
      backend_id: "superdex",
      backend_version: "1.0.0",
      adapter_version: "0.1.0",
      device_classes: ["cpu"],
      scene_formats: ["superdex_mochi_scene"],
      coordinate_frames: ["right_y_up"],
      capabilities: ["rigid_body", "primitive_contact", "contact_points", "contact_force_distribution", "deterministic_reset"],
      authority: "software_capability_only",
      limitations: ["Synthetic fixture only."]
    },
    smoke: {
      schema: "world_studio.superdex_smoke_result.v0.1",
      fixture_id: "synthetic-rigid-contact-reset-v1",
      timestep_seconds: 1 / 60,
      frames_per_repetition: 180,
      repetitions: 3,
      reset_tolerance: 1e-6,
      runs: [1, 2, 3].map((repetition) => ({ repetition, ...run })),
      repeatable: true,
      passed: true,
      authority: "software_capability_only"
    },
    failure: null
  };
}

function passedSceneReceipt(): Record<string, unknown> {
  const request = {
    schema: "world_studio.superdex_scene_job_request.v0.1",
    scene_job_id: "table-contact-v1",
    package_id: "superdex-package-v1",
    package_manifest_sha256: `sha256:${"1".repeat(64)}`,
    source_world: {
      kind: "world",
      id: "room",
      version_id: "room-v1",
      version: 1,
      manifest_sha256: `sha256:${"2".repeat(64)}`
    },
    scene_sha256: `sha256:${"3".repeat(64)}`,
    scene_actor_names: ["table_collision"],
    target_actor_name: "table_collision",
    probe_initial_position_m: [0, 1, 0],
    probe_size_m: [0.05, 0.05, 0.05],
    timestep_seconds: 1 / 60,
    frames_per_repetition: 180,
    repetitions: 3,
    reset_tolerance: 1e-6,
    authority: "compiled_scene_execution_only",
    limitations: [...SUPERDEX_SCENE_JOB_LIMITATIONS]
  };
  const run = {
    first_contact_frame: 20,
    contact_frames: 161,
    target_contact_frames: 161,
    max_contact_points: 6,
    max_point_force_n: 1413.8,
    max_total_force_n: 8483.2,
    max_target_force_n: 8483.2,
    final_position_m: [0, 0.525, 0],
    reset_position_error_m: 0,
    reset_rotation_component_error: 0,
    reset_linear_velocity_m_s: 0,
    reset_angular_velocity_rad_s: 0
  };
  return {
    schema: "world_studio.superdex_scene_job_receipt.v0.1",
    status: "passed",
    job_sha256: `sha256:${"4".repeat(64)}`,
    request,
    runtime: (passedProbe().runtime as Record<string, unknown>),
    capability: (passedProbe().capability as Record<string, unknown>),
    execution: {
      fixture_id: "compiled-scene-contact-reset-v1",
      native_scene_load: "passed",
      loaded_actor_names: ["table_collision"],
      timestep_seconds: 1 / 60,
      frames_per_repetition: 180,
      repetitions: 3,
      reset_tolerance: 1e-6,
      runs: [1, 2, 3].map((repetition) => ({ repetition, ...run })),
      repeatable: true,
      passed: true
    },
    failure: null,
    authority: "compiled_scene_execution_only",
    limitations: [...SUPERDEX_SCENE_JOB_LIMITATIONS]
  };
}

describe("SuperDex worker probe contract", () => {
  it("accepts a pinned capability report with bounded contact and exact reset evidence", () => {
    expect(validateSuperDexWorkerProbe(passedProbe())).toMatchObject({
      status: "passed",
      capability: { backend_id: "superdex", backend_version: "1.0.0" },
      smoke: { passed: true, repeatable: true, repetitions: 3 }
    });
  });

  it("rejects capability advertising without matching evidence", () => {
    const probe = passedProbe();
    (probe.capability as Record<string, unknown>).capabilities = ["rigid_body"];
    expect(() => validateSuperDexWorkerProbe(probe)).toThrow(/differs from the exercised probe/);
  });

  it("rejects non-finite motion and reset tolerance violations", () => {
    const nonFinite = passedProbe();
    (((nonFinite.smoke as Record<string, unknown>).runs as Record<string, unknown>[])[0]).final_position_m = [0, Number.NaN, 0];
    expect(() => validateSuperDexWorkerProbe(nonFinite)).toThrow(/finite/);

    const badReset = passedProbe();
    (((badReset.smoke as Record<string, unknown>).runs as Record<string, unknown>[])[0]).reset_position_error_m = 1e-3;
    expect(() => validateSuperDexWorkerProbe(badReset)).toThrow(/reset exceeded/);
  });

  it("independently rejects a false repeatability claim", () => {
    const probe = passedProbe();
    (((probe.smoke as Record<string, unknown>).runs as Record<string, unknown>[])[2]).first_contact_frame = 21;
    expect(() => validateSuperDexWorkerProbe(probe)).toThrow(/not identical/);
  });

  it("runs fail-closed without the pinned runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "world-studio-superdex-unavailable-"));
    try {
      const output = join(root, "probe.json");
      const result = spawnSync("python3", ["-S", worker, "--output", output], { encoding: "utf8" });
      if (result.error && "code" in result.error && result.error.code === "ENOENT") return;
      expect(result.status).toBe(2);
      expect(validateSuperDexWorkerProbe(JSON.parse(await readFile(output, "utf8")))).toMatchObject({
        status: "unavailable",
        capability: null,
        smoke: null
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("SuperDex compiled-scene job contract", () => {
  it("accepts a checksum-bound native load, target contact, and three full resets", () => {
    expect(validateSuperDexSceneJobReceipt(passedSceneReceipt())).toMatchObject({
      status: "passed",
      request: { package_id: "superdex-package-v1", target_actor_name: "table_collision" },
      execution: { native_scene_load: "passed", repetitions: 3, repeatable: true }
    });
  });

  it("rejects a target outside the compiled actor inventory", () => {
    const receipt = passedSceneReceipt();
    (receipt.request as Record<string, unknown>).target_actor_name = "missing_collision";
    expect(() => validateSuperDexSceneJobReceipt(receipt)).toThrow(/target actor is absent/);
  });

  it("rejects contact evidence for a different actor inventory or non-identical reset", () => {
    const actors = passedSceneReceipt();
    (actors.execution as Record<string, unknown>).loaded_actor_names = ["other_collision"];
    expect(() => validateSuperDexSceneJobReceipt(actors)).toThrow(/actor inventory differs/);

    const reset = passedSceneReceipt();
    (((reset.execution as Record<string, unknown>).runs as Record<string, unknown>[])[2]).max_target_force_n = 1;
    expect(() => validateSuperDexSceneJobReceipt(reset)).toThrow(/not identical/);
  });
});
