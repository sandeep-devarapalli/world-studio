import type {
  LiveEvidenceAssetRole,
  LiveFramePreview,
  LiveFrameSummary
} from "@world-studio/world-core";

export type { LiveEvidenceAssetRole } from "@world-studio/world-core";

export const LIVE_PREVIEW_CACHE_LIMIT = 12;
export const LIVE_PREVIEW_CACHE_BYTE_LIMIT = 24 * 1024 * 1024;
export const LIVE_NPY_MAX_ELEMENTS = 1024 * 1024;
export const LIVE_NPY_MAX_DIMENSION = 4096;
export const LIVE_NPY_MAX_HEADER_BYTES = 4096;
export const LIVE_PREVIEW_DECODE_BYTE_LIMIT = 16 * 1024 * 1024;

export interface LiveEvidenceCacheIdentity {
  sessionId: string;
  sequenceId: number;
  role: LiveEvidenceAssetRole;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  width: number | null;
  height: number | null;
}

export interface LiveEvidencePreviewCache {
  entries: Map<string, LiveFramePreview>;
  residentBytes: Map<string, number>;
  totalResidentBytes: number;
}

export interface LiveEvidencePreviewCacheLimits {
  maxEntries: number;
  maxResidentBytes: number;
}

export interface LiveTrajectoryPoint {
  sequenceId: number;
  x: number;
  z: number;
}

export type LiveNpyKind = "depth" | "confidence";

export interface LiveDepthNpy {
  kind: "depth";
  width: number;
  height: number;
  values: Float32Array;
}

export interface LiveConfidenceNpy {
  kind: "confidence";
  width: number;
  height: number;
  values: Uint8Array;
}

export type LiveNpy = LiveDepthNpy | LiveConfidenceNpy;

export interface LiveEvidenceRaster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  minimum: number;
  maximum: number;
}

export type EncodedLiveFramePreview = Pick<LiveFramePreview, "dataUrl" | "mediaType" | "sizeBytes">;

export class LiveEvidenceDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveEvidenceDecodeError";
  }
}

export function createLiveEvidencePreviewCache(): LiveEvidencePreviewCache {
  return {
    entries: new Map(),
    residentBytes: new Map(),
    totalResidentBytes: 0
  };
}

export function livePreviewCacheKey(identity: LiveEvidenceCacheIdentity): string {
  return JSON.stringify([
    identity.sessionId,
    identity.sequenceId,
    identity.role,
    identity.sha256,
    identity.sizeBytes,
    identity.mediaType,
    identity.width,
    identity.height
  ]);
}

export function getCachedLiveEvidencePreview(
  cache: LiveEvidencePreviewCache,
  identity: LiveEvidenceCacheIdentity
): LiveFramePreview | null {
  const key = livePreviewCacheKey(identity);
  const preview = cache.entries.get(key);
  if (!preview) return null;
  const residentBytes = cache.residentBytes.get(key);
  cache.entries.delete(key);
  cache.entries.set(key, preview);
  if (residentBytes !== undefined) {
    cache.residentBytes.delete(key);
    cache.residentBytes.set(key, residentBytes);
  }
  return preview;
}

export function cacheLiveEvidencePreview(
  cache: LiveEvidencePreviewCache,
  identity: LiveEvidenceCacheIdentity,
  preview: LiveFramePreview,
  residentByteSize: number,
  limits: Partial<LiveEvidencePreviewCacheLimits> = {}
): boolean {
  const maxEntries = limits.maxEntries ?? LIVE_PREVIEW_CACHE_LIMIT;
  const maxResidentBytes = limits.maxResidentBytes ?? LIVE_PREVIEW_CACHE_BYTE_LIMIT;
  requirePositiveInteger(maxEntries, "preview cache maxEntries");
  requirePositiveInteger(maxResidentBytes, "preview cache maxResidentBytes");
  if (!Number.isSafeInteger(residentByteSize) || residentByteSize < 0) {
    throw new LiveEvidenceDecodeError("preview resident byte size must be a non-negative safe integer");
  }

  const key = livePreviewCacheKey(identity);
  removeCachedLiveEvidencePreview(cache, key);
  if (residentByteSize > maxResidentBytes) return false;

  cache.entries.set(key, preview);
  cache.residentBytes.set(key, residentByteSize);
  cache.totalResidentBytes += residentByteSize;
  while (cache.entries.size > maxEntries || cache.totalResidentBytes > maxResidentBytes) {
    const oldest = cache.entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    removeCachedLiveEvidencePreview(cache, oldest);
  }
  return cache.entries.has(key);
}

