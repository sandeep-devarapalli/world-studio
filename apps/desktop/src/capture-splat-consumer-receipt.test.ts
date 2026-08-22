import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyCaptureSplatConsumerPackage } from "./capture-splat-consumer-receipt.js";
import { readLocalPackage } from "./package-reader.js";

const roots: string[] = [];

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function write(root: string, relativePath: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(join(root, relativePath)), { recursive: true });
  await writeFile(join(root, relativePath), bytes);
}

async function reference(root: string, relativePath: string) {
  const bytes = await readFile(join(root, relativePath));
  return { path: relativePath, size_bytes: bytes.byteLength, checksum: checksum(bytes) };
}

async function makePackage(options: { duplicateCaptureRgb?: boolean; noCaptureFrames?: boolean; topFile?: unknown } = {}) {
  const root = await mkdtemp(join(tmpdir(), "world-studio-receipt-"));
  roots.push(root);
  await write(root, "images/frame.jpg", "image");
  if (!options.noCaptureFrames) await write(root, "depth/frame.npy", "depth");
  await write(root, "splat.ply", "ply\n");
  const captureFrames = options.noCaptureFrames
    ? undefined
    : [
        { rgb: "images/frame.jpg", depth: "depth/frame.npy" },
        ...(options.duplicateCaptureRgb ? [{ rgb: "images/frame.jpg" }] : []),
      ];
  const capture = {
    schema: "capture_splat.v0.1",
    ...(captureFrames ? { frames: captureFrames } : {}),
    ...(Object.hasOwn(options, "topFile") ? { calibration_file: options.topFile } : {}),
  };
  await write(root, "capture.json", `${JSON.stringify(capture)}\n`);

  const image = await reference(root, "images/frame.jpg");
  const depth = options.noCaptureFrames ? undefined : await reference(root, "depth/frame.npy");
  const inventoryAssets = options.noCaptureFrames
    ? []
    : [image, depth!, ...(options.duplicateCaptureRgb ? [image] : [])];
  const uniqueInventory = new Set(inventoryAssets.map((value) => value.path)).size;
  const sourceFrame = { rgb_path: image.path, size_bytes: image.size_bytes, checksum: image.checksum };
  const manifest = {
    schema: "capture_splat.world_studio_handoff.v0.3",
    source_frames: [sourceFrame],
    frames: [sourceFrame],
    assets: {
      capture_manifest: await reference(root, "capture.json"),
      gaussian_ply: await reference(root, "splat.ply"),
    },
    capture_manifest_assets: {
      schema: "capture_splat.capture_manifest_assets.v0.1",
      verification: "source_destination_size_and_sha256",
      complete: true,
      decision: "ready",
      assets: inventoryAssets,
      reference_count: inventoryAssets.length,
      unique_asset_count: uniqueInventory,
      duplicate_reference_count: inventoryAssets.length - uniqueInventory,
      verified_asset_count: uniqueInventory,
      copied: options.noCaptureFrames ? 0 : 1,
      existing: options.noCaptureFrames ? 0 : uniqueInventory - 1,
      copied_paths: options.noCaptureFrames ? [] : ["depth/frame.npy"],
      missing: [],
      conflicts: [],
    },
  };
  await write(root, "capture-splat.world-studio.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Capture Splat consumer package receipt", () => {
  it("requires the handoff marker to remain present", async () => {
    const root = await mkdtemp(join(tmpdir(), "world-studio-receipt-missing-marker-"));
    roots.push(root);

    const result = await verifyCaptureSplatConsumerPackage(root);

    expect(result.receipt).toMatchObject({ decision: "hold", closure: { missing_file_count: 1 }, tree: { status: "complete" } });
    expect(result.receipt.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_file", artifact: "capture-splat.world-studio.json" })
    ]));
  });

  it("produces a deterministic complete receipt and reconciles raw duplicate capture references", async () => {
    const { root } = await makePackage({ duplicateCaptureRgb: true });

    const first = await verifyCaptureSplatConsumerPackage(root);
    const second = await verifyCaptureSplatConsumerPackage(root);

    expect(first.receipt).toEqual(second.receipt);
    expect(first.receipt).toMatchObject({
      decision: "ready",
      authenticity: "not_established",
      inventory: {
        recomputed_reference_count: 3,
        recomputed_unique_asset_count: 2,
        recomputed_duplicate_reference_count: 1,
      },
      closure: {
        declared_reference_file_count: 4,
        verified_reference_file_count: 4,
      },
      tree: { status: "complete", file_count: 5, checksum: expect.stringMatching(/^sha256:/) },
    });
    expect(first.verifiedPaths).toEqual(new Set(["capture-splat.world-studio.json", "capture.json", "depth/frame.npy", "images/frame.jpg", "splat.ply"]));
  });

  it("holds unreferenced files, symlinks, changed content, and non-ASCII paths without consuming them", async () => {
    const changed = await makePackage();
    await write(changed.root, "splat.ply", "bad\n");
    const changedResult = await verifyCaptureSplatConsumerPackage(changed.root);
    expect(changedResult.receipt).toMatchObject({ decision: "hold", closure: { metadata_mismatch_count: 1 } });
    expect(changedResult.verifiedPaths.has("splat.ply")).toBe(false);
    const changedPayload = await readLocalPackage(changed.root);
    expect(changedPayload.captureSplatConsumerReceipt?.decision).toBe("hold");
    expect(changedPayload.gaussianPly).toBeUndefined();
    expect(changedPayload.budoMediaFrames?.relativePath).toBe("capture-splat.media_frames.generated.json");

    const extra = await makePackage();
    await write(extra.root, "extra.bin", "extra");
    const extraResult = await verifyCaptureSplatConsumerPackage(extra.root);
    expect(extraResult.receipt).toMatchObject({ decision: "hold", closure: { unreferenced_file_count: 1 } });

    const linked = await makePackage();
    await symlink("images/frame.jpg", join(linked.root, "linked.jpg"));
    const linkedResult = await verifyCaptureSplatConsumerPackage(linked.root);
    expect(linkedResult.receipt).toMatchObject({ decision: "hold", closure: { symlink_count: 1 }, tree: { status: "incomplete" } });

    const unicode = await makePackage();
    await write(unicode.root, "ß.txt", "unsafe");
    const unicodeResult = await verifyCaptureSplatConsumerPackage(unicode.root);
    expect(unicodeResult.receipt.decision).toBe("hold");
    expect(unicodeResult.receipt.tree.status).toBe("incomplete");
    expect(unicodeResult.receipt.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_path" })]));
  });

  it("rejects declared files behind an ancestor-directory symlink", async () => {
    const fixture = await makePackage();
    const outside = await mkdtemp(join(tmpdir(), "world-studio-receipt-outside-"));
    roots.push(outside);
    await write(outside, "frame.jpg", "image");
    await rm(join(fixture.root, "images"), { recursive: true });
    await symlink(outside, join(fixture.root, "images"));

    const result = await verifyCaptureSplatConsumerPackage(fixture.root);

    expect(result.receipt).toMatchObject({ decision: "hold", closure: { symlink_count: 1 }, tree: { status: "incomplete" } });
    expect(result.receipt.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "symlink", artifact: "images" })
    ]));
    expect(result.verifiedPaths.has("images/frame.jpg")).toBe(false);
  });

  it("revokes receipt-bound paths when files or ancestor directories mutate after verification", async () => {
    const changedFile = await makePackage();
    const fileResult = await verifyCaptureSplatConsumerPackage(changedFile.root);
    expect(fileResult.receipt.decision).toBe("ready");
    await write(changedFile.root, "splat.ply", "changed\n");

    expect(await fileResult.readVerifiedFile("splat.ply", 1024)).toBeUndefined();
    expect(fileResult.receipt).toMatchObject({ decision: "hold", closure: { mutable_file_count: 1 }, tree: { status: "incomplete" } });
    expect(fileResult.verifiedPaths.has("splat.ply")).toBe(false);

    const changedAncestor = await makePackage();
    const ancestorResult = await verifyCaptureSplatConsumerPackage(changedAncestor.root);
    const outside = await mkdtemp(join(tmpdir(), "world-studio-receipt-mutated-ancestor-"));
    roots.push(outside);
    await write(outside, "frame.jpg", "image");
    await rm(join(changedAncestor.root, "images"), { recursive: true });
    await symlink(outside, join(changedAncestor.root, "images"));

    expect(await ancestorResult.readVerifiedFile("images/frame.jpg", 1024)).toBeUndefined();
    expect(ancestorResult.receipt.decision).toBe("hold");
    expect(ancestorResult.verifiedPaths.has("images/frame.jpg")).toBe(false);
  });

  it("fails closed on BOM JSON, explicit non-string file fields, invalid frames, and deep asset graphs", async () => {
    const bom = await makePackage();
    const captureBytes = await readFile(join(bom.root, "capture.json"));
    await write(bom.root, "capture.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), captureBytes]));
    (bom.manifest as any).assets.capture_manifest = await reference(bom.root, "capture.json");
    await write(bom.root, "capture-splat.world-studio.json", `${JSON.stringify(bom.manifest)}\n`);
    const bomResult = await verifyCaptureSplatConsumerPackage(bom.root);
    expect(bomResult.receipt.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_capture_manifest" })]));

    const nonString = await makePackage({ topFile: null });
    const nonStringResult = await verifyCaptureSplatConsumerPackage(nonString.root);
    expect(nonStringResult.receipt.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_capture_manifest" })]));

    const invalidFrames = await makePackage();
    await write(invalidFrames.root, "capture.json", '{"schema":"capture_splat.v0.1","frames":null}\n');
    (invalidFrames.manifest as any).assets.capture_manifest = await reference(invalidFrames.root, "capture.json");
    await write(invalidFrames.root, "capture-splat.world-studio.json", `${JSON.stringify(invalidFrames.manifest)}\n`);
    const invalidFramesResult = await verifyCaptureSplatConsumerPackage(invalidFrames.root);
    expect(invalidFramesResult.receipt.decision).toBe("hold");

    const deep = await makePackage();
    let nested: Record<string, unknown> = {};
    (deep.manifest as any).assets.deep = nested;
    for (let index = 0; index < 65; index += 1) {
      nested.next = {};
      nested = nested.next as Record<string, unknown>;
    }
    await write(deep.root, "capture-splat.world-studio.json", `${JSON.stringify(deep.manifest)}\n`);
    const deepResult = await verifyCaptureSplatConsumerPackage(deep.root);
    expect(deepResult.receipt.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "bounds_exceeded" })]));
  });

  it("treats an omitted capture frames member as an empty raw reference list", async () => {
    const { root } = await makePackage({ noCaptureFrames: true });
    const result = await verifyCaptureSplatConsumerPackage(root);
    expect(result.receipt).toMatchObject({
      decision: "ready",
      inventory: { recomputed_reference_count: 0, recomputed_unique_asset_count: 0 },
    });
  });

  it("does not use undeclared image-folder fallbacks for held v0.3 packages", async () => {
    const fixture = await makePackage({ noCaptureFrames: true });
    (fixture.manifest as any).source_frames = [];
    (fixture.manifest as any).frames = [];
    await write(fixture.root, "capture-splat.world-studio.json", `${JSON.stringify(fixture.manifest)}\n`);

    const payload = await readLocalPackage(fixture.root);

    expect(payload.captureSplatConsumerReceipt?.decision).toBe("hold");
    expect(payload.budoMediaFrames).toBeUndefined();
  });

  it("detects a file that changes while its 1 MiB stream is being hashed", async () => {
    const fixture = await makePackage();
    await write(fixture.root, "splat.ply", Buffer.alloc(32 * 1024 * 1024, 7));
    (fixture.manifest as any).assets.gaussian_ply = await reference(fixture.root, "splat.ply");
    await write(fixture.root, "capture-splat.world-studio.json", `${JSON.stringify(fixture.manifest)}\n`);
    const target = join(fixture.root, "splat.ply");
    const timer = setInterval(() => {
      const now = new Date();
      void utimes(target, now, now);
    }, 1);
    const result = await verifyCaptureSplatConsumerPackage(fixture.root);
    clearInterval(timer);

    expect(result.receipt.decision).toBe("hold");
    expect(result.receipt.closure.mutable_file_count).toBeGreaterThan(0);
    expect(result.receipt.tree.status).toBe("incomplete");
  });
});
