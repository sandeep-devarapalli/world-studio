import { parseObjMesh } from "@world-studio/artifacts";
import {
  CANONICAL_WORLD_SCHEMA,
  SUPERDEX_SCENE_COMPILER_ID,
  SUPERDEX_SCENE_COMPILER_VERSION,
  SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA,
  SUPERDEX_SCENE_PACKAGE_SCHEMA,
  stableCanonicalJson,
  type CanonicalArtifactBindingV1,
  type CanonicalContentReferenceV1,
  type CanonicalTransformEdgeV1,
  type CanonicalVersionReferenceV1,
  type SuperDexCompiledColliderV1,
  type SuperDexSceneCompileReportV1,
  type SuperDexSceneCompileResultV1,
  type SuperDexScenePackageV1,
} from "@world-studio/world-core";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { CanonicalWorldPackageStore } from "./world-package-store.js";

const defaultMaxColliders = 64;
const defaultMaxMeshBytes = 16 * 1024 * 1024;
const defaultMaxOutputBytes = 128 * 1024 * 1024;
const defaultMaxVertices = 500_000;
const defaultMaxTriangles = 1_000_000;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const acceptedAuthority = new Set(["proposal", "validated", "promoted"]);
const limitations = [
  "Compilation preserves source authority and does not promote collision, physics, navigation, or task authority.",
  "SuperDex Mesh collision is experimental; closed topology, contact suitability, and physical fidelity are not established by compilation.",
  "Native SuperDex loading and contact execution require a separate checksum-bound worker receipt.",
  "Visual splats, linked Assets, materials, robots, sensors, tasks, and unknown-space completion are excluded from the v0.1 derivative.",
] as const;

type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export class SuperDexSceneCompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuperDexSceneCompilerError";
  }
}

export interface SuperDexSceneCompilerBounds {
  maxColliders?: number;
  maxMeshBytes?: number;
  maxOutputBytes?: number;
  maxVertices?: number;
  maxTriangles?: number;
}

export interface SuperDexSceneCompilerInput {
  store: CanonicalWorldPackageStore;
  world: CanonicalVersionReferenceV1;
  outputRoot: string;
  bounds?: SuperDexSceneCompilerBounds;
}

