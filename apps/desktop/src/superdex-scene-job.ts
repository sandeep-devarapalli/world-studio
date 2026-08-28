import { parseObjMesh } from "@world-studio/artifacts";
import {
  CANONICAL_WORLD_SCHEMA,
  SUPERDEX_SCENE_COMPILER_ID,
  SUPERDEX_SCENE_COMPILER_VERSION,
  SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA,
  SUPERDEX_SCENE_JOB_LIMITATIONS,
  SUPERDEX_SCENE_JOB_REQUEST_SCHEMA,
  SUPERDEX_SCENE_PACKAGE_SCHEMA,
  parseCanonicalGraphJson,
  stableCanonicalJson,
  validateCanonicalWorldManifest,
  validateSuperDexSceneJobRequest,
  type CanonicalContentReferenceV1,
  type CanonicalVersionReferenceV1,
  type CanonicalWorldManifestV2,
  type SuperDexCompiledColliderV1,
  type SuperDexSceneJobRequestV1,
  type SuperDexScenePackageV1,
} from "@world-studio/world-core";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const maxManifestBytes = 2 * 1024 * 1024;
const maxJsonBytes = 2 * 1024 * 1024;
const maxMeshBytes = 16 * 1024 * 1024;
const maxPackageBytes = 128 * 1024 * 1024;
const maxFiles = 68;
const maxDirectories = 128;
const maxDepth = 4;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface SuperDexSceneJobRegistration {
  sceneJobId: string;
  packageId: string;
  packageRoot: string;
  packageManifestSha256: string;
  targetActorName: string;
  probeInitialPositionM: [number, number, number];
}

export interface PreparedSuperDexSceneJob {
  request: SuperDexSceneJobRequestV1;
  requestSha256: string;
  requestPath: string;
  stagedPackageRoot: string;
  loadedActorNames: string[];
}

interface VerifiedPackage {
  manifest: SuperDexScenePackageV1;
  files: Map<string, Buffer>;
}

export function validateSuperDexSceneJobRegistration(
  value: SuperDexSceneJobRegistration,
): SuperDexSceneJobRegistration {
  if (!value || typeof value !== "object") throw new Error("SuperDex scene job registration is required.");
  if (!identifierPattern.test(value.sceneJobId)) throw new Error("SuperDex scene job ID is invalid.");
  if (!identifierPattern.test(value.packageId)) throw new Error("SuperDex scene package ID is invalid.");
  if (!path.isAbsolute(value.packageRoot) || value.packageRoot.includes("\0")) {
    throw new Error("SuperDex scene package root must be absolute.");
  }
  if (!sha256Pattern.test(value.packageManifestSha256)) {
    throw new Error("SuperDex scene package manifest checksum is invalid.");
  }
  if (!identifierPattern.test(value.targetActorName)) throw new Error("SuperDex scene target actor is invalid.");
  const probe = finiteTriplet(value.probeInitialPositionM, "SuperDex scene probe position");
  return {
    sceneJobId: value.sceneJobId,
    packageId: value.packageId,
    packageRoot: path.resolve(value.packageRoot),
    packageManifestSha256: value.packageManifestSha256,
    targetActorName: value.targetActorName,
    probeInitialPositionM: probe,
  };
}

