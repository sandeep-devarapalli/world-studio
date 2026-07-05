import { expect, test, type Page } from "@playwright/test";
import type { LocalWorldPackagePayload, SaveEpisodeBundleInput, WorldAssetManifestEntry } from "@world-studio/world-core";
import { readFileSync } from "node:fs";

type PackageFixtureChoice = {
  label: string;
  payload: LocalWorldPackagePayload;
};

const localScene = {
  dataset: "local_lab",
  version: "v1",
  up_axis: "y",
  units: "meters",
  files: {
    points: "points.ply",
    gaussians: "gaussians.ply",
    collision_mesh: "collision_mesh.obj"
  },
  points_total: 12,
  classes: [
    { label: 1, name: "floor", color_shaded: "#465875", color_flat: "#5b6f8a", points: 6 },
    { label: 2, name: "fixture", color_shaded: "#a94f38", color_flat: "#d9764a", points: 6 }
  ],
  agent_spawn: { x: 0, z: 0, heading_rad: 0 }
};

const loftFixture = (name: string) => new URL(`../public/fixtures/loft_04/${name}`, import.meta.url);

const localPoints = `ply
format ascii 1.0
element vertex 12
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property int semantic_label
end_header
-0.6 0 -0.6 120 120 130 1
-0.3 0 -0.6 120 120 130 1
0 0 -0.6 120 120 130 1
0.3 0 -0.6 120 120 130 1
0.6 0 -0.6 120 120 130 1
-0.6 0 -0.3 120 120 130 1
-0.2 0.3 0.1 210 130 80 2
0 0.5 0.1 210 130 80 2
0.2 0.3 0.1 210 130 80 2
-0.2 0.3 0.4 210 130 80 2
0 0.5 0.4 210 130 80 2
0.2 0.3 0.4 210 130 80 2`;

const localGaussian = readFileSync(loftFixture("gaussians.ply"), "utf8");
const onePixelDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcunXrfwAJpwP6J7EkXwAAAABJRU5ErkJggg==";
const localObj = `o local_fixture
v -0.5 0 -0.5
v 0.5 0 -0.5
v 0 0.5 0.3
f 1 2 3`;
const localAssetManifest: WorldAssetManifestEntry[] = [
  { relativePath: "scene.json", sizeBytes: Buffer.byteLength(JSON.stringify(localScene)), checksum: "fnv1a32:scene-local" },
  { relativePath: "points.ply", sizeBytes: Buffer.byteLength(localPoints), checksum: "fnv1a32:points-local" },
  { relativePath: "gaussians.ply", sizeBytes: Buffer.byteLength(localGaussian), checksum: "fnv1a32:gaussian-local" },
  { relativePath: "collision_mesh.obj", sizeBytes: Buffer.byteLength(localObj), checksum: "fnv1a32:mesh-local" }
];

const localPackagePayload: LocalWorldPackagePayload = {
  kind: "world-studio.local-package",
  name: "local_lab",
  sourcePath: "/tmp/world-studio/local_lab",
  loadedVia: "electron-picker",
  sourceKind: "world-studio.local_folder",
  packageKind: "world-studio-local-folder",
  primaryArtifact: "gaussians.ply",
  companionArtifacts: ["scene.json", "points.ply", "gaussians.ply", "collision_mesh.obj"],
  assetManifest: localAssetManifest,
  authorityStatus: "visual_evidence",
  sceneJson: localScene,
  pointsPly: { relativePath: "points.ply", text: localPoints },
  gaussianPly: {
    relativePath: "gaussians.ply",
    headerText: localGaussian,
    dataUrl: `data:application/octet-stream;base64,${Buffer.from(localGaussian).toString("base64")}`
  },
  objMesh: { relativePath: "collision_mesh.obj", text: localObj },
  packageInsights: [
    {
      id: "scene",
      kind: "scene-manifest",
      title: "Scene Manifest",
      artifact: "scene.json",
      summary: "local_lab",
      metrics: [
        { label: "version", value: "v1" },
        { label: "classes", value: 2 },
        { label: "points", value: 12 }
      ],
      details: [
        { label: "units", value: "meters" },
        { label: "up", value: "y" }
      ]
    },
    {
      id: "assets",
      kind: "asset-set",
      title: "Asset Set",
      artifact: "local files",
      summary: "Renderable package assets detected in the selected folder.",
      metrics: [
        { label: "points", value: "points.ply" },
        { label: "gaussian", value: "gaussians.ply" },
        { label: "mesh", value: "collision_mesh.obj" }
      ],
      details: []
    }
  ]
};

const captureSplatSourceFramePayload: LocalWorldPackagePayload = {
  ...localPackagePayload,
  name: "capture_splat_7k",
  sourcePath: "/tmp/world-studio/capture_splat_7k",
  sourceKind: "capture_splat.local_folder",
  packageKind: "capture-splat-local-folder",
  companionArtifacts: [...localPackagePayload.companionArtifacts, "capture-splat.media_frames.generated.json"],
  budoMediaFrames: {
    relativePath: "capture-splat.media_frames.generated.json",
    text: JSON.stringify({
      schema: "budo.media_frames.v0.8",
      source_kind: "capture_splat.image_folder",
      frames: [
        {
          display_name: "frame_000001",
          rgb_path: "images/frame_000001.png",
          preview_data_url: onePixelDataUrl
        },
        {
          display_name: "frame_000002",
          rgb_path: "images/frame_000002.png",
          preview_data_url: onePixelDataUrl
        }
      ]
    })
  }
};

const localPackageMissingPointsPayload: LocalWorldPackagePayload = (() => {
  const payload: LocalWorldPackagePayload = {
    ...localPackagePayload,
    companionArtifacts: localPackagePayload.companionArtifacts.filter((artifact) => artifact !== "points.ply"),
    assetManifest: localAssetManifest.filter((entry) => entry.relativePath !== "points.ply")
  };
  delete payload.pointsPly;
  return payload;
})();

const localPackageStalePointsPayload: LocalWorldPackagePayload = {
  ...localPackagePayload,
  assetManifest: localAssetManifest.map((entry) =>
    entry.relativePath === "points.ply" ? { ...entry, checksum: "fnv1a32:stale-points" } : entry
  )
};

function importedEpisodeBundleText({
  companionArtifacts = localPackagePayload.companionArtifacts,
  assetManifest = localAssetManifest
}: {
  companionArtifacts?: string[];
  assetManifest?: WorldAssetManifestEntry[];
} = {}): string {
  return JSON.stringify({
    schema: "world-studio.episode_bundle.v0.1",
    createdAt: "2026-07-04T00:00:00.000Z",
    episodeManifest: {
      schema: "world-studio.episode.v0.1",
      createdAt: "2026-07-04T00:00:00.000Z",
      world: { name: "loft_04" },
      playback: { playhead: 0.5, selectedEventId: "event-imported", eventCount: 1 },
      events: [{ id: "event-imported", frame: 1, lane: "capture", label: "desktop import", status: "loaded" }],
      agentTrajectory: [{ frame: 0, x: 1.5, z: -0.5 }],
      props: [],
      sensors: [{ id: "rgb", label: "RGB", kind: "rgb", enabled: true, spec: "72°" }]
    },
    worldContext: { name: "loft_04", version: "v3" },
    package: {
      kind: "world-studio-local-folder",
      sourceKind: "world-studio.local_folder",
      sourcePath: "/tmp/world-studio/local_lab",
      loadedVia: "electron-picker",
      primaryArtifact: "gaussians.ply",
      companionArtifacts,
      assetManifest,
      authorityStatus: "visual_evidence"
    },
    renderer: { mode: "splat", status: "spark gaussian · 16060 splats" },
    compatibility: { notes: ["Local package assets are referenced by filesystem path and are not embedded.", "test bundle"] }
  });
}

function importedComparisonEpisodeBundleText(): string {
  return JSON.stringify({
    schema: "world-studio.episode_bundle.v0.1",
    createdAt: "2026-07-05T00:00:00.000Z",
    episodeManifest: {
      schema: "world-studio.episode.v0.1",
      createdAt: "2026-07-05T00:00:00.000Z",
      world: { name: "External 3DGS comparison" },
      playback: { playhead: 0.5, selectedEventId: "compare-000001", eventCount: 1 },
      events: [{ id: "compare-000001", frame: 1, lane: "capture", label: "frame 000001", status: "QA hold" }],
      agentTrajectory: [],
      props: [],
      sensors: [{ id: "compare-rgb", label: "Imported Render Compare", kind: "rgb", enabled: true, spec: "source/render QA" }],
      sensorCaptures: [
        {
          id: "capture-000001",
          eventId: "compare-000001",
          frame: 1,
          sensorId: "compare-rgb",
          sensorLabel: "Imported Render Compare",
          sensorKind: "rgb",
          sensorSpec: "source/render QA",
          capturedAt: "2026-07-05T00:00:00.000Z",
          previewDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcunXrfwAJpwP6J7EkXwAAAABJRU5ErkJggg==",
          assetStatus: "embedded",
          renderMode: "splat",
          rendererStatus: "visual evidence · QA hold · finite PLY",
          worldName: "External 3DGS comparison",
          sourcePath: "runs/render_compare_native_3dgs_7000_20260705",
          loadedVia: "episode-import",
          camera: { x: 0, y: 1.5, z: 3, yaw: 0, pitch: 0, distance: 5 },
          size: { width: 1, height: 1 }
        }
      ]
    },
    worldContext: { name: "External 3DGS comparison", version: "comparison" },
    package: {
      kind: "world-studio-render-comparison",
      sourceKind: "world_studio.render_comparison",
      sourcePath: "runs/render_compare_native_3dgs_7000_20260705",
      loadedVia: "episode-import",
      primaryArtifact: "world_studio_render_comparison.json",
      companionArtifacts: ["contact_sheet_weak_tail.png"],
      assetManifest: [],
      authorityStatus: "visual_proxy"
    },
    renderer: { mode: "splat", status: "3DGS render QA · hold" },
    compatibility: { notes: ["Visual proxy only; collision and physics authority are not validated."] }
  });
}

