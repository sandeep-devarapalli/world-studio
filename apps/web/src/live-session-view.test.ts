import { describe, expect, it } from "vitest";
import type { LiveFramePreview, LiveFrameSummary } from "@world-studio/world-core";
import { cacheLivePreview, splitLiveTrajectory } from "./live-session-view";

function frame(sequenceId: number, x: number, z: number): LiveFrameSummary {
  return {
    sequenceId,
    timestamp: sequenceId,
    clockDomain: "arkit_session",
    sourceFrameName: `frame_${sequenceId}.jpg`,
    sourceWidth: 1920,
    sourceHeight: 1440,
    cameraToWorld: [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, z, 0, 0, 0, 1],
    coordinateFrame: "arkit_world",
    previewAvailable: true
  };
}

describe("live session view helpers", () => {
  it("breaks camera trajectories across missing sequences", () => {
    expect(splitLiveTrajectory([frame(4, 4, 4), frame(1, 1, 1), frame(2, 2, 2), frame(6, 6, 6)])).toEqual([
      [
        { sequenceId: 1, x: 1, z: 1 },
        { sequenceId: 2, x: 2, z: 2 }
      ],
      [{ sequenceId: 4, x: 4, z: 4 }],
      [{ sequenceId: 6, x: 6, z: 6 }]
    ]);
  });

  it("evicts the oldest frame preview at the renderer cache bound", () => {
    const cache = new Map<string, LiveFramePreview>();
    for (let sequenceId = 1; sequenceId <= 4; sequenceId += 1) {
      cacheLivePreview(cache, String(sequenceId), {
        sessionId: "live-test",
        sequenceId,
        mediaType: "image/jpeg",
        dataUrl: `data:image/jpeg;base64,${sequenceId}`,
        width: 1920,
        height: 1440
      }, 3);
    }
    expect([...cache.keys()]).toEqual(["2", "3", "4"]);
  });
});