export async function stageSuperDexSceneJob(
  registrationValue: SuperDexSceneJobRegistration,
  attemptRootValue: string,
  assertContinue: () => void = () => undefined,
): Promise<PreparedSuperDexSceneJob> {
  assertContinue();
  const registration = validateSuperDexSceneJobRegistration(registrationValue);
  if (!path.isAbsolute(attemptRootValue)) throw new Error("SuperDex scene attempt root must be absolute.");
  const attemptRoot = path.resolve(attemptRootValue);
  const verified = await verifyPackage(registration, assertContinue);
  assertContinue();
  const actors = verified.manifest.colliders.map((collider) => collider.actor_name);
  if (!actors.includes(registration.targetActorName)) {
    throw new Error("SuperDex scene target actor is not present in the compiled package.");
  }

  const request = validateSuperDexSceneJobRequest({
    schema: SUPERDEX_SCENE_JOB_REQUEST_SCHEMA,
    scene_job_id: registration.sceneJobId,
    package_id: registration.packageId,
    package_manifest_sha256: registration.packageManifestSha256,
    source_world: verified.manifest.source_world,
    scene_sha256: verified.manifest.scene.sha256,
    scene_actor_names: actors,
    target_actor_name: registration.targetActorName,
    probe_initial_position_m: registration.probeInitialPositionM,
    probe_size_m: [0.05, 0.05, 0.05],
    timestep_seconds: 1 / 60,
    frames_per_repetition: 180,
    repetitions: 3,
    reset_tolerance: 1e-6,
    authority: "compiled_scene_execution_only",
    limitations: [...SUPERDEX_SCENE_JOB_LIMITATIONS],
  });
  const requestBytes = jsonBytes(request);
  const inputRoot = path.join(attemptRoot, "input");
  const stagedPackageRoot = path.join(inputRoot, "package");
  try {
    assertContinue();
    await mkdir(stagedPackageRoot, { recursive: true, mode: 0o700 });
    for (const [relativePath, bytes] of [...verified.files].sort(([left], [right]) => left.localeCompare(right))) {
      assertContinue();
      const destination = path.join(stagedPackageRoot, ...relativePath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      assertContinue();
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    }
    assertContinue();
    const requestPath = path.join(inputRoot, "job.json");
    await writeFile(requestPath, requestBytes, { flag: "wx", mode: 0o600 });
    assertContinue();
    return {
      request,
      requestSha256: sha256(requestBytes),
      requestPath,
      stagedPackageRoot,
      loadedActorNames: [...actors],
    };
  } catch (error) {
    await rm(inputRoot, { recursive: true, force: true });
    throw error;
  }
}

async function verifyPackage(
  registration: SuperDexSceneJobRegistration,
  assertContinue: () => void,
): Promise<VerifiedPackage> {
  assertContinue();
  await assertRealDirectory(registration.packageRoot, "SuperDex scene package root");
  const inventory = await packageInventory(registration.packageRoot, assertContinue);
  assertContinue();
  const manifestBytes = await readRegularFile(
    path.join(registration.packageRoot, "manifest.json"),
    maxManifestBytes,
    "SuperDex scene package manifest",
  );
  assertContinue();
  if (sha256(manifestBytes) !== registration.packageManifestSha256) {
    throw new Error("SuperDex scene package manifest checksum differs from its registration.");
  }
  const manifest = validatePackageManifest(parseJson(manifestBytes, "SuperDex scene package manifest"));
  if (manifest.package_id !== registration.packageId) {
    throw new Error("SuperDex scene package ID differs from its registration.");
  }

  const references = [
    manifest.source_world_manifest,
    manifest.scene,
    manifest.report,
    ...manifest.colliders.map((collider) => collider.compiled_mesh),
  ];
  const expectedFiles = new Set(["manifest.json", ...references.map((reference) => reference.path)]);
  if (expectedFiles.size !== references.length + 1) throw new Error("SuperDex scene package has duplicate content paths.");
  assertExactInventory(inventory, expectedFiles);

  const files = new Map<string, Buffer>([["manifest.json", manifestBytes]]);
  let totalBytes = manifestBytes.byteLength;
  for (const reference of references) {
    assertContinue();
    const maximum = reference.media_type === "model/obj" ? maxMeshBytes : maxJsonBytes;
    if (reference.size_bytes > maximum) throw new Error("SuperDex scene package content exceeds its type bound.");
    const bytes = await readRegularFile(
      path.join(registration.packageRoot, ...reference.path.split("/")),
      maximum,
      `SuperDex scene package content ${reference.path}`,
    );
    assertContinue();
    if (bytes.byteLength !== reference.size_bytes || sha256(bytes) !== reference.sha256) {
      throw new Error(`SuperDex scene package content ${reference.path} differs from its manifest.`);
    }
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxPackageBytes) {
      throw new Error("SuperDex scene package exceeds its total byte bound.");
    }
    files.set(reference.path, bytes);
  }

  const sourceWorld = validateSourceWorld(files.get(manifest.source_world_manifest.path)!, manifest.source_world);
  validateSourceMetadata(manifest, sourceWorld);
  validateCompileReport(files.get(manifest.report.path)!, manifest);
  validateNativeScene(files.get(manifest.scene.path)!, manifest.colliders);
  for (const collider of manifest.colliders) {
    const mesh = parseObjMesh(strictText(files.get(collider.compiled_mesh.path)!, collider.compiled_mesh.path));
    if (mesh.vertices.length !== collider.vertex_count || mesh.triangles.length !== collider.triangle_count) {
      throw new Error(`SuperDex scene collider ${collider.actor_name} geometry count differs from its manifest.`);
    }
  }
  return { manifest, files };
}

