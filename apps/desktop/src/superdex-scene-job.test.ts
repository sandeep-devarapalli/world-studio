import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  stageSuperDexSceneJob,
} from "./superdex-scene-job.js";
import {
  fixtureJsonBytes,
  fixtureSha256,
  superDexFixtureBox,
  writeSuperDexScenePackageFixture,
} from "../test-fixtures/superdex-scene-package-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SuperDex compiled-scene job staging", () => {
  it("copies only a strict checksum-bound package and emits a canonical private request", async () => {
    const fixture = await scenePackage("valid");
    const attemptRoot = await temporaryRoot("attempt");
    const prepared = await stageSuperDexSceneJob(fixture.registration, attemptRoot);

    expect(prepared.request).toMatchObject({
      scene_job_id: "table-contact-v1",
      package_id: "superdex-package-v1",
      scene_actor_names: ["table_collision"],
      target_actor_name: "table_collision",
      authority: "compiled_scene_execution_only",
    });
    expect(prepared.requestSha256).toBe(fixtureSha256(await readFile(prepared.requestPath)));
    expect(await readFile(path.join(prepared.stagedPackageRoot, "meshes/table_collision.obj"))).toEqual(superDexFixtureBox);
  });

  it("rejects package content changed after registration", async () => {
    const fixture = await scenePackage("tamper");
    await writeFile(path.join(fixture.packageRoot, "meshes/table_collision.obj"), `${superDexFixtureBox.toString("utf8")}# changed\n`);
    await expect(stageSuperDexSceneJob(fixture.registration, await temporaryRoot("tamper-attempt")))
      .rejects.toThrow(/differs from its manifest/);
  });

  it("rejects traversal even when an attacker rehashes the manifest", async () => {
    const fixture = await scenePackage("traversal");
    const manifestPath = path.join(fixture.packageRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.colliders[0].compiled_mesh.path = "../escape.obj";
    const bytes = fixtureJsonBytes(manifest);
    await writeFile(manifestPath, bytes);
    const registration = { ...fixture.registration, packageManifestSha256: fixtureSha256(bytes) };
    await expect(stageSuperDexSceneJob(registration, await temporaryRoot("traversal-attempt")))
      .rejects.toThrow(/normalized relative path/);
  });

  it("rejects source authority metadata changed behind a rehashed package manifest", async () => {
    const fixture = await scenePackage("metadata-forgery");
    const manifestPath = path.join(fixture.packageRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.source_collision_readiness.limitations = ["forged promotion"];
    const bytes = fixtureJsonBytes(manifest);
    await writeFile(manifestPath, bytes);
    const registration = { ...fixture.registration, packageManifestSha256: fixtureSha256(bytes) };
    await expect(stageSuperDexSceneJob(registration, await temporaryRoot("metadata-forgery-attempt")))
      .rejects.toThrow(/readiness differs from the source World/);
  });

  it.each(["symlink", "hardlink"] as const)("rejects a %s package file", async (kind) => {
    const fixture = await scenePackage(kind);
    const meshPath = path.join(fixture.packageRoot, "meshes/table_collision.obj");
    const outside = path.join(await temporaryRoot(`${kind}-outside`), "table.obj");
    await writeFile(outside, superDexFixtureBox);
    await rm(meshPath);
    if (kind === "symlink") await symlink(outside, meshPath);
    else await link(outside, meshPath);
    await expect(stageSuperDexSceneJob(fixture.registration, await temporaryRoot(`${kind}-attempt`)))
      .rejects.toThrow(/symbolic links|single-link regular files/);
  });

  it("bounds package directory traversal", async () => {
    const fixture = await scenePackage("directory-bound");
    await Promise.all(Array.from({ length: 129 }, (_, index) => (
      mkdir(path.join(fixture.packageRoot, `extra-${index}`))
    )));
    await expect(stageSuperDexSceneJob(fixture.registration, await temporaryRoot("directory-bound-attempt")))
      .rejects.toThrow(/directory-count bound/);
  });

  it("removes a partial private stage when its lifecycle guard cancels", async () => {
    const fixture = await scenePackage("guard-cancel");
    const attemptRoot = await temporaryRoot("guard-cancel-attempt");
    await expect(stageSuperDexSceneJob(fixture.registration, attemptRoot, () => {
      if (existsSync(path.join(attemptRoot, "input/package/conversion_report.json"))) {
        throw new Error("cancelled by supervisor");
      }
    })).rejects.toThrow(/cancelled by supervisor/);
    expect(existsSync(path.join(attemptRoot, "input"))).toBe(false);
  });
});

async function scenePackage(label: string): Promise<{
  packageRoot: string;
  registration: Awaited<ReturnType<typeof writeSuperDexScenePackageFixture>>["registration"];
}> {
  const packageRoot = await temporaryRoot(`package-${label}`);
  return writeSuperDexScenePackageFixture(packageRoot);
}

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-superdex-${label}-`));
  roots.push(root);
  return root;
}
