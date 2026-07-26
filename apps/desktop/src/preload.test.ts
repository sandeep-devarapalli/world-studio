import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const preloadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cts");

describe("desktop preload live-session bridge", () => {
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
});
