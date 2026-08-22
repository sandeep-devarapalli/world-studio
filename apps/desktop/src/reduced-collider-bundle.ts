import {
  ReducedColliderPlyStreamParser,
  type ParsedReducedCollider,
} from "@world-studio/artifacts/reduced-collider";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

const benchmarkName = "capture_splat_reduced_collider_benchmark.json";
const reducerReportName = "capture_splat_reduced_collider_report.json";
const probeReportName = "capture_splat_collision_probe_report.json";
const candidateName = "reduced_collider_candidate.ply";
const maxJsonBytes = 1024 * 1024;
const maxColliderBytes = 64 * 1024 * 1024;
const chunkBytes = 1024 * 1024;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const authorityKeys = [
  "collision_authority", "measurement_authority", "metric_authority", "navigation_authority",
  "newton_authority", "physics_authority", "quality_claim", "semantic_authority"
] as const;

export interface ReducedColliderFileEvidence {
  path: string;
  size_bytes: number;
  checksum: string;
}

export interface ReducedColliderProducerRails {
  floor: "accepted" | "held";
  wall: "accepted" | "held";
  closedDoor: "accepted" | "held";
  reset: "accepted" | "held";
  doorway: "missing";
  noFallbackFloor: true;
}

export interface VerifiedReducedColliderBundle {
  root: string;
  mesh: ParsedReducedCollider;
  evidence: {
    benchmark: ReducedColliderFileEvidence;
    reducerReport: ReducedColliderFileEvidence;
    probeReport: ReducedColliderFileEvidence;
    candidate: ReducedColliderFileEvidence;
  };
  producerRails: ReducedColliderProducerRails;
}

