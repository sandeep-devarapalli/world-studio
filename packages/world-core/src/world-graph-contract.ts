export class CanonicalGraphContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalGraphContractError";
  }
}

export const CANONICAL_WORLD_SCHEMA = "world_studio.world.v0.2" as const;
export const CANONICAL_ASSET_SCHEMA = "world_studio.asset.v0.1" as const;
export const CANONICAL_DELTA_SCHEMA = "world_studio.delta.v0.1" as const;

export type CanonicalRevisionKind = "world" | "asset";
export type CanonicalDeltaIntent =
  | "crop"
  | "transform"
  | "filter"
  | "merge"
  | "hide"
  | "replace"
  | "objectize"
  | "annotate";
export type CanonicalAuthorityDomain =
  | "capture"
  | "calibration"
  | "visual"
  | "metric"
  | "collision"
  | "navigation"
  | "semantic"
  | "articulation"
  | "physics"
  | "task"
  | "deployment";
export type CanonicalAuthorityStatus = "proposal" | "validated" | "promoted" | "held" | "rejected";
export type CanonicalReadinessStatus = "unavailable" | CanonicalAuthorityStatus;
export type CanonicalArtifactRole =
  | "source_manifest"
  | "evidence_rgb"
  | "evidence_depth"
  | "evidence_confidence"
  | "evidence_mask"
  | "camera_poses"
  | "visual_splat"
  | "visual_mesh"
  | "visual_texture"
  | "metric_points"
  | "metric_mesh"
  | "collision_mesh"
  | "occupancy"
  | "navigation_graph"
  | "semantics"
  | "articulation"
  | "physics_parameters"
  | "validation_report"
  | "episode"
  | "annotation";
export type CanonicalQuantityUnit =
  | "m"
  | "rad"
  | "m/s"
  | "m/s^2"
  | "kg"
  | "N"
  | "N*m"
  | "dimensionless";

export interface CanonicalUnitsV1 {
  length: "m";
  mass: "kg";
  time: "s";
  angle: "rad";
  force: "N";
  torque: "N*m";
}

export interface CanonicalContentReferenceV1 {
  path: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
}

export interface CanonicalVersionReferenceV1 {
  kind: CanonicalRevisionKind;
  id: string;
  version_id: string;
  version: number;
  manifest_sha256: string;
}

export type CanonicalAssetVersionReferenceV1 = CanonicalVersionReferenceV1 & { kind: "asset" };

export interface CanonicalResultVersionIdentityV1 {
  kind: CanonicalRevisionKind;
  id: string;
  version_id: string;
  version: number;
}

export interface CanonicalDeltaReferenceV1 {
  delta_id: string;
  manifest: CanonicalContentReferenceV1;
}

export interface CanonicalVersionedManifestReferenceV1 {
  revision: CanonicalVersionReferenceV1;
  manifest: CanonicalContentReferenceV1;
}

export interface CanonicalAuthorityV1 {
  domain: CanonicalAuthorityDomain;
  status: CanonicalAuthorityStatus;
  approved_for: string[];
  not_approved_for: string[];
  limitations: string[];
  evidence_artifact_ids: string[];
}

export type CanonicalUncertaintyV1 =
  | { status: "unknown"; reason: string }
  | {
      status: "bounded";
      quantity: string;
      unit: CanonicalQuantityUnit;
      lower: number;
      upper: number;
      confidence: number;
      method: string;
      evidence_artifact_ids: string[];
    };

export interface CanonicalProvenanceV1 {
  producer: string;
  producer_version: string;
  created_at: string;
  run_id: string | null;
  input_artifact_ids: string[];
  input_versions: CanonicalVersionReferenceV1[];
}

export interface CanonicalCoordinateFrameV1 {
  frame_id: string;
  handedness: "right" | "left";
  up_axis: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
  forward_axis: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
}

export interface CanonicalTransformEdgeV1 {
  transform_id: string;
  parent_frame: string;
  child_frame: string;
  kind: "rigid" | "similarity";
  convention: "parent_from_child_column_vector";
  matrix_row_major: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
  ];
  source_class: "sensor_calibration" | "fiducial_alignment" | "registration" | "manual_edit" | "simulator_export";
  authority: CanonicalAuthorityV1;
  uncertainty: CanonicalUncertaintyV1;
  provenance: CanonicalProvenanceV1;
}

export interface CanonicalTransformGraphV1 {
  root_frame_id: string;
  nodes: CanonicalCoordinateFrameV1[];
  edges: CanonicalTransformEdgeV1[];
}

export interface CanonicalArtifactBindingV1 {
  artifact_id: string;
  role: CanonicalArtifactRole;
  content: CanonicalContentReferenceV1;
  frame_id: string;
  transform_id: string | null;
  authority: CanonicalAuthorityV1;
  uncertainty: CanonicalUncertaintyV1;
  provenance: CanonicalProvenanceV1;
}

export interface CanonicalCaptureEvidenceV1 {
  session_id: string;
  manifest: CanonicalContentReferenceV1;
  verification: "rehashed_bytes" | "declared_checksum_reference_only";
  authority: CanonicalAuthorityV1;
  uncertainty: CanonicalUncertaintyV1;
}

export interface CanonicalReadinessLaneV1 {
  status: CanonicalReadinessStatus;
  evidence_artifact_ids: string[];
  report: CanonicalContentReferenceV1 | null;
  limitations: string[];
}

export interface CanonicalReadinessV1 {
  visual: CanonicalReadinessLaneV1;
  metric: CanonicalReadinessLaneV1;
  collision: CanonicalReadinessLaneV1;
  navigation: CanonicalReadinessLaneV1;
  semantic: CanonicalReadinessLaneV1;
  articulation: CanonicalReadinessLaneV1;
  physics: CanonicalReadinessLaneV1;
}

export type CanonicalDeltaEffectV1 =
  | { kind: "artifact_binding"; before: CanonicalArtifactBindingV1[]; after: CanonicalArtifactBindingV1[] }
  | { kind: "transform_edge"; before: CanonicalTransformEdgeV1 | null; after: CanonicalTransformEdgeV1 | null }
  | { kind: "visibility"; before: boolean; after: boolean }
  | { kind: "annotation"; before: CanonicalContentReferenceV1 | null; after: CanonicalContentReferenceV1 | null }
  | { kind: "membership"; before: CanonicalAssetVersionReferenceV1[]; after: CanonicalAssetVersionReferenceV1[] };

export interface CanonicalDeltaOperationV1 {
  operation_id: string;
  target_id: string;
  effect: CanonicalDeltaEffectV1;
}

export interface CanonicalWorldManifestV2 {
  schema: typeof CANONICAL_WORLD_SCHEMA;
  world_id: string;
  version_id: string;
  version: number;
  parent: CanonicalVersionReferenceV1 | null;
  created_at: string;
  units: CanonicalUnitsV1;
  transform_graph: CanonicalTransformGraphV1;
  capture_evidence: CanonicalCaptureEvidenceV1[];
  artifacts: CanonicalArtifactBindingV1[];
  assets: CanonicalVersionedManifestReferenceV1[];
  applied_delta: CanonicalDeltaReferenceV1 | null;
  authorities: CanonicalAuthorityV1[];
  readiness: CanonicalReadinessV1;
  provenance: CanonicalProvenanceV1;
}

export interface CanonicalAssetManifestV1 {
  schema: typeof CANONICAL_ASSET_SCHEMA;
  asset_id: string;
  version_id: string;
  version: number;
  parent: CanonicalVersionReferenceV1 | null;
  created_at: string;
  units: CanonicalUnitsV1;
  root_frame: CanonicalCoordinateFrameV1;
  artifacts: CanonicalArtifactBindingV1[];
  applied_delta: CanonicalDeltaReferenceV1 | null;
  authorities: CanonicalAuthorityV1[];
  readiness: CanonicalReadinessV1;
  provenance: CanonicalProvenanceV1;
}

export interface CanonicalDeltaV1 {
  schema: typeof CANONICAL_DELTA_SCHEMA;
  delta_id: string;
  scope: CanonicalRevisionKind;
  parent: CanonicalVersionReferenceV1;
  result: CanonicalResultVersionIdentityV1;
  created_at: string;
  intent: CanonicalDeltaIntent;
  operations: CanonicalDeltaOperationV1[];
  authority_effect: "none";
  provenance: CanonicalProvenanceV1;
}

export interface CanonicalTransitionHashesV1 {
  parent_manifest_sha256: string;
  delta_manifest_sha256: string;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const timestampPattern = /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const safePathSegmentPattern = /^[A-Za-z0-9_@+-](?:[A-Za-z0-9._@+ -]*[A-Za-z0-9_@+-])?$/;
const utf8Encoder = new TextEncoder();

export function parseCanonicalGraphJson(text: string): unknown {
  if (typeof text !== "string") {
    throw new CanonicalGraphContractError("Canonical graph payload must be strict JSON text.");
  }
  assertNoDuplicateJsonMembers(text);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new CanonicalGraphContractError("Canonical graph payload must be complete, strict JSON.");
  }
  assertCanonicalJsonValue(value, new Set());
  return value;
}

