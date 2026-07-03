import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readLocalPackage } from "./package-reader.js";

const tempRoots: string[] = [];

async function makePackage(name: string) {
  const root = await mkdtemp(join(tmpdir(), `world-studio-${name}-`));
  tempRoots.push(root);
  return root;
}

async function writeJson(root: string, relativePath: string, value: unknown) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readLocalPackage validation", () => {
  it("loads a real renderable package without validation issues", async () => {
    const root = await makePackage("valid");
    await writeFile(join(root, "scene.json"), JSON.stringify({
      dataset: "reader_fixture",
      version: "v1",
      up_axis: "y",
      units: "meters",
      points_total: 1,
      classes: [{ label: 1, name: "floor", points: 1 }]
    }));
    await writeFile(join(root, "points.ply"), `ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property int semantic_label
end_header
0 0 0 255 255 255 1`);

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("world-studio-local-folder");
    expect(payload.primaryArtifact).toBe("points.ply");
    expect(payload.sceneJson).toMatchObject({ dataset: "reader_fixture" });
    expect(payload.packageIssues).toEqual([]);
  });

  it("reports malformed JSON and invalid scene shape from real files", async () => {
    const root = await makePackage("bad-json");
    await mkdir(join(root, "metadata"));
    await writeFile(join(root, "scene.json"), JSON.stringify({ nope: true }));
    await writeFile(join(root, "metadata", "bad.json"), "{ nope");

    const payload = await readLocalPackage(root);

    expect(payload.sceneJson).toBeUndefined();
    expect(payload.packageIssues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["malformed_json", "unsupported_layout", "missing_primary_artifact"])
    );
    expect(payload.packageIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "malformed_json", artifact: "metadata/bad.json" }),
        expect.objectContaining({ code: "unsupported_layout", artifact: "scene.json" })
      ])
    );
  });

  it("reports oversized known binary assets without reading them", async () => {
    const root = await makePackage("oversized");
    const gaussianPath = join(root, "gaussians.ply");
    await writeFile(gaussianPath, "");
    await truncate(gaussianPath, 96 * 1024 * 1024 + 1);

    const payload = await readLocalPackage(root);

    expect(payload.gaussianPly).toBeUndefined();
    expect(payload.primaryArtifact).toBe("folder");
    expect(payload.packageIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "file_too_large", artifact: "gaussians.ply" }),
        expect.objectContaining({ code: "unsupported_layout" })
      ])
    );
  });

  it("reports unsupported empty folders", async () => {
    const root = await makePackage("empty");

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("external-local-folder");
    expect(payload.primaryArtifact).toBe("folder");
    expect(payload.packageInsights).toEqual([]);
    expect(payload.packageIssues).toEqual([
      expect.objectContaining({ code: "unsupported_layout", severity: "error" })
    ]);
  });
});

describe("readLocalPackage compatibility layouts", () => {
  it("classifies native World Studio folders with Gaussian, point, and mesh assets", async () => {
    const root = await makePackage("world-studio-compat");
    await writeJson(root, "scene.json", {
      dataset: "loft_compat",
      version: "v1",
      up_axis: "y",
      units: "meters",
      points_total: 2,
      classes: [
        { label: 1, name: "floor", points: 1 },
        { label: 2, name: "table", points: 1 }
      ]
    });
    await writeFile(join(root, "gaussians.ply"), "ply\nformat binary_little_endian 1.0\nend_header\n");
    await writeFile(join(root, "points.ply"), `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property int semantic_label
end_header
0 0 0 1
1 0 0 2`);
    await writeFile(join(root, "collision_mesh.obj"), "o floor\nv 0 0 0\nv 1 0 0\nv 0 0 1\nf 1 2 3\n");

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("world-studio-local-folder");
    expect(payload.sourceKind).toBe("world-studio.local_folder");
    expect(payload.authorityStatus).toBe("visual_evidence");
    expect(payload.primaryArtifact).toBe("gaussians.ply");
    expect(payload.companionArtifacts).toEqual(
      expect.arrayContaining(["scene.json", "gaussians.ply", "points.ply", "collision_mesh.obj"])
    );
    expect(payload.packageInsights.map((insight) => insight.kind)).toEqual(
      expect.arrayContaining(["asset-set", "scene-manifest"])
    );
    expect(payload.packageIssues).toEqual([]);
  });

  it("keeps generic JSON folders external and proposal-scoped", async () => {
    const root = await makePackage("generic-json-compat");
    await writeJson(root, "manifest.json", {
      schema: "world.generic.v1",
      title: "External metadata package",
      source: "fixture",
      tags: ["inspection", "metadata"]
    });
    await writeJson(root, "metadata/source.json", {
      kind: "sensor-summary",
      camera_count: 3,
      notes: "No renderable assets included."
    });

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("external-local-folder");
    expect(payload.sourceKind).toBe("external.local_folder");
    expect(payload.authorityStatus).toBe("proposal_not_ground_truth");
    expect(payload.primaryArtifact).toBe("manifest.json");
    expect(payload.jsonManifests.map((file) => file.relativePath)).toEqual(["manifest.json", "metadata/source.json"]);
    expect(payload.packageInsights.map((insight) => insight.kind)).toEqual(["json-manifest", "json-manifest"]);
    expect(payload.packageIssues).toEqual([
      expect.objectContaining({ code: "missing_primary_artifact", severity: "warning" })
    ]);
  });

  it("classifies Budo-compatible media and figure manifests without requiring renderable assets", async () => {
    const root = await makePackage("budo-compat");
    await writeJson(root, "budo.media_frames.v0.8.json", {
      schema: "budo.media_frames.v0.8",
      source_kind: "budo.capture",
      frames: [
        { display_name: "frame 1", rgb_path: "rgb/0001.jpg", width: 1920, height: 1080 },
        { display_name: "frame 2", rgb_path: "rgb/0002.jpg", width: 1920, height: 1080 }
      ]
    });
    await writeJson(root, "budo.article_figure_3d_views.v0.1.json", {
      schema: "budo.article_figure_3d_views.v0.1",
      views: [
        { display_name: "overview", point_cloud_path: "points.ply", mesh_paths: ["collision_mesh.obj"] }
      ]
    });

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("budo-media-bundle");
    expect(payload.sourceKind).toBe("budo.local_folder");
    expect(payload.authorityStatus).toBe("visual_evidence");
    expect(payload.primaryArtifact).toBe("budo.media_frames.v0.8.json");
    expect(payload.packageInsights.map((insight) => insight.kind)).toEqual(["media-frames", "figure-views"]);
    expect(payload.packageIssues).toEqual([]);
  });

  it("classifies verified exports as human-verified semantic boundaries", async () => {
    const root = await makePackage("verified-export-compat");
    await writeJson(root, "verified_export/manifest.json", {
      schema: "budo.verified_export.v1",
      status: "verified",
      boundary: "human-reviewed semantic export",
      component_count: 4,
      files: {
        labels: "labels.json",
        points: "semantic_points.ply"
      },
      hashes: {
        labels: "sha256:labels",
        points: "sha256:points"
      }
    });

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("verified-semantic-export");
    expect(payload.sourceKind).toBe("budo.local_folder");
    expect(payload.authorityStatus).toBe("human_verified_semantic_labels");
    expect(payload.primaryArtifact).toBe("verified_export/manifest.json");
    expect(payload.packageInsights.map((insight) => insight.kind)).toEqual(["verified-export"]);
    expect(payload.packageIssues).toEqual([]);
  });
});
