import {
  SIMULATION_BACKEND_CAPABILITY_SCHEMA,
  type SimulationBackendCapabilityV1,
  type SimulationCapability,
  type SimulationCoordinateFrame,
  type SimulationDeviceClass,
  type SimulationSceneFormat
} from "./simulation-backend-contract.js";

export const SUPERDEX_WORKER_PROBE_SCHEMA = "world_studio.superdex_worker_probe.v0.1" as const;
export const SUPERDEX_SMOKE_RESULT_SCHEMA = "world_studio.superdex_smoke_result.v0.1" as const;

export interface SuperDexSmokeRunV1 {
  repetition: number;
  first_contact_frame: number;
  contact_frames: number;
  max_contact_points: number;
  max_point_force_n: number;
  max_total_force_n: number;
  final_position_m: [number, number, number];
  reset_position_error_m: number;
  reset_rotation_component_error: number;
  reset_linear_velocity_m_s: number;
  reset_angular_velocity_rad_s: number;
}

export interface SuperDexSmokeResultV1 {
  schema: typeof SUPERDEX_SMOKE_RESULT_SCHEMA;
  fixture_id: "synthetic-rigid-contact-reset-v1";
  timestep_seconds: number;
  frames_per_repetition: number;
  repetitions: number;
  reset_tolerance: number;
  runs: SuperDexSmokeRunV1[];
  repeatable: true;
  passed: true;
  authority: "software_capability_only";
}

export interface SuperDexWorkerProbeV1 {
  schema: typeof SUPERDEX_WORKER_PROBE_SCHEMA;
  status: "passed" | "unavailable" | "failed";
  runtime: {
    python_version: string;
    platform: string;
    machine: string;
    packages: {
      superdex_physics: string | null;
      superdex_robotics: string | null;
    };
  };
  capability: SimulationBackendCapabilityV1 | null;
  smoke: SuperDexSmokeResultV1 | null;
  failure: {
    code: "unsupported_runtime" | "package_unavailable" | "runtime_failure";
    message: string;
  } | null;
}

const capabilities: SimulationCapability[] = [
  "rigid_body", "articulation", "fixed_manipulator", "inverse_kinematics",
  "joint_position_control", "joint_torque_control", "primitive_contact", "mesh_contact",
  "sdf_contact", "hydroelastic_contact", "contact_points", "contact_force_distribution",
  "tactile_contact", "deterministic_reset", "batched_worlds", "isaac_lab", "soft_body",
  "rod", "tendon", "cloth"
];
const probedCapabilities: SimulationCapability[] = [
  "rigid_body",
  "primitive_contact",
  "contact_points",
  "contact_force_distribution",
  "deterministic_reset"
];

export function validateSuperDexWorkerProbe(value: unknown): SuperDexWorkerProbeV1 {
  const probe = record(value, "probe");
  exactKeys(probe, ["schema", "status", "runtime", "capability", "smoke", "failure"], "probe");
  literal(probe.schema, SUPERDEX_WORKER_PROBE_SCHEMA, "probe.schema");
  const status = oneOf(probe.status, ["passed", "unavailable", "failed"] as const, "probe.status");
  const runtime = validateRuntime(probe.runtime);

  if (status !== "passed") {
    if (probe.capability !== null || probe.smoke !== null) throw new Error("Non-passing probe must not advertise capabilities.");
    return {
      schema: SUPERDEX_WORKER_PROBE_SCHEMA,
      status,
      runtime,
      capability: null,
      smoke: null,
      failure: validateFailure(probe.failure)
    };
  }

  if (probe.failure !== null) throw new Error("Passing probe cannot contain a failure.");
  const capability = validateCapability(probe.capability);
  const smoke = validateSmoke(probe.smoke);
  if (capability.backend_id !== "superdex") throw new Error("Probe capability must identify SuperDex.");
  if (capability.backend_version !== runtime.packages.superdex_physics) throw new Error("Probe package and backend versions differ.");
  if (!/^3\.12\./.test(runtime.python_version)
    || runtime.packages.superdex_physics !== "1.0.0"
    || runtime.packages.superdex_robotics !== "1.0.0") throw new Error("Passing probe must bind the pinned Python and package versions.");
  exactValues(capability.device_classes, ["cpu"], "probe.capability.device_classes");
  exactValues(capability.scene_formats, ["superdex_mochi_scene"], "probe.capability.scene_formats");
  exactValues(capability.coordinate_frames, ["right_y_up"], "probe.capability.coordinate_frames");
  exactValues(capability.capabilities, probedCapabilities, "probe.capability.capabilities");
  if (capability.adapter_version !== "0.1.0") throw new Error("Probe adapter version is unsupported.");
  return { schema: SUPERDEX_WORKER_PROBE_SCHEMA, status, runtime, capability, smoke, failure: null };
}

