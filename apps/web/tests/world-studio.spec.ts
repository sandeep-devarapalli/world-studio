import { expect, test } from "@playwright/test";

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