function removeCachedLiveEvidencePreview(cache: LiveEvidencePreviewCache, key: string): void {
  const residentBytes = cache.residentBytes.get(key) ?? 0;
  cache.entries.delete(key);
  cache.residentBytes.delete(key);
  cache.totalResidentBytes -= residentBytes;
  if (cache.totalResidentBytes < 0) cache.totalResidentBytes = 0;
}

export function decodeLivePreviewDataUrl(
  preview: EncodedLiveFramePreview,
  maxBytes = LIVE_PREVIEW_DECODE_BYTE_LIMIT
): Uint8Array {
  requirePositiveInteger(maxBytes, "preview decode maxBytes");
  if (!Number.isSafeInteger(preview.sizeBytes) || preview.sizeBytes < 0) {
    throw new LiveEvidenceDecodeError("preview declared size must be a non-negative safe integer");
  }
  if (preview.sizeBytes > maxBytes) {
    throw new LiveEvidenceDecodeError("preview declared size exceeds the renderer bound");
  }
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(preview.mediaType)) {
    throw new LiveEvidenceDecodeError("preview media type is invalid");
  }
  const prefix = `data:${preview.mediaType};base64,`;
  if (!preview.dataUrl.startsWith(prefix)) {
    throw new LiveEvidenceDecodeError("preview data URL media type does not match its declaration");
  }
  const encoded = preview.dataUrl.slice(prefix.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new LiveEvidenceDecodeError("preview data URL is not canonical base64");
  }
  const paddingBytes = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedLength = encoded.length === 0 ? 0 : (encoded.length / 4) * 3 - paddingBytes;
  if (decodedLength !== preview.sizeBytes) {
    throw new LiveEvidenceDecodeError("preview decoded size does not match its declaration");
  }
  if (decodedLength > maxBytes) {
    throw new LiveEvidenceDecodeError("preview decoded size exceeds the renderer bound");
  }
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new LiveEvidenceDecodeError("preview data URL base64 could not be decoded");
  }
  if (binary.length !== decodedLength) {
    throw new LiveEvidenceDecodeError("preview decoded size does not match its declaration");
  }
  const decoded = new Uint8Array(decodedLength);
  for (let index = 0; index < binary.length; index += 1) decoded[index] = binary.charCodeAt(index);
  return decoded;
}

export function parseLiveNpy(
  input: Uint8Array,
  kind: "depth",
  maxElements?: number
): LiveDepthNpy;
export function parseLiveNpy(
  input: Uint8Array,
  kind: "confidence",
  maxElements?: number
): LiveConfidenceNpy;
export function parseLiveNpy(
  input: Uint8Array,
  kind: LiveNpyKind,
  maxElements = LIVE_NPY_MAX_ELEMENTS
): LiveNpy {
  requirePositiveInteger(maxElements, "NPY maxElements");
  if (!(input instanceof Uint8Array)) {
    throw new LiveEvidenceDecodeError("NPY input must be a Uint8Array");
  }
  if (input.byteLength < 10) throw new LiveEvidenceDecodeError("NPY payload is truncated");
  const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  if (!magic.every((byte, index) => input[index] === byte)) {
    throw new LiveEvidenceDecodeError("NPY magic is invalid");
  }

  const major = input[6];
  const minor = input[7];
  let prefixBytes: number;
  let headerBytes: number;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (major === 1 && minor === 0) {
    prefixBytes = 10;
    headerBytes = view.getUint16(8, true);
  } else if ((major === 2 || major === 3) && minor === 0) {
    if (input.byteLength < 12) throw new LiveEvidenceDecodeError("NPY payload is truncated");
    prefixBytes = 12;
    headerBytes = view.getUint32(8, true);
  } else {
    throw new LiveEvidenceDecodeError(`NPY version ${major}.${minor} is unsupported`);
  }
  if (headerBytes < 1 || headerBytes > LIVE_NPY_MAX_HEADER_BYTES) {
    throw new LiveEvidenceDecodeError("NPY header length is outside the supported bound");
  }
  const dataOffset = prefixBytes + headerBytes;
  if (dataOffset > input.byteLength) throw new LiveEvidenceDecodeError("NPY header is truncated");
  if (dataOffset % 16 !== 0) throw new LiveEvidenceDecodeError("NPY header alignment is invalid");

  const headerSlice = input.subarray(prefixBytes, dataOffset);
  for (const byte of headerSlice) {
    if (byte > 0x7f) throw new LiveEvidenceDecodeError("NPY header must be ASCII");
  }
  const header = new TextDecoder("ascii", { fatal: true }).decode(headerSlice);
  const match = /^\{\s*'descr'\s*:\s*'([^']+)'\s*,\s*'fortran_order'\s*:\s*(True|False)\s*,\s*'shape'\s*:\s*\(\s*(\d+)\s*,\s*(\d+)\s*,?\s*\)\s*,?\s*\}\s*\n$/.exec(header);
  if (!match) throw new LiveEvidenceDecodeError("NPY header is malformed or contains unsupported fields");
  if (match[2] !== "False") throw new LiveEvidenceDecodeError("Fortran-ordered NPY arrays are unsupported");
  const height = Number(match[3]);
  const width = Number(match[4]);
  requirePositiveInteger(height, "NPY height");
  requirePositiveInteger(width, "NPY width");
  if (height > LIVE_NPY_MAX_DIMENSION || width > LIVE_NPY_MAX_DIMENSION) {
    throw new LiveEvidenceDecodeError("NPY dimensions exceed the supported render bound");
  }
  const elementCount = height * width;
  if (!Number.isSafeInteger(elementCount) || elementCount > maxElements) {
    throw new LiveEvidenceDecodeError("NPY element count exceeds the supported bound");
  }

  const expectedDescriptor = kind === "depth" ? "<f4" : "|u1";
  if (match[1] !== expectedDescriptor) {
    throw new LiveEvidenceDecodeError(`NPY descriptor ${match[1]} is unsupported for ${kind}`);
  }
  const elementBytes = kind === "depth" ? 4 : 1;
  const expectedPayloadBytes = elementCount * elementBytes;
  if (input.byteLength - dataOffset !== expectedPayloadBytes) {
    throw new LiveEvidenceDecodeError("NPY data length does not exactly match its declared shape");
  }

  if (kind === "confidence") {
    return {
      kind,
      width,
      height,
      values: input.slice(dataOffset)
    };
  }

  const values = new Float32Array(elementCount);
  for (let index = 0; index < elementCount; index += 1) {
    const value = view.getFloat32(dataOffset + index * 4, true);
    if (!Number.isFinite(value)) throw new LiveEvidenceDecodeError("NPY depth contains a non-finite value");
    values[index] = value;
  }
  return { kind, width, height, values };
}

