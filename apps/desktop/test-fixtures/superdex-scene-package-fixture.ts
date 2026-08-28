import {
  parseCanonicalGraphJson,
  stableCanonicalJson,
  validateCanonicalWorldManifest,
  type CanonicalArtifactBindingV1,
  type CanonicalAuthorityV1,
} from "@world-studio/world-core";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SuperDexSceneJobRegistration } from "../src/superdex-scene-job.js";

const canonicalWorldFixture = fileURLToPath(new URL(
  "../../../contracts/world-graph/v0.1/fixtures/valid_root_world.json",
  import.meta.url,
));

export const superDexFixtureBox = Buffer.from([
  "# closed box",
  "v -0.5 -0.5 -0.5", "v 0.5 -0.5 -0.5", "v 0.5 0.5 -0.5", "v -0.5 0.5 -0.5",
  "v -0.5 -0.5 0.5", "v 0.5 -0.5 0.5", "v 0.5 0.5 0.5", "v -0.5 0.5 0.5",
  "f 1 3 2", "f 1 4 3", "f 5 6 7", "f 5 7 8", "f 1 5 8", "f 1 8 4",
  "f 2 3 7", "f 2 7 6", "f 1 2 6", "f 1 6 5", "f 3 4 8", "f 3 8 7", "",
].join("\n"), "utf8");

const limitations = [
  "Compilation preserves source authority.",
  "Native execution requires a separate receipt.",
];

export async function writeSuperDexScenePackageFixture(packageRoot: string): Promise<{
  packageRoot: string;
  registration: SuperDexSceneJobRegistration;
}> {
  await mkdir(path.join(packageRoot, "source"), { recursive: true });
  await mkdir(path.join(packageRoot, "meshes"), { recursive: true });
  const world = validateCanonicalWorldManifest(parseCanonicalGraphJson(
    await readFile(canonicalWorldFixture, "utf8"),
  ));
  const collisionAuthority: CanonicalAuthorityV1 = {
    domain: "collision",
    status: "proposal",
    approved_for: ["experimental_compilation"],
    not_approved_for: ["physical_prediction", "robot_training"],
    limitations: ["Authority remains task-scoped."],
    evidence_artifact_ids: [],
  };
  const sourceContent = fixtureContent("geometry/table.obj", superDexFixtureBox, "model/obj");
  const collisionArtifact: CanonicalArtifactBindingV1 = {
    artifact_id: "table_collision",
    role: "collision_mesh",
    content: sourceContent,
    frame_id: world.transform_graph.root_frame_id,
    transform_id: null,
    authority: collisionAuthority,
    uncertainty: { status: "unknown", reason: "No validated collision uncertainty bound." },
    provenance: {
      producer: "superdex_scene_job_fixture",
      producer_version: "1.0.0",
      created_at: "2026-08-28T12:00:00.000Z",
      run_id: null,
      input_artifact_ids: [],
      input_versions: [],
    },
  };
  world.artifacts.push(collisionArtifact);
  world.authorities.push({ ...collisionAuthority, evidence_artifact_ids: [collisionArtifact.artifact_id] });
  world.readiness.collision = {
    status: "proposal",
    evidence_artifact_ids: [collisionArtifact.artifact_id],
    report: null,
    limitations: ["No physical prediction authority."],
  };
  const validatedWorld = validateCanonicalWorldManifest(world);
  const sourceWorld = fixtureJsonBytes(validatedWorld);
  const sourceReference = {
    kind: "world",
    id: validatedWorld.world_id,
    version_id: validatedWorld.version_id,
    version: validatedWorld.version,
    manifest_sha256: fixtureSha256(sourceWorld),
  };
  const scene = fixtureJsonBytes({
    actors: { rigid: [{
      colliderType: "Mesh",
      isStatic: true,
      layer: "Environment",
      name: "table_collision",
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      shape: "meshes/table_collision.obj",
      translation: [0, 0, 0],
    }] },
    scene: { description: "World Studio test table" },
  });
  const report = fixtureJsonBytes({
    schema: "world_studio.superdex_scene_compile_report.v0.1",
    package_id: "superdex-package-v1",
    source_world: sourceReference,
    selected_collision_artifact_ids: ["table_collision"],
    excluded_artifacts: [],
    excluded_asset_dependencies: [],
    checks: {
      canonical_world_store: "passed",
      source_manifest_hash: "passed",
      source_content_hashes: "passed",
      obj_geometry: "passed",
      transform_decomposition: "passed",
      native_superdex_load: "not_run",
    },
    authority_effect: "preserved_without_promotion",
    limitations,
  });
  const manifest = {
    schema: "world_studio.superdex_scene_package.v0.1",
    package_id: "superdex-package-v1",
    source_world: sourceReference,
    source_world_manifest: fixtureContent("source/world-manifest.json", sourceWorld, "application/json"),
    compiler: { id: "world-studio-superdex-scene-compiler", version: "0.1.0" },
    target: {
      backend_id: "superdex",
      backend_version: "1.0.0",
      adapter_version: "0.1.0",
      scene_format: "superdex_mochi_scene",
      coordinate_frame: "right_y_up",
      actor_kind: "static_rigid",
      collider_type: "Mesh",
    },
    authority_effect: "preserved_without_promotion",
    source_collision_readiness: validatedWorld.readiness.collision,
    scene: fixtureContent("scene.mochi_scene", scene, "application/json"),
    colliders: [{
      actor_name: "table_collision",
      source_artifact_id: "table_collision",
      source_world_content: collisionArtifact.content,
      compiled_mesh: fixtureContent("meshes/table_collision.obj", superDexFixtureBox, "model/obj"),
      frame_id: collisionArtifact.frame_id,
      transform_ids: [],
      world_from_local_row_major: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      actor_transform: { translation_m: [0, 0, 0], rotation_xyzw: [0, 0, 0, 1], uniform_scale: 1 },
      vertex_count: 8,
      triangle_count: 12,
      authority: collisionArtifact.authority,
      uncertainty: collisionArtifact.uncertainty,
    }],
    report: fixtureContent("conversion_report.json", report, "application/json"),
    limitations,
  };
  const manifestBytes = fixtureJsonBytes(manifest);
  await Promise.all([
    writeFile(path.join(packageRoot, "manifest.json"), manifestBytes),
    writeFile(path.join(packageRoot, "source/world-manifest.json"), sourceWorld),
    writeFile(path.join(packageRoot, "scene.mochi_scene"), scene),
    writeFile(path.join(packageRoot, "conversion_report.json"), report),
    writeFile(path.join(packageRoot, "meshes/table_collision.obj"), superDexFixtureBox),
  ]);
  return {
    packageRoot,
    registration: {
      sceneJobId: "table-contact-v1",
      packageId: "superdex-package-v1",
      packageRoot,
      packageManifestSha256: fixtureSha256(manifestBytes),
      targetActorName: "table_collision",
      probeInitialPositionM: [0, 1, 0],
    },
  };
}

export function fixtureJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(value)}\n`, "utf8");
}

export function fixtureSha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixtureContent(relativePath: string, bytes: Buffer, mediaType: string) {
  return { path: relativePath, sha256: fixtureSha256(bytes), size_bytes: bytes.byteLength, media_type: mediaType };
}
