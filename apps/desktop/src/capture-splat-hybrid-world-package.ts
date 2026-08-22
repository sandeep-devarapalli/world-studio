import {
  CANONICAL_WORLD_SCHEMA,
  parseCanonicalGraphJson,
  stableCanonicalJson,
  validateCanonicalTimestamp,
  validateCanonicalWorldManifest,
  type CanonicalArtifactBindingV1,
  type CanonicalAuthorityDomain,
  type CanonicalAuthorityV1,
  type CanonicalContentReferenceV1,
  type CanonicalProvenanceV1,
  type CanonicalReadinessLaneV1,
  type CanonicalWorldManifestV2,
} from "@world-studio/world-core";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { verifyCaptureSplatConsumerPackage } from "./capture-splat-consumer-receipt.js";
import {
  CanonicalWorldPackageStore,
  type CanonicalWorldPackagePublishResult,
} from "./world-package-store.js";

const handoffName = "capture-splat.world-studio.json";
const tsdfReportName = "capture_splat_rgbd_tsdf_report.json";
const tsdfMeshName = "rgbd_tsdf_mesh.ply";
const hybridReportName = "capture_splat_hybrid_surface_report.json";
const hybridMeshName = "hybrid_structural_surface.ply";
const colliderReportName = "capture_splat_hybrid_collider_candidate_report.json";
const colliderMeshName = "collider_candidate.ply";
const maxJsonBytes = 64 * 1024 ** 2;
const maxMeshBytes = 2 * 1024 ** 3;
const copyBufferBytes = 1024 * 1024;
const maxSurfaceVertices = 2_000_000;
const maxSurfaceTriangles = 5_000_000;
const maxGaussianVertices = 10_000_000;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const authorityKeys = [
  "metric_authority", "semantic_authority", "collision_authority", "navigation_authority",
  "measurement_authority", "physics_authority", "newton_authority", "quality_claim",
] as const;
const tsdfAuthorityKeys = [
  "metric_authority", "metric_geometry_authority", "collision_authority", "navigation_authority",
  "measurement_authority", "physics_authority", "newton_authority", "quality_claim",
] as const;

export class CaptureSplatHybridWorldPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureSplatHybridWorldPackageError";
  }
}

export interface CaptureSplatHybridWorldPackageInput {
  handoffRoot: string;
  tsdfRoot: string;
  hybridRoot: string;
  compilationRoot: string;
  store: CanonicalWorldPackageStore;
  worldId: string;
  versionId: string;
  createdAt: string;
  producerVersion: string;
  runId?: string | null;
}

export interface CaptureSplatHybridWorldPackageResult {
  manifest: CanonicalWorldManifestV2;
  publication: CanonicalWorldPackagePublishResult;
}

interface FileEvidence {
  path: string;
  size_bytes: number;
  checksum: string;
}

interface ParsedFile {
  bytes: Buffer;
  evidence: FileEvidence;
  value: Record<string, unknown>;
}

interface StreamValidator {
  push(chunk: Buffer): void;
  finish(): void;
}

interface SurfaceValidation {
  vertexDigest: string;
  faceIndexDigest: string;
}

interface ValidatedRegistration {
  value: Record<string, unknown>;
  arkitToColmap: number[][];
  colmapToTarget: number[][];
  arkitToTarget: number[][];
}

export async function publishCaptureSplatHybridWorldPackage(
  input: CaptureSplatHybridWorldPackageInput,
): Promise<CaptureSplatHybridWorldPackageResult> {
  validateInput(input);
  const handoffRoot = await strictRoot(input.handoffRoot, "Capture Splat handoff root");
  const tsdfRoot = await strictRoot(input.tsdfRoot, "TSDF output root");
  const hybridRoot = await strictRoot(input.hybridRoot, "Hybrid output root");
  const compilationRoot = await canonicalFutureRoot(input.compilationRoot, "compilation root");
  const storeRoot = await canonicalFutureRoot(input.store.root, "canonical store root");
  assertDisjointRoots([handoffRoot, tsdfRoot, hybridRoot, compilationRoot, storeRoot]);
  await assertExactFiles(tsdfRoot, [tsdfMeshName, tsdfReportName], "TSDF output root");
  await assertExactFiles(
    hybridRoot,
    [hybridMeshName, hybridReportName, colliderMeshName, colliderReportName],
    "Hybrid output root",
  );

  const handoffVerification = await verifyCaptureSplatConsumerPackage(handoffRoot);
  if (handoffVerification.receipt.decision !== "ready" || !handoffVerification.manifest) {
    throw fail("Capture Splat v0.3 package does not have a ready checksum-bound consumer receipt.");
  }
  const handoff = handoffVerification.manifest;
  literal(handoff.schema, "capture_splat.world_studio_handoff.v0.3", "handoff schema");
  literal(handoff.status, "visual_evidence_with_3dgs_proposal", "handoff status");
  falseAuthority(handoff.authority, [
    "metric_authority", "semantic_authority", "collision_authority", "navigation_authority", "quality_claim",
  ], "handoff authority");
  if (!same(handoff.world_up, [0, 1, 0]) || handoff.world_up_coordinate_frame !== "arkit_world") {
    throw fail("Handoff world-up contract must be ARKit-world +Y.");
  }
  const assets = object(handoff.assets, "handoff assets");
  const captureRef = evidence(assets.capture_manifest, "handoff capture manifest");
  literal(captureRef.path, "capture.json", "capture manifest path");
  const gaussianRef = evidence(assets.gaussian_ply, "handoff Gaussian PLY");
  if (!gaussianRef.path.toLowerCase().endsWith(".ply")) throw fail("Handoff Gaussian appearance must be a PLY asset.");
  const sparse = object(assets.colmap_sparse, "handoff COLMAP assets");
  const colmapRef = evidence(sparse["images.txt"], "handoff COLMAP images");
  const navigationRef = coordinateEvidence(assets.navigation_mesh, "handoff navigation mesh");
  const navigationReportRef = coordinateEvidence(assets.mesh_report, "handoff navigation mesh report");
  const registration = validateRegistration(handoff.metric_registration, handoff.dataparser_transform);

  const handoffBytes = await handoffVerification.readVerifiedFile(handoffName, maxJsonBytes);
  const captureBytes = await handoffVerification.readVerifiedFile(captureRef.path, maxJsonBytes);
  if (!handoffBytes || !captureBytes) throw fail("Receipt-bound handoff or capture manifest changed before compilation.");
  const handoffRef = fileEvidence(handoffName, handoffBytes);
  const registrationDigest = producerRegistrationDigest(handoffBytes);
  if (!same(fileEvidence(captureRef.path, captureBytes), captureRef)) throw fail("Capture manifest differs from its handoff binding.");
  if (!handoffVerification.verifiedPaths.has(gaussianRef.path)) throw fail("Receipt did not verify the Gaussian appearance asset.");
  await validateExpectedFile(handoffRoot, gaussianRef, maxMeshBytes, new GaussianPlyValidator());
  const capture = parseRecord(captureBytes, "capture manifest");
  const sessionConfig = object(capture.session_config, "capture session_config");
  const coordinateDeclaration = {
    scale_authority: sessionConfig.scale_authority,
    up_axis: sessionConfig.up_axis,
    world_alignment: sessionConfig.world_alignment,
  };
  if (
    coordinateDeclaration.scale_authority !== "arkit_vio_metric"
    || !same(coordinateDeclaration.up_axis, [0, 1, 0])
    || coordinateDeclaration.world_alignment !== "gravity"
  ) throw fail("Capture manifest does not declare ARKit VIO meter scale and gravity alignment.");

  const tsdfReport = await readJson(tsdfRoot, tsdfReportName);
  const tsdfValidated = validateTsdfReport(
    tsdfReport.value,
    handoffRef,
    captureRef,
    colmapRef,
    coordinateDeclaration,
  );
  const tsdfMeshRef = tsdfValidated.meshRef;
  const tsdfPly = new SurfacePlyValidator("tsdf", tsdfValidated.vertexCount, tsdfValidated.triangleCount);
  await validateExpectedFile(tsdfRoot, tsdfMeshRef, maxMeshBytes, tsdfPly);

  const hybridReport = await readJson(hybridRoot, hybridReportName);
  const hybridMeshRef = validateHybridReport(
    hybridReport.value,
    { handoffRef, captureRef, colmapRef, navigationRef, navigationReportRef, tsdfReport: tsdfReport.evidence, tsdfMeshRef },
    registration.value,
    coordinateDeclaration,
    tsdfValidated.vertexCount,
    tsdfValidated.triangleCount,
    registrationDigest,
  );
  const hybridPly = new SurfacePlyValidator("hybrid", tsdfValidated.vertexCount, tsdfValidated.triangleCount);
  await validateExpectedFile(hybridRoot, hybridMeshRef, maxMeshBytes, hybridPly);
  if (tsdfPly.result.vertexDigest !== hybridPly.result.vertexDigest
    || tsdfPly.result.faceIndexDigest !== hybridPly.result.faceIndexDigest) {
    throw fail("Hybrid surface does not preserve the TSDF vertex records and triangle indices.");
  }

  const colliderReport = await readJson(hybridRoot, colliderReportName);
  const colliderMeshRef = validateColliderReport(
    colliderReport.value,
    hybridMeshRef,
    hybridReport.evidence,
    tsdfMeshRef,
    object(hybridReport.value.topology, "hybrid topology"),
  );
  await validateExpectedFile(hybridRoot, colliderMeshRef, maxMeshBytes);

  await prepareCompilationRoot(compilationRoot);
  const refs = new Map<string, CanonicalContentReferenceV1>();
  const stageBytes = async (relativePath: string, bytes: Buffer, mediaType: string) => {
    await writeNew(compilationRoot, relativePath, bytes);
    refs.set(relativePath, contentReference(relativePath, fileEvidence(relativePath, bytes), mediaType));
  };
  const stageHandoff = async (sourcePath: string, targetPath: string, expected: FileEvidence, mediaType: string) => {
    if (!handoffVerification.verifiedPaths.has(sourcePath)) throw fail(`Receipt did not verify ${sourcePath}.`);
    const copied = await copyExpectedFile(handoffRoot, sourcePath, compilationRoot, targetPath, expected, maxMeshBytes);
    if (!await handoffVerification.verifyVerifiedFile(sourcePath, maxMeshBytes)) {
      throw fail(`Receipt-bound source ${sourcePath} changed during canonical compilation.`);
    }
    refs.set(targetPath, contentReference(targetPath, copied, mediaType));
  };
  await stageBytes("capture/handoff.json", handoffBytes, "application/json");
  await stageBytes("capture/capture.json", captureBytes, "application/json");
  await stageHandoff(colmapRef.path, "capture/colmap-images.txt", colmapRef, "text/plain");
  await stageHandoff(gaussianRef.path, "visual/splat.ply", gaussianRef, "application/octet-stream");
  await stageHandoff(navigationRef.path, "metric/navigation-mesh.ply", navigationRef, "application/octet-stream");
  await stageHandoff(navigationReportRef.path, "metric/navigation-mesh-report.json", navigationReportRef, "application/json");
  await stageExternal(tsdfRoot, tsdfReport, compilationRoot, "metric/rgbd-tsdf-report.json", refs, "application/json");
  await stageExternal(tsdfRoot, tsdfMeshRef, compilationRoot, "metric/rgbd-tsdf-mesh.ply", refs);
  await stageExternal(hybridRoot, hybridReport, compilationRoot, "metric/hybrid-surface-report.json", refs, "application/json");
  await stageExternal(hybridRoot, hybridMeshRef, compilationRoot, "metric/hybrid-surface.ply", refs);
  await stageExternal(hybridRoot, colliderReport, compilationRoot, "collision/collider-candidate-report.json", refs, "application/json");
  await stageExternal(hybridRoot, colliderMeshRef, compilationRoot, "collision/collider-candidate.ply", refs);
  if (handoffVerification.receipt.decision !== "ready") throw fail("Capture Splat receipt was revoked during compilation.");
  const receiptBytes = Buffer.from(`${stableCanonicalJson(handoffVerification.receipt)}\n`, "utf8");
  await stageBytes("capture/consumer-receipt.json", receiptBytes, "application/json");

  const manifest = buildManifest(input, refs, registration);
  validateCanonicalWorldManifest(manifest);
  await writeNew(compilationRoot, "manifest.json", Buffer.from(`${stableCanonicalJson(manifest)}\n`, "utf8"));
  const publication = await input.store.publishDirectory({ sourceRoot: compilationRoot, manifestPath: "manifest.json" });
  return { manifest, publication };
}

