import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_WORLD_SCHEMA,
  SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA,
  SUPERDEX_SCENE_PACKAGE_SCHEMA,
  stableCanonicalJson,
  validateCanonicalWorldManifest,
  type CanonicalArtifactBindingV1,
  type CanonicalAuthorityDomain,
  type CanonicalAuthorityStatus,
  type CanonicalAuthorityV1,
  type CanonicalContentReferenceV1,
  type CanonicalProvenanceV1,
  type CanonicalReadinessStatus,
  type CanonicalReadinessV1,
  type CanonicalVersionReferenceV1,
  type CanonicalWorldManifestV2,
  type SuperDexSceneCompileReportV1,
} from "@world-studio/world-core";

import {
  compileCanonicalWorldToSuperDex,
  type SuperDexSceneCompilerError,
} from "./superdex-scene-compiler.js";
import { CanonicalWorldPackageStore } from "./world-package-store.js";
import { SimulationWorkerSupervisor } from "./simulation-worker-supervisor.js";

const temporaryRoots: string[] = [];
const superDexWorker = fileURLToPath(new URL("../../../workers/superdex/superdex_worker.py", import.meta.url));
const createdAt = "2026-08-28T12:00:00.000Z";
const units = { length: "m", mass: "kg", time: "s", angle: "rad", force: "N", torque: "N*m" } as const;
const unknown = { status: "unknown", reason: "No validated uncertainty bound." } as const;
const tetrahedron = Buffer.from([
  "# source comments and groups are intentionally normalized",
  "o tabletop",
  "v 0 0 0",
  "v 1 0 0",
  "v 0 1 0",
  "v 0 0 1",
  "f 1 3 2",
  "f 1 2 4",
  "f 2 3 4",
  "f 3 1 4",
  "",
].join("\n"), "utf8");

