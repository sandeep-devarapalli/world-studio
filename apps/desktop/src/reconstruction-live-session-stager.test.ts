import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_FINALIZE_V2_SCHEMA,
  LIVE_FRAME_SCHEMA,
  LIVE_SESSION_SCHEMA,
  LIVE_SESSION_V2_SCHEMA,
  deriveLiveSessionV2Id,
  type LiveFrame,
  type LiveSession,
  type LiveSessionV2
} from "./live-session-contract.js";
import { LiveSessionStore } from "./live-session-store.js";
import { ReconstructionLiveSessionInputStager } from "./reconstruction-live-session-stager.js";
import { stableReconstructionJson } from "./reconstruction-worker-contract.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ReconstructionLiveSessionInputStager", () => {
  it("freezes a progressive session with gaps using only receiver-owned paths", async () => {
    const store = await progressiveStore("progressive-gaps");
    const sourceOne = Buffer.from("source-one");
    const sourceThree = Buffer.from("source-three");
    const depthThree = Buffer.from("depth-three");
    await commitFrame(store, liveFrame(progressiveId(), 1, sourceOne), sourceOne);
    await commitFrame(store, liveFrame(progressiveId(), 3, sourceThree, depthThree), sourceThree, depthThree);
    const destination = await publicationRoot("progressive-output");

    const staged = await new ReconstructionLiveSessionInputStager(store).stage({
      sessionId: progressiveId(),
      destinationRoot: destination,
      maxBytes: 1_000_000,
      maxArtifacts: 32
    });

    expect(staged.source).toEqual({
      session_id: progressiveId(),
      live_session_schema: LIVE_SESSION_V2_SCHEMA,
      final_sequence_id: null
    });
    expect(staged.summary).toMatchObject({
      sessionId: progressiveId(),
      throughSequenceId: 3,
      frameCount: 2
    });
    expect(staged.summary.manifestSha256).toBe(hash(Buffer.from(stableReconstructionJson(staged.inputs))));
    expect(staged.inputs.every((artifact) => artifact.path.startsWith("inputs/"))).toBe(true);
    expect(staged.inputs.map((artifact) => artifact.path)).toEqual([...staged.inputs]
      .map((artifact) => artifact.path)
      .sort());
    expect(staged.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "source", path: "inputs/frames/00000001/source.jpg", sha256: hash(sourceOne) }),
      expect.objectContaining({ role: "source", path: "inputs/frames/00000003/source.jpg", sha256: hash(sourceThree) }),
      expect.objectContaining({ role: "depth", path: "inputs/frames/00000003/depth.npy", sha256: hash(depthThree) })
    ]));
    const manifest = JSON.parse(await readFile(path.join(destination, "inputs/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      schema: "world_studio.reconstruction_input_manifest.v0.1",
      session_id: progressiveId(),
      committed_sequence_ids: [1, 3],
      missing_ranges: [{ start: 2, end: 2 }],
      finalized: false,
      final_sequence_id: null,
      authority: "proposal_only",
      loaded_world_effect: "none"
    });
    expect(await readFile(path.join(destination, "inputs/frames/00000003/source.jpg"))).toEqual(sourceThree);
    await expect(readFile(path.join(store.sessionDirectory(progressiveId()), "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("includes checksum-bound finalization evidence for a finalized progressive session", async () => {
    const store = await progressiveStore("finalized");
    const source = Buffer.from("final-source");
    await commitFrame(store, liveFrame(progressiveId(), 1, source), source);
    await store.finalize({
      schema: LIVE_FINALIZE_V2_SCHEMA,
      session_id: progressiveId(),
      final_sequence_id: 1,
      source_manifest: {
        path: "capture.json",
        sha256: hash(Buffer.from("capture-json")),
        size_bytes: 12,
        schema: "capture_splat.v0.3"
      }
    });
    const destination = await publicationRoot("finalized-output");

    const staged = await new ReconstructionLiveSessionInputStager(store).stage({
      sessionId: progressiveId(),
      destinationRoot: destination,
      maxBytes: 1_000_000,
      maxArtifacts: 32
    });

    expect(staged.source.final_sequence_id).toBe(1);
    expect(staged.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "live_finalization_metadata", path: "inputs/finalized.json" }),
      expect.objectContaining({ role: "live_source_manifest_binding", path: "inputs/source-manifest-binding.json" }),
      expect.objectContaining({ role: "live_handoff", path: "inputs/capture-splat.world-studio.json" })
    ]));
    const manifest = JSON.parse(await readFile(path.join(destination, "inputs/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ finalized: true, final_sequence_id: 1, missing_ranges: [] });

    const sessionRoot = store.sessionDirectory(progressiveId());
    const bindingPath = path.join(sessionRoot, "source-manifest-binding.json");
    const handoffPath = path.join(sessionRoot, "capture-splat.world-studio.json");
    const markerPath = path.join(sessionRoot, "finalized.json");
    const binding = JSON.parse(await readFile(bindingPath, "utf8"));
    binding.source_manifest.sha256 = `sha256:${"f".repeat(64)}`;
    binding.source_manifest.size_bytes = 999;
    const bindingSha256 = await writeJsonAndHash(bindingPath, binding);
    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    handoff.source_manifest = binding.source_manifest;
    handoff.status = "rewritten_visual_evidence";
    const handoffSha256 = await writeJsonAndHash(handoffPath, handoff);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.source_manifest_binding_sha256 = bindingSha256;
    marker.handoff_sha256 = handoffSha256;
    await writeJsonAndHash(markerPath, marker);

    await expect(new ReconstructionLiveSessionInputStager(store).stage({
      sessionId: progressiveId(),
      destinationRoot: await publicationRoot("coherent-rewrite-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 32
    })).rejects.toThrow(/source manifest binding differs|handoff differs/);
  });

  it("rejects corrupted checksums and changed committed metadata", async () => {
    const corrupted = await legacyStore("corrupt-asset");
    const bytes = Buffer.from("good");
    await commitFrame(corrupted, liveFrame("test-session", 1, bytes), bytes);
    await writeFile(path.join(corrupted.sessionDirectory("test-session"), "frames/00000001/source.jpg"), "evil");
    await expect(new ReconstructionLiveSessionInputStager(corrupted).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("corrupt-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/checksum differs/);

    const changed = await legacyStore("changed-metadata");
    await commitFrame(changed, liveFrame("test-session", 1, bytes), bytes);
    const metadataPath = path.join(changed.sessionDirectory("test-session"), "frames/00000001/metadata.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    metadata.quality.score = 0.1;
    await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`);
    await expect(new ReconstructionLiveSessionInputStager(changed).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("changed-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/metadata changed/);
  });

  it("rejects malformed UTF-8 in session, frame, and finalized metadata", async () => {
    const bytes = Buffer.from("utf8-source");
    const sessionStore = await legacyStore("invalid-utf8-session");
    await commitFrame(sessionStore, liveFrame("test-session", 1, bytes), bytes);
    await corruptUtf8(
      path.join(sessionStore.sessionDirectory("test-session"), "session.json"),
      "test-session"
    );
    await expect(new ReconstructionLiveSessionInputStager(sessionStore).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("invalid-utf8-session-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/valid UTF-8/);

    const frameStore = await legacyStore("invalid-utf8-frame");
    await commitFrame(frameStore, liveFrame("test-session", 1, bytes), bytes);
    await corruptUtf8(
      path.join(frameStore.sessionDirectory("test-session"), "frames/00000001/metadata.json"),
      "sender/rgb"
    );
    await expect(new ReconstructionLiveSessionInputStager(frameStore).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("invalid-utf8-frame-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/valid UTF-8/);

    const finalizedStore = await progressiveStore("invalid-utf8-finalized");
    await commitFrame(finalizedStore, liveFrame(progressiveId(), 1, bytes), bytes);
    await finalizedStore.finalize({
      schema: LIVE_FINALIZE_V2_SCHEMA,
      session_id: progressiveId(),
      final_sequence_id: 1,
      source_manifest: {
        path: "capture.json",
        sha256: hash(Buffer.from("capture-json")),
        size_bytes: 12,
        schema: "capture_splat.v0.3"
      }
    });
    await corruptUtf8(
      path.join(finalizedStore.sessionDirectory(progressiveId()), "finalized.json"),
      "2026-"
    );
    await expect(new ReconstructionLiveSessionInputStager(finalizedStore).stage({
      sessionId: progressiveId(),
      destinationRoot: await publicationRoot("invalid-utf8-finalized-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 32
    })).rejects.toThrow(/valid UTF-8/);
  });

  it("rejects symlinks, hardlinks, traversal, and unsafe destination components", async () => {
    const bytes = Buffer.from("source");
    const linked = await legacyStore("hardlink");
    await commitFrame(linked, liveFrame("test-session", 1, bytes), bytes);
    const linkedSource = path.join(linked.sessionDirectory("test-session"), "frames/00000001/source.jpg");
    await link(linkedSource, path.join(linked.sessionDirectory("test-session"), "hardlink-copy.jpg"));
    await expect(new ReconstructionLiveSessionInputStager(linked).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("hardlink-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/hard-linked/);

    const symbolic = await legacyStore("symlink");
    await commitFrame(symbolic, liveFrame("test-session", 1, bytes), bytes);
    const symbolicSource = path.join(symbolic.sessionDirectory("test-session"), "frames/00000001/source.jpg");
    const outside = path.join(await tempRoot("outside"), "source.jpg");
    await writeFile(outside, bytes);
    await rm(symbolicSource);
    await symlink(outside, symbolicSource);
    await expect(new ReconstructionLiveSessionInputStager(symbolic).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("symlink-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/symbolic link/);

    const parentLinked = await legacyStore("frames-parent-link");
    await commitFrame(parentLinked, liveFrame("test-session", 1, bytes), bytes);
    const parentFrames = path.join(parentLinked.sessionDirectory("test-session"), "frames");
    const outsideParent = path.join(await tempRoot("outside-frames-parent"), "frames");
    await rename(parentFrames, outsideParent);
    await symlink(outsideParent, parentFrames);
    await expect(new ReconstructionLiveSessionInputStager(parentLinked).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("frames-parent-link-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/Live frames directory must be a real directory/);

    const special = await legacyStore("special-file");
    await commitFrame(special, liveFrame("test-session", 1, bytes), bytes);
    const specialSource = path.join(special.sessionDirectory("test-session"), "frames/00000001/source.jpg");
    await rm(specialSource);
    await mkdir(specialSource);
    await expect(new ReconstructionLiveSessionInputStager(special).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("special-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/regular file/);

    await expect(new ReconstructionLiveSessionInputStager(symbolic).stage({
      sessionId: "../test-session",
      destinationRoot: await publicationRoot("traversal-output"),
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/session_id|session ID/i);

    const safeStore = await legacyStore("unsafe-destination");
    await commitFrame(safeStore, liveFrame("test-session", 1, bytes), bytes);
    const destination = await tempRoot("destination-link");
    const outsideInputs = await tempRoot("outside-inputs");
    await symlink(outsideInputs, path.join(destination, "inputs"));
    await expect(new ReconstructionLiveSessionInputStager(safeStore).stage({
      sessionId: "test-session",
      destinationRoot: destination,
      maxBytes: 1_000_000,
      maxArtifacts: 16
    })).rejects.toThrow(/real directory/);
  });

  it("enforces total byte and artifact-count bounds before publishing a manifest", async () => {
    const store = await legacyStore("bounds");
    const bytes = Buffer.from("bounded-source");
    await commitFrame(store, liveFrame("test-session", 1, bytes), bytes);
    await expect(new ReconstructionLiveSessionInputStager(store).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("byte-bound"),
      maxBytes: 1,
      maxArtifacts: 16
    })).rejects.toThrow(/byte bound/);
    await expect(new ReconstructionLiveSessionInputStager(store).stage({
      sessionId: "test-session",
      destinationRoot: await publicationRoot("count-bound"),
      maxBytes: 1_000_000,
      maxArtifacts: 2
    })).rejects.toThrow(/artifact count/);
  });
});

async function progressiveStore(name: string): Promise<LiveSessionStore> {
  const store = new LiveSessionStore(await tempRoot(name));
  await store.putSession(progressiveSession());
  return store;
}

async function legacyStore(name: string): Promise<LiveSessionStore> {
  const store = new LiveSessionStore(await tempRoot(name));
  await store.putSession(legacySession());
  return store;
}

async function commitFrame(
  store: LiveSessionStore,
  frame: LiveFrame,
  source: Buffer,
  depth?: Buffer
): Promise<void> {
  await store.putFrame(frame);
  await store.putAsset(frame.session_id, frame.sequence_id, "source", chunks(source));
  if (depth) await store.putAsset(frame.session_id, frame.sequence_id, "depth", chunks(depth));
}

function progressiveSession(): LiveSessionV2 {
  const seed = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  return {
    schema: LIVE_SESSION_V2_SCHEMA,
    session_id: deriveLiveSessionV2Id(seed),
    created_at: "2026-08-09T10:00:00.000Z",
    source_session_seed_b64u: seed.toString("base64url"),
    expected_frame_count: null,
    coordinate_system: coordinateSystem(),
    authority: "proposal_only"
  };
}

function progressiveId(): string {
  return progressiveSession().session_id;
}

function legacySession(): LiveSession {
  return {
    schema: LIVE_SESSION_SCHEMA,
    session_id: "test-session",
    created_at: "2026-08-09T10:00:00.000Z",
    source_manifest: {
      path: "capture.json",
      sha256: hash(Buffer.from("capture-manifest")),
      size_bytes: 16,
      schema: "capture_splat.v0.3"
    },
    expected_frame_count: 1,
    coordinate_system: coordinateSystem(),
    authority: "proposal_only"
  };
}

function coordinateSystem() {
  return {
    id: "arkit_world",
    units: "meters" as const,
    handedness: "right" as const,
    world_up: "+Y" as const,
    camera_forward: "-Z" as const,
    matrix_layout: "row-major" as const,
    vector_convention: "column-vector" as const
  };
}

function liveFrame(sessionId: string, sequenceId: number, source: Buffer, depth?: Buffer): LiveFrame {
  return {
    schema: LIVE_FRAME_SCHEMA,
    session_id: sessionId,
    sequence_id: sequenceId,
    timestamp: { value: sequenceId * 0.25, clock_domain: "arkit_session" },
    source_frame: {
      path: `sender/rgb/frame-${sequenceId}.jpg`,
      sha256: hash(source),
      size_bytes: source.byteLength,
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
    quality: { accepted: true, score: 0.9 },
    ...(depth ? {
      assets: {
        depth: {
          path: `sender/depth/frame-${sequenceId}.npy`,
          sha256: hash(depth),
          size_bytes: depth.byteLength,
          media_type: "application/x-npy",
          width: 10,
          height: 5
        }
      }
    } : {})
  };
}

async function publicationRoot(name: string): Promise<string> {
  const root = await tempRoot(name);
  await mkdir(path.join(root, "inputs"), { mode: 0o700 });
  return root;
}

async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-reconstruction-${name}-`));
  roots.push(root);
  return root;
}

async function* chunks(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes;
}

function hash(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function writeJsonAndHash(filePath: string, value: unknown): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(filePath, bytes);
  return hash(bytes);
}

async function corruptUtf8(filePath: string, needle: string): Promise<void> {
  const bytes = await readFile(filePath);
  const offset = bytes.indexOf(Buffer.from(needle, "utf8"));
  if (offset < 0) throw new Error(`Fixture text ${needle} was not found.`);
  bytes[offset] = 0xff;
  await writeFile(filePath, bytes);
}