function validateInput(input: CaptureSplatHybridWorldPackageInput): void {
  if (!input || typeof input !== "object") throw fail("Hybrid WorldPackage input is required.");
  for (const [label, value] of [
    ["handoffRoot", input.handoffRoot], ["tsdfRoot", input.tsdfRoot], ["hybridRoot", input.hybridRoot],
    ["compilationRoot", input.compilationRoot],
  ] as const) if (typeof value !== "string" || !path.isAbsolute(value)) throw fail(`${label} must be absolute.`);
  if (!(input.store instanceof CanonicalWorldPackageStore)) throw fail("A CanonicalWorldPackageStore is required.");
  if (!identifierPattern.test(input.worldId) || !identifierPattern.test(input.versionId)) throw fail("World identity is invalid.");
  if (typeof input.producerVersion !== "string" || !input.producerVersion || input.producerVersion.length > 128) {
    throw fail("Producer version is invalid.");
  }
  if (input.runId != null && !identifierPattern.test(input.runId)) throw fail("Run identity is invalid.");
  validateCanonicalTimestamp(input.createdAt, "Hybrid WorldPackage createdAt");
}

function validateRegistration(value: unknown, dataparserTransform: unknown): ValidatedRegistration {
  const registration = object(value, "metric registration");
  literal(registration.schema, "capture_splat.metric_registration.v0.1", "metric registration schema");
  literal(registration.status, "accepted", "metric registration status");
  literal(registration.accepted, true, "metric registration accepted");
  literal(registration.source_coordinate_frame, "arkit_world", "metric registration source frame");
  literal(registration.source_units, "meters", "metric registration units");
  positiveInteger(registration.matched_cameras, "metric registration matched cameras");
  positiveFinite(registration.scale, "metric registration scale");
  literal(registration.intermediate_coordinate_frame, "colmap_world", "metric registration intermediate frame");
  literal(registration.target_coordinate_frame, "trainer_world", "metric registration target frame");
  literal(registration.target_units, "normalized_scene_units", "metric registration target units");
  positiveFinite(registration.target_units_per_meter, "metric registration target units per meter");
  positiveFinite(registration.meters_per_target_unit, "metric registration meters per target unit");
  if (Math.abs(Number(registration.target_units_per_meter) * Number(registration.meters_per_target_unit) - 1) > 1e-9) {
    throw fail("Metric registration target unit scales are not reciprocal.");
  }
  const authority = object(registration.authority, "metric registration authority");
  literal(authority.camera_center_alignment_evidence, true, "metric registration camera alignment evidence");
  literal(authority.metric_mesh_registration_candidate, true, "metric registration candidate");
  literal(authority.collision_authority, false, "metric registration collision authority");
  literal(authority.navigation_authority, false, "metric registration navigation authority");
  literal(authority.quality_claim, false, "metric registration quality claim");
  for (const [key, item] of Object.entries(authority)) {
    if (key.endsWith("_authority") || key === "quality_claim") literal(item, false, `metric registration ${key}`);
  }
  for (const name of ["matrix", "arkit_to_colmap", "colmap_to_target", "arkit_to_target"] as const) {
    validateSimilarityMatrix(registration[name], `metric registration ${name}`);
  }
  if (!same(registration.matrix, registration.arkit_to_colmap)) throw fail("Metric registration matrices disagree.");
  if (!same(registration.colmap_to_target, dataparserTransform)) {
    throw fail("Metric registration colmap_to_target differs from the handoff dataparser transform.");
  }
  const arkitToColmap = registration.arkit_to_colmap as number[][];
  const colmapToTarget = registration.colmap_to_target as number[][];
  const arkitToTarget = registration.arkit_to_target as number[][];
  if (!scalarsClose(Number(registration.scale), similarityScale(arkitToColmap), 1e-9)) {
    throw fail("Metric registration scale differs from the arkit_to_colmap similarity scale.");
  }
  if (!scalarsClose(Number(registration.target_units_per_meter), similarityScale(arkitToTarget), 1e-9)) {
    throw fail("Metric registration target units per meter differs from the arkit_to_target similarity scale.");
  }
  if (!matricesClose(multiplyMatrices(colmapToTarget, arkitToColmap), arkitToTarget, 1e-10)) {
    throw fail("Metric registration arkit_to_target does not compose from its declared transforms.");
  }
  return { value: registration, arkitToColmap, colmapToTarget, arkitToTarget };
}

