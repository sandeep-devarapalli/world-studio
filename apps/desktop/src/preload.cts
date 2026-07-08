import { contextBridge, ipcRenderer } from "electron";
import type { LocalWorldPackagePayload, SaveEpisodeBundleInput } from "@world-studio/world-core";

contextBridge.exposeInMainWorld("worldStudioDesktop", {
  pickFolder: () => ipcRenderer.invoke("world-studio:pick-folder") as Promise<string | null>,
  openLocalPackage: () => ipcRenderer.invoke("world-studio:open-local-package") as Promise<LocalWorldPackagePayload | null>,
  initialLocalPackage: () => ipcRenderer.invoke("world-studio:initial-local-package") as Promise<LocalWorldPackagePayload | null>,
  saveEpisodeManifest: (input: { suggestedName: string; text: string }) =>
    ipcRenderer.invoke("world-studio:save-episode-manifest", input) as Promise<{ path: string } | null>,
  saveEpisodeBundle: (input: SaveEpisodeBundleInput) =>
    ipcRenderer.invoke("world-studio:save-episode-bundle", input) as Promise<{ path: string } | null>,
  openEpisodeManifest: () => ipcRenderer.invoke("world-studio:open-episode-manifest") as Promise<{ path: string; text: string } | null>
});
