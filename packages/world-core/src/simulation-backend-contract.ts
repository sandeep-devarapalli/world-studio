export const SIMULATION_BACKEND_CAPABILITY_SCHEMA =
  "world_studio.simulation_backend_capability.v0.1" as const;
export const SIMULATION_BACKEND_REQUIREMENTS_SCHEMA =
  "world_studio.simulation_backend_requirements.v0.1" as const;

export type SimulationBackendId = "newton" | "superdex";
export type SimulationDeviceClass = "cpu" | "cuda";
export type SimulationSceneFormat = "openusd" | "superdex_mochi_scene";
export type SimulationCoordinateFrame = "right_y_up" | "right_z_up";
export type SimulationCapability =
  | "rigid_body"
  | "articulation"
  | "fixed_manipulator"
  | "inverse_kinematics"
  | "joint_position_control"
  | "joint_torque_control"
  | "primitive_contact"
  | "mesh_contact"
  | "sdf_contact"
  | "hydroelastic_contact"
  | "contact_points"
  | "contact_force_distribution"
  | "tactile_contact"
  | "deterministic_reset"
  | "batched_worlds"
  | "isaac_lab"
  | "soft_body"
  | "rod"
  | "tendon"
  | "cloth";

export interface SimulationBackendCapabilityV1 {
  schema: typeof SIMULATION_BACKEND_CAPABILITY_SCHEMA;
  backend_id: SimulationBackendId;
  backend_version: string;
  adapter_version: string;
  device_classes: SimulationDeviceClass[];
  scene_formats: SimulationSceneFormat[];
  coordinate_frames: SimulationCoordinateFrame[];
  capabilities: SimulationCapability[];
  authority: "software_capability_only";
  limitations: string[];
}

export interface SimulationBackendRequirementsV1 {
  schema: typeof SIMULATION_BACKEND_REQUIREMENTS_SCHEMA;
  device_class: SimulationDeviceClass;
  scene_format: SimulationSceneFormat;
  coordinate_frame: SimulationCoordinateFrame;
  required_capabilities: SimulationCapability[];
}

export interface SimulationBackendAssessmentV1 {
  backend_id: SimulationBackendId;
  compatible: boolean;
  device_supported: boolean;
  scene_format_supported: boolean;
  coordinate_frame_supported: boolean;
  missing_capabilities: SimulationCapability[];
}

export interface SimulationBackendSelectionV1 {
  backend: SimulationBackendCapabilityV1;
  assessment: SimulationBackendAssessmentV1;
  reason: "explicit_request" | "general_default" | "contact_specialist";
}

const contactSpecialistCapabilities = new Set<SimulationCapability>([
  "contact_force_distribution",
  "tactile_contact",
  "soft_body",
  "rod",
  "tendon",
  "cloth"
]);

export function assessSimulationBackend(
  requirements: SimulationBackendRequirementsV1,
  backend: SimulationBackendCapabilityV1
): SimulationBackendAssessmentV1 {
  assertUnique(requirements.required_capabilities, "required capabilities");
  assertUnique(backend.device_classes, `${backend.backend_id} device classes`);
  assertUnique(backend.scene_formats, `${backend.backend_id} scene formats`);
  assertUnique(backend.coordinate_frames, `${backend.backend_id} coordinate frames`);
  assertUnique(backend.capabilities, `${backend.backend_id} capabilities`);

  const available = new Set(backend.capabilities);
  const missingCapabilities = requirements.required_capabilities.filter(
    (capability) => !available.has(capability)
  );
  const deviceSupported = backend.device_classes.includes(requirements.device_class);
  const sceneFormatSupported = backend.scene_formats.includes(requirements.scene_format);
  const coordinateFrameSupported = backend.coordinate_frames.includes(requirements.coordinate_frame);

  return {
    backend_id: backend.backend_id,
    compatible:
      deviceSupported &&
      sceneFormatSupported &&
      coordinateFrameSupported &&
      missingCapabilities.length === 0,
    device_supported: deviceSupported,
    scene_format_supported: sceneFormatSupported,
    coordinate_frame_supported: coordinateFrameSupported,
    missing_capabilities: missingCapabilities
  };
}

export function selectSimulationBackend(
  requirements: SimulationBackendRequirementsV1,
  backends: SimulationBackendCapabilityV1[],
  requestedBackend?: SimulationBackendId
): SimulationBackendSelectionV1 {
  const reports = new Map<SimulationBackendId, SimulationBackendCapabilityV1>();
  for (const backend of backends) {
    if (reports.has(backend.backend_id)) {
      throw new Error(`Duplicate simulation capability report for ${backend.backend_id}.`);
    }
    reports.set(backend.backend_id, backend);
  }

  if (requestedBackend) {
    const backend = reports.get(requestedBackend);
    if (!backend) {
      throw new Error(`Requested simulation backend ${requestedBackend} is unavailable.`);
    }
    const assessment = assessSimulationBackend(requirements, backend);
    if (!assessment.compatible) {
      throw new Error(incompatibilityMessage(assessment, requirements));
    }
    return { backend, assessment, reason: "explicit_request" };
  }

  const compatible = [...reports.values()]
    .map((backend) => ({ backend, assessment: assessSimulationBackend(requirements, backend) }))
    .filter(({ assessment }) => assessment.compatible);
  if (compatible.length === 0) {
    throw new Error("No simulation backend satisfies the declared requirements.");
  }

  const contactSpecialist = requirements.required_capabilities.some((capability) =>
    contactSpecialistCapabilities.has(capability)
  );
  const preference: SimulationBackendId[] = contactSpecialist
    ? ["superdex", "newton"]
    : ["newton", "superdex"];
  compatible.sort(
    (left, right) =>
      preference.indexOf(left.backend.backend_id) - preference.indexOf(right.backend.backend_id)
  );
  const selected = compatible[0];
  return {
    ...selected,
    reason: contactSpecialist ? "contact_specialist" : "general_default"
  };
}

function incompatibilityMessage(
  assessment: SimulationBackendAssessmentV1,
  requirements: SimulationBackendRequirementsV1
): string {
  const reasons: string[] = [];
  if (!assessment.device_supported) reasons.push(`device ${requirements.device_class}`);
  if (!assessment.scene_format_supported) reasons.push(`scene format ${requirements.scene_format}`);
  if (!assessment.coordinate_frame_supported) {
    reasons.push(`coordinate frame ${requirements.coordinate_frame}`);
  }
  if (assessment.missing_capabilities.length) {
    reasons.push(`capabilities ${assessment.missing_capabilities.join(", ")}`);
  }
  return `Requested simulation backend ${assessment.backend_id} does not satisfy: ${reasons.join("; ")}.`;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}