interface WorldFixture {
  manifest: CanonicalWorldManifestV2;
  manifestBytes: Buffer;
  reference: CanonicalVersionReferenceV1 & { kind: "world" };
  files: Map<string, Buffer>;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical World to SuperDex scene compilation", () => {
  it("emits a deterministic checksum-bound native scene without promoting authority", async () => {
    const fixture = makeWorld();
    const store = await publish(fixture);
    const firstRoot = await temporaryPath("compiled-a");
    const secondRoot = await temporaryPath("compiled-b");

    const first = await compileCanonicalWorldToSuperDex({ store, world: fixture.reference, outputRoot: firstRoot });
    const second = await compileCanonicalWorldToSuperDex({ store, world: fixture.reference, outputRoot: secondRoot });

    expect(first.manifest.schema).toBe(SUPERDEX_SCENE_PACKAGE_SCHEMA);
    expect(first.manifest.authority_effect).toBe("preserved_without_promotion");
    expect(first.manifest.source_world).toEqual(fixture.reference);
    expect(first.manifest.colliders).toHaveLength(1);
    expect(first.manifest.colliders[0]).toMatchObject({
      actor_name: "tabletop_collision",
      source_artifact_id: "tabletop_collision",
      frame_id: "table_frame",
      transform_ids: ["world_from_table"],
      vertex_count: 4,
      triangle_count: 4,
      actor_transform: {
        translation_m: [1, 2, 3],
        uniform_scale: 2,
      },
      authority: { status: "proposal" },
    });
    const rotation = first.manifest.colliders[0]!.actor_transform.rotation_xyzw;
    expect(rotation[0]).toBe(0);
    expect(rotation[1]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(rotation[2]).toBe(0);
    expect(rotation[3]).toBeCloseTo(Math.SQRT1_2, 15);

    const nativeScene = JSON.parse(await readFile(join(firstRoot, "scene.mochi_scene"), "utf8")) as {
      actors: { rigid: Array<Record<string, unknown>> };
    };
    expect(nativeScene.actors.rigid).toEqual([expect.objectContaining({
      colliderType: "Mesh",
      isStatic: true,
      layer: "Environment",
      name: "tabletop_collision",
      shape: "meshes/tabletop_collision.obj",
      translation: [1, 2, 3],
      scale: [2, 2, 2],
    })]);
    const normalizedMesh = await readFile(join(firstRoot, "meshes/tabletop_collision.obj"), "utf8");
    expect(normalizedMesh).not.toContain("o tabletop");
    expect(normalizedMesh.match(/^v /gm)).toHaveLength(4);
    expect(normalizedMesh.match(/^f /gm)).toHaveLength(4);

    const report = JSON.parse(
      await readFile(join(firstRoot, "conversion_report.json"), "utf8"),
    ) as SuperDexSceneCompileReportV1;
    expect(report.schema).toBe(SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA);
    expect(report.checks.native_superdex_load).toBe("not_run");
    expect(report.excluded_artifacts).toContainEqual({
      artifact_id: "room_appearance",
      role: "visual_splat",
      reason: "not_collision_mesh",
    });

    for (const relativePath of [
      "manifest.json",
      "conversion_report.json",
      "scene.mochi_scene",
      "source/world-manifest.json",
      "meshes/tabletop_collision.obj",
    ]) {
      expect(await readFile(join(firstRoot, relativePath))).toEqual(await readFile(join(secondRoot, relativePath)));
    }
    expect(first.manifest_reference).toEqual(second.manifest_reference);
    expect(first.manifest_reference.sha256).toBe(sha256(await readFile(join(firstRoot, "manifest.json"))));
    expect(first.manifest.source_world_manifest.sha256).toBe(fixture.reference.manifest_sha256);
    await expectReferences(firstRoot, first.manifest.scene, first.manifest.report);
    await expectReferences(firstRoot, ...first.manifest.colliders.map((collider) => collider.compiled_mesh));
  });

  it("fails closed when the collision lane is held", async () => {
    const fixture = makeWorld({ collisionStatus: "held", readinessStatus: "held" });
    const store = await publish(fixture);
    await expect(compileCanonicalWorldToSuperDex({
      store,
      world: fixture.reference,
      outputRoot: await temporaryPath("held-output"),
    })).rejects.toMatchObject<Partial<SuperDexSceneCompilerError>>({
      name: "SuperDexSceneCompilerError",
      message: "The canonical World collision lane is not eligible for derivative compilation.",
    });
  });

  it("does not substitute visual geometry when no collision mesh is ready", async () => {
    const fixture = makeWorld({ includeCollision: false, readinessStatus: "unavailable" });
    const store = await publish(fixture);
    await expect(compileCanonicalWorldToSuperDex({
      store,
      world: fixture.reference,
      outputRoot: await temporaryPath("visual-only-output"),
    })).rejects.toThrow("collision lane is not eligible");
  });

  it("never overwrites an existing output", async () => {
    const fixture = makeWorld();
    const store = await publish(fixture);
    const outputRoot = await temporaryRoot("existing-output");
    await expect(compileCanonicalWorldToSuperDex({ store, world: fixture.reference, outputRoot }))
      .rejects.toThrow("output root already exists");
  });
});

const nativePython = process.env.WORLD_STUDIO_SUPERDEX_PYTHON;
(nativePython ? it : it.skip)("loads the emitted scene and proves supervised native contact/reset", async () => {
  const fixture = makeWorld();
  const store = await publish(fixture);
  const outputRoot = await temporaryPath("native-output");
  const compiled = await compileCanonicalWorldToSuperDex({ store, world: fixture.reference, outputRoot });
  const supervisor = new SimulationWorkerSupervisor({
    root: await temporaryPath("native-worker-runs"),
    registrations: [{
      workerId: "superdex-native",
      backendId: "superdex",
      label: "SuperDex 1.0.0 native integration",
      executable: nativePython!,
      scriptPath: superDexWorker,
      budget: { maxWallTimeMs: 60_000, maxReportBytes: 2 * 1024 * 1024, maxLogBytes: 64 * 1024 },
    }],
    sceneJobs: [{
      sceneJobId: "compiled-tabletop-contact-v1",
      packageId: compiled.manifest.package_id,
      packageRoot: outputRoot,
      packageManifestSha256: compiled.manifest_reference.sha256,
      targetActorName: "tabletop_collision",
      probeInitialPositionM: [1.4, 3.6, 2.6],
    }],
  });
  await supervisor.startSceneJob({ workerId: "superdex-native", sceneJobId: "compiled-tabletop-contact-v1" });
  const completed = await waitForSimulationState(supervisor, "completed", 65_000);
  expect(completed.run).toMatchObject({
    evidence: {
      jobKind: "scene_contact_reset",
      fixtureId: "compiled-scene-contact-reset-v1",
      packageId: compiled.manifest.package_id,
      repetitions: 3,
      maxResetResidual: 0,
    },
  });
});