const genericManifestPayload: LocalWorldPackagePayload = {
  kind: "world-studio.local-package",
  name: "generic_package",
  sourcePath: "/tmp/world-studio/generic_package",
  loadedVia: "electron-picker",
  sourceKind: "external.local_folder",
  packageKind: "external-local-folder",
  primaryArtifact: "metadata/package.json",
  companionArtifacts: ["metadata/package.json"],
  authorityStatus: "proposal_not_ground_truth",
  jsonManifests: [
    {
      relativePath: "metadata/package.json",
      text: JSON.stringify({ schema: "acme.world.v1", captures: [], assets: { points: "cloud.ply" } })
    }
  ],
  packageInsights: [
    {
      id: "json-metadata/package.json",
      kind: "json-manifest",
      title: "JSON Manifest",
      artifact: "metadata/package.json",
      summary: "acme.world.v1",
      metrics: [
        { label: "keys", value: 3 },
        { label: "arrays", value: 1 },
        { label: "objects", value: 1 }
      ],
      details: [
        { label: "schema", value: "acme.world.v1" },
        { label: "artifact", value: "metadata/package.json" }
      ],
      sections: [
        {
          title: "Structure",
          rows: [
            { label: "schema", value: "acme.world.v1" },
            { label: "artifact", value: "metadata/package.json" },
            { label: "keys", value: 3 }
          ]
        },
        {
          title: "Top Level",
          rows: [
            { label: "schema", value: "acme.world.v1" },
            { label: "captures", value: "0 items" },
            { label: "assets", value: "1 keys" }
          ]
        }
      ],
      previewText: JSON.stringify({ schema: "acme.world.v1", captures: [], assets: { points: "cloud.ply" } }, null, 2)
    }
  ],
  packageIssues: [
    {
      id: "missing_primary_artifact:package",
      severity: "warning",
      code: "missing_primary_artifact",
      title: "Missing renderable primary artifact",
      message: "This package can be inspected as metadata, but no points, Gaussian PLY, or OBJ mesh was found for rendering."
    }
  ]
};

const budoCompatiblePayload: LocalWorldPackagePayload = {
  kind: "world-studio.local-package",
  name: "budo_compat",
  sourcePath: "/tmp/world-studio/budo_compat",
  loadedVia: "electron-picker",
  sourceKind: "budo.local_folder",
  packageKind: "budo-media-bundle",
  primaryArtifact: "budo.media_frames.v0.8.json",
  companionArtifacts: ["budo.media_frames.v0.8.json", "budo.article_figure_3d_views.v0.1.json"],
  authorityStatus: "visual_evidence",
  budoMediaFrames: {
    relativePath: "budo.media_frames.v0.8.json",
    text: JSON.stringify({
      schema: "budo.media_frames.v0.8",
      source_kind: "budo.capture",
      frames: [
        { display_name: "frame 1", rgb_path: "rgb/0001.jpg", width: 1920, height: 1080 },
        { display_name: "frame 2", rgb_path: "rgb/0002.jpg", width: 1920, height: 1080 }
      ]
    })
  },
  articleFigureViews: {
    relativePath: "budo.article_figure_3d_views.v0.1.json",
    text: JSON.stringify({
      schema: "budo.article_figure_3d_views.v0.1",
      views: [{ display_name: "overview", point_cloud_path: "points.ply", mesh_paths: ["collision_mesh.obj"] }]
    })
  },
  packageInsights: [
    {
      id: "media-frames",
      kind: "media-frames",
      title: "Media Frames",
      artifact: "budo.media_frames.v0.8.json",
      summary: "Media-frame manifest adapter",
      status: "budo.capture",
      metrics: [
        { label: "frames", value: 2 },
        { label: "width", value: 1920 },
        { label: "height", value: 1080 }
      ],
      details: [
        { label: "schema", value: "budo.media_frames.v0.8" },
        { label: "first", value: "frame 1" }
      ],
      sections: [
        {
          title: "Frame Paths",
          rows: [
            { label: "frame 1", value: "rgb/0001.jpg" },
            { label: "frame 2", value: "rgb/0002.jpg" }
          ]
        }
      ],
      previewText: JSON.stringify({ schema: "budo.media_frames.v0.8", frames: [{ rgb_path: "rgb/0001.jpg" }] }, null, 2)
    },
    {
      id: "figure-views",
      kind: "figure-views",
      title: "Figure Views",
      artifact: "budo.article_figure_3d_views.v0.1.json",
      summary: "Saved 3D view manifest adapter",
      metrics: [
        { label: "views", value: 1 },
        { label: "point clouds", value: 1 },
        { label: "mesh refs", value: 1 }
      ],
      details: [
        { label: "schema", value: "budo.article_figure_3d_views.v0.1" },
        { label: "first", value: "overview" }
      ],
      sections: [
        {
          title: "View References",
          rows: [
            { label: "view 1", value: "points.ply" },
            { label: "mesh", value: "collision_mesh.obj" }
          ]
        }
      ],
      previewText: JSON.stringify({ schema: "budo.article_figure_3d_views.v0.1", views: [{ point_cloud_path: "points.ply" }] }, null, 2)
    }
  ],
  packageIssues: []
};

const verifiedExportPayload: LocalWorldPackagePayload = {
  kind: "world-studio.local-package",
  name: "verified_export_compat",
  sourcePath: "/tmp/world-studio/verified_export_compat",
  loadedVia: "electron-picker",
  sourceKind: "budo.local_folder",
  packageKind: "verified-semantic-export",
  primaryArtifact: "verified_export/manifest.json",
  companionArtifacts: ["verified_export/manifest.json"],
  authorityStatus: "human_verified_semantic_labels",
  verifiedExport: {
    relativePath: "verified_export/manifest.json",
    text: JSON.stringify({
      schema: "budo.verified_export.v1",
      status: "verified",
      boundary: "human-reviewed semantic export",
      component_count: 4,
      files: { labels: "labels.json", points: "semantic_points.ply" },
      hashes: { labels: "sha256:labels", points: "sha256:points" }
    })
  },
  packageInsights: [
    {
      id: "verified-export",
      kind: "verified-export",
      title: "Verified Export",
      artifact: "verified_export/manifest.json",
      summary: "human-reviewed semantic export",
      status: "verified",
      metrics: [
        { label: "components", value: 4 },
        { label: "files", value: 2 },
        { label: "hashes", value: 2 }
      ],
      details: [
        { label: "schema", value: "budo.verified_export.v1" },
        { label: "status", value: "verified" }
      ],
      sections: [
        {
          title: "Authority",
          rows: [
            { label: "status", value: "verified" },
            { label: "boundary", value: "human-reviewed semantic export" },
            { label: "components", value: 4 }
          ]
        },
        {
          title: "Files",
          rows: [
            { label: "labels", value: "labels.json" },
            { label: "points", value: "semantic_points.ply" }
          ]
        }
      ],
      previewText: JSON.stringify({ status: "verified", files: { labels: "labels.json" } }, null, 2)
    }
  ],
  packageIssues: []
};

