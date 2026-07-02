import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { AuthorityStatus, LocalWorldPackagePayload, LocalWorldPackageTextFile } from "@world-studio/world-core";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const maxTextBytes = 64 * 1024 * 1024;
const maxBinaryBytes = 96 * 1024 * 1024;

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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const rendererUrl = process.env.WORLD_STUDIO_RENDERER_URL;
  if (rendererUrl) {
    await win.loadURL(rendererUrl);
  } else {
    await win.loadFile(path.resolve(__dirname, "../../../web/dist/index.html"));
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

async function readLocalPackage(folder: string): Promise<LocalWorldPackagePayload> {
  const sourcePath = path.resolve(folder);
  const sceneFile = await readOptionalText(sourcePath, "scene.json");
  const pointsPly = await readFirstText(sourcePath, ["points.ply", "point_cloud.ply", "cloud.ply"]);
  const gaussianPly = await readFirstBinary(sourcePath, ["gaussians.ply", "splats.ply", "splat.ply"]);
  const objMesh = await readFirstText(sourcePath, ["collision_mesh.obj", "mesh.obj", "model.obj"]);
  const budoMediaFrames = await readOptionalText(sourcePath, "budo.media_frames.v0.8.json");
  const articleFigureViews = await readOptionalText(sourcePath, "budo.article_figure_3d_views.v0.1.json");
  const verifiedExport = await readOptionalText(sourcePath, "verified_export/manifest.json");
  const companionArtifacts = [
    sceneFile?.relativePath,
    pointsPly?.relativePath,
    gaussianPly?.relativePath,
    objMesh?.relativePath,
    budoMediaFrames?.relativePath,
    articleFigureViews?.relativePath,
    verifiedExport?.relativePath
  ].filter((entry): entry is string => Boolean(entry));

  const packageKind = classifyPackage({ articleFigureViews, budoMediaFrames, pointsPly, sceneFile, verifiedExport });
  const authorityStatus = classifyAuthority(packageKind);
  const primaryArtifact =
    verifiedExport?.relativePath ??
    gaussianPly?.relativePath ??
    pointsPly?.relativePath ??
    budoMediaFrames?.relativePath ??
    articleFigureViews?.relativePath ??
    objMesh?.relativePath ??
    "folder";

  return {
    kind: "world-studio.local-package",
    name: path.basename(sourcePath),
    sourcePath,
    loadedVia: "electron-picker",
    sourceKind: packageKind.startsWith("budo") || packageKind === "verified-semantic-export" ? "budo.local_folder" : "world-studio.local_folder",
    packageKind,
    primaryArtifact,
    companionArtifacts,
    authorityStatus,
    sceneJson: sceneFile ? JSON.parse(sceneFile.text) : undefined,
    pointsPly,
    gaussianPly,
    objMesh,
    budoMediaFrames,
    articleFigureViews,
    verifiedExport
  };
}

function classifyPackage(input: {
  articleFigureViews?: LocalWorldPackageTextFile;
  budoMediaFrames?: LocalWorldPackageTextFile;
  pointsPly?: LocalWorldPackageTextFile;
  sceneFile?: LocalWorldPackageTextFile;
  verifiedExport?: LocalWorldPackageTextFile;
}): string {
  if (input.verifiedExport) return "verified-semantic-export";
  if (input.budoMediaFrames || input.articleFigureViews) return "budo-media-bundle";
  if (input.sceneFile && input.pointsPly) return "world-studio-local-folder";
  return "external-local-folder";
}

function classifyAuthority(packageKind: string): AuthorityStatus {
  if (packageKind === "verified-semantic-export") return "human_verified_semantic_labels";
  if (packageKind === "external-local-folder") return "proposal_not_ground_truth";
  return "visual_evidence";
}

async function readFirstText(root: string, relativePaths: string[]): Promise<LocalWorldPackageTextFile | undefined> {
  for (const relativePath of relativePaths) {
    const file = await readOptionalText(root, relativePath);
    if (file) return file;
  }
  return undefined;
}

async function readOptionalText(root: string, relativePath: string): Promise<LocalWorldPackageTextFile | undefined> {
  const filePath = resolveInside(root, relativePath);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    if (info.size > maxTextBytes) {
      throw new Error(`${relativePath} is larger than ${maxTextBytes} bytes`);
    }
    return { relativePath, text: await readFile(filePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readFirstBinary(root: string, relativePaths: string[]) {
  for (const relativePath of relativePaths) {
    const file = await readOptionalBinary(root, relativePath);
    if (file) return file;
  }
  return undefined;
}

async function readOptionalBinary(root: string, relativePath: string) {
  const filePath = resolveInside(root, relativePath);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    if (info.size > maxBinaryBytes) {
      throw new Error(`${relativePath} is larger than ${maxBinaryBytes} bytes`);
    }
    const bytes = await readFile(filePath);
    return {
      relativePath,
      dataUrl: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
      headerText: bytes.subarray(0, 32 * 1024).toString("utf8")
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function resolveInside(root: string, relativePath: string): string {
  const base = path.resolve(root);
  const filePath = path.resolve(base, relativePath);
  if (filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Package file escaped selected folder: ${relativePath}`);
  }
  return filePath;
}