function validatePackageManifest(value: unknown): SuperDexScenePackageV1 {
  const manifest = record(value, "SuperDex scene package manifest");
  exactKeys(manifest, [
    "schema", "package_id", "source_world", "source_world_manifest", "compiler", "target",
    "authority_effect", "source_collision_readiness", "scene", "colliders", "report", "limitations",
  ], "SuperDex scene package manifest");
  if (manifest.schema !== SUPERDEX_SCENE_PACKAGE_SCHEMA || manifest.authority_effect !== "preserved_without_promotion") {
    throw new Error("SuperDex scene package schema or authority effect is unsupported.");
  }
  const packageId = identifier(manifest.package_id, "SuperDex scene package ID");
  const sourceWorld = worldReference(manifest.source_world, "SuperDex scene source World");
  const compiler = record(manifest.compiler, "SuperDex scene compiler");
  exactKeys(compiler, ["id", "version"], "SuperDex scene compiler");
  if (compiler.id !== SUPERDEX_SCENE_COMPILER_ID || compiler.version !== SUPERDEX_SCENE_COMPILER_VERSION) {
    throw new Error("SuperDex scene compiler identity is unsupported.");
  }
  const target = record(manifest.target, "SuperDex scene target");
  exactKeys(target, [
    "backend_id", "backend_version", "adapter_version", "scene_format", "coordinate_frame",
    "actor_kind", "collider_type",
  ], "SuperDex scene target");
  const expectedTarget = {
    backend_id: "superdex", backend_version: "1.0.0", adapter_version: "0.1.0",
    scene_format: "superdex_mochi_scene", coordinate_frame: "right_y_up",
    actor_kind: "static_rigid", collider_type: "Mesh",
  };
  if (Object.entries(expectedTarget).some(([key, expected]) => target[key] !== expected)) {
    throw new Error("SuperDex scene target contract is unsupported.");
  }
  if (!Array.isArray(manifest.colliders) || manifest.colliders.length < 1 || manifest.colliders.length > 64) {
    throw new Error("SuperDex scene package collider count is invalid.");
  }
  const colliders = manifest.colliders.map((collider, index) => validateCollider(collider, index));
  if (new Set(colliders.map((collider) => collider.actor_name)).size !== colliders.length) {
    throw new Error("SuperDex scene package actor names must be unique.");
  }
  const sourceManifest = contentReference(manifest.source_world_manifest, "SuperDex source World manifest", "application/json");
  if (sourceManifest.sha256 !== sourceWorld.manifest_sha256) {
    throw new Error("SuperDex source World reference and manifest checksum differ.");
  }
  record(manifest.source_collision_readiness, "SuperDex collision readiness");
  const limitations = stringArray(manifest.limitations, "SuperDex scene limitations");
  return {
    schema: SUPERDEX_SCENE_PACKAGE_SCHEMA,
    package_id: packageId,
    source_world: sourceWorld,
    source_world_manifest: sourceManifest,
    compiler: { id: SUPERDEX_SCENE_COMPILER_ID, version: SUPERDEX_SCENE_COMPILER_VERSION },
    target: expectedTarget as SuperDexScenePackageV1["target"],
    authority_effect: "preserved_without_promotion",
    source_collision_readiness: manifest.source_collision_readiness as SuperDexScenePackageV1["source_collision_readiness"],
    scene: contentReference(manifest.scene, "SuperDex native scene", "application/json"),
    colliders,
    report: contentReference(manifest.report, "SuperDex compile report", "application/json"),
    limitations,
  };
}