function validateTsdfReport(
  report: Record<string, unknown>,
  handoffRef: FileEvidence,
  captureRef: FileEvidence,
  colmapRef: FileEvidence,
  declaration: Record<string, unknown>,
): { meshRef: FileEvidence; vertexCount: number; triangleCount: number } {
  literal(report.schema, "capture_splat.rgbd_tsdf_report.v0.1", "TSDF report schema");
  literal(report.decision, "hold", "TSDF decision");
  literal(report.software_surface_candidate, "hold", "TSDF surface decision");
  falseAuthority(report.authority, tsdfAuthorityKeys, "TSDF authority");
  const inputs = object(report.inputs, "TSDF inputs");
  equalEvidence(inputs.handoff_manifest, handoffRef, "TSDF handoff binding");
  equalEvidence(inputs.capture_manifest, captureRef, "TSDF capture binding");
  equalEvidence(inputs.colmap_images, colmapRef, "TSDF COLMAP binding");
  const coordinate = object(report.coordinate_contract, "TSDF coordinate contract");
  literal(coordinate.output_coordinate_frame, "arkit_world", "TSDF output frame");
  literal(coordinate.units, "meters", "TSDF units");
  if (!same(coordinate.capture_declaration, declaration)) throw fail("TSDF capture coordinate declaration differs from capture.json.");
  const mesh = object(report.mesh, "TSDF mesh report");
  literal(mesh.path, tsdfMeshName, "TSDF mesh path");
  literal(mesh.coordinate_frame, "arkit_world", "TSDF mesh frame");
  literal(mesh.units, "meters", "TSDF mesh units");
  if (!same(mesh.coordinate_declaration, declaration)) throw fail("TSDF mesh coordinate declaration differs from capture.json.");
  for (const [key, expected] of [
    ["finite", true], ["budget_limited", false], ["non_finite_vertex_count", 0],
    ["non_finite_normal_count", 0], ["invalid_index_triangle_count", 0], ["degenerate_triangle_count", 0],
  ] as const) literal(mesh[key], expected, `TSDF mesh ${key}`);
  positiveInteger(mesh.vertex_count, "TSDF vertex count");
  positiveInteger(mesh.triangle_count, "TSDF triangle count");
  const performance = object(report.performance, "TSDF performance evidence");
  literal(performance.decision, "hold", "TSDF performance decision");
  return {
    meshRef: evidence(mesh, "TSDF mesh evidence"),
    vertexCount: Number(mesh.vertex_count),
    triangleCount: Number(mesh.triangle_count),
  };
}

function validateHybridReport(
  report: Record<string, unknown>,
  expected: {
    handoffRef: FileEvidence; captureRef: FileEvidence; colmapRef: FileEvidence;
    navigationRef: FileEvidence; navigationReportRef: FileEvidence; tsdfReport: FileEvidence; tsdfMeshRef: FileEvidence;
  },
  registration: Record<string, unknown>,
  declaration: Record<string, unknown>,
  tsdfVertexCount: number,
  tsdfTriangleCount: number,
  registrationDigest: string,
): FileEvidence {
  literal(report.schema, "capture_splat.hybrid_structural_surface.v0.1", "hybrid report schema");
  literal(report.status, "held", "hybrid status");
  literal(report.decision, "hold", "hybrid decision");
  if (Object.hasOwn(report, "error")) throw fail("Hybrid report contains an error.");
  falseAuthority(report.authority, authorityKeys, "hybrid authority");
  const inputs = object(report.inputs, "hybrid inputs");
  for (const [name, ref] of [
    ["handoff_manifest", expected.handoffRef], ["capture_manifest", expected.captureRef],
    ["colmap_images", expected.colmapRef], ["tsdf_report", expected.tsdfReport], ["tsdf_mesh", expected.tsdfMeshRef],
    ["navigation_mesh", expected.navigationRef], ["navigation_mesh_report", expected.navigationReportRef],
  ] as const) equalEvidence(inputs[name], ref, `hybrid ${name} binding`);
  const registrationEvidence = object(inputs.registration, "hybrid registration binding");
  for (const name of ["schema", "status", "matched_cameras", "source_coordinate_frame", "source_units"] as const) {
    if (!same(registrationEvidence[name], registration[name])) throw fail(`Hybrid registration ${name} differs from the handoff.`);
  }
  literal(registrationEvidence.digest, registrationDigest, "hybrid registration digest");
  const coordinate = object(report.coordinate_contract, "hybrid coordinate contract");
  literal(coordinate.coordinate_frame, "arkit_world", "hybrid coordinate frame");
  literal(coordinate.units, "meters", "hybrid units");
  literal(coordinate.tsdf_and_arkit_share_input_frame, true, "hybrid shared input frame");
  if (!same(coordinate.capture_declaration, declaration)) throw fail("Hybrid coordinate declaration differs from capture.json.");
  const topology = object(report.topology, "hybrid topology");
  for (const name of ["source_vertex_count", "source_triangle_count", "output_vertex_count", "output_triangle_count"] as const) {
    positiveInteger(topology[name], `hybrid topology ${name}`);
  }
  if (topology.source_vertex_count !== topology.output_vertex_count || topology.source_triangle_count !== topology.output_triangle_count) {
    throw fail("Hybrid topology must preserve TSDF vertex and triangle counts.");
  }
  literal(topology.source_vertex_count, tsdfVertexCount, "hybrid source vertex count");
  literal(topology.source_triangle_count, tsdfTriangleCount, "hybrid source triangle count");
  for (const [key, expectedValue] of [
    ["vertex_records_copied_byte_for_byte", true], ["triangle_indices_preserved_in_source_order", true],
    ["source_face_index_mapping", "identity_zero_based"], ["synthetic_geometry_added", false],
    ["fallback_floor_added", false], ["simplification_applied", false],
  ] as const) literal(topology[key], expectedValue, `hybrid topology ${key}`);
  const semantics = object(report.semantics, "hybrid semantics");
  nonNegativeInteger(semantics.transferred_face_count, "hybrid transferred face count");
  nonNegativeInteger(semantics.unknown_face_count, "hybrid unknown face count");
  literal(semantics.partition_invariant, true, "hybrid semantic partition");
  if (Number(semantics.transferred_face_count) + Number(semantics.unknown_face_count) !== topology.output_triangle_count) {
    throw fail("Hybrid semantic counts do not partition output triangles.");
  }
  const rails = object(report.rails, "hybrid rails");
  literal(object(rails.doorway_clearance, "hybrid doorway rail").status, "held", "hybrid doorway rail status");
  literal(object(rails.physical_validation, "hybrid physical rail").status, "pending", "hybrid physical rail status");
  const output = object(report.output, "hybrid output");
  const surface = evidence(output.hybrid_surface, "hybrid surface evidence");
  literal(surface.path, hybridMeshName, "hybrid surface path");
  return surface;
}