export async function compileCanonicalWorldToSuperDex(
  input: SuperDexSceneCompilerInput,
): Promise<SuperDexSceneCompileResultV1> {
  const bounds = validateInput(input);
  const opened = await input.store.openVersion(input.world);
  if (opened.reference.kind !== "world" || opened.manifest.schema !== CANONICAL_WORLD_SCHEMA) {
    throw fail("SuperDex scene compilation requires a canonical World reference.");
  }
  const world = opened.manifest;
  const rootFrame = world.transform_graph.nodes.find(
    (frame) => frame.frame_id === world.transform_graph.root_frame_id,
  )!;
  if (rootFrame.handedness !== "right" || rootFrame.up_axis !== "+Y" || rootFrame.forward_axis !== "-Z") {
    throw fail("The v0.1 SuperDex compiler requires a right-handed +Y-up, -Z-forward World root.");
  }
  if (!acceptedAuthority.has(world.readiness.collision.status)) {
    throw fail("The canonical World collision lane is not eligible for derivative compilation.");
  }

  const collisionEvidence = new Set(world.readiness.collision.evidence_artifact_ids);
  const selected = world.artifacts
    .filter((artifact) => artifact.role === "collision_mesh" && collisionEvidence.has(artifact.artifact_id))
    .sort((left, right) => compareText(left.artifact_id, right.artifact_id));
  if (selected.length === 0) throw fail("The collision readiness lane does not bind a collision_mesh artifact.");
  if (selected.length > bounds.maxColliders) throw fail("The World exceeds the v0.1 collider-count bound.");

  const sourceManifestSha = sha256(opened.manifestBytes);
  if (sourceManifestSha !== opened.reference.manifest_sha256) {
    throw fail("The opened World manifest differs from its canonical version reference.");
  }
  const target = {
    backend_id: "superdex",
    backend_version: "1.0.0",
    adapter_version: "0.1.0",
    scene_format: "superdex_mochi_scene",
    coordinate_frame: "right_y_up",
    actor_kind: "static_rigid",
    collider_type: "Mesh",
  } as const;
  const packageIdentity = jsonBytes({
    source_world: opened.reference,
    compiler: { id: SUPERDEX_SCENE_COMPILER_ID, version: SUPERDEX_SCENE_COMPILER_VERSION },
    target,
  });
  const packageId = `superdex-${sha256(packageIdentity).slice("sha256:".length)}`;
  const files = new Map<string, Buffer>();
  files.set("source/world-manifest.json", Buffer.from(opened.manifestBytes));
  const colliders: SuperDexCompiledColliderV1[] = [];

  for (const artifact of selected) {
    colliders.push(await compileCollider(input.store, opened.reference, world, artifact, bounds, files));
  }

  const nativeScene = {
    actors: {
      rigid: colliders.map((collider) => ({
        colliderType: "Mesh",
        isStatic: true,
        layer: "Environment",
        name: collider.actor_name,
        rotation: collider.actor_transform.rotation_xyzw,
        scale: [
          collider.actor_transform.uniform_scale,
          collider.actor_transform.uniform_scale,
          collider.actor_transform.uniform_scale,
        ],
        shape: collider.compiled_mesh.path,
        translation: collider.actor_transform.translation_m,
      })),
    },
    scene: {
      description: `World Studio derived static collision scene for ${world.world_id}@${world.version_id}`,
    },
  };
  const sceneBytes = jsonBytes(nativeScene);
  files.set("scene.mochi_scene", sceneBytes);

  const selectedIds = new Set(selected.map((artifact) => artifact.artifact_id));
  const report: SuperDexSceneCompileReportV1 = {
    schema: SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA,
    package_id: packageId,
    source_world: opened.reference as SuperDexSceneCompileReportV1["source_world"],
    selected_collision_artifact_ids: [...selectedIds],
    excluded_artifacts: world.artifacts
      .filter((artifact) => !selectedIds.has(artifact.artifact_id))
      .sort((left, right) => compareText(left.artifact_id, right.artifact_id))
      .map((artifact) => ({
        artifact_id: artifact.artifact_id,
        role: artifact.role,
        reason: artifact.role === "collision_mesh" ? "not_collision_lane_evidence" : "not_collision_mesh",
      })),
    excluded_asset_dependencies: world.assets
      .map((asset) => asset.revision)
      .sort((left, right) => compareText(left.id, right.id) || left.version - right.version),
    checks: {
      canonical_world_store: "passed",
      source_manifest_hash: "passed",
      source_content_hashes: "passed",
      obj_geometry: "passed",
      transform_decomposition: "passed",
      native_superdex_load: "not_run",
    },
    authority_effect: "preserved_without_promotion",
    limitations: [...limitations],
  };
  const reportBytes = jsonBytes(report);
  files.set("conversion_report.json", reportBytes);

  const manifest: SuperDexScenePackageV1 = {
    schema: SUPERDEX_SCENE_PACKAGE_SCHEMA,
    package_id: packageId,
    source_world: opened.reference as SuperDexScenePackageV1["source_world"],
    source_world_manifest: contentReference("source/world-manifest.json", opened.manifestBytes, "application/json"),
    compiler: { id: SUPERDEX_SCENE_COMPILER_ID, version: SUPERDEX_SCENE_COMPILER_VERSION },
    target,
    authority_effect: "preserved_without_promotion",
    source_collision_readiness: world.readiness.collision,
    scene: contentReference("scene.mochi_scene", sceneBytes, "application/json"),
    colliders,
    report: contentReference("conversion_report.json", reportBytes, "application/json"),
    limitations: [...limitations],
  };
  const manifestBytes = jsonBytes(manifest);
  files.set("manifest.json", manifestBytes);
  enforceOutputBound(files, bounds.maxOutputBytes);
  await writePackage(input.outputRoot, files);
  return {
    output_root: path.resolve(input.outputRoot),
    manifest,
    manifest_reference: contentReference("manifest.json", manifestBytes, "application/json"),
  };
}

interface ValidatedBounds {
  maxColliders: number;
  maxMeshBytes: number;
  maxOutputBytes: number;
  maxVertices: number;
  maxTriangles: number;
}