function validateCollider(value: unknown, index: number): SuperDexCompiledColliderV1 {
  const label = `SuperDex collider ${index}`;
  const collider = record(value, label);
  exactKeys(collider, [
    "actor_name", "source_artifact_id", "source_world_content", "compiled_mesh", "frame_id",
    "transform_ids", "world_from_local_row_major", "actor_transform", "vertex_count",
    "triangle_count", "authority", "uncertainty",
  ], label);
  const matrix = finiteArray(collider.world_from_local_row_major, 16, `${label} transform`);
  const transform = record(collider.actor_transform, `${label} actor transform`);
  exactKeys(transform, ["translation_m", "rotation_xyzw", "uniform_scale"], `${label} actor transform`);
  const rotation = finiteArray(transform.rotation_xyzw, 4, `${label} rotation`);
  const scale = finiteNumber(transform.uniform_scale, `${label} scale`, Number.MIN_VALUE, 1_000);
  const transformIds = stringArray(collider.transform_ids, `${label} transform IDs`, true).map((entry) => identifier(entry, `${label} transform ID`));
  record(collider.authority, `${label} authority`);
  record(collider.uncertainty, `${label} uncertainty`);
  return {
    actor_name: identifier(collider.actor_name, `${label} actor name`),
    source_artifact_id: identifier(collider.source_artifact_id, `${label} source artifact ID`),
    source_world_content: contentReference(collider.source_world_content, `${label} source content`),
    compiled_mesh: contentReference(collider.compiled_mesh, `${label} compiled mesh`, "model/obj"),
    frame_id: identifier(collider.frame_id, `${label} frame ID`),
    transform_ids: transformIds,
    world_from_local_row_major: matrix as SuperDexCompiledColliderV1["world_from_local_row_major"],
    actor_transform: {
      translation_m: finiteTriplet(transform.translation_m, `${label} translation`),
      rotation_xyzw: rotation as [number, number, number, number],
      uniform_scale: scale,
    },
    vertex_count: positiveInteger(collider.vertex_count, `${label} vertex count`, 500_000),
    triangle_count: positiveInteger(collider.triangle_count, `${label} triangle count`, 1_000_000),
    authority: collider.authority as SuperDexCompiledColliderV1["authority"],
    uncertainty: collider.uncertainty as SuperDexCompiledColliderV1["uncertainty"],
  };
}

function validateSourceWorld(bytes: Buffer, expected: CanonicalVersionReferenceV1): CanonicalWorldManifestV2 {
  const world = validateCanonicalWorldManifest(parseJson(bytes, "SuperDex source World manifest"));
  if (world.schema !== CANONICAL_WORLD_SCHEMA
    || world.world_id !== expected.id
    || world.version_id !== expected.version_id
    || world.version !== expected.version) {
    throw new Error("SuperDex source World identity differs from the package manifest.");
  }
  return world;
}

