import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_ACK_SCHEMA,
  LIVE_FRAME_SCHEMA,
  LIVE_SESSION_SCHEMA,
  LiveContractError,
  parseLiveJson,
  validateLiveAck,
  validateLiveFrame,
  validateLiveSession,
  type LiveFrame,
  type LiveSession
} from "./live-session-contract.js";
import { LiveSessionStore } from "./live-session-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("live contract validation", () => {
  it("rejects non-finite numbers, extra properties, unsafe paths, and invalid ACK ranges", () => {
    expect(() => validateLiveFrame({ ...frame(1, Buffer.from("one")), camera_to_world: [Number.NaN, ...Array(15).fill(0)] }))
      .toThrow(/finite/);
    expect(() => parseLiveJson('{"value":NaN}')).toThrow(/strict JSON/);
    expect(() => validateLiveSession({ ...session(), extra: true })).toThrow(/not allowed/);
    for (const invalidPath of ["/tmp/frame.jpg", "file:///tmp/frame.jpg", "rgb\\frame.jpg", "../frame.jpg", "rgb//frame.jpg", "rgb/"]) {
      const value = session();
      value.source_manifest.path = invalidPath;
      expect(() => validateLiveSession(value), invalidPath).toThrow(/safe POSIX-relative path/);
    }
    expect(() => validateLiveAck({
      schema: LIVE_ACK_SCHEMA,
      session_id: "test",
      operation: "resume",
      status: "accepted",
      received_count: 0,
      contiguous_count: 0,
      pending_count: 0,
      expected_frame_count: 2,
      next_expected_sequence_id: 1,
      missing_ranges: [{ start: 2, end: 2 }, { start: 1, end: 1 }],
      finalized: false
    })).toThrow(/sorted and disjoint/);
  });
});

