import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const preloadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cts");

describe("desktop preload live-session bridge", () => {
  it("forwards an optional declared evidence role without exposing filesystem access", async () => {
    const source = await readFile(preloadPath, "utf8");
    expect(source).toContain("role?: LiveEvidenceAssetRole");
    expect(source).toContain('ipcRenderer.invoke("world-studio:get-live-frame-preview", input)');
    expect(source).not.toContain("readFile(");
  });

  it("unsubscribes the exact IPC update handler registered for the renderer", async () => {
    const source = await readFile(preloadPath, "utf8");
    expect(source).toMatch(
      /const handler = \(_event: Electron\.IpcRendererEvent, snapshot: LiveSessionSnapshot\) => listener\(snapshot\);/
    );
    expect(source).toContain('ipcRenderer.on("world-studio:live-session-update", handler);');
    expect(source).toContain(
      'return () => ipcRenderer.removeListener("world-studio:live-session-update", handler);'
    );
  });

  it("unsubscribes the exact live-security IPC handler registered for the renderer", async () => {
    const source = await readFile(preloadPath, "utf8");
    expect(source).toMatch(
      /const handler = \(_event: Electron\.IpcRendererEvent, snapshot: LiveSecuritySnapshot\) => listener\(snapshot\);/
    );
    expect(source).toContain('ipcRenderer.on("world-studio:live-security-update", handler);');
    expect(source).toContain(
      'return () => ipcRenderer.removeListener("world-studio:live-security-update", handler);'
    );
  });
});
