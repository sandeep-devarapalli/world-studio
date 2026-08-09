import { describe, expect, it } from "vitest";
import type { LiveFramePreview, LiveFrameSummary } from "@world-studio/world-core";
import {
  LiveEvidenceDecodeError,
  cacheLiveEvidencePreview,
  createLiveEvidencePreviewCache,
  decodeLiveNpyPreview,
  decodeLivePreviewDataUrl,
  getCachedLiveEvidencePreview,
  livePreviewCacheKey,
  parseLiveNpy,
  rasterizeLiveConfidence,
  rasterizeLiveDepth,
  splitLiveTrajectory,
  type LiveEvidenceAssetRole
} from "./live-session-view";

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
    previewAvailable: true,
    intrinsics: {
      model: "pinhole",
      flX: 1440,
      flY: 1440,
      cx: 960,
      cy: 720,
      calibrationWidth: 1920,
      calibrationHeight: 1440,
      appliesTo: "source_frame"
    },
    tracking: { state: "normal" },
    quality: { accepted: true },
    assets: []
  };
}

function preview(sequenceId: number): LiveFramePreview {
  return {
    sessionId: "live-test",
    sequenceId,
    role: "source",
    mediaType: "image/jpeg",
    sha256: `sha256:${"0".repeat(64)}`,
    sizeBytes: 1,
    dataUrl: "data:image/jpeg;base64,AQ==",
    width: 1920,
    height: 1440
  };
}