function assertNoDuplicateJsonMembers(text: string): void {
  const fail = (): never => {
    throw new CanonicalGraphContractError("Canonical graph payload must be complete, strict JSON.");
  };
  const skipWhitespace = (start: number): number => {
    let index = start;
    while (index < text.length && (text[index] === " " || text[index] === "\t" || text[index] === "\r" || text[index] === "\n")) {
      index += 1;
    }
    return index;
  };
  const parseStringToken = (start: number): { end: number; value: string } => {
    if (text[start] !== '"') return fail();
    let index = start + 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        const end = index + 1;
        try {
          return { end, value: JSON.parse(text.slice(start, end)) as string };
        } catch {
          return fail();
        }
      }
      if (code < 0x20) return fail();
      if (code === 0x5c) {
        index += 1;
        const escape = text[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) return fail();
          index += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) {
          return fail();
        }
      }
      index += 1;
    }
    return fail();
  };
  const parseValue = (start: number, depth: number): number => {
    if (depth > 512) return fail();
    let index = skipWhitespace(start);
    const token = text[index];
    if (token === "{") {
      index = skipWhitespace(index + 1);
      const keys = new Set<string>();
      if (text[index] === "}") return index + 1;
      while (index < text.length) {
        const key = parseStringToken(index);
        if (keys.has(key.value)) {
          throw new CanonicalGraphContractError(`Canonical graph payload contains duplicate object member ${key.value}.`);
        }
        keys.add(key.value);
        index = skipWhitespace(key.end);
        if (text[index] !== ":") return fail();
        index = skipWhitespace(parseValue(index + 1, depth + 1));
        if (text[index] === "}") return index + 1;
        if (text[index] !== ",") return fail();
        index = skipWhitespace(index + 1);
      }
      return fail();
    }
    if (token === "[") {
      index = skipWhitespace(index + 1);
      if (text[index] === "]") return index + 1;
      while (index < text.length) {
        index = skipWhitespace(parseValue(index, depth + 1));
        if (text[index] === "]") return index + 1;
        if (text[index] !== ",") return fail();
        index = skipWhitespace(index + 1);
      }
      return fail();
    }
    if (token === '"') return parseStringToken(index).end;
    for (const literalValue of ["true", "false", "null"] as const) {
      if (text.startsWith(literalValue, index)) return index + literalValue.length;
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
    if (number) return index + number[0].length;
    return fail();
  };
  const end = skipWhitespace(parseValue(0, 0));
  if (end !== text.length) fail();
}

export function stableCanonicalJson(value: unknown): string {
  return serializeCanonicalValue(canonicalJsonValue(value, new Set()));
}

export function safeCanonicalRelativePath(value: unknown, label = "path"): string {
  const text = validString(value, label, 1_024);
  if (
    text.startsWith("/")
    || text.includes("\\")
    || text.includes("\0")
    || text.includes("//")
    || text.endsWith("/")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)
  ) {
    throw new CanonicalGraphContractError(`${label} must be a safe POSIX-relative path.`);
  }
  if (text.split("/").some((part) => !safePathSegmentPattern.test(part))) {
    throw new CanonicalGraphContractError(`${label} must be a safe POSIX-relative path.`);
  }
  return text;
}

export function validateCanonicalSha256(value: unknown, label = "sha256"): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new CanonicalGraphContractError(`${label} must be sha256:<64 lowercase hex>.`);
  }
  return value;
}

export function validateCanonicalTimestamp(value: unknown, label = "timestamp"): string {
  if (typeof value !== "string" || !timestampPattern.test(value)) {
    throw new CanonicalGraphContractError(`${label} must be a canonical UTC timestamp.`);
  }
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== normalized) {
    throw new CanonicalGraphContractError(`${label} must be a real canonical UTC timestamp.`);
  }
  return value;
}

export function validateCanonicalWorldManifest(value: unknown): CanonicalWorldManifestV2 {
  assertCanonicalJsonValue(value, new Set());
  const manifest = record(value, "World manifest");
  if (manifest.schema === "world_studio.world.v0.1") {
    throw new CanonicalGraphContractError("world_studio.world.v0.1 requires explicit migration to world_studio.world.v0.2.");
  }
  exactKeys(manifest, [
    "schema", "world_id", "version_id", "version", "parent", "created_at", "units",
    "transform_graph", "capture_evidence", "artifacts", "assets", "applied_delta",
    "authorities", "readiness", "provenance",
  ], "World manifest");
  literal(manifest.schema, CANONICAL_WORLD_SCHEMA, "World manifest schema");
  const worldId = validIdentifier(manifest.world_id, "World manifest world_id");
  validateManifestLineage(
    "world",
    worldId,
    manifest.version_id,
    manifest.version,
    manifest.parent,
    manifest.applied_delta,
    "World manifest",
  );
  validateCanonicalTimestamp(manifest.created_at, "World manifest created_at");
  validateUnits(manifest.units, "World manifest units");
  const graph = validateTransformGraph(manifest.transform_graph, "World manifest transform_graph");
  const artifacts = validateArtifacts(manifest.artifacts, "World manifest artifacts", 131_072);
  validateArtifactGraphReferences(artifacts, graph, "World manifest artifacts");
  const artifactIds = new Set(artifacts.map((artifact) => artifact.artifact_id));
  validateTransformEvidenceReferences(graph, artifactIds, "World manifest transform_graph");
  validateCaptureEvidence(manifest.capture_evidence, artifacts, "World manifest capture_evidence");
  validateVersionedManifests(manifest.assets, "asset", "World manifest assets");
  const authorities = validateAuthorities(manifest.authorities, artifactIds, "World manifest authorities");
  validateReadiness(manifest.readiness, artifacts, authorities, "World manifest readiness");
  validateProvenance(manifest.provenance, artifactIds, "World manifest provenance");
  return manifest as unknown as CanonicalWorldManifestV2;
}

export function validateCanonicalAssetManifest(value: unknown): CanonicalAssetManifestV1 {
  assertCanonicalJsonValue(value, new Set());
  const manifest = record(value, "Asset manifest");
  exactKeys(manifest, [
    "schema", "asset_id", "version_id", "version", "parent", "created_at", "units", "root_frame",
    "artifacts", "applied_delta", "authorities", "readiness", "provenance",
  ], "Asset manifest");
  literal(manifest.schema, CANONICAL_ASSET_SCHEMA, "Asset manifest schema");
  const assetId = validIdentifier(manifest.asset_id, "Asset manifest asset_id");
  validateManifestLineage(
    "asset",
    assetId,
    manifest.version_id,
    manifest.version,
    manifest.parent,
    manifest.applied_delta,
    "Asset manifest",
  );
  validateCanonicalTimestamp(manifest.created_at, "Asset manifest created_at");
  validateUnits(manifest.units, "Asset manifest units");
  const rootFrame = validateCoordinateFrame(manifest.root_frame, "Asset manifest root_frame");
  const artifacts = validateArtifacts(manifest.artifacts, "Asset manifest artifacts", 65_536, 1);
  const artifactIds = new Set(artifacts.map((artifact) => artifact.artifact_id));
  validateArtifactEvidenceReferences(artifacts, "Asset manifest artifacts");
  for (const artifact of artifacts) {
    if (artifact.frame_id !== rootFrame.frame_id) {
      throw new CanonicalGraphContractError("Asset artifact frame_id must equal the asset root_frame frame_id.");
    }
    if (artifact.transform_id !== null) {
      throw new CanonicalGraphContractError("Asset artifacts cannot reference a transform absent from the asset contract.");
    }
  }
  const authorities = validateAuthorities(manifest.authorities, artifactIds, "Asset manifest authorities");
  validateReadiness(manifest.readiness, artifacts, authorities, "Asset manifest readiness");
  validateProvenance(manifest.provenance, artifactIds, "Asset manifest provenance");
  return manifest as unknown as CanonicalAssetManifestV1;
}

export function validateCanonicalDelta(value: unknown): CanonicalDeltaV1 {
  assertCanonicalJsonValue(value, new Set());
  const delta = record(value, "Delta");
  exactKeys(delta, [
    "schema", "delta_id", "scope", "parent", "result", "created_at", "intent",
    "operations", "authority_effect", "provenance",
  ], "Delta");
  literal(delta.schema, CANONICAL_DELTA_SCHEMA, "Delta schema");
  validIdentifier(delta.delta_id, "Delta delta_id");
  const scope = literalOneOf(delta.scope, REVISION_KINDS, "Delta scope");
  const parent = validateVersionReference(delta.parent, "Delta parent");
  const result = validateResultVersionIdentity(delta.result, "Delta result");
  if (parent.kind !== scope || result.kind !== scope || parent.id !== result.id) {
    throw new CanonicalGraphContractError("Delta parent and result must identify the same scoped record.");
  }
  if (result.version !== parent.version + 1 || result.version_id === parent.version_id) {
    throw new CanonicalGraphContractError("Delta result must be the next immutable version with a new version_id.");
  }
  validateCanonicalTimestamp(delta.created_at, "Delta created_at");
  const intent = literalOneOf(delta.intent, DELTA_INTENTS, "Delta intent");
  const operations = boundedArray(delta.operations, "Delta operations", 1, 4_096).map((operation, index) =>
    validateDeltaOperation(operation, intent, `Delta operations[${index}]`));
  assertUnique(operations.map((operation) => operation.operation_id), "Delta operation_id values");
  assertUnique(operations.map((operation) => operation.target_id), "Delta target_id values");
  validateNonOverlappingArtifactOperations(operations);
  literal(delta.authority_effect, "none", "Delta authority_effect");
  validateProvenance(delta.provenance, null, "Delta provenance");
  return delta as unknown as CanonicalDeltaV1;
}

