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