const adapterDrilldownPayload: LocalWorldPackagePayload = {
  kind: "world-studio.local-package",
  name: "adapter_package",
  sourcePath: "/tmp/world-studio/adapter_package",
  loadedVia: "electron-picker",
  sourceKind: "external.local_folder",
  packageKind: "world-package-with-adapters",
  primaryArtifact: "budo.media_frames.v0.8.json",
  companionArtifacts: ["budo.media_frames.v0.8.json", "budo.article_figure_3d_views.v0.1.json", "verified_export/manifest.json"],
  authorityStatus: "proposal_not_ground_truth",
  packageInsights: [
    {
      id: "media-frames",
      kind: "media-frames",
      title: "Media Frames",
      artifact: "budo.media_frames.v0.8.json",
      summary: "Media-frame manifest adapter",
      status: "capture_review",
      metrics: [
        { label: "frames", value: 2 },
        { label: "width", value: 1920 },
        { label: "height", value: 1080 }
      ],
      details: [
        { label: "schema", value: "budo.media_frames.v0.8" },
        { label: "first", value: "rgb/frame_001.png" }
      ],
      sections: [
        {
          title: "Manifest",
          rows: [
            { label: "schema", value: "budo.media_frames.v0.8" },
            { label: "source", value: "capture_review" }
          ]
        },
        {
          title: "Frame Paths",
          rows: [
            { label: "frame 1", value: "rgb/frame_001.png" },
            { label: "frame 2", value: "rgb/frame_002.png" }
          ]
        }
      ],
      previewText: JSON.stringify({ schema: "budo.media_frames.v0.8", frames: [{ rgb_path: "rgb/frame_001.png" }, { rgb_path: "rgb/frame_002.png" }] }, null, 2)
    },
    {
      id: "figure-views",
      kind: "figure-views",
      title: "Figure Views",
      artifact: "budo.article_figure_3d_views.v0.1.json",
      summary: "Saved 3D view manifest adapter",
      metrics: [
        { label: "views", value: 1 },
        { label: "point clouds", value: 1 },
        { label: "mesh refs", value: 1 }
      ],
      details: [
        { label: "schema", value: "budo.article_figure_3d_views.v0.1" },
        { label: "first", value: "view_cloud.ply" }
      ],
      sections: [
        {
          title: "View References",
          rows: [
            { label: "view 1", value: "view_cloud.ply" },
            { label: "mesh", value: "collision_mesh.obj" }
          ]
        }
      ],
      previewText: JSON.stringify({ schema: "budo.article_figure_3d_views.v0.1", views: [{ point_cloud_path: "view_cloud.ply", mesh_paths: ["collision_mesh.obj"] }] }, null, 2)
    },
    {
      id: "verified-export",
      kind: "verified-export",
      title: "Verified Export",
      artifact: "verified_export/manifest.json",
      summary: "proposal labels are not collision authority",
      status: "human_verified_semantic_labels",
      metrics: [
        { label: "components", value: 4 },
        { label: "files", value: 2 },
        { label: "hashes", value: 1 }
      ],
      details: [
        { label: "schema", value: "budo.semantic_labels.verified_export.v0.1" },
        { label: "status", value: "human_verified_semantic_labels" }
      ],
      sections: [
        {
          title: "Authority",
          rows: [
            { label: "status", value: "human_verified_semantic_labels" },
            { label: "boundary", value: "proposal labels are not collision authority" }
          ]
        },
        {
          title: "Files",
          rows: [
            { label: "components", value: "semantic_components.json" },
            { label: "palette", value: "semantic_palette.json" }
          ]
        }
      ],
      previewText: JSON.stringify({ status: "human_verified_semantic_labels", files: { components: "semantic_components.json" } }, null, 2)
    }
  ]
};

const invalidPackagePayload: LocalWorldPackagePayload = {
  kind: "world-studio.local-package",
  name: "invalid_package",
  sourcePath: "/tmp/world-studio/invalid_package",
  loadedVia: "electron-picker",
  sourceKind: "external.local_folder",
  packageKind: "external-local-folder",
  primaryArtifact: "folder",
  companionArtifacts: [],
  authorityStatus: "proposal_not_ground_truth",
  packageInsights: [],
  packageIssues: [
    {
      id: "malformed_json:metadata/bad.json",
      severity: "error",
      code: "malformed_json",
      title: "Malformed JSON",
      message: "metadata/bad.json could not be parsed: Unexpected token }",
      artifact: "metadata/bad.json"
    },
    {
      id: "file_too_large:gaussians.ply",
      severity: "error",
      code: "file_too_large",
      title: "File too large",
      message: "gaussians.ply is larger than the desktop bridge limit.",
      artifact: "gaussians.ply"
    },
    {
      id: "missing_primary_artifact:package",
      severity: "warning",
      code: "missing_primary_artifact",
      title: "Missing renderable primary artifact",
      message: "No points, Gaussian PLY, or OBJ mesh was found for rendering."
    },
    {
      id: "unsupported_layout:package",
      severity: "error",
      code: "unsupported_layout",
      title: "Unsupported package layout",
      message: "World Studio did not find a supported package layout in this folder."
    }
  ]
};

const compatibilityPackageChoices: PackageFixtureChoice[] = [
  { label: "World Studio layout", payload: localPackagePayload },
  { label: "Generic JSON layout", payload: genericManifestPayload },
  { label: "Budo-compatible layout", payload: budoCompatiblePayload },
  { label: "Verified export layout", payload: verifiedExportPayload }
];

test("loads loft_04 and switches all six modes", async ({ page }) => {
  const consoleDiagnostics = collectConsoleDiagnostics(page);

  await page.goto("/");
  await expect(page.getByText("World Studio")).toBeVisible();
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await expect(page.locator(".ws-logo-sub", { hasText: "loft_04 · v3" })).toBeVisible();
  await expect(page.locator(".ws-timeline")).toContainText("0292");
  await expect(page.locator(".ws-timeline")).toContainText("REC");

  for (const mode of ["View", "Edit", "Simulate", "Pilot", "Sensors", "Episode"]) {
    await page.getByRole("button", { name: mode }).click();
    await expect(page.locator(".ws-top-center .ws-pill.on")).toHaveText(mode);
    if (mode !== "Sensors") await expect(page.locator(".ws-mode-title", { hasText: mode })).toBeVisible();
    if (mode === "Simulate") {
      await expect(page.locator(".ws-view-tag", { hasText: "Sensor feed" })).toBeVisible();
      await expect(page.locator(".ws-bottom-tray")).toContainText("Physics");
    }
    if (mode === "Sensors") {
      await expect(page.locator(".ws-sensor-list")).toContainText("Rig — rig_a");
      await expect(page.locator(".ws-previews")).toContainText("cam_front · RGB");
    }
  }

  await expect(page.locator("[data-testid='world-canvas']")).toBeVisible();
  expect(consoleDiagnostics).toEqual([]);
});

test("exercises edit delete undo and pilot keys", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Edit" }).click();

  const canvas = page.locator("[data-testid='world-canvas']");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
  await page.mouse.up();
  await page.keyboard.press("Delete");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");

  await page.getByRole("button", { name: "Pilot" }).click();
  await page.keyboard.press("w");
  await page.keyboard.press("a");
  await expect(page.getByText("agent live")).toBeVisible();
});

test("shows Rapier physics diagnostics and steps the pilot agent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Simulate" }).click();

  const physicsPanel = page.locator(".ws-card", { hasText: "Physics" });
  await expect(physicsPanel).toContainText("rapier3d-compat");
  await expect(physicsPanel).toContainText("60hz");
  await expect(physicsPanel).toContainText("colliders");

  await page.keyboard.press("s");
  await expect(page.locator(".ws-statusbar")).toContainText("physics rapier3d-compat");

  await page.getByRole("button", { name: "Pilot" }).click();
  await page.keyboard.press("w");
  const pilotPanel = page.locator(".ws-agent-pad");
  await expect(pilotPanel).toContainText("rapier3d-compat");
  await expect(pilotPanel).toContainText("grounded");
  await expect(page.locator(".ws-statusbar")).toContainText(/step [1-9]/);
});

test("changes spawn, body preset, and collision debug overlay", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Pilot" }).click();

  const pilotPanel = page.locator(".ws-agent-pad");
  await page.getByRole("button", { name: "Cargo body" }).click();
  await expect(pilotPanel).toContainText("Agent — Cargo");

  await page.getByRole("button", { name: "Spawn at Origin" }).click();
  await expect(pilotPanel).toContainText("x 0.00 · z 0.00");

  await page.keyboard.press("w");
  await expect(page.locator(".ws-statusbar")).toContainText(/step [1-9]/);
  await page.getByRole("button", { name: "Reset to Spawn" }).click();
  await expect(page.locator(".ws-statusbar")).toContainText("step 0");

  await page.getByRole("button", { name: "collision off" }).click();
  await expect(pilotPanel).toContainText("collision on");
  await expectCanvasScreenshot(page);
});

