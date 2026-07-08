import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readLocalPackage } from "./package-reader.js";

const tempRoots: string[] = [];
const loftFixtureRoot = () => fileURLToPath(new URL("../../../apps/web/public/fixtures/loft_04", import.meta.url));
const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcunXrfwAJpwP6J7EkXwAAAABJRU5ErkJggg==", "base64");

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
    expect(payload.assetManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "points.ply",
          sizeBytes: expect.any(Number),
          checksum: expect.stringMatching(/^fnv1a32:/)
        })
      ])
    );
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
    await truncate(gaussianPath, 384 * 1024 * 1024 + 1);

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
    expect(payload.assetManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "scene.json", checksum: expect.stringMatching(/^fnv1a32:/) }),
        expect.objectContaining({ relativePath: "gaussians.ply", sizeBytes: expect.any(Number) }),
        expect.objectContaining({ relativePath: "points.ply", sizeBytes: expect.any(Number) }),
        expect.objectContaining({ relativePath: "collision_mesh.obj", sizeBytes: expect.any(Number) })
      ])
    );
    expect(payload.packageInsights.map((insight) => insight.kind)).toEqual(
      expect.arrayContaining(["asset-set", "scene-manifest"])
    );
    expect(payload.packageIssues).toEqual([]);
  });

  it("reads the bundled loft fixture through the real local package reader", async () => {
    const payload = await readLocalPackage(loftFixtureRoot());

    expect(payload.packageKind).toBe("world-studio-local-folder");
    expect(payload.sourceKind).toBe("world-studio.local_folder");
    expect(payload.primaryArtifact).toBe("gaussians.ply");
    expect(payload.sceneJson).toMatchObject({ dataset: "loft_04", version: "v3" });
    expect(payload.pointsPly?.relativePath).toBe("points.ply");
    expect(payload.gaussianPly?.relativePath).toBe("gaussians.ply");
    expect(payload.gaussianPly?.headerText).toContain("format ascii 1.0");
    expect(payload.objMesh?.relativePath).toBe("collision_mesh.obj");
    expect(payload.packageIssues).toEqual([]);
  });

  it("re-imports a selected World Studio cleaned ordinary PLY export", async () => {
    const root = await makePackage("cleaned-ply");
    const cleanedFile = "world-studio-cleaned-loft_04.ply";
    const cleanedPath = join(root, cleanedFile);
    await writeFile(cleanedPath, `ply
format ascii 1.0
comment generated_by World Studio cleaned ordinary PLY export v0.1
comment authority proposal
comment boundary ordinary point-cloud PLY only; Gaussian/splat payloads are not written here
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property int semantic_label
end_header
0 0 0 255 255 255 1
1 0 0 200 150 100 2`);

    const payload = await readLocalPackage(cleanedPath);

    expect(payload.name).toBe("world-studio-cleaned-loft_04");
    expect(payload.sourcePath).toBe(cleanedPath);
    expect(payload.sourceKind).toBe("world-studio.cleaned_ply");
    expect(payload.packageKind).toBe("world-studio-cleaned-ply");
    expect(payload.authorityStatus).toBe("proposal_not_ground_truth");
    expect(payload.primaryArtifact).toBe(cleanedFile);
    expect(payload.companionArtifacts).toEqual([cleanedFile]);
    expect(payload.pointsPly?.relativePath).toBe(cleanedFile);
    expect(payload.gaussianPly).toBeUndefined();
    expect(payload.objMesh).toBeUndefined();
    expect(payload.assetManifest).toEqual([expect.objectContaining({ relativePath: cleanedFile })]);
    expect(payload.packageInsights).toContainEqual(expect.objectContaining({
      id: "assets",
      summary: "Cleaned ordinary PLY export detected; Gaussian/splat payloads are not part of this artifact.",
      details: [{ label: "boundary", value: "ordinary point-cloud PLY only" }]
    }));
    expect(payload.packageIssues).toEqual([]);
  });

  it("derives preview points for Gaussian-only folders", async () => {
    const root = await makePackage("gaussian-only");
    await writeFile(join(root, "splat.ply"), `ply
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
0 0 0 0 0 0 1 -6 -6 -6 1 0 0 0
1 0 0 0.5 0 0 1 -6 -6 -6 1 0 0 0`);

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("external-local-folder");
    expect(payload.primaryArtifact).toBe("splat.ply");
    expect(payload.gaussianPly?.relativePath).toBe("splat.ply");
    expect(payload.pointsPly?.relativePath).toBe("splat.ply#preview-points");
    expect(payload.pointsPly?.text).toContain("generated by World Studio from Gaussian PLY positions");
    expect(payload.companionArtifacts).toEqual(["splat.ply"]);
    expect(payload.assetManifest).toEqual([expect.objectContaining({ relativePath: "splat.ply" })]);
    expect(payload.packageInsights).toContainEqual(expect.objectContaining({
      id: "assets",
      summary: "Renderable Gaussian source detected; preview points were generated for bounds only.",
      details: [{ label: "points source", value: "generated preview, not a package file" }]
    }));
    expect(payload.packageIssues).toEqual([]);
  });

  it("loads a directly selected standalone Gaussian PLY", async () => {
    const root = await makePackage("standalone-gaussian-ply");
    const plyPath = join(root, "capture-splat-7000.ply");
    await writeFile(plyPath, `ply
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
0 0 0 0 0 0 1 -6 -6 -6 1 0 0 0
1 0 0 0.5 0 0 1 -6 -6 -6 1 0 0 0`);

    const payload = await readLocalPackage(plyPath);

    expect(payload.packageKind).toBe("external-local-folder");
    expect(payload.primaryArtifact).toBe("capture-splat-7000.ply");
    expect(payload.gaussianPly?.relativePath).toBe("capture-splat-7000.ply");
    expect(payload.pointsPly?.relativePath).toBe("capture-splat-7000.ply#preview-points");
    expect(payload.packageIssues).toEqual([]);
  });

  it("synthesizes source frame previews for Capture Splat image folders", async () => {
    const root = await makePackage("capture-splat-images");
    await mkdir(join(root, "images"));
    await writeFile(join(root, "images", "frame_000001.png"), onePixelPng);
    await writeFile(join(root, "images", "frame_000002.png"), onePixelPng);
    await writeFile(join(root, "splat.ply"), `ply
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
0 0 0 0 0 0 1 -6 -6 -6 1 0 0 0`);

    const payload = await readLocalPackage(root);
    const mediaFrames = JSON.parse(payload.budoMediaFrames?.text ?? "{}") as {
      frames?: Array<{ frame_camera?: unknown; rgb_path?: string; preview_data_url?: string }>;
      source_kind?: string;
    };

    expect(payload.packageKind).toBe("capture-splat-local-folder");
    expect(payload.sourceKind).toBe("capture_splat.local_folder");
    expect(payload.budoMediaFrames?.relativePath).toBe("capture-splat.media_frames.generated.json");
    expect(mediaFrames.source_kind).toBe("capture_splat.image_folder");
    expect(mediaFrames.frames).toHaveLength(2);
    expect(mediaFrames.frames?.[0]?.rgb_path).toBe("images/frame_000001.png");
    expect(mediaFrames.frames?.[0]?.preview_data_url).toMatch(/^data:image\/png;base64,/);
    expect(payload.packageInsights.map((insight) => insight.kind)).toContain("media-frames");
    expect(payload.packageIssues).toEqual([]);
  });

  it("loads explicit Capture Splat handoff manifests with source frames and renderable artifacts", async () => {
    const root = await makePackage("capture-splat-handoff");
    await mkdir(join(root, "rgb"), { recursive: true });
    await mkdir(join(root, "exports"), { recursive: true });
    await mkdir(join(root, "renders"), { recursive: true });
    await mkdir(join(root, "colmap"), { recursive: true });
    await writeFile(join(root, "rgb", "frame_000001.png"), onePixelPng);
    await writeFile(join(root, "rgb", "frame_000002.png"), onePixelPng);
    await writeFile(join(root, "exports", "points.ply"), `ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
end_header
0 0 0`);
    await writeFile(join(root, "renders", "splat.ply"), `ply
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
0 0 0 0 0 0 1 -6 -6 -6 1 0 0 0`);
    await writeFile(join(root, "exports", "collision_mesh.obj"), "o fixture\nv 0 0 0\nv 1 0 0\nv 0 0 1\nf 1 2 3\n");
    await writeJson(root, "capture.json", { schema: "capture_splat.v0.1", accepted_keyframes: 2 });
    await writeJson(root, "colmap/transforms.json", { schema: "capture_splat.transforms.v0.1", frames: [] });
    await writeFile(join(root, "colmap", "cameras.txt"), "1 PINHOLE 8 6 8 6 4 3\n");
    await writeFile(join(root, "colmap", "images.txt"), "1 1 0 0 0 0 0 0 1 frame_000001.png\n\n2 1 0 0 0 -1 0 0 1 frame_000002.png\n\n");
    await writeJson(root, "capture-splat.world-studio.json", {
      schema: "capture_splat.world_studio_handoff.v0.1",
      status: "visual_evidence_with_3dgs_proposal",
      source_frames: [
        {
          path: "rgb/frame_000001.png",
          width: 8,
          height: 6,
          intrinsics: { fx: 10, fy: 11, cx: 4, cy: 3 },
          pose: {
            translation: [2, 3, 4],
            rotation: [1, 0, 0, 0],
            coordinate_frame: "colmap_world",
            authority: "inline handoff"
          }
        },
        { path: "rgb/frame_000002.png" }
      ],
      frames: [
        { path: "rgb/frame_000001.png" },
        { path: "rgb/frame_000002.png" }
      ],
      assets: {
        points: "exports/points.ply",
        gaussian: "renders/splat.ply",
        capture_manifest: "capture.json",
        transforms: "colmap/transforms.json",
        colmap_sparse: {
          "cameras.txt": "colmap/cameras.txt",
          "images.txt": "colmap/images.txt"
        },
        spz: "exports/scene.spz"
      },
      artifacts: [
        { kind: "mesh", path: "exports/collision_mesh.obj" }
      ]
    });

    const payload = await readLocalPackage(root);
    const mediaFrames = JSON.parse(payload.budoMediaFrames?.text ?? "{}") as {
      frames?: Array<{ frame_camera?: unknown; rgb_path?: string; preview_data_url?: string }>;
      source_kind?: string;
    };

    expect(payload.packageKind).toBe("capture-splat-local-folder");
    expect(payload.sourceKind).toBe("capture_splat.local_folder");
    expect(payload.authorityStatus).toBe("visual_evidence");
    expect(payload.primaryArtifact).toBe("renders/splat.ply");
    expect(payload.pointsPly?.relativePath).toBe("exports/points.ply");
    expect(payload.gaussianPly?.relativePath).toBe("renders/splat.ply");
    expect(payload.objMesh?.relativePath).toBe("exports/collision_mesh.obj");
    expect(mediaFrames.source_kind).toBe("capture_splat.world_studio_handoff");
    expect(mediaFrames.frames).toHaveLength(2);
    expect(mediaFrames.frames?.[0]?.rgb_path).toBe("rgb/frame_000001.png");
    expect(mediaFrames.frames?.[0]?.preview_data_url).toMatch(/^data:image\/png;base64,/);
    expect(mediaFrames.frames?.[0]).toMatchObject({
      frame_camera: {
        width: 8,
        height: 6,
        fx: 10,
        fy: 11,
        cx: 4,
        cy: 3,
        translation: [2, 3, 4],
        rotation: [1, 0, 0, 0],
        coordinateFrame: "colmap_world",
        authority: "inline handoff"
      }
    });
    expect(mediaFrames.frames?.[1]).toMatchObject({ frame_camera: { translation: [1, 0, 0] } });
    expect(payload.companionArtifacts).toEqual(
      expect.arrayContaining(["capture-splat.world-studio.json", "exports/points.ply", "renders/splat.ply", "capture-splat.media_frames.generated.json", "exports/collision_mesh.obj", "capture.json"])
    );
    expect(payload.packageInsights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "capture-splat-manifest",
          kind: "capture-splat-manifest",
          artifact: "capture-splat.world-studio.json",
          status: "visual_evidence_with_3dgs_proposal"
        }),
        expect.objectContaining({ id: "media-frames", status: "capture_splat.world_studio_handoff" }),
        expect.objectContaining({ id: "assets" })
      ])
    );
    expect(payload.packageIssues).toEqual([]);
  });

  it("maps COLMAP frame cameras through the handoff dataparser transform", async () => {
    const root = await makePackage("capture-splat-handoff-dataparser");
    await mkdir(join(root, "rgb"), { recursive: true });
    await mkdir(join(root, "colmap"), { recursive: true });
    await writeFile(join(root, "rgb", "frame_000001.png"), onePixelPng);
    await writeFile(join(root, "colmap", "cameras.txt"), "1 PINHOLE 8 6 8 6 4 3\n");
    await writeFile(join(root, "colmap", "images.txt"), "1 1 0 0 0 -1 0 0 1 frame_000001.png\n\n");
    await writeJson(root, "capture-splat.world-studio.json", {
      schema: "capture_splat.world_studio_handoff.v0.1",
      status: "visual_evidence_with_3dgs_proposal",
      dataparser_transform: [
        [2, 0, 0, 10],
        [0, 2, 0, 0],
        [0, 0, 2, 0],
        [0, 0, 0, 1]
      ],
      source_frames: [{ path: "rgb/frame_000001.png" }],
      assets: {
        colmap_sparse: {
          "cameras.txt": "colmap/cameras.txt",
          "images.txt": "colmap/images.txt"
        }
      }
    });

    const payload = await readLocalPackage(root);
    const mediaFrames = JSON.parse(payload.budoMediaFrames?.text ?? "{}") as {
      frames?: Array<{ frame_camera?: { translation?: number[]; rotation?: number[]; coordinateFrame?: string } }>;
    };

    expect(mediaFrames.frames?.[0]?.frame_camera).toMatchObject({
      translation: [12, 0, 0],
      rotation: [1, 0, 0, 0],
      coordinateFrame: "trainer_normalized_world"
    });
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
