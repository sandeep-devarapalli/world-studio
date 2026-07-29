import { app, BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type {
  EpisodeBundleAsset,
  LiveFramePreview,
  LiveSecuritySnapshot,
  LiveSessionSnapshot,
  LocalWorldPackagePayload,
  SaveEpisodeBundleInput
} from "@world-studio/world-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { desktopSmokeUserDataPath } from "./desktop-smoke.js";
import { LiveSessionReceiver } from "./live-session-receiver.js";
import { DesktopIdentityStore, type SecretProtector } from "./live-desktop-identity.js";
import { PairingStore } from "./live-pairing-store.js";
import { LiveSecureGateway } from "./live-secure-gateway.js";
import { createOpenLocalPackageDialogOptions } from "./open-local-dialog-options.js";
import { readLocalPackage } from "./package-reader.js";
import {
  assertTrustedRendererInvocation,
  isTrustedRendererUrl,
  trustedRendererUrl
} from "./renderer-security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeUserDataPath = desktopSmokeUserDataPath(process.env);
if (smokeUserDataPath) app.setPath("userData", smokeUserDataPath);
let liveReceiver: LiveSessionReceiver | null = null;
let liveSecurityGateway: LiveSecureGateway | null = null;
let liveTransportsStoppedForQuit = false;
const trustedRendererUrls = new Map<number, string>();

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
  const rendererPath = path.resolve(__dirname, "../../web/dist/index.html");
  const trustedUrl = trustedRendererUrl(rendererUrl ?? pathToFileURL(rendererPath).href);
  const webContentsId = win.webContents.id;
  trustedRendererUrls.set(webContentsId, trustedUrl);
  win.once("closed", () => trustedRendererUrls.delete(webContentsId));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl, trustedUrl)) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl, trustedUrl)) event.preventDefault();
  });

  if (rendererUrl) {
    await win.loadURL(trustedUrl);
  } else {
    await win.loadFile(rendererPath);
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

ipcMain.handle("world-studio:start-live-receiver", async (): Promise<LiveSessionSnapshot> => {
  return getLiveReceiver().start();
});

ipcMain.handle("world-studio:stop-live-receiver", async (): Promise<LiveSessionSnapshot> => {
  return liveReceiver ? liveReceiver.stop() : stoppedLiveSnapshot();
});

ipcMain.handle("world-studio:get-live-session-status", async (): Promise<LiveSessionSnapshot> => {
  return liveReceiver ? liveReceiver.status() : stoppedLiveSnapshot();
});

ipcMain.handle(
  "world-studio:get-live-frame-preview",
  async (_event, input: { sessionId?: string; sequenceId?: number }): Promise<LiveFramePreview | null> => {
    if (
      !input
      || typeof input.sessionId !== "string"
      || !Number.isSafeInteger(input.sequenceId)
      || Number(input.sequenceId) < 1
    ) {
      throw new Error("Live frame preview requires a session ID and positive sequence ID.");
    }
    const preview = await getLiveReceiver().readFramePreview(input.sessionId, Number(input.sequenceId));
    if (!preview) return null;
    return {
      sessionId: preview.sessionId,
      sequenceId: preview.sequenceId,
      mediaType: preview.mediaType,
      dataUrl: `data:${preview.mediaType};base64,${preview.bytes.toString("base64")}`,
      width: preview.width,
      height: preview.height
    };
  }
);

ipcMain.handle("world-studio:get-live-security-status", async (event): Promise<LiveSecuritySnapshot> => {
  assertTrustedSecurityIpcSender(event);
  return readLiveSecurityStatus();
});

ipcMain.handle(
  "world-studio:begin-live-pairing",
  async (event, input: { interfaceId?: string }): Promise<LiveSecuritySnapshot> => {
    assertTrustedSecurityIpcSender(event);
    if (!input || typeof input.interfaceId !== "string" || !input.interfaceId) {
      throw new Error("Pairing requires an exact private network interface.");
    }
    return getLiveSecurityGateway().beginPairing(input.interfaceId);
  }
);

ipcMain.handle("world-studio:cancel-live-pairing", async (event): Promise<LiveSecuritySnapshot> => {
  assertTrustedSecurityIpcSender(event);
  return liveSecurityGateway ? liveSecurityGateway.cancelPairing() : readLiveSecurityStatus();
});

ipcMain.handle("world-studio:approve-live-pairing", async (event): Promise<LiveSecuritySnapshot> => {
  assertTrustedSecurityIpcSender(event);
  return getLiveSecurityGateway().approvePairing();
});

ipcMain.handle("world-studio:reject-live-pairing", async (event): Promise<LiveSecuritySnapshot> => {
  assertTrustedSecurityIpcSender(event);
  return getLiveSecurityGateway().rejectPairing();
});

ipcMain.handle(
  "world-studio:start-paired-live-receiver",
  async (event, input: { interfaceId?: string; grantId?: string }): Promise<LiveSecuritySnapshot> => {
    assertTrustedSecurityIpcSender(event);
    if (
      !input
      || typeof input.interfaceId !== "string"
      || !input.interfaceId
      || typeof input.grantId !== "string"
      || !input.grantId
    ) {
      throw new Error("Secure LAN start requires an exact interface and pairing grant.");
    }
    return getLiveSecurityGateway().startPairedReceiver({
      interfaceId: input.interfaceId,
      grantId: input.grantId
    });
  }
);

ipcMain.handle("world-studio:stop-paired-live-receiver", async (event): Promise<LiveSecuritySnapshot> => {
  assertTrustedSecurityIpcSender(event);
  return liveSecurityGateway ? liveSecurityGateway.stopPairedReceiver() : readLiveSecurityStatus();
});

ipcMain.handle(
  "world-studio:revoke-live-device",
  async (event, input: { grantId?: string }): Promise<LiveSecuritySnapshot> => {
    assertTrustedSecurityIpcSender(event);
    if (!input || typeof input.grantId !== "string" || !/^csg_[A-Za-z0-9_-]{21}[AQgw]$/.test(input.grantId)) {
      throw new Error("Revocation requires a valid pairing grant ID.");
    }
    return getLiveSecurityGateway().revokeGrant(input.grantId);
  }
);

app.whenReady().then(async () => {
  const stopSecureLan = () => {
    if (liveSecurityGateway) void liveSecurityGateway.stop();
  };
  powerMonitor.on("suspend", stopSecureLan);
  powerMonitor.on("lock-screen", stopSecureLan);
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if ((!liveReceiver && !liveSecurityGateway) || liveTransportsStoppedForQuit) return;
  event.preventDefault();
  liveTransportsStoppedForQuit = true;
  void Promise.all([
    liveReceiver ? liveReceiver.stop() : Promise.resolve(),
    liveSecurityGateway ? liveSecurityGateway.stop() : Promise.resolve()
  ]).finally(() => app.quit());
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

function getLiveReceiver(): LiveSessionReceiver {
  if (liveReceiver) return liveReceiver;
  const receiver = new LiveSessionReceiver({
    root: path.join(app.getPath("userData"), "live-sessions")
  });
  receiver.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("world-studio:live-session-update", snapshot);
    }
  });
  liveReceiver = receiver;
  return receiver;
}