export function decodeLiveNpyPreview(preview: LiveFramePreview, kind: "depth"): LiveDepthNpy;
export function decodeLiveNpyPreview(preview: LiveFramePreview, kind: "confidence"): LiveConfidenceNpy;
export function decodeLiveNpyPreview(preview: LiveFramePreview, kind: LiveNpyKind): LiveNpy {
  if (preview.mediaType !== "application/x-npy") {
    throw new LiveEvidenceDecodeError(`${kind} preview is not NPY evidence`);
  }
  const parsed = kind === "depth"
    ? parseLiveNpy(decodeLivePreviewDataUrl(preview), "depth")
    : parseLiveNpy(decodeLivePreviewDataUrl(preview), "confidence");
  if (
    (preview.width !== null && preview.width !== parsed.width)
    || (preview.height !== null && preview.height !== parsed.height)
  ) {
    throw new LiveEvidenceDecodeError(`${kind} NPY shape does not match its received evidence ledger`);
  }
  return parsed;
}

export function rasterizeLiveDepth(depth: LiveDepthNpy): LiveEvidenceRaster {
  const rgba = new Uint8ClampedArray(depth.values.length * 4);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of depth.values) {
    if (value > 0) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  if (!Number.isFinite(minimum)) {
    minimum = 0;
    maximum = 0;
  }
  const range = maximum - minimum;
  for (let index = 0; index < depth.values.length; index += 1) {
    const value = depth.values[index];
    if (value <= 0) continue;
    const normalized = range > 0 ? (value - minimum) / range : 0.5;
    const offset = index * 4;
    rgba[offset] = Math.round(normalized * 255);
    rgba[offset + 1] = Math.round((1 - Math.abs(normalized * 2 - 1)) * 255);
    rgba[offset + 2] = Math.round((1 - normalized) * 255);
    rgba[offset + 3] = 255;
  }
  return { width: depth.width, height: depth.height, rgba, minimum, maximum };
}

export function rasterizeLiveConfidence(confidence: LiveConfidenceNpy): LiveEvidenceRaster {
  const rgba = new Uint8ClampedArray(confidence.values.length * 4);
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < confidence.values.length; index += 1) {
    const value = confidence.values[index];
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    const offset = index * 4;
    const color = value === 0 ? [239, 68, 68] : value === 1 ? [245, 158, 11] : [34, 197, 94];
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = 255;
  }
  if (confidence.values.length === 0) minimum = 0;
  return { width: confidence.width, height: confidence.height, rgba, minimum, maximum };
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

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new LiveEvidenceDecodeError(`${name} must be a positive safe integer`);
  }
}