export async function readChecksumBoundReducedColliderBundle(
  root: string,
  expectedBenchmarkChecksum: string,
): Promise<VerifiedReducedColliderBundle> {
  if (!path.isAbsolute(root) || !sha256Pattern.test(expectedBenchmarkChecksum)) {
    throw new Error("Reduced collider root and benchmark checksum must be explicit");
  }
  const resolvedRoot = path.resolve(root);
  const canonicalRoot = await realpath(resolvedRoot);
  const rootInfo = await lstat(resolvedRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Reduced collider root must be a directory and not a symlink");
  }

  const benchmarkRead = await readPinnedFile(canonicalRoot, benchmarkName, maxJsonBytes, expectedBenchmarkChecksum, undefined);
  const benchmark = parseJsonRecord(benchmarkRead.bytes!, benchmarkName);
  requireBenchmarkEnvelope(benchmark);
  const output = record(benchmark.output, "benchmark output");
  const reducerChecksum = prefixedHash(output.reducer_report_sha256, "benchmark reducer report checksum");
  const probeChecksum = prefixedHash(output.probe_report_sha256, "benchmark probe report checksum");
  const candidateChecksum = prefixedHash(output.candidate_sha256, "benchmark candidate checksum");

  const reducerRead = await readPinnedFile(canonicalRoot, reducerReportName, maxJsonBytes, reducerChecksum, undefined);
  const reducer = parseJsonRecord(reducerRead.bytes!, reducerReportName);
  requireHeldEnvelope(reducer, "capture_splat.reduced_hybrid_collider.v0.1", reducerReportName);
  requireCoordinate(reducer.coordinate_contract, reducerReportName);
  const candidateEvidence = evidence(reducer.candidate, candidateName, "reducer candidate");
  if (candidateEvidence.checksum !== candidateChecksum) throw new Error("Reducer and benchmark candidate checksums disagree");
  const reducerProbeEvidence = evidence(reducer.probe_report, probeReportName, "reducer probe report");
  if (reducerProbeEvidence.checksum !== probeChecksum) throw new Error("Reducer and benchmark probe report checksums disagree");
  const source = record(reducer.source, "reducer source summary");
  const sourceFaceCount = boundedInteger(source.triangle_count, 1, 0xffff_ffff, "source triangle count");
  const expectedVertices = boundedInteger(candidateEvidenceValue(reducer.candidate, "vertex_count"), 1, 1_000_000, "candidate vertex count");
  const expectedFaces = boundedInteger(candidateEvidenceValue(reducer.candidate, "triangle_count"), 1, 60_000, "candidate face count");
  requireNumber(output.vertex_count, expectedVertices, "benchmark candidate vertex count");
  requireNumber(output.triangle_count, expectedFaces, "benchmark candidate face count");
  requireNumber(output.candidate_size_bytes, candidateEvidence.size_bytes, "benchmark candidate size");

  const probeRead = await readPinnedFile(canonicalRoot, probeReportName, maxJsonBytes, reducerProbeEvidence.checksum, reducerProbeEvidence.size_bytes);
  const probe = parseJsonRecord(probeRead.bytes!, probeReportName);
  requireHeldEnvelope(probe, "capture_splat.collision_probe.v0.1", probeReportName);
  requireCoordinate(probe.coordinate_contract, probeReportName);
  const probeInputs = record(probe.inputs, "probe inputs");
  if (!evidenceEqual(evidence(probeInputs.reduced_collider, candidateName, "probe candidate"), candidateEvidence)) {
    throw new Error("Probe report is not bound to the exact reduced collider");
  }
  const reducerInputs = record(reducer.inputs, "reducer inputs");
  const reducerSource = evidence(reducerInputs.hybrid_surface, "hybrid_structural_surface.ply", "reducer source surface");
  if (!evidenceEqual(evidence(probeInputs.source_hybrid_surface, "hybrid_structural_surface.ply", "probe source surface"), reducerSource)) {
    throw new Error("Probe report is not bound to the reducer source surface");
  }
  const benchmarkInput = record(benchmark.input, "benchmark input");
  requireNumber(benchmarkInput.triangle_count, sourceFaceCount, "benchmark source triangle count");
  requireNumber(benchmarkInput.vertex_count, boundedInteger(source.vertex_count, 1, 0xffff_ffff, "source vertex count"), "benchmark source vertex count");
  bindPlainHash(benchmarkInput.hybrid_surface_sha256, reducerSource.checksum, "benchmark hybrid surface");
  bindPlainHash(benchmarkInput.collider_candidate_sha256, evidence(reducerInputs.unsimplified_collider, "collider_candidate.ply", "reducer unsimplified collider").checksum, "benchmark unsimplified collider");
  bindPlainHash(benchmarkInput.hybrid_report_sha256, evidence(reducerInputs.hybrid_report, "capture_splat_hybrid_surface_report.json", "reducer hybrid report").checksum, "benchmark hybrid report");
  bindPlainHash(benchmarkInput.collider_report_sha256, evidence(reducerInputs.unsimplified_collider_report, "capture_splat_hybrid_collider_candidate_report.json", "reducer unsimplified collider report").checksum, "benchmark unsimplified collider report");

  const candidateParser = new ReducedColliderPlyStreamParser({
    expectedBytes: candidateEvidence.size_bytes,
    expectedVertices,
    expectedFaces,
    sourceFaceCount,
  });
  await readPinnedFile(canonicalRoot, candidateName, maxColliderBytes, candidateEvidence.checksum, candidateEvidence.size_bytes, (chunk) => candidateParser.push(chunk));
  const mesh = candidateParser.finish();
  validateMeshSummaries(mesh, reducer, output, expectedFaces);
  const producerRails = validateProbeRails(probe, sourceFaceCount);

  return {
    root: canonicalRoot,
    mesh,
    evidence: {
      benchmark: { path: benchmarkName, size_bytes: benchmarkRead.sizeBytes, checksum: benchmarkRead.checksum },
      reducerReport: { path: reducerReportName, size_bytes: reducerRead.sizeBytes, checksum: reducerRead.checksum },
      probeReport: reducerProbeEvidence,
      candidate: candidateEvidence,
    },
    producerRails,
  };
}

interface PinnedRead {
  bytes?: Buffer;
  sizeBytes: number;
  checksum: string;
}