export function validateCanonicalTransitionBinding(
  parentValue: unknown,
  deltaValue: unknown,
  resultValue: unknown,
  hashesValue: CanonicalTransitionHashesV1,
): void {
  const parent = manifestIdentity(parentValue, "transition parent");
  const result = manifestIdentity(resultValue, "transition result");
  const delta = validateCanonicalDelta(deltaValue);
  const hashes = record(hashesValue, "Transition hashes");
  exactKeys(hashes, ["parent_manifest_sha256", "delta_manifest_sha256"], "Transition hashes");
  const parentHash = validateCanonicalSha256(hashes.parent_manifest_sha256, "Transition parent_manifest_sha256");
  const deltaHash = validateCanonicalSha256(hashes.delta_manifest_sha256, "Transition delta_manifest_sha256");
  if (parent.kind !== result.kind || parent.id !== result.id) {
    throw new CanonicalGraphContractError("Transition parent and result must identify the same manifest lineage.");
  }
  if (delta.parent.kind !== parent.kind || delta.parent.id !== parent.id
    || delta.parent.version_id !== parent.version_id || delta.parent.version !== parent.version
    || delta.parent.manifest_sha256 !== parentHash) {
    throw new CanonicalGraphContractError("Transition Delta parent must bind the exact parent manifest and checksum.");
  }
  if (delta.result.kind !== result.kind || delta.result.id !== result.id
    || delta.result.version_id !== result.version_id || delta.result.version !== result.version) {
    throw new CanonicalGraphContractError("Transition Delta result must bind the exact child identity.");
  }
  if (!result.parent || result.parent.manifest_sha256 !== parentHash
    || result.parent.version_id !== parent.version_id || result.parent.version !== parent.version) {
    throw new CanonicalGraphContractError("Transition child parent must bind the exact parent manifest and checksum.");
  }
  if (!result.applied_delta || result.applied_delta.delta_id !== delta.delta_id
    || result.applied_delta.manifest.sha256 !== deltaHash) {
    throw new CanonicalGraphContractError("Transition child applied_delta must bind the exact Delta and checksum.");
  }
  validateDeltaProvenanceBinding(delta, parent);
  const parentCreatedAt = Date.parse(parent.created_at);
  const deltaCreatedAt = Date.parse(delta.created_at);
  const resultCreatedAt = Date.parse(result.created_at);
  if (deltaCreatedAt < parentCreatedAt || resultCreatedAt < deltaCreatedAt) {
    throw new CanonicalGraphContractError(
      "Transition timestamps must satisfy parent.created_at <= delta.created_at <= result.created_at.",
    );
  }
  validateTransitionSemantics(parent, result, delta);
}

function validateDeltaProvenanceBinding(
  delta: CanonicalDeltaV1,
  parent: TransitionManifestIdentity,
): void {
  if (!delta.provenance.input_versions.some((reference) =>
    stableCanonicalJson(reference) === stableCanonicalJson(delta.parent))) {
    throw new CanonicalGraphContractError(
      "Transition Delta provenance must include the exact parent version and checksum.",
    );
  }
  const knownArtifacts = new Set(parent.manifest.artifacts.map((artifact) => artifact.artifact_id));
  const unknownArtifact = delta.provenance.input_artifact_ids.find((artifactId) => !knownArtifacts.has(artifactId));
  if (unknownArtifact) {
    throw new CanonicalGraphContractError(
      `Transition Delta provenance input artifact ${unknownArtifact} must exist in the parent manifest.`,
    );
  }
}

type TransitionManifestIdentity = {
  kind: "world" | "asset";
  id: string;
  version_id: string;
  version: number;
  created_at: string;
  parent: CanonicalVersionReferenceV1 | null;
  applied_delta: CanonicalDeltaReferenceV1 | null;
  manifest: CanonicalWorldManifestV2 | CanonicalAssetManifestV1;
};

function manifestIdentity(value: unknown, label: string): TransitionManifestIdentity {
  const candidate = record(value, label);
  if (candidate.schema === CANONICAL_WORLD_SCHEMA) {
    const manifest = validateCanonicalWorldManifest(value);
    return {
      kind: "world", id: manifest.world_id, version_id: manifest.version_id, version: manifest.version,
      created_at: manifest.created_at, parent: manifest.parent, applied_delta: manifest.applied_delta, manifest,
    };
  }
  if (candidate.schema === CANONICAL_ASSET_SCHEMA) {
    const manifest = validateCanonicalAssetManifest(value);
    return {
      kind: "asset", id: manifest.asset_id, version_id: manifest.version_id, version: manifest.version,
      created_at: manifest.created_at, parent: manifest.parent, applied_delta: manifest.applied_delta, manifest,
    };
  }
  throw new CanonicalGraphContractError(`${label} must be a canonical World or Asset manifest.`);
}

function validateTransitionSemantics(
  parentIdentity: TransitionManifestIdentity,
  resultIdentity: TransitionManifestIdentity,
  delta: CanonicalDeltaV1,
): void {
  if (delta.intent === "hide" || delta.intent === "annotate") {
    throw new CanonicalGraphContractError(
      `Transition binding for ${delta.intent} is unavailable until a schema-backed state carrier exists.`,
    );
  }
  if (parentIdentity.kind === "world" && resultIdentity.kind === "world") {
    validateWorldTransition(
      parentIdentity.manifest as CanonicalWorldManifestV2,
      resultIdentity.manifest as CanonicalWorldManifestV2,
      delta,
    );
    return;
  }
  if (parentIdentity.kind === "asset" && resultIdentity.kind === "asset") {
    validateAssetTransition(
      parentIdentity.manifest as CanonicalAssetManifestV1,
      resultIdentity.manifest as CanonicalAssetManifestV1,
      delta,
    );
    return;
  }
  throw new CanonicalGraphContractError("Transition parent and result manifest kinds must match.");
}

function validateWorldTransition(
  parent: CanonicalWorldManifestV2,
  result: CanonicalWorldManifestV2,
  delta: CanonicalDeltaV1,
): void {
  assertCanonicalEqual(parent.units, result.units, "Transition cannot change World units");
  assertKeyedCollectionEqual(
    parent.capture_evidence,
    result.capture_evidence,
    (capture) => capture.session_id,
    "Transition must preserve capture_evidence byte-for-byte",
  );
  assertCaptureArtifactsEqual(parent.artifacts, result.artifacts);
  const evidenceMap = buildArtifactEvidenceMap(delta.operations);
  validateManifestAuthorityTransition(parent.authorities, result.authorities, evidenceMap, "World transition authorities");
  validateReadinessTransition(parent.readiness, result.readiness, evidenceMap, delta.operations, "World transition readiness");
  validateResultProvenanceParent(result.provenance, delta.parent, "World transition provenance");

  if (isArtifactBindingIntent(delta.intent)) {
    validateArtifactMaterialization(parent.artifacts, result.artifacts, delta.operations);
    assertTransformGraphsEqual(parent.transform_graph, result.transform_graph, "Artifact transition transform_graph");
    assertKeyedCollectionEqual(
      parent.assets, result.assets, (asset) => asset.revision.id, "Artifact transition assets",
    );
    return;
  }
  if (delta.intent === "transform") {
    assertKeyedCollectionEqual(
      parent.artifacts, result.artifacts, (artifact) => artifact.artifact_id, "Transform transition artifacts",
    );
    validateTransformMaterialization(parent.transform_graph, result.transform_graph, delta.operations);
    assertKeyedCollectionEqual(
      parent.assets, result.assets, (asset) => asset.revision.id, "Transform transition assets",
    );
    return;
  }
  if (delta.intent === "objectize") {
    assertKeyedCollectionEqual(
      parent.artifacts, result.artifacts, (artifact) => artifact.artifact_id, "Membership transition artifacts",
    );
    assertTransformGraphsEqual(parent.transform_graph, result.transform_graph, "Membership transition transform_graph");
    validateMembershipMaterialization(parent.assets, result.assets, delta.operations);
    return;
  }
  throw new CanonicalGraphContractError(`World transition intent ${delta.intent} has no materialization rule.`);
}

function validateAssetTransition(
  parent: CanonicalAssetManifestV1,
  result: CanonicalAssetManifestV1,
  delta: CanonicalDeltaV1,
): void {
  assertCanonicalEqual(parent.units, result.units, "Transition cannot change Asset units");
  assertCanonicalEqual(parent.root_frame, result.root_frame, "Transition cannot change Asset root_frame");
  assertCaptureArtifactsEqual(parent.artifacts, result.artifacts);
  const evidenceMap = buildArtifactEvidenceMap(delta.operations);
  validateManifestAuthorityTransition(parent.authorities, result.authorities, evidenceMap, "Asset transition authorities");
  validateReadinessTransition(parent.readiness, result.readiness, evidenceMap, delta.operations, "Asset transition readiness");
  validateResultProvenanceParent(result.provenance, delta.parent, "Asset transition provenance");
  if (!isArtifactBindingIntent(delta.intent)) {
    throw new CanonicalGraphContractError(
      `Asset transition intent ${delta.intent} has no schema-backed materialization rule.`,
    );
  }
  validateArtifactMaterialization(parent.artifacts, result.artifacts, delta.operations);
}

function isArtifactBindingIntent(intent: CanonicalDeltaIntent): boolean {
  return intent === "crop" || intent === "filter" || intent === "merge" || intent === "replace";
}

function validateArtifactMaterialization(
  parent: CanonicalArtifactBindingV1[],
  result: CanonicalArtifactBindingV1[],
  operations: CanonicalDeltaOperationV1[],
): void {
  const expected = new Map(parent.map((artifact) => [artifact.artifact_id, artifact]));
  for (const operation of operations) {
    if (operation.effect.kind !== "artifact_binding") {
      throw new CanonicalGraphContractError("Artifact transition operations must use artifact_binding effects.");
    }
    const changedIds = [...operation.effect.before, ...operation.effect.after].map((artifact) => artifact.artifact_id);
    if (!changedIds.includes(operation.target_id)) {
      throw new CanonicalGraphContractError("Artifact transition target_id must identify a before or after binding.");
    }
    for (const before of operation.effect.before) {
      const current = expected.get(before.artifact_id);
      if (!current || stableCanonicalJson(current) !== stableCanonicalJson(before)) {
        throw new CanonicalGraphContractError(`Artifact transition before state does not match ${before.artifact_id}.`);
      }
      expected.delete(before.artifact_id);
    }
    for (const after of operation.effect.after) {
      if (expected.has(after.artifact_id)) {
        throw new CanonicalGraphContractError(`Artifact transition after state collides with ${after.artifact_id}.`);
      }
      expected.set(after.artifact_id, after);
    }
  }
  assertKeyedCollectionEqual(
    [...expected.values()], result, (artifact) => artifact.artifact_id, "Artifact transition result",
  );
}

