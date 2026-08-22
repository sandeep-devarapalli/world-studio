import { stableCanonicalJson, type CaptureSplatTrainingDatasetV1 } from "@world-studio/world-core";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

type FileReference = { path: string; sizeBytes: number; checksum: string };

const maxEvidenceTextBytes = 64 * 1024 * 1024;

export async function verifyCaptureSplatMeasuredEvidence(
  root: string,
  manifest: Record<string, unknown>,
  dataset: CaptureSplatTrainingDatasetV1,
): Promise<void> {
  const evidence = dataset.evidence.sfm;
  if (!("registered_image_count" in evidence)) return;
  const packageRoot = await realpath(root);
  const assets = record(manifest.assets);
  const sparse = record(assets.colmap_sparse);
  const camerasRef = fileReference(sparse["cameras.txt"], "cameras.txt");
  const imagesRef = fileReference(sparse["images.txt"], "images.txt");
  const pointsRef = fileReference(sparse["points3D.txt"], "points3D.txt");
  const captureRef = fileReference(assets.capture_manifest, "capture_manifest");
  if (captureRef) requireSelfContainedInventory(manifest.capture_manifest_assets);
  equal(dataset.evidence.capture_manifest.available, Boolean(captureRef), "capture_manifest availability");
  equal(dataset.evidence.capture_manifest.asset, captureRef ? "capture_manifest" : null, "capture_manifest asset");
  const camerasText = await verifiedText(packageRoot, camerasRef);
  const imagesText = await verifiedText(packageRoot, imagesRef);
  const pointsAvailable = pointsRef ? (await verifyFile(packageRoot, pointsRef), true) : false;
  const captureText = await verifiedText(packageRoot, captureRef);

  const cameras = parseCameras(camerasText);
  equal(evidence.available, camerasText !== undefined && imagesText !== undefined, "SfM availability");
  equal(evidence.asset, camerasRef || imagesRef || pointsRef ? "colmap_sparse" : null, "SfM asset");
  equal(evidence.camera_count, cameras.count, "SfM camera_count");
  equal(evidence.camera_models, cameras.models, "SfM camera_models");
  equal(evidence.sparse_points_available, pointsAvailable, "SfM sparse_points_available");

  const registered = parseRegisteredImages(imagesText);
  equal(evidence.registered_images_available, imagesText !== undefined, "registered_images_available");
  equal(evidence.registered_image_count, registered.names.length, "registered_image_count");
  equal(evidence.registered_image_parse_status, registered.status, "registered_image_parse_status");
  equal(evidence.registered_image_invalid_record_count, registered.invalidRecords, "registered_image_invalid_record_count");
  equal(evidence.registered_image_name_digest, imagesText === undefined ? null : nameSetDigest(registered.names), "registered_image_name_digest");

  const overlap = await registeredRgbdOverlap(packageRoot, registered, captureText, Boolean(camerasRef || imagesRef || pointsRef));
  equal(evidence.registered_rgbd_overlap, overlap, "registered_rgbd_overlap");
  equal(evidence.registered_rgbd_overlap_count, overlap.available ? overlap.matched_count : null, "registered_rgbd_overlap_count");
}

function parseCameras(text: string | undefined): { count: number; models: string[] } {
  if (text === undefined) return { count: 0, models: [] };
  let count = 0;
  const models = new Set<string>();
  for (const rawLine of splitLines(text)) {
    const line = pythonStrip(rawLine);
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || !integerToken(parts[0])) continue;
    count += 1;
    if (parts[1]!.length <= 64 && /^[A-Za-z0-9_]+$/.test(parts[1]!)) models.add(parts[1]!);
  }
  return { count, models: sortUtf8([...models]) };
}

function parseRegisteredImages(text: string | undefined): {
  names: string[];
  invalidRecords: number;
  status: "complete" | "partial" | "unavailable";
} {
  if (text === undefined) return { names: [], invalidRecords: 0, status: "unavailable" };
  const names: string[] = [];
  let invalidRecords = 0;
  let expectPose = true;
  for (const rawLine of splitLines(text)) {
    const stripped = pythonStrip(rawLine);
    if (stripped.startsWith("#")) continue;
    if (!expectPose) {
      expectPose = true;
      if (!stripped) continue;
      const points = stripped.split(/\s+/);
      if (points.length % 3 !== 0 || points.some((value, index) => index % 3 === 2 ? !integerToken(value) : !finiteToken(value))) {
        invalidRecords += 1;
      }
      continue;
    }
    if (!stripped) continue;
    const parts = splitMax(stripped, 9);
    const pose = parts.slice(1, 8);
    if (
      parts.length < 10
      || !integerToken(parts[0])
      || pose.length !== 7
      || !pose.every(finiteToken)
      || pose.slice(0, 4).reduce((sum, value) => sum + finiteNumber(value)! ** 2, 0) === 0
      || !integerToken(parts[8])
    ) {
      invalidRecords += 1;
      continue;
    }
    names.push(parts[9]!);
    expectPose = false;
  }
  if (!expectPose) invalidRecords += 1;
  return { names, invalidRecords, status: invalidRecords === 0 ? "complete" : "partial" };
}