function validateInput(input: SuperDexSceneCompilerInput): ValidatedBounds {
  if (!input || typeof input !== "object") throw fail("SuperDex compiler input is required.");
  if (!(input.store instanceof CanonicalWorldPackageStore)) throw fail("A CanonicalWorldPackageStore is required.");
  if (!input.world || input.world.kind !== "world") throw fail("A canonical World reference is required.");
  if (typeof input.outputRoot !== "string" || !path.isAbsolute(input.outputRoot)) {
    throw fail("The SuperDex output root must be absolute.");
  }
  const resolved = path.resolve(input.outputRoot);
  if (resolved === path.parse(resolved).root) throw fail("The filesystem root cannot be a compiler output.");
  const bounds = {
    maxColliders: boundedPositiveInteger(input.bounds?.maxColliders ?? defaultMaxColliders, "maxColliders", defaultMaxColliders),
    maxMeshBytes: boundedPositiveInteger(input.bounds?.maxMeshBytes ?? defaultMaxMeshBytes, "maxMeshBytes", defaultMaxMeshBytes),
    maxOutputBytes: boundedPositiveInteger(input.bounds?.maxOutputBytes ?? defaultMaxOutputBytes, "maxOutputBytes", defaultMaxOutputBytes),
    maxVertices: boundedPositiveInteger(input.bounds?.maxVertices ?? defaultMaxVertices, "maxVertices", defaultMaxVertices),
    maxTriangles: boundedPositiveInteger(input.bounds?.maxTriangles ?? defaultMaxTriangles, "maxTriangles", defaultMaxTriangles),
  };
  if (bounds.maxMeshBytes > input.store.bounds.maxReadBytes) {
    throw fail("maxMeshBytes cannot exceed the canonical store read bound.");
  }
  return bounds;
}

async function compileCollider(
  store: CanonicalWorldPackageStore,
  worldReference: CanonicalVersionReferenceV1,
  world: Extract<Awaited<ReturnType<CanonicalWorldPackageStore["openVersion"]>>["manifest"], { schema: typeof CANONICAL_WORLD_SCHEMA }>,
  artifact: CanonicalArtifactBindingV1,
  bounds: ValidatedBounds,
  files: Map<string, Buffer>,
): Promise<SuperDexCompiledColliderV1> {
  if (!acceptedAuthority.has(artifact.authority.status)) {
    throw fail(`Collision artifact ${artifact.artifact_id} has held or rejected authority.`);
  }
  if (!artifact.content.path.toLowerCase().endsWith(".obj")) {
    throw fail(`Collision artifact ${artifact.artifact_id} must reference an OBJ mesh in v0.1.`);
  }
  const sourceBytes = await store.readReferencedBytes(worldReference, artifact.content.path, bounds.maxMeshBytes);
  let source: string;
  try {
    source = strictUtf8.decode(sourceBytes);
  } catch {
    throw fail(`Collision artifact ${artifact.artifact_id} is not valid UTF-8 OBJ data.`);
  }
  let parsed: ReturnType<typeof parseObjMesh>;
  try {
    parsed = parseObjMesh(source);
  } catch (error) {
    throw fail(`Collision artifact ${artifact.artifact_id} is not a valid OBJ mesh: ${message(error)}`);
  }
  if (parsed.vertices.length < 3 || parsed.triangles.length < 1) {
    throw fail(`Collision artifact ${artifact.artifact_id} has no triangle surface.`);
  }
  if (parsed.vertices.length > bounds.maxVertices || parsed.triangles.length > bounds.maxTriangles) {
    throw fail(`Collision artifact ${artifact.artifact_id} exceeds the v0.1 geometry bounds.`);
  }
  for (const triangle of parsed.triangles) {
    if (triangle.a === triangle.b || triangle.a === triangle.c || triangle.b === triangle.c) {
      throw fail(`Collision artifact ${artifact.artifact_id} contains a degenerate triangle.`);
    }
  }

  const outputPath = `meshes/${artifact.artifact_id}.obj`;
  const compiledBytes = encodeObj(artifact.artifact_id, parsed);
  files.set(outputPath, compiledBytes);
  const transform = resolveArtifactTransform(world, artifact);
  return {
    actor_name: artifact.artifact_id,
    source_artifact_id: artifact.artifact_id,
    source_world_content: artifact.content,
    compiled_mesh: contentReference(outputPath, compiledBytes, "model/obj"),
    frame_id: artifact.frame_id,
    transform_ids: transform.transformIds,
    world_from_local_row_major: transform.matrix,
    actor_transform: decomposeSimilarity(transform.matrix, artifact.artifact_id),
    vertex_count: parsed.vertices.length,
    triangle_count: parsed.triangles.length,
    authority: artifact.authority,
    uncertainty: artifact.uncertainty,
  };
}