function validateTransformMaterialization(
  parent: CanonicalTransformGraphV1,
  result: CanonicalTransformGraphV1,
  operations: CanonicalDeltaOperationV1[],
): void {
  if (parent.root_frame_id !== result.root_frame_id) {
    throw new CanonicalGraphContractError("Transform transition cannot replace the root frame.");
  }
  assertKeyedCollectionEqual(parent.nodes, result.nodes, (node) => node.frame_id, "Transform transition nodes");
  const expected = new Map(parent.edges.map((edge) => [edge.transform_id, edge]));
  for (const operation of operations) {
    if (operation.effect.kind !== "transform_edge" || !operation.effect.before || !operation.effect.after) {
      throw new CanonicalGraphContractError("Transform transition operations require non-null transform_edge snapshots.");
    }
    const before = operation.effect.before;
    const after = operation.effect.after;
    if (before.source_class !== "manual_edit" || after.source_class !== "manual_edit") {
      throw new CanonicalGraphContractError(
        "Transform transitions may edit only manual_edit edges; calibration and registration edges are immutable.",
      );
    }
    if (operation.target_id !== before.transform_id && operation.target_id !== after.transform_id) {
      throw new CanonicalGraphContractError("Transform transition target_id must identify its before or after edge.");
    }
    const current = expected.get(before.transform_id);
    if (!current || stableCanonicalJson(current) !== stableCanonicalJson(before)) {
      throw new CanonicalGraphContractError(`Transform transition before state does not match ${before.transform_id}.`);
    }
    expected.delete(before.transform_id);
    if (expected.has(after.transform_id)) {
      throw new CanonicalGraphContractError(`Transform transition after state collides with ${after.transform_id}.`);
    }
    expected.set(after.transform_id, after);
  }
  assertKeyedCollectionEqual([...expected.values()], result.edges, (edge) => edge.transform_id, "Transform transition result");
}

function validateMembershipMaterialization(
  parent: CanonicalVersionedManifestReferenceV1[],
  result: CanonicalVersionedManifestReferenceV1[],
  operations: CanonicalDeltaOperationV1[],
): void {
  const expected = new Map(parent.map((asset) => [asset.revision.id, asset]));
  const resultById = new Map(result.map((asset) => [asset.revision.id, asset]));
  for (const operation of operations) {
    if (operation.effect.kind !== "membership") {
      throw new CanonicalGraphContractError("Membership transition operations must use membership effects.");
    }
    const changedIds = [...operation.effect.before, ...operation.effect.after].map((reference) => reference.id);
    if (!changedIds.includes(operation.target_id)) {
      throw new CanonicalGraphContractError("Membership transition target_id must identify a before or after member.");
    }
    assertUnique(operation.effect.before.map((reference) => reference.id), "Membership before ids");
    assertUnique(operation.effect.after.map((reference) => reference.id), "Membership after ids");
    for (const before of operation.effect.before) {
      const current = expected.get(before.id);
      if (!current || stableCanonicalJson(current.revision) !== stableCanonicalJson(before)) {
        throw new CanonicalGraphContractError(`Membership transition before state does not match ${before.id}.`);
      }
      expected.delete(before.id);
    }
    for (const after of operation.effect.after) {
      if (expected.has(after.id)) {
        throw new CanonicalGraphContractError(`Membership transition after state collides with ${after.id}.`);
      }
      const materialized = resultById.get(after.id);
      if (!materialized || stableCanonicalJson(materialized.revision) !== stableCanonicalJson(after)) {
        throw new CanonicalGraphContractError(`Membership transition result does not materialize ${after.id}.`);
      }
      expected.set(after.id, materialized);
    }
  }
  assertKeyedCollectionEqual(
    [...expected.values()], result, (asset) => asset.revision.id, "Membership transition result",
  );
}

function validateManifestAuthorityTransition(
  parent: CanonicalAuthorityV1[],
  result: CanonicalAuthorityV1[],
  evidenceMap: Map<string, string[]>,
  label: string,
): void {
  const parentByDomain = new Map(parent.map((authority) => [authority.domain, authority]));
  const resultByDomain = new Map(result.map((authority) => [authority.domain, authority]));
  if (parentByDomain.size !== resultByDomain.size
    || [...parentByDomain.keys()].some((domain) => !resultByDomain.has(domain))) {
    throw new CanonicalGraphContractError(`${label} cannot add or remove authority domains.`);
  }
  for (const [domain, before] of parentByDomain) {
    const after = resultByDomain.get(domain)!;
    if (after.status !== before.status) {
      throw new CanonicalGraphContractError(`${label} cannot change ${domain} authority status.`);
    }
    assertStringSetEqual(before.approved_for, after.approved_for, `${label} ${domain} approved_for`);
    assertStringSubset(before.not_approved_for, after.not_approved_for, `${label} ${domain} not_approved_for`);
    assertStringSubset(before.limitations, after.limitations, `${label} ${domain} limitations`);
    assertStringSetEqual(
      mapEvidenceIds(before.evidence_artifact_ids, evidenceMap),
      after.evidence_artifact_ids,
      `${label} ${domain} evidence_artifact_ids`,
    );
  }
}

function validateReadinessTransition(
  parent: CanonicalReadinessV1,
  result: CanonicalReadinessV1,
  evidenceMap: Map<string, string[]>,
  operations: CanonicalDeltaOperationV1[],
  label: string,
): void {
  for (const lane of READINESS_LANES) {
    const before = parent[lane];
    const after = result[lane];
    if (after.status !== before.status) {
      throw new CanonicalGraphContractError(`${label} cannot change ${lane} status under authority_effect none.`);
    }
    assertStringSetEqual(
      mapEvidenceIds(before.evidence_artifact_ids, evidenceMap),
      after.evidence_artifact_ids,
      `${label} ${lane} evidence_artifact_ids`,
    );
    if (!reportChangeIsRepresented(before.report, after.report, lane, operations)) {
      throw new CanonicalGraphContractError(`${label} ${lane} report cannot change without a declared artifact effect.`);
    }
    assertStringSubset(before.limitations, after.limitations, `${label} ${lane} limitations`);
  }
}

function reportChangeIsRepresented(
  before: CanonicalContentReferenceV1 | null,
  after: CanonicalContentReferenceV1 | null,
  lane: keyof CanonicalReadinessV1,
  operations: CanonicalDeltaOperationV1[],
): boolean {
  if (stableCanonicalJson(before) === stableCanonicalJson(after)) return true;
  for (const operation of operations) {
    if (operation.effect.kind !== "artifact_binding") continue;
    const beforeReports = operation.effect.before
      .filter((artifact) => artifact.role === "validation_report" && artifact.authority.domain === lane)
      .map((artifact) => artifact.content);
    const afterReports = operation.effect.after
      .filter((artifact) => artifact.role === "validation_report" && artifact.authority.domain === lane)
      .map((artifact) => artifact.content);
    const bindsBefore = before === null
      ? beforeReports.length === 0
      : beforeReports.some((content) => stableCanonicalJson(content) === stableCanonicalJson(before));
    const bindsAfter = after === null
      ? afterReports.length === 0
      : afterReports.some((content) => stableCanonicalJson(content) === stableCanonicalJson(after));
    if (bindsBefore && bindsAfter) return true;
  }
  return false;
}

function assertCaptureArtifactsEqual(
  parent: CanonicalArtifactBindingV1[],
  result: CanonicalArtifactBindingV1[],
): void {
  assertKeyedCollectionEqual(
    parent.filter((artifact) => IMMUTABLE_CAPTURE_ROLES.has(artifact.role)),
    result.filter((artifact) => IMMUTABLE_CAPTURE_ROLES.has(artifact.role)),
    (artifact) => artifact.artifact_id,
    "Transition must preserve capture artifacts byte-for-byte",
  );
}

function buildArtifactEvidenceMap(operations: CanonicalDeltaOperationV1[]): Map<string, string[]> {
  const mapping = new Map<string, string[]>();
  for (const operation of operations) {
    if (operation.effect.kind !== "artifact_binding") continue;
    const afterIds = operation.effect.after.map((artifact) => artifact.artifact_id);
    for (const before of operation.effect.before) mapping.set(before.artifact_id, afterIds);
  }
  return mapping;
}

function mapEvidenceIds(values: string[], mapping: Map<string, string[]>): string[] {
  return [...new Set(values.flatMap((value) => mapping.get(value) ?? [value]))];
}

function assertStringSetEqual(parent: string[], result: string[], label: string): void {
  if (parent.length !== result.length || parent.some((value) => !result.includes(value))) {
    throw new CanonicalGraphContractError(`${label} must match after declared replacements.`);
  }
}

function assertStringSubset(parent: string[], result: string[], label: string): void {
  if (parent.some((value) => !result.includes(value))) {
    throw new CanonicalGraphContractError(`${label} cannot remove existing restrictions.`);
  }
}

function validateResultProvenanceParent(
  provenance: CanonicalProvenanceV1,
  parent: CanonicalVersionReferenceV1,
  label: string,
): void {
  if (!provenance.input_versions.some((reference) => stableCanonicalJson(reference) === stableCanonicalJson(parent))) {
    throw new CanonicalGraphContractError(`${label} must include the exact parent version and checksum.`);
  }
}

function assertTransformGraphsEqual(
  parent: CanonicalTransformGraphV1,
  result: CanonicalTransformGraphV1,
  label: string,
): void {
  if (parent.root_frame_id !== result.root_frame_id) {
    throw new CanonicalGraphContractError(`${label} root_frame_id must not change.`);
  }
  assertKeyedCollectionEqual(parent.nodes, result.nodes, (node) => node.frame_id, `${label} nodes`);
  assertKeyedCollectionEqual(parent.edges, result.edges, (edge) => edge.transform_id, `${label} edges`);
}

