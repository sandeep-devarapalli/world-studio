import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { AuthorityStatus, LocalPackageInsight, LocalWorldPackagePayload, LocalWorldPackageTextFile } from "@world-studio/world-core";
import { readdir, readFile, stat } from "node:fs/promises";
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
  const jsonManifests = await readPackageJsonManifests(sourcePath);
  const companionArtifacts = [...new Set([
    sceneFile?.relativePath,
    pointsPly?.relativePath,
    gaussianPly?.relativePath,
    objMesh?.relativePath,
    budoMediaFrames?.relativePath,
    articleFigureViews?.relativePath,
    verifiedExport?.relativePath,
    ...jsonManifests.map((file) => file.relativePath)
  ].filter((entry): entry is string => Boolean(entry)))];

  const packageKind = classifyPackage({ articleFigureViews, budoMediaFrames, pointsPly, sceneFile, verifiedExport });
  const authorityStatus = classifyAuthority(packageKind);
  const primaryArtifact =
    verifiedExport?.relativePath ??
    gaussianPly?.relativePath ??
    pointsPly?.relativePath ??
    budoMediaFrames?.relativePath ??
    articleFigureViews?.relativePath ??
    objMesh?.relativePath ??
    jsonManifests[0]?.relativePath ??
    "folder";

  return {
    kind: "world-studio.local-package",
    name: path.basename(sourcePath),
    sourcePath,
    loadedVia: "electron-picker",
    sourceKind:
      packageKind.startsWith("budo") || packageKind === "verified-semantic-export"
        ? "budo.local_folder"
        : packageKind === "external-local-folder"
          ? "external.local_folder"
          : "world-studio.local_folder",
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
    verifiedExport,
    jsonManifests,
    packageInsights: buildPackageInsights({
      articleFigureViews,
      budoMediaFrames,
      gaussianPly,
      jsonManifests,
      objMesh,
      pointsPly,
      sceneFile,
      verifiedExport
    })
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

async function readPackageJsonManifests(root: string): Promise<LocalWorldPackageTextFile[]> {
  const candidates = new Set<string>();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) candidates.add(entry.name);
  }
  for (const directory of ["metadata", "verified_export"]) {
    try {
      for (const entry of await readdir(resolveInside(root, directory), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) candidates.add(`${directory}/${entry.name}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const out: LocalWorldPackageTextFile[] = [];
  for (const relativePath of [...candidates].sort()) {
    const file = await readOptionalText(root, relativePath);
    if (file) out.push(file);
  }
  return out;
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

function buildPackageInsights(input: {
  articleFigureViews?: LocalWorldPackageTextFile;
  budoMediaFrames?: LocalWorldPackageTextFile;
  gaussianPly?: { relativePath: string };
  jsonManifests: LocalWorldPackageTextFile[];
  objMesh?: LocalWorldPackageTextFile;
  pointsPly?: LocalWorldPackageTextFile;
  sceneFile?: LocalWorldPackageTextFile;
  verifiedExport?: LocalWorldPackageTextFile;
}): LocalPackageInsight[] {
  const insights: LocalPackageInsight[] = [];
  const handled = new Set<string>();

  if (input.pointsPly || input.gaussianPly || input.objMesh) {
    insights.push({
      id: "assets",
      kind: "asset-set",
      title: "Asset Set",
      artifact: "local files",
      summary: "Renderable package assets detected in the selected folder.",
      metrics: [
        { label: "points", value: input.pointsPly ? input.pointsPly.relativePath : "missing" },
        { label: "gaussian", value: input.gaussianPly ? input.gaussianPly.relativePath : "missing" },
        { label: "mesh", value: input.objMesh ? input.objMesh.relativePath : "missing" }
      ],
      details: []
    });
  }

  if (input.sceneFile) {
    handled.add(input.sceneFile.relativePath);
    const scene = parseJsonRecord(input.sceneFile.text);
    insights.push({
      id: "scene",
      kind: "scene-manifest",
      title: "Scene Manifest",
      artifact: input.sceneFile.relativePath,
      summary: stringValue(scene.dataset) ?? "World scene metadata",
      metrics: [
        { label: "version", value: stringValue(scene.version) ?? "unknown" },
        { label: "classes", value: Array.isArray(scene.classes) ? scene.classes.length : 0 },
        { label: "points", value: numberValue(scene.points_total) ?? "unknown" }
      ],
      details: [
        { label: "units", value: stringValue(scene.units) ?? "unknown" },
        { label: "up", value: stringValue(scene.up_axis) ?? "unknown" }
      ]
    });
  }

  if (input.budoMediaFrames) {
    handled.add(input.budoMediaFrames.relativePath);
    const manifest = parseJsonRecord(input.budoMediaFrames.text);
    const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
    const firstFrame = isRecord(frames[0]) ? frames[0] : {};
    insights.push({
      id: "media-frames",
      kind: "media-frames",
      title: "Media Frames",
      artifact: input.budoMediaFrames.relativePath,
      summary: "Media-frame manifest adapter",
      status: stringValue(manifest.source_kind),
      metrics: [
        { label: "frames", value: frames.length },
        { label: "width", value: numberValue(firstFrame.width) ?? "unknown" },
        { label: "height", value: numberValue(firstFrame.height) ?? "unknown" }
      ],
      details: [
        { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
        { label: "first", value: stringValue(firstFrame.display_name) ?? stringValue(firstFrame.rgb_path) ?? "none" }
      ]
    });
  }

  if (input.articleFigureViews) {
    handled.add(input.articleFigureViews.relativePath);
    const manifest = parseJsonRecord(input.articleFigureViews.text);
    const views = Array.isArray(manifest.views) ? manifest.views : Array.isArray(manifest.frames) ? manifest.frames : [];
    const firstView = isRecord(views[0]) ? views[0] : {};
    insights.push({
      id: "figure-views",
      kind: "figure-views",
      title: "Figure Views",
      artifact: input.articleFigureViews.relativePath,
      summary: "Saved 3D view manifest adapter",
      metrics: [
        { label: "views", value: views.length },
        { label: "point clouds", value: countField(views, "point_cloud_path") },
        { label: "mesh refs", value: countArrayField(views, "mesh_paths") }
      ],
      details: [
        { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
        { label: "first", value: stringValue(firstView.display_name) ?? stringValue(firstView.notes) ?? "none" }
      ]
    });
  }

  if (input.verifiedExport) {
    handled.add(input.verifiedExport.relativePath);
    const manifest = parseJsonRecord(input.verifiedExport.text);
    insights.push({
      id: "verified-export",
      kind: "verified-export",
      title: "Verified Export",
      artifact: input.verifiedExport.relativePath,
      summary: stringValue(manifest.boundary) ?? "Verified semantic export manifest",
      status: stringValue(manifest.status),
      metrics: [
        { label: "components", value: numberValue(manifest.component_count) ?? "unknown" },
        { label: "files", value: isRecord(manifest.files) ? Object.keys(manifest.files).length : 0 },
        { label: "hashes", value: isRecord(manifest.hashes) ? Object.keys(manifest.hashes).length : 0 }
      ],
      details: [
        { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
        { label: "status", value: stringValue(manifest.status) ?? "unknown" }
      ]
    });
  }

  for (const file of input.jsonManifests) {
    if (handled.has(file.relativePath)) continue;
    const manifest = parseJsonRecord(file.text);
    const schema = stringValue(manifest.schema) ?? stringValue(manifest.type) ?? stringValue(manifest.kind);
    insights.push({
      id: `json-${file.relativePath}`,
      kind: "json-manifest",
      title: schema ? "JSON Manifest" : "JSON File",
      artifact: file.relativePath,
      summary: schema ?? "Generic JSON package metadata",
      metrics: [
        { label: "keys", value: Object.keys(manifest).length },
        { label: "arrays", value: Object.values(manifest).filter(Array.isArray).length },
        { label: "objects", value: Object.values(manifest).filter(isRecord).length }
      ],
      details: [
        { label: "schema", value: schema ?? "none" },
        { label: "artifact", value: file.relativePath }
      ]
    });
  }

  return insights;
}

function parseJsonRecord(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function countField(values: unknown[], field: string): number {
  return values.filter((value) => isRecord(value) && typeof value[field] === "string").length;
}

function countArrayField(values: unknown[], field: string): number {
  return values.reduce<number>((count, value) => count + (isRecord(value) && Array.isArray(value[field]) ? value[field].length : 0), 0);
}