function resolveArtifactTransform(
  world: Extract<Awaited<ReturnType<CanonicalWorldPackageStore["openVersion"]>>["manifest"], { schema: typeof CANONICAL_WORLD_SCHEMA }>,
  artifact: CanonicalArtifactBindingV1,
): { matrix: Matrix4; transformIds: string[] } {
  const root = world.transform_graph.root_frame_id;
  if (artifact.frame_id === root) {
    if (artifact.transform_id !== null) throw fail(`Root-frame artifact ${artifact.artifact_id} cannot name a transform.`);
    return { matrix: identityMatrix(), transformIds: [] };
  }
  const frame = world.transform_graph.nodes.find((node) => node.frame_id === artifact.frame_id)!;
  if (frame.handedness !== "right") {
    throw fail(`Collision artifact ${artifact.artifact_id} uses a left-handed frame unsupported by v0.1.`);
  }
  const incoming = new Map(world.transform_graph.edges.map((edge) => [edge.child_frame, edge]));
  const direct = incoming.get(artifact.frame_id);
  if (!direct || artifact.transform_id !== direct.transform_id) {
    throw fail(`Collision artifact ${artifact.artifact_id} must bind its direct incoming transform.`);
  }
  const edges: CanonicalTransformEdgeV1[] = [];
  let current = artifact.frame_id;
  while (current !== root) {
    const edge = incoming.get(current);
    if (!edge) throw fail(`Collision artifact ${artifact.artifact_id} has no path to the World root.`);
    if (!acceptedAuthority.has(edge.authority.status)) {
      throw fail(`Transform ${edge.transform_id} has held or rejected authority.`);
    }
    edges.unshift(edge);
    current = edge.parent_frame;
  }
  let matrix = identityMatrix();
  for (const edge of edges) matrix = multiplyMatrix(matrix, edge.matrix_row_major);
  return { matrix, transformIds: edges.map((edge) => edge.transform_id) };
}

function decomposeSimilarity(matrix: Matrix4, artifactId: string): SuperDexCompiledColliderV1["actor_transform"] {
  const columns = [
    [matrix[0], matrix[4], matrix[8]],
    [matrix[1], matrix[5], matrix[9]],
    [matrix[2], matrix[6], matrix[10]],
  ] as const;
  const scales = columns.map((column) => Math.hypot(...column));
  const scale = (scales[0] + scales[1] + scales[2]) / 3;
  if (!Number.isFinite(scale) || scale < 1e-6 || scale > 1e6
    || scales.some((entry) => Math.abs(entry - scale) > Math.max(1, scale) * 1e-6)) {
    throw fail(`Collision artifact ${artifactId} transform is not a bounded uniform similarity.`);
  }
  const rotation = [
    matrix[0] / scale, matrix[1] / scale, matrix[2] / scale,
    matrix[4] / scale, matrix[5] / scale, matrix[6] / scale,
    matrix[8] / scale, matrix[9] / scale, matrix[10] / scale,
  ];
  const determinant = rotation[0]! * (rotation[4]! * rotation[8]! - rotation[5]! * rotation[7]!)
    - rotation[1]! * (rotation[3]! * rotation[8]! - rotation[5]! * rotation[6]!)
    + rotation[2]! * (rotation[3]! * rotation[7]! - rotation[4]! * rotation[6]!);
  if (determinant < 1 - 1e-6 || determinant > 1 + 1e-6) {
    throw fail(`Collision artifact ${artifactId} transform contains reflection or shear unsupported by v0.1.`);
  }
  const translation = [matrix[3], matrix[7], matrix[11]] as [number, number, number];
  if (translation.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > 1e6)) {
    throw fail(`Collision artifact ${artifactId} translation exceeds the v0.1 bound.`);
  }
  return { translation_m: translation, rotation_xyzw: rotationQuaternion(rotation), uniform_scale: scale };
}