test("records Pilot prop actions in Episode mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Pilot" }).click();

  const propPanel = page.getByTestId("pilot-prop-panel");
  await expect(propPanel).toBeVisible();
  await expect(propPanel).toContainText("2 bodies");

  await propPanel.getByRole("button", { name: "Tall", exact: true }).click();
  await propPanel.getByRole("button", { name: "Spawn Prop" }).click();
  await expect(propPanel).toContainText("3 bodies");
  await page.getByRole("button", { name: /Select prop tall-crate_/ }).last().click();

  const inspector = page.getByTestId("selected-prop-inspector");
  await expect(inspector).toContainText("tall-crate");
  const pose = page.getByTestId("selected-prop-pose");
  const initialPose = (await pose.textContent()) ?? "";
  await inspector.getByRole("button", { name: "Nudge selected prop east" }).click();
  await expect.poll(async () => (await pose.textContent()) ?? "", { timeout: 8_000 }).not.toBe(initialPose);
  await inspector.getByRole("button", { name: "Duplicate" }).click();
  await expect(propPanel).toContainText("4 bodies");
  await inspector.getByRole("button", { name: "Delete Selected" }).click();
  await expect(propPanel).toContainText("3 bodies");
  await propPanel.getByRole("button", { name: "Reset Props" }).click();
  await expect(propPanel).toContainText("2 bodies");

  await page.getByRole("button", { name: "Episode" }).click();
  const events = page.getByTestId("episode-event-list");
  await expect(events).toContainText("prop spawn");
  await expect(events).toContainText("prop nudge");
  await expect(events).toContainText("prop duplicate");
  await expect(events).toContainText("prop delete");
  await expect(events).toContainText("prop reset all");

  await events.getByRole("button", { name: /Select episode event prop spawn/ }).click();
  await expect(page.getByTestId("episode-selected-event")).toContainText("prop spawn");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("episode-selected-event")).toContainText("prop select");

  await page.getByRole("button", { name: "Preview JSON" }).click();
  const exportPreview = page.getByTestId("episode-export-preview");
  await expect(exportPreview).toContainText("world-studio.episode.v0.1");
  await expect(exportPreview).toContainText("prop nudge");
  await expect(exportPreview).toContainText("loft_04");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save Episode" }).click()
  ]);
  expect(download.suggestedFilename()).toBe("world-studio-episode-loft_04.json");
  await expect(page.getByTestId("episode-save-status")).toContainText("downloaded world-studio-episode-loft_04.json");

  const [bundleDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Package" }).click()
  ]);
  expect(bundleDownload.suggestedFilename()).toBe("world-studio-episode-loft_04.world-episode.json");
  await expect(page.getByTestId("episode-save-status")).toContainText("downloaded package world-studio-episode-loft_04.world-episode.json");
  const bundlePreview = page.getByTestId("episode-export-preview");
  await expect(bundlePreview).toContainText("world-studio.episode_bundle.v0.1");
  await expect(bundlePreview).toContainText("Episode state is embedded");

  const roundTripBundle = JSON.parse((await bundlePreview.textContent()) ?? "") as {
    episodeManifest: {
      playback: { selectedEventId: string };
      events: Array<{ id: string; frame: number; lane: string; label: string; status: string }>;
    };
  };
  roundTripBundle.episodeManifest.playback.selectedEventId = "event-browser-bundle";
  roundTripBundle.episodeManifest.events = [{ id: "event-browser-bundle", frame: 7, lane: "capture", label: "browser bundle", status: "loaded" }];
  await page.getByTestId("episode-import-input").setInputFiles({
    name: "episode-roundtrip.world-episode.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(roundTripBundle))
  });
  await expect(page.getByTestId("episode-save-status")).toContainText("loaded episode-roundtrip.world-episode.json");
  await expect(events).toContainText("browser bundle");
  await expect(page.getByTestId("episode-selected-event")).toContainText("browser bundle");
  const browserProvenance = page.getByTestId("episode-provenance");
  await expect(browserProvenance).toContainText("world-studio.episode_bundle.v0.1");
  await expect(browserProvenance).toContainText("fixture");
  await expect(browserProvenance).toContainText("gaussians.ply");
  await expect(browserProvenance).toContainText("visual_evidence");
  await expect(browserProvenance).toContainText("matched");
  await expect(browserProvenance).toContainText("validated");
  await expect(browserProvenance).toContainText("Fixture assets are referenced");
});

test("edits Sensors rig fields and restores them through Episode import", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Sensors" }).click();

  const editor = page.getByTestId("sensor-editor");
  await editor.getByLabel("Sensor label").fill("NavCam");
  await editor.getByLabel("Sensor kind").selectOption("depth");
  await editor.getByLabel("Sensor spec").fill("stereo depth");
  await editor.getByLabel("Sensor FOV").fill("86");
  await editor.getByLabel("Sensor range").fill("12.5");
  await editor.getByLabel("Sensor resolution").fill("1280x720");

  await expect(page.locator(".ws-sensor-list")).toContainText("NavCam");
  await expect(page.locator(".ws-sensor-list")).toContainText("stereo depth");
  await expect(editor).toContainText("86° · 12.5m");

  await editor.getByRole("button", { name: "Capture Frame" }).click();
  const captureArtifacts = page.getByTestId("sensor-capture-artifacts");
  await expect(captureArtifacts).toContainText("NavCam · depth");
  await expect(captureArtifacts).toContainText("splat");
  await expect(captureArtifacts).toContainText("captures/event-0001-rgb.png");
  await expect(captureArtifacts).toContainText("ready");
  await expect(captureArtifacts.getByAltText("Latest sensor capture preview")).toHaveAttribute("src", /^data:image\/png;base64,/);

  await page.getByRole("button", { name: "Episode" }).click();
  await expect(page.getByTestId("episode-selected-event")).toContainText("sensor capture · NavCam");
  const episodeCaptureDetail = page.getByTestId("episode-capture-detail");
  await expect(episodeCaptureDetail).toContainText("Capture Detail");
  await expect(episodeCaptureDetail).toContainText("NavCam · depth");
  await expect(episodeCaptureDetail).toContainText("event-1 · frame 1");
  await expect(episodeCaptureDetail).toContainText("captures/event-0001-rgb.png");
  await expect(episodeCaptureDetail).toContainText("fnv1a32:");
  await expect(episodeCaptureDetail).toContainText("fov 50°");
  await expect(episodeCaptureDetail).toContainText("ready");
  await expect(episodeCaptureDetail.getByAltText("Selected episode capture preview")).toHaveAttribute("src", /^data:image\/png;base64,/);

  await page.getByRole("button", { name: "Sensors" }).click();
  await editor.getByRole("button", { name: "Record Rig" }).click();
  await page.getByRole("button", { name: "Episode" }).click();
  await expect(page.getByTestId("episode-event-list")).toContainText("sensor capture · NavCam");
  await expect(page.getByTestId("episode-event-list")).toContainText("sensor rig update");
  await expect(page.getByTestId("episode-selected-event")).toContainText("sensor rig update");

  await page.getByRole("button", { name: "Preview JSON" }).click();
  const exportPreview = page.getByTestId("episode-export-preview");
  await expect(exportPreview).toContainText("\"label\": \"NavCam\"");
  await expect(exportPreview).toContainText("\"kind\": \"depth\"");
  await expect(exportPreview).toContainText("\"fovDeg\": 86");
  await expect(exportPreview).toContainText("\"rangeM\": 12.5");
  await expect(exportPreview).toContainText("\"resolution\": \"1280x720\"");
  await expect(exportPreview).toContainText("\"sensorCaptures\"");
  await expect(exportPreview).toContainText("\"sensorId\": \"rgb\"");
  await expect(exportPreview).toContainText("\"sensorLabel\": \"NavCam\"");
  await expect(exportPreview).toContainText("\"assetPath\": \"captures/event-0001-rgb.png\"");
  await expect(exportPreview).toContainText("\"sizeBytes\"");
  await expect(exportPreview).toContainText("\"checksum\": \"fnv1a32:");
  await expect(exportPreview).toContainText("\"previewDataUrl\": \"data:image/png;base64,");
  const exported = (await exportPreview.textContent()) ?? "";

  await page.getByRole("button", { name: "Sensors" }).click();
  await editor.getByLabel("Sensor label").fill("Temporary");
  await expect(page.locator(".ws-sensor-list")).toContainText("Temporary");

  await page.getByRole("button", { name: "Episode" }).click();
  await page.getByTestId("episode-import-input").setInputFiles({
    name: "edited-sensors.world-episode.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported)
  });
  await expect(page.getByTestId("episode-save-status")).toContainText("loaded edited-sensors.world-episode.json");
  await page.getByRole("button", { name: /Select episode event sensor capture/ }).click();
  await expect(episodeCaptureDetail).toContainText("NavCam · depth");
  await expect(episodeCaptureDetail).toContainText("captures/event-0001-rgb.png");
  await expect(episodeCaptureDetail).toContainText("ready");
  await expect(episodeCaptureDetail.getByAltText("Selected episode capture preview")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.getByRole("button", { name: "Sensors" }).click();

  await expect(editor.getByLabel("Sensor label")).toHaveValue("NavCam");
  await expect(editor.getByLabel("Sensor kind")).toHaveValue("depth");
  await expect(editor.getByLabel("Sensor spec")).toHaveValue("stereo depth");
  await expect(editor.getByLabel("Sensor FOV")).toHaveValue("86");
  await expect(editor.getByLabel("Sensor range")).toHaveValue("12.5");
  await expect(editor.getByLabel("Sensor resolution")).toHaveValue("1280x720");
  await expect(editor).toContainText("86° · 12.5m");
  await expect(captureArtifacts).toContainText("NavCam · depth");
  await expect(captureArtifacts.getByAltText("Latest sensor capture preview")).toHaveAttribute("src", /^data:image\/png;base64,/);
});

test("compares sensor captures and exports a capture manifest", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Sensors" }).click();

  const editor = page.getByTestId("sensor-editor");
  await editor.getByLabel("Sensor label").fill("NavCam");
  await editor.getByRole("button", { name: "Capture Frame" }).click();
  await editor.getByLabel("Sensor spec").fill("comparison pass");
  await editor.getByRole("button", { name: "Capture Frame" }).click();

  await page.getByRole("button", { name: "Episode" }).click();
  const compare = page.getByTestId("episode-capture-compare");
  await expect(compare).toContainText("0/2 selected");
  await page.getByRole("button", { name: "Add Selected to Compare" }).click();
  await expect(compare).toContainText("1/2 selected");
  await expect(compare.getByAltText("Compare capture event-2")).toHaveAttribute("src", /^data:image\/png;base64,/);

  await page.locator(".ws-episode-row.capture", { hasText: "001" }).click();
  await page.getByRole("button", { name: "Add Selected to Compare" }).click();
  await expect(compare).toContainText("2/2 selected");
  await expect(compare.getByAltText("Compare capture event-1")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(compare).toContainText("event-1");
  await expect(compare).toContainText("event-2");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Captures" }).click()
  ]);
  expect(download.suggestedFilename()).toBe("world-studio-captures-loft_04.sensor-captures.json");
  await expect(page.getByTestId("episode-save-status")).toContainText("downloaded captures world-studio-captures-loft_04.sensor-captures.json");

  const exportPreview = page.getByTestId("episode-export-preview");
  await expect(exportPreview).toContainText("world-studio.sensor_capture_manifest.v0.1");
  await expect(exportPreview).toContainText("\"captureCount\": 2");
  await expect(exportPreview).toContainText("\"eventId\": \"event-1\"");
  await expect(exportPreview).toContainText("\"eventId\": \"event-2\"");
  await expect(exportPreview).toContainText("\"checksum\": \"fnv1a32:");
  await expect(exportPreview).not.toContainText("previewDataUrl");
});

