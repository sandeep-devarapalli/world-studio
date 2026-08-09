import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_AUTH_RECEIPT_SCHEMA,
  LIVE_AUTH_SCHEME,
  LIVE_PAIRING_PERMISSIONS,
  type LiveAuthReceipt
} from "./live-auth-contract.js";
import {
  LIVE_ACK_SCHEMA,
  LIVE_FINALIZE_V2_SCHEMA,
  LIVE_FRAME_SCHEMA,
  LIVE_SESSION_SCHEMA,
  LIVE_SESSION_V2_SCHEMA,
  LiveContractError,
  deriveLiveSessionV2Id,
  parseLiveJson,
  validateLiveAck,
  validateLiveFinalize,
  validateLiveFrame,
  validateLiveSession,
  validateLiveSessionDeclaration,
  type LiveFrame,
  type LiveSession,
  type LiveSessionV2
} from "./live-session-contract.js";
import { LiveSessionStore } from "./live-session-store.js";

const roots: string[] = [];
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcunXrfwAJpwP6J7EkXwAAAABJRU5ErkJggg==",
  "base64"
);
const onePixelJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD8S6KKK0A//9k=",
  "base64"
);
const onePixelWebp = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vp3QAA=", "base64");

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

  it("derives progressive session IDs and rejects malformed or noncanonical seeds", () => {
    const seed = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    expect(deriveLiveSessionV2Id(seed))
      .toBe("csl_SMOhjzjH7dE8x3yB5A0KBAo4YL6A4IzY1U570kVX_D8");
    expect(validateLiveSessionDeclaration(sessionV2()).schema).toBe(LIVE_SESSION_V2_SCHEMA);
    expect(() => validateLiveSessionDeclaration({
      ...sessionV2(),
      session_id: `csl_${"A".repeat(43)}`
    })).toThrow(/does not match/);
    expect(() => validateLiveSessionDeclaration({
      ...sessionV2(),
      source_session_seed_b64u: `${sessionV2().source_session_seed_b64u}=`
    })).toThrow(/canonical unpadded/);
    expect(() => validateLiveSessionDeclaration({
      ...sessionV2(),
      source_session_seed_b64u: Buffer.alloc(31).toString("base64url")
    })).toThrow(/canonical unpadded/);
    const missingExpected = { ...sessionV2() } as Record<string, unknown>;
    delete missingExpected.expected_frame_count;
    expect(() => validateLiveSessionDeclaration(missingExpected)).toThrow(/expected_frame_count is required/);
    expect(() => validateLiveSessionDeclaration({
      ...sessionV2(),
      expected_frame_count: 2
    })).toThrow(/must be null/);
    expect(() => validateLiveFinalize({
      ...finalizeV2(2),
      source_manifest: {
        ...finalizeV2(2).source_manifest,
        path: "../capture.json"
      }
    })).toThrow(/must equal capture\.json/);
    expect(() => validateLiveFinalize({
      ...finalizeV2(2),
      source_manifest: {
        ...finalizeV2(2).source_manifest,
        sha256: "sha256:not-a-checksum"
      }
    })).toThrow(/sha256:/);
    expect(() => validateLiveFinalize({
      ...finalizeV2(2),
      source_manifest: {
        ...finalizeV2(2).source_manifest,
        size_bytes: 0
      }
    })).toThrow(/at least 1/);
    expect(() => validateLiveFinalize({
      ...finalizeV2(2),
      source_manifest: {
        ...finalizeV2(2).source_manifest,
        extra: true
      }
    })).toThrow(/not allowed/);
    expect(() => validateLiveFinalize({
      ...finalizeV2(2),
      session_id: `csl_${"A".repeat(42)}9`
    })).toThrow(/canonical csl_/);
    expect(() => validateLiveFinalize({
      ...finalizeV2(2),
      session_id: "not-progressive"
    })).toThrow(/canonical csl_/);
  });
});

