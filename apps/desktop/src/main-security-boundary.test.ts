import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts");
const smokePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/smoke-packaged.mjs");

describe("desktop main-process security boundary", () => {
  it("pins renderer navigation and denies new windows", async () => {
    const source = await readFile(mainPath, "utf8");
    expect(source).toContain('win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));');
    expect(source).toContain('win.webContents.on("will-navigate"');
    expect(source).toContain('win.webContents.on("will-redirect"');
  });

  it("validates every live-security IPC handler", async () => {
    const source = await readFile(mainPath, "utf8");
    const securityChannels = [
      "world-studio:get-live-security-status",
      "world-studio:begin-live-pairing",
      "world-studio:cancel-live-pairing",
      "world-studio:approve-live-pairing",
      "world-studio:reject-live-pairing",
      "world-studio:start-paired-live-receiver",
      "world-studio:stop-paired-live-receiver",
      "world-studio:revoke-live-device"
    ];
    for (const channel of securityChannels) expect(source).toContain(`"${channel}"`);
    expect(source.match(/assertTrustedSecurityIpcSender\(event\);/g)).toHaveLength(securityChannels.length);
  });

  it("does not initialize optional live security before creating the base window", async () => {
    const source = await readFile(mainPath, "utf8");
    const readyStart = source.indexOf("app.whenReady().then");
    const readyEnd = source.indexOf('app.on("window-all-closed"', readyStart);
    const readyBlock = source.slice(readyStart, readyEnd);
    expect(readyBlock).toContain("await createWindow();");
    expect(readyBlock).not.toContain("getLiveSecurityGateway()");
  });

  it("passes an isolated absolute user-data directory to packaged smoke runs", async () => {
    const [mainSource, smokeSource] = await Promise.all([
      readFile(mainPath, "utf8"),
      readFile(smokePath, "utf8")
    ]);
    expect(mainSource).toContain('app.setPath("userData", smokeUserDataPath);');
    expect(smokeSource).toContain('const smokeUserDataDir = path.join(screenshotDir, "user-data");');
    expect(smokeSource).toContain("WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA: smokeUserDataDir");
    expect(smokeSource).not.toMatch(/\bHOME\s*:/);
  });
});
