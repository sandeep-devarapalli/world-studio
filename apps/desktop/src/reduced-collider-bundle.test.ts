import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeReducedColliderPly, ReducedColliderPlyStreamParser } from "@world-studio/artifacts/reduced-collider";
import { hashReducedColliderWalkTrace, validateReducedColliderWalk, type WalkTraceStep } from "../../web/src/reduced-collider-walk-validation";
import { readChecksumBoundReducedColliderBundle } from "./reduced-collider-bundle";

const falseAuthority = {
  collision_authority: false,
  measurement_authority: false,
  metric_authority: false,
  navigation_authority: false,
  newton_authority: false,
  physics_authority: false,
  quality_claim: false,
  semantic_authority: false,
};

describe("checksum-bound reduced collider bundle", () => {
  it("streams the exact checksum graph and preserves fail-closed face metadata", async () => {
    const fixture = await createBundle();
    const bundle = await readChecksumBoundReducedColliderBundle(fixture.root, fixture.benchmarkChecksum);

    expect(bundle.mesh.semanticClassifications).toEqual(new Uint8Array([2, 2, 1, 1, 7, 7, 255]));
    expect(bundle.mesh.semanticSupport).toEqual(new Uint8Array([4, 4, 4, 4, 4, 4, 2]));
    expect(bundle.mesh.sourceFaceIndices).toEqual(new Uint32Array([10, 10, 50, 51, 60, 61, 99]));
    expect(bundle.mesh.semanticCounts).toEqual({ floor: 2, wall: 2, door: 2, unknown: 1 });
    expect(bundle.producerRails).toEqual({ floor: "accepted", wall: "accepted", closedDoor: "accepted", reset: "held", doorway: "missing", noFallbackFloor: true });
  });

  it("rejects body tampering and inconsistent producer telemetry", async () => {
    const tampered = await createBundle();
    const candidatePath = join(tampered.root, "reduced_collider_candidate.ply");
    const bytes = await readFile(candidatePath);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(candidatePath, bytes);
    await expect(readChecksumBoundReducedColliderBundle(tampered.root, tampered.benchmarkChecksum)).rejects.toThrow(/checksum|out of range/);

    const inconsistent = await createBundle({ inconsistentDelta: true });
    await expect(readChecksumBoundReducedColliderBundle(inconsistent.root, inconsistent.benchmarkChecksum)).rejects.toThrow("internally inconsistent");

    const extraAuthority = await createBundle({ extraAuthority: true });
    await expect(readChecksumBoundReducedColliderBundle(extraAuthority.root, extraAuthority.benchmarkChecksum)).rejects.toThrow("authority fields");

    const producerErrors = await createBundle({ producerErrors: true });
    await expect(readChecksumBoundReducedColliderBundle(producerErrors.root, producerErrors.benchmarkChecksum)).rejects.toThrow("producer errors");
  });

  it("rejects partial support on a known class across arbitrary stream boundaries", () => {
    const ply = makePly({ knownSupport: 3 });
    const parser = new ReducedColliderPlyStreamParser({ expectedBytes: ply.length, expectedVertices: 15, expectedFaces: 7, sourceFaceCount: 1000 });
    expect(() => {
      for (const byte of ply) parser.push(Uint8Array.of(byte));
      parser.finish();
    }).toThrow("semantic support");
  });

  it("runs three deterministic reduced-only Rapier repetitions and keeps authority held", async () => {
    const fixture = await createBundle();
    const bundle = await readChecksumBoundReducedColliderBundle(fixture.root, fixture.benchmarkChecksum);
    const receipt = await validateReducedColliderWalk(bundle);

    expect(receipt.rapier.telemetry_digests).toHaveLength(3);
    expect(new Set(receipt.rapier.telemetry_digests).size).toBe(1);
    expect(receipt.rapier.deterministic).toBe(true);
    expect(receipt.rails.floor_qualified_spawn.status).toBe("accepted");
    expect(receipt.rails.controller_pose_reset.status).toBe("accepted");
    expect(receipt.rails.reset).toEqual({ status: "held", reason: "episode_state_contract_missing" });
    expect(receipt.rails.doorway).toEqual({ status: "held", reason: "doorway_probe_missing" });
    expect(receipt.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["source_probe_geometry_missing", "route_evidence_missing", "doorway_probe_missing"]));
    expect(receipt.decision).toBe("hold");
    expect(Object.values(receipt.authority).every((value) => value === false)).toBe(true);
  });

  it("uses an owned pre-await snapshot when caller arrays mutate", async () => {
    const fixture = await createBundle();
    const bundle = await readChecksumBoundReducedColliderBundle(fixture.root, fixture.benchmarkChecksum);
    const pending = validateReducedColliderWalk(bundle);
    queueMicrotask(() => {
      bundle.mesh.semanticClassifications.fill(255);
      bundle.mesh.semanticSupport.fill(0);
      bundle.mesh.vertices.fill(1000);
    });
    const receipt = await pending;
    expect(receipt.parser.semantic_counts).toEqual({ floor: 2, wall: 2, door: 2, unknown: 1 });
    expect(receipt.rails.floor_qualified_spawn.status).toBe("accepted");
  });

  it("binds determinism digests to intermediate controller telemetry", async () => {
    const trace: WalkTraceStep[] = [{
      phase: "wall_move",
      step: 12,
      position: [1, 2, 3],
      grounded: true,
      collision_classifications: [1, 255],
    }];
    const changed = structuredClone(trace);
    changed[0]!.position[0] += Number.EPSILON;
    expect(await hashReducedColliderWalkTrace(trace)).not.toBe(await hashReducedColliderWalkTrace(changed));
  });

  it("never qualifies unknown geometry as a floor spawn", async () => {
    const fixture = await createBundle();
    const bundle = await readChecksumBoundReducedColliderBundle(fixture.root, fixture.benchmarkChecksum);
    bundle.mesh.semanticClassifications.fill(255);
    bundle.mesh.semanticSupport.fill(0);
    await expect(validateReducedColliderWalk(bundle)).rejects.toThrow("semantic summaries");
    bundle.mesh.unknownFaceCount = 7;
    bundle.mesh.semanticCounts = { unknown: 7 };
    const unknownBytes = encodeReducedColliderPly(bundle.mesh);
    bundle.evidence.candidate = { ...bundle.evidence.candidate, size_bytes: unknownBytes.byteLength, checksum: checksum(unknownBytes) };
    const receipt = await validateReducedColliderWalk(bundle);
    expect(receipt.rails.floor_qualified_spawn).toEqual({ status: "held", reason: "known_supported_floor_spawn_missing" });
    expect(receipt.rails.unknown_fail_closed).toBe("accepted");
  });
});

