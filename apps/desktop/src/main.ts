import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { LocalWorldPackagePayload } from "@world-studio/world-core";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLocalPackage } from "./package-reader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "World Studio",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#080604",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const rendererUrl = process.env.WORLD_STUDIO_RENDERER_URL;
  if (rendererUrl) {
    await win.loadURL(rendererUrl);
  } else {
    await win.loadFile(path.resolve(__dirname, "../../web/dist/index.html"));
  }
}

ipcMain.handle("world-studio:pick-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Open World Studio Package"
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle("world-studio:open-local-package", async (): Promise<LocalWorldPackagePayload | null> => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "openFile"],
    title: "Open World Studio Package"
  });
  if (result.canceled) return null;
  const selectedPath = result.filePaths[0];
  if (!selectedPath) return null;
  const info = await stat(selectedPath);
  return readLocalPackage(info.isDirectory() ? selectedPath : path.dirname(selectedPath));
});

ipcMain.handle(
  "world-studio:save-episode-manifest",
  async (_event, input: { suggestedName?: string; text?: string }): Promise<{ path: string } | null> => {
    if (!input?.text) return null;
    const result = await dialog.showSaveDialog({
      title: "Save Episode Manifest",
      defaultPath: path.join(app.getPath("documents"), safeFileName(input.suggestedName ?? "world-studio-episode.json")),
      filters: [{ name: "World Studio Episode", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, input.text, "utf8");
    return { path: result.filePath };
  }
);

ipcMain.handle("world-studio:open-episode-manifest", async (): Promise<{ path: string; text: string } | null> => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Open Episode Manifest",
    filters: [{ name: "World Studio Episode", extensions: ["json"] }]
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  if (!filePath) return null;
  return { path: filePath, text: await readFile(filePath, "utf8") };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

function safeFileName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.endsWith(".json") ? sanitized : `${sanitized || "world-studio-episode"}.json`;
}