function makeWorld(options: {
  includeCollision?: boolean;
  collisionStatus?: CanonicalAuthorityStatus;
  readinessStatus?: CanonicalReadinessStatus;
} = {}): WorldFixture {
  const includeCollision = options.includeCollision ?? true;
  const collisionStatus = options.collisionStatus ?? "proposal";
  const readinessStatus = options.readinessStatus ?? (includeCollision ? collisionStatus : "unavailable");
  const captureBytes = Buffer.from("{\"schema\":\"test.capture.v0.1\"}\n");
  const visualBytes = Buffer.from("visual splat bytes");
  const capture = artifact(
    "capture_manifest",
    "source_manifest",
    content("evidence/capture.json", captureBytes, "application/json"),
    authority("capture", "proposal"),
    "world_frame",
    null,
  );
  const visual = artifact(
    "room_appearance",
    "visual_splat",
    content("appearance/room.spz", visualBytes),
    authority("visual", "proposal"),
    "world_frame",
    null,
  );
  const collision = artifact(
    "tabletop_collision",
    "collision_mesh",
    content("geometry/tabletop.obj", tetrahedron, "model/obj"),
    authority("collision", collisionStatus),
    "table_frame",
    "world_from_table",
  );
  const artifacts = includeCollision ? [capture, visual, collision] : [capture, visual];
  const collisionEvidence = includeCollision && readinessStatus !== "unavailable" ? [collision.artifact_id] : [];
  const manifest: CanonicalWorldManifestV2 = {
    schema: CANONICAL_WORLD_SCHEMA,
    world_id: "observed_room",
    version_id: "observed_room_v1",
    version: 1,
    parent: null,
    created_at: createdAt,
    units,
    transform_graph: {
      root_frame_id: "world_frame",
      nodes: [
        { frame_id: "world_frame", handedness: "right", up_axis: "+Y", forward_axis: "-Z" },
        { frame_id: "table_frame", handedness: "right", up_axis: "+Y", forward_axis: "-Z" },
      ],
      edges: [{
        transform_id: "world_from_table",
        parent_frame: "world_frame",
        child_frame: "table_frame",
        kind: "similarity",
        convention: "parent_from_child_column_vector",
        matrix_row_major: [0, 0, 2, 1, 0, 2, 0, 2, -2, 0, 0, 3, 0, 0, 0, 1],
        source_class: "registration",
        authority: authority("calibration", collisionStatus),
        uncertainty: unknown,
        provenance: provenance(),
      }],
    },
    capture_evidence: [{
      session_id: "capture_session",
      manifest: capture.content,
      verification: "rehashed_bytes",
      authority: authority("capture", "proposal", [capture.artifact_id]),
      uncertainty: unknown,
    }],
    artifacts,
    assets: [],
    applied_delta: null,
    authorities: [
      authority("capture", "proposal", [capture.artifact_id]),
      authority("visual", "proposal", [visual.artifact_id]),
      ...(includeCollision ? [authority("collision", collisionStatus, [collision.artifact_id])] : []),
    ],
    readiness: readiness(visual.artifact_id, readinessStatus, collisionEvidence),
    provenance: provenance(),
  };
  validateCanonicalWorldManifest(manifest);
  const manifestBytes = jsonBytes(manifest);
  const reference = {
    kind: "world" as const,
    id: manifest.world_id,
    version_id: manifest.version_id,
    version: manifest.version,
    manifest_sha256: sha256(manifestBytes),
  };
  const files = new Map<string, Buffer>([
    [capture.content.path, captureBytes],
    [visual.content.path, visualBytes],
  ]);
  if (includeCollision) files.set(collision.content.path, tetrahedron);
  return { manifest, manifestBytes, reference, files };
}

