import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { stableCanonicalJson } from "@world-studio/world-core";

import {
  CaptureSplatHybridWorldPackageError,
  publishCaptureSplatHybridWorldPackage,
} from "./capture-splat-hybrid-world-package.js";
import { CanonicalWorldPackageStore } from "./world-package-store.js";

const roots: string[] = [];

interface Fixture {
  root: string;
  handoffRoot: string;
  tsdfRoot: string;
  hybridRoot: string;
  compileRoot: string;
  store: CanonicalWorldPackageStore;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Capture Splat hybrid canonical WorldPackage", () => {
  it("publishes metric and collision evidence as held without physics authority", async () => {
    const fixture = await makeFixture();

    const result = await publishFixture(fixture);
    const opened = await fixture.store.openVersion(result.publication.reference);

    expect(result.publication.status).toBe("accepted");
    expect(opened.manifest).toEqual(result.manifest);
    expect(result.manifest.readiness).toMatchObject({
      visual: { status: "held" },
      metric: { status: "held" },
      collision: { status: "held" },
      navigation: { status: "unavailable" },
      semantic: { status: "unavailable" },
      physics: { status: "unavailable" },
    });
    expect(result.manifest.artifacts.find((item) => item.artifact_id === "hybrid_structural_surface")).toMatchObject({
      role: "metric_mesh", authority: { domain: "metric", status: "held" },
    });
    expect(result.manifest.artifacts.find((item) => item.artifact_id === "collider_candidate")).toMatchObject({
      role: "collision_mesh", authority: { domain: "collision", status: "held" },
    });
    expect(result.manifest.artifacts.some((item) => item.role === "physics_parameters")).toBe(false);
    expect(result.manifest.artifacts.find((item) => item.artifact_id === "spirula_gaussian_appearance")).toMatchObject({
      role: "visual_splat",
      frame_id: "trainer_world",
      transform_id: "arkit_from_trainer",
      authority: { domain: "visual", status: "held" },
    });
    expect(result.manifest.artifacts.find((item) => item.artifact_id === "colmap_camera_poses")).toMatchObject({
      frame_id: "colmap_world", transform_id: "arkit_from_colmap",
    });
    expect(result.manifest.transform_graph.edges.map((edge) => edge.transform_id)).toEqual([
      "arkit_from_colmap", "arkit_from_trainer",
    ]);
    expect(await fixture.store.readReferencedBytes(opened.reference, "visual/splat.ply", 4096)).toEqual(gaussianPly());
    expect(opened.referenceInventory).toHaveLength(13);
  });

  it("is deterministic and lets the canonical store classify an identical publication as duplicate", async () => {
    const fixture = await makeFixture();
    const first = await publishFixture(fixture);
    fixture.compileRoot = join(fixture.root, "compile-second");

    const second = await publishFixture(fixture);

    expect(second.publication.status).toBe("duplicate");
    expect(second.publication.reference).toEqual(first.publication.reference);
    expect(second.manifest).toEqual(first.manifest);
  });

  it("rejects changed bytes, symlinks, and unreferenced derived output files", async () => {
    const gaussian = await makeFixture();
    await writeFile(join(gaussian.handoffRoot, "splat.ply"), "tampered-gaussian");
    await expect(publishFixture(gaussian)).rejects.toThrow(/ready checksum-bound consumer receipt/);

    const changed = await makeFixture();
    await writeFile(join(changed.hybridRoot, "hybrid_structural_surface.ply"), Buffer.from("changed"));
    await expect(publishFixture(changed)).rejects.toThrow(/report binding|declared topology/);

    const linked = await makeFixture();
    const target = join(linked.root, "outside.ply");
    await writeFile(target, surfacePlys(false, 0).hybrid);
    await rm(join(linked.hybridRoot, "hybrid_structural_surface.ply"));
    await symlink(target, join(linked.hybridRoot, "hybrid_structural_surface.ply"));
    await expect(publishFixture(linked)).rejects.toThrow(/exactly its declared regular output files/);

    const extra = await makeFixture();
    await writeFile(join(extra.tsdfRoot, "unbound.bin"), "extra");
    await expect(publishFixture(extra)).rejects.toThrow(/exactly its declared regular output files/);
  });