async function readPinnedFile(
  root: string,
  name: string,
  byteLimit: number,
  expectedChecksum: string,
  expectedSize?: number,
  consume?: (chunk: Uint8Array) => void,
): Promise<PinnedRead> {
  if (!sha256Pattern.test(expectedChecksum) || path.basename(name) !== name) throw new Error("Reduced collider file evidence is invalid");
  const absolute = path.join(root, name);
  const before = await lstat(absolute, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(byteLimit) || (expectedSize !== undefined && before.size !== BigInt(expectedSize))) {
    throw new Error(`${name} is not a bounded regular file matching its declaration`);
  }
  const identity = statIdentity(before);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  const digest = createHash("sha256");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const opened = await handle.stat({ bigint: true });
    if (statIdentity(opened) !== identity) throw new Error(`${name} changed before streaming`);
    const buffer = Buffer.allocUnsafe(chunkBytes);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > byteLimit || (expectedSize !== undefined && total > expectedSize)) throw new Error(`${name} exceeded its bound while streaming`);
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      consume?.(chunk);
      if (!consume) chunks.push(Buffer.from(chunk));
    }
    if (statIdentity(await handle.stat({ bigint: true })) !== identity) throw new Error(`${name} changed while streaming`);
  } finally {
    await handle.close();
  }
  const after = await lstat(absolute, { bigint: true });
  if (after.isSymbolicLink() || !after.isFile() || statIdentity(after) !== identity || total !== Number(after.size)) throw new Error(`${name} path changed while streaming`);
  const checksum = `sha256:${digest.digest("hex")}`;
  if (checksum !== expectedChecksum || (expectedSize !== undefined && total !== expectedSize)) throw new Error(`${name} checksum or size does not match its declaration`);
  return { bytes: consume ? undefined : Buffer.concat(chunks), sizeBytes: total, checksum };
}

function validateMeshSummaries(mesh: ParsedReducedCollider, reducer: Record<string, unknown>, output: Record<string, unknown>, faceCount: number): void {
  const mapping = record(reducer.source_mapping, "source mapping");
  requireNumber(mapping.mapped_face_count, faceCount, "mapped face count");
  requireNumber(mapping.unknown_face_count, mesh.unknownFaceCount, "unknown face count");
  if (mapping.mapping_in_range !== true || mapping.mode !== "centroid_representative_with_centroid_and_vertex_support") {
    throw new Error("Reducer source mapping contract is invalid");
  }
  const supportRange = array(mapping.semantic_support_range, "semantic support range");
  let minimumSupport = 255;
  let maximumSupport = 0;
  for (const support of mesh.semanticSupport) {
    minimumSupport = Math.min(minimumSupport, support);
    maximumSupport = Math.max(maximumSupport, support);
  }
  requireNumber(supportRange[0], minimumSupport, "semantic support minimum");
  requireNumber(supportRange[1], maximumSupport, "semantic support maximum");
  const comparison = record(reducer.comparison, "reducer comparison");
  const declaredCounts = record(comparison.candidate_semantic_counts, "candidate semantic counts");
  for (const name of ["wall", "floor", "ceiling", "table", "seat", "window", "door", "unknown"]) {
    const observed = mesh.semanticCounts[name] ?? 0;
    requireNumber(declaredCounts[name] ?? (observed === 0 ? 0 : undefined), observed, `${name} face count`);
  }
  requireNumber(output.known_face_fraction, (faceCount - mesh.unknownFaceCount) / faceCount, "benchmark known face fraction", 1e-15);
  requireNumber(output.unknown_face_fraction, mesh.unknownFaceCount / faceCount, "benchmark unknown face fraction", 1e-15);
  const topology = record(reducer.topology, "reducer topology");
  if (topology.fallback_floor_added !== false || topology.synthetic_geometry_added !== false || topology.portal_inferred !== false) {
    throw new Error("Reduced collider report added undeclared synthetic geometry or a portal");
  }
}