test("shows imported render comparison evidence in Simulate mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Episode" }).click();
  await page.getByTestId("episode-import-input").setInputFiles({
    name: "render-comparison.world-episode.json",
    mimeType: "application/json",
    buffer: Buffer.from(importedComparisonEpisodeBundleText())
  });
  await expect(page.getByTestId("episode-save-status")).toContainText("loaded");
  await expect(page.getByTestId("episode-save-status")).toContainText("world-episode.json");
  await expect(page.getByTestId("episode-capture-detail")).toContainText("visual evidence · QA hold · finite PLY");

  await page.getByRole("button", { name: "Simulate" }).click();
  await expect(page.getByAltText("Selected comparison capture evidence")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator(".ws-view-tag", { hasText: "Source evidence" })).toContainText("frame 1");
  await expect(page.locator(".ws-view-tag.metric")).toContainText("3DGS visual proxy");
  const panel = page.getByTestId("simulate-comparison-panel");
  await expect(panel).toContainText("source/render evidence");
  await expect(panel).toContainText("3DGS package not loaded");
  await expect(panel).toContainText("visual_proxy");
  await expect(panel).toContainText("visual evidence · QA hold · finite PLY");
  await expect(panel.getByRole("button", { name: "Show comparison frame 1" })).toHaveClass(/on/);
});

test("exports sensor captures as desktop bundle assets and flags missing external previews", async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __savedBundle?: SaveEpisodeBundleInput;
      worldStudioDesktop?: {
        saveEpisodeBundle: (input: SaveEpisodeBundleInput) => Promise<{ path: string } | null>;
        openEpisodeManifest: () => Promise<{ path: string; text: string } | null>;
      };
    };
    bridgeWindow.worldStudioDesktop = {
      saveEpisodeBundle: async (input) => {
        bridgeWindow.__savedBundle = input;
        return { path: `/tmp/${input.suggestedName}` };
      },
      openEpisodeManifest: async () => ({
        path: "/tmp/externalized-captures.world-episode.json",
        text: bridgeWindow.__savedBundle?.text ?? ""
      })
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Sensors" }).click();
  const editor = page.getByTestId("sensor-editor");
  await editor.getByLabel("Sensor label").fill("NavCam");
  await editor.getByRole("button", { name: "Capture Frame" }).click();
  await page.getByRole("button", { name: "Episode" }).click();
  await page.getByRole("button", { name: "Export Package" }).click();

  const savedBundle = await page.evaluate(() => {
    const bridgeWindow = window as Window & { __savedBundle?: SaveEpisodeBundleInput };
    return bridgeWindow.__savedBundle ?? null;
  });
  expect(savedBundle?.suggestedName).toBe("world-studio-episode-loft_04.world-episode.json");
  expect(savedBundle?.assets).toHaveLength(1);
  expect(savedBundle?.assets?.[0]?.relativePath).toBe("captures/event-0001-rgb.png");
  expect(savedBundle?.assets?.[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(savedBundle?.assets?.[0]?.checksum).toContain("fnv1a32:");
  expect(savedBundle?.text).toContain("\"assetPath\": \"captures/event-0001-rgb.png\"");
  expect(savedBundle?.text).toContain("\"assetStatus\": \"external\"");
  expect(savedBundle?.text).not.toContain("\"previewDataUrl\": \"data:image/png;base64,");

  await page.getByRole("button", { name: "Load Episode" }).click();
  await expect(page.getByTestId("episode-save-status")).toContainText("loaded");
  await expect(page.getByTestId("episode-save-status")).toContainText("world-episode.json");
  const provenance = page.getByTestId("episode-provenance");
  await expect(provenance).toContainText("capture assets");
  await expect(provenance).toContainText("missing · 1/1 companion PNG missing");
  const episodeCaptureDetail = page.getByTestId("episode-capture-detail");
  await expect(episodeCaptureDetail).toContainText("Capture Detail");
  await expect(episodeCaptureDetail).toContainText("NavCam · rgb");
  await expect(episodeCaptureDetail).toContainText("captures/event-0001-rgb.png");
  await expect(episodeCaptureDetail).toContainText("missing capture asset");
  await expect(episodeCaptureDetail).toContainText("missing asset");

  await page.getByRole("button", { name: "Sensors" }).click();
  const captureArtifacts = page.getByTestId("sensor-capture-artifacts");
  await expect(captureArtifacts).toContainText("missing capture asset");
  await expect(captureArtifacts).toContainText("missing asset");
});

test("saves and loads Episode manifests through the desktop bridge", async ({ page }) => {
  await page.addInitScript((input: { payload: LocalWorldPackagePayload; episodeText: string }) => {
    const { payload, episodeText } = input;
    const bridgeWindow = window as Window & {
      __savedEpisode?: { suggestedName: string; text: string };
      __savedBundle?: SaveEpisodeBundleInput;
      worldStudioDesktop?: {
        openLocalPackage: () => Promise<LocalWorldPackagePayload | null>;
        saveEpisodeManifest: (input: { suggestedName: string; text: string }) => Promise<{ path: string } | null>;
        saveEpisodeBundle: (input: SaveEpisodeBundleInput) => Promise<{ path: string } | null>;
        openEpisodeManifest: () => Promise<{ path: string; text: string } | null>;
      };
    };
    bridgeWindow.worldStudioDesktop = {
      openLocalPackage: async () => payload,
      saveEpisodeManifest: async (input) => {
        bridgeWindow.__savedEpisode = input;
        return { path: `/tmp/${input.suggestedName}` };
      },
      saveEpisodeBundle: async (input) => {
        bridgeWindow.__savedBundle = input;
        return { path: `/tmp/${input.suggestedName}` };
      },
      openEpisodeManifest: async () => ({
        path: "/tmp/imported-episode.world-episode.json",
        text: episodeText
      })
    };
  }, { payload: localPackagePayload, episodeText: importedEpisodeBundleText() });

  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Pilot" }).click();
  await page.getByRole("button", { name: "Reset to Spawn" }).click();
  await page.getByRole("button", { name: "Episode" }).click();
  await expect(page.getByTestId("episode-save-status")).toContainText("desktop save ready");
  await page.getByRole("button", { name: "Save Episode" }).click();

  await expect(page.getByTestId("episode-save-status")).toContainText("saved /tmp/world-studio-episode-loft_04.json");
  const saved = await page.evaluate(() => {
    const bridgeWindow = window as Window & { __savedEpisode?: { suggestedName: string; text: string } };
    return bridgeWindow.__savedEpisode ?? null;
  });
  expect(saved?.suggestedName).toBe("world-studio-episode-loft_04.json");
  expect(saved?.text).toContain("world-studio.episode.v0.1");

  await page.getByRole("button", { name: "Export Package" }).click();
  await expect(page.getByTestId("episode-save-status")).toContainText("saved package");
  await expect(page.getByTestId("episode-save-status")).toContainText("world-episode.json");
  const savedBundle = await page.evaluate(() => {
    const bridgeWindow = window as Window & { __savedBundle?: SaveEpisodeBundleInput };
    return bridgeWindow.__savedBundle ?? null;
  });
  expect(savedBundle?.suggestedName).toBe("world-studio-episode-loft_04.world-episode.json");
  expect(savedBundle?.text).toContain("world-studio.episode_bundle.v0.1");
  expect(savedBundle?.text).toContain("\"assetManifest\"");
  expect(savedBundle?.text).toContain("fnv1a32:");

  await page.getByRole("button", { name: "Load Episode" }).click();
  await expect(page.getByTestId("episode-save-status")).toContainText("loaded /tmp/imported-episode.world-episode.json");
  await expect(page.getByTestId("episode-event-list")).toContainText("desktop import");
  await expect(page.getByTestId("episode-selected-event")).toContainText("desktop import");
  const desktopProvenance = page.getByTestId("episode-provenance");
  await expect(desktopProvenance).toContainText("world-studio.episode_bundle.v0.1");
  await expect(desktopProvenance).toContainText("world-studio-local-folder");
  await expect(desktopProvenance).toContainText("/tmp/world-studio/local_lab");
  await expect(desktopProvenance).toContainText("gaussians.ply");
  await expect(desktopProvenance).toContainText("visual_evidence");
  await expect(desktopProvenance).toContainText("spark gaussian");
  await expect(desktopProvenance).toContainText("mismatch");
  await expect(desktopProvenance).toContainText("pending");
  await expect(desktopProvenance).toContainText("Local package assets are referenced");

  await page.getByRole("button", { name: "Relink World Package" }).click();
  await expect(page.getByTestId("episode-save-status")).toContainText("relinked /tmp/world-studio/local_lab");
  await expect(page.locator(".ws-logo-sub", { hasText: "local_lab · v1" })).toBeVisible();
  await expect(page.getByTestId("episode-event-list")).toContainText("desktop import");
  await expect(desktopProvenance).toContainText("matched");
  await expect(desktopProvenance).toContainText("validated");
  await expect(desktopProvenance).toContainText("4/4");
  await expect(desktopProvenance).toContainText("metadata checked");
  await desktopProvenance.getByRole("button", { name: "Asset Details" }).click();
  const validatedIntegrity = page.getByTestId("episode-integrity-table");
  await expect(validatedIntegrity.locator("tr", { hasText: "points.ply" })).toContainText("validated");
  await expect(validatedIntegrity.locator("tr", { hasText: "points.ply" })).toContainText("fnv1a32:points-local");
  await expect(validatedIntegrity.locator("tr", { hasText: "gaussians.ply" })).toContainText("validated");
});

test("flags missing Episode companion assets after relink", async ({ page }) => {
  await page.addInitScript((input: { payload: LocalWorldPackagePayload; episodeText: string }) => {
    window.worldStudioDesktop = {
      openLocalPackage: async () => input.payload,
      openEpisodeManifest: async () => ({
        path: "/tmp/imported-episode-missing-asset.world-episode.json",
        text: input.episodeText
      })
    };
  }, { payload: localPackageMissingPointsPayload, episodeText: importedEpisodeBundleText() });

  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Episode" }).click();
  await page.getByRole("button", { name: "Load Episode" }).click();

  const provenance = page.getByTestId("episode-provenance");
  await expect(provenance).toContainText("pending");
  await page.getByRole("button", { name: "Relink World Package" }).click();
  await expect(page.getByTestId("episode-event-list")).toContainText("desktop import");
  await expect(provenance).toContainText("matched");
  await expect(provenance).toContainText("missing");
  await expect(provenance).toContainText("points.ply");
  await provenance.getByRole("button", { name: "Asset Details" }).click();
  const missingIntegrity = page.getByTestId("episode-integrity-table");
  await expect(missingIntegrity.locator("tr", { hasText: "points.ply" })).toContainText("missing");
  await expect(missingIntegrity.locator("tr", { hasText: "points.ply" })).toContainText("fnv1a32:points-local");
});

test("flags stale Episode companion asset metadata after relink", async ({ page }) => {
  await page.addInitScript((input: { payload: LocalWorldPackagePayload; episodeText: string }) => {
    window.worldStudioDesktop = {
      openLocalPackage: async () => input.payload,
      openEpisodeManifest: async () => ({
        path: "/tmp/imported-episode-stale-asset.world-episode.json",
        text: input.episodeText
      })
    };
  }, { payload: localPackageStalePointsPayload, episodeText: importedEpisodeBundleText() });

  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Episode" }).click();
  await page.getByRole("button", { name: "Load Episode" }).click();

  const provenance = page.getByTestId("episode-provenance");
  await expect(provenance).toContainText("pending");
  await page.getByRole("button", { name: "Relink World Package" }).click();
  await expect(page.getByTestId("episode-event-list")).toContainText("desktop import");
  await expect(provenance).toContainText("matched");
  await expect(provenance).toContainText("mismatch");
  await expect(provenance).toContainText("points.ply");
  await provenance.getByRole("button", { name: "Asset Details" }).click();
  const staleIntegrity = page.getByTestId("episode-integrity-table");
  await expect(staleIntegrity.locator("tr", { hasText: "points.ply" })).toContainText("mismatch");
  await expect(staleIntegrity.locator("tr", { hasText: "points.ply" })).toContainText("fnv1a32:points-local");
  await expect(staleIntegrity.locator("tr", { hasText: "points.ply" })).toContainText("fnv1a32:stale-points");
});

test("rejects invalid Episode manifest imports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Episode" }).click();
  await page.getByTestId("episode-import-input").setInputFiles({
    name: "not-an-episode.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: "world-studio.package.v0" }))
  });
  await expect(page.getByTestId("episode-save-status")).toContainText("load failed · unsupported episode schema");
});