describe("LiveSessionStore", () => {
  it("persists out-of-order frames, reports gaps, resumes, and finalizes an importable handoff", async () => {
    const root = await tempRoot("out-of-order");
    const store = new LiveSessionStore(root);
    await store.initialize();
    expect((await store.putSession(session())).status).toBe("accepted");

    const bytes2 = Buffer.from("frame-two");
    const frame2 = frame(2, bytes2);
    await store.putFrame(frame2);
    expect((await store.putAsset("test-session", 2, "source", chunks(bytes2))).status).toBe("accepted");
    expect(await store.snapshot("test-session")).toMatchObject({
      receivedCount: 1,
      contiguousCount: 0,
      pendingCount: 1,
      nextExpectedSequenceId: 1,
      missingRanges: [{ start: 1, end: 1 }]
    });
    expect((await store.resume("test-session")).missing_ranges).toEqual([{ start: 1, end: 1 }]);
    expect((await store.putFrame(frame2)).status).toBe("duplicate");
    expect(() => store.putFrame({ ...frame2, tracking: { state: "limited" } })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.putAsset("test-session", 2, "source", chunks(Buffer.from("frame-XXX"))))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.finalize(finalize(2))).rejects.toThrow(/missing frame ranges: 1/);

    const bytes1 = Buffer.from("frame-one");
    const frame1 = frame(1, bytes1);
    await store.putFrame(frame1);
    await store.putAsset("test-session", 1, "source", chunks(bytes1));
    const finalized = await store.finalize(finalize(2));
    expect(finalized.status).toBe("finalized");
    expect(finalized.finalized).toBe(true);

    const handoff = JSON.parse(await readFile(path.join(root, "test-session", "capture-splat.world-studio.json"), "utf8")) as {
      source_frames: Array<{ path: string; camera: Record<string, unknown>; intrinsics: Record<string, unknown> }>;
    };
    expect(handoff.source_frames[0]?.path).toBe("frames/00000001/source.jpg");
    expect(handoff.source_frames[0]?.intrinsics).toMatchObject({
      fl_x: 5,
      calibration_width: 10,
      calibration_height: 5
    });
    expect(handoff.source_frames[0]?.camera).toMatchObject({
      width: 20,
      height: 10,
      fx: 10,
      fy: 12,
      cx: 10,
      cy: 4,
      translation: [1, 1, -1],
      rotation: [1, 0, 0, 0],
      coordinate_frame: "arkit_world"
    });

    const recovered = new LiveSessionStore(root);
    await recovered.initialize();
    expect(await recovered.snapshot("test-session")).toMatchObject({
      finalSequenceId: 2,
      receivedCount: 2,
      finalized: true
    });
    await expect(recovered.putFrame(frame1)).rejects.toMatchObject({ code: "sealed" });
    expect((await recovered.putSession(session())).status).toBe("duplicate");
    expect((await recovered.finalize(finalize(2))).status).toBe("finalized");
    await expect(recovered.finalize(finalize(1))).rejects.toMatchObject({ code: "conflict" });
  });

  it("validates bytes before ACK, rejects corruption on final rehash, and rejects symlinks", async () => {
    const root = await tempRoot("corruption");
    const store = new LiveSessionStore(root);
    await store.putSession(session(1));
    const expected = Buffer.from("correct-bytes");
    const metadata = frame(1, expected);
    await store.putFrame(metadata);
    await expect(store.putAsset("test-session", 1, "source", chunks(Buffer.from("wrong--bytes!"))))
      .rejects.toThrow(/SHA-256 mismatch/);
    expect((await store.snapshot("test-session")).receivedCount).toBe(0);
    await store.putAsset("test-session", 1, "source", chunks(expected));

    const sourcePath = path.join(root, "test-session", "frames", "00000001", "source.jpg");
    await writeFile(sourcePath, Buffer.from("changed-byte!"));
    await expect(store.readFramePreview("test-session", 1)).rejects.toThrow(/checksum differs/);
    await expect(store.putAsset("test-session", 1, "source", chunks(expected))).rejects.toThrow(/checksum differs/);
    await expect(store.finalize(finalize(1))).rejects.toThrow(/checksum differs/);

    const symlinkRoot = await tempRoot("symlink");
    const symlinkStore = new LiveSessionStore(symlinkRoot);
    await symlinkStore.putSession(session(1));
    await symlinkStore.putFrame(metadata);
    await symlinkStore.putAsset("test-session", 1, "source", chunks(expected));
    const external = path.join(symlinkRoot, "external.jpg");
    await writeFile(external, expected);
    const storedSource = path.join(symlinkRoot, "test-session", "frames", "00000001", "source.jpg");
    await rm(storedSource);
    await symlink(external, storedSource);
    await expect(symlinkStore.finalize(finalize(1))).rejects.toThrow(/symbolic link/);
  });

  it("discards partial incoming uploads on restart and accepts replay", async () => {
    const root = await tempRoot("restart");
    const first = new LiveSessionStore(root);
    await first.putSession(session(1));
    const bytes = Buffer.from("restart-frame");
    const metadata = frame(1, bytes);
    await first.putFrame(metadata);
    await writeFile(path.join(root, "test-session", ".incoming", "00000001", ".stale.tmp"), "partial");

    const recovered = new LiveSessionStore(root);
    await recovered.initialize();
    await expect(recovered.putAsset("test-session", 1, "source", chunks(bytes))).rejects.toThrow(/metadata must be PUT/i);
    await recovered.putFrame(metadata);
    expect((await recovered.putAsset("test-session", 1, "source", chunks(bytes))).status).toBe("accepted");
    expect((await recovered.resume("test-session")).received_count).toBe(1);
  });

  it("handles pending asset retries as duplicates and conflicts", async () => {
    const root = await tempRoot("pending-duplicate");
    const store = new LiveSessionStore(root);
    await store.putSession(session(1));
    const source = Buffer.from("pending-source");
    const depth = Buffer.from("pending-depth");
    const metadata = frameWithDepth(1, source, depth);
    expect((await store.putFrame(metadata)).status).toBe("incomplete");
    expect((await store.putFrame(metadata)).status).toBe("duplicate");
    expect((await store.putAsset("test-session", 1, "source", chunks(source))).status).toBe("incomplete");
    expect((await store.putAsset("test-session", 1, "source", chunks(source))).status).toBe("duplicate");
    await expect(store.putAsset("test-session", 1, "source", chunks(Buffer.from("changed-source"))))
      .rejects.toMatchObject({ code: "conflict" });
    expect((await store.putAsset("test-session", 1, "depth", chunks(depth))).status).toBe("accepted");
  });

  it("rejects non-regular or identity-changing pending metadata before commit", async () => {
    const root = await tempRoot("pending-metadata-integrity");
    const store = new LiveSessionStore(root);
    await store.putSession(session(1));
    const bytes = Buffer.from("pending-frame");
    const metadata = frame(1, bytes);
    await store.putFrame(metadata);
    const metadataPath = path.join(root, "test-session", ".incoming", "00000001", "metadata.json");
    const externalMetadata = path.join(root, "external-metadata.json");
    await writeFile(externalMetadata, `${JSON.stringify(metadata)}\n`);
    await rm(metadataPath);
    await symlink(externalMetadata, metadataPath);
    await expect(store.putAsset("test-session", 1, "source", chunks(bytes)))
      .rejects.toThrow(/regular file/);

    await rm(metadataPath);
    await mkdir(metadataPath);
    await expect(store.putAsset("test-session", 1, "source", chunks(bytes)))
      .rejects.toThrow(/regular file/);

    await rm(metadataPath, { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify({ ...metadata, session_id: "other-session" })}\n`);
    await expect(store.putAsset("test-session", 1, "source", chunks(bytes)))
      .rejects.toThrow(/differs from its session/);

    await writeFile(metadataPath, `${JSON.stringify({ ...metadata, sequence_id: 2 })}\n`);
    await expect(store.putAsset("test-session", 1, "source", chunks(bytes)))
      .rejects.toThrow(/route sequence/);

    await writeFile(metadataPath, `${JSON.stringify({ ...metadata, coordinate_frame: "other-world" })}\n`);
    await expect(store.putAsset("test-session", 1, "source", chunks(bytes)))
      .rejects.toThrow(/differs from its session/);

    await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`);
    expect((await store.putAsset("test-session", 1, "source", chunks(bytes))).status).toBe("accepted");
  });

  it("rehashes the sealed state before acknowledging idempotent finalization", async () => {
    const root = await tempRoot("repeat-finalize-integrity");
    const store = new LiveSessionStore(root);
    await store.putSession(session(1));
    const bytes = Buffer.from("sealed-frame");
    await store.putFrame(frame(1, bytes));
    await store.putAsset("test-session", 1, "source", chunks(bytes));
    await store.finalize(finalize(1));

    const sourcePath = path.join(root, "test-session", "frames", "00000001", "source.jpg");
    await writeFile(sourcePath, Buffer.from("changed-byte"));
    await expect(store.finalize(finalize(1))).rejects.toThrow(/checksum differs/);

    await writeFile(sourcePath, bytes);
    await writeFile(path.join(root, "test-session", "capture-splat.world-studio.json"), "{}\n");
    await expect(store.finalize(finalize(1))).rejects.toThrow(/handoff checksum differs/);
  });

  it("rejects display-camera intrinsics that become non-finite while scaling", async () => {
    const root = await tempRoot("display-intrinsics-overflow");
    const store = new LiveSessionStore(root);
    await store.putSession(session(1));
    const bytes = Buffer.from("overflow-frame");
    const metadata = frame(1, bytes);
    metadata.intrinsics.fl_x = Number.MAX_VALUE;
    await store.putFrame(metadata);
    await store.putAsset("test-session", 1, "source", chunks(bytes));
    await expect(store.finalize(finalize(1))).rejects.toThrow(/intrinsics overflowed/);
  });

  it("rejects committed frames beyond an undeclared final sequence", async () => {
    const root = await tempRoot("extra-frame");
    const store = new LiveSessionStore(root);
    const openEnded = session();
    delete openEnded.expected_frame_count;
    await store.putSession(openEnded);
    for (const sequenceId of [1, 2]) {
      const bytes = Buffer.from(`frame-${sequenceId}`);
      await store.putFrame(frame(sequenceId, bytes));
      await store.putAsset("test-session", sequenceId, "source", chunks(bytes));
    }
    await expect(store.finalize(finalize(1))).rejects.toThrow(/beyond the final sequence/);
  });

  it("stores canonical unsupported source media without offering a preview", async () => {
    const root = await tempRoot("source-bin");
    const store = new LiveSessionStore(root);
    await store.putSession(session(1));
    const bytes = Buffer.from("opaque-source");
    const metadata = frame(1, bytes);
    metadata.source_frame.media_type = "application/octet-stream";
    await store.putFrame(metadata);
    expect((await store.putAsset("test-session", 1, "source", chunks(bytes))).status).toBe("accepted");
    expect((await store.snapshot("test-session")).frames[0]?.previewAvailable).toBe(false);
    expect(await store.readFramePreview("test-session", 1)).toBeNull();
    expect(await readFile(path.join(root, "test-session", "frames", "00000001", "source.bin"))).toEqual(bytes);
  });

  it("discards only receiver-owned stale publication directories", async () => {
    const root = await tempRoot("stale-publication");
    await mkdir(path.join(root, ".creating-stale"));
    await writeFile(path.join(root, ".creating-stale", "partial"), "partial");
    await mkdir(path.join(root, ".unrelated"));
    const store = new LiveSessionStore(root);
    await store.initialize();
    expect(await readdir(root)).toEqual([".unrelated"]);
  });

  it("bounds receiver-owned sequence paths and reports a huge declared gap without iterating it", async () => {
    const root = await tempRoot("bounded-sequence");
    const store = new LiveSessionStore(root);
    const maximum = session(99_999_999);
    const ack = await store.putSession(maximum);
    expect(ack.missing_ranges).toEqual([{ start: 1, end: 99_999_999 }]);
    const tooLarge = session(100_000_000);
    tooLarge.session_id = "too-large";
    await expect(store.putSession(tooLarge)).rejects.toThrow(/must not exceed 99999999/);
    const bytes = Buffer.from("too-large-frame");
    const oversizedFrame = frame(100_000_000, bytes);
    await expect(store.putFrame(oversizedFrame)).rejects.toThrow(/must not exceed 99999999/);
  });

  it("fails closed when sealed assets or final sequence metadata are tampered before restart", async () => {
    const assetRoot = await tempRoot("sealed-asset-corrupt");
    const assetStore = new LiveSessionStore(assetRoot);
    await assetStore.putSession(session(1));
    const bytes = Buffer.from("sealed-frame");
    await assetStore.putFrame(frame(1, bytes));
    await assetStore.putAsset("test-session", 1, "source", chunks(bytes));
    await assetStore.finalize(finalize(1));
    await writeFile(
      path.join(assetRoot, "test-session", "frames", "00000001", "source.jpg"),
      Buffer.from("changed-byte")
    );
    await expect(new LiveSessionStore(assetRoot).initialize()).rejects.toThrow(/checksum differs/);

    const markerRoot = await tempRoot("sealed-marker-corrupt");
    const markerStore = new LiveSessionStore(markerRoot);
    await markerStore.putSession(session(2));
    for (const sequenceId of [1, 2]) {
      const frameBytes = Buffer.from(`marker-${sequenceId}`);
      await markerStore.putFrame(frame(sequenceId, frameBytes));
      await markerStore.putAsset("test-session", sequenceId, "source", chunks(frameBytes));
    }
    await markerStore.finalize(finalize(2));
    const markerPath = path.join(markerRoot, "test-session", "finalized.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
    marker.final_sequence_id = 1;
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    await expect(new LiveSessionStore(markerRoot).initialize()).rejects.toThrow(/expected_frame_count/);

    const metadataRoot = await tempRoot("sealed-metadata-corrupt");
    const metadataStore = new LiveSessionStore(metadataRoot);
    await metadataStore.putSession(session(1));
    const metadataBytes = Buffer.from("metadata-frame");
    await metadataStore.putFrame(frame(1, metadataBytes));
    await metadataStore.putAsset("test-session", 1, "source", chunks(metadataBytes));
    await metadataStore.finalize(finalize(1));
    const metadataPath = path.join(metadataRoot, "test-session", "frames", "00000001", "metadata.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as LiveFrame;
    metadata.camera_to_world[3] = 9;
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await expect(new LiveSessionStore(metadataRoot).initialize()).rejects.toThrow(/handoff differs/);
  });

  it("rejects a symbolic-link session directory during recovery", async () => {
    const root = await tempRoot("session-link");
    const outside = await tempRoot("outside");
    await mkdir(path.join(outside, "victim"));
    await symlink(path.join(outside, "victim"), path.join(root, "linked-session"));
    const store = new LiveSessionStore(root);
    await expect(store.initialize()).rejects.toMatchObject({ code: "corrupt" });
  });
});

function session(expectedFrameCount = 2): LiveSession {
  return {
    schema: LIVE_SESSION_SCHEMA,
    session_id: "test-session",
    created_at: "2026-01-02T03:04:05Z",
    source_manifest: {
      path: "capture.json",
      sha256: hash(Buffer.from("capture-manifest")),
      size_bytes: 16,
      schema: "capture_splat.v0.3"
    },
    expected_frame_count: expectedFrameCount,
    coordinate_system: {
      id: "arkit_world",
      units: "meters",
      handedness: "right",
      world_up: "+Y",
      camera_forward: "-Z",
      matrix_layout: "row-major",
      vector_convention: "column-vector"
    },
    authority: "proposal_only"
  };
}

function frame(sequenceId: number, bytes: Buffer): LiveFrame {
  return {
    schema: LIVE_FRAME_SCHEMA,
    session_id: "test-session",
    sequence_id: sequenceId,
    timestamp: { value: sequenceId * 0.25, clock_domain: "arkit_session" },
    source_frame: {
      path: `sender/path/frame-${sequenceId}.jpg`,
      sha256: hash(bytes),
      size_bytes: bytes.byteLength,
      media_type: "image/jpeg",
      width: 20,
      height: 10
    },
    intrinsics: {
      model: "pinhole",
      fl_x: 5,
      fl_y: 6,
      cx: 5,
      cy: 2,
      calibration_width: 10,
      calibration_height: 5,
      applies_to: "depth"
    },
    camera_to_world: [
      1, 0, 0, sequenceId,
      0, 1, 0, 1,
      0, 0, 1, -sequenceId,
      0, 0, 0, 1
    ],
    coordinate_frame: "arkit_world",
    tracking: { state: "normal" },
    quality: { accepted: true, score: 0.9 }
  };
}

function frameWithDepth(sequenceId: number, source: Buffer, depth: Buffer): LiveFrame {
  return {
    ...frame(sequenceId, source),
    assets: {
      depth: {
        path: `depth/frame-${sequenceId}.npy`,
        sha256: hash(depth),
        size_bytes: depth.byteLength,
        media_type: "application/x-npy",
        width: 10,
        height: 5
      }
    }
  };
}

function finalize(finalSequenceId: number) {
  return {
    schema: "capture_splat.live_finalize.v0.1",
    session_id: "test-session",
    final_sequence_id: finalSequenceId
  };
}

function hash(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function* chunks(bytes: Buffer): AsyncGenerator<Uint8Array> {
  const middle = Math.floor(bytes.byteLength / 2);
  yield bytes.subarray(0, middle);
  yield bytes.subarray(middle);
}

async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-live-${name}-`));
  roots.push(root);
  return root;
}
