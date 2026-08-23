import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { stableCanonicalJson } from "@world-studio/world-core";
import {
  readChecksumBoundReducedColliderBundle,
  type VerifiedReducedColliderBundle,
} from "./reduced-collider-bundle.js";

const receiptSchema = "world_studio.reduced_collider_walk_validation.v0.1";
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const authorityKeys = [
  "collision_authority", "measurement_authority", "metric_authority", "navigation_authority",
  "newton_authority", "physics_authority", "quality_claim", "semantic_authority",
] as const;
const evidenceKeys = ["benchmark", "reducerReport", "probeReport", "candidate"] as const;

export interface ExternalReducedColliderRunInput {
  bundleRoot: string;
  benchmarkChecksum: string;
  receiptOutput: string;
}

export type ReducedColliderWalkValidator = (
  bundle: VerifiedReducedColliderBundle,
) => Promise<unknown>;

export interface ExternalReducedColliderHeldReceipt extends Record<string, unknown> {
  schema: typeof receiptSchema;
  decision: "hold";
}

export interface ExternalReducedColliderHeldRunResult {
  receipt: ExternalReducedColliderHeldReceipt;
  rapierValidationInvocations: 1;
}

interface ReservedOutput {
  requestedParent: string;
  canonicalParent: string;
  output: string;
  bundleRoot: string;
  handle: FileHandle;
  parentIdentity: InodeIdentity;
  fileIdentity: InodeIdentity;
}

interface InodeIdentity {
  device: bigint;
  inode: bigint;
}

export async function runExternalReducedColliderHeldValidation(
  input: ExternalReducedColliderRunInput,
  validateWalk: ReducedColliderWalkValidator,
): Promise<ExternalReducedColliderHeldRunResult> {
  if (
    !path.isAbsolute(input.bundleRoot)
    || !path.isAbsolute(input.receiptOutput)
    || !sha256Pattern.test(input.benchmarkChecksum)
  ) {
    throw new Error("Reduced collider bundle, checksum, and receipt output must be explicit");
  }

  const bundle = await readChecksumBoundReducedColliderBundle(
    input.bundleRoot,
    input.benchmarkChecksum,
  );
  const bundleFilesystemBefore = await snapshotBundleFilesystem(bundle);
  const authoritativeInvariant = bundleInvariant(bundle);
  const callbackBundle = cloneBundle(bundle);
  const callbackInvariant = bundleInvariant(callbackBundle);
  let reservation: ReservedOutput | undefined;

  try {
    reservation = await reserveOutput(input.receiptOutput, bundle.root);
    let invocations = 0;
    invocations += 1;
    const rawReceipt = await validateWalk(callbackBundle);
    if (invocations !== 1) throw new Error("Rapier validator must be invoked exactly once");

    await assertReservation(reservation, 0);
    if (bundleInvariant(bundle) !== authoritativeInvariant) {
      throw new Error("Authoritative reduced collider bundle changed during Rapier validation");
    }
    if (bundleInvariant(callbackBundle) !== callbackInvariant) {
      throw new Error("Rapier validator mutated its isolated reduced collider input");
    }
    const bundleFilesystemAfter = await snapshotBundleFilesystem(bundle);
    if (stableCanonicalJson(bundleFilesystemAfter) !== stableCanonicalJson(bundleFilesystemBefore)) {
      throw new Error("Immutable reduced collider bundle files changed during Rapier validation");
    }

    const receipt = validateHeldReceipt(rawReceipt, bundle);
    const bytes = Buffer.from(`${stableCanonicalJson(receipt)}\n`, "utf8");
    await writeAll(reservation.handle, bytes);
    await reservation.handle.sync();
    await assertReservation(reservation, bytes.byteLength);
    await reservation.handle.close();
    reservation = undefined;
    return { receipt, rapierValidationInvocations: invocations };
  } catch (error) {
    if (reservation) {
      const cleanupError = await cleanupReservation(reservation);
      if (cleanupError) throw new AggregateError([error, cleanupError], "Reduced collider validation failed and reserved-output cleanup was incomplete");
    }
    throw error;
  }
}

