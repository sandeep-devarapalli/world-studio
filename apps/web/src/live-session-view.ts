import type { LiveFramePreview, LiveFrameSummary } from "@world-studio/world-core";

export const LIVE_PREVIEW_CACHE_LIMIT = 12;

export interface LiveTrajectoryPoint {
  sequenceId: number;
  x: number;
  z: number;
}

export function cacheLivePreview(
  cache: Map<string, LiveFramePreview>,
  key: string,
  preview: LiveFramePreview,
  limit = LIVE_PREVIEW_CACHE_LIMIT
): void {
  cache.delete(key);
  cache.set(key, preview);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function splitLiveTrajectory(frames: LiveFrameSummary[]): LiveTrajectoryPoint[][] {
  const segments: LiveTrajectoryPoint[][] = [];
  for (const frame of [...frames].sort((a, b) => a.sequenceId - b.sequenceId)) {
    const x = frame.cameraToWorld[3];
    const z = frame.cameraToWorld[11];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const previous = segments.at(-1)?.at(-1);
    if (!previous || frame.sequenceId !== previous.sequenceId + 1) segments.push([]);
    segments.at(-1)?.push({ sequenceId: frame.sequenceId, x, z });
  }
  return segments;
}