function validateColliderReport(
  report: Record<string, unknown>,
  hybridRef: FileEvidence,
  hybridReportRef: FileEvidence,
  tsdfRef: FileEvidence,
  hybridTopology: Record<string, unknown>,
): FileEvidence {
  literal(report.schema, "capture_splat.hybrid_collider_candidate.v0.1", "collider report schema");
  literal(report.status, "held", "collider status");
  literal(report.decision, "hold", "collider decision");
  falseAuthority(report.authority, authorityKeys, "collider authority");
  const inputs = object(report.inputs, "collider inputs");
  equalEvidence(inputs.hybrid_surface, hybridRef, "collider hybrid surface binding");
  equalEvidence(inputs.hybrid_report, hybridReportRef, "collider hybrid report binding");
  equalEvidence(inputs.tsdf_mesh, tsdfRef, "collider TSDF binding");
  const coordinate = object(report.coordinate_contract, "collider coordinate contract");
  literal(coordinate.coordinate_frame, "arkit_world", "collider coordinate frame");
  literal(coordinate.units, "meters", "collider units");
  if (!same(report.topology, hybridTopology)) throw fail("Collider topology differs from the hybrid topology.");
  const topology = hybridTopology;
  const budget = object(report.triangle_budget, "collider triangle budget");
  positiveInteger(budget.limit, "collider triangle limit");
  literal(budget.observed, topology.output_triangle_count, "collider observed triangle count");
  literal(budget.status, Number(budget.observed) > Number(budget.limit) ? "exceeded" : "within", "collider budget status");
  literal(budget.simplification_applied, false, "collider simplification status");
  const partition = object(report.semantic_partition, "collider semantic partition");
  literal(partition.partition_invariant, true, "collider semantic partition invariant");
  if (Number(partition.transferred_face_count) + Number(partition.unknown_face_count) !== topology.output_triangle_count) {
    throw fail("Collider semantic counts do not partition candidate triangles.");
  }
  const rails = object(report.rails, "collider rails");
  literal(rails.doorway_clearance, "held_unresolved", "collider doorway rail");
  literal(rails.wall_and_opening_continuity, "held_weak", "collider continuity rail");
  literal(rails.physical_collision_probes, "pending_none_recorded", "collider physical rail");
  literal(rails.fallback_floor, "not_added", "collider fallback floor rail");
  literal(rails.synthetic_geometry, "not_added", "collider synthetic geometry rail");
  const candidate = evidence(report.candidate, "collider candidate evidence");
  literal(candidate.path, colliderMeshName, "collider candidate path");
  if (candidate.size_bytes !== hybridRef.size_bytes || candidate.checksum !== hybridRef.checksum) {
    throw fail("Collider candidate bytes must remain identical to the held hybrid surface in v0.1.");
  }
  return candidate;
}

function buildManifest(
  input: CaptureSplatHybridWorldPackageInput,
  refs: ReadonlyMap<string, CanonicalContentReferenceV1>,
  registration: ValidatedRegistration,
): CanonicalWorldManifestV2 {
  const createdAt = input.createdAt;
  const provenance = (producer: string, inputs: string[] = []): CanonicalProvenanceV1 => ({
    producer,
    producer_version: input.producerVersion,
    created_at: createdAt,
    run_id: input.runId ?? null,
    input_artifact_ids: inputs,
    input_versions: [],
  });
  const unknown = { status: "unknown" as const, reason: "Producer reports contain no validated uncertainty bound." };
  const heldAuthority = (domain: CanonicalAuthorityDomain, evidenceIds: string[] = []): CanonicalAuthorityV1 => ({
    domain,
    status: "held",
    approved_for: ["evidence_review"],
    not_approved_for: ["measurement", "collision", "navigation", "semantic_ground_truth", "physics", "deployment"],
    limitations: ["Checksum-bound software evidence only; physical and task validation are pending."],
    evidence_artifact_ids: evidenceIds,
  });
  const artifact = (
    artifactId: string,
    role: CanonicalArtifactBindingV1["role"],
    refPath: string,
    domain: CanonicalAuthorityDomain,
    inputs: string[] = [],
    producer = "capture_splat",
    frameId = "arkit_world",
    transformId: string | null = null,
  ): CanonicalArtifactBindingV1 => ({
    artifact_id: artifactId,
    role,
    content: requiredRef(refs, refPath),
    frame_id: frameId,
    transform_id: transformId,
    authority: heldAuthority(domain),
    uncertainty: unknown,
    provenance: provenance(producer, inputs),
  });
  const artifacts: CanonicalArtifactBindingV1[] = [
    artifact("capture_manifest", "source_manifest", "capture/capture.json", "capture"),
    artifact("capture_handoff", "validation_report", "capture/handoff.json", "capture", ["capture_manifest"]),
    artifact("capture_consumer_receipt", "validation_report", "capture/consumer-receipt.json", "capture", ["capture_handoff"]),
    artifact("colmap_camera_poses", "camera_poses", "capture/colmap-images.txt", "calibration", ["capture_manifest"], "capture_splat", "colmap_world", "arkit_from_colmap"),
    artifact("spirula_gaussian_appearance", "visual_splat", "visual/splat.ply", "visual", ["capture_handoff", "colmap_camera_poses"], "capture_splat", "trainer_world", "arkit_from_trainer"),
    artifact("arkit_navigation_mesh", "metric_mesh", "metric/navigation-mesh.ply", "metric", ["capture_handoff"]),
    artifact("arkit_navigation_mesh_report", "validation_report", "metric/navigation-mesh-report.json", "metric", ["arkit_navigation_mesh"]),
    artifact("rgbd_tsdf_mesh", "metric_mesh", "metric/rgbd-tsdf-mesh.ply", "metric", ["capture_manifest", "colmap_camera_poses"]),
    artifact("rgbd_tsdf_report", "validation_report", "metric/rgbd-tsdf-report.json", "metric", ["rgbd_tsdf_mesh"]),
    artifact("hybrid_structural_surface", "metric_mesh", "metric/hybrid-surface.ply", "metric", ["rgbd_tsdf_mesh", "arkit_navigation_mesh"]),
    artifact("hybrid_structural_surface_report", "validation_report", "metric/hybrid-surface-report.json", "metric", ["hybrid_structural_surface", "rgbd_tsdf_report", "arkit_navigation_mesh_report"]),
    artifact("collider_candidate", "collision_mesh", "collision/collider-candidate.ply", "collision", ["hybrid_structural_surface"]),
    artifact("collider_candidate_report", "validation_report", "collision/collider-candidate-report.json", "collision", ["collider_candidate", "hybrid_structural_surface_report"]),
  ];
  const unavailable = (limitation: string): CanonicalReadinessLaneV1 => ({
    status: "unavailable", evidence_artifact_ids: [], report: null, limitations: [limitation],
  });
  const captureAuthority = heldAuthority("capture", ["capture_manifest", "capture_handoff", "capture_consumer_receipt"]);
  return {
    schema: CANONICAL_WORLD_SCHEMA,
    world_id: input.worldId,
    version_id: input.versionId,
    version: 1,
    parent: null,
    created_at: createdAt,
    units: { length: "m", mass: "kg", time: "s", angle: "rad", force: "N", torque: "N*m" },
    transform_graph: {
      root_frame_id: "arkit_world",
      nodes: [
        { frame_id: "arkit_world", handedness: "right", up_axis: "+Y", forward_axis: "-Z" },
        { frame_id: "colmap_world", handedness: "right", up_axis: "+Y", forward_axis: "-Z" },
        { frame_id: "trainer_world", handedness: "right", up_axis: "+Y", forward_axis: "-Z" },
      ],
      edges: [
        {
          transform_id: "arkit_from_colmap",
          parent_frame: "arkit_world",
          child_frame: "colmap_world",
          kind: "similarity",
          convention: "parent_from_child_column_vector",
          matrix_row_major: flattenMatrix(invertSimilarity(registration.arkitToColmap)),
          source_class: "registration",
          authority: heldAuthority("calibration", ["capture_handoff"]),
          uncertainty: unknown,
          provenance: provenance("capture_splat", ["capture_handoff"]),
        },
        {
          transform_id: "arkit_from_trainer",
          parent_frame: "arkit_world",
          child_frame: "trainer_world",
          kind: "similarity",
          convention: "parent_from_child_column_vector",
          matrix_row_major: flattenMatrix(invertSimilarity(registration.arkitToTarget)),
          source_class: "registration",
          authority: heldAuthority("calibration", ["capture_handoff"]),
          uncertainty: unknown,
          provenance: provenance("capture_splat", ["capture_handoff", "colmap_camera_poses"]),
        },
      ],
    },
    capture_evidence: [{
      session_id: input.runId ?? `${input.worldId}_capture`,
      manifest: requiredRef(refs, "capture/capture.json"),
      verification: "rehashed_bytes",
      authority: captureAuthority,
      uncertainty: unknown,
    }],
    artifacts,
    assets: [],
    applied_delta: null,
    authorities: [
      captureAuthority,
      heldAuthority("calibration", ["colmap_camera_poses"]),
      heldAuthority("visual", ["spirula_gaussian_appearance"]),
      heldAuthority("metric", ["rgbd_tsdf_mesh", "hybrid_structural_surface", "hybrid_structural_surface_report"]),
      heldAuthority("collision", ["collider_candidate", "collider_candidate_report"]),
    ],
    readiness: {
      visual: {
        status: "held",
        evidence_artifact_ids: ["spirula_gaussian_appearance"],
        report: null,
        limitations: ["Receipt-verified Spirula appearance is published for review without a promoted quality claim."],
      },
      metric: {
        status: "held",
        evidence_artifact_ids: ["rgbd_tsdf_mesh", "hybrid_structural_surface", "hybrid_structural_surface_report"],
        report: requiredRef(refs, "metric/hybrid-surface-report.json"),
        limitations: ["Software-derived measured surface is not metric or measurement authority until physical validation."],
      },
      collision: {
        status: "held",
        evidence_artifact_ids: ["collider_candidate", "collider_candidate_report"],
        report: requiredRef(refs, "collision/collider-candidate-report.json"),
        limitations: ["Opening continuity, unknown coverage, triangle budget, and physical collision probes remain unresolved."],
      },
      navigation: unavailable("No validated free-space or traversability layer is available."),
      semantic: unavailable("Transferred face labels remain local support evidence, not semantic ground truth."),
      articulation: unavailable("No articulation model is included."),
      physics: unavailable("No OpenUSD, Newton, Rapier, or physics material binding is included."),
    },
    provenance: provenance("world_studio_hybrid_importer", artifacts.map((entry) => entry.artifact_id)),
  };
}