async function reserveOutput(value: string, bundleRoot: string): Promise<ReservedOutput> {
  const resolved = path.resolve(value);
  const requestedParent = path.dirname(resolved);
  const requestedParentInfo = await lstat(requestedParent, { bigint: true });
  if (requestedParentInfo.isSymbolicLink() || !requestedParentInfo.isDirectory()) {
    throw new Error("Reduced collider receipt parent must be a non-symlink directory");
  }
  const canonicalParent = await realpath(requestedParent);
  const output = path.join(canonicalParent, path.basename(resolved));
  if (isInside(bundleRoot, output)) {
    throw new Error("Reduced collider receipt output must be outside the immutable bundle");
  }

  let handle: FileHandle;
  try {
    handle = await open(
      output,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error("Reduced collider receipt output already exists");
    }
    throw error;
  }
  let heldInfo: BigIntStats | undefined;
  let reservation: ReservedOutput;
  try {
    heldInfo = await handle.stat({ bigint: true });
    reservation = {
      requestedParent,
      canonicalParent,
      output,
      bundleRoot,
      handle,
      parentIdentity: inode(await lstat(canonicalParent, { bigint: true })),
      fileIdentity: inode(heldInfo),
    };
    await assertReservation(reservation, 0);
    return reservation;
  } catch (error) {
    const cleanupError = heldInfo
      ? await cleanupHeldOutput(handle, output, inode(heldInfo))
      : await closeHandle(handle);
    if (cleanupError) throw new AggregateError([error, cleanupError], "Reduced collider output reservation failed and cleanup was incomplete");
    throw error;
  }
}

async function assertReservation(reservation: ReservedOutput, expectedSize: number): Promise<void> {
  const requestedParentInfo = await lstat(reservation.requestedParent, { bigint: true });
  if (requestedParentInfo.isSymbolicLink() || !requestedParentInfo.isDirectory()) {
    throw new Error("Reduced collider receipt parent changed during validation");
  }
  if (await realpath(reservation.requestedParent) !== reservation.canonicalParent) {
    throw new Error("Reduced collider receipt parent changed during validation");
  }
  const parentInfo = await lstat(reservation.canonicalParent, { bigint: true });
  const pathInfo = await lstat(reservation.output, { bigint: true });
  const heldInfo = await reservation.handle.stat({ bigint: true });
  if (
    !sameInode(inode(parentInfo), reservation.parentIdentity)
    || pathInfo.isSymbolicLink()
    || !pathInfo.isFile()
    || !heldInfo.isFile()
    || !sameInode(inode(pathInfo), reservation.fileIdentity)
    || !sameInode(inode(heldInfo), reservation.fileIdentity)
    || pathInfo.size !== BigInt(expectedSize)
    || heldInfo.size !== BigInt(expectedSize)
    || (pathInfo.mode & 0o777n) !== 0o600n
    || (heldInfo.mode & 0o777n) !== 0o600n
    || await realpath(reservation.output) !== reservation.output
    || isInside(reservation.bundleRoot, reservation.output)
  ) {
    throw new Error("Reduced collider receipt reservation changed during validation");
  }
}

async function cleanupReservation(reservation: ReservedOutput): Promise<Error | undefined> {
  return cleanupHeldOutput(reservation.handle, reservation.output, reservation.fileIdentity);
}

async function cleanupHeldOutput(
  handle: FileHandle,
  output: string,
  fileIdentity: InodeIdentity,
): Promise<Error | undefined> {
  let cleanupError: Error | undefined;
  let safeToUnlink = false;
  try {
    const pathInfo = await lstat(output, { bigint: true });
    const heldInfo = await handle.stat({ bigint: true });
    safeToUnlink = pathInfo.isFile()
      && !pathInfo.isSymbolicLink()
      && sameInode(inode(pathInfo), fileIdentity)
      && sameInode(inode(heldInfo), fileIdentity);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") cleanupError = asError(error);
  }
  if (safeToUnlink) {
    try {
      await unlink(output);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") cleanupError ??= asError(error);
    }
  }
  const closeError = await closeHandle(handle);
  cleanupError ??= closeError;
  return cleanupError;
}