function validateSourceMetadata(manifest: SuperDexScenePackageV1, world: CanonicalWorldManifestV2): void {
  if (stableCanonicalJson(manifest.source_collision_readiness) !== stableCanonicalJson(world.readiness.collision)) {
    throw new Error("SuperDex collision readiness differs from the source World.");
  }
  const artifacts = new Map(world.artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  const collisionEvidence = new Set(world.readiness.collision.evidence_artifact_ids);
  for (const collider of manifest.colliders) {
    const artifact = artifacts.get(collider.source_artifact_id);
    if (!artifact || artifact.role !== "collision_mesh" || !collisionEvidence.has(artifact.artifact_id)
      || artifact.frame_id !== collider.frame_id
      || stableCanonicalJson(artifact.content) !== stableCanonicalJson(collider.source_world_content)
      || stableCanonicalJson(artifact.authority) !== stableCanonicalJson(collider.authority)
      || stableCanonicalJson(artifact.uncertainty) !== stableCanonicalJson(collider.uncertainty)) {
      throw new Error(`SuperDex collider ${collider.actor_name} differs from its source World metadata.`);
    }
  }
}

function validateCompileReport(bytes: Buffer, manifest: SuperDexScenePackageV1): void {
  const report = record(parseJson(bytes, "SuperDex compile report"), "SuperDex compile report");
  exactKeys(report, [
    "schema", "package_id", "source_world", "selected_collision_artifact_ids",
    "excluded_artifacts", "excluded_asset_dependencies", "checks", "authority_effect", "limitations",
  ], "SuperDex compile report");
  if (report.schema !== SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA
    || report.package_id !== manifest.package_id
    || report.authority_effect !== "preserved_without_promotion"
    || stableCanonicalJson(report.source_world) !== stableCanonicalJson(manifest.source_world)) {
    throw new Error("SuperDex compile report identity differs from the package manifest.");
  }
  const selected = stringArray(report.selected_collision_artifact_ids, "SuperDex selected collider IDs");
  const expected = manifest.colliders.map((collider) => collider.source_artifact_id);
  if (selected.length !== expected.length || selected.some((entry, index) => entry !== expected[index])) {
    throw new Error("SuperDex compile report collider inventory differs from the package manifest.");
  }
  if (!Array.isArray(report.excluded_artifacts) || !Array.isArray(report.excluded_asset_dependencies)) {
    throw new Error("SuperDex compile report exclusions are invalid.");
  }
  const checks = record(report.checks, "SuperDex compile checks");
  exactKeys(checks, [
    "canonical_world_store", "source_manifest_hash", "source_content_hashes", "obj_geometry",
    "transform_decomposition", "native_superdex_load",
  ], "SuperDex compile checks");
  if (Object.entries(checks).some(([key, value]) => value !== (key === "native_superdex_load" ? "not_run" : "passed"))) {
    throw new Error("SuperDex compile checks are not in the required pre-execution state.");
  }
  if (stableCanonicalJson(report.limitations) !== stableCanonicalJson(manifest.limitations)) {
    throw new Error("SuperDex compile report limitations differ from the package manifest.");
  }
}

function validateNativeScene(bytes: Buffer, colliders: SuperDexCompiledColliderV1[]): void {
  const scene = record(parseJson(bytes, "SuperDex native scene"), "SuperDex native scene");
  exactKeys(scene, ["actors", "scene"], "SuperDex native scene");
  const actors = record(scene.actors, "SuperDex native scene actors");
  exactKeys(actors, ["rigid"], "SuperDex native scene actors");
  if (!Array.isArray(actors.rigid) || actors.rigid.length !== colliders.length) {
    throw new Error("SuperDex native scene actor count differs from the package manifest.");
  }
  actors.rigid.forEach((value, index) => {
    const actor = record(value, `SuperDex native actor ${index}`);
    exactKeys(actor, ["colliderType", "isStatic", "layer", "name", "rotation", "scale", "shape", "translation"], `SuperDex native actor ${index}`);
    const collider = colliders[index]!;
    const expected = {
      colliderType: "Mesh",
      isStatic: true,
      layer: "Environment",
      name: collider.actor_name,
      rotation: collider.actor_transform.rotation_xyzw,
      scale: [collider.actor_transform.uniform_scale, collider.actor_transform.uniform_scale, collider.actor_transform.uniform_scale],
      shape: collider.compiled_mesh.path,
      translation: collider.actor_transform.translation_m,
    };
    if (stableCanonicalJson(actor) !== stableCanonicalJson(expected)) {
      throw new Error(`SuperDex native actor ${collider.actor_name} differs from the package manifest.`);
    }
  });
  const metadata = record(scene.scene, "SuperDex native scene metadata");
  exactKeys(metadata, ["description"], "SuperDex native scene metadata");
  if (typeof metadata.description !== "string" || !metadata.description || metadata.description.length > 512) {
    throw new Error("SuperDex native scene description is invalid.");
  }
}

async function packageInventory(
  root: string,
  assertContinue: () => void,
): Promise<{ files: Set<string>; directories: Set<string> }> {
  const files = new Set<string>();
  const directories = new Set<string>();
  const visit = async (relative: string, depth: number): Promise<void> => {
    assertContinue();
    if (depth > maxDepth) throw new Error("SuperDex scene package exceeds its directory-depth bound.");
    const directory = relative ? path.join(root, ...relative.split("/")) : root;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      assertContinue();
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      safeRelativePath(childRelative, "SuperDex scene package inventory path");
      const child = path.join(root, ...childRelative.split("/"));
      const info = await lstat(child);
      if (info.isSymbolicLink()) throw new Error("SuperDex scene package must not contain symbolic links.");
      if (info.isDirectory()) {
        directories.add(childRelative);
        if (directories.size > maxDirectories) {
          throw new Error("SuperDex scene package exceeds its directory-count bound.");
        }
        await visit(childRelative, depth + 1);
      } else if (info.isFile() && info.nlink === 1) {
        files.add(childRelative);
        if (files.size > maxFiles) throw new Error("SuperDex scene package exceeds its file-count bound.");
      } else {
        throw new Error("SuperDex scene package must contain only single-link regular files and directories.");
      }
    }
  };
  await visit("", 0);
  return { files, directories };
}