function validateRuntime(value: unknown): SuperDexWorkerProbeV1["runtime"] {
  const runtime = record(value, "probe.runtime");
  exactKeys(runtime, ["python_version", "platform", "machine", "packages"], "probe.runtime");
  const packages = record(runtime.packages, "probe.runtime.packages");
  exactKeys(packages, ["superdex_physics", "superdex_robotics"], "probe.runtime.packages");
  return {
    python_version: nonEmpty(runtime.python_version, "probe.runtime.python_version"),
    platform: nonEmpty(runtime.platform, "probe.runtime.platform"),
    machine: nonEmpty(runtime.machine, "probe.runtime.machine"),
    packages: {
      superdex_physics: nullableString(packages.superdex_physics, "probe.runtime.packages.superdex_physics"),
      superdex_robotics: nullableString(packages.superdex_robotics, "probe.runtime.packages.superdex_robotics")
    }
  };
}

function validateCapability(value: unknown): SimulationBackendCapabilityV1 {
  const report = record(value, "probe.capability");
  exactKeys(report, ["schema", "backend_id", "backend_version", "adapter_version", "device_classes", "scene_formats", "coordinate_frames", "capabilities", "authority", "limitations"], "probe.capability");
  literal(report.schema, SIMULATION_BACKEND_CAPABILITY_SCHEMA, "probe.capability.schema");
  return {
    schema: SIMULATION_BACKEND_CAPABILITY_SCHEMA,
    backend_id: oneOf(report.backend_id, ["newton", "superdex"] as const, "probe.capability.backend_id"),
    backend_version: nonEmpty(report.backend_version, "probe.capability.backend_version"),
    adapter_version: nonEmpty(report.adapter_version, "probe.capability.adapter_version"),
    device_classes: enumArray(report.device_classes, ["cpu", "cuda"] as const, "probe.capability.device_classes") as SimulationDeviceClass[],
    scene_formats: enumArray(report.scene_formats, ["openusd", "superdex_mochi_scene"] as const, "probe.capability.scene_formats") as SimulationSceneFormat[],
    coordinate_frames: enumArray(report.coordinate_frames, ["right_y_up", "right_z_up"] as const, "probe.capability.coordinate_frames") as SimulationCoordinateFrame[],
    capabilities: enumArray(report.capabilities, capabilities, "probe.capability.capabilities") as SimulationCapability[],
    authority: literal(report.authority, "software_capability_only", "probe.capability.authority"),
    limitations: stringArray(report.limitations, "probe.capability.limitations")
  };
}

function validateSmoke(value: unknown): SuperDexSmokeResultV1 {
  const smoke = record(value, "probe.smoke");
  exactKeys(smoke, ["schema", "fixture_id", "timestep_seconds", "frames_per_repetition", "repetitions", "reset_tolerance", "runs", "repeatable", "passed", "authority"], "probe.smoke");
  literal(smoke.schema, SUPERDEX_SMOKE_RESULT_SCHEMA, "probe.smoke.schema");
  const frames = integer(smoke.frames_per_repetition, "probe.smoke.frames_per_repetition", 1);
  const repetitions = integer(smoke.repetitions, "probe.smoke.repetitions", 1);
  const tolerance = finite(smoke.reset_tolerance, "probe.smoke.reset_tolerance", Number.MIN_VALUE);
  if (smoke.timestep_seconds !== 1 / 60 || frames !== 180 || repetitions !== 3 || tolerance !== 1e-6) {
    throw new Error("Smoke fixture parameters differ from the bounded v1 probe.");
  }
  if (!Array.isArray(smoke.runs) || smoke.runs.length !== repetitions) throw new Error("Smoke run count must match repetitions.");
  const runs = smoke.runs.map((run, index) => validateRun(run, index + 1, frames, tolerance));
  const reference = JSON.stringify({ ...runs[0], repetition: 0 });
  if (runs.some((run) => JSON.stringify({ ...run, repetition: 0 }) !== reference)) {
    throw new Error("Smoke repetitions are not identical.");
  }
  return {
    schema: SUPERDEX_SMOKE_RESULT_SCHEMA,
    fixture_id: literal(smoke.fixture_id, "synthetic-rigid-contact-reset-v1", "probe.smoke.fixture_id"),
    timestep_seconds: finite(smoke.timestep_seconds, "probe.smoke.timestep_seconds", Number.MIN_VALUE),
    frames_per_repetition: frames,
    repetitions,
    reset_tolerance: tolerance,
    runs,
    repeatable: literal(smoke.repeatable, true, "probe.smoke.repeatable"),
    passed: literal(smoke.passed, true, "probe.smoke.passed"),
    authority: literal(smoke.authority, "software_capability_only", "probe.smoke.authority")
  };
}