function validateProbeRails(probe: Record<string, unknown>, sourceFaceCount: number): ReducedColliderProducerRails {
  const probes = record(probe.probes, "probe rails");
  const floor = validateSurfaceProbe(probes.floor_qualified_spawn, 2, sourceFaceCount, "floor");
  const wall = validateSurfaceProbe(probes.wall_stop, 1, sourceFaceCount, "wall");
  const door = validateSurfaceProbe(probes.closed_door, 7, sourceFaceCount, "closed door");
  const fallback = record(probes.fallback_floor, "fallback floor probe");
  if (fallback.status !== "accepted" || fallback.added !== false) throw new Error("Probe report does not prove that no fallback floor was added");
  const doorway = record(probes.doorway, "doorway probe");
  if (doorway.status !== "held" || doorway.reason !== "doorway_probe_missing" || doorway.route_or_portal_contract_consumed !== false) {
    throw new Error("Probe report claims doorway evidence without a route or portal contract");
  }
  const reset = record(probes.reset, "reset probe");
  if (reset.status !== "held" || reset.reason !== "world_studio_character_controller_reset_probe_pending") {
    throw new Error("Producer reset rail is invalid");
  }
  const continuity = record(probes.floor_continuity_and_no_fallthrough, "floor continuity probe");
  if (continuity.status !== "held" || continuity.reason !== "route_contract_missing_for_no_fallthrough_claim") {
    throw new Error("Producer floor continuity claims unsupported route evidence");
  }
  const repetitions = record(probe.repetitions, "probe repetitions");
  const digests = array(repetitions.telemetry_digests, "probe telemetry digests");
  if (repetitions.count !== 3 || repetitions.identical !== true || digests.length !== 3 || !digests.every((value) => value === digests[0] && typeof value === "string" && sha256Pattern.test(value))) {
    throw new Error("Producer probe telemetry is not three checksum-bound identical repetitions");
  }
  return { floor, wall, closedDoor: door, reset: "held", doorway: "missing", noFallbackFloor: true };
}

function validateSurfaceProbe(value: unknown, classification: number, sourceFaceCount: number, label: string): "accepted" | "held" {
  const probe = record(value, `${label} probe`);
  if (probe.status !== "accepted" && probe.status !== "held") throw new Error(`${label} probe status is invalid`);
  const samples = array(probe.samples, `${label} probe samples`);
  if (!samples.length || samples.length > 16) throw new Error(`${label} probe sample count is outside its bound`);
  let passed = 0;
  let maximumDelta = 0;
  const sourceFaceIndices: number[] = [];
  for (const sampleValue of samples) {
    const sample = record(sampleValue, `${label} probe sample`);
    const sourceFaceIndex = boundedInteger(sample.source_face_index, 0, sourceFaceCount - 1, `${label} source face index`);
    const sourceClass = semanticValue(sample.source_hit_classification, `${label} source classification`);
    const reducedClass = semanticValue(sample.reduced_hit_classification, `${label} reduced classification`);
    const sourceDistance = finiteNumber(sample.source_hit_distance_meters, `${label} source hit distance`);
    const reducedDistance = finiteNumber(sample.reduced_hit_distance_meters, `${label} reduced hit distance`);
    const delta = finiteNumber(sample.hit_distance_delta_meters, `${label} hit distance delta`);
    if (Math.abs(delta - Math.abs(sourceDistance - reducedDistance)) > 1e-12) throw new Error(`${label} hit distance delta is internally inconsistent`);
    const expectedPass = sourceClass === classification && reducedClass === classification && delta <= 0.03;
    if (sample.passed !== expectedPass) throw new Error(`${label} probe pass flag is inconsistent with its bound evidence`);
    if (expectedPass) passed += 1;
    maximumDelta = Math.max(maximumDelta, delta);
    sourceFaceIndices.push(sourceFaceIndex);
  }
  requireNumber(probe.sample_count, samples.length, `${label} probe sample count`);
  requireNumber(probe.passed_sample_count, passed, `${label} probe passed count`);
  requireNumber(probe.maximum_hit_distance_delta_meters, maximumDelta, `${label} maximum hit distance delta`, 1e-12);
  if (JSON.stringify(probe.source_face_indices) !== JSON.stringify(sourceFaceIndices)) throw new Error(`${label} source face index list is inconsistent with its samples`);
  if ((probe.status === "accepted") !== (passed === samples.length)) throw new Error(`${label} probe status is inconsistent with its samples`);
  return probe.status;
}

