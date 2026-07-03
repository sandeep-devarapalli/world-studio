import { expect, test, type Page } from "@playwright/test";
import type { LocalWorldPackagePayload } from "@world-studio/world-core";

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

const localGaussian = `ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
property float f_dc_0
end_header
0 0 0 1 0.1 0.1 0.1 1 0 0 0 0.5`;

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
  ]
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

test("switches renderer modes, isolates a class, and captures canvas screenshots", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load loft_04" }).click();

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

  await expect(page.locator(".ws-logo-sub", { hasText: "local_lab · v1" })).toBeVisible();
  await expect(page.getByText("world-studio-local-folder")).toBeVisible();
  await expect(page.getByText("electron-picker")).toBeVisible();
  await expect(page.getByText("/tmp/world-studio/local_lab")).toBeVisible();
  await expect(page.getByText("gaussians.ply").first()).toBeVisible();
  await expect(page.getByText("Package Inspector")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Scene Manifest detail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Asset Set detail" })).toBeVisible();
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

async function expectCanvasScreenshot(page: Page) {
  const canvas = page.locator("[data-testid='world-canvas']");
  await expect(canvas).toBeVisible();
  const screenshot = await canvas.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
}
