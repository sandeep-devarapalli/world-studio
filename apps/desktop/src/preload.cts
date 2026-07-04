import { contextBridge, ipcRenderer } from "electron";
import type { LocalWorldPackagePayload } from "@world-studio/world-core";

contextBridge.exposeInMainWorld("worldStudioDesktop", {
  pickFolder: () => ipcRenderer.invoke("world-studio:pick-folder") as Promise<string | null>,
  openLocalPackage: () => ipcRenderer.invoke("world-studio:open-local-package") as Promise<LocalWorldPackagePayload | null>,
  saveEpisodeManifest: (input: { suggestedName: string; text: string }) =>
    ipcRenderer.invoke("world-studio:save-episode-manifest", input) as Promise<{ path: string } | null>
});