function requireBenchmarkEnvelope(value: Record<string, unknown>): void {
  if (value.schema !== "capture_splat.reduced_collider_benchmark.v0.1" || value.status !== "completed_held" || value.decision !== "hold") {
    throw new Error(`${benchmarkName} is not the expected completed-held contract`);
  }
  requireFalseAuthority(value.authority, benchmarkName);
  requireNoErrors(value, benchmarkName);
  const correctness = record(value.correctness_decision, "benchmark correctness decision");
  const performance = record(value.performance_decision, "benchmark performance decision");
  if (correctness.decision !== "hold" || performance.decision !== "hold") throw new Error("Benchmark decisions must remain held");
}

function requireHeldEnvelope(value: Record<string, unknown>, schema: string, label: string): void {
  if (value.schema !== schema || value.status !== "held" || value.decision !== "hold") throw new Error(`${label} is not the expected held contract`);
  requireFalseAuthority(value.authority, label);
  requireNoErrors(value, label);
}

function requireFalseAuthority(value: unknown, label: string): void {
  const authority = record(value, `${label} authority`);
  const keys = Object.keys(authority).sort();
  const expected = [...authorityKeys].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`${label} authority fields are incomplete or unsupported`);
  for (const key of authorityKeys) if (authority[key] !== false) throw new Error(`${label} grants unsupported ${key}`);
}

function requireNoErrors(value: Record<string, unknown>, label: string): void {
  if ("errors" in value && (!Array.isArray(value.errors) || value.errors.length)) throw new Error(`${label} contains producer errors`);
}

function requireCoordinate(value: unknown, label: string): void {
  const coordinate = record(value, `${label} coordinate contract`);
  if (coordinate.coordinate_frame !== "arkit_world" || coordinate.units !== "meters") throw new Error(`${label} coordinate contract is invalid`);
}

function evidence(value: unknown, expectedPath: string, label: string): ReducedColliderFileEvidence {
  const item = record(value, label);
  if (item.path !== expectedPath || !Number.isSafeInteger(item.size_bytes) || Number(item.size_bytes) <= 0 || !sha256Pattern.test(String(item.checksum))) {
    throw new Error(`${label} evidence is invalid`);
  }
  return { path: expectedPath, size_bytes: Number(item.size_bytes), checksum: String(item.checksum) };
}

function evidenceEqual(left: ReducedColliderFileEvidence, right: ReducedColliderFileEvidence): boolean {
  return left.path === right.path && left.size_bytes === right.size_bytes && left.checksum === right.checksum;
}

function candidateEvidenceValue(value: unknown, key: string): unknown {
  return record(value, "candidate evidence")[key];
}

function prefixedHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is invalid`);
  return `sha256:${value}`;
}

function bindPlainHash(value: unknown, expected: string, label: string): void {
  if (prefixedHash(value, `${label} checksum`) !== expected) throw new Error(`${label} is not cross-bound to the reducer report`);
}

function parseJsonRecord(bytes: Buffer, label: string): Record<string, unknown> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not strict UTF-8`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not strict JSON`);
  }
  validateJsonTree(value, label);
  return record(value, label);
}

function validateJsonTree(root: unknown, label: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > 100_000 || current.depth > 64) throw new Error(`${label} exceeds JSON bounds`);
    if (typeof current.value === "number" && !Number.isFinite(current.value)) throw new Error(`${label} contains a non-finite number`);
    if (Array.isArray(current.value)) for (const value of current.value) pending.push({ value, depth: current.depth + 1 });
    else if (current.value && typeof current.value === "object") for (const value of Object.values(current.value)) pending.push({ value, depth: current.depth + 1 });
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${label} is invalid`);
  return Number(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} is invalid`);
  return value;
}

function semanticValue(value: unknown, label: string): number {
  const result = boundedInteger(value, 1, 255, label);
  if (result > 7 && result !== 255) throw new Error(`${label} is unsupported`);
  return result;
}

function requireNumber(value: unknown, expected: number, label: string, tolerance = 0): void {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value - expected) > tolerance) throw new Error(`${label} does not match the checksum-bound artifact`);
}

function statIdentity(info: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; mode: bigint }): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}`;
}
