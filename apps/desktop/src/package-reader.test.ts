import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalPackage } from "./package-reader.js";

const tempRoots: string[] = [];

async function makePackage(name: string) {
  const root = await mkdtemp(join(tmpdir(), `world-studio-${name}-`));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readLocalPackage validation", () => {
  it("loads a real renderable package without validation issues", async () => {
    const root = await makePackage("valid");
    await writeFile(join(root, "scene.json"), JSON.stringify({
      dataset: "reader_fixture",
      version: "v1",
      up_axis: "y",
      units: "meters",
      points_total: 1,
      classes: [{ label: 1, name: "floor", points: 1 }]
    }));
    await writeFile(join(root, "points.ply"), `ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property int semantic_label
end_header
0 0 0 255 255 255 1`);

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("world-studio-local-folder");
    expect(payload.primaryArtifact).toBe("points.ply");
    expect(payload.sceneJson).toMatchObject({ dataset: "reader_fixture" });
    expect(payload.packageIssues).toEqual([]);
  });

  it("reports malformed JSON and invalid scene shape from real files", async () => {
    const root = await makePackage("bad-json");
    await mkdir(join(root, "metadata"));
    await writeFile(join(root, "scene.json"), JSON.stringify({ nope: true }));
    await writeFile(join(root, "metadata", "bad.json"), "{ nope");

    const payload = await readLocalPackage(root);

    expect(payload.sceneJson).toBeUndefined();
    expect(payload.packageIssues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["malformed_json", "unsupported_layout", "missing_primary_artifact"])
    );
    expect(payload.packageIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "malformed_json", artifact: "metadata/bad.json" }),
        expect.objectContaining({ code: "unsupported_layout", artifact: "scene.json" })
      ])
    );
  });

  it("reports oversized known binary assets without reading them", async () => {
    const root = await makePackage("oversized");
    const gaussianPath = join(root, "gaussians.ply");
    await writeFile(gaussianPath, "");
    await truncate(gaussianPath, 96 * 1024 * 1024 + 1);

    const payload = await readLocalPackage(root);

    expect(payload.gaussianPly).toBeUndefined();
    expect(payload.primaryArtifact).toBe("folder");
    expect(payload.packageIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "file_too_large", artifact: "gaussians.ply" }),
        expect.objectContaining({ code: "unsupported_layout" })
      ])
    );
  });

  it("reports unsupported empty folders", async () => {
    const root = await makePackage("empty");

    const payload = await readLocalPackage(root);

    expect(payload.packageKind).toBe("external-local-folder");
    expect(payload.primaryArtifact).toBe("folder");
    expect(payload.packageInsights).toEqual([]);
    expect(payload.packageIssues).toEqual([
      expect.objectContaining({ code: "unsupported_layout", severity: "error" })
    ]);
  });
});
