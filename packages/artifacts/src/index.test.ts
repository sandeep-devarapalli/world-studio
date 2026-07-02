import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createLoftWorldSession,
  detectPlyKind,
  parseObjMesh,
  parseObjMeshSummary,
  parsePointCloudPly,
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