function makeNpy(
  descriptor: string,
  shape: [number, number],
  values: number[],
  options: { fortran?: boolean; version?: [number, number] } = {}
): Uint8Array {
  const version = options.version ?? [1, 0];
  const prefixBytes = version[0] === 1 ? 10 : 12;
  const dictionary = `{'descr': '${descriptor}', 'fortran_order': ${options.fortran ? "True" : "False"}, 'shape': (${shape[0]}, ${shape[1]}), }`;
  const padding = (16 - ((prefixBytes + dictionary.length + 1) % 16)) % 16;
  const header = new TextEncoder().encode(`${dictionary}${" ".repeat(padding)}\n`);
  const elementBytes = descriptor.endsWith("f4") ? 4 : 1;
  const output = new Uint8Array(prefixBytes + header.length + values.length * elementBytes);
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, version[0], version[1]]);
  const view = new DataView(output.buffer);
  if (prefixBytes === 10) view.setUint16(8, header.length, true);
  else view.setUint32(8, header.length, true);
  output.set(header, prefixBytes);
  if (elementBytes === 4) {
    values.forEach((value, index) => view.setFloat32(prefixBytes + header.length + index * 4, value, true));
  } else {
    output.set(values, prefixBytes + header.length);
  }
  return output;
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

  it("keeps roles distinct and evicts least-recently-used entries at the byte bound", () => {
    const cache = createLiveEvidencePreviewCache();
    const identity = (sequenceId: number, role: LiveEvidenceAssetRole) => ({
      sessionId: "live-test",
      sequenceId,
      role,
      sha256: `sha256:${String(sequenceId).padStart(64, "0")}`,
      sizeBytes: 1,
      mediaType: "image/jpeg",
      width: 1920,
      height: 1440
    });
    expect(livePreviewCacheKey(identity(1, "source"))).not.toBe(livePreviewCacheKey(identity(1, "depth")));
    expect(cacheLiveEvidencePreview(cache, identity(1, "source"), preview(1), 4, {
      maxEntries: 4,
      maxResidentBytes: 7
    })).toBe(true);
    expect(cacheLiveEvidencePreview(cache, identity(1, "depth"), preview(1), 3, {
      maxEntries: 4,
      maxResidentBytes: 7
    })).toBe(true);
    expect(cache.totalResidentBytes).toBe(7);

    expect(getCachedLiveEvidencePreview(cache, identity(1, "source"))).toEqual(preview(1));
    expect(cacheLiveEvidencePreview(cache, identity(2, "confidence"), preview(2), 2, {
      maxEntries: 4,
      maxResidentBytes: 7
    })).toBe(true);
    expect([...cache.entries.keys()]).toEqual([
      livePreviewCacheKey(identity(1, "source")),
      livePreviewCacheKey(identity(2, "confidence"))
    ]);
    expect(cache.totalResidentBytes).toBe(6);

    expect(cacheLiveEvidencePreview(cache, identity(3, "source"), preview(3), 8, {
      maxEntries: 4,
      maxResidentBytes: 7
    })).toBe(false);
    expect(cache.entries.has(livePreviewCacheKey(identity(3, "source")))).toBe(false);
    expect(cache.totalResidentBytes).toBe(6);
  });

  it("evicts least-recently-used evidence at the entry bound", () => {
    const cache = createLiveEvidencePreviewCache();
    const identity = (sequenceId: number) => ({
      sessionId: "live-test",
      sequenceId,
      role: "source" as const,
      sha256: `sha256:${String(sequenceId).padStart(64, "0")}`,
      sizeBytes: 1,
      mediaType: "image/jpeg",
      width: 1920,
      height: 1440
    });
    for (let sequenceId = 1; sequenceId <= 3; sequenceId += 1) {
      cacheLiveEvidencePreview(cache, identity(sequenceId), preview(sequenceId), 1, {
        maxEntries: 2,
        maxResidentBytes: 100
      });
    }
    expect([...cache.entries.keys()]).toEqual([
      livePreviewCacheKey(identity(2)),
      livePreviewCacheKey(identity(3))
    ]);
    expect(cache.totalResidentBytes).toBe(2);
  });

  it("decodes strict little-endian depth and confidence arrays", () => {
    const depth = parseLiveNpy(makeNpy("<f4", [2, 2], [0, 1, 2, 3]), "depth");
    expect(depth).toMatchObject({ kind: "depth", width: 2, height: 2 });
    expect([...depth.values]).toEqual([0, 1, 2, 3]);
    expect(rasterizeLiveDepth(depth)).toEqual({
      width: 2,
      height: 2,
      rgba: new Uint8ClampedArray([
        0, 0, 0, 0,
        0, 0, 255, 255,
        128, 255, 128, 255,
        255, 0, 0, 255
      ]),
      minimum: 1,
      maximum: 3
    });

    const confidence = parseLiveNpy(makeNpy("|u1", [1, 3], [0, 1, 2]), "confidence");
    expect(confidence).toMatchObject({ kind: "confidence", width: 3, height: 1 });
    expect([...confidence.values]).toEqual([0, 1, 2]);
    expect(rasterizeLiveConfidence(confidence)).toEqual({
      width: 3,
      height: 1,
      rgba: new Uint8ClampedArray([
        239, 68, 68, 255,
        245, 158, 11, 255,
        34, 197, 94, 255
      ]),
      minimum: 0,
      maximum: 2
    });
  });

  it("decodes only canonical preview data URLs matching MIME and declared size", () => {
    expect(decodeLivePreviewDataUrl({
      dataUrl: "data:application/x-npy;base64,k05VTVBZ",
      mediaType: "application/x-npy",
      sizeBytes: 6
    })).toEqual(new Uint8Array([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]));

    expect(() => decodeLivePreviewDataUrl({
      dataUrl: "data:image/png;base64,k05VTVBZ",
      mediaType: "application/x-npy",
      sizeBytes: 6
    })).toThrow("media type does not match");
    expect(() => decodeLivePreviewDataUrl({
      dataUrl: "data:application/x-npy;base64,k05V TVBZ",
      mediaType: "application/x-npy",
      sizeBytes: 6
    })).toThrow("not canonical base64");
    expect(() => decodeLivePreviewDataUrl({
      dataUrl: "data:application/x-npy;base64,k05VTVA=",
      mediaType: "application/x-npy",
      sizeBytes: 6
    })).toThrow("decoded size does not match");
    expect(() => decodeLivePreviewDataUrl({
      dataUrl: "data:application/x-npy;base64,k05VTVBZ",
      mediaType: "application/x-npy",
      sizeBytes: 5
    })).toThrow("decoded size does not match");
    expect(() => decodeLivePreviewDataUrl({
      dataUrl: "data:application/x-npy;base64,k05VTVBZ",
      mediaType: "application/x-npy",
      sizeBytes: 6
    }, 5)).toThrow("declared size exceeds the renderer bound");
  });

  it("binds decoded NPY shape to the received evidence ledger", () => {
    const bytes = makeNpy("<f4", [2, 2], [1, 2, 3, 4]);
    const dataUrl = `data:application/x-npy;base64,${Buffer.from(bytes).toString("base64")}`;
    const evidence: LiveFramePreview = {
      sessionId: "live-test",
      sequenceId: 1,
      role: "depth",
      mediaType: "application/x-npy",
      sha256: `sha256:${"0".repeat(64)}`,
      sizeBytes: bytes.byteLength,
      dataUrl,
      width: 2,
      height: 2
    };
    expect(decodeLiveNpyPreview(evidence, "depth")).toMatchObject({ width: 2, height: 2 });
    expect(() => decodeLiveNpyPreview({ ...evidence, width: 3 }, "depth")).toThrow(
      "depth NPY shape does not match its received evidence ledger"
    );
    expect(() => decodeLiveNpyPreview({ ...evidence, mediaType: "image/png" }, "depth")).toThrow(
      "depth preview is not NPY evidence"
    );
  });

  it.each([
    ["bad magic", () => {
      const bytes = makeNpy("<f4", [1, 1], [1]);
      bytes[0] = 0;
      return bytes;
    }, "NPY magic is invalid"],
    ["unsupported version", () => makeNpy("<f4", [1, 1], [1], { version: [1, 1] }), "NPY version 1.1 is unsupported"],
    ["Fortran ordering", () => makeNpy("<f4", [1, 1], [1], { fortran: true }), "Fortran-ordered NPY arrays are unsupported"],
    ["unsupported dtype", () => makeNpy(">f4", [1, 1], [1]), "NPY descriptor >f4 is unsupported for depth"],
    ["truncated data", () => makeNpy("<f4", [1, 2], [1]), "NPY data length does not exactly match its declared shape"],
    ["trailing data", () => {
      const bytes = makeNpy("<f4", [1, 1], [1]);
      const trailing = new Uint8Array(bytes.length + 1);
      trailing.set(bytes);
      return trailing;
    }, "NPY data length does not exactly match its declared shape"],
    ["non-finite depth", () => makeNpy("<f4", [1, 1], [Number.NaN]), "NPY depth contains a non-finite value"]
  ])("rejects %s", (_label, makeBytes, message) => {
    expect(() => parseLiveNpy(makeBytes(), "depth")).toThrowError(new LiveEvidenceDecodeError(message));
  });

  it("rejects malformed and oversized headers before allocating arrays", () => {
    const malformed = makeNpy("<f4", [1, 1], [1]);
    const headerStart = 10;
    malformed[headerStart] = "[".charCodeAt(0);
    expect(() => parseLiveNpy(malformed, "depth")).toThrow("NPY header is malformed");

    const truncatedHeader = makeNpy("<f4", [1, 1], [1]).slice(0, 12);
    expect(() => parseLiveNpy(truncatedHeader, "depth")).toThrow("NPY header is truncated");

    const excessiveHeader = makeNpy("<f4", [1, 1], [1]);
    new DataView(excessiveHeader.buffer).setUint16(8, 4097, true);
    expect(() => parseLiveNpy(excessiveHeader, "depth")).toThrow("NPY header length is outside");

    const oversized = makeNpy("<f4", [100, 100], []);
    expect(() => parseLiveNpy(oversized, "depth", 9999)).toThrow("NPY element count exceeds");

    const excessiveAxis = makeNpy("<f4", [1, 4097], []);
    expect(() => parseLiveNpy(excessiveAxis, "depth")).toThrow("NPY dimensions exceed the supported render bound");
  });

});