async function closeHandle(handle: FileHandle): Promise<Error | undefined> {
  try {
    await handle.close();
    return undefined;
  } catch (error) {
    return asError(error);
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten <= 0) throw new Error("Reduced collider held receipt write made no progress");
    offset += bytesWritten;
  }
}

async function snapshotBundleFilesystem(bundle: VerifiedReducedColliderBundle): Promise<Record<string, unknown>> {
  const rootInfo = await lstat(bundle.root, { bigint: true });
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Immutable reduced collider bundle root changed after verification");
  }
  const files: Record<string, unknown> = {};
  for (const key of evidenceKeys) {
    const evidence = bundle.evidence[key];
    const absolute = path.join(bundle.root, evidence.path);
    const info = await lstat(absolute, { bigint: true });
    const canonical = await realpath(absolute);
    if (
      info.isSymbolicLink()
      || !info.isFile()
      || !isInside(bundle.root, canonical)
      || canonical === bundle.root
      || info.size !== BigInt(evidence.size_bytes)
    ) {
      throw new Error(`Immutable reduced collider ${key} changed after verification`);
    }
    files[key] = diskIdentity(canonical, info);
  }
  return { root: diskIdentity(bundle.root, rootInfo), files };
}

function diskIdentity(canonicalPath: string, info: BigIntStats): Record<string, string> {
  return {
    canonical_path: canonicalPath,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    mode: info.mode.toString(),
    size: info.size.toString(),
    modified_ns: info.mtimeNs.toString(),
    changed_ns: info.ctimeNs.toString(),
  };
}

function bundleInvariant(bundle: VerifiedReducedColliderBundle): string {
  const digest = createHash("sha256");
  digest.update(stableCanonicalJson({
    root: bundle.root,
    evidence: bundle.evidence,
    producerRails: bundle.producerRails,
    semanticCounts: bundle.mesh.semanticCounts,
    unknownFaceCount: bundle.mesh.unknownFaceCount,
  }));
  const views: Array<[string, ArrayBufferView]> = [
    ["vertices", bundle.mesh.vertices],
    ["indices", bundle.mesh.indices],
    ["semanticClassifications", bundle.mesh.semanticClassifications],
    ["semanticSupport", bundle.mesh.semanticSupport],
    ["sourceFaceIndices", bundle.mesh.sourceFaceIndices],
  ];
  for (const [label, view] of views) {
    digest.update(`\0${label}\0${view.byteLength}\0`);
    digest.update(Buffer.from(view.buffer, view.byteOffset, view.byteLength));
  }
  return `sha256:${digest.digest("hex")}`;
}

function cloneBundle(bundle: VerifiedReducedColliderBundle): VerifiedReducedColliderBundle {
  return {
    root: bundle.root,
    mesh: {
      vertices: Float64Array.from(bundle.mesh.vertices),
      indices: Uint32Array.from(bundle.mesh.indices),
      semanticClassifications: Uint8Array.from(bundle.mesh.semanticClassifications),
      semanticSupport: Uint8Array.from(bundle.mesh.semanticSupport),
      sourceFaceIndices: Uint32Array.from(bundle.mesh.sourceFaceIndices),
      semanticCounts: { ...bundle.mesh.semanticCounts },
      unknownFaceCount: bundle.mesh.unknownFaceCount,
    },
    evidence: {
      benchmark: { ...bundle.evidence.benchmark },
      reducerReport: { ...bundle.evidence.reducerReport },
      probeReport: { ...bundle.evidence.probeReport },
      candidate: { ...bundle.evidence.candidate },
    },
    producerRails: { ...bundle.producerRails },
  };
}

