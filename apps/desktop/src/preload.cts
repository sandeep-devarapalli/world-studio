import { contextBridge, ipcRenderer } from "electron";
import type {
  LiveFramePreview,
  LiveSecuritySnapshot,
  LiveSessionSnapshot,
  LocalWorldPackagePayload,
  SaveEpisodeBundleInput
} from "@world-studio/world-core";

contextBridge.exposeInMainWorld("worldStudioDesktop", {
  pickFolder: () => ipcRenderer.invoke("world-studio:pick-folder") as Promise<string | null>,
  openLocalPackage: () => ipcRenderer.invoke("world-studio:open-local-package") as Promise<LocalWorldPackagePayload | null>,
  initialLocalPackage: () => ipcRenderer.invoke("world-studio:initial-local-package") as Promise<LocalWorldPackagePayload | null>,
  saveEpisodeManifest: (input: { suggestedName: string; text: string }) =>
    ipcRenderer.invoke("world-studio:save-episode-manifest", input) as Promise<{ path: string } | null>,
  saveEpisodeBundle: (input: SaveEpisodeBundleInput) =>
    ipcRenderer.invoke("world-studio:save-episode-bundle", input) as Promise<{ path: string } | null>,
  openEpisodeManifest: () => ipcRenderer.invoke("world-studio:open-episode-manifest") as Promise<{ path: string; text: string } | null>,
  startLiveReceiver: () =>
    ipcRenderer.invoke("world-studio:start-live-receiver") as Promise<LiveSessionSnapshot>,
  stopLiveReceiver: () =>
    ipcRenderer.invoke("world-studio:stop-live-receiver") as Promise<LiveSessionSnapshot>,
  getLiveSessionStatus: () =>
    ipcRenderer.invoke("world-studio:get-live-session-status") as Promise<LiveSessionSnapshot>,
  onLiveSessionUpdate: (listener: (snapshot: LiveSessionSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: LiveSessionSnapshot) => listener(snapshot);
    ipcRenderer.on("world-studio:live-session-update", handler);
    return () => ipcRenderer.removeListener("world-studio:live-session-update", handler);
  },
  getLiveFramePreview: (input: { sessionId: string; sequenceId: number }) =>
    ipcRenderer.invoke("world-studio:get-live-frame-preview", input) as Promise<LiveFramePreview | null>,
  getLiveSecurityStatus: () =>
    ipcRenderer.invoke("world-studio:get-live-security-status") as Promise<LiveSecuritySnapshot>,
  beginLivePairing: (input: { interfaceId: string }) =>
    ipcRenderer.invoke("world-studio:begin-live-pairing", input) as Promise<LiveSecuritySnapshot>,
  cancelLivePairing: () =>
    ipcRenderer.invoke("world-studio:cancel-live-pairing") as Promise<LiveSecuritySnapshot>,
  approveLivePairing: () =>
    ipcRenderer.invoke("world-studio:approve-live-pairing") as Promise<LiveSecuritySnapshot>,
  rejectLivePairing: () =>
    ipcRenderer.invoke("world-studio:reject-live-pairing") as Promise<LiveSecuritySnapshot>,
  startPairedLiveReceiver: (input: { interfaceId: string; grantId: string }) =>
    ipcRenderer.invoke("world-studio:start-paired-live-receiver", input) as Promise<LiveSecuritySnapshot>,
  stopPairedLiveReceiver: () =>
    ipcRenderer.invoke("world-studio:stop-paired-live-receiver") as Promise<LiveSecuritySnapshot>,
  revokeLiveDevice: (input: { grantId: string }) =>
    ipcRenderer.invoke("world-studio:revoke-live-device", input) as Promise<LiveSecuritySnapshot>,
  onLiveSecurityUpdate: (listener: (snapshot: LiveSecuritySnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: LiveSecuritySnapshot) => listener(snapshot);
    ipcRenderer.on("world-studio:live-security-update", handler);
    return () => ipcRenderer.removeListener("world-studio:live-security-update", handler);
  }
});