async function stageExternal(
  sourceRoot: string,
  source: ParsedFile | FileEvidence,
  targetRoot: string,
  targetPath: string,
  refs: Map<string, CanonicalContentReferenceV1>,
  mediaType = "application/octet-stream",
): Promise<void> {
  const expected = "evidence" in source ? source.evidence : source;
  const copied = await copyExpectedFile(sourceRoot, expected.path, targetRoot, targetPath, expected, maxMeshBytes);
  refs.set(targetPath, contentReference(targetPath, copied, mediaType));
}

async function readJson(root: string, relativePath: string): Promise<ParsedFile> {
  const read = await readStableFile(root, relativePath, maxJsonBytes, true);
  if (!read.bytes) throw fail(`${relativePath} could not be retained for strict JSON validation.`);
  return { bytes: read.bytes, evidence: read.evidence, value: parseRecord(read.bytes, relativePath) };
}

async function readStableFile(
  root: string,
  relativePath: string,
  limit: number,
  retain: boolean,
  validator?: StreamValidator,
) {
  const absolute = path.join(root, relativePath);
  const rootBefore = await lstat(root, { bigint: true });
  const before = await lstat(absolute, { bigint: true });
  if (!rootBefore.isDirectory() || before.isSymbolicLink() || !before.isFile() || await realpath(absolute) !== absolute) {
    throw fail(`${relativePath} must be a regular file without symlink traversal.`);
  }
  const identity = statIdentity(before);
  const rootIdentity = statIdentity(rootBefore);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  const digest = createHash("sha256");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    if (statIdentity(await handle.stat({ bigint: true })) !== identity) throw fail(`${relativePath} changed before reading.`);
    const buffer = Buffer.allocUnsafe(copyBufferBytes);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw fail(`${relativePath} exceeds its byte bound.`);
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      validator?.push(chunk);
      if (retain) chunks.push(Buffer.from(chunk));
    }
    if (statIdentity(await handle.stat({ bigint: true })) !== identity) throw fail(`${relativePath} changed while reading.`);
  } finally {
    await handle.close();
  }
  if (statIdentity(await lstat(absolute, { bigint: true })) !== identity
    || statIdentity(await lstat(root, { bigint: true })) !== rootIdentity
    || await realpath(absolute) !== absolute) throw fail(`${relativePath} changed while reading.`);
  const evidence = { path: relativePath, size_bytes: size, checksum: `sha256:${digest.digest("hex")}` };
  validator?.finish();
  return { bytes: retain ? Buffer.concat(chunks, size) : undefined, evidence };
}

async function copyExpectedFile(
  sourceRoot: string,
  sourcePath: string,
  targetRoot: string,
  targetPath: string,
  expected: FileEvidence,
  limit: number,
): Promise<FileEvidence> {
  if (expected.path !== sourcePath || expected.size_bytes > limit) throw fail(`Invalid expected identity for ${sourcePath}.`);
  const source = path.join(sourceRoot, sourcePath);
  if (await realpath(source) !== source) throw fail(`${sourcePath} traverses a symbolic link.`);
  const before = await lstat(source, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) throw fail(`${sourcePath} is not a regular source file.`);
  const sourceIdentity = statIdentity(before);
  const rootIdentity = statIdentity(await lstat(sourceRoot, { bigint: true }));
  const target = path.join(targetRoot, targetPath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const targetHandle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  const digest = createHash("sha256");
  let size = 0;
  try {
    if (statIdentity(await sourceHandle.stat({ bigint: true })) !== sourceIdentity) throw fail(`${sourcePath} changed before copying.`);
    const buffer = Buffer.allocUnsafe(copyBufferBytes);
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.byteLength, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit || size > expected.size_bytes) throw fail(`${sourcePath} exceeds its declared size.`);
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      let offset = 0;
      while (offset < bytesRead) offset += (await targetHandle.write(chunk, offset, bytesRead - offset, null)).bytesWritten;
    }
    if (statIdentity(await sourceHandle.stat({ bigint: true })) !== sourceIdentity) throw fail(`${sourcePath} changed while copying.`);
    await targetHandle.sync();
  } finally {
    await Promise.allSettled([sourceHandle.close(), targetHandle.close()]);
  }
  const copied = { path: targetPath, size_bytes: size, checksum: `sha256:${digest.digest("hex")}` };
  if (size !== expected.size_bytes || copied.checksum !== expected.checksum
    || statIdentity(await lstat(source, { bigint: true })) !== sourceIdentity
    || statIdentity(await lstat(sourceRoot, { bigint: true })) !== rootIdentity
    || await realpath(source) !== source) throw fail(`${sourcePath} differs from its checksum-bound declaration.`);
  return copied;
}

async function validateExpectedFile(
  root: string,
  expected: FileEvidence,
  limit: number,
  validator?: StreamValidator,
): Promise<void> {
  const actual = (await readStableFile(root, expected.path, limit, false, validator)).evidence;
  if (actual.size_bytes !== expected.size_bytes || actual.checksum !== expected.checksum) {
    throw fail(`${expected.path} differs from its report binding.`);
  }
}

class SurfacePlyValidator implements StreamValidator {
  private header = Buffer.alloc(0);
  private carry = Buffer.alloc(0);
  private headerComplete = false;
  private vertexIndex = 0;
  private faceIndex = 0;
  private positions: Float64Array | null = null;
  private readonly vertexHash = createHash("sha256");
  private readonly faceHash = createHash("sha256");
  private validation: SurfaceValidation | null = null;

  constructor(
    private readonly kind: "tsdf" | "hybrid",
    private readonly vertexCount: number,
    private readonly triangleCount: number,
  ) {
    if (vertexCount > maxSurfaceVertices || triangleCount > maxSurfaceTriangles) {
      throw fail(`Surface topology exceeds the ${maxSurfaceVertices} vertex or ${maxSurfaceTriangles} triangle validation bound.`);
    }
  }

