import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { encodeReducedColliderPly, ReducedColliderPlyStreamParser } from "@world-studio/artifacts/reduced-collider";
import { hashReducedColliderWalkTrace, validateReducedColliderWalk, type WalkTraceStep } from "../../web/src/reduced-collider-walk-validation";
import { readChecksumBoundReducedColliderBundle } from "./reduced-collider-bundle";
import { runExternalReducedColliderHeldValidation } from "./reduced-collider-held-runner";

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
const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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

  it("runs one generic external Rapier validation and writes its held receipt", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const output = join(outputRoot, "held-receipt.json");
    let invocations = 0;

    const result = await runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async (bundle) => {
      invocations += 1;
      expect((await stat(output)).size).toBe(0);
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      return validateReducedColliderWalk(bundle);
    });

    const persisted = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
    const parser = persisted.parser as Record<string, unknown>;
    expect(invocations).toBe(1);
    expect(result.rapierValidationInvocations).toBe(1);
    expect(persisted).toEqual(result.receipt);
    expect(parser.vertex_count).toBeGreaterThan(0);
    expect(parser.face_count).toBeGreaterThan(0);
    expect(result.receipt.decision).toBe("hold");
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it("does not write a receipt when the single validator result is incomplete", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const output = join(outputRoot, "held-receipt.json");
    let invocations = 0;

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async () => {
      invocations += 1;
      return { schema: "world_studio.reduced_collider_walk_validation.v0.1", decision: "hold" };
    })).rejects.toThrow("Rapier receipt fields");
    expect(invocations).toBe(1);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to overwrite a receipt before invoking Rapier", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const output = join(outputRoot, "held-receipt.json");
    await writeFile(output, "preserve-me");
    let invocations = 0;

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async (bundle) => {
      invocations += 1;
      return validateReducedColliderWalk(bundle);
    })).rejects.toThrow("already exists");
    expect(invocations).toBe(0);
    expect(await readFile(output, "utf8")).toBe("preserve-me");
  });

  it("refuses an output inside the immutable bundle before invoking Rapier", async () => {
    const fixture = await createBundle();
    const output = join(fixture.root, "held-receipt.json");
    let invocations = 0;

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async (bundle) => {
      invocations += 1;
      return validateReducedColliderWalk(bundle);
    })).rejects.toThrow("outside the immutable bundle");
    expect(invocations).toBe(0);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects an output-directory swap without writing inside the immutable bundle", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const movedRoot = `${outputRoot}-moved`;
    const output = join(outputRoot, "held-receipt.json");

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async (bundle) => {
      await rename(outputRoot, movedRoot);
      await symlink(fixture.root, outputRoot, "dir");
      return validateReducedColliderWalk(bundle);
    })).rejects.toThrow(/parent changed|reservation changed/);

    await expect(readFile(join(fixture.root, "held-receipt.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(movedRoot, "held-receipt.json"))).size).toBe(0);
  });

  it("detects output-leaf replacement and preserves the raced file", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const output = join(outputRoot, "held-receipt.json");

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async (bundle) => {
      await unlink(output);
      await writeFile(output, "preserve-raced-file");
      return validateReducedColliderWalk(bundle);
    })).rejects.toThrow("reservation changed");
    expect(await readFile(output, "utf8")).toBe("preserve-raced-file");
  });

  it("rejects callback mutation of the isolated bundle and cleans its reservation", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const output = join(outputRoot, "held-receipt.json");

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async (bundle) => {
      const receipt = await validateReducedColliderWalk(bundle);
      bundle.mesh.vertices[0] = bundle.mesh.vertices[0]! + 0.25;
      return receipt;
    })).rejects.toThrow("mutated its isolated reduced collider input");
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects immutable bundle-file mutation during the callback", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const output = join(outputRoot, "held-receipt.json");

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async (bundle) => {
      const receipt = await validateReducedColliderWalk(bundle);
      const candidatePath = join(fixture.root, "reduced_collider_candidate.ply");
      const bytes = await readFile(candidatePath);
      bytes[bytes.length - 1] ^= 1;
      await writeFile(candidatePath, bytes);
      return receipt;
    })).rejects.toThrow("Immutable reduced collider bundle files changed");
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-canonical fake receipts across execution, rails, issues, and shape", async () => {
    const fixture = await createBundle();
    const verified = await readChecksumBoundReducedColliderBundle(fixture.root, fixture.benchmarkChecksum);
    const canonical = await validateReducedColliderWalk(verified);
    const mutations: Array<(value: any) => void> = [
      (value) => { value.rapier.telemetry_digests[1] = `sha256:${"e".repeat(64)}`; },
      (value) => { value.rapier.deterministic = false; },
      (value) => { delete value.rapier.step_rate_hz; },
      (value) => { value.rapier.capsule.radius_meters = 0.23; },
      (value) => { delete value.rails.floor_continuity; },
      (value) => { value.rails.wall_stop.source_face_index = 99; },
      (value) => { value.rails.closed_door.source_face_index = 50; },
      (value) => { value.rails.wall_stop.final_distance_meters = 0.5; },
      (value) => { value.issues = [{ code: "doorway_probe_missing", message: "fake" }]; },
      (value) => { value.unsupported = true; },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
      const output = join(outputRoot, `held-receipt-${index}.json`);
      const fake = structuredClone(canonical) as any;
      mutate(fake);
      await expect(runExternalReducedColliderHeldValidation({
        bundleRoot: fixture.root,
        benchmarkChecksum: fixture.benchmarkChecksum,
        receiptOutput: output,
      }, async () => fake)).rejects.toThrow(/Rapier receipt|Rapier validation/);
      await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects an accepted Rapier rail when the checksum-bound producer parity is held", async () => {
    const fixture = await createBundle({ heldProducerWall: true });
    const verified = await readChecksumBoundReducedColliderBundle(fixture.root, fixture.benchmarkChecksum);
    const canonical = await validateReducedColliderWalk(verified);
    const fake = structuredClone(canonical) as any;
    fake.rails.wall_stop.status = "accepted";
    fake.rails.wall_stop.reason = "reduced_capsule_stop_within_0_03m";
    fake.issues = fake.issues.filter((issue: { code: string }) => issue.code !== "producer_wall_parity_held");
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-receipt-"));
    const output = join(outputRoot, "held-receipt.json");

    await expect(runExternalReducedColliderHeldValidation({
      bundleRoot: fixture.root,
      benchmarkChecksum: fixture.benchmarkChecksum,
      receiptOutput: output,
    }, async () => fake)).rejects.toThrow("cannot be accepted while producer parity is held");
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs the built CLI once, reports the measured callback count, and preserves unrelated dist output", async () => {
    const fixture = await createBundle();
    const outputRoot = await mkdtemp(join(tmpdir(), "world-studio-reduced-cli-"));
    const output = join(outputRoot, "held-receipt.json");
    const unrelated = join(workspaceRoot, "scripts/dist/unrelated-runner-output.txt");
    await mkdir(dirname(unrelated), { recursive: true });
    await writeFile(unrelated, "preserve-me");

    try {
      const { stdout } = await execFileAsync("pnpm", [
        "validate:reduced-collider", "--",
        "--bundle-root", fixture.root,
        "--benchmark-sha256", fixture.benchmarkChecksum,
        "--out", output,
      ], { cwd: workspaceRoot, maxBuffer: 8 * 1024 * 1024 });
      const statusLine = stdout.trim().split(/\r?\n/).at(-1)!;
      const status = JSON.parse(statusLine) as Record<string, unknown>;
      expect(status.rapier_validation_invocations).toBe(1);
      expect(status.status).toBe("completed_held");
      expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ decision: "hold" });
      expect(await readFile(unrelated, "utf8")).toBe("preserve-me");

      const builtCli = join(
        workspaceRoot,
        "scripts/dist/reduced-collider-held-runner/validate-reduced-collider-held.mjs",
      );
      await expect(execFileAsync(process.execPath, [
        builtCli,
        "--bundle-root", fixture.root,
        "--benchmark-sha256", fixture.benchmarkChecksum,
        "--out", output,
      ], { cwd: workspaceRoot, maxBuffer: 8 * 1024 * 1024 })).rejects.toMatchObject({ code: 1 });
    } finally {
      await unlink(unrelated).catch(() => undefined);
    }
  }, 30_000);
});

async function createBundle(options: { inconsistentDelta?: boolean; extraAuthority?: boolean; producerErrors?: boolean; heldProducerWall?: boolean } = {}) {
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
  const heldWallSample = {
    ...sample(1, 50),
    reduced_hit_distance_meters: 0.24,
    hit_distance_delta_meters: 0.03999999999999998,
    passed: false,
  };
  const wallRail = options.heldProducerWall ? {
    ...rail(1, 50),
    status: "held",
    reason: "sampled_surface_block_parity_failed",
    passed_sample_count: 0,
    maximum_hit_distance_delta_meters: heldWallSample.hit_distance_delta_meters,
    samples: [heldWallSample],
  } : rail(1, 50);
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
      wall_stop: wallRail,
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
