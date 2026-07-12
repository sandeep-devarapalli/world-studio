import { describe, expect, it } from "vitest";
import { parseObjMesh } from "@world-studio/artifacts";
import { RapierSimulation, RapierWalkSimulation, agentBodyPresets } from "./simulation";

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

  it("keeps a kinematic walk capsule on the triangle floor and behind a wall", async () => {
    const mesh = parseObjMesh(`o floor
v -2 0 -2
v 2 0 -2
v 2 0 2
v -2 0 2
f 1 3 2
f 1 4 3
o wall
v 0.7 0 -2
v 0.7 2 -2
v 0.7 2 2
v 0.7 0 2
f 5 6 7
f 5 7 8`);
    const simulation = await RapierWalkSimulation.create({
      mesh,
      camera: { position: [0, 1.6, 0], rotation: [1, 0, 0, 0], fov: 60 },
      worldUnitsPerMeter: 1
    });

    let step = simulation.snapshot();
    for (let index = 0; index < 120; index += 1) step = simulation.step([1, 0], 1 / 60);

    expect(step.position[0]).toBeLessThan(0.55);
    expect(step.position[1]).toBeGreaterThan(1.45);
    expect(simulation.diagnostics()).toMatchObject({ backend: "rapier3d-compat", colliderCount: 2 });
    simulation.dispose();
  });

  it("does not create an artificial floor for Walk", async () => {
    const wallOnly = parseObjMesh(`o wall
v 2 0 -1
v 2 2 -1
v 2 2 1
v 2 0 1
f 1 2 3
f 1 3 4`);

    await expect(RapierWalkSimulation.create({
      mesh: wallOnly,
      camera: { position: [0, 1.6, 0], rotation: [1, 0, 0, 0], fov: 60 },
      worldUnitsPerMeter: 1
    })).rejects.toThrow("no registered floor support");
  });
});