async function registeredRgbdOverlap(
  root: string,
  registered: ReturnType<typeof parseRegisteredImages>,
  captureText: string | undefined,
  sparseDeclared: boolean,
): Promise<Record<string, unknown>> {
  const matching = "unique_case_sensitive_rgb_basename_with_same_root_rgb_and_depth_v1";
  const unavailable = (reason: string) => ({
    available: false,
    reason,
    matching,
    depth_bearing_capture_frame_count: 0,
    matched_count: 0,
    ambiguous_basename_count: 0,
    unmatched_registered_image_count: registered.names.length,
  });
  if (registered.status !== "complete") {
    return unavailable(registered.status === "unavailable" && !sparseDeclared ? "colmap_images_unavailable" : "colmap_images_parse_incomplete");
  }
  if (captureText === undefined) return unavailable("capture_manifest_unavailable");
  let capture: unknown;
  try {
    capture = JSON.parse(captureText);
  } catch {
    throw new Error("Capture Splat capture_manifest is malformed.");
  }
  if (!isRecord(capture)) return unavailable("capture_manifest_unavailable");
  const frames = Object.hasOwn(capture, "frames") ? capture.frames : [];
  if (!Array.isArray(frames) || frames.some((frame) => !isRecord(frame))) {
    return unavailable("capture_frames_invalid");
  }

  const captureNames: string[] = [];
  for (const value of frames) {
    const frame = value as Record<string, unknown>;
    const quality = record(pythonTruthy(frame.capture_quality) ? frame.capture_quality : frame.quality);
    const rejected = frame.accepted === false || quality.accepted === false;
    const rgb = [frame.rgb, frame.image, frame.image_path, frame.file_path].find((entry) => typeof entry === "string" && entry.length > 0);
    if (rejected || typeof rgb !== "string" || typeof frame.depth !== "string") continue;
    const canonicalRgb = canonicalCapturePath(rgb);
    const canonicalDepth = canonicalCapturePath(frame.depth);
    if (canonicalRgb && canonicalDepth && await confinedFileExists(root, canonicalRgb) && await confinedFileExists(root, canonicalDepth)) {
      captureNames.push(baseName(rgb));
    }
  }
  const registeredNames = registered.names.map(baseName);
  const registeredCounts = counts(registeredNames);
  const captureCounts = counts(captureNames);
  const shared = [...registeredCounts.keys()].filter((name) => captureCounts.has(name));
  const matched = sortUtf8(shared.filter((name) => registeredCounts.get(name) === 1 && captureCounts.get(name) === 1));
  const ambiguous = shared.filter((name) => registeredCounts.get(name) !== 1 || captureCounts.get(name) !== 1);
  return {
    available: true,
    matching,
    depth_bearing_capture_frame_count: captureNames.length,
    matched_count: matched.length,
    matched_name_digest: nameSetDigest(matched),
    ambiguous_basename_count: ambiguous.length,
    unmatched_registered_image_count: registered.names.length - matched.length,
  };
}

function counts(values: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return out;
}

function nameSetDigest(names: string[]): string {
  const digest = createHash("sha256");
  for (const name of sortUtf8(names)) digest.update(`${name}\n`, "utf8");
  return `sha256:${digest.digest("hex")}`;
}

function sortUtf8(values: string[]): string[] {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
}

async function verifiedText(root: string, reference: FileReference | undefined): Promise<string | undefined> {
  if (!reference) return undefined;
  if (reference.sizeBytes > maxEvidenceTextBytes) throw new Error("Capture Splat measured evidence text exceeds the 64 MiB limit.");
  const chunks = await verifyFile(root, reference, true);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
}

