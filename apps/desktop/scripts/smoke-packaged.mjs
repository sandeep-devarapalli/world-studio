import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("packaged desktop smoke currently validates macOS .app bundles only.");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const releaseDir = path.join(repoRoot, "release", `mac-${process.arch}`);
const appBundle = process.env.WORLD_STUDIO_DESKTOP_APP ?? path.join(releaseDir, "World Studio.app");
const screenshotDir =
  process.env.WORLD_STUDIO_DESKTOP_SMOKE_ARTIFACTS ??
  path.join(os.tmpdir(), `world-studio-desktop-smoke-${Date.now()}`);

await stat(appBundle);
await mkdir(screenshotDir, { recursive: true });

const executableName = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", path.join(appBundle, "Contents", "Info.plist")], {
  encoding: "utf8"
}).trim();
const executable = path.join(appBundle, "Contents", "MacOS", executableName);
const cdpPort = await findOpenPort();
const appProcess = spawn(executable, [`--remote-debugging-port=${cdpPort}`], {
  env: { ...process.env, WORLD_STUDIO_DESKTOP_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"]
});

const processOutput = [];
appProcess.stdout.on("data", (chunk) => processOutput.push(chunk.toString()));
appProcess.stderr.on("data", (chunk) => processOutput.push(chunk.toString()));

let browser;
let page;
try {
  await waitForCdp(cdpPort);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  page = await waitForWorldStudioPage(browser);
  await page.setViewportSize({ width: 1440, height: 900 });
  const diagnostics = collectConsoleDiagnostics(page);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  await assertNoFrameworkOverlay(page);
  await assertNotBlank(page, "initial shell");
  await expectTitle(page);

  const loadButton = page.getByRole("button", { name: "Load loft_04" });
  await waitForLocator(loadButton, "Load loft_04 button");
  await loadButton.click();
  await waitForFixtureReady(page, 30_000);
  await waitForText(page, "body", "loft_04", 5_000);

  for (const mode of ["View", "Edit", "Simulate", "Pilot", "Sensors", "Episode"]) {
    await page.locator(".ws-top-center").getByRole("button", { name: mode, exact: true }).click();
    await waitForText(page, ".ws-top-center .ws-pill.on", mode, 5_000);
    if (mode === "View") await waitForText(page, ".ws-statusbar", "spark gaussian", 15_000);
    await assertNotBlank(page, mode);
    await assertNoFrameworkOverlay(page);
    await assertCanvasScreenshot(page, mode);
    await page.screenshot({ path: path.join(screenshotDir, `desktop-${mode.toLowerCase()}.png`), fullPage: false });
  }

  if (diagnostics.length > 0) {
    throw new Error(`Unexpected packaged desktop console diagnostics:\n${diagnostics.join("\n")}`);
  }

  console.log(
    JSON.stringify(
      {
        appBundle,
        url: page.url(),
        title: await page.title(),
        screenshotDir,
        modes: ["View", "Edit", "Simulate", "Pilot", "Sensors", "Episode"]
      },
      null,
      2
    )
  );
} catch (error) {
  await writeFailureArtifacts(page, error);
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopAppProcess(appProcess);
}

function collectConsoleDiagnostics(page) {
  const diagnostics = [];
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

function isExpectedBrowserDiagnostic(type, text) {
  return type === "warning" && text.includes("GL Driver Message") && text.includes("GPU stall due to ReadPixels");
}

async function assertCanvasScreenshot(page, mode) {
  const canvas = page.locator("[data-testid='world-canvas']");
  await waitForLocator(canvas, `[data-testid='world-canvas'] in ${mode}`);
  const screenshot = await canvas.screenshot();
  if (screenshot.byteLength < 10_000) {
    throw new Error(`${mode} canvas screenshot is too small (${screenshot.byteLength} bytes)`);
  }
}

async function waitForFixtureReady(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await page.locator(".ws-statusbar").innerText({ timeout: 1_000 }).catch(() => "");
    if (status.includes("loft_04") && status.includes("visual_evidence")) return;
    const body = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
    for (const forbidden of ["ERR_MODULE_NOT_FOUND", "Cannot find package", "Failed to load loft_04 fixture"]) {
      if (body.includes(forbidden)) throw new Error(`fixture load failed with visible app error: ${forbidden}`);
    }
    await sleep(200);
  }

  const status = await page.locator(".ws-statusbar").innerText({ timeout: 1_000 }).catch(() => "<missing statusbar>");
  const body = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "<missing body>");
  throw new Error(`timed out waiting for loft_04 fixture session.\nstatusbar: ${status}\nbody:\n${body.slice(0, 2000)}`);
}

