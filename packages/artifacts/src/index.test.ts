import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildGaussianPreviewPointCloudPly,
  createLoftWorldSession,
  detectPlyKind,
  parseObjMesh,
  parseObjMeshSummary,
  parsePointCloudPly,
  prepareGaussianPlyForSpark,
  validateBudoMediaFramesManifest,
  validateVerifiedSemanticExportManifest,
  type LoftSceneManifest
} from "./index";

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