function assertKeyedCollectionEqual<T>(
  parent: T[],
  result: T[],
  key: (value: T) => string,
  label: string,
): void {
  const parentByKey = new Map(parent.map((value) => [key(value), value]));
  const resultByKey = new Map(result.map((value) => [key(value), value]));
  if (parentByKey.size !== parent.length || resultByKey.size !== result.length
    || parentByKey.size !== resultByKey.size) {
    throw new CanonicalGraphContractError(`${label} does not match.`);
  }
  for (const [id, value] of parentByKey) {
    const next = resultByKey.get(id);
    if (!next || stableCanonicalJson(value) !== stableCanonicalJson(next)) {
      throw new CanonicalGraphContractError(`${label} does not match ${id}.`);
    }
  }
}

function assertCanonicalEqual(parent: unknown, result: unknown, label: string): void {
  if (stableCanonicalJson(parent) !== stableCanonicalJson(result)) {
    throw new CanonicalGraphContractError(`${label}.`);
  }
}

function canonicalJsonValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return validUnicodeString(value, "Canonical JSON string");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalGraphContractError("Canonical JSON cannot contain non-finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new CanonicalGraphContractError("Canonical JSON cannot contain undefined or non-JSON values.");
  }
  if (ancestors.has(value)) throw new CanonicalGraphContractError("Canonical JSON cannot contain cycles.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw new CanonicalGraphContractError("Canonical JSON objects must be plain objects.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new CanonicalGraphContractError("Canonical JSON arrays must not contain sparse entries.");
        }
        result.push(canonicalJsonValue(value[index], ancestors));
      }
      return result;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalGraphContractError("Canonical JSON objects cannot contain symbol keys.");
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareCodePoints)) {
      validUnicodeString(key, "Canonical JSON object key");
      result[key] = canonicalJsonValue(source[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function assertCanonicalJsonValue(value: unknown, ancestors: Set<object>): void {
  canonicalJsonValue(value, ancestors);
}

function serializeCanonicalValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serializeCanonicalValue).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort(compareCodePoints).map((key) =>
    `${JSON.stringify(key)}:${serializeCanonicalValue(source[key])}`).join(",")}}`;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const count = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < count; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function validUnicodeString(value: string, label: string): string {
  if (hasUnpairedSurrogate(value)) {
    throw new CanonicalGraphContractError(`${label} contains an unpaired Unicode surrogate.`);
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.length || utf8Encoder.encode(value).byteLength > maxBytes) {
    throw new CanonicalGraphContractError(`${label} must be a non-empty string within ${maxBytes} UTF-8 bytes.`);
  }
  if (value.includes("\0") || /[\r\n]/.test(value) || hasUnpairedSurrogate(value)) {
    throw new CanonicalGraphContractError(`${label} contains unsupported characters.`);
  }
  return value;
}

function validIdentifier(value: unknown, label: string): string {
  const text = validString(value, label, 128);
  if (!identifierPattern.test(text)) throw new CanonicalGraphContractError(`${label} has an invalid identifier.`);
  return text;
}

function validMediaType(value: unknown, label: string): string {
  const text = validString(value, label, 128);
  if (!mediaTypePattern.test(text)) throw new CanonicalGraphContractError(`${label} is not a canonical media type.`);
  return text;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CanonicalGraphContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort(compareCodePoints);
  const actual = Object.keys(value).sort(compareCodePoints);
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new CanonicalGraphContractError(`${label} must contain exactly: ${keys.join(", ")}.`);
  }
}

function boundedArray(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new CanonicalGraphContractError(`${label} must contain ${minimum} to ${maximum} items.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new CanonicalGraphContractError(`${label} must not contain sparse entries.`);
    }
  }
  return value;
}

function literal<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new CanonicalGraphContractError(`${label} must equal ${expected}.`);
  return expected;
}

function literalOneOf<T extends string>(value: unknown, expected: readonly T[], label: string): T {
  if (typeof value !== "string" || !expected.includes(value as T)) {
    throw new CanonicalGraphContractError(`${label} must be one of ${expected.join(", ")}.`);
  }
  return value as T;
}