const externalRoot = process.env.ROOM01_REDUCED_COLLIDER_ROOT;
const externalChecksum = process.env.ROOM01_REDUCED_COLLIDER_SHA256;
const externalOutput = process.env.ROOM01_REDUCED_COLLIDER_RECEIPT_OUT;

describe.skipIf(!externalRoot || !externalChecksum)("exact Room-01 reduced collider", () => {
  it("validates the exact external fixture without promoting it", async () => {
    const bundle = await readChecksumBoundReducedColliderBundle(externalRoot!, externalChecksum!);
    const receipt = await validateReducedColliderWalk(bundle);
    expect(receipt.input.benchmark.checksum).toBe(externalChecksum);
    expect(receipt.parser).toMatchObject({ vertex_count: 32_206, face_count: 59_999, unknown_face_count: 56_590 });
    expect(receipt.rapier.deterministic).toBe(true);
    expect(receipt.rails.controller_pose_reset.status).toBe("accepted");
    expect(receipt.rails.reset.reason).toBe("episode_state_contract_missing");
    expect(receipt.rails.doorway.reason).toBe("doorway_probe_missing");
    expect(receipt.decision).toBe("hold");
    if (externalOutput) await writeFile(externalOutput, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify(receipt));
  }, 30_000);
});

async function createBundle(options: { inconsistentDelta?: boolean; extraAuthority?: boolean; producerErrors?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "world-studio-reduced-collider-"));
  const candidate = makePly();
  const candidateChecksum = checksum(candidate);
  const sourceEvidence = { path: "hybrid_structural_surface.ply", size_bytes: 123, checksum: `sha256:${"a".repeat(64)}` };
  const hybridReportEvidence = { path: "capture_splat_hybrid_surface_report.json", size_bytes: 124, checksum: `sha256:${"b".repeat(64)}` };
  const colliderReportEvidence = { path: "capture_splat_hybrid_collider_candidate_report.json", size_bytes: 125, checksum: `sha256:${"c".repeat(64)}` };
  const sample = (classification: number, sourceFaceIndex: number) => ({
    source_face_index: sourceFaceIndex,
    source_hit_classification: classification,
    reduced_hit_classification: classification,
    source_hit_distance_meters: 0.2,
    reduced_hit_distance_meters: 0.21,
    hit_distance_delta_meters: options.inconsistentDelta ? 0.02 : 0.009999999999999981,
    passed: true,
  });
  const rail = (classification: number, sourceFaceIndex: number) => ({
    status: "accepted",
    reason: "sampled_surface_block_parity_passed",
    sample_pattern: "fixture",
    sample_count: 1,
    passed_sample_count: 1,
    source_face_indices: [sourceFaceIndex],
    maximum_hit_distance_delta_meters: options.inconsistentDelta ? 0.02 : 0.009999999999999981,
    samples: [sample(classification, sourceFaceIndex)],
  });
  const probe = {
    schema: "capture_splat.collision_probe.v0.1",
    status: "held",
    decision: "hold",
    reason: "doorway_probe_missing_and_downstream_reset_pending",
    authority: falseAuthority,
    coordinate_contract: { coordinate_frame: "arkit_world", units: "meters" },
    inputs: {
      reduced_collider: { path: "reduced_collider_candidate.ply", size_bytes: candidate.length, checksum: candidateChecksum },
      source_hybrid_surface: sourceEvidence,
    },
    probes: {
      floor_qualified_spawn: rail(2, 10),
      floor_continuity_and_no_fallthrough: { ...rail(2, 10), status: "held", reason: "route_contract_missing_for_no_fallthrough_claim" },
      wall_stop: rail(1, 50),
      closed_door: rail(7, 60),
      fallback_floor: { status: "accepted", added: false },
      doorway: { status: "held", reason: "doorway_probe_missing", route_or_portal_contract_consumed: false },
      reset: { status: "held", reason: "world_studio_character_controller_reset_probe_pending" },
    },
    repetitions: { count: 3, identical: true, telemetry_digests: Array(3).fill(`sha256:${"d".repeat(64)}`) },
  };
  const probeBytes = jsonBytes(probe);
  const probeChecksum = checksum(probeBytes);
  const reducer = {
    schema: "capture_splat.reduced_hybrid_collider.v0.1",
    status: "held",
    decision: "hold",
    reason: "fixture_held",
    authority: falseAuthority,
    ...(options.producerErrors ? { errors: ["fixture error"] } : {}),
    coordinate_contract: { coordinate_frame: "arkit_world", units: "meters" },
    candidate: { path: "reduced_collider_candidate.ply", size_bytes: candidate.length, checksum: candidateChecksum, vertex_count: 15, triangle_count: 7 },
    source: { vertex_count: 100, triangle_count: 1000 },
    source_mapping: { mapped_face_count: 7, mapping_in_range: true, mode: "centroid_representative_with_centroid_and_vertex_support", semantic_support_range: [2, 4], unknown_face_count: 1 },
    comparison: { candidate_semantic_counts: { wall: 2, floor: 2, ceiling: 0, table: 0, seat: 0, window: 0, door: 2, unknown: 1 } },
    topology: { fallback_floor_added: false, synthetic_geometry_added: false, portal_inferred: false },
    probe_report: { path: "capture_splat_collision_probe_report.json", size_bytes: probeBytes.length, checksum: probeChecksum },
    inputs: {
      hybrid_surface: sourceEvidence,
      hybrid_report: hybridReportEvidence,
      unsimplified_collider: { ...sourceEvidence, path: "collider_candidate.ply" },
      unsimplified_collider_report: colliderReportEvidence,
    },
  };
  const reducerBytes = jsonBytes(reducer);
  const reducerChecksum = checksum(reducerBytes);
  const benchmark = {
    schema: "capture_splat.reduced_collider_benchmark.v0.1",
    status: "completed_held",
    decision: "hold",
    authority: options.extraAuthority ? { ...falseAuthority, future_authority: true } : falseAuthority,
    input: {
      hybrid_surface_sha256: sourceEvidence.checksum.slice(7),
      collider_candidate_sha256: sourceEvidence.checksum.slice(7),
      hybrid_report_sha256: hybridReportEvidence.checksum.slice(7),
      collider_report_sha256: colliderReportEvidence.checksum.slice(7),
      vertex_count: 100,
      triangle_count: 1000,
    },
    output: {
      candidate_sha256: candidateChecksum.slice(7),
      reducer_report_sha256: reducerChecksum.slice(7),
      probe_report_sha256: probeChecksum.slice(7),
      vertex_count: 15,
      triangle_count: 7,
      candidate_size_bytes: candidate.length,
      known_face_fraction: 6 / 7,
      unknown_face_fraction: 1 / 7,
    },
    correctness_decision: { decision: "hold" },
    performance_decision: { decision: "hold" },
  };
  const benchmarkBytes = jsonBytes(benchmark);
  await Promise.all([
    writeFile(join(root, "reduced_collider_candidate.ply"), candidate),
    writeFile(join(root, "capture_splat_collision_probe_report.json"), probeBytes),
    writeFile(join(root, "capture_splat_reduced_collider_report.json"), reducerBytes),
    writeFile(join(root, "capture_splat_reduced_collider_benchmark.json"), benchmarkBytes),
  ]);
  return { root, benchmarkChecksum: checksum(benchmarkBytes) };
}