test("switches renderer modes, isolates a class, and captures canvas screenshots", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  const statusbar = page.locator(".ws-statusbar");

  await page.getByRole("button", { name: "splat" }).click();
  await expect(statusbar).toContainText("spark gaussian", { timeout: 15_000 });
  await expect(statusbar).not.toContainText("point fallback");

  for (const mode of ["splat", "points", "mesh", "semantic", "depth"]) {
    await page.getByRole("button", { name: mode }).click();
    await expect(page.getByText(`${mode} · 90% density`)).toBeVisible();
    await expectCanvasScreenshot(page);
  }

  await page.getByRole("button", { name: "semantic" }).click();
  await page.locator(".ws-class-row", { hasText: "floor" }).click();
  await expect(page.locator(".ws-class-row.active", { hasText: "floor" })).toBeVisible();
  await expectCanvasScreenshot(page);
});

test("loads local packages through the desktop bridge", async ({ page }) => {
  await page.addInitScript((payload) => {
    window.worldStudioDesktop = {
      pickFolder: async () => payload.sourcePath,
      openLocalPackage: async () => payload
    };
  }, localPackagePayload);

  await page.goto("/");
  await page.getByRole("button", { name: "Open Local" }).click();
  const statusbar = page.locator(".ws-statusbar");

  await expect(page.locator(".ws-logo-sub", { hasText: "local_lab · v1" })).toBeVisible();
  await expect(page.getByText("world-studio-local-folder")).toBeVisible();
  await expect(page.getByText("electron-picker")).toBeVisible();
  await expect(page.getByText("/tmp/world-studio/local_lab")).toBeVisible();
  await expect(page.getByText("gaussians.ply").first()).toBeVisible();
  await expect(page.getByText("Package Inspector")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Scene Manifest detail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Asset Set detail" })).toBeVisible();
  await page.getByRole("button", { name: "splat" }).click();
  await expect(statusbar).toContainText("spark gaussian", { timeout: 15_000 });
  await expect(statusbar).toContainText("16060 splats");
  await expect(page.getByText("ply source")).toBeVisible();
  await expect(page.getByText("ascii", { exact: true })).toBeVisible();
  await expect(page.getByText("spark prep")).toBeVisible();
  await expect(page.getByText("converted", { exact: true })).toBeVisible();
});

test("shows Capture Splat source frames beside live splat packages in Simulate mode", async ({ page }) => {
  await page.addInitScript((payload) => {
    window.worldStudioDesktop = {
      pickFolder: async () => payload.sourcePath,
      openLocalPackage: async () => payload
    };
  }, captureSplatSourceFramePayload);

  await page.goto("/");
  await page.getByRole("button", { name: "Open Local" }).click();
  await expectSparkReadyForGaussianPayload(page, captureSplatSourceFramePayload);
  await page.getByRole("button", { name: "Simulate" }).click();

  await expect(page.getByAltText("Selected source frame evidence")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator(".ws-view-tag", { hasText: "Source evidence" })).toContainText("frame_000001");
  await expect(page.locator(".ws-view-tag.metric")).toContainText("3DGS visual proxy");
  await expect(page.getByTestId("simulate-comparison-panel")).toContainText("source evidence");
  await expect(page.locator(".ws-frame-row", { hasText: "frame_000001" }).getByAltText("frame_000001 preview")).toHaveAttribute("src", /^data:image\/png;base64,/);
});

test("loads generic manifest-only packages through the desktop bridge", async ({ page }) => {
  await page.addInitScript((payload) => {
    window.worldStudioDesktop = {
      pickFolder: async () => payload.sourcePath,
      openLocalPackage: async () => payload
    };
  }, genericManifestPayload);

  await page.goto("/");
  await page.getByRole("button", { name: "Open Local" }).click();

  await expect(page.locator(".ws-logo-sub", { hasText: "generic_package · loaded" })).toBeVisible();
  await expect(page.getByText("external-local-folder")).toBeVisible();
  await expect(page.getByText("proposal_not_ground_truth", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open JSON Manifest detail" })).toBeVisible();
  await expect(page.getByText("acme.world.v1").first()).toBeVisible();
  await expect(page.getByText("metadata/package.json").first()).toBeVisible();

  await page.getByRole("button", { name: "Open JSON Manifest detail" }).click();
  const detail = page.locator(".ws-detail-panel");
  await expect(detail).toContainText("Inspector Detail");
  await expect(detail).toContainText("Structure");
  await expect(detail).toContainText("Top Level");
  await expect(detail).toContainText("JSON Preview");
  await expect(detail).toContainText('"schema": "acme.world.v1"');
});

test("opens package inspector drilldowns for adapter manifests", async ({ page }) => {
  await page.addInitScript((payload) => {
    window.worldStudioDesktop = {
      pickFolder: async () => payload.sourcePath,
      openLocalPackage: async () => payload
    };
  }, adapterDrilldownPayload);

  await page.goto("/");
  await page.getByRole("button", { name: "Open Local" }).click();

  const detail = page.locator(".ws-detail-panel");
  await expect(page.getByRole("button", { name: "Open Media Frames detail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Figure Views detail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Verified Export detail" })).toBeVisible();

  await page.getByRole("button", { name: "Open Media Frames detail" }).click();
  await expect(detail).toContainText("Frame Paths");
  await expect(detail).toContainText("rgb/frame_001.png");

  await page.getByRole("button", { name: "Open Figure Views detail" }).click();
  await expect(detail).toContainText("View References");
  await expect(detail).toContainText("view_cloud.ply");

  await page.getByRole("button", { name: "Open Verified Export detail" }).click();
  await expect(detail).toContainText("Authority");
  await expect(detail).toContainText("human_verified_semantic_labels");
  await expect(detail).toContainText("semantic_components.json");
});

test("shows package validation issues for unsupported local packages", async ({ page }) => {
  await page.addInitScript((payload) => {
    window.worldStudioDesktop = {
      pickFolder: async () => payload.sourcePath,
      openLocalPackage: async () => payload
    };
  }, invalidPackagePayload);

  await page.goto("/");
  await page.getByRole("button", { name: "Open Local" }).click();

  const issues = page.locator(".ws-issue-panel");
  await expect(page.locator(".ws-logo-sub", { hasText: "invalid_package · loaded" })).toBeVisible();
  await expect(issues).toContainText("Package Issues");
  await expect(issues).toContainText("Malformed JSON");
  await expect(issues).toContainText("malformed_json");
  await expect(issues).toContainText("metadata/bad.json");
  await expect(issues).toContainText("File too large");
  await expect(issues).toContainText("file_too_large");
  await expect(issues).toContainText("Missing renderable primary artifact");
  await expect(issues).toContainText("Unsupported package layout");
});

test("selects compatibility package layouts through the visible UI test bridge", async ({ page }) => {
  await installSelectablePackageBridge(page, compatibilityPackageChoices);
  await page.goto("/");

  const bridge = page.getByTestId("package-fixture-bridge");
  await expect(bridge).toBeVisible();
  await expect(bridge).toContainText("World Studio layout");
  await expect(bridge).toContainText("Generic JSON layout");
  await expect(bridge).toContainText("Budo-compatible layout");
  await expect(bridge).toContainText("Verified export layout");

  for (const [index, choice] of compatibilityPackageChoices.entries()) {
    if (index > 0) {
      await page.reload();
      await expect(page.locator(".ws-logo-name", { hasText: "World Studio" })).toBeVisible();
    }

    await bridge.getByRole("button", { name: choice.label }).click();
    await page.getByRole("button", { name: "Open Local" }).click();
    await expectSparkReadyForGaussianPayload(page, choice.payload);

    await expect(page.getByText(choice.payload.packageKind).first()).toBeVisible();
    await expect(page.getByText(choice.payload.authorityStatus, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(choice.payload.primaryArtifact).first()).toBeVisible();

    const subtitle = page.locator(".ws-logo-sub");
    await expect(subtitle).toContainText(choice.payload.name);
    if (choice.payload.packageIssues?.length) {
      await expect(page.locator(".ws-issue-panel")).toContainText(choice.payload.packageIssues[0].title);
    }
  }
});

test("selects with the rect tool, deletes, and undoes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "rect select" }).click();

  const canvas = page.locator("[data-testid='world-canvas']");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas missing");
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65);
  await page.mouse.up();

  const statusbar = page.locator(".ws-statusbar");
  await expect(statusbar).not.toContainText("0 selected");
  await expect(statusbar).toContainText("0 hidden");

  await page.keyboard.press("Delete");
  await expect(statusbar).toContainText("0 selected");
  await expect(statusbar).not.toContainText("0 hidden");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
  await expect(statusbar).toContainText("0 hidden");
});

test("crops point cloud with the crop box and undo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "points" }).click();
  await page.getByRole("button", { name: "crop box" }).click();

  await expect(page.getByTestId("crop-readout")).toContainText("draw box");

  const canvas = page.locator("[data-testid='world-canvas']");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas missing");

  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.46);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.64);
  await page.mouse.up();

  await expect(page.getByTestId("crop-overlay")).toBeVisible();
  await expect(page.getByTestId("crop-readout")).toContainText(/\d+ points/);
  await expect(page.getByTestId("crop-readout").locator("b")).not.toHaveText("0 points");
  await expect(page.locator(".ws-statusbar")).toContainText(/crop \d+/);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("crop-readout")).toContainText("draw box");
  await expect(page.getByTestId("crop-overlay")).toHaveCount(0);
  await expect(page.locator(".ws-statusbar")).toContainText("0 hidden");
});

