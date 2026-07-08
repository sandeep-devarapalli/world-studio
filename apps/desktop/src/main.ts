import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { EpisodeBundleAsset, LocalWorldPackagePayload, SaveEpisodeBundleInput } from "@world-studio/world-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenLocalPackageDialogOptions } from "./open-local-dialog-options.js";
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
  const result = await dialog.showOpenDialog(createOpenLocalPackageDialogOptions());
  if (result.canceled) return null;
  const selectedPath = result.filePaths[0];
  if (!selectedPath) return null;
  return readLocalPackage(selectedPath);
});

ipcMain.handle("world-studio:initial-local-package", async (): Promise<LocalWorldPackagePayload | null> => {
  const initialPath = process.env.WORLD_STUDIO_INITIAL_PACKAGE;
  if (!initialPath) return null;
  return readLocalPackage(initialPath);
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

ipcMain.handle(
  "world-studio:save-episode-bundle",
  async (_event, input: Partial<SaveEpisodeBundleInput>): Promise<{ path: string } | null> => {
    if (!input?.text) return null;
    const result = await dialog.showSaveDialog({
      title: "Save Episode Package",
      defaultPath: path.join(app.getPath("documents"), safeFileName(input.suggestedName ?? "world-studio-episode.world-episode.json")),
      filters: [{ name: "World Studio Episode Package", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, input.text, "utf8");
    await writeEpisodeBundleAssets(path.dirname(result.filePath), input.assets ?? []);
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
  return { path: filePath, text: await resolveEpisodeBundleAssets(filePath, await readFile(filePath, "utf8")) };
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

async function writeEpisodeBundleAssets(baseDir: string, assets: EpisodeBundleAsset[]): Promise<void> {
  for (const asset of assets) {
    const relativePath = safeRelativeBundlePath(asset.relativePath);
    if (!relativePath || !asset.dataUrl.startsWith("data:")) continue;
    const filePath = path.join(baseDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, dataUrlToBuffer(asset.dataUrl));
  }
}

async function resolveEpisodeBundleAssets(filePath: string, text: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isRecord(parsed)) return text;
  const episode = parsed.schema === "world-studio.episode_bundle.v0.1" && isRecord(parsed.episodeManifest)
    ? parsed.episodeManifest
    : parsed;
  if (!isRecord(episode) || !Array.isArray(episode.sensorCaptures)) return text;

  let changed = false;
  for (const capture of episode.sensorCaptures) {
    if (!isRecord(capture) || typeof capture.previewDataUrl === "string") continue;
    const relativePath = safeRelativeBundlePath(typeof capture.assetPath === "string" ? capture.assetPath : "");
    if (!relativePath) continue;
    try {
      const bytes = await readFile(path.join(path.dirname(filePath), relativePath));
      capture.previewDataUrl = `data:${typeof capture.mimeType === "string" ? capture.mimeType : "image/png"};base64,${bytes.toString("base64")}`;
      changed = true;
    } catch {
      // Leave the asset external so the web app can show a missing companion asset state.
    }
  }
  return changed ? JSON.stringify(parsed, null, 2) : text;
}

function safeRelativeBundlePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) return null;
  return normalized;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Buffer.from("");
  return Buffer.from(dataUrl.slice(comma + 1), dataUrl.includes(";base64,") ? "base64" : "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
