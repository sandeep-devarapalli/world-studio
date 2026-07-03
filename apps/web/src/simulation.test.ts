import { describe, expect, it } from "vitest";
import { parseObjMesh } from "@world-studio/artifacts";
import { RapierSimulation, agentBodyPresets } from "./simulation";

describe("RapierSimulation", () => {
  it("builds static colliders from OBJ bounds and steps the agent", async () => {
    const mesh = parseObjMesh(`o floor
v -1 0 -1
v 1 0 -1
v 1 0 1
v -1 0 1
f 1 2 3 4`);
    const body = agentBodyPresets.find((preset) => preset.id === "locobot") ?? agentBodyPresets[0];
    const simulation = await RapierSimulation.create({ mesh, agent: { x: 0, z: 0, heading: 0 }, body });

    expect(simulation.diagnostics()).toMatchObject({
      backend: "rapier3d-compat",
      stepRateHz: 60,
      bodyCount: 1,
      colliderCount: 2
    });

    const step = simulation.step({ move: 1, turn: 0 });
    expect(step.agent.x).toBeGreaterThan(0);
    expect(step.agent.heading).toBe(0);
    expect(step.diagnostics.backend).toBe("rapier3d-compat");

    simulation.dispose();
  });
});