  it("rejects receipt-bound non-Gaussian PLY bytes and invalid surface records", async () => {
    const gaussian = await makeFixture({ invalidGaussian: true });
    await expect(publishFixture(gaussian)).rejects.toThrow(/Gaussian PLY/);

    const degenerate = await makeFixture({ degenerateSurface: true });
    await expect(publishFixture(degenerate)).rejects.toThrow(/degenerate triangle/);

    const mapping = await makeFixture({ sourceFaceIndex: 1 });
    await expect(publishFixture(mapping)).rejects.toThrow(/source_face_index is not identity zero-based/);
  });

  it("rejects authority elevation and non-metric coordinate declarations", async () => {
    const authority = await makeFixture();
    await mutateJson(join(authority.hybridRoot, "capture_splat_hybrid_surface_report.json"), (report) => {
      (report.authority as Record<string, unknown>).physics_authority = true;
    });
    await expect(publishFixture(authority)).rejects.toThrow(/physics_authority must be false/);

    const units = await makeFixture();
    await mutateJson(join(units.hybridRoot, "capture_splat_hybrid_surface_report.json"), (report) => {
      (report.coordinate_contract as Record<string, unknown>).units = "feet";
    });
    await expect(publishFixture(units)).rejects.toThrow(/hybrid units must be "meters"/);
  });

  it("binds declared registration scales to their similarity matrices", async () => {
    const sourceScale = await makeFixture();
    await mutateJson(join(sourceScale.handoffRoot, "capture-splat.world-studio.json"), (handoff) => {
      (handoff.metric_registration as Record<string, unknown>).scale = 2;
    });
    await expect(publishFixture(sourceScale)).rejects.toThrow(/scale differs from the arkit_to_colmap similarity scale/);

    const targetScale = await makeFixture();
    await mutateJson(join(targetScale.handoffRoot, "capture-splat.world-studio.json"), (handoff) => {
      const registration = handoff.metric_registration as Record<string, unknown>;
      registration.target_units_per_meter = 2;
      registration.meters_per_target_unit = 0.5;
    });
    await expect(publishFixture(targetScale)).rejects.toThrow(/target units per meter differs from the arkit_to_target similarity scale/);

    const tinyShear = await makeFixture();
    await mutateJson(join(tinyShear.handoffRoot, "capture-splat.world-studio.json"), (handoff) => {
      const scale = 1e-5;
      const matrix = [
        [scale, 0.5 * scale, 0, 0],
        [0, Math.sqrt(0.75) * scale, 0, 0],
        [0, 0, scale, 0],
        [0, 0, 0, 1],
      ];
      const registration = handoff.metric_registration as Record<string, unknown>;
      registration.colmap_to_target = matrix;
      registration.arkit_to_target = matrix;
      registration.target_units_per_meter = scale;
      registration.meters_per_target_unit = 1 / scale;
      handoff.dataparser_transform = matrix;
    });
    await expect(publishFixture(tinyShear)).rejects.toThrow(/right-handed uniform similarity/);

    const tinyScalarMismatch = await makeFixture();
    await mutateJson(join(tinyScalarMismatch.handoffRoot, "capture-splat.world-studio.json"), (handoff) => {
      const matrix = uniformScale(1.1e-9);
      const registration = handoff.metric_registration as Record<string, unknown>;
      registration.matrix = matrix;
      registration.arkit_to_colmap = matrix;
      registration.arkit_to_target = matrix;
      registration.scale = 2e-9;
      registration.target_units_per_meter = 1.1e-9;
      registration.meters_per_target_unit = 1 / 1.1e-9;
    });
    await expect(publishFixture(tinyScalarMismatch)).rejects.toThrow(/scale differs from the arkit_to_colmap similarity scale/);

    const tinyCompositionMismatch = await makeFixture();
    await mutateJson(join(tinyCompositionMismatch.handoffRoot, "capture-splat.world-studio.json"), (handoff) => {
      const colmapToTarget = uniformScale(1.1e-9);
      const arkitToTarget = uniformScale(1.19e-9);
      const registration = handoff.metric_registration as Record<string, unknown>;
      registration.colmap_to_target = colmapToTarget;
      registration.arkit_to_target = arkitToTarget;
      registration.target_units_per_meter = 1.19e-9;
      registration.meters_per_target_unit = 1 / 1.19e-9;
      handoff.dataparser_transform = colmapToTarget;
    });
    await expect(publishFixture(tinyCompositionMismatch)).rejects.toThrow(/does not compose from its declared transforms/);
  });