function validateHeldReceipt(
  value: unknown,
  bundle: VerifiedReducedColliderBundle,
): ExternalReducedColliderHeldReceipt {
  let normalized: unknown;
  try {
    normalized = JSON.parse(stableCanonicalJson(value));
  } catch (error) {
    throw new Error("Rapier validation receipt is not canonical JSON", { cause: error });
  }
  const receipt = record(normalized, "reduced collider validation receipt");
  requireExactKeys(receipt, ["schema", "input", "parser", "rapier", "rails", "issues", "decision", "authority"], "Rapier receipt");
  if (receipt.schema !== receiptSchema || receipt.decision !== "hold") {
    throw new Error("Rapier validation did not return the expected held receipt");
  }

  const receiptInput = record(receipt.input, "Rapier receipt input");
  if (stableCanonicalJson(receiptInput) !== stableCanonicalJson(bundle.evidence)) {
    throw new Error("Rapier receipt is not bound to the exact reducer bundle");
  }
  for (const key of evidenceKeys) {
    requireExactKeys(record(receiptInput[key], `Rapier receipt ${key}`), ["path", "size_bytes", "checksum"], `Rapier receipt ${key}`);
  }

  const parser = record(receipt.parser, "Rapier receipt parser");
  requireExactKeys(parser, ["status", "algorithm", "vertex_count", "face_count", "unknown_face_count", "semantic_counts", "metadata"], "Rapier receipt parser");
  if (
    parser.status !== "verified"
    || parser.algorithm !== "sha256_stream_1mib_stable_stat_v1"
    || parser.metadata !== "source_face_index_semantic_classification_semantic_support_preserved"
  ) {
    throw new Error("Rapier receipt parser evidence is incomplete");
  }
  requireNumber(parser.vertex_count, bundle.mesh.vertices.length / 3, "vertex count");
  requireNumber(parser.face_count, bundle.mesh.indices.length / 3, "face count");
  requireNumber(parser.unknown_face_count, bundle.mesh.unknownFaceCount, "unknown face count");
  if (stableCanonicalJson(parser.semantic_counts) !== stableCanonicalJson(bundle.mesh.semanticCounts)) {
    throw new Error("Rapier receipt semantic counts do not match the parsed collider");
  }

  const rapier = record(receipt.rapier, "Rapier receipt execution");
  requireExactKeys(rapier, ["backend", "step_rate_hz", "repetitions", "deterministic", "telemetry_digests", "capsule"], "Rapier receipt execution");
  const digests = array(rapier.telemetry_digests, "Rapier telemetry digests");
  if (
    rapier.backend !== "@dimforge/rapier3d-compat@0.19.3"
    || rapier.step_rate_hz !== 60
    || rapier.repetitions !== 3
    || rapier.deterministic !== true
    || digests.length !== 3
    || !digests.every((digest) => typeof digest === "string" && sha256Pattern.test(digest))
    || new Set(digests).size !== 1
  ) {
    throw new Error("Rapier receipt execution evidence is incomplete or non-deterministic");
  }
  const capsule = record(rapier.capsule, "Rapier receipt capsule");
  requireExactKeys(capsule, ["radius_meters", "half_height_meters", "controller_offset_meters", "speed_meters_per_second", "eye_height_meters"], "Rapier receipt capsule");
  for (const [key, expected] of Object.entries({
    radius_meters: 0.22,
    half_height_meters: 0.5,
    controller_offset_meters: 0.02,
    speed_meters_per_second: 1.2,
    eye_height_meters: 1.6,
  })) requireNumber(capsule[key], expected, `capsule ${key}`);

  const rails = record(receipt.rails, "Rapier receipt rails");
  requireExactKeys(rails, [
    "checksum_binding", "metadata_preservation", "unknown_fail_closed", "no_fallback_floor",
    "floor_qualified_spawn", "floor_continuity", "wall_stop", "closed_door",
    "controller_pose_reset", "reset", "doorway",
  ], "Rapier receipt rails");
  if (
    rails.checksum_binding !== "accepted"
    || rails.metadata_preservation !== "accepted"
    || rails.unknown_fail_closed !== "accepted"
    || rails.no_fallback_floor !== "accepted"
  ) throw new Error("Rapier receipt crosses a held authority boundary");

  const probes = validateProbeRails(rails, bundle);
  const issues = array(receipt.issues, "Rapier receipt issues").map((value, index) => {
    const issue = record(value, `Rapier receipt issue ${index}`);
    requireExactKeys(issue, ["code", "message"], `Rapier receipt issue ${index}`);
    if (!nonEmptyString(issue.code) || !nonEmptyString(issue.message)) {
      throw new Error("Rapier receipt issues must contain non-empty code and message strings");
    }
    return issue;
  });
  const expectedIssues = canonicalIssues(bundle, probes);
  if (stableCanonicalJson(issues) !== stableCanonicalJson(expectedIssues)) {
    throw new Error("Rapier receipt issues do not match the canonical held rails");
  }
  requireFalseAuthority(receipt.authority);
  return receipt as ExternalReducedColliderHeldReceipt;
}

