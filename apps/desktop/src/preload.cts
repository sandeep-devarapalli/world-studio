import { contextBridge, ipcRenderer } from "electron";
import type {
  LiveFramePreview,
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
    ipcRenderer.invoke("world-studio:get-live-frame-preview", input) as Promise<LiveFramePreview | null>
});