async function verifyFile(root: string, reference: FileReference, retainBytes = false): Promise<Buffer[]> {
  const absolutePath = resolveInside(root, reference.path);
  try {
    const resolved = await realpath(absolutePath);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Capture Splat measured evidence escaped the package.");
    const before = await lstat(absolutePath);
    if (before.isSymbolicLink() || !before.isFile()) throw new Error("Capture Splat measured evidence is not a regular self-contained file.");
    if (before.size !== reference.sizeBytes) throw new Error("Capture Splat measured evidence size differs from its declaration.");
    const digest = createHash("sha256");
    const chunks: Buffer[] = [];
    for await (const value of createReadStream(absolutePath, { highWaterMark: 1024 * 1024 })) {
      const chunk = value as Buffer;
      digest.update(chunk);
      if (retainBytes) chunks.push(chunk);
    }
    const after = await lstat(absolutePath);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("Capture Splat measured evidence changed while it was verified.");
    }
    if (`sha256:${digest.digest("hex")}` !== reference.checksum) {
      throw new Error("Capture Splat measured evidence checksum differs from its declaration.");
    }
    return chunks;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Capture Splat measured evidence file is missing.");
    throw error;
  }
}

async function confinedFileExists(root: string, relativePath: string): Promise<boolean> {
  try {
    const absolutePath = resolveInside(root, relativePath);
    const resolved = await realpath(absolutePath);
    if (!resolved.startsWith(`${root}${path.sep}`)) return false;
    return (await lstat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

function canonicalCapturePath(candidate: string): string | undefined {
  if (!candidate || candidate.includes("\\") || candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) return undefined;
  const parts = candidate.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.includes("..")) return undefined;
  const reserved = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i;
  for (const part of parts) {
    const stem = part.replace(/[ .]+$/g, "").split(".", 1)[0]!.replace(/[ .]+$/g, "");
    if (
      /[ .]$/.test(part)
      || reserved.test(stem)
      || [...part].some((character) => character.codePointAt(0)! < 32 || /[<>:"|?*]/.test(character))
    ) return undefined;
  }
  return parts.join("/");
}

function fileReference(value: unknown, label: string): FileReference | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value) || typeof value.path !== "string" || !validRelativePath(value.path)) {
    throw new Error(`Capture Splat ${label} must be a checksum-bound relative file reference.`);
  }
  if (!Number.isSafeInteger(value.size_bytes) || (value.size_bytes as number) < 0) {
    throw new Error(`Capture Splat ${label} has an invalid declared size.`);
  }
  if (typeof value.checksum !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.checksum)) {
    throw new Error(`Capture Splat ${label} has an invalid declared checksum.`);
  }
  return { path: value.path, sizeBytes: value.size_bytes as number, checksum: value.checksum };
}

function requireSelfContainedInventory(value: unknown): void {
  if (
    !isRecord(value)
    || value.schema !== "capture_splat.capture_manifest_assets.v0.1"
    || value.verification !== "source_destination_size_and_sha256"
    || value.complete !== true
    || value.decision !== "ready"
  ) {
    throw new Error("Capture Splat measured evidence requires a self-contained verified v0.3 package.");
  }
}

function validRelativePath(candidate: string): boolean {
  return Boolean(candidate)
    && candidate === candidate.trim()
    && !candidate.includes("\\")
    && !candidate.startsWith("/")
    && !candidate.split("/").some((part) => !part || part === "." || part === "..");
}

function resolveInside(root: string, relativePath: string): string {
  const base = path.resolve(root);
  const resolved = path.resolve(base, relativePath);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error(`Capture Splat evidence escaped the package: ${relativePath}`);
  return resolved;
}

function baseName(value: string): string {
  return value.replace(/\\/g, "/").split("/").at(-1) ?? value;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "" && /(?:\r\n|\n|\r)$/.test(text)) lines.pop();
  return lines;
}

function pythonStrip(value: string): string {
  return value.replace(/^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu, "");
}

function splitMax(value: string, maxSplits: number): string[] {
  const parts: string[] = [];
  let rest = value;
  for (let index = 0; index < maxSplits && rest; index += 1) {
    const match = /^(\S+)(?:\s+|$)/.exec(rest);
    if (!match) break;
    parts.push(match[1]!);
    rest = rest.slice(match[0].length);
  }
  if (rest) parts.push(rest);
  return parts;
}

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function integerToken(value: string | undefined): boolean {
  return typeof value === "string" && /^[+-]?\d(?:_?\d)*$/.test(value);
}

function finiteToken(value: string): boolean {
  return finiteNumber(value) !== undefined;
}

function finiteNumber(value: string): number | undefined {
  if (!/^[+-]?(?:(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value.replaceAll("_", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (stableCanonicalJson(actual) !== stableCanonicalJson(expected)) throw new Error(`Capture Splat ${label} differs from packaged evidence.`);
}