function makePly(options: { knownSupport?: number } = {}): Buffer {
  const vertices = [
    [-3, 0, -3], [3, 0, -3], [3, 0, 3], [-3, 0, 3],
    [2, 0, -2.5], [2, 2, -2.5], [2, 2, -0.1], [2, 0, -0.1],
    [-2, 0, 0.1], [-2, 2, 0.1], [-2, 2, 2.5], [-2, 0, 2.5],
    [-0.5, 3, -0.5], [0.5, 3, -0.5], [0, 3, 0.5],
  ];
  const faces = [
    [[0, 2, 1], 2, 10], [[0, 3, 2], 2, 10],
    [[4, 5, 6], 1, 50], [[4, 6, 7], 1, 51],
    [[8, 9, 10], 7, 60], [[8, 10, 11], 7, 61],
    [[12, 13, 14], 255, 99],
  ] as const;
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\ncomment Capture Splat source-mapped reduced collider; no physics authority\nelement vertex ${vertices.length}\nproperty double x\nproperty double y\nproperty double z\nelement face ${faces.length}\nproperty list uchar uint vertex_indices\nproperty uchar semantic_classification\nproperty uchar semantic_support\nproperty uint source_face_index\nend_header\n`);
  const body = Buffer.alloc(vertices.length * 24 + faces.length * 19);
  let offset = 0;
  for (const vertex of vertices) for (const value of vertex) { body.writeDoubleLE(value, offset); offset += 8; }
  for (const [indices, classification, sourceFaceIndex] of faces) {
    body.writeUInt8(3, offset); offset += 1;
    for (const index of indices) { body.writeUInt32LE(index, offset); offset += 4; }
    body.writeUInt8(classification, offset); offset += 1;
    body.writeUInt8(classification === 255 ? 2 : (options.knownSupport ?? 4), offset); offset += 1;
    body.writeUInt32LE(sourceFaceIndex, offset); offset += 4;
  }
  return Buffer.concat([header, body]);
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
