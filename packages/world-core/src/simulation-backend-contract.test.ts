import { describe, expect, it } from "vitest";
import { compilePhysicsSmokeCell } from "./physics-smoke-cell";
import {
  SIMULATION_BACKEND_CAPABILITY_SCHEMA,
  assessSimulationBackend,
  selectSimulationBackend,
  type SimulationBackendCapabilityV1,
  type SimulationBackendId,
  type SimulationCapability,
  type SimulationSceneFormat
} from "./simulation-backend-contract";

const baseCapabilities: SimulationCapability[] = [
  "rigid_body",
  "primitive_contact",
  "contact_points",
  "deterministic_reset"
];

function report(
  backendId: SimulationBackendId,
  sceneFormats: SimulationSceneFormat[],
  capabilities: SimulationCapability[] = baseCapabilities
): SimulationBackendCapabilityV1 {
  return {
    schema: SIMULATION_BACKEND_CAPABILITY_SCHEMA,
    backend_id: backendId,
    backend_version: backendId === "newton" ? "1.5.0" : "1.0.0",
    adapter_version: "0.1.0",
    device_classes: ["cpu"],
    scene_formats: sceneFormats,
    coordinate_frames: ["right_y_up"],
    capabilities,
    authority: "software_capability_only",
    limitations: ["Synthetic fixture evidence only."]
  };
}

describe("simulation backend capability routing", () => {
  it("selects Newton for the existing OpenUSD smoke fixture", () => {
    const requirements = compilePhysicsSmokeCell().backendRequirements;
    const selected = selectSimulationBackend(requirements, [
      report("superdex", ["superdex_mochi_scene"]),
      report("newton", ["openusd"])
    ]);

    expect(selected.backend.backend_id).toBe("newton");
    expect(selected.reason).toBe("general_default");
  });

  it("reports that the current OpenUSD bundle still needs a SuperDex scene compiler", () => {
    const requirements = compilePhysicsSmokeCell().backendRequirements;
    const assessment = assessSimulationBackend(
      requirements,
      report("superdex", ["superdex_mochi_scene"])
    );

    expect(assessment).toMatchObject({
      compatible: false,
      device_supported: true,
      scene_format_supported: false,
      coordinate_frame_supported: true,
      missing_capabilities: []
    });
  });

  it("prefers SuperDex when both compatible adapters satisfy contact-specialist requirements", () => {
    const requirements = {
      ...compilePhysicsSmokeCell().backendRequirements,
      scene_format: "superdex_mochi_scene" as const,
      required_capabilities: [...baseCapabilities, "contact_force_distribution" as const]
    };
    const capabilities = [...baseCapabilities, "contact_force_distribution" as const];
    const selected = selectSimulationBackend(requirements, [
      report("newton", ["superdex_mochi_scene"], capabilities),
      report("superdex", ["superdex_mochi_scene"], capabilities)
    ]);

    expect(selected.backend.backend_id).toBe("superdex");
    expect(selected.reason).toBe("contact_specialist");
  });

  it("never falls back when an explicitly requested backend is incompatible", () => {
    const requirements = compilePhysicsSmokeCell().backendRequirements;
    expect(() => selectSimulationBackend(requirements, [
      report("newton", ["openusd"]),
      report("superdex", ["superdex_mochi_scene"])
    ], "superdex")).toThrow(/scene format openusd/);
  });

  it("rejects duplicate backend reports instead of choosing one implicitly", () => {
    const requirements = compilePhysicsSmokeCell().backendRequirements;
    expect(() => selectSimulationBackend(requirements, [
      report("newton", ["openusd"]),
      report("newton", ["openusd"])
    ])).toThrow(/Duplicate simulation capability report for newton/);
  });

  it("rejects an unreported coordinate conversion", () => {
    const requirements = compilePhysicsSmokeCell().backendRequirements;
    const superdex = report("superdex", ["openusd"]);
    superdex.coordinate_frames = ["right_z_up"];

    expect(() => selectSimulationBackend(requirements, [superdex], "superdex")).toThrow(
      /coordinate frame right_y_up/
    );
  });

  it("allows a future Newton profile to be selected explicitly when it reports the capabilities", () => {
    const requirements = {
      ...compilePhysicsSmokeCell().backendRequirements,
      required_capabilities: [...baseCapabilities, "tactile_contact" as const]
    };
    const selected = selectSimulationBackend(requirements, [
      report("newton", ["openusd"], [...baseCapabilities, "tactile_contact"])
    ], "newton");

    expect(selected.backend.backend_id).toBe("newton");
    expect(selected.reason).toBe("explicit_request");
  });
});
