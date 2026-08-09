import type {
  LiveEvidenceAssetRole,
  LiveFramePreview,
  LiveSecuritySnapshot,
  LiveSessionSnapshot,
  LocalWorldPackagePayload,
  ReconstructionWorkerSnapshot,
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
      getLiveFramePreview?: (input: {
        sessionId: string;
        sequenceId: number;
        role?: LiveEvidenceAssetRole;
      }) => Promise<LiveFramePreview | null>;
      getLiveSecurityStatus?: () => Promise<LiveSecuritySnapshot>;
      beginLivePairing?: (input: { interfaceId: string }) => Promise<LiveSecuritySnapshot>;
      cancelLivePairing?: () => Promise<LiveSecuritySnapshot>;
      approveLivePairing?: () => Promise<LiveSecuritySnapshot>;
      rejectLivePairing?: () => Promise<LiveSecuritySnapshot>;
      startPairedLiveReceiver?: (input: { interfaceId: string; grantId: string }) => Promise<LiveSecuritySnapshot>;
      stopPairedLiveReceiver?: () => Promise<LiveSecuritySnapshot>;
      revokeLiveDevice?: (input: { grantId: string }) => Promise<LiveSecuritySnapshot>;
      onLiveSecurityUpdate?: (listener: (snapshot: LiveSecuritySnapshot) => void) => () => void;
      getReconstructionWorkerStatus?: () => Promise<ReconstructionWorkerSnapshot>;
      startReconstructionWorker?: (input: {
        workerId: string;
        sessionId: string;
      }) => Promise<ReconstructionWorkerSnapshot>;
      stopReconstructionWorker?: (input: { jobId: string }) => Promise<ReconstructionWorkerSnapshot>;
      retryReconstructionWorker?: (input: { jobId: string }) => Promise<ReconstructionWorkerSnapshot>;
      onReconstructionWorkerUpdate?: (
        listener: (snapshot: ReconstructionWorkerSnapshot) => void
      ) => () => void;
    };
  }
}