function assertExactInventory(
  inventory: { files: Set<string>; directories: Set<string> },
  expectedFiles: Set<string>,
): void {
  const expectedDirectories = new Set<string>();
  for (const file of expectedFiles) {
    safeRelativePath(file, "SuperDex scene content path");
    let parent = path.posix.dirname(file);
    while (parent !== ".") {
      expectedDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  if (!sameSet(inventory.files, expectedFiles) || !sameSet(inventory.directories, expectedDirectories)) {
    throw new Error("SuperDex scene package contains missing or undeclared entries.");
  }
}

async function assertRealDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

async function readRegularFile(filePath: string, maximum: number, label: string): Promise<Buffer> {
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maximum) {
      throw new Error(`${label} must be a bounded, single-link regular file.`);
    }
    const bytes = await file.readFile();
    const after = await file.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.byteLength !== before.size) {
      throw new Error(`${label} changed while it was being read.`);
    }
    return bytes;
  } finally {
    await file.close();
  }
}

function contentReference(value: unknown, label: string, mediaType?: string): CanonicalContentReferenceV1 {
  const reference = record(value, label);
  exactKeys(reference, ["path", "sha256", "size_bytes", "media_type"], label);
  const relativePath = safeRelativePath(reference.path, `${label} path`);
  const referenceMediaType = typeof reference.media_type === "string" ? reference.media_type : "";
  if (!referenceMediaType || (mediaType && referenceMediaType !== mediaType)) throw new Error(`${label} media type is invalid.`);
  return {
    path: relativePath,
    sha256: checksum(reference.sha256, `${label} checksum`),
    size_bytes: positiveInteger(reference.size_bytes, `${label} size`, maxPackageBytes),
    media_type: referenceMediaType,
  };
}

function worldReference(value: unknown, label: string): CanonicalVersionReferenceV1 & { kind: "world" } {
  const reference = record(value, label);
  exactKeys(reference, ["kind", "id", "version_id", "version", "manifest_sha256"], label);
  if (reference.kind !== "world") throw new Error(`${label} must identify a World.`);
  return {
    kind: "world",
    id: identifier(reference.id, `${label} ID`),
    version_id: identifier(reference.version_id, `${label} version ID`),
    version: positiveInteger(reference.version, `${label} version`, Number.MAX_SAFE_INTEGER),
    manifest_sha256: checksum(reference.manifest_sha256, `${label} checksum`),
  };
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return parseCanonicalGraphJson(strictText(bytes, label));
  } catch {
    throw new Error(`${label} must be complete strict JSON.`);
  }
}

function strictText(bytes: Buffer, label: string): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8.`);
  }
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(value)}\n`, "utf8");
}

function safeRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 1_024 || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} is invalid.`);
  }
  const segments = value.split("/");
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value
    || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a normalized relative path.`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function checksum(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function finiteTriplet(value: unknown, label: string): [number, number, number] {
  return finiteArray(value, 3, label).map((entry) => finiteNumber(entry, label, -10_000, 10_000)) as [number, number, number];
}

function finiteArray(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} must have ${length} values.`);
  return value.map((entry) => finiteNumber(entry, label, -10_000, 10_000));
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be finite and bounded.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error(`${label} is invalid.`);
  return Number(value);
}

function stringArray(value: unknown, label: string, empty = false): string[] {
  if (!Array.isArray(value) || (!empty && value.length === 0) || value.length > 128) throw new Error(`${label} is invalid.`);
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry || entry.length > 512) throw new Error(`${label} is invalid.`);
    return entry;
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((entry, index) => entry !== sorted[index])) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
