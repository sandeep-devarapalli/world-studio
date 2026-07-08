import type { OpenDialogOptions } from "electron";

export function createOpenLocalPackageDialogOptions(): OpenDialogOptions {
  return {
    properties: ["openDirectory", "openFile"],
    title: "Open World Studio Package or Gaussian PLY",
    buttonLabel: "Open in World Studio",
    filters: [
      { name: "World Studio packages and Gaussian PLY", extensions: ["json", "ply"] },
      { name: "PLY point clouds", extensions: ["ply"] },
      { name: "All files", extensions: ["*"] }
    ]
  };
}
