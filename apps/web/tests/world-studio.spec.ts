import { expect, test, type Page } from "@playwright/test";
import type { LocalWorldPackagePayload } from "@world-studio/world-core";
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

const localPackagePayload: LocalWorldPackagePayload = {
  kind: "world-studio.local-package",
  name: "local_lab",
  sourcePath: "/tmp/world-studio/local_lab",
  loadedVia: "electron-picker",
  sourceKind: "world-studio.local_folder",
  packageKind: "world-studio-local-folder",
  primaryArtifact: "gaussians.ply",
  companionArtifacts: ["scene.json", "points.ply", "gaussians.ply", "collision_mesh.obj"],
  authorityStatus: "visual_evidence",
  sceneJson: localScene,
  pointsPly: { relativePath: "points.ply", text: localPoints },
  gaussianPly: {
    relativePath: "gaussians.ply",
    headerText: localGaussian,
    dataUrl: `data:application/octet-stream;base64,${Buffer.from(localGaussian).toString("base64")}`
  },
  objMesh: {
    relativePath: "collision_mesh.obj",
    text: `o local_fixture
v -0.5 0 -0.5
v 0.5 0 -0.5
v 0 0.5 0.3
f 1 2 3`
  },
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
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByText("World Studio")).toBeVisible();
  await page.getByRole("button", { name: "Load loft_04" }).click();
  await expect(page.locator(".ws-logo-sub", { hasText: "loft_04 · v3" })).toBeVisible();

  for (const mode of ["View", "Edit", "Simulate", "Pilot", "Sensors", "Episode"]) {
    await page.getByRole("button", { name: mode }).click();
    await expect(page.locator(".ws-mode-title", { hasText: mode })).toBeVisible();
  }

  await expect(page.locator("[data-testid='world-canvas']")).toBeVisible();
  expect(errors).toEqual([]);
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

async function expectCanvasScreenshot(page: Page) {
  const canvas = page.locator("[data-testid='world-canvas']");
  await expect(canvas).toBeVisible();
  const screenshot = await canvas.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
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
