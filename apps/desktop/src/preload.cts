import { contextBridge, ipcRenderer } from "electron";
import type { LocalWorldPackagePayload } from "@world-studio/world-core";

contextBridge.exposeInMainWorld("worldStudioDesktop", {
  pickFolder: () => ipcRenderer.invoke("world-studio:pick-folder") as Promise<string | null>,
  openLocalPackage: () => ipcRenderer.invoke("world-studio:open-local-package") as Promise<LocalWorldPackagePayload | null>
});