  get result(): SurfaceValidation {
    if (!this.validation) throw fail("Surface PLY validation did not finish.");
    return this.validation;
  }

  push(chunk: Buffer): void {
    if (!this.headerComplete) {
      this.header = Buffer.concat([this.header, chunk]);
      const end = this.header.indexOf(Buffer.from("end_header\n", "ascii"));
      if (end < 0) {
        if (this.header.byteLength > 64 * 1024) throw fail(`${this.kind} PLY header exceeds 64 KiB.`);
        return;
      }
      const bodyOffset = end + "end_header\n".length;
      if (bodyOffset > 64 * 1024) throw fail(`${this.kind} PLY header exceeds 64 KiB.`);
      this.parseHeader(this.header.subarray(0, bodyOffset).toString("ascii"));
      this.headerComplete = true;
      this.positions = new Float64Array(this.vertexCount * 3);
      const body = this.header.subarray(bodyOffset);
      this.header = Buffer.alloc(0);
      if (body.byteLength) this.consumeBody(body);
      return;
    }
    this.consumeBody(chunk);
  }

  finish(): void {
    if (!this.headerComplete || this.vertexIndex !== this.vertexCount || this.faceIndex !== this.triangleCount || this.carry.byteLength) {
      throw fail(`${this.kind} PLY body does not match its declared topology.`);
    }
    this.validation = {
      vertexDigest: `sha256:${this.vertexHash.digest("hex")}`,
      faceIndexDigest: `sha256:${this.faceHash.digest("hex")}`,
    };
    this.positions = null;
  }

  private parseHeader(header: string): void {
    const vertexProperties = [
      "property double x", "property double y", "property double z", "property double nx", "property double ny",
      "property double nz", "property uchar red", "property uchar green", "property uchar blue",
    ];
    const faceProperties = this.kind === "tsdf"
      ? ["property list uchar uint vertex_indices"]
      : [
          "property list uchar uint vertex_indices", "property uchar semantic_classification",
          "property uchar semantic_support", "property uint source_face_index",
        ];
    const structural = header.split("\n").filter((line) => line && !line.startsWith("comment "));
    const expected = [
      "ply", "format binary_little_endian 1.0", `element vertex ${this.vertexCount}`,
      ...vertexProperties, `element face ${this.triangleCount}`, ...faceProperties, "end_header",
    ];
    if (!same(structural, expected)) throw fail(`${this.kind} PLY layout does not match its v0.1 binary contract.`);
  }

  private consumeBody(chunk: Buffer): void {
    const data = this.carry.byteLength ? Buffer.concat([this.carry, chunk]) : chunk;
    let offset = 0;
    while (this.vertexIndex < this.vertexCount && data.byteLength - offset >= 51) {
      const record = data.subarray(offset, offset + 51);
      this.vertexHash.update(record);
      for (let field = 0; field < 6; field += 1) {
        const value = record.readDoubleLE(field * 8);
        if (!Number.isFinite(value)) throw fail(`${this.kind} PLY contains a non-finite vertex or normal.`);
        if (field < 3) this.positions![this.vertexIndex * 3 + field] = value;
      }
      this.vertexIndex += 1;
      offset += 51;
    }
    const faceSize = this.kind === "tsdf" ? 13 : 19;
    while (this.vertexIndex === this.vertexCount && this.faceIndex < this.triangleCount && data.byteLength - offset >= faceSize) {
      const record = data.subarray(offset, offset + faceSize);
      if (record.readUInt8(0) !== 3) throw fail(`${this.kind} PLY contains a non-triangle face.`);
      const indices = [record.readUInt32LE(1), record.readUInt32LE(5), record.readUInt32LE(9)] as const;
      if (indices.some((index) => index >= this.vertexCount)) throw fail(`${this.kind} PLY contains an out-of-range face index.`);
      const [a, b, c] = indices.map((index) => [
        this.positions![index * 3]!, this.positions![index * 3 + 1]!, this.positions![index * 3 + 2]!,
      ]) as [[number, number, number], [number, number, number], [number, number, number]];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ];
      if (cross[0]! ** 2 + cross[1]! ** 2 + cross[2]! ** 2 <= 1e-24) {
        throw fail(`${this.kind} PLY contains a degenerate triangle.`);
      }
      this.faceHash.update(record.subarray(0, 13));
      if (this.kind === "hybrid") {
        const classification = record.readUInt8(13);
        if (!((classification >= 1 && classification <= 7) || classification === 255)) {
          throw fail("Hybrid PLY contains an unsupported semantic classification.");
        }
        if (record.readUInt8(14) > 4) throw fail("Hybrid PLY semantic support exceeds four samples.");
        if (record.readUInt32LE(15) !== this.faceIndex) throw fail("Hybrid PLY source_face_index is not identity zero-based.");
      }
      this.faceIndex += 1;
      offset += faceSize;
    }
    if (this.vertexIndex === this.vertexCount && this.faceIndex === this.triangleCount && offset !== data.byteLength) {
      throw fail(`${this.kind} PLY contains undeclared trailing bytes.`);
    }
    this.carry = Buffer.from(data.subarray(offset));
  }
}

class GaussianPlyValidator implements StreamValidator {
  private header = Buffer.alloc(0);
  private carry = Buffer.alloc(0);
  private headerComplete = false;
  private vertexCount = 0;
  private vertexIndex = 0;
  private stride = 0;
  private properties: Array<{ type: string; name: string; offset: number }> = [];

  push(chunk: Buffer): void {
    if (!this.headerComplete) {
      this.header = Buffer.concat([this.header, chunk]);
      const end = this.header.indexOf(Buffer.from("end_header\n", "ascii"));
      if (end < 0) {
        if (this.header.byteLength > 64 * 1024) throw fail("Gaussian PLY header exceeds 64 KiB.");
        return;
      }
      const bodyOffset = end + "end_header\n".length;
      if (bodyOffset > 64 * 1024) throw fail("Gaussian PLY header exceeds 64 KiB.");
      this.parseHeader(this.header.subarray(0, bodyOffset).toString("ascii"));
      this.headerComplete = true;
      const body = this.header.subarray(bodyOffset);
      this.header = Buffer.alloc(0);
      if (body.byteLength) this.consumeBody(body);
      return;
    }
    this.consumeBody(chunk);
  }

  finish(): void {
    if (!this.headerComplete || this.vertexIndex !== this.vertexCount || this.carry.byteLength) {
      throw fail("Gaussian PLY body does not match its declared vertex schema.");
    }
  }

  private parseHeader(header: string): void {
    const structural = header.split("\n").filter((line) => line && !line.startsWith("comment "));
    if (structural[0] !== "ply" || structural[1] !== "format binary_little_endian 1.0"
      || !/^element vertex [1-9][0-9]*$/.test(structural[2] ?? "") || structural.at(-1) !== "end_header") {
      throw fail("Gaussian appearance is not a binary little-endian vertex PLY.");
    }
    this.vertexCount = Number(structural[2]!.slice("element vertex ".length));
    if (!Number.isSafeInteger(this.vertexCount) || this.vertexCount > maxGaussianVertices) {
      throw fail(`Gaussian PLY exceeds the ${maxGaussianVertices} vertex bound.`);
    }
    const propertyLines = structural.slice(3, -1);
    if (!propertyLines.length || propertyLines.length > 512 || propertyLines.some((line) => line.startsWith("element "))) {
      throw fail("Gaussian PLY must contain only one bounded scalar vertex element.");
    }
    const sizes: Record<string, number> = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8 };
    const names = new Set<string>();
    for (const line of propertyLines) {
      const match = /^property (char|uchar|short|ushort|int|uint|float|double) ([A-Za-z0-9_]+)$/.exec(line);
      if (!match || names.has(match[2]!)) throw fail("Gaussian PLY has an invalid or duplicate scalar property.");
      names.add(match[2]!);
      this.properties.push({ type: match[1]!, name: match[2]!, offset: this.stride });
      this.stride += sizes[match[1]!]!;
    }
    for (const name of [
      "x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
      "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
    ]) if (!names.has(name)) throw fail(`Gaussian PLY is missing ${name}.`);
    if (!Number.isSafeInteger(this.vertexCount * this.stride) || this.stride <= 0 || this.stride > 4096) {
      throw fail("Gaussian PLY row layout exceeds its byte bound.");
    }
  }

  private consumeBody(chunk: Buffer): void {
    const data = this.carry.byteLength ? Buffer.concat([this.carry, chunk]) : chunk;
    let offset = 0;
    while (this.vertexIndex < this.vertexCount && data.byteLength - offset >= this.stride) {
      for (const property of this.properties) {
        const propertyOffset = offset + property.offset;
        const value = property.type === "float" ? data.readFloatLE(propertyOffset)
          : property.type === "double" ? data.readDoubleLE(propertyOffset) : 0;
        if ((property.type === "float" || property.type === "double") && !Number.isFinite(value)) {
          throw fail(`Gaussian PLY contains non-finite ${property.name}.`);
        }
      }
      this.vertexIndex += 1;
      offset += this.stride;
    }
    if (this.vertexIndex === this.vertexCount && offset !== data.byteLength) {
      throw fail("Gaussian PLY contains undeclared trailing bytes.");
    }
    this.carry = Buffer.from(data.subarray(offset));
  }
}