function boundedFinite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CanonicalGraphContractError(`${label} must be finite and between ${minimum} and ${maximum}.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CanonicalGraphContractError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new CanonicalGraphContractError(`${label} must not contain duplicates.`);
  }
}

const REVISION_KINDS = ["world", "asset"] as const;
const DELTA_INTENTS = ["crop", "transform", "filter", "merge", "hide", "replace", "objectize", "annotate"] as const;
const AUTHORITY_DOMAINS = [
  "capture", "calibration", "visual", "metric", "collision", "navigation", "semantic",
  "articulation", "physics", "task", "deployment",
] as const;
const AUTHORITY_STATUSES = ["proposal", "validated", "promoted", "held", "rejected"] as const;
const READINESS_STATUSES = ["unavailable", ...AUTHORITY_STATUSES] as const;
const AXES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const;
const ARTIFACT_ROLES = [
  "source_manifest", "evidence_rgb", "evidence_depth", "evidence_confidence", "evidence_mask", "camera_poses",
  "visual_splat", "visual_mesh", "visual_texture", "metric_points", "metric_mesh", "collision_mesh", "occupancy",
  "navigation_graph", "semantics", "articulation", "physics_parameters", "validation_report", "episode", "annotation",
] as const;
const IMMUTABLE_CAPTURE_ROLES = new Set<CanonicalArtifactRole>([
  "source_manifest", "evidence_rgb", "evidence_depth", "evidence_confidence", "evidence_mask", "camera_poses",
]);
const QUANTITY_UNITS = ["m", "rad", "m/s", "m/s^2", "kg", "N", "N*m", "dimensionless"] as const;
const TRANSFORM_SOURCES = [
  "sensor_calibration", "fiducial_alignment", "registration", "manual_edit", "simulator_export",
] as const;
const READINESS_LANES = ["visual", "metric", "collision", "navigation", "semantic", "articulation", "physics"] as const;

function validateUnits(value: unknown, label: string): CanonicalUnitsV1 {
  const units = record(value, label);
  exactKeys(units, ["length", "mass", "time", "angle", "force", "torque"], label);
  literal(units.length, "m", `${label} length`);
  literal(units.mass, "kg", `${label} mass`);
  literal(units.time, "s", `${label} time`);
  literal(units.angle, "rad", `${label} angle`);
  literal(units.force, "N", `${label} force`);
  literal(units.torque, "N*m", `${label} torque`);
  return units as unknown as CanonicalUnitsV1;
}

function validateManifestLineage(
  kind: "world" | "asset",
  id: string,
  versionIdValue: unknown,
  versionValue: unknown,
  parentValue: unknown,
  appliedDeltaValue: unknown,
  label: string,
): number {
  const versionId = validIdentifier(versionIdValue, `${label} version_id`);
  const version = boundedInteger(versionValue, `${label} version`, 1, 2_147_483_647);
  if (version === 1) {
    if (parentValue !== null || appliedDeltaValue !== null) {
      throw new CanonicalGraphContractError(`${label} version 1 must have null parent and applied_delta.`);
    }
    return version;
  }
  if (parentValue === null || appliedDeltaValue === null) {
    throw new CanonicalGraphContractError(`${label} child versions require parent and applied_delta.`);
  }
  const parent = validateVersionReference(parentValue, `${label} parent`);
  if (parent.kind !== kind || parent.id !== id || parent.version !== version - 1) {
    throw new CanonicalGraphContractError(`${label} parent must be the immediately preceding ${kind} version.`);
  }
  if (parent.version_id === versionId) {
    throw new CanonicalGraphContractError(`${label} parent and child version_id must differ.`);
  }
  validateDeltaReference(appliedDeltaValue, `${label} applied_delta`);
  return version;
}

function validateContentReference(value: unknown, label: string): CanonicalContentReferenceV1 {
  const reference = record(value, label);
  exactKeys(reference, ["path", "sha256", "size_bytes", "media_type"], label);
  safeCanonicalRelativePath(reference.path, `${label} path`);
  validateCanonicalSha256(reference.sha256, `${label} sha256`);
  boundedInteger(reference.size_bytes, `${label} size_bytes`, 0, Number.MAX_SAFE_INTEGER);
  validMediaType(reference.media_type, `${label} media_type`);
  return reference as unknown as CanonicalContentReferenceV1;
}

function validateVersionReference(value: unknown, label: string): CanonicalVersionReferenceV1 {
  const reference = record(value, label);
  exactKeys(reference, ["kind", "id", "version_id", "version", "manifest_sha256"], label);
  literalOneOf(reference.kind, REVISION_KINDS, `${label} kind`);
  validIdentifier(reference.id, `${label} id`);
  validIdentifier(reference.version_id, `${label} version_id`);
  boundedInteger(reference.version, `${label} version`, 1, 2_147_483_647);
  validateCanonicalSha256(reference.manifest_sha256, `${label} manifest_sha256`);
  return reference as unknown as CanonicalVersionReferenceV1;
}

function validateResultVersionIdentity(value: unknown, label: string): CanonicalResultVersionIdentityV1 {
  const identity = record(value, label);
  exactKeys(identity, ["kind", "id", "version_id", "version"], label);
  literalOneOf(identity.kind, REVISION_KINDS, `${label} kind`);
  validIdentifier(identity.id, `${label} id`);
  validIdentifier(identity.version_id, `${label} version_id`);
  boundedInteger(identity.version, `${label} version`, 1, 2_147_483_647);
  return identity as unknown as CanonicalResultVersionIdentityV1;
}

function validateDeltaReference(value: unknown, label: string): CanonicalDeltaReferenceV1 {
  const reference = record(value, label);
  exactKeys(reference, ["delta_id", "manifest"], label);
  validIdentifier(reference.delta_id, `${label} delta_id`);
  validateContentReference(reference.manifest, `${label} manifest`);
  return reference as unknown as CanonicalDeltaReferenceV1;
}

function validateVersionedManifests(value: unknown, expectedKind: CanonicalRevisionKind, label: string): CanonicalVersionedManifestReferenceV1[] {
  const references = boundedArray(value, label, 0, 65_536).map((item, index) => {
    const entry = record(item, `${label}[${index}]`);
    exactKeys(entry, ["revision", "manifest"], `${label}[${index}]`);
    const revision = validateVersionReference(entry.revision, `${label}[${index}] revision`);
    if (revision.kind !== expectedKind) throw new CanonicalGraphContractError(`${label} must reference only ${expectedKind} versions.`);
    const manifest = validateContentReference(entry.manifest, `${label}[${index}] manifest`);
    if (revision.manifest_sha256 !== manifest.sha256) {
      throw new CanonicalGraphContractError(`${label} revision hash must match its manifest content hash.`);
    }
    return entry as unknown as CanonicalVersionedManifestReferenceV1;
  });
  assertUnique(references.map((entry) => entry.revision.id), `${label} revision ids`);
  assertUnique(references.map((entry) => entry.revision.version_id), `${label} version ids`);
  assertUnique(references.map((entry) => entry.manifest.path), `${label} manifest paths`);
  return references;
}

function validateStringArray(value: unknown, label: string, minimum: number, maximum: number, identifiers: boolean): string[] {
  const result = boundedArray(value, label, minimum, maximum).map((item, index) =>
    identifiers ? validIdentifier(item, `${label}[${index}]`) : validString(item, `${label}[${index}]`, 1_024));
  assertUnique(result, label);
  return result;
}

function validateAuthority(value: unknown, knownArtifacts: Set<string> | null, label: string): CanonicalAuthorityV1 {
  const authority = record(value, label);
  exactKeys(authority, ["domain", "status", "approved_for", "not_approved_for", "limitations", "evidence_artifact_ids"], label);
  literalOneOf(authority.domain, AUTHORITY_DOMAINS, `${label} domain`);
  literalOneOf(authority.status, AUTHORITY_STATUSES, `${label} status`);
  const approved = validateStringArray(authority.approved_for, `${label} approved_for`, 0, 128, true);
  const denied = validateStringArray(authority.not_approved_for, `${label} not_approved_for`, 1, 128, true);
  validateStringArray(authority.limitations, `${label} limitations`, 1, 128, false);
  const evidence = validateStringArray(authority.evidence_artifact_ids, `${label} evidence_artifact_ids`, 0, 65_536, true);
  if (approved.some((purpose) => denied.includes(purpose))) {
    throw new CanonicalGraphContractError(`${label} cannot approve and deny the same purpose.`);
  }
  const restrictedPurposes: Partial<Record<string, CanonicalAuthorityDomain>> = {
    measurement: "metric", metric: "metric", collision: "collision", navigation: "navigation",
    semantic_ground_truth: "semantic", semantic: "semantic", articulation: "articulation",
    physics: "physics", deployment: "deployment",
  };
  for (const purpose of approved) {
    const requiredDomain = restrictedPurposes[purpose];
    if (requiredDomain && (authority.domain !== requiredDomain || authority.status !== "promoted")) {
      throw new CanonicalGraphContractError(`${label} can approve restricted domain ${purpose} only with matching promoted authority.`);
    }
  }
  assertKnownArtifacts(evidence, knownArtifacts, `${label} evidence_artifact_ids`);
  return authority as unknown as CanonicalAuthorityV1;
}

function validateAuthorities(value: unknown, knownArtifacts: Set<string>, label: string): CanonicalAuthorityV1[] {
  const authorities = boundedArray(value, label, 1, 32).map((item, index) =>
    validateAuthority(item, knownArtifacts, `${label}[${index}]`));
  assertUnique(authorities.map((authority) => authority.domain), `${label} domains`);
  return authorities;
}

function validateUncertainty(value: unknown, knownArtifacts: Set<string> | null, label: string): CanonicalUncertaintyV1 {
  const uncertainty = record(value, label);
  if (uncertainty.status === "unknown") {
    exactKeys(uncertainty, ["status", "reason"], label);
    validString(uncertainty.reason, `${label} reason`, 1_024);
    return uncertainty as unknown as CanonicalUncertaintyV1;
  }
  exactKeys(uncertainty, ["status", "quantity", "unit", "lower", "upper", "confidence", "method", "evidence_artifact_ids"], label);
  literal(uncertainty.status, "bounded", `${label} status`);
  validIdentifier(uncertainty.quantity, `${label} quantity`);
  literalOneOf(uncertainty.unit, QUANTITY_UNITS, `${label} unit`);
  const lower = boundedFinite(uncertainty.lower, `${label} lower`, -1e12, 1e12);
  const upper = boundedFinite(uncertainty.upper, `${label} upper`, -1e12, 1e12);
  if (lower > upper) throw new CanonicalGraphContractError(`${label} lower must not exceed upper.`);
  boundedFinite(uncertainty.confidence, `${label} confidence`, 0, 1);
  validString(uncertainty.method, `${label} method`, 1_024);
  const evidence = validateStringArray(uncertainty.evidence_artifact_ids, `${label} evidence_artifact_ids`, 0, 65_536, true);
  assertKnownArtifacts(evidence, knownArtifacts, `${label} evidence_artifact_ids`);
  return uncertainty as unknown as CanonicalUncertaintyV1;
}

function validateProvenance(value: unknown, knownArtifacts: Set<string> | null, label: string): CanonicalProvenanceV1 {
  const provenance = record(value, label);
  exactKeys(provenance, ["producer", "producer_version", "created_at", "run_id", "input_artifact_ids", "input_versions"], label);
  validIdentifier(provenance.producer, `${label} producer`);
  validString(provenance.producer_version, `${label} producer_version`, 128);
  validateCanonicalTimestamp(provenance.created_at, `${label} created_at`);
  if (provenance.run_id !== null) validIdentifier(provenance.run_id, `${label} run_id`);
  const inputArtifacts = validateStringArray(provenance.input_artifact_ids, `${label} input_artifact_ids`, 0, 65_536, true);
  assertKnownArtifacts(inputArtifacts, knownArtifacts, `${label} input_artifact_ids`);
  const inputVersions = boundedArray(provenance.input_versions, `${label} input_versions`, 0, 4_096).map((item, index) =>
    validateVersionReference(item, `${label} input_versions[${index}]`));
  assertDeepUnique(inputVersions, `${label} input_versions`);
  return provenance as unknown as CanonicalProvenanceV1;
}

function validateCoordinateFrame(value: unknown, label: string): CanonicalCoordinateFrameV1 {
  const frame = record(value, label);
  exactKeys(frame, ["frame_id", "handedness", "up_axis", "forward_axis"], label);
  validIdentifier(frame.frame_id, `${label} frame_id`);
  literalOneOf(frame.handedness, ["right", "left"] as const, `${label} handedness`);
  const up = literalOneOf(frame.up_axis, AXES, `${label} up_axis`);
  const forward = literalOneOf(frame.forward_axis, AXES, `${label} forward_axis`);
  if (up.slice(1) === forward.slice(1)) {
    throw new CanonicalGraphContractError(`${label} up_axis and forward_axis must be different axes.`);
  }
  return frame as unknown as CanonicalCoordinateFrameV1;
}

function validateTransformEdge(value: unknown, label: string): CanonicalTransformEdgeV1 {
  const edge = record(value, label);
  exactKeys(edge, [
    "transform_id", "parent_frame", "child_frame", "kind", "convention", "matrix_row_major", "source_class",
    "authority", "uncertainty", "provenance",
  ], label);
  validIdentifier(edge.transform_id, `${label} transform_id`);
  validIdentifier(edge.parent_frame, `${label} parent_frame`);
  validIdentifier(edge.child_frame, `${label} child_frame`);
  const kind = literalOneOf(edge.kind, ["rigid", "similarity"] as const, `${label} kind`);
  literal(edge.convention, "parent_from_child_column_vector", `${label} convention`);
  const matrix = boundedArray(edge.matrix_row_major, `${label} matrix_row_major`, 16, 16).map((entry, index) =>
    boundedFinite(entry, `${label} matrix_row_major[${index}]`, -1e12, 1e12));
  validateRigidOrSimilarityMatrix(matrix, kind, `${label} matrix_row_major`);
  literalOneOf(edge.source_class, TRANSFORM_SOURCES, `${label} source_class`);
  validateAuthority(edge.authority, null, `${label} authority`);
  validateUncertainty(edge.uncertainty, null, `${label} uncertainty`);
  validateProvenance(edge.provenance, null, `${label} provenance`);
  return edge as unknown as CanonicalTransformEdgeV1;
}

function validateRigidOrSimilarityMatrix(matrix: number[], kind: "rigid" | "similarity", label: string): void {
  const close = (left: number, right: number, tolerance = 1e-6) => Math.abs(left - right) <= tolerance;
  if (!close(matrix[12]!, 0) || !close(matrix[13]!, 0) || !close(matrix[14]!, 0) || !close(matrix[15]!, 1)) {
    throw new CanonicalGraphContractError(`${label} must be affine with final row [0, 0, 0, 1].`);
  }
  const columns = [
    [matrix[0]!, matrix[4]!, matrix[8]!],
    [matrix[1]!, matrix[5]!, matrix[9]!],
    [matrix[2]!, matrix[6]!, matrix[10]!],
  ];
  const dot = (left: number[], right: number[]) => left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
  const squaredScales = columns.map((column) => dot(column, column));
  if (squaredScales.some((scale) => scale <= 1e-18)
    || !close(dot(columns[0]!, columns[1]!), 0)
    || !close(dot(columns[0]!, columns[2]!), 0)
    || !close(dot(columns[1]!, columns[2]!), 0)
    || !close(squaredScales[0]!, squaredScales[1]!)
    || !close(squaredScales[0]!, squaredScales[2]!)) {
    throw new CanonicalGraphContractError(`${label} must encode a rigid or uniform-similarity transform without shear.`);
  }
  if (kind === "rigid" && !close(squaredScales[0]!, 1)) {
    throw new CanonicalGraphContractError(`${label} rigid transforms must have unit scale.`);
  }
  const determinant = linearDeterminant(matrix);
  if (Math.abs(determinant) <= 1e-12) throw new CanonicalGraphContractError(`${label} must be invertible.`);
}

function linearDeterminant(matrix: readonly number[]): number {
  return matrix[0]! * (matrix[5]! * matrix[10]! - matrix[6]! * matrix[9]!)
    - matrix[1]! * (matrix[4]! * matrix[10]! - matrix[6]! * matrix[8]!)
    + matrix[2]! * (matrix[4]! * matrix[9]! - matrix[5]! * matrix[8]!);
}

function validateTransformGraph(value: unknown, label: string): CanonicalTransformGraphV1 {
  const graph = record(value, label);
  exactKeys(graph, ["root_frame_id", "nodes", "edges"], label);
  const root = validIdentifier(graph.root_frame_id, `${label} root_frame_id`);
  const nodes = boundedArray(graph.nodes, `${label} nodes`, 1, 65_536).map((node, index) =>
    validateCoordinateFrame(node, `${label} nodes[${index}]`));
  const nodeIds = nodes.map((node) => node.frame_id);
  assertUnique(nodeIds, `${label} node frame_id values`);
  const knownNodes = new Set(nodeIds);
  const nodeHandedness = new Map(nodes.map((node) => [node.frame_id, node.handedness]));
  if (!knownNodes.has(root)) throw new CanonicalGraphContractError(`${label} root_frame_id must identify a node.`);
  const edges = boundedArray(graph.edges, `${label} edges`, 0, 131_072).map((edge, index) =>
    validateTransformEdge(edge, `${label} edges[${index}]`));
  assertUnique(edges.map((edge) => edge.transform_id), `${label} transform_id values`);
  const incoming = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!knownNodes.has(edge.parent_frame) || !knownNodes.has(edge.child_frame)) {
      throw new CanonicalGraphContractError(`${label} transform endpoints must identify known nodes.`);
    }
    if (edge.parent_frame === edge.child_frame) throw new CanonicalGraphContractError(`${label} transforms cannot be self edges.`);
    const sameHandedness = nodeHandedness.get(edge.parent_frame) === nodeHandedness.get(edge.child_frame);
    const determinant = linearDeterminant(edge.matrix_row_major);
    if ((sameHandedness && determinant <= 0) || (!sameHandedness && determinant >= 0)) {
      throw new CanonicalGraphContractError(
        `${label} transform determinant sign must match endpoint handedness.`,
      );
    }
    incoming.set(edge.child_frame, (incoming.get(edge.child_frame) ?? 0) + 1);
    if (incoming.get(edge.child_frame)! > 1) throw new CanonicalGraphContractError(`${label} nodes cannot have multiple parents.`);
    const childList = children.get(edge.parent_frame);
    if (childList) childList.push(edge.child_frame);
    else children.set(edge.parent_frame, [edge.child_frame]);
  }
  if ((incoming.get(root) ?? 0) !== 0) throw new CanonicalGraphContractError(`${label} root node cannot have a parent.`);
  detectTransformCycles(nodeIds, children, incoming, label);
  const reachable = new Set<string>();
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const child of children.get(current) ?? []) pending.push(child);
  }
  if (reachable.size !== nodes.length) throw new CanonicalGraphContractError(`${label} must be connected from its root.`);
  return graph as unknown as CanonicalTransformGraphV1;
}

function detectTransformCycles(
  nodes: string[],
  children: Map<string, string[]>,
  incoming: Map<string, number>,
  label: string,
): void {
  const remainingIncoming = new Map(nodes.map((node) => [node, incoming.get(node) ?? 0]));
  const pending = nodes.filter((node) => remainingIncoming.get(node) === 0);
  let visited = 0;
  while (pending.length) {
    const node = pending.pop()!;
    visited += 1;
    for (const child of children.get(node) ?? []) {
      const next = remainingIncoming.get(child)! - 1;
      remainingIncoming.set(child, next);
      if (next === 0) pending.push(child);
    }
  }
  if (visited !== nodes.length) throw new CanonicalGraphContractError(`${label} cannot contain transform cycles.`);
}

function validateArtifact(value: unknown, label: string): CanonicalArtifactBindingV1 {
  const artifact = record(value, label);
  exactKeys(artifact, ["artifact_id", "role", "content", "frame_id", "transform_id", "authority", "uncertainty", "provenance"], label);
  validIdentifier(artifact.artifact_id, `${label} artifact_id`);
  const role = literalOneOf(artifact.role, ARTIFACT_ROLES, `${label} role`);
  validateContentReference(artifact.content, `${label} content`);
  validIdentifier(artifact.frame_id, `${label} frame_id`);
  if (artifact.transform_id !== null) validIdentifier(artifact.transform_id, `${label} transform_id`);
  const authority = validateAuthority(artifact.authority, null, `${label} authority`);
  validateArtifactAuthority(role, authority.domain, label);
  validateUncertainty(artifact.uncertainty, null, `${label} uncertainty`);
  validateProvenance(artifact.provenance, null, `${label} provenance`);
  return artifact as unknown as CanonicalArtifactBindingV1;
}

function validateArtifactAuthority(role: CanonicalArtifactRole, domain: CanonicalAuthorityDomain, label: string): void {
  const expected = artifactRoleDomain(role);
  if (expected && expected !== domain) {
    throw new CanonicalGraphContractError(`${label} role ${role} cannot claim ${domain} authority.`);
  }
}

function artifactRoleDomain(role: CanonicalArtifactRole): CanonicalAuthorityDomain | undefined {
  const expected: Partial<Record<CanonicalArtifactRole, CanonicalAuthorityDomain>> = {
    source_manifest: "capture", evidence_rgb: "capture", evidence_depth: "capture",
    evidence_confidence: "capture", evidence_mask: "capture", camera_poses: "calibration",
    visual_splat: "visual", visual_mesh: "visual", visual_texture: "visual",
    metric_points: "metric", metric_mesh: "metric", collision_mesh: "collision",
    occupancy: "navigation", navigation_graph: "navigation", semantics: "semantic",
    articulation: "articulation", physics_parameters: "physics", episode: "task", annotation: "semantic",
  };
  return expected[role];
}

function validateArtifacts(value: unknown, label: string, maximum: number, minimum = 0): CanonicalArtifactBindingV1[] {
  const artifacts = boundedArray(value, label, minimum, maximum).map((artifact, index) =>
    validateArtifact(artifact, `${label}[${index}]`));
  assertUnique(artifacts.map((artifact) => artifact.artifact_id), `${label} artifact_id values`);
  assertUnique(artifacts.map((artifact) => artifact.content.path), `${label} content paths`);
  return artifacts;
}

function validateArtifactGraphReferences(artifacts: CanonicalArtifactBindingV1[], graph: CanonicalTransformGraphV1, label: string): void {
  const frames = new Set(graph.nodes.map((node) => node.frame_id));
  const transforms = new Set(graph.edges.map((edge) => edge.transform_id));
  for (const artifact of artifacts) {
    if (!frames.has(artifact.frame_id)) throw new CanonicalGraphContractError(`${label} frame_id must reference a transform graph node.`);
    if (artifact.transform_id !== null && !transforms.has(artifact.transform_id)) {
      throw new CanonicalGraphContractError(`${label} transform_id must reference a transform graph edge.`);
    }
  }
  validateArtifactEvidenceReferences(artifacts, label);
}

function validateTransformEvidenceReferences(graph: CanonicalTransformGraphV1, known: Set<string>, label: string): void {
  for (const edge of graph.edges) {
    assertKnownArtifacts(edge.authority.evidence_artifact_ids, known, `${label} authority evidence`);
    if (edge.uncertainty.status === "bounded") {
      assertKnownArtifacts(edge.uncertainty.evidence_artifact_ids, known, `${label} uncertainty evidence`);
    }
    assertKnownArtifacts(edge.provenance.input_artifact_ids, known, `${label} provenance inputs`);
  }
}

function validateArtifactEvidenceReferences(artifacts: CanonicalArtifactBindingV1[], label: string): void {
  const known = new Set(artifacts.map((artifact) => artifact.artifact_id));
  for (const artifact of artifacts) {
    assertKnownArtifacts(artifact.authority.evidence_artifact_ids, known, `${label} authority evidence`);
    if (artifact.uncertainty.status === "bounded") {
      assertKnownArtifacts(artifact.uncertainty.evidence_artifact_ids, known, `${label} uncertainty evidence`);
    }
    assertKnownArtifacts(artifact.provenance.input_artifact_ids, known, `${label} provenance inputs`);
  }
}

function validateCaptureEvidence(value: unknown, artifacts: CanonicalArtifactBindingV1[], label: string): CanonicalCaptureEvidenceV1[] {
  const knownArtifacts = new Set(artifacts.map((artifact) => artifact.artifact_id));
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  const evidence = boundedArray(value, label, 1, 4_096).map((item, index) => {
    const capture = record(item, `${label}[${index}]`);
    exactKeys(capture, ["session_id", "manifest", "verification", "authority", "uncertainty"], `${label}[${index}]`);
    validIdentifier(capture.session_id, `${label}[${index}] session_id`);
    const manifest = validateContentReference(capture.manifest, `${label}[${index}] manifest`);
    literalOneOf(capture.verification, ["rehashed_bytes", "declared_checksum_reference_only"] as const, `${label}[${index}] verification`);
    const authority = validateAuthority(capture.authority, knownArtifacts, `${label}[${index}] authority`);
    if (authority.domain !== "capture") throw new CanonicalGraphContractError(`${label} entries must use capture authority.`);
    const bindsSourceManifest = authority.evidence_artifact_ids.some((artifactId) => {
      const artifact = artifactsById.get(artifactId);
      return artifact?.role === "source_manifest" && stableCanonicalJson(artifact.content) === stableCanonicalJson(manifest);
    });
    if (!bindsSourceManifest) {
      throw new CanonicalGraphContractError(`${label} entries must bind an identical source_manifest artifact.`);
    }
    validateUncertainty(capture.uncertainty, knownArtifacts, `${label}[${index}] uncertainty`);
    return capture as unknown as CanonicalCaptureEvidenceV1;
  });
  assertUnique(evidence.map((capture) => capture.session_id), `${label} session_id values`);
  return evidence;
}

function validateReadiness(
  value: unknown,
  artifacts: CanonicalArtifactBindingV1[],
  authorities: CanonicalAuthorityV1[],
  label: string,
): CanonicalReadinessV1 {
  const knownArtifacts = new Set(artifacts.map((artifact) => artifact.artifact_id));
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  const readiness = record(value, label);
  exactKeys(readiness, READINESS_LANES, label);
  for (const laneName of READINESS_LANES) {
    const lane = record(readiness[laneName], `${label} ${laneName}`);
    exactKeys(lane, ["status", "evidence_artifact_ids", "report", "limitations"], `${label} ${laneName}`);
    const status = literalOneOf(lane.status, READINESS_STATUSES, `${label} ${laneName} status`);
    const evidence = validateStringArray(lane.evidence_artifact_ids, `${label} ${laneName} evidence_artifact_ids`, 0, 65_536, true);
    assertKnownArtifacts(evidence, knownArtifacts, `${label} ${laneName} evidence_artifact_ids`);
    if (lane.report !== null) validateContentReference(lane.report, `${label} ${laneName} report`);
    validateStringArray(lane.limitations, `${label} ${laneName} limitations`, 0, 128, false);
    if (status === "unavailable" && (evidence.length > 0 || lane.report !== null)) {
      throw new CanonicalGraphContractError(`${label} ${laneName} unavailable state cannot cite evidence or a report.`);
    }
    if ((status === "validated" || status === "promoted") && evidence.length === 0) {
      throw new CanonicalGraphContractError(`${label} ${laneName} ${status} state requires evidence.`);
    }
    if (status === "validated" || status === "promoted") {
      const artifactSupportsLane = evidence.some((artifactId) => {
        const artifact = artifactsById.get(artifactId);
        return artifact && artifactRoleDomain(artifact.role) === laneName
          && artifact.authority.domain === laneName
          && (artifact.authority.status === "validated" || artifact.authority.status === "promoted");
      });
      if (!artifactSupportsLane) {
        throw new CanonicalGraphContractError(`${label} ${laneName} ${status} state requires matching validated layer evidence.`);
      }
      const manifestAuthority = authorities.find((authority) => authority.domain === laneName);
      const authoritySupportsLane = status === "promoted"
        ? manifestAuthority?.status === "promoted"
        : manifestAuthority?.status === "validated" || manifestAuthority?.status === "promoted";
      if (!authoritySupportsLane) {
        throw new CanonicalGraphContractError(`${label} ${laneName} ${status} state requires matching manifest authority.`);
      }
    }
  }
  return readiness as unknown as CanonicalReadinessV1;
}

function validateDeltaOperation(value: unknown, intent: CanonicalDeltaIntent, label: string): CanonicalDeltaOperationV1 {
  const operation = record(value, label);
  exactKeys(operation, ["operation_id", "target_id", "effect"], label);
  validIdentifier(operation.operation_id, `${label} operation_id`);
  validIdentifier(operation.target_id, `${label} target_id`);
  const effect = record(operation.effect, `${label} effect`);
  exactKeys(effect, ["kind", "before", "after"], `${label} effect`);
  const requiredKind: Record<CanonicalDeltaIntent, CanonicalDeltaEffectV1["kind"]> = {
    crop: "artifact_binding", transform: "transform_edge", filter: "artifact_binding", merge: "artifact_binding",
    hide: "visibility", replace: "artifact_binding", objectize: "membership", annotate: "annotation",
  };
  literal(effect.kind, requiredKind[intent], `${label} effect kind`);
  switch (effect.kind) {
    case "artifact_binding": {
      const before = validateArtifacts(effect.before, `${label} effect before`, 65_536);
      const after = validateArtifacts(effect.after, `${label} effect after`, 65_536);
      if ([...before, ...after].some((artifact) => IMMUTABLE_CAPTURE_ROLES.has(artifact.role))) {
        throw new CanonicalGraphContractError(`${label} cannot mutate immutable capture evidence.`);
      }
      if ((intent === "crop" || intent === "filter") && before.length < 1) {
        throw new CanonicalGraphContractError(`${label} ${intent} intent requires at least one before binding.`);
      }
      if (intent === "merge" && (before.length < 2 || after.length < 1)) {
        throw new CanonicalGraphContractError(`${label} merge intent requires at least two before bindings and one after binding.`);
      }
      if (intent === "replace" && (before.length < 1 || after.length < 1)) {
        throw new CanonicalGraphContractError(`${label} replace intent requires non-empty before and after bindings.`);
      }
      const role = before[0]!.role;
      const domain = before[0]!.authority.domain;
      if ([...before, ...after].some((artifact) => artifact.role !== role || artifact.authority.domain !== domain)) {
        throw new CanonicalGraphContractError(
          `${label} artifact_binding effects must remain within one artifact role and authority domain.`,
        );
      }
      validateAuthorityNotElevated(
        before.map((artifact) => artifact.authority),
        after.map((artifact) => artifact.authority),
        `${label} authority_effect`,
      );
      break;
    }
    case "transform_edge":
      if (effect.before === null || effect.after === null) {
        throw new CanonicalGraphContractError(`${label} transform intent requires non-null before and after edges.`);
      }
      if (effect.before !== null) validateTransformEdge(effect.before, `${label} effect before`);
      if (effect.after !== null) validateTransformEdge(effect.after, `${label} effect after`);
      validateAuthorityNotElevated(
        [record(effect.before, `${label} effect before`).authority as CanonicalAuthorityV1],
        [record(effect.after, `${label} effect after`).authority as CanonicalAuthorityV1],
        `${label} authority_effect`,
      );
      break;
    case "visibility":
      if (typeof effect.before !== "boolean" || typeof effect.after !== "boolean") {
        throw new CanonicalGraphContractError(`${label} visibility before and after must be booleans.`);
      }
      break;
    case "annotation":
      if (effect.before !== null) validateContentReference(effect.before, `${label} effect before`);
      if (effect.after !== null) validateContentReference(effect.after, `${label} effect after`);
      break;
    case "membership": {
      const before = boundedArray(effect.before, `${label} effect before`, 0, 65_536).map((item, index) =>
        validateVersionReference(item, `${label} effect before[${index}]`));
      const after = boundedArray(effect.after, `${label} effect after`, 0, 65_536).map((item, index) =>
        validateVersionReference(item, `${label} effect after[${index}]`));
      if ([...before, ...after].some((reference) => reference.kind !== "asset")) {
        throw new CanonicalGraphContractError(`${label} membership effects may contain only asset references.`);
      }
      assertDeepUnique(before, `${label} effect before`);
      assertDeepUnique(after, `${label} effect after`);
      break;
    }
  }
  if (stableCanonicalJson(effect.before) === stableCanonicalJson(effect.after)) {
    throw new CanonicalGraphContractError(`${label} must change state; before and after cannot be identical.`);
  }
  return operation as unknown as CanonicalDeltaOperationV1;
}

function validateNonOverlappingArtifactOperations(operations: CanonicalDeltaOperationV1[]): void {
  const touched = new Set<string>();
  for (const operation of operations) {
    if (operation.effect.kind !== "artifact_binding") continue;
    const operationIds = new Set(
      [...operation.effect.before, ...operation.effect.after].map((artifact) => artifact.artifact_id),
    );
    for (const artifactId of operationIds) {
      if (touched.has(artifactId)) {
        throw new CanonicalGraphContractError(
          `Delta artifact operations cannot chain or overlap artifact ${artifactId}.`,
        );
      }
      touched.add(artifactId);
    }
  }
}

function assertKnownArtifacts(values: readonly string[], known: Set<string> | null, label: string): void {
  if (!known) return;
  for (const value of values) {
    if (!known.has(value)) throw new CanonicalGraphContractError(`${label} references unknown artifact ${value}.`);
  }
}

function validateAuthorityNotElevated(
  before: CanonicalAuthorityV1[],
  after: CanonicalAuthorityV1[],
  label: string,
): void {
  const ranks: Record<CanonicalAuthorityStatus, number> = {
    rejected: 0, held: 1, proposal: 2, validated: 3, promoted: 4,
  };
  for (const next of after) {
    const prior = before.filter((authority) => authority.domain === next.domain);
    if (prior.length === 0) {
      throw new CanonicalGraphContractError(`${label} none cannot introduce a new authority domain.`);
    }
    const weakestRank = Math.min(...prior.map((authority) => ranks[authority.status]));
    if (ranks[next.status] > weakestRank) {
      throw new CanonicalGraphContractError(`${label} none cannot promote authority status.`);
    }
    const approvedBefore = new Set(prior.flatMap((authority) => authority.approved_for));
    if (next.approved_for.some((purpose) => !approvedBefore.has(purpose))) {
      throw new CanonicalGraphContractError(`${label} none cannot introduce approved uses.`);
    }
    const deniedBefore = new Set(prior.flatMap((authority) => authority.not_approved_for));
    if ([...deniedBefore].some((purpose) => !next.not_approved_for.includes(purpose))) {
      throw new CanonicalGraphContractError(`${label} none cannot remove explicit restrictions.`);
    }
  }
}

function assertDeepUnique(values: readonly unknown[], label: string): void {
  assertUnique(values.map((value) => stableCanonicalJson(value)), label);
}