function validateProbeRails(
  rails: Record<string, unknown>,
  bundle: VerifiedReducedColliderBundle,
): Record<string, Record<string, unknown>> {
  const floorSpawn = probe(
    rails.floor_qualified_spawn,
    "floor-qualified spawn",
    {
      known_supported_floor_hit: "accepted",
      known_supported_floor_spawn_missing: "held",
      producer_floor_parity_held: "held",
    },
    new Set(["known_supported_floor_hit", "producer_floor_parity_held"]),
  );
  const floorContinuity = probe(
    rails.floor_continuity,
    "floor continuity",
    {
      route_evidence_missing: "held",
      known_supported_floor_spawn_missing: "held",
      unsupported_floor_corridor_collision: "held",
      floor_fallthrough_observed: "held",
    },
    new Set(["route_evidence_missing", "unsupported_floor_corridor_collision", "floor_fallthrough_observed"]),
  );
  const wallStop = probe(
    rails.wall_stop,
    "wall stop",
    {
      reduced_capsule_stop_within_0_03m: "accepted",
      known_supported_floor_spawn_missing: "held",
      known_supported_wall_probe_missing: "held",
      unsupported_probe_corridor_collision: "held",
      reduced_capsule_stop_outside_0_03m: "held",
      producer_wall_parity_held: "held",
    },
    new Set(["reduced_capsule_stop_within_0_03m", "unsupported_probe_corridor_collision", "reduced_capsule_stop_outside_0_03m", "producer_wall_parity_held"]),
    true,
  );
  const closedDoor = probe(
    rails.closed_door,
    "closed door",
    {
      reduced_capsule_stop_within_0_03m: "accepted",
      known_supported_floor_spawn_missing: "held",
      known_supported_closed_door_probe_missing: "held",
      unsupported_probe_corridor_collision: "held",
      reduced_capsule_stop_outside_0_03m: "held",
      producer_closed_door_parity_held: "held",
    },
    new Set(["reduced_capsule_stop_within_0_03m", "unsupported_probe_corridor_collision", "reduced_capsule_stop_outside_0_03m", "producer_closed_door_parity_held"]),
    true,
  );
  const controllerReset = probe(
    rails.controller_pose_reset,
    "controller pose reset",
    {
      exact_controller_pose_reset_reproduced: "accepted",
      known_supported_floor_spawn_missing: "held",
      controller_pose_reset_mismatch: "held",
    },
    new Set(),
  );
  exactHeldRail(rails.reset, "episode_state_contract_missing", "Rapier reset rail");
  exactHeldRail(rails.doorway, "doorway_probe_missing", "Rapier doorway rail");
  bindProducerRail(floorSpawn, bundle.producerRails.floor, "producer_floor_parity_held", "floor-qualified spawn");
  bindProducerRail(wallStop, bundle.producerRails.wall, "producer_wall_parity_held", "wall stop");
  bindProducerRail(closedDoor, bundle.producerRails.closedDoor, "producer_closed_door_parity_held", "closed door");
  bindSemanticSourceFace(floorSpawn, bundle, 2, "floor-qualified spawn");
  bindSemanticSourceFace(floorContinuity, bundle, 2, "floor continuity");
  bindSemanticSourceFace(wallStop, bundle, 1, "wall stop");
  bindSemanticSourceFace(closedDoor, bundle, 7, "closed door");
  bindStopDistance(wallStop, "producer_wall_parity_held", "wall stop");
  bindStopDistance(closedDoor, "producer_closed_door_parity_held", "closed door");
  return {
    floor_qualified_spawn: floorSpawn,
    floor_continuity: floorContinuity,
    wall_stop: wallStop,
    closed_door: closedDoor,
    controller_pose_reset: controllerReset,
  };
}