async function strictRoot(root: string, label: string): Promise<string> {
  if (!path.isAbsolute(root)) throw fail(`${label} must be absolute.`);
  const resolved = path.resolve(root);
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) throw fail(`${label} must be a real directory.`);
  return realpath(resolved);
}

async function assertExactFiles(root: string, expected: string[], label: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (!same(names, [...expected].sort()) || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw fail(`${label} must contain exactly its declared regular output files.`);
  }
}

async function prepareCompilationRoot(root: string): Promise<void> {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory() || (await readdir(root)).length) {
      throw fail("Compilation root must be an empty real directory.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(root, { recursive: false, mode: 0o700 });
  }
}

async function canonicalFutureRoot(root: string, label: string): Promise<string> {
  if (!path.isAbsolute(root)) throw fail(`${label} must be absolute.`);
  const resolved = path.resolve(root);
  const missing: string[] = [];
  let existing = resolved;
  while (true) {
    try {
      const info = await lstat(existing);
      if (existing === resolved && info.isSymbolicLink()) throw fail(`${label} must not be a symbolic link.`);
      if (!info.isDirectory() && !info.isSymbolicLink()) throw fail(`${label} existing ancestor must be a directory.`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw fail(`${label} has no existing directory ancestor.`);
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const canonicalExisting = await realpath(existing);
  if (!(await lstat(canonicalExisting)).isDirectory()) throw fail(`${label} existing ancestor must resolve to a directory.`);
  return path.join(canonicalExisting, ...missing);
}

function assertDisjointRoots(roots: string[]): void {
  const comparable = roots.map((root) => {
    const normalized = root.normalize("NFC");
    if (!/^[\x00-\x7f]+$/.test(normalized)) {
      throw fail("Input, compilation, and store roots must use ASCII paths for fail-closed case-fold comparison.");
    }
    return normalized.toLowerCase();
  });
  for (let left = 0; left < comparable.length; left += 1) for (let right = left + 1; right < comparable.length; right += 1) {
    if (isWithin(comparable[left]!, comparable[right]!) || isWithin(comparable[right]!, comparable[left]!)) {
      throw fail("Input, compilation, and store roots must be disjoint after canonical path resolution.");
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function writeNew(root: string, relativePath: string, bytes: Buffer): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}

function parseRecord(bytes: Buffer, label: string): Record<string, unknown> {
  let text: string;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    throw fail(`${label} is not strict UTF-8 JSON.`);
  }
  try {
    return object(parseCanonicalGraphJson(text), label);
  } catch {
    throw fail(`${label} is not strict finite duplicate-free JSON.`);
  }
}

function coordinateEvidence(value: unknown, label: string): FileEvidence {
  const item = object(value, label);
  literal(item.coordinate_frame, "arkit_world", `${label} coordinate_frame`);
  literal(item.units, "meters", `${label} units`);
  return evidence(item, label);
}

function evidence(value: unknown, label: string): FileEvidence {
  const item = object(value, label);
  if (typeof item.path !== "string" || !item.path || path.isAbsolute(item.path) || item.path.includes("\\")
    || item.path.split("/").some((part) => !part || part === "." || part === ".." || /[^\x20-\x7e]/.test(part))) {
    throw fail(`${label} path is not a portable relative path.`);
  }
  if (!Number.isSafeInteger(item.size_bytes) || Number(item.size_bytes) < 0 || Number(item.size_bytes) > maxMeshBytes) {
    throw fail(`${label} size is invalid.`);
  }
  if (typeof item.checksum !== "string" || !sha256Pattern.test(item.checksum)) throw fail(`${label} checksum is invalid.`);
  return { path: item.path, size_bytes: Number(item.size_bytes), checksum: item.checksum };
}

function equalEvidence(value: unknown, expected: FileEvidence, label: string): void {
  if (!same(evidence(value, label), expected)) throw fail(`${label} differs from the expected file identity.`);
}

function falseAuthority(value: unknown, keys: readonly string[], label: string): void {
  const authority = object(value, label);
  for (const key of keys) literal(authority[key], false, `${label} ${key}`);
  for (const [key, item] of Object.entries(authority)) {
    if (key.endsWith("_authority") || key === "quality_claim") literal(item, false, `${label} ${key}`);
  }
}

function validateMatrix(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length !== 4 || value.some((row) => !Array.isArray(row) || row.length !== 4
    || row.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)))) throw fail(`${label} must be a finite 4x4 matrix.`);
  if (!same(value[3], [0, 0, 0, 1])) throw fail(`${label} must be affine.`);
}

function validateSimilarityMatrix(value: unknown, label: string): void {
  validateMatrix(value, label);
  const matrix = value as number[][];
  const columns = [0, 1, 2].map((column) => [matrix[0]![column]!, matrix[1]![column]!, matrix[2]![column]!]);
  const dot = (left: number[], right: number[]) => left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
  const squared = columns.map((column) => dot(column, column));
  const scaleSquared = Math.max(...squared);
  const normalizedDeterminant = determinant3(matrix) / (scaleSquared ** 1.5);
  if (squared.some((value) => value <= 1e-18)
    || Math.abs(squared[0]! - squared[1]!) > 1e-8 * scaleSquared
    || Math.abs(squared[0]! - squared[2]!) > 1e-8 * scaleSquared
    || Math.abs(dot(columns[0]!, columns[1]!)) > 1e-8 * scaleSquared
    || Math.abs(dot(columns[0]!, columns[2]!)) > 1e-8 * scaleSquared
    || Math.abs(dot(columns[1]!, columns[2]!)) > 1e-8 * scaleSquared
    || !Number.isFinite(normalizedDeterminant)
    || normalizedDeterminant <= 1e-8) throw fail(`${label} must be a right-handed uniform similarity.`);
}

function similarityScale(matrix: number[][]): number {
  return Math.hypot(matrix[0]![0]!, matrix[1]![0]!, matrix[2]![0]!);
}

function scalarsClose(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= Math.max(
    tolerance * Math.max(Math.abs(left), Math.abs(right)),
    Number.EPSILON * 16,
  );
}

function determinant3(matrix: number[][]): number {
  return matrix[0]![0]! * (matrix[1]![1]! * matrix[2]![2]! - matrix[1]![2]! * matrix[2]![1]!)
    - matrix[0]![1]! * (matrix[1]![0]! * matrix[2]![2]! - matrix[1]![2]! * matrix[2]![0]!)
    + matrix[0]![2]! * (matrix[1]![0]! * matrix[2]![1]! - matrix[1]![1]! * matrix[2]![0]!);
}

function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  return Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) =>
    [0, 1, 2, 3].reduce((sum, inner) => sum + left[row]![inner]! * right[inner]![column]!, 0)));
}