  it("rejects broken cross-report bindings and topology claims", async () => {
    const binding = await makeFixture();
    await mutateJson(join(binding.hybridRoot, "capture_splat_hybrid_collider_candidate_report.json"), (report) => {
      ((report.inputs as Record<string, unknown>).tsdf_mesh as Record<string, unknown>).checksum = sha256("wrong");
    });
    await expect(publishFixture(binding)).rejects.toThrow(/collider TSDF binding differs/);

    const topology = await makeFixture();
    await mutateJson(join(topology.hybridRoot, "capture_splat_hybrid_surface_report.json"), (report) => {
      (report.topology as Record<string, unknown>).source_triangle_count = 2;
    });
    await expect(publishFixture(topology)).rejects.toThrow(/preserve TSDF vertex and triangle counts|source triangle count/);

    const digest = await makeFixture();
    await mutateJson(join(digest.hybridRoot, "capture_splat_hybrid_surface_report.json"), (report) => {
      ((report.inputs as Record<string, unknown>).registration as Record<string, unknown>).digest = sha256("unrelated");
    });
    await expect(publishFixture(digest)).rejects.toThrow(/hybrid registration digest/);
  });

  it("rejects non-hybrid PLY layouts even when the report is rebound", async () => {
    const fixture = await makeFixture();
    const bad = Buffer.from("ply\nformat ascii 1.0\nend_header\n");
    await writeFile(join(fixture.hybridRoot, "hybrid_structural_surface.ply"), bad);
    await writeFile(join(fixture.hybridRoot, "collider_candidate.ply"), bad);
    await mutateJson(join(fixture.hybridRoot, "capture_splat_hybrid_surface_report.json"), (report) => {
      (report.output as Record<string, unknown>).hybrid_surface = ref("hybrid_structural_surface.ply", bad);
    });
    const hybridReportBytes = await readFile(join(fixture.hybridRoot, "capture_splat_hybrid_surface_report.json"));
    await mutateJson(join(fixture.hybridRoot, "capture_splat_hybrid_collider_candidate_report.json"), (report) => {
      (report.inputs as Record<string, unknown>).hybrid_surface = ref("hybrid_structural_surface.ply", bad);
      (report.inputs as Record<string, unknown>).hybrid_report = ref("capture_splat_hybrid_surface_report.json", hybridReportBytes);
      report.candidate = ref("collider_candidate.ply", bad);
    });

    await expect(publishFixture(fixture)).rejects.toThrow(/PLY header|PLY layout/);
  });

  it("canonicalizes future roots before enforcing the immutable-input boundary", async () => {
    const fixture = await makeFixture();
    const alias = join(fixture.root, "handoff-alias");
    await symlink(fixture.handoffRoot, alias);
    fixture.compileRoot = join(alias, "generated-world-package");

    await expect(publishFixture(fixture)).rejects.toThrow(/disjoint after canonical path resolution/);
  });

  it("rejects future roots that alias by ASCII case on case-insensitive filesystems", async () => {
    const fixture = await makeFixture();
    fixture.compileRoot = join(fixture.root, "Future");
    fixture.store = new CanonicalWorldPackageStore(join(fixture.root, "future", "store"));

    await expect(publishFixture(fixture)).rejects.toThrow(/disjoint after canonical path resolution/);
  });
});

