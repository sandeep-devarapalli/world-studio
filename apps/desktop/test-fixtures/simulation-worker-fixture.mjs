import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const mode = args.get("--mode") ?? "success";
const output = args.get("--output");
if (!output) throw new Error("missing output");

if (mode === "descendant-hang") {
  const child = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000);"
  ], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await writeFile(path.join(process.cwd(), "descendant.pid"), String(child.pid));
  setInterval(() => undefined, 1_000);
} else if (mode === "hang") {
  setInterval(() => undefined, 1_000);
} else {
  await mkdir(path.dirname(output), { recursive: true });
  if (mode === "extra-output") await writeFile(path.join(path.dirname(output), "extra.bin"), "undeclared");
  if (mode === "oversized-log") process.stdout.write("x".repeat(128 * 1024));
  if (mode === "logs") {
    process.stdout.write("fixture stdout\n");
    process.stderr.write("fixture stderr\n");
  }
  if (mode === "fail-once" && !(await exists(path.join(process.cwd(), "failed-once.marker")))) {
    await writeFile(path.join(process.cwd(), "failed-once.marker"), "failed\n");
    await writeFile(output, `${JSON.stringify(failedReport(), null, 2)}\n`);
    process.exitCode = 1;
  } else if (mode === "malformed") {
    await writeFile(output, "{}\n");
  } else if (mode === "unavailable") {
    await writeFile(output, `${JSON.stringify(unavailableReport(), null, 2)}\n`);
    process.exitCode = 2;
  } else {
    await writeFile(output, `${JSON.stringify(passedReport(), null, 2)}\n`);
    if (mode === "nonzero-pass") process.exitCode = 1;
  }
}

function passedReport() {
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

function unavailableReport() {
  return {
    schema: "world_studio.superdex_worker_probe.v0.1",
    status: "unavailable",
    runtime: {
      python_version: process.versions.node,
      platform: process.platform,
      machine: process.arch,
      packages: { superdex_physics: null, superdex_robotics: null }
    },
    capability: null,
    smoke: null,
    failure: {
      code: "package_unavailable",
      message: "Pinned SuperDex packages are unavailable."
    }
  };
}

function failedReport() {
  const report = unavailableReport();
  return {
    ...report,
    status: "failed",
    failure: { code: "runtime_failure", message: "Synthetic first attempt failed." }
  };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