function matricesClose(left: number[][], right: number[][], tolerance: number): boolean {
  const linearMagnitude = Math.max(...left.flatMap((row) => row.slice(0, 3).map(Math.abs)),
    ...right.flatMap((row) => row.slice(0, 3).map(Math.abs)));
  const linearTolerance = Math.max(tolerance * linearMagnitude, Number.EPSILON * 16);
  return left.every((row, rowIndex) => row.every((value, columnIndex) =>
    Math.abs(value - right[rowIndex]![columnIndex]!) <= (rowIndex < 3 && columnIndex < 3
      ? linearTolerance
      : tolerance * Math.max(1, Math.abs(value), Math.abs(right[rowIndex]![columnIndex]!)))));
}

function invertSimilarity(matrix: number[][]): number[][] {
  const determinant = determinant3(matrix);
  const inverse = [
    [
      (matrix[1]![1]! * matrix[2]![2]! - matrix[1]![2]! * matrix[2]![1]!) / determinant,
      (matrix[0]![2]! * matrix[2]![1]! - matrix[0]![1]! * matrix[2]![2]!) / determinant,
      (matrix[0]![1]! * matrix[1]![2]! - matrix[0]![2]! * matrix[1]![1]!) / determinant,
    ],
    [
      (matrix[1]![2]! * matrix[2]![0]! - matrix[1]![0]! * matrix[2]![2]!) / determinant,
      (matrix[0]![0]! * matrix[2]![2]! - matrix[0]![2]! * matrix[2]![0]!) / determinant,
      (matrix[0]![2]! * matrix[1]![0]! - matrix[0]![0]! * matrix[1]![2]!) / determinant,
    ],
    [
      (matrix[1]![0]! * matrix[2]![1]! - matrix[1]![1]! * matrix[2]![0]!) / determinant,
      (matrix[0]![1]! * matrix[2]![0]! - matrix[0]![0]! * matrix[2]![1]!) / determinant,
      (matrix[0]![0]! * matrix[1]![1]! - matrix[0]![1]! * matrix[1]![0]!) / determinant,
    ],
  ];
  const translation = [matrix[0]![3]!, matrix[1]![3]!, matrix[2]![3]!];
  const clean = (value: number) => Object.is(value, -0) ? 0 : value;
  return [
    [...inverse[0]!.map(clean), clean(-inverse[0]!.reduce((sum, value, index) => sum + value * translation[index]!, 0))],
    [...inverse[1]!.map(clean), clean(-inverse[1]!.reduce((sum, value, index) => sum + value * translation[index]!, 0))],
    [...inverse[2]!.map(clean), clean(-inverse[2]!.reduce((sum, value, index) => sum + value * translation[index]!, 0))],
    [0, 0, 0, 1],
  ];
}

function flattenMatrix(matrix: number[][]): [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
] {
  return matrix.flat() as ReturnType<typeof flattenMatrix>;
}

type LexicalJson =
  | { kind: "string"; value: string }
  | { kind: "number"; raw: string }
  | { kind: "literal"; value: "true" | "false" | "null" }
  | { kind: "array"; values: LexicalJson[] }
  | { kind: "object"; values: Map<string, LexicalJson> };

function producerRegistrationDigest(bytes: Buffer): string {
  let text: string;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    throw fail("Handoff manifest is not strict UTF-8 JSON.");
  }
  const root = new LexicalJsonParser(text).parse();
  if (root.kind !== "object") throw fail("Handoff manifest must be a JSON object.");
  const registration = root.values.get("metric_registration");
  if (!registration || registration.kind !== "object") throw fail("Handoff metric registration lexical binding is missing.");
  return sha256(Buffer.from(canonicalLexicalJson(registration), "utf8"));
}

function canonicalLexicalJson(value: LexicalJson): string {
  switch (value.kind) {
    case "string": return JSON.stringify(value.value);
    case "number": return value.raw;
    case "literal": return value.value;
    case "array": return `[${value.values.map(canonicalLexicalJson).join(",")}]`;
    case "object": return `{${[...value.values.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalLexicalJson(item)}`).join(",")}}`;
  }
}

class LexicalJsonParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): LexicalJson {
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) throw fail("Handoff manifest has trailing JSON data.");
    return value;
  }

  private parseValue(depth: number): LexicalJson {
    if (depth > 128) throw fail("Handoff JSON nesting exceeds 128 levels.");
    this.skipWhitespace();
    const token = this.text[this.index];
    if (token === '"') return { kind: "string", value: this.parseString() };
    if (token === "{") return this.parseObject(depth + 1);
    if (token === "[") return this.parseArray(depth + 1);
    for (const literalValue of ["true", "false", "null"] as const) {
      if (this.text.startsWith(literalValue, this.index)) {
        this.index += literalValue.length;
        return { kind: "literal", value: literalValue };
      }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.index));
    if (!match) throw fail("Handoff manifest contains invalid JSON.");
    this.index += match[0].length;
    return { kind: "number", raw: match[0] };
  }

  private parseObject(depth: number): LexicalJson {
    this.index += 1;
    const values = new Map<string, LexicalJson>();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return { kind: "object", values };
    }
    while (true) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') throw fail("Handoff JSON object key is invalid.");
      const key = this.parseString();
      if (values.has(key)) throw fail(`Handoff JSON repeats object member ${key}.`);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") throw fail("Handoff JSON object separator is invalid.");
      this.index += 1;
      values.set(key, this.parseValue(depth));
      this.skipWhitespace();
      const separator = this.text[this.index];
      this.index += 1;
      if (separator === "}") return { kind: "object", values };
      if (separator !== ",") throw fail("Handoff JSON object terminator is invalid.");
    }
  }

  private parseArray(depth: number): LexicalJson {
    this.index += 1;
    const values: LexicalJson[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return { kind: "array", values };
    }
    while (true) {
      values.push(this.parseValue(depth));
      this.skipWhitespace();
      const separator = this.text[this.index];
      this.index += 1;
      if (separator === "]") return { kind: "array", values };
      if (separator !== ",") throw fail("Handoff JSON array terminator is invalid.");
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        try {
          return JSON.parse(this.text.slice(start, this.index)) as string;
        } catch {
          throw fail("Handoff JSON string is invalid.");
        }
      }
      if (code < 0x20) throw fail("Handoff JSON string contains a control character.");
      if (code === 0x5c) {
        this.index += 1;
        if (this.text[this.index] === "u") this.index += 4;
      }
      this.index += 1;
    }
    throw fail("Handoff JSON string is unterminated.");
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.text[this.index] ?? "")) this.index += 1;
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function literal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw fail(`${label} must be ${JSON.stringify(expected)}.`);
}

function positiveInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw fail(`${label} must be a positive integer.`);
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw fail(`${label} must be a non-negative integer.`);
}

function positiveFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw fail(`${label} must be positive and finite.`);
}

function same(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(left) === stableCanonicalJson(right);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileEvidence(relativePath: string, bytes: Uint8Array): FileEvidence {
  return { path: relativePath, size_bytes: bytes.byteLength, checksum: sha256(bytes) };
}

function contentReference(pathValue: string, file: FileEvidence, mediaType: string): CanonicalContentReferenceV1 {
  return { path: pathValue, sha256: file.checksum, size_bytes: file.size_bytes, media_type: mediaType };
}

function requiredRef(refs: ReadonlyMap<string, CanonicalContentReferenceV1>, relativePath: string): CanonicalContentReferenceV1 {
  const ref = refs.get(relativePath);
  if (!ref) throw fail(`Compiled content reference ${relativePath} is missing.`);
  return ref;
}

function statIdentity(info: Awaited<ReturnType<typeof lstat>> | Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>): string {
  const value = info as unknown as { dev: bigint | number; ino: bigint | number; size: bigint | number; mtimeNs?: bigint; ctimeNs?: bigint; mtimeMs: number; ctimeMs: number };
  return [value.dev, value.ino, value.size, value.mtimeNs ?? value.mtimeMs, value.ctimeNs ?? value.ctimeMs].join(":");
}

function fail(message: string): CaptureSplatHybridWorldPackageError {
  return new CaptureSplatHybridWorldPackageError(message);
}
