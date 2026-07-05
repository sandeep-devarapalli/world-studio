import { describe, expect, it } from "vitest";
import { parsePointCloudPly } from "@world-studio/artifacts";
import { buildCleanedPointCloudPly, cleanedPointRows } from "./edit-ply-export";
import type { WorldSession } from "@world-studio/world-core";

const session: WorldSession = {
  id: "local-test",
  name: "local_test",
  units: "meters",
  upAxis: "y",
  pointCount: 4,
  classes: [],
  provenance: {
    sourceKind: "world-studio.local_folder",
    packageKind: "world-studio-local-folder",
    loadedVia: "test",
    sourcePath: "/tmp/local_test",
    primaryArtifact: "points.ply",
    companionArtifacts: ["points.ply"],
    loadedAt: "2026-07-05T00:00:00.000Z",
    authorityStatus: "visual_evidence"
  }
};

describe("cleaned ordinary PLY export", () => {
  it("applies deleted, crop, and transform edits to ordinary PLY rows", () => {
    const pointTransforms = new Map([[1, { dx: 1.25, dy: 0, dz: -0.5 }]]);
    const input = {
      points: [
        { x: 0, y: 0, z: 0, red: 10, green: 20, blue: 30, semanticLabel: 1 },
        { x: 0.5, y: 0.2, z: 0.5, red: 40, green: 50, blue: 60, semanticLabel: 2 },
        { x: 9, y: 0, z: 9, red: 70, green: 80, blue: 90, semanticLabel: 3 },
        { x: -0.5, y: 0, z: 0, red: 100, green: 110, blue: 120, semanticLabel: 4 }
      ],
      deleted: new Set([3]),
      cropBounds: { minX: -1, maxX: 2, minZ: -1, maxZ: 1 },
      pointTransforms,
      session
    };

    const rows = cleanedPointRows(input);
    expect(rows.map((row) => row.index)).toEqual([0, 1]);
    expect(rows[1]).toMatchObject({ x: 1.75, y: 0.2, z: 0, semanticLabel: 2 });

    const exported = buildCleanedPointCloudPly(input);
    expect(exported.rowCount).toBe(2);
    expect(exported.text).toContain("element vertex 2");
    expect(exported.text).toContain("property int semantic_label");
    expect(exported.text).toContain("ordinary point-cloud PLY only");
    expect(exported.text).not.toContain("scale_0");
    expect(exported.text).not.toContain("f_dc_0");

    const parsed = parsePointCloudPly(exported.text);
    expect(parsed.points).toHaveLength(2);
    expect(parsed.points[1]).toMatchObject({ x: 1.75, y: 0.2, z: 0, red: 40, green: 50, blue: 60, semanticLabel: 2 });
  });
});
