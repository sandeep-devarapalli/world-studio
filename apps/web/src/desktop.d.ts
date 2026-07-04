import type { LocalWorldPackagePayload } from "@world-studio/world-core";

export {};

declare global {
  interface Window {
    worldStudioDesktop?: {
      pickFolder?: () => Promise<string | null>;
      openLocalPackage?: () => Promise<LocalWorldPackagePayload | null>;
      saveEpisodeManifest?: (input: { suggestedName: string; text: string }) => Promise<{ path: string } | null>;
      saveEpisodeBundle?: (input: { suggestedName: string; text: string }) => Promise<{ path: string } | null>;
      openEpisodeManifest?: () => Promise<{ path: string; text: string } | null>;
    };
  }
}