function assertTrustedSecurityIpcSender(event: IpcMainInvokeEvent): void {
  const trustedUrl = trustedRendererUrls.get(event.sender.id);
  const senderFrame = event.senderFrame;
  if (!trustedUrl || !senderFrame) {
    throw new Error("Live security IPC is restricted to the trusted World Studio renderer.");
  }
  assertTrustedRendererInvocation({
    isMainFrame: senderFrame === event.sender.mainFrame,
    senderUrl: senderFrame.url,
    trustedUrl
  });
}

function getLiveSecurityGateway(): LiveSecureGateway {
  if (liveSecurityGateway) return liveSecurityGateway;
  const securityRoot = path.join(app.getPath("userData"), "live-security");
  const secretProtector: SecretProtector = {
    protect: async (plaintext) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("macOS Keychain encryption is unavailable.");
      }
      return safeStorage.encryptString(plaintext.toString("utf8"));
    },
    unprotect: async (protectedBytes) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("macOS Keychain encryption is unavailable.");
      }
      return Buffer.from(safeStorage.decryptString(protectedBytes), "utf8");
    }
  };
  const identityStore = new DesktopIdentityStore(path.join(securityRoot, "identity"), {
    secretProtector
  });
  const pairingStore = new PairingStore(path.join(securityRoot, "registry"));
  const securePort = parseOptionalPort(process.env.WORLD_STUDIO_LIVE_SECURE_PORT, "WORLD_STUDIO_LIVE_SECURE_PORT");
  const gateway = new LiveSecureGateway({
    receiver: getLiveReceiver(),
    identityStore,
    pairingStore,
    ...(securePort === undefined ? {} : { port: securePort })
  });
  gateway.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("world-studio:live-security-update", snapshot);
    }
  });
  liveSecurityGateway = gateway;
  return gateway;
}

async function readLiveSecurityStatus(): Promise<LiveSecuritySnapshot> {
  try {
    return await getLiveSecurityGateway().status();
  } catch (error) {
    return unavailableLiveSecuritySnapshot(error instanceof Error ? error.message : "Live security is unavailable.");
  }
}

function unavailableLiveSecuritySnapshot(error: string): LiveSecuritySnapshot {
  return {
    state: "error",
    desktopId: null,
    desktopName: "World Studio",
    interfaces: [],
    selectedInterfaceId: null,
    secureListening: null,
    pairingInvitationUri: null,
    pairingVerificationCode: null,
    tlsCertificateSha256: null,
    pairingExpiresAt: null,
    pendingDevice: null,
    pairedDevices: [],
    updatedAt: new Date().toISOString(),
    error
  };
}

function stoppedLiveSnapshot(): LiveSessionSnapshot {
  return {
    state: "stopped",
    listening: null,
    sessionId: null,
    sourceManifestId: null,
    expectedCount: null,
    finalSequenceId: null,
    receivedCount: 0,
    contiguousCount: 0,
    pendingCount: 0,
    missingCount: 0,
    nextExpectedSequenceId: 1,
    missingRanges: [],
    frames: [],
    authority: "proposal_only",
    updatedAt: null
  };
}

function parseOptionalPort(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} is invalid.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) throw new Error(`${name} is invalid.`);
  return port;
}

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