async function makeFixture(options: {
  invalidGaussian?: boolean;
  degenerateSurface?: boolean;
  sourceFaceIndex?: number;
} = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "world-studio-hybrid-package-"));
  roots.push(root);
  const handoffRoot = join(root, "handoff");
  const tsdfRoot = join(root, "tsdf");
  const hybridRoot = join(root, "hybrid");
  await Promise.all([mkdir(handoffRoot), mkdir(tsdfRoot), mkdir(hybridRoot)]);

  await write(handoffRoot, "images/frame.jpg", "image");
  await write(handoffRoot, "depth/frame.npy", "depth");
  await write(handoffRoot, "sparse/0/images.txt", "# registered images\n");
  await write(handoffRoot, "navigation_mesh.ply", "ply\n");
  await write(handoffRoot, "splat.ply", options.invalidGaussian ? Buffer.from("not-a-gaussian-ply") : gaussianPly());
  await write(handoffRoot, "navigation_mesh_report.json", json({
    schema: "capture_splat.arkit_mesh_report.v0.1",
    status: "finite_mesh_written",
    ply_written: true,
    non_finite_vertex_count: 0,
    vertex_count: 3,
    triangle_count: 1,
    truncated: true,
    classification_counts: { floor: 1 },
  }));
  await write(handoffRoot, "capture.json", json({
    schema: "capture_splat.v0.3",
    session_config: { scale_authority: "arkit_vio_metric", up_axis: [0, 1, 0], world_alignment: "gravity" },
    frames: [{ rgb: "images/frame.jpg", depth: "depth/frame.npy" }],
  }));

  const imageRef = await fileRef(handoffRoot, "images/frame.jpg");
  const depthRef = await fileRef(handoffRoot, "depth/frame.npy");
  const sourceFrame = { rgb_path: imageRef.path, size_bytes: imageRef.size_bytes, checksum: imageRef.checksum };
  const registration = {
    schema: "capture_splat.metric_registration.v0.1",
    status: "accepted",
    accepted: true,
    source_coordinate_frame: "arkit_world",
    source_units: "meters",
    intermediate_coordinate_frame: "colmap_world",
    target_coordinate_frame: "trainer_world",
    target_units: "normalized_scene_units",
    target_units_per_meter: 1,
    meters_per_target_unit: 1,
    matched_cameras: 1,
    scale: 1,
    matrix: identity(),
    arkit_to_colmap: identity(),
    colmap_to_target: identity(),
    arkit_to_target: identity(),
    authority: {
      camera_center_alignment_evidence: true,
      metric_mesh_registration_candidate: true,
      collision_authority: false,
      navigation_authority: false,
      quality_claim: false,
    },
  };
  const handoff = {
    schema: "capture_splat.world_studio_handoff.v0.3",
    status: "visual_evidence_with_3dgs_proposal",
    authority: {
      metric_authority: false,
      semantic_authority: false,
      collision_authority: false,
      navigation_authority: false,
      quality_claim: false,
    },
    world_up: [0, 1, 0],
    world_up_coordinate_frame: "arkit_world",
    source_frames: [sourceFrame],
    frames: [sourceFrame],
    assets: {
      capture_manifest: await fileRef(handoffRoot, "capture.json"),
      gaussian_ply: {
        ...await fileRef(handoffRoot, "splat.ply"),
        source_name: "point_cloud_alpha_pruned.ply",
        variant: "alpha_pruned",
      },
      colmap_sparse: { "images.txt": await fileRef(handoffRoot, "sparse/0/images.txt") },
      navigation_mesh: {
        ...await fileRef(handoffRoot, "navigation_mesh.ply"),
        coordinate_frame: "arkit_world",
        units: "meters",
        authority: "metric_capture_evidence",
      },
      mesh_report: {
        ...await fileRef(handoffRoot, "navigation_mesh_report.json"),
        coordinate_frame: "arkit_world",
        units: "meters",
        authority: "capture_evidence_report",
      },
    },
    capture_manifest_assets: {
      schema: "capture_splat.capture_manifest_assets.v0.1",
      verification: "source_destination_size_and_sha256",
      complete: true,
      decision: "ready",
      assets: [imageRef, depthRef],
      reference_count: 2,
      unique_asset_count: 2,
      duplicate_reference_count: 0,
      verified_asset_count: 2,
      copied: 1,
      existing: 1,
      copied_paths: ["depth/frame.npy"],
      missing: [],
      conflicts: [],
    },
    metric_registration: registration,
    dataparser_transform: identity(),
  };
  await write(handoffRoot, "capture-splat.world-studio.json", json(handoff));

  const surfaces = surfacePlys(options.degenerateSurface === true, options.sourceFaceIndex ?? 0);
  const tsdfMesh = surfaces.tsdf;
  await write(tsdfRoot, "rgbd_tsdf_mesh.ply", tsdfMesh);
  const coordinate = { scale_authority: "arkit_vio_metric", up_axis: [0, 1, 0], world_alignment: "gravity" };
  const handoffRef = await fileRef(handoffRoot, "capture-splat.world-studio.json");
  const tsdfReport = {
    schema: "capture_splat.rgbd_tsdf_report.v0.1",
    decision: "hold",
    software_surface_candidate: "hold",
    authority: falseAuthority({ metric_geometry_authority: false }),
    inputs: {
      handoff_manifest: handoffRef,
      capture_manifest: handoff.assets.capture_manifest,
      colmap_images: handoff.assets.colmap_sparse["images.txt"],
    },
    coordinate_contract: { output_coordinate_frame: "arkit_world", units: "meters", capture_declaration: coordinate },
    mesh: {
      ...ref("rgbd_tsdf_mesh.ply", tsdfMesh),
      coordinate_frame: "arkit_world",
      units: "meters",
      coordinate_declaration: coordinate,
      finite: true,
      budget_limited: false,
      vertex_count: 3,
      triangle_count: 1,
      non_finite_vertex_count: 0,
      non_finite_normal_count: 0,
      invalid_index_triangle_count: 0,
      degenerate_triangle_count: 0,
    },
    performance: { decision: "hold" },
  };
  await write(tsdfRoot, "capture_splat_rgbd_tsdf_report.json", json(tsdfReport));

  const surface = surfaces.hybrid;
  await write(hybridRoot, "hybrid_structural_surface.ply", surface);
  await write(hybridRoot, "collider_candidate.ply", surface);
  const topology = {
    source_vertex_count: 3,
    source_triangle_count: 1,
    output_vertex_count: 3,
    output_triangle_count: 1,
    vertex_records_copied_byte_for_byte: true,
    triangle_indices_preserved_in_source_order: true,
    source_face_index_mapping: "identity_zero_based",
    synthetic_geometry_added: false,
    fallback_floor_added: false,
    simplification_applied: false,
  };
  const hybridReport = {
    schema: "capture_splat.hybrid_structural_surface.v0.1",
    status: "held",
    decision: "hold",
    reason: "validation_pending",
    authority: falseAuthority(),
    inputs: {
      handoff_manifest: handoffRef,
      capture_manifest: handoff.assets.capture_manifest,
      colmap_images: handoff.assets.colmap_sparse["images.txt"],
      tsdf_report: await fileRef(tsdfRoot, "capture_splat_rgbd_tsdf_report.json"),
      tsdf_mesh: ref("rgbd_tsdf_mesh.ply", tsdfMesh),
      navigation_mesh: handoff.assets.navigation_mesh,
      navigation_mesh_report: handoff.assets.mesh_report,
      registration: {
        schema: registration.schema,
        status: registration.status,
        matched_cameras: registration.matched_cameras,
        source_coordinate_frame: registration.source_coordinate_frame,
        source_units: registration.source_units,
        digest: sha256(Buffer.from(stableCanonicalJson(registration), "utf8")),
      },
    },
    coordinate_contract: {
      coordinate_frame: "arkit_world",
      units: "meters",
      capture_declaration: coordinate,
      tsdf_and_arkit_share_input_frame: true,
    },
    topology,
    semantics: { transferred_face_count: 1, unknown_face_count: 0, partition_invariant: true },
    rails: {
      doorway_clearance: { status: "held" },
      physical_validation: { status: "pending" },
    },
    output: { hybrid_surface: ref("hybrid_structural_surface.ply", surface) },
  };
  await write(hybridRoot, "capture_splat_hybrid_surface_report.json", json(hybridReport));
  const hybridReportBytes = await readFile(join(hybridRoot, "capture_splat_hybrid_surface_report.json"));
  await write(hybridRoot, "capture_splat_hybrid_collider_candidate_report.json", json({
    schema: "capture_splat.hybrid_collider_candidate.v0.1",
    status: "held",
    decision: "hold",
    reason: "validation_pending",
    authority: falseAuthority(),
    inputs: {
      hybrid_surface: ref("hybrid_structural_surface.ply", surface),
      hybrid_report: ref("capture_splat_hybrid_surface_report.json", hybridReportBytes),
      tsdf_mesh: ref("rgbd_tsdf_mesh.ply", tsdfMesh),
    },
    candidate: ref("collider_candidate.ply", surface),
    coordinate_contract: { coordinate_frame: "arkit_world", units: "meters" },
    topology,
    triangle_budget: { limit: 60_000, observed: 1, status: "within", simplification_applied: false },
    semantic_partition: { transferred_face_count: 1, unknown_face_count: 0, partition_invariant: true },
    rails: {
      doorway_clearance: "held_unresolved",
      wall_and_opening_continuity: "held_weak",
      unknown_coverage: "software_only_complete",
      physical_collision_probes: "pending_none_recorded",
      fallback_floor: "not_added",
      synthetic_geometry: "not_added",
    },
  }));

  return {
    root,
    handoffRoot,
    tsdfRoot,
    hybridRoot,
    compileRoot: join(root, "compile"),
    store: new CanonicalWorldPackageStore(join(root, "store")),
  };
}