function bindProducerRail(
  result: Record<string, unknown>,
  producer: "accepted" | "held",
  producerHeldReason: string,
  label: string,
): void {
  if (result.status === "accepted" && producer !== "accepted") {
    throw new Error(`Rapier receipt ${label} rail cannot be accepted while producer parity is held`);
  }
  if (result.reason === producerHeldReason && producer !== "held") {
    throw new Error(`Rapier receipt ${label} rail claims held producer parity that was accepted`);
  }
}

function bindSemanticSourceFace(
  result: Record<string, unknown>,
  bundle: VerifiedReducedColliderBundle,
  classification: number,
  label: string,
): void {
  if (result.source_face_index === undefined) return;
  const sourceFaceIndex = result.source_face_index as number;
  for (let index = 0; index < bundle.mesh.sourceFaceIndices.length; index += 1) {
    if (
      bundle.mesh.sourceFaceIndices[index] === sourceFaceIndex
      && bundle.mesh.semanticClassifications[index] === classification
      && bundle.mesh.semanticSupport[index] === 4
    ) return;
  }
  throw new Error(`Rapier receipt ${label} rail source face is not a fully supported matching semantic face`);
}

function bindStopDistance(
  result: Record<string, unknown>,
  producerHeldReason: string,
  label: string,
): void {
  if (result.final_distance_meters === undefined) return;
  const distanceError = Math.abs((result.final_distance_meters as number) - 0.24);
  const withinTolerance = distanceError <= 0.03 + 1e-9;
  if (
    (result.reason === "reduced_capsule_stop_within_0_03m" || result.reason === producerHeldReason)
    && !withinTolerance
  ) {
    throw new Error(`Rapier receipt ${label} rail does not reproduce the canonical 0.24m stop distance`);
  }
  if (result.reason === "reduced_capsule_stop_outside_0_03m" && withinTolerance) {
    throw new Error(`Rapier receipt ${label} rail reports an outside-tolerance stop within the canonical tolerance`);
  }
}

function probe(
  value: unknown,
  label: string,
  reasons: Record<string, "accepted" | "held">,
  reasonsWithSource: Set<string>,
  distances = false,
): Record<string, unknown> {
  const result = record(value, `Rapier ${label} rail`);
  const allowed = ["status", "reason", "source_face_index", "initial_distance_meters", "final_distance_meters"];
  if (Object.keys(result).some((key) => !allowed.includes(key))) {
    throw new Error(`Rapier ${label} rail has unsupported fields`);
  }
  if (!nonEmptyString(result.reason) || reasons[result.reason] !== result.status) {
    throw new Error(`Rapier ${label} rail has a non-canonical status or reason`);
  }
  const needsSource = reasonsWithSource.has(result.reason);
  if (needsSource !== (result.source_face_index !== undefined)) {
    throw new Error(`Rapier ${label} rail source-face evidence is incomplete`);
  }
  if (result.source_face_index !== undefined && (
    !Number.isInteger(result.source_face_index)
    || (result.source_face_index as number) < 0
    || (result.source_face_index as number) > 0xffff_ffff
  )) throw new Error(`Rapier ${label} rail source-face index is invalid`);
  const hasInitial = result.initial_distance_meters !== undefined;
  const hasFinal = result.final_distance_meters !== undefined;
  if (distances && needsSource) {
    requireNumber(result.initial_distance_meters, 0.65, `${label} initial distance`);
    requireFinite(result.final_distance_meters, `${label} final distance`);
  } else if (hasInitial || hasFinal) {
    throw new Error(`Rapier ${label} rail has unsupported distance evidence`);
  }
  return result;
}