async function assertNoFrameworkOverlay(page) {
  const overlayCount = await page.locator("vite-error-overlay, .vite-error-overlay").count();
  if (overlayCount > 0) throw new Error("framework error overlay is visible");
  const body = await page.locator("body").innerText({ timeout: 5_000 });
  for (const forbidden of ["ERR_MODULE_NOT_FOUND", "Cannot find package", "Failed to load loft_04 fixture"]) {
    if (body.includes(forbidden)) throw new Error(`packaged app shows error text: ${forbidden}`);
  }
}

async function writeFailureArtifacts(page, error) {
  if (!page) {
    console.error(`Packaged desktop smoke failed before page capture:\n${error?.stack ?? error}`);
    console.error(processOutput.join(""));
    return;
  }
  const failurePath = path.join(screenshotDir, "desktop-failure.png");
  await page.screenshot({ path: failurePath, fullPage: false }).catch(() => {});
  const status = await page.locator(".ws-statusbar").innerText({ timeout: 1_000 }).catch(() => "<missing statusbar>");
  const body = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "<missing body>");
  console.error(`Packaged desktop smoke failed; screenshot saved to ${failurePath}`);
  console.error(`statusbar: ${status}`);
  console.error(`body:\n${body.slice(0, 2000)}`);
  if (processOutput.length > 0) console.error(`process output:\n${processOutput.join("")}`);
}

async function assertNotBlank(page, label) {
  const body = await page.locator("body").innerText({ timeout: 5_000 });
  if (!body.includes("World Studio")) throw new Error(`${label} is missing World Studio shell text`);
  const viewport = page.viewportSize();
  const image = await page.screenshot({ fullPage: false });
  const minimumBytes = viewport && viewport.width >= 1400 ? 30_000 : 10_000;
  if (image.byteLength < minimumBytes) throw new Error(`${label} screenshot appears blank (${image.byteLength} bytes)`);
}

async function expectTitle(page) {
  const title = await page.title();
  if (title !== "World Studio") throw new Error(`expected World Studio title, got ${JSON.stringify(title)}`);
}

async function waitForText(page, selector, text, timeoutMs) {
  const start = Date.now();
  const expected = text.toLowerCase();
  while (Date.now() - start < timeoutMs) {
    const body = await page.locator(selector).innerText({ timeout: 1_000 }).catch(() => "");
    if (body.toLowerCase().includes(expected)) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${selector} to contain ${JSON.stringify(text)}`);
}

async function waitForLocator(locator, label) {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    if (await locator.isVisible().catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitForWorldStudioPage(browser) {
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if ((await page.title().catch(() => "")) === "World Studio" || page.url().includes("index.html")) {
          return page;
        }
      }
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for World Studio page. Process output:\n${processOutput.join("")}`);
}

async function waitForCdp(port) {
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The app may still be starting.
    }
    if (appProcess.exitCode !== null) {
      throw new Error(`packaged app exited before CDP was ready:\n${processOutput.join("")}`);
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for CDP port ${port}:\n${processOutput.join("")}`);
}

async function findOpenPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("failed to allocate a local CDP port");
  return address.port;
}

async function stopAppProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(2_000).then(() => false)
  ]);
  if (!exited && child.exitCode === null) child.kill("SIGKILL");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
