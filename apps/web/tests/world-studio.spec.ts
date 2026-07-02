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
  }
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
  await expect(page.getByText("gaussians.ply")).toBeVisible();
});

async function expectCanvasScreenshot(page: Page) {
  const canvas = page.locator("[data-testid='world-canvas']");
  await expect(canvas).toBeVisible();
  const screenshot = await canvas.screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
}