describe("LiveSessionStore", () => {
  it("persists authenticated provenance and never crosses the LAN/loopback ownership boundary", async () => {
    const root = await tempRoot("authenticated-owner");
    const receipt = authReceipt();
    const store = new LiveSessionStore(root);
    expect((await store.putSession(session(1), receipt)).status).toBe("accepted");
    await expect(store.putFrame(frame(1, Buffer.from("secure"))))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.putFrame(
      frame(1, Buffer.from("secure")),
      { ...receipt, device_id: `csd_${"A".repeat(43)}` }
    )).rejects.toMatchObject({ code: "conflict" });

    const bytes = Buffer.from("secure");
    await store.putFrame(frame(1, bytes), receipt);
    await expect(store.putAsset(
      "test-session",
      1,
      "source",
      chunks(Buffer.from("tamper")),
      hash(bytes),
      receipt
    )).rejects.toMatchObject({ code: "auth_body" });
    await expect(store.putAsset(
      "test-session",
      1,
      "source",
      chunks(bytes),
      hash(Buffer.from("different")),
      receipt
    )).rejects.toMatchObject({ code: "auth_body" });
    await store.putAsset("test-session", 1, "source", chunks(bytes), hash(bytes), receipt);
    await store.finalize(finalize(1), receipt);
    const receiptBytes = await readFile(path.join(root, "test-session", "auth-receipt.json"));
    expect(JSON.parse(receiptBytes.toString("utf8"))).toEqual(receipt);
    expect(JSON.parse(
      await readFile(path.join(root, "test-session", "capture-splat.world-studio.json"), "utf8")
    )).toMatchObject({
      live_auth_receipt: "auth-receipt.json",
      live_auth_receipt_sha256: hash(receiptBytes)
    });

    const recovered = new LiveSessionStore(root);
    await recovered.initialize();
    await expect(recovered.resume("test-session")).rejects.toMatchObject({ code: "conflict" });
    await expect(recovered.resume("test-session", receipt)).resolves.toMatchObject({
      finalized: true
    });

    const loopbackRoot = await tempRoot("loopback-owner");
    const loopback = new LiveSessionStore(loopbackRoot);
    await loopback.putSession(session(1));
    await expect(loopback.putSession(session(1), receipt)).rejects.toMatchObject({ code: "conflict" });
    await expect(loopback.putFrame(frame(1, bytes), receipt)).rejects.toMatchObject({ code: "conflict" });
  });

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
      coordinateUnits: "meters",
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

  it("accepts frames before a progressive manifest binding and seals it idempotently", async () => {
    const root = await tempRoot("progressive");
    const store = new LiveSessionStore(root);
    const progressive = sessionV2();
    const sessionId = progressive.session_id;
    expect(await store.putSession(progressive)).toMatchObject({
      status: "accepted",
      expected_frame_count: null
    });
    expect(await store.putSession(progressive)).toMatchObject({
      status: "duplicate",
      expected_frame_count: null
    });
    await expect(store.putSession({
      ...progressive,
      created_at: "2026-07-30T10:00:01.000Z"
    })).rejects.toMatchObject({ code: "conflict" });
    expect(await store.snapshot(sessionId)).toMatchObject({
      sourceManifestId: null,
      expectedCount: null,
      finalSequenceId: null
    });

    const bytes2 = Buffer.from("progressive-two");
    const metadata2 = { ...frame(2, bytes2), session_id: sessionId };
    await store.putFrame(metadata2);
    await store.putAsset(sessionId, 2, "source", chunks(bytes2));
    const finalization = finalizeV2(2);
    await expect(store.finalize(finalization)).rejects.toThrow(/missing frame ranges: 1/);
    for (const fileName of ["source-manifest-binding.json", "capture-splat.world-studio.json", "finalized.json"]) {
      await expect(readFile(path.join(root, sessionId, fileName))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(store.finalize({
      schema: "capture_splat.live_finalize.v0.1",
      session_id: sessionId,
      final_sequence_id: 2
    })).rejects.toMatchObject({ code: "conflict" });

    const bytes1 = Buffer.from("progressive-one");
    const metadata1 = { ...frame(1, bytes1), session_id: sessionId };
    await store.putFrame(metadata1);
    await store.putAsset(sessionId, 1, "source", chunks(bytes1));
    expect(await store.finalize(finalization)).toMatchObject({
      status: "finalized",
      finalized: true,
      expected_frame_count: 2
    });
    expect(await store.snapshot(sessionId)).toMatchObject({
      sourceManifestId: finalization.source_manifest.sha256,
      expectedCount: 2,
      finalSequenceId: 2,
      finalized: true
    });
    expect(JSON.parse(
      await readFile(path.join(root, sessionId, "source-manifest-binding.json"), "utf8")
    )).toEqual(finalization);
    expect(JSON.parse(
      await readFile(path.join(root, sessionId, "capture-splat.world-studio.json"), "utf8")
    )).toMatchObject({
      live_session_schema: LIVE_SESSION_V2_SCHEMA,
      source_manifest: finalization.source_manifest,
      source_manifest_verification: "declared_checksum_reference_only",
      authority: "proposal_only"
    });

    await expect(store.putFrame(metadata1)).rejects.toMatchObject({ code: "sealed" });
    await expect(store.putAsset(sessionId, 1, "source", chunks(bytes1)))
      .rejects.toMatchObject({ code: "sealed" });
    expect(await store.finalize(finalization)).toMatchObject({
      status: "finalized",
      expected_frame_count: 2
    });
    await expect(store.finalize({
      ...finalization,
      source_manifest: {
        ...finalization.source_manifest,
        sha256: `sha256:${"5".repeat(64)}`
      }
    })).rejects.toMatchObject({ code: "conflict" });

    const recovered = new LiveSessionStore(root);
    await recovered.initialize();
    expect(await recovered.snapshot(sessionId)).toMatchObject({
      sourceManifestId: finalization.source_manifest.sha256,
      expectedCount: 2,
      finalized: true
    });
    expect(await recovered.finalize(finalization)).toMatchObject({
      status: "finalized",
      expected_frame_count: 2
    });
  });

  it("recovers open progressive sessions and fails closed on sealed binding corruption", async () => {
    const root = await tempRoot("progressive-restart");
    const sessionId = sessionV2().session_id;
    const first = new LiveSessionStore(root);
    await first.putSession(sessionV2());
    const bytes = Buffer.from("progressive-restart");
    const metadata = { ...frame(1, bytes), session_id: sessionId };
    await first.putFrame(metadata);
    await first.putAsset(sessionId, 1, "source", chunks(bytes));
    await writeFile(
      path.join(root, sessionId, "source-manifest-binding.json"),
      `${JSON.stringify(finalizeV2(1))}\n`
    );
    await writeFile(path.join(root, sessionId, "capture-splat.world-studio.json"), "{}\n");

    const recovered = new LiveSessionStore(root);
    await recovered.initialize();
    expect(await recovered.snapshot(sessionId)).toMatchObject({
      sourceManifestId: null,
      expectedCount: null,
      receivedCount: 1
    });
    for (const fileName of ["source-manifest-binding.json", "capture-splat.world-studio.json"]) {
      await expect(readFile(path.join(root, sessionId, fileName))).rejects.toMatchObject({ code: "ENOENT" });
    }

    const finalization = finalizeV2(1);
    await recovered.finalize(finalization);
    const bindingPath = path.join(root, sessionId, "source-manifest-binding.json");
    await writeFile(bindingPath, `${JSON.stringify({
      ...finalization,
      source_manifest: {
        ...finalization.source_manifest,
        size_bytes: finalization.source_manifest.size_bytes + 1
      }
    })}\n`);
    await expect(recovered.finalize(finalization)).rejects.toThrow(/binding checksum differs/);
    await expect(new LiveSessionStore(root).initialize()).rejects.toThrow(/binding checksum differs/);
    await writeFile(bindingPath, `${JSON.stringify(finalization, null, 2)}\n`);
    await writeFile(path.join(root, sessionId, "capture-splat.world-studio.json"), "{}\n");
    await expect(recovered.finalize(finalization)).rejects.toThrow(/handoff checksum differs/);
    await expect(new LiveSessionStore(root).initialize()).rejects.toThrow(/handoff checksum differs/);
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
    await expect(symlinkStore.readFramePreview("test-session", 1)).rejects.toThrow(/symbolic link/);
    await expect(symlinkStore.finalize(finalize(1))).rejects.toThrow(/symbolic link/);
  });

  it("exposes complete role-aware evidence without sender paths and revalidates every preview", async () => {
    const root = await tempRoot("role-evidence");
    const store = new LiveSessionStore(root);
    await store.putSession(session(1));
    const evidence = {
      source: onePixelPng,
      depth: Buffer.from("depth-npy"),
      confidence: Buffer.from("confidence-npy"),
      "mask-person": onePixelPng,
      "mask-valid": onePixelPng,
      "mask-object": onePixelPng
    } as const;
    const metadata = frame(1, evidence.source);
    metadata.source_frame = evidenceReference(
      "private/source/frame-1.png",
      evidence.source,
      "image/png",
      1,
      1
    );
    metadata.tracking.state = "limited_motion";
    metadata.quality = {
      accepted: true,
      reason: "accepted_keyframe",
      score: 0.91,
      blur_score: 0.12,
      exposure_mean: 0.5,
      exposure_delta: 0.03,
      clipped_highlight_fraction: 0.01,
      near_clipped_highlight_fraction: 0.02,
      clipped_shadow_fraction: 0.04,
      feature_grid_coverage: 0.72,
      parallax_meters: 0.18,
      angular_velocity_deg_s: 4.5,
      translation_speed_m_s: 0.2,
      colmap_overlap_score: 0.83,
      valid_depth_ratio: 0.88,
      feature_point_count: 321
    };
    metadata.assets = {
      depth: evidenceReference("private/depth/frame-1.npy", evidence.depth, "application/x-npy", 10, 5),
      confidence: evidenceReference(
        "private/confidence/frame-1.npy",
        evidence.confidence,
        "application/x-npy",
        10,
        5
      ),
      masks: [
        { ...evidenceReference("private/masks/person.png", evidence["mask-person"], "image/png", 1, 1), kind: "person" },
        { ...evidenceReference("private/masks/valid.png", evidence["mask-valid"], "image/png", 1, 1), kind: "valid" },
        { ...evidenceReference("private/masks/object.png", evidence["mask-object"], "image/png", 1, 1), kind: "object" }
      ]
    };
    await store.putFrame(metadata);
    for (const [role, bytes] of Object.entries(evidence)) {
      await store.putAsset("test-session", 1, role as keyof typeof evidence, chunks(bytes));
    }

    const summary = (await store.snapshot("test-session")).frames[0];
    expect(summary).toMatchObject({
      intrinsics: {
        model: "pinhole",
        flX: 5,
        flY: 6,
        cx: 5,
        cy: 2,
        calibrationWidth: 10,
        calibrationHeight: 5,
        appliesTo: "depth"
      },
      tracking: { state: "limited_motion" },
      quality: {
        accepted: true,
        reason: "accepted_keyframe",
        score: 0.91,
        blurScore: 0.12,
        exposureMean: 0.5,
        exposureDelta: 0.03,
        clippedHighlightFraction: 0.01,
        nearClippedHighlightFraction: 0.02,
        clippedShadowFraction: 0.04,
        featureGridCoverage: 0.72,
        parallaxMeters: 0.18,
        angularVelocityDegS: 4.5,
        translationSpeedMS: 0.2,
        colmapOverlapScore: 0.83,
        validDepthRatio: 0.88,
        featurePointCount: 321
      }
    });
    expect(summary?.assets).toEqual([
      evidenceSummary("source", evidence.source, "image/png", 1, 1),
      evidenceSummary("depth", evidence.depth, "application/x-npy", 10, 5),
      evidenceSummary("confidence", evidence.confidence, "application/x-npy", 10, 5),
      evidenceSummary("mask-person", evidence["mask-person"], "image/png", 1, 1),
      evidenceSummary("mask-valid", evidence["mask-valid"], "image/png", 1, 1),
      evidenceSummary("mask-object", evidence["mask-object"], "image/png", 1, 1)
    ]);
    expect(JSON.stringify(summary)).not.toContain("private/");
    expect(JSON.stringify(summary)).not.toContain("sender/path/");

    for (const [role, bytes] of Object.entries(evidence)) {
      const preview = await store.readFramePreview("test-session", 1, role as keyof typeof evidence);
      expect(preview?.bytes).toEqual(bytes);
      expect(preview).toMatchObject({
        role,
        sha256: hash(bytes),
        sizeBytes: bytes.byteLength
      });
    }
    expect(await store.readFramePreview("test-session", 2, "depth")).toBeNull();

    const depthPath = path.join(root, "test-session", "frames", "00000001", "depth.npy");
    await writeFile(depthPath, Buffer.from("corrupt!!"));
    await expect(store.readFramePreview("test-session", 1, "depth")).rejects.toThrow(/checksum differs/);
  });

  it("verifies image headers, declared dimensions, and decoded preview bounds", async () => {
    for (const [label, bytes, mediaType] of [
      ["png", onePixelPng, "image/png"],
      ["jpeg", onePixelJpeg, "image/jpeg"],
      ["webp", onePixelWebp, "image/webp"]
    ] as const) {
      const valid = await storeWithPreviewImage(`valid-${label}`, bytes, mediaType, 1, 1);
      expect((await valid.readFramePreview("test-session", 1))?.bytes).toEqual(bytes);
    }

    const lying = await storeWithPreviewImage("lying-png", onePixelPng, "image/png", 2, 1);
    await expect(lying.readFramePreview("test-session", 1)).rejects.toThrow(/dimensions differ/);

    for (const mediaType of ["image/png", "image/jpeg", "image/webp"] as const) {
      const malformed = Buffer.from(`not-${mediaType}`);
      const store = await storeWithPreviewImage(`malformed-${mediaType.split("/")[1]}`, malformed, mediaType, 1, 1);
      await expect(store.readFramePreview("test-session", 1)).rejects.toThrow(/malformed/);
    }

    const animatedPng = Buffer.from(onePixelPng);
    animatedPng.write("acTL", animatedPng.indexOf(Buffer.from("IDAT")), "ascii");
    const animatedPngStore = await storeWithPreviewImage("animated-png", animatedPng, "image/png", 1, 1);
    await expect(animatedPngStore.readFramePreview("test-session", 1)).rejects.toThrow(/Animated PNG/);

    const animatedWebp = animatedWebpHeader();
    const animatedWebpStore = await storeWithPreviewImage("animated-webp", animatedWebp, "image/webp", 1, 1);
    await expect(animatedWebpStore.readFramePreview("test-session", 1)).rejects.toThrow(/Animated WebP/);

    const sofOffset = onePixelJpeg.indexOf(Buffer.from([0xff, 0xc0]));
    const truncatedJpeg = onePixelJpeg.subarray(0, sofOffset + 2 + onePixelJpeg.readUInt16BE(sofOffset + 2));
    const truncatedJpegStore = await storeWithPreviewImage("truncated-jpeg", truncatedJpeg, "image/jpeg", 1, 1);
    await expect(truncatedJpegStore.readFramePreview("test-session", 1)).rejects.toThrow(/incomplete/);

    const hiddenLargeJpeg = jpegWithHiddenLargeFrame();
    const hiddenLargeJpegStore = await storeWithPreviewImage("hidden-large-jpeg", hiddenLargeJpeg, "image/jpeg", 1, 1);
    await expect(hiddenLargeJpegStore.readFramePreview("test-session", 1)).rejects.toThrow(/multiple frame dimension headers/);

    const conflictingWebp = webpWithConflictingDimensions();
    const conflictingWebpStore = await storeWithPreviewImage("conflicting-webp", conflictingWebp, "image/webp", 1, 1);
    await expect(conflictingWebpStore.readFramePreview("test-session", 1)).rejects.toThrow(/dimension headers conflict/);

    const malformedWebpTail = Buffer.concat([onePixelWebp, Buffer.from([1, 2, 3, 4, 5])]);
    malformedWebpTail.writeUInt32LE(malformedWebpTail.byteLength - 8, 4);
    const malformedWebpTailStore = await storeWithPreviewImage("malformed-webp-tail", malformedWebpTail, "image/webp", 1, 1);
    await expect(malformedWebpTailStore.readFramePreview("test-session", 1)).rejects.toThrow(/malformed/);

    const oversizedPixels = pngWithDimensions(5_000, 5_000);
    const oversized = await storeWithPreviewImage(
      "oversized-decoded-png",
      oversizedPixels,
      "image/png",
      5_000,
      5_000
    );
    await expect(oversized.readFramePreview("test-session", 1)).rejects.toThrow(/renderer memory bound/);

    const oversizedAxisBytes = pngWithDimensions(20_000, 1);
    const oversizedAxis = await storeWithPreviewImage(
      "oversized-axis-png",
      oversizedAxisBytes,
      "image/png",
      20_000,
      1
    );
    await expect(oversizedAxis.readFramePreview("test-session", 1)).rejects.toThrow(/dimensions exceed/);
  });

  it("rejects unsupported role media and never raises the 16 MiB preview cap", async () => {
    const unsupportedRoot = await tempRoot("unsupported-evidence");
    const unsupportedStore = new LiveSessionStore(unsupportedRoot);
    await unsupportedStore.putSession(session(1));
    const source = Buffer.from("source");
    const mask = Buffer.from("mask-npy");
    const unsupported = frame(1, source);
    unsupported.assets = {
      masks: [{ ...evidenceReference("masks/person.npy", mask, "application/x-npy", 2, 2), kind: "person" }]
    };
    await unsupportedStore.putFrame(unsupported);
    await unsupportedStore.putAsset("test-session", 1, "source", chunks(source));
    await unsupportedStore.putAsset("test-session", 1, "mask-person", chunks(mask));
    expect((await unsupportedStore.snapshot("test-session")).frames[0]?.assets[1]?.previewAvailable).toBe(false);
    expect(await unsupportedStore.readFramePreview("test-session", 1, "depth")).toBeNull();
    await expect(unsupportedStore.readFramePreview("test-session", 1, "mask-person"))
      .rejects.toThrow(/Unsupported preview media type/);

    const cappedRoot = await tempRoot("preview-cap");
    const cappedStore = new LiveSessionStore(cappedRoot);
    await cappedStore.putSession(session(1));
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1, 7);
    await cappedStore.putFrame(frame(1, oversized));
    await cappedStore.putAsset("test-session", 1, "source", chunks(oversized));
    await expect(cappedStore.readFramePreview("test-session", 1, "source", 32 * 1024 * 1024))
      .rejects.toThrow(/preview byte limit/);
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

  it("integrity-binds schema-valid authentication provenance across finalization and restart", async () => {
    const root = await tempRoot("auth-receipt-integrity");
    const receipt = authReceipt();
    const store = new LiveSessionStore(root);
    await store.putSession(session(1), receipt);
    const bytes = Buffer.from("authenticated-frame");
    await store.putFrame(frame(1, bytes), receipt);
    await store.putAsset("test-session", 1, "source", chunks(bytes), hash(bytes), receipt);
    await store.finalize(finalize(1), receipt);

    const receiptPath = path.join(root, "test-session", "auth-receipt.json");
    const changedReceipt: LiveAuthReceipt = {
      ...receipt,
      desktop_id: `wsd_${Buffer.alloc(32, 10).toString("base64url")}`
    };
    await writeFile(receiptPath, `${JSON.stringify(changedReceipt, null, 2)}\n`);
    await expect(store.finalize(finalize(1), receipt)).rejects.toThrow(/receipt changed/);
    await expect(new LiveSessionStore(root).initialize()).rejects.toThrow(/handoff differs/);
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
    await expect(store.readFramePreview("test-session", 1)).rejects.toThrow(/Unsupported preview media type/);
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

function sessionV2(): LiveSessionV2 {
  return {
    schema: LIVE_SESSION_V2_SCHEMA,
    session_id: "csl_SMOhjzjH7dE8x3yB5A0KBAo4YL6A4IzY1U570kVX_D8",
    created_at: "2026-07-30T10:00:00.000Z",
    source_session_seed_b64u: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    expected_frame_count: null,
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

function finalizeV2(finalSequenceId: number) {
  return {
    schema: LIVE_FINALIZE_V2_SCHEMA,
    session_id: sessionV2().session_id,
    final_sequence_id: finalSequenceId,
    source_manifest: {
      path: "capture.json",
      sha256: `sha256:${"4".repeat(64)}`,
      size_bytes: 456,
      schema: "capture_splat.v0.3"
    }
  } as const;
}

function evidenceReference(
  relativePath: string,
  bytes: Buffer,
  mediaType: string,
  width: number,
  height: number
) {
  return {
    path: relativePath,
    sha256: hash(bytes),
    size_bytes: bytes.byteLength,
    media_type: mediaType,
    width,
    height
  };
}

function evidenceSummary(
  role: string,
  bytes: Buffer,
  mediaType: string,
  width: number,
  height: number
) {
  return {
    role,
    sha256: hash(bytes),
    sizeBytes: bytes.byteLength,
    mediaType,
    width,
    height,
    previewAvailable: true
  };
}

async function storeWithPreviewImage(
  name: string,
  bytes: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
  width: number,
  height: number
): Promise<LiveSessionStore> {
  const root = await tempRoot(name);
  const store = new LiveSessionStore(root);
  await store.putSession(session(1));
  const metadata = frame(1, bytes);
  metadata.source_frame = evidenceReference(
    `sender/source.${mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length)}`,
    bytes,
    mediaType,
    width,
    height
  );
  await store.putFrame(metadata);
  await store.putAsset("test-session", 1, "source", chunks(bytes));
  return store;
}

function pngWithDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from(onePixelPng);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function animatedWebpHeader(): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes[20] = 0x02;
  return bytes;
}

function jpegWithHiddenLargeFrame(): Buffer {
  const sofOffset = onePixelJpeg.indexOf(Buffer.from([0xff, 0xc0]));
  const segmentBytes = 2 + onePixelJpeg.readUInt16BE(sofOffset + 2);
  const hiddenFrame = Buffer.from(onePixelJpeg.subarray(sofOffset, sofOffset + segmentBytes));
  hiddenFrame.writeUInt16BE(5_000, 5);
  hiddenFrame.writeUInt16BE(5_000, 7);
  return Buffer.concat([
    onePixelJpeg.subarray(0, sofOffset),
    hiddenFrame,
    onePixelJpeg.subarray(sofOffset)
  ]);
}

function webpWithConflictingDimensions(): Buffer {
  const extended = Buffer.alloc(18);
  extended.write("VP8X", 0, "ascii");
  extended.writeUInt32LE(10, 4);

  const lossless = Buffer.alloc(14);
  lossless.write("VP8L", 0, "ascii");
  lossless.writeUInt32LE(5, 4);
  lossless[8] = 0x2f;
  const largeDimension = 5_000 - 1;
  lossless.writeUInt32LE(largeDimension | (largeDimension << 14), 9);

  const bytes = Buffer.concat([Buffer.alloc(12), extended, lossless]);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  return bytes;
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

function authReceipt(): LiveAuthReceipt {
  return {
    schema: LIVE_AUTH_RECEIPT_SCHEMA,
    session_id: "test-session",
    desktop_id: "wsd_wWnhZxTueI6DlyzNcbPEU_iTcCxdZmDP3x3La5ZDbHE",
    device_id: "csd_cJ0JB4zCGIKQsIFSxLzy0owayS74AO-GOjY-Eo9MGoY",
    grant_id: "csg_ICEiIyQlJicoKSorLC0uLw",
    pairing_epoch: 1,
    permissions: [...LIVE_PAIRING_PERMISSIONS],
    auth_scheme: LIVE_AUTH_SCHEME,
    tls_certificate_sha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    authenticated_at: "2026-07-29T10:32:00.000Z",
    grant_expires_at: "2026-08-28T10:31:01.000Z",
    authority: "proposal_only"
  };
}