function exactHeldRail(value: unknown, reason: string, label: string): void {
  const rail = record(value, label);
  requireExactKeys(rail, ["status", "reason"], label);
  if (rail.status !== "held" || rail.reason !== reason) {
    throw new Error(`${label} is not the canonical held rail`);
  }
}

function canonicalIssues(
  bundle: VerifiedReducedColliderBundle,
  probes: Record<string, Record<string, unknown>>,
): Array<{ code: string; message: string }> {
  const issues: Array<{ code: string; message: string }> = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (bundle.producerRails.floor === "held") add("producer_floor_probe_failed", "Capture Splat did not accept every checksum-bound floor parity sample.");
  if (bundle.producerRails.wall === "held") add("producer_wall_probe_failed", "Capture Splat did not accept every checksum-bound wall parity sample.");
  if (bundle.producerRails.closedDoor === "held") add("producer_closed_door_probe_failed", "Capture Splat did not accept every checksum-bound closed-door parity sample.");
  if (probes.floor_qualified_spawn!.status !== "accepted") add(probes.floor_qualified_spawn!.reason as string, "A floor-qualified spawn was not accepted by both producer evidence and Rapier.");
  if (probes.floor_continuity!.status !== "accepted") add(probes.floor_continuity!.reason as string, "Continuous floor support cannot be claimed without a checksum-bound route.");
  if (probes.wall_stop!.status !== "accepted") add(probes.wall_stop!.reason as string, "Wall-stop parity or the reduced Rapier stop remains held.");
  if (probes.closed_door!.status !== "accepted") add(probes.closed_door!.reason as string, "Closed-door parity or the reduced Rapier stop remains held.");
  if (probes.controller_pose_reset!.status !== "accepted") add(probes.controller_pose_reset!.reason as string, "The Rapier controller did not reproduce its initial pose deterministically.");
  add("episode_state_contract_missing", "A controller-pose check does not prove full episode and world-state reset.");
  add("source_probe_geometry_missing", "The bundle omits source mesh bytes and replayable probe vectors, so World Studio cannot independently replay source-versus-reduced parity.");
  add("doorway_probe_missing", "No checksum-bound portal and route evidence is present; doorway traversal remains unavailable.");
  add("physical_validation_pending", "No bound physical collision validation is present.");
  return issues;
}

function requireFalseAuthority(value: unknown): void {
  const authority = record(value, "Rapier receipt authority");
  requireExactKeys(authority, [...authorityKeys], "Rapier receipt authority");
  for (const key of authorityKeys) {
    if (authority[key] !== false) throw new Error(`Rapier receipt grants unsupported ${key}`);
  }
}

function requireExactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (stableCanonicalJson(Object.keys(value).sort()) !== stableCanonicalJson([...keys].sort())) {
    throw new Error(`${label} fields are incomplete or unsupported`);
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireNumber(value: unknown, expected: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value !== expected) {
    throw new Error(`Rapier receipt ${label} does not match the canonical value`);
  }
}

function requireFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Rapier receipt ${label} must be finite`);
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function inode(info: BigIntStats): InodeIdentity {
  return { device: info.dev, inode: info.ino };
}

function sameInode(left: InodeIdentity, right: InodeIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
