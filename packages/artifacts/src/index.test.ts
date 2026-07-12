import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildGaussianPreviewPointCloudPly,
  buildPointCloudPreviewPly,
  createLoftWorldSession,
  detectPlyKind,
  parseObjMesh,
  parseObjMeshSummary,
  parsePlyMesh,
  parsePointCloudPly,
  prepareGaussianPlyForSpark,
  validateBudoMediaFramesManifest,
  validateVerifiedSemanticExportManifest,
  type LoftSceneManifest
} from "./index";
import { buildWalkCollisionCandidate } from "./collision-candidate";

const fixture = (name: string) => new URL(`../../../apps/web/public/fixtures/loft_04/${name}`, import.meta.url);

describe("World Studio artifact loaders", () => {
  it("distinguishes ordinary PLY from Gaussian PLY", async () => {
    const points = await readFile(fixture("points.ply"), "utf8");
    const gaussians = await readFile(fixture("gaussians.ply"), "utf8");

    expect(detectPlyKind(points)).toBe("ordinary-ply");
    expect(detectPlyKind(gaussians)).toBe("gaussian-ply");
  });

  it("parses the loft ordinary point cloud", async () => {
    const points = await readFile(fixture("points.ply"), "utf8");
    const parsed = parsePointCloudPly(points);

    expect(parsed.points.length).toBe(16_060);
    expect(parsed.bounds.min[1]).toBeLessThanOrEqual(0);
    expect(parsed.bounds.max[1]).toBeGreaterThan(2);
  });

  it("normalizes ASCII Gaussian PLYs for Spark", async () => {
    const gaussians = await readFile(fixture("gaussians.ply"));
    const prepared = prepareGaussianPlyForSpark(gaussians);

    expect(prepared.converted).toBe(true);
    expect(prepared.sourceFormat).toBe("ascii");
    expect(prepared.vertexCount).toBe(16_060);

    const header = new TextDecoder().decode(prepared.bytes.slice(0, prepared.headerLength));
    expect(header).toContain("format binary_little_endian 1.0");
    expect(header).toContain("element vertex 16060");

    const sourceLines = new TextDecoder().decode(gaussians).split(/\r?\n/);
    const firstDataLine = sourceLines[sourceLines.indexOf("end_header") + 1]?.trim().split(/\s+/) ?? [];
    const firstX = new DataView(prepared.bytes.buffer, prepared.bytes.byteOffset + prepared.headerLength).getFloat32(0, true);
    expect(firstX).toBeCloseTo(Number(firstDataLine[0]), 5);
  });

  it("keeps binary Gaussian PLYs unchanged for Spark", async () => {
    const gaussians = await readFile(fixture("gaussians.ply"));
    const asciiPrepared = prepareGaussianPlyForSpark(gaussians);
    const binaryPrepared = prepareGaussianPlyForSpark(asciiPrepared.bytes);

    expect(binaryPrepared.converted).toBe(false);
    expect(binaryPrepared.sourceFormat).toBe("binary_little_endian");
    expect(binaryPrepared.bytes).toBe(asciiPrepared.bytes);
  });

  it("clamps binary Gaussian PLY scales for visual review when requested", () => {
    const source = new TextEncoder().encode(`ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
0 0 0 0 0 0 1 1 1 1 1 0 0 0
`);
    const binary = prepareGaussianPlyForSpark(source).bytes;
    const prepared = prepareGaussianPlyForSpark(binary, { maxScale: 0.06 });
    const view = new DataView(prepared.bytes.buffer, prepared.bytes.byteOffset, prepared.bytes.byteLength);
    const maxLogScale = Math.log(0.06);

    expect(prepared.converted).toBe(true);
    expect(prepared.clampedScaleCount).toBe(3);
    expect(view.getFloat32(prepared.headerLength + 7 * 4, true)).toBeCloseTo(maxLogScale, 5);
    expect(view.getFloat32(prepared.headerLength + 8 * 4, true)).toBeCloseTo(maxLogScale, 5);
    expect(view.getFloat32(prepared.headerLength + 9 * 4, true)).toBeCloseTo(maxLogScale, 5);
  });

  it("normalizes binary Gaussian PLY rotations for Spark visual parity when requested", () => {
    const source = new TextEncoder().encode(`ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
0 0 0 0 0 0 1 -4 -4 -4 2 0 0 0
`);
    const binary = prepareGaussianPlyForSpark(source).bytes;
    const prepared = prepareGaussianPlyForSpark(binary, { normalizeRotations: true });
    const view = new DataView(prepared.bytes.buffer, prepared.bytes.byteOffset, prepared.bytes.byteLength);

    expect(prepared.converted).toBe(true);
    expect(prepared.normalizedRotationCount).toBe(1);
    expect(view.getFloat32(prepared.headerLength + 10 * 4, true)).toBeCloseTo(1, 5);
    expect(view.getFloat32(prepared.headerLength + 11 * 4, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(prepared.headerLength + 12 * 4, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(prepared.headerLength + 13 * 4, true)).toBeCloseTo(0, 5);
  });

  it("hides binary Gaussian PLY coordinate outliers for preview when requested", () => {
    const source = new TextEncoder().encode(`ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
0 0 0 0 0 0 2 -5 -5 -5 1 0 0 0
1000 0 0 0 0 0 2 -5 -5 -5 1 0 0 0
`);
    const binary = prepareGaussianPlyForSpark(source).bytes;
    const prepared = prepareGaussianPlyForSpark(binary, { hideOutliersBeyondRadius: 100 });
    const view = new DataView(prepared.bytes.buffer, prepared.bytes.byteOffset, prepared.bytes.byteLength);
    const stride = 14 * 4;
    const opacityOffset = 6 * 4;

    expect(prepared.converted).toBe(true);
    expect(prepared.droppedOutlierCount).toBe(1);
    expect(view.getFloat32(prepared.headerLength + opacityOffset, true)).toBeCloseTo(2, 5);
    expect(view.getFloat32(prepared.headerLength + stride + opacityOffset, true)).toBeLessThanOrEqual(-30);
    expect(view.getFloat32(prepared.headerLength + stride, true)).toBeCloseTo(1000, 3);
  });

  it("builds ordinary preview points from Gaussian PLYs", async () => {
    const gaussians = await readFile(fixture("gaussians.ply"));
    const preview = buildGaussianPreviewPointCloudPly(gaussians, { maxPoints: 64 });
    const parsed = parsePointCloudPly(preview);

    expect(detectPlyKind(preview)).toBe("ordinary-ply");
    expect(parsed.points.length).toBeLessThanOrEqual(64);
    expect(parsed.points.length).toBeGreaterThan(10);
    expect(parsed.bounds.max[1]).toBeGreaterThan(parsed.bounds.min[1]);
  });

  it("builds ordinary preview points from binary Gaussian PLYs", async () => {
    const gaussians = await readFile(fixture("gaussians.ply"));
    const binary = prepareGaussianPlyForSpark(gaussians).bytes;
    const preview = buildGaussianPreviewPointCloudPly(binary, { maxPoints: 32 });
    const parsed = parsePointCloudPly(preview);

    expect(detectPlyKind(preview)).toBe("ordinary-ply");
    expect(parsed.points.length).toBeLessThanOrEqual(32);
    expect(parsed.points[0]?.red).toBeGreaterThanOrEqual(0);
    expect(parsed.points[0]?.red).toBeLessThanOrEqual(255);
  });

  it("builds capped ordinary preview points from binary point-cloud PLYs", () => {
    const header = new TextEncoder().encode(`ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
`);
    const rows = new Uint8Array(30);
    const view = new DataView(rows.buffer);
    view.setFloat32(0, 1, true);
    view.setFloat32(4, 2, true);
    view.setFloat32(8, 3, true);
    rows.set([10, 20, 30], 12);
    view.setFloat32(15, 4, true);
    view.setFloat32(19, 5, true);
    view.setFloat32(23, 6, true);
    rows.set([40, 50, 60], 27);
    const binary = new Uint8Array(header.length + rows.length);
    binary.set(header);
    binary.set(rows, header.length);

    const preview = buildPointCloudPreviewPly(binary, {
      maxPoints: 1,
      transform: [[2, 0, 0, 10], [0, 2, 0, 20], [0, 0, 2, 30], [0, 0, 0, 1]]
    });
    expect(parsePointCloudPly(preview).points).toEqual([{ x: 12, y: 24, z: 36, red: 10, green: 20, blue: 30 }]);
  });

  it("parses and transforms classified binary ARKit mesh evidence", () => {
    const header = new TextEncoder().encode(`ply
format binary_little_endian 1.0
element vertex 4
property float x
property float y
property float z
element face 2
property list uchar uint vertex_indices
property uchar classification
end_header
`);
    const rows = new Uint8Array(4 * 12 + 2 * 14);
    const view = new DataView(rows.buffer);
    const vertices = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    vertices.forEach((vertex, index) => {
      const offset = index * 12;
      view.setFloat32(offset, vertex[0]!, true);
      view.setFloat32(offset + 4, vertex[1]!, true);
      view.setFloat32(offset + 8, vertex[2]!, true);
    });
    let offset = 48;
    for (const [indices, classification] of [[[0, 1, 2], 2], [[0, 2, 3], 1]] as Array<[number[], number]>) {
      view.setUint8(offset, 3);
      offset += 1;
      indices.forEach((index) => {
        view.setUint32(offset, index, true);
        offset += 4;
      });
      view.setUint8(offset, classification);
      offset += 1;
    }
    const binary = new Uint8Array(header.length + rows.length);
    binary.set(header);
    binary.set(rows, header.length);

    const mesh = parsePlyMesh(binary, {
      maxFaces: 1,
      transform: [[2, 0, 0, 10], [0, 2, 0, 20], [0, 0, 2, 30], [0, 0, 0, 1]]
    });

    expect(mesh.vertices[0]).toEqual([10, 20, 30]);
    expect(mesh.vertices[2]).toEqual([12, 22, 30]);
    expect(mesh.sourceVertexCount).toBe(4);
    expect(mesh.sourceFaceCount).toBe(2);
    expect(mesh.sampledFaceCount).toBe(1);
    expect(mesh.triangles).toEqual([{ a: 0, b: 1, c: 2, group: "floor", material: "capture_evidence" }]);
    expect(mesh.classificationCounts).toEqual({ floor: 1, wall: 1 });
  });

  it("accepts complete floor and wall mesh only as a local collision preview", () => {
    const mesh = parsePlyMesh(new TextEncoder().encode(`ply
format ascii 1.0
element vertex 6
property float x
property float y
property float z
element face 4
property list uchar uint vertex_indices
property uchar classification
end_header
0 0 0
2 0 0
2 0 2
0 0 2
2 2 0
2 2 2
3 0 1 2 2
3 0 2 3 2
3 1 4 5 1
3 1 5 2 1
`), { maxFaces: 10 });
    const candidate = buildWalkCollisionCandidate(mesh, {
      status: "finite_mesh_written",
      truncated: false,
      vertex_count: 6,
      triangle_count: 4,
      non_finite_vertex_count: 0
    });

    expect(candidate.report).toMatchObject({
      status: "accepted_preview",
      authority: "local_collision_preview_not_metric_authority",
      candidateTriangles: 4,
      floorAreaRatio: 1,
      wallAreaRatio: 1
    });
    expect(candidate.mesh?.triangles).toHaveLength(4);
  });

  it("holds a finite but truncated capture mesh out of collision", () => {
    const mesh = parsePlyMesh(new TextEncoder().encode(`ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 2
property list uchar uint vertex_indices
property uchar classification
end_header
0 0 0
1 0 0
1 0 1
0 0 1
3 0 1 2 2
3 0 2 3 1
`), { maxFaces: 10 });
    const candidate = buildWalkCollisionCandidate(mesh, {
      status: "finite_mesh_written",
      truncated: true,
      vertex_count: 4,
      triangle_count: 2,
      non_finite_vertex_count: 0
    });

    expect(candidate.mesh).toBeUndefined();
    expect(candidate.report).toMatchObject({ status: "held", reason: "source_mesh_truncated", truncated: true });
  });

  it("rejects invalid unsampled mesh faces", () => {
    const source = new TextEncoder().encode(`ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 2
property list uchar uint vertex_indices
property uchar classification
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2 2
3 0 1 9 1
`);

    expect(() => parsePlyMesh(source, { maxFaces: 1 })).toThrow("face 1 has an invalid vertex index");
  });

  it("rejects ordinary point-cloud PLYs for Spark Gaussian loading", async () => {
    const points = await readFile(fixture("points.ply"));

    expect(() => prepareGaussianPlyForSpark(points)).toThrow("Expected Gaussian PLY");
  });

  it("summarizes the loft collision OBJ", async () => {
    const mesh = await readFile(fixture("collision_mesh.obj"), "utf8");
    const parsed = parseObjMeshSummary(mesh);

    expect(parsed.vertices).toBeGreaterThan(0);
    expect(parsed.faces).toBeGreaterThan(0);
    expect(parsed.groups.length).toBeGreaterThan(1);

    const renderable = parseObjMesh(mesh);
    expect(renderable.vertices.length).toBe(parsed.vertices);
    expect(renderable.triangles.length).toBeGreaterThanOrEqual(parsed.faces);
    expect(renderable.triangles[0]?.group).toBeTruthy();
  });

  it("stamps fixture provenance", async () => {
    const scene = JSON.parse(await readFile(fixture("scene.json"), "utf8")) as LoftSceneManifest;
    const session = createLoftWorldSession(scene, "/fixtures/loft_04");

    expect(session.provenance.loadedVia).toBe("/fixtures/loft_04");
    expect(session.provenance.primaryArtifact).toBe("gaussians.ply");
    expect(session.classes).toHaveLength(9);
  });

  it("validates Budo media and verified export contracts", () => {
    expect(validateBudoMediaFramesManifest({ frames: [] }).frames).toHaveLength(0);
    expect(() =>
      validateVerifiedSemanticExportManifest({
        schema: "budo.semantic_labels.verified_export.v0.1",
        status: "human_verified_semantic_labels",
        component_count: 57,
        files: { verified_point_cloud: "frame14.ply" },
        human_signoff: { name: "reviewer" },
        hashes: { "frame14.ply": "abc" },
        boundary: "semantic labels only"
      })
    ).not.toThrow();
  });
});
