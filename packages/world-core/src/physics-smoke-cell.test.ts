import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePhysicsSmokeCell, PHYSICS_SMOKE_JOB_SCHEMA } from "./physics-smoke-cell";

describe("physics smoke-cell compiler", () => {
  it("emits deterministic layered Y-up metre OpenUSD and a fixed CPU job", () => {
    const first = compilePhysicsSmokeCell();
    const second = compilePhysicsSmokeCell();

    expect(second).toEqual(first);
    expect(Object.keys(first.files)).toEqual([
      "world.usda",
      "10_smoke_collision.usda",
      "20_room01_collision_held.usda",
      "physics-smoke-job.json"
    ]);
    expect(first.files["world.usda"]).toContain("metersPerUnit = 1");
    expect(first.files["world.usda"]).toContain('upAxis = "Y"');
    expect(first.files["world.usda"]).toContain("@10_smoke_collision.usda@");
    expect(first.files["world.usda"]).toContain("@20_room01_collision_held.usda@");
    expect(first.job).toMatchObject({
      schema: PHYSICS_SMOKE_JOB_SCHEMA,
      device_class: "cpu",
      frame_timestep_seconds: 1 / 60,
      substeps: 4,
      frames_per_repetition: 180,
      repetitions: 3,
      seed: 0,
      reset_between_repetitions: true
    });
    expect(JSON.parse(first.files["physics-smoke-job.json"])).toEqual(first.job);
  });

  it("bounds the synthetic fixture while leaving Room-01 collision explicitly empty and held", () => {
    const { files } = compilePhysicsSmokeCell();
    const collision = files["10_smoke_collision.usda"];
    const held = files["20_room01_collision_held.usda"];

    expect(collision.match(/def Cube/g)).toHaveLength(5);
    for (const prim of ["Floor", "NorthWall", "SouthWall", "EastWall", "WestWall", "Probe"]) {
      expect(collision).toContain(`"${prim}"`);
    }
    expect(collision).toContain('def Capsule "Probe"');
    expect(collision).toContain("vector3f physics:velocity = (1.5, 0, 0)");
    expect(collision).not.toMatch(/\b(?:NaN|Infinity)\b/);
    expect(held).toContain('string authority = "held"');
    expect(held).toContain('string[] approvedFor = []');
    expect(held).not.toMatch(/def (?:Cube|Mesh|Capsule)/);
    expect(held).not.toContain("PhysicsCollisionAPI");
  });

  it.skipIf(!existsSync("/usr/bin/usdchecker"))("passes the platform OpenUSD checker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "world-studio-openusd-smoke-"));
    try {
      const { files } = compilePhysicsSmokeCell();
      for (const name of ["world.usda", "10_smoke_collision.usda", "20_room01_collision_held.usda"] as const) {
        await writeFile(join(directory, name), files[name]);
      }
      execFileSync("/usr/bin/usdchecker", ["-t", join(directory, "world.usda")], { stdio: "pipe" });
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