test("moves selected points with the transform tool and undo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "points" }).click();
  await page.getByRole("button", { name: "rect select" }).click();

  const canvas = page.locator("[data-testid='world-canvas']");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas missing");

  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65);
  await page.mouse.up();
  await expect(page.getByTestId("transform-readout")).not.toContainText("0 points");
  await expect(page.getByTestId("transform-moved-readout")).toContainText("0 points");

  await page.getByRole("button", { name: "transform" }).click();
  await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.56);
  await page.mouse.up();

  await expect(page.getByTestId("transform-moved-readout")).not.toContainText("0 points");
  await expect(page.getByTestId("transform-delta-readout")).toContainText(/-?\d+\.\d{2} · -?\d+\.\d{2} m/);
  await expect(page.locator(".ws-hist-row", { hasText: "transform" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("transform-moved-readout")).toContainText("0 points");
  await expect(page.getByTestId("transform-delta-readout")).toContainText("0.00 · 0.00 m");
});

test("optimizes points and stages an Edit publish manifest", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Edit" }).click();

  await expect(page.getByTestId("optimize-panel")).toBeVisible();
  await expect(page.getByTestId("publish-panel")).toBeVisible();
  await expect(page.getByTestId("optimize-outlier-readout")).toContainText("0 points");

  await page.getByRole("button", { name: "SH degree 1" }).click();
  await expect(page.getByTestId("sh-degree-readout")).toContainText("1");

  await page.getByRole("button", { name: "Remove outliers" }).click();
  await expect(page.getByTestId("optimize-outlier-readout")).not.toContainText("0 points");
  await expect(page.locator(".ws-hist-row", { hasText: "optimize" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("optimize-outlier-readout")).toContainText("0 points");

  await page.getByRole("button", { name: "Export format .sogs" }).click();
  await expect(page.getByTestId("publish-payload-readout")).toContainText("manifest only");
  await page.getByRole("button", { name: "Preview Publish" }).click();
  const preview = page.getByTestId("edit-publish-preview");
  await expect(preview).toContainText("world-studio.edit_publish.v0.1");
  await expect(preview).toContainText("\"authorityStatus\": \"proposal\"");
  await expect(preview).toContainText("\"format\": \".sogs\"");
  await expect(preview).toContainText("\"shDegree\": 1");
  await expect(preview).toContainText("manifest_preview");
  await expect(preview).toContainText("\"status\": \"manifest_only\"");
  await expect(page.getByTestId("publish-status-readout")).toContainText("publish preview ready");

  await page.getByRole("button", { name: "Export format .ply" }).click();
  await expect(page.getByTestId("publish-payload-readout")).toContainText("cleaned ordinary PLY");
  await page.getByRole("button", { name: "Preview Publish" }).click();
  await expect(preview).toContainText("\"ordinaryPly\"");
  await expect(preview).toContainText("\"status\": \"available\"");
  await expect(preview).toContainText("\"suggestedName\": \"world-studio-cleaned-loft_04.ply\"");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Clean PLY" }).click()
  ]);
  expect(download.suggestedFilename()).toBe("world-studio-cleaned-loft_04.ply");
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const plyText = readFileSync(downloadPath!, "utf8");
  expect(plyText).toContain("format ascii 1.0");
  expect(plyText).toContain("element vertex 16060");
  expect(plyText).toContain("property int semantic_label");
  expect(plyText).toContain("ordinary point-cloud PLY only");
  expect(plyText).not.toContain("scale_0");
  expect(plyText).not.toContain("f_dc_0");
  await expect(page.getByTestId("publish-status-readout")).toContainText("downloaded cleaned PLY world-studio-cleaned-loft_04.ply");
});

