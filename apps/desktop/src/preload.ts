import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("worldStudioDesktop", {
  pickFolder: () => ipcRenderer.invoke("world-studio:pick-folder") as Promise<string | null>
});