function validateRun(value: unknown, repetition: number, frames: number, tolerance: number): SuperDexSmokeRunV1 {
  const run = record(value, `probe.smoke.runs[${repetition - 1}]`);
  const keys = ["repetition", "first_contact_frame", "contact_frames", "max_contact_points", "max_point_force_n", "max_total_force_n", "final_position_m", "reset_position_error_m", "reset_rotation_component_error", "reset_linear_velocity_m_s", "reset_angular_velocity_rad_s"];
  exactKeys(run, keys, `probe.smoke.runs[${repetition - 1}]`);
  if (integer(run.repetition, "run.repetition", 1) !== repetition) throw new Error("Smoke repetitions must be ordered.");
  const firstContact = integer(run.first_contact_frame, "run.first_contact_frame", 1);
  const contactFrames = integer(run.contact_frames, "run.contact_frames", 1);
  if (firstContact > frames || contactFrames > frames) throw new Error("Smoke contact frames exceed the frame budget.");
  const result: SuperDexSmokeRunV1 = {
    repetition,
    first_contact_frame: firstContact,
    contact_frames: contactFrames,
    max_contact_points: integer(run.max_contact_points, "run.max_contact_points", 1),
    max_point_force_n: finite(run.max_point_force_n, "run.max_point_force_n", Number.MIN_VALUE),
    max_total_force_n: finite(run.max_total_force_n, "run.max_total_force_n", Number.MIN_VALUE),
    final_position_m: triplet(run.final_position_m, "run.final_position_m"),
    reset_position_error_m: finite(run.reset_position_error_m, "run.reset_position_error_m", 0),
    reset_rotation_component_error: finite(run.reset_rotation_component_error, "run.reset_rotation_component_error", 0),
    reset_linear_velocity_m_s: finite(run.reset_linear_velocity_m_s, "run.reset_linear_velocity_m_s", 0),
    reset_angular_velocity_rad_s: finite(run.reset_angular_velocity_rad_s, "run.reset_angular_velocity_rad_s", 0)
  };
  if (Math.max(result.reset_position_error_m, result.reset_rotation_component_error, result.reset_linear_velocity_m_s, result.reset_angular_velocity_rad_s) > tolerance) {
    throw new Error("Smoke reset exceeded its declared tolerance.");
  }
  return result;
}

function validateFailure(value: unknown): NonNullable<SuperDexWorkerProbeV1["failure"]> {
  const failure = record(value, "probe.failure");
  exactKeys(failure, ["code", "message"], "probe.failure");
  const message = nonEmpty(failure.message, "probe.failure.message");
  if (message.length > 512 || /[\r\n]/.test(message)) throw new Error("Probe failure message is unsafe.");
  return { code: oneOf(failure.code, ["unsupported_runtime", "package_unavailable", "runtime_failure"] as const, "probe.failure.code"), message };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unexpected fields.`);
}

function exactValues<T extends string>(value: readonly T[], expected: readonly T[], label: string): void {
  if (value.length !== expected.length || value.some((entry, index) => entry !== expected[index])) {
    throw new Error(`${label} differs from the exercised probe.`);
  }
}

function literal<T extends string | boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must be ${String(expected)}.`);
  return expected;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label} is unsupported.`);
  return value as T;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new Error(`${label} must be a bounded string.`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonEmpty(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be non-empty.`);
  const result = value.map((entry, index) => nonEmpty(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique.`);
  return result;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], label: string): T[] {
  const result = stringArray(value, label).map((entry) => oneOf(entry, allowed, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique.`);
  return result;
}

function finite(value: unknown, label: string, minimum: number, maximum = Number.POSITIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} must be finite and bounded.`);
  return value;
}

function integer(value: unknown, label: string, minimum: number): number {
  const result = finite(value, label, minimum);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}

function triplet(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain three values.`);
  return value.map((entry, index) => finite(entry, `${label}[${index}]`, -2, 2)) as [number, number, number];
}
