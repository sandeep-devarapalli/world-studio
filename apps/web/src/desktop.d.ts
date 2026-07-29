import type {
  LiveFramePreview,
  LiveSessionSnapshot,
  LocalWorldPackagePayload,
  SaveEpisodeBundleInput
} from "@world-studio/world-core";

export {};

declare global {
  interface Window {
    worldStudioDesktop?: {
      pickFolder?: () => Promise<string | null>;
      openLocalPackage?: () => Promise<LocalWorldPackagePayload | null>;
      initialLocalPackage?: () => Promise<LocalWorldPackagePayload | null>;
      saveEpisodeManifest?: (input: { suggestedName: string; text: string }) => Promise<{ path: string } | null>;
      saveEpisodeBundle?: (input: SaveEpisodeBundleInput) => Promise<{ path: string } | null>;
      openEpisodeManifest?: () => Promise<{ path: string; text: string } | null>;
      startLiveReceiver?: () => Promise<LiveSessionSnapshot>;
      stopLiveReceiver?: () => Promise<LiveSessionSnapshot>;
      getLiveSessionStatus?: () => Promise<LiveSessionSnapshot>;
      onLiveSessionUpdate?: (listener: (snapshot: LiveSessionSnapshot) => void) => () => void;
      getLiveFramePreview?: (input: { sessionId: string; sequenceId: number }) => Promise<LiveFramePreview | null>;
    };
  }
}