test("saves cleaned ordinary PLY through the desktop bridge", async ({ page }) => {
  await page.addInitScript((payload) => {
    const bridgeWindow = window as Window & {
      __savedCleanPly?: { suggestedName: string; text: string };
      worldStudioDesktop?: {
        openLocalPackage: () => Promise<LocalWorldPackagePayload | null>;
        saveEpisodeManifest: (input: { suggestedName: string; text: string }) => Promise<{ path: string } | null>;
      };
    };
    bridgeWindow.worldStudioDesktop = {
      openLocalPackage: async () => payload,
      saveEpisodeManifest: async (input) => {
        bridgeWindow.__savedCleanPly = input;
        return { path: `/tmp/${input.suggestedName}` };
      }
    };
  }, localPackagePayload);

  await page.goto("/");
  await page.getByRole("button", { name: "Open Local" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByTestId("publish-payload-readout")).toContainText("cleaned ordinary PLY");
  await page.getByRole("button", { name: "Export Clean PLY" }).click();
  await expect(page.getByTestId("publish-status-readout")).toContainText("saved cleaned PLY /tmp/world-studio-cleaned-local_lab.ply");

  const saved = await page.evaluate(() => {
    const bridgeWindow = window as Window & { __savedCleanPly?: { suggestedName: string; text: string } };
    return bridgeWindow.__savedCleanPly ?? null;
  });
  expect(saved?.suggestedName).toBe("world-studio-cleaned-local_lab.ply");
  expect(saved?.text).toContain("format ascii 1.0");
  expect(saved?.text).toContain("element vertex 12");
  expect(saved?.text).toContain("property int semantic_label");
  expect(saved?.text).toContain("ordinary point-cloud PLY only");
  expect(saved?.text).not.toContain("scale_0");
  expect(saved?.text).not.toContain("f_dc_0");
});

test("measures ground-plane distance in Edit mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "measure", exact: true }).click();

  await expect(page.getByTestId("measure-readout")).toContainText("pick start");

  const canvas = page.locator("[data-testid='world-canvas']");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas missing");

  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.56);
  await expect(page.getByTestId("measure-readout")).toContainText("pick end");

  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.56);
  await expect(page.getByTestId("measure-readout")).toContainText(/\d+\.\d{2} m/);
  await expect(page.getByTestId("measure-overlay-label")).toContainText(/\d+\.\d{2} m/);
  await expect(page.getByTestId("measure-overlay")).toBeVisible();

  await page.getByRole("button", { name: "Clear Measure" }).click();
  await expect(page.getByTestId("measure-readout")).toContainText("pick start");
  await expect(page.getByTestId("measure-overlay")).toHaveCount(0);
});

test("keeps the stage centered and chrome visible across window resizes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1000, height: 700 },
    { width: 640, height: 480 },
    { width: 2200, height: 1200 }
  ]) {
    await page.setViewportSize(viewport);

    const expectedWidth = Math.min(viewport.width / 1920, viewport.height / 1080) * 1920;
    await expect
      .poll(async () => {
        const box = await page.locator(".ws-stage").boundingBox();
        return box ? Math.abs(box.width - expectedWidth) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThan(2);

    const stage = await page.locator(".ws-stage").boundingBox();
    if (!stage) throw new Error("stage missing");
    expect(Math.abs(stage.x + stage.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(stage.y + stage.height / 2 - viewport.height / 2)).toBeLessThan(2);

    for (const selector of [".ws-wordmark", ".ws-mode-switch", ".ws-statusbar"]) {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`${selector} missing`);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  }
});

test("captures visual smoke for all modes across desktop viewports", async ({ page }, testInfo) => {
  const consoleDiagnostics = collectConsoleDiagnostics(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();

  const visualCases: Array<{
    mode: string;
    required: string[];
    absent?: string[];
    noOverlap?: Array<[string, string, string]>;
  }> = [
    {
      mode: "View",
      required: [".ws-left-view", ".ws-right-col-view", ".ws-bottom-right .ws-mode-card", ".ws-bottom-center .ws-ctrlbar"]
    },
    {
      mode: "Edit",
      required: [".ws-left-edit", ".ws-right-col-edit", ".ws-render-row .ws-mode-switch", ".ws-bottom-right .ws-mode-card"]
    },
    {
      mode: "Simulate",
      required: [".ws-dual-left", ".ws-left-simulate", ".ws-bottom-tray", ".ws-timeline", ".ws-bottom-center .ws-ctrlbar"],
      noOverlap: [[".ws-bottom-tray", ".ws-timeline", "Simulate tray must not cover the timeline"]]
    },
    {
      mode: "Pilot",
      required: [".ws-left-pilot", ".ws-strip", ".ws-pip", ".ws-bottom-left .ws-mode-card"]
    },
    {
      mode: "Sensors",
      required: [".ws-right-col-sensors", ".ws-previews", ".ws-bottom-center .ws-ctrlbar"],
      absent: [".ws-bottom-right .ws-mode-card"]
    },
    {
      mode: "Episode",
      required: [".ws-episode-card", ".ws-bottom-full", ".ws-tracks-panel"]
    }
  ];

  for (const viewport of [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "compact", width: 1440, height: 900 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const visualCase of visualCases) {
      await page.locator(".ws-top-center").getByRole("button", { name: visualCase.mode, exact: true }).click();
      await expect(page.locator(".ws-top-center .ws-pill.on")).toHaveText(visualCase.mode);
      await expectBoxWithinViewport(page, ".ws-wordmark", viewport);
      await expectBoxWithinViewport(page, ".ws-top-center .ws-mode-switch", viewport);
      await expectBoxWithinViewport(page, ".ws-statusbar", viewport);
      for (const selector of visualCase.required) await expectBoxWithinViewport(page, selector, viewport);
      for (const selector of visualCase.absent ?? []) await expect(page.locator(selector)).toHaveCount(0);
      for (const [a, b, label] of visualCase.noOverlap ?? []) await expectNoOverlap(page, a, b, label);

      const screenshot = await page.screenshot({ fullPage: false });
      expect(screenshot.byteLength).toBeGreaterThan(30_000);
      await testInfo.attach(`mode-${visualCase.mode.toLowerCase()}-${viewport.name}.png`, {
        body: screenshot,
        contentType: "image/png"
      });
    }
  }

  expect(consoleDiagnostics).toEqual([]);
});

function collectConsoleDiagnostics(page: Page): string[] {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    const type = message.type();
    const text = message.text();
    if ((type === "error" || type === "warning") && !isExpectedBrowserDiagnostic(type, text)) {
      const location = message.location();
      diagnostics.push(`${type}: ${text} (${location.url}:${location.lineNumber}:${location.columnNumber})`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  return diagnostics;
}

function isExpectedBrowserDiagnostic(type: string, text: string): boolean {
  return type === "warning" && text.includes("GL Driver Message") && text.includes("GPU stall due to ReadPixels");
}

async function expectSparkReadyForGaussianPayload(page: Page, payload: LocalWorldPackagePayload): Promise<void> {
  if (!payload.pointsPly?.text || !payload.gaussianPly?.dataUrl) return;
  await expect(page.locator(".ws-statusbar")).toContainText("spark gaussian", { timeout: 15_000 });
}

async function expectCanvasScreenshot(page: Page) {
  const canvas = page.locator("[data-testid='world-canvas']");
  await expect(canvas).toBeVisible();
  const screenshot = await canvas.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
}

async function expectBoxWithinViewport(page: Page, selector: string, viewport: { width: number; height: number }) {
  const locator = page.locator(selector).first();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${selector} missing`);
  expect(box.x, `${selector} x`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${selector} y`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${selector} right`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${selector} bottom`).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectNoOverlap(page: Page, selectorA: string, selectorB: string, label: string) {
  const boxA = await page.locator(selectorA).first().boundingBox();
  const boxB = await page.locator(selectorB).first().boundingBox();
  if (!boxA || !boxB) throw new Error(`${label}: missing box`);
  const separated =
    boxA.x + boxA.width <= boxB.x + 1 ||
    boxB.x + boxB.width <= boxA.x + 1 ||
    boxA.y + boxA.height <= boxB.y + 1 ||
    boxB.y + boxB.height <= boxA.y + 1;
  expect(separated, label).toBe(true);
}

async function installSelectablePackageBridge(page: Page, choices: PackageFixtureChoice[]) {
  await page.addInitScript((fixtureChoices: PackageFixtureChoice[]) => {
    let selectedIndex = 0;
    const bridgeWindow = window as Window & {
      worldStudioDesktop?: {
        pickFolder: () => Promise<string>;
        openLocalPackage: () => Promise<LocalWorldPackagePayload>;
      };
    };

    bridgeWindow.worldStudioDesktop = {
      pickFolder: async () => fixtureChoices[selectedIndex].payload.sourcePath,
      openLocalPackage: async () => fixtureChoices[selectedIndex].payload
    };

    window.addEventListener("DOMContentLoaded", () => {
      const bridge = document.createElement("div");
      bridge.dataset.testid = "package-fixture-bridge";
      bridge.setAttribute("aria-label", "Package fixture bridge");
      Object.assign(bridge.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        zIndex: "999999",
        display: "flex",
        gap: "6px",
        padding: "8px",
        border: "1px solid rgba(255,255,255,0.25)",
        background: "rgba(8, 6, 4, 0.94)",
        color: "#f5efe6",
        font: "12px ui-monospace, SFMono-Regular, Menlo, monospace"
      });

      fixtureChoices.forEach((choice, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = choice.label;
        button.setAttribute("aria-pressed", index === selectedIndex ? "true" : "false");
        Object.assign(button.style, {
          border: "1px solid rgba(255,255,255,0.22)",
          background: index === selectedIndex ? "#d9764a" : "rgba(255,255,255,0.08)",
          color: index === selectedIndex ? "#120c08" : "#f5efe6",
          padding: "6px 8px",
          cursor: "pointer"
        });
        button.addEventListener("click", () => {
          selectedIndex = index;
          for (const child of bridge.querySelectorAll("button")) {
            child.setAttribute("aria-pressed", child === button ? "true" : "false");
            child.style.background = child === button ? "#d9764a" : "rgba(255,255,255,0.08)";
            child.style.color = child === button ? "#120c08" : "#f5efe6";
          }
        });
        bridge.append(button);
      });

      document.body.append(bridge);
    });
  }, choices);
}