async function publishFixture(fixture: Fixture) {
  return publishCaptureSplatHybridWorldPackage({
    handoffRoot: fixture.handoffRoot,
    tsdfRoot: fixture.tsdfRoot,
    hybridRoot: fixture.hybridRoot,
    compilationRoot: fixture.compileRoot,
    store: fixture.store,
    worldId: "room_01",
    versionId: "room_01_hybrid_v1",
    createdAt: "2026-08-22T12:00:00.000Z",
    producerVersion: "0.1.0",
    runId: "room_01_fixture",
  });
}

async function write(root: string, relativePath: string, bytes: Uint8Array | string): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function fileRef(root: string, relativePath: string) {
  return ref(relativePath, await readFile(join(root, relativePath)));
}

function ref(path: string, bytes: Uint8Array | string) {
  const data = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  return { path, size_bytes: data.byteLength, checksum: sha256(data) };
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function identity(): number[][] {
  return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
}

function uniformScale(scale: number): number[][] {
  return [[scale, 0, 0, 0], [0, scale, 0, 0], [0, 0, scale, 0], [0, 0, 0, 1]];
}

function falseAuthority(extra: Record<string, boolean> = {}) {
  return {
    metric_authority: false,
    semantic_authority: false,
    collision_authority: false,
    navigation_authority: false,
    measurement_authority: false,
    physics_authority: false,
    newton_authority: false,
    quality_claim: false,
    ...extra,
  };
}

function gaussianPly(): Buffer {
  const properties = [
    "x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
  ];
  const header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\nelement vertex 1\n${properties.map((name) => `property float ${name}`).join("\n")}\nend_header\n`,
    "ascii",
  );
  const row = Buffer.alloc(properties.length * 4);
  row.writeFloatLE(1, properties.indexOf("rot_0") * 4);
  return Buffer.concat([header, row]);
}

function surfacePlys(degenerate: boolean, sourceFaceIndex: number): { tsdf: Buffer; hybrid: Buffer } {
  const vertexHeader =
    "element vertex 3\nproperty double x\nproperty double y\nproperty double z\nproperty double nx\nproperty double ny\nproperty double nz\n"
    + "property uchar red\nproperty uchar green\nproperty uchar blue\n";
  const tsdfHeader = Buffer.from(
    `ply\nformat binary_little_endian 1.0\ncomment Created by Open3D\n${vertexHeader}`
    + "element face 1\nproperty list uchar uint vertex_indices\nend_header\n",
    "ascii",
  );
  const hybridHeader = Buffer.from(
    "ply\nformat binary_little_endian 1.0\ncomment Capture Splat hybrid structural evidence; no physics authority\n"
    + vertexHeader + "element face 1\nproperty list uchar uint vertex_indices\n"
    + "property uchar semantic_classification\nproperty uchar semantic_support\nproperty uint source_face_index\nend_header\n",
    "ascii",
  );
  const vertices = Buffer.alloc(3 * 51);
  const positions = [[0, 0, 0], [1, 0, 0], degenerate ? [2, 0, 0] : [0, 1, 0]];
  for (let vertex = 0; vertex < positions.length; vertex += 1) {
    const offset = vertex * 51;
    for (let axis = 0; axis < 3; axis += 1) vertices.writeDoubleLE(positions[vertex]![axis]!, offset + axis * 8);
    vertices.writeDoubleLE(1, offset + 5 * 8);
  }
  const face = Buffer.alloc(13);
  face.writeUInt8(3, 0);
  face.writeUInt32LE(0, 1);
  face.writeUInt32LE(1, 5);
  face.writeUInt32LE(2, 9);
  const hybridFace = Buffer.alloc(19);
  face.copy(hybridFace);
  hybridFace.writeUInt8(1, 13);
  hybridFace.writeUInt8(4, 14);
  hybridFace.writeUInt32LE(sourceFaceIndex, 15);
  return {
    tsdf: Buffer.concat([tsdfHeader, vertices, face]),
    hybrid: Buffer.concat([hybridHeader, vertices, hybridFace]),
  };
}

async function mutateJson(file: string, mutate: (value: Record<string, unknown>) => void): Promise<void> {
  const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  mutate(value);
  await writeFile(file, json(value));
}
