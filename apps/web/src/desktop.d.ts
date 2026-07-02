import type { LocalWorldPackagePayload } from "@world-studio/world-core";

export {};

declare global {
  interface Window {
    worldStudioDesktop?: {
      pickFolder?: () => Promise<string | null>;
      openLocalPackage?: () => Promise<LocalWorldPackagePayload | null>;
    };
  }
}