function rotationQuaternion(matrix: number[]): [number, number, number, number] {
  const trace = matrix[0]! + matrix[4]! + matrix[8]!;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (matrix[7]! - matrix[5]!) / s;
    y = (matrix[2]! - matrix[6]!) / s;
    z = (matrix[3]! - matrix[1]!) / s;
  } else if (matrix[0]! > matrix[4]! && matrix[0]! > matrix[8]!) {
    const s = Math.sqrt(1 + matrix[0]! - matrix[4]! - matrix[8]!) * 2;
    w = (matrix[7]! - matrix[5]!) / s;
    x = 0.25 * s;
    y = (matrix[1]! + matrix[3]!) / s;
    z = (matrix[2]! + matrix[6]!) / s;
  } else if (matrix[4]! > matrix[8]!) {
    const s = Math.sqrt(1 + matrix[4]! - matrix[0]! - matrix[8]!) * 2;
    w = (matrix[2]! - matrix[6]!) / s;
    x = (matrix[1]! + matrix[3]!) / s;
    y = 0.25 * s;
    z = (matrix[5]! + matrix[7]!) / s;
  } else {
    const s = Math.sqrt(1 + matrix[8]! - matrix[0]! - matrix[4]!) * 2;
    w = (matrix[3]! - matrix[1]!) / s;
    x = (matrix[2]! + matrix[6]!) / s;
    y = (matrix[5]! + matrix[7]!) / s;
    z = 0.25 * s;
  }
  const length = Math.hypot(x, y, z, w);
  let result = [x / length, y / length, z / length, w / length] as [number, number, number, number];
  const firstSignificant = result.find((entry) => Math.abs(entry) > 1e-15) ?? 1;
  if (result[3] < 0 || (Math.abs(result[3]) <= 1e-15 && firstSignificant < 0)) {
    result = result.map((entry) => -entry) as [number, number, number, number];
  }
  return result.map((entry) => Object.is(entry, -0) ? 0 : entry) as [number, number, number, number];
}

function encodeObj(artifactId: string, mesh: ReturnType<typeof parseObjMesh>): Buffer {
  const lines = [`# World Studio normalized collision mesh: ${artifactId}`];
  for (const vertex of mesh.vertices) lines.push(`v ${numberText(vertex[0])} ${numberText(vertex[1])} ${numberText(vertex[2])}`);
  for (const triangle of mesh.triangles) lines.push(`f ${triangle.a + 1} ${triangle.b + 1} ${triangle.c + 1}`);
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw fail("OBJ geometry contains a non-finite coordinate.");
  return String(Object.is(value, -0) ? 0 : value);
}

function multiplyMatrix(left: Matrix4, right: Matrix4): Matrix4 {
  const result = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[row * 4 + column]! += left[row * 4 + index]! * right[index * 4 + column]!;
      }
    }
  }
  if (result.some((entry) => !Number.isFinite(entry))) throw fail("World transform composition is non-finite.");
  return result as Matrix4;
}

function identityMatrix(): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function contentReference(relativePath: string, bytes: Uint8Array, mediaType: string): CanonicalContentReferenceV1 {
  return { path: relativePath, sha256: sha256(bytes), size_bytes: bytes.byteLength, media_type: mediaType };
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(value)}\n`, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function enforceOutputBound(files: Map<string, Buffer>, maximum: number): void {
  let size = 0;
  for (const bytes of files.values()) {
    size += bytes.byteLength;
    if (!Number.isSafeInteger(size) || size > maximum) throw fail("The compiled SuperDex package exceeds its output bound.");
  }
}

async function writePackage(outputRootValue: string, files: Map<string, Buffer>): Promise<void> {
  const outputRoot = path.resolve(outputRootValue);
  if (await exists(outputRoot)) throw fail("The SuperDex output root already exists.");
  const parent = path.dirname(outputRoot);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(parent, `.${path.basename(outputRoot)}.incoming-`));
  try {
    for (const [relativePath, bytes] of [...files.entries()].sort(([left], [right]) => compareText(left, right))) {
      const target = path.join(staging, ...relativePath.split("/"));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    }
    if (await exists(outputRoot)) throw fail("The SuperDex output root appeared during compilation.");
    await rename(staging, outputRoot);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function boundedPositiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw fail(`${label} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(messageValue: string): SuperDexSceneCompilerError {
  return new SuperDexSceneCompilerError(messageValue);
}