function artifact(
  artifactId: string,
  role: CanonicalArtifactBindingV1["role"],
  reference: CanonicalContentReferenceV1,
  artifactAuthority: CanonicalAuthorityV1,
  frameId: string,
  transformId: string | null,
): CanonicalArtifactBindingV1 {
  return {
    artifact_id: artifactId,
    role,
    content: reference,
    frame_id: frameId,
    transform_id: transformId,
    authority: artifactAuthority,
    uncertainty: unknown,
    provenance: provenance(),
  };
}

function authority(
  domain: CanonicalAuthorityDomain,
  status: CanonicalAuthorityStatus,
  evidenceArtifactIds: string[] = [],
): CanonicalAuthorityV1 {
  return {
    domain,
    status,
    approved_for: status === "proposal" ? ["experimental_compilation"] : [],
    not_approved_for: ["physical_prediction", "robot_training"],
    limitations: ["Authority remains task-scoped."],
    evidence_artifact_ids: evidenceArtifactIds,
  };
}

function provenance(): CanonicalProvenanceV1 {
  return {
    producer: "superdex_scene_compiler_test",
    producer_version: "1.0.0",
    created_at: createdAt,
    run_id: null,
    input_artifact_ids: [],
    input_versions: [],
  };
}

function readiness(
  visualArtifactId: string,
  collisionStatus: CanonicalReadinessStatus,
  collisionEvidence: string[],
): CanonicalReadinessV1 {
  const unavailable = () => ({
    status: "unavailable" as const,
    evidence_artifact_ids: [],
    report: null,
    limitations: ["No validated layer is available."],
  });
  return {
    visual: {
      status: "proposal",
      evidence_artifact_ids: [visualArtifactId],
      report: null,
      limitations: ["Appearance only."],
    },
    metric: unavailable(),
    collision: {
      status: collisionStatus,
      evidence_artifact_ids: collisionEvidence,
      report: null,
      limitations: ["No physical prediction authority."],
    },
    navigation: unavailable(),
    semantic: unavailable(),
    articulation: unavailable(),
    physics: unavailable(),
  };
}

function content(relativePath: string, bytes: Uint8Array, mediaType = "application/octet-stream"): CanonicalContentReferenceV1 {
  return { path: relativePath, sha256: sha256(bytes), size_bytes: bytes.byteLength, media_type: mediaType };
}

async function publish(fixture: WorldFixture): Promise<CanonicalWorldPackageStore> {
  const source = await temporaryRoot("source");
  await writeRelative(source, "manifest.json", fixture.manifestBytes);
  for (const [relativePath, bytes] of fixture.files) await writeRelative(source, relativePath, bytes);
  const storeRoot = await temporaryRoot("store");
  const store = new CanonicalWorldPackageStore(storeRoot);
  await store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" });
  return store;
}

async function expectReferences(root: string, ...references: CanonicalContentReferenceV1[]): Promise<void> {
  for (const reference of references) {
    const bytes = await readFile(join(root, reference.path));
    expect(bytes.byteLength).toBe(reference.size_bytes);
    expect(sha256(bytes)).toBe(reference.sha256);
  }
}

async function writeRelative(root: string, relativePath: string, bytes: Uint8Array): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `world-studio-${name}-`));
  temporaryRoots.push(root);
  return root;
}

async function temporaryPath(name: string): Promise<string> {
  const parent = await temporaryRoot(`${name}-parent`);
  return join(parent, name);
}

async function waitForSimulationState(
  supervisor: SimulationWorkerSupervisor,
  expected: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<SimulationWorkerSupervisor["getStatus"]>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await supervisor.getStatus();
    if (snapshot.state === expected) return snapshot;
    if (["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(snapshot.state)) {
      throw new Error(`Expected ${expected}, reached ${snapshot.state}: ${snapshot.run?.failure?.message ?? "no failure"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expected}.`);
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(value)}\n`, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
