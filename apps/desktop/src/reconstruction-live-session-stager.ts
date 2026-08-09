import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  declaredLiveAssets,
  LIVE_FINALIZE_V2_SCHEMA,
  LIVE_SESSION_V2_SCHEMA,
  parseLiveJson,
  stableLiveJson,
  validateLiveFinalize,
  validateLiveFrame,
  validateLiveSessionDeclaration,
  type LiveFrame,
  type LiveSessionDeclaration
} from "./live-session-contract.js";
import { validateLiveAuthReceipt } from "./live-auth-contract.js";
import {
  receiverOwnedLiveAssetFileName,
  type LiveReconstructionInputSnapshot,
  type LiveSessionStore
} from "./live-session-store.js";
import {
  safeReconstructionRelativePath,
  stableReconstructionJson,
  type ReconstructionArtifactReference
} from "./reconstruction-worker-contract.js";
import type { ReconstructionWorkerInputStager } from "./reconstruction-worker-supervisor.js";

const inputManifestSchema = "world_studio.reconstruction_input_manifest.v0.1";
const jsonMediaType = "application/json";
const maxMetadataBytes = 128 * 1024 * 1024;
const copyBufferBytes = 64 * 1024;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface CopiedArtifact {
  reference: ReconstructionArtifactReference;
  sizeBytes: number;
}

interface FinalizedMarker {
  schema: "capture_splat.live_finalized.v0.1" | "capture_splat.live_finalized.v0.2";
  session_id: string;
  final_sequence_id: number;
  handoff_path: "capture-splat.world-studio.json";
  handoff_sha256: string;
  finalized_at: string;
  source_manifest_binding_path?: "source-manifest-binding.json";
  source_manifest_binding_sha256?: string;
}

export class ReconstructionLiveSessionInputStager implements ReconstructionWorkerInputStager {
  constructor(private readonly store: LiveSessionStore) {}

  async stage(input: {
    sessionId: string;
    destinationRoot: string;
    maxBytes: number;
    maxArtifacts: number;
  }): Promise<{
    source: {
      session_id: string;
      live_session_schema: "capture_splat.live_session.v0.1" | "capture_splat.live_session.v0.2";
      final_sequence_id: number | null;
    };
    inputs: ReconstructionArtifactReference[];
    summary: {
      sessionId: string;
      throughSequenceId: number;
      frameCount: number;
      manifestSha256: string;
    };
  }> {
    assertStageInput(input);
    const frozen = await this.store.reconstructionInputSnapshot(input.sessionId);
    if (!frozen.frames.length) throw new Error("Reconstruction requires at least one committed live frame.");
    if ((frozen.finalSequenceId === null) !== (frozen.finalizedEvidence === null)) {
      throw new Error("Live-session finalization evidence is internally inconsistent.");
    }

    const destinationRoot = path.resolve(input.destinationRoot);
    const inputsRoot = path.join(destinationRoot, "inputs");
    await assertRealDirectory(destinationRoot, "Reconstruction publication root");
    await assertEmptyRealDirectory(inputsRoot, "Reconstruction inputs directory");
    const sourceRoot = this.store.sessionDirectory(input.sessionId);
    await assertRealDirectory(sourceRoot, "Live session directory");
    const sourceFramesRoot = path.join(sourceRoot, "frames");
    await assertRealDirectory(sourceFramesRoot, "Live frames directory");

    const artifacts: ReconstructionArtifactReference[] = [];
    let totalBytes = 0;
    const stageCopy = async (copy: {
      sourcePath: string;
      relativePath: string;
      role: string;
      mediaType: string;
      expectedSize?: number;
      expectedSha256?: string;
      metadata?: boolean;
    }): Promise<CopiedArtifact> => {
      assertCapacity(artifacts.length + 1, totalBytes, input.maxArtifacts - 1, input.maxBytes);
      const copied = await copyPinnedRegularFile({
        ...copy,
        destinationRoot,
        maxBytes: input.maxBytes - totalBytes,
        maxFileBytes: copy.metadata ? Math.min(input.maxBytes, maxMetadataBytes) : input.maxBytes
      });
      totalBytes = safeAdd(totalBytes, copied.sizeBytes, "Staged input bytes");
      artifacts.push(copied.reference);
      return copied;
    };

    const sessionCopy = await stageCopy({
      sourcePath: path.join(sourceRoot, "session.json"),
      relativePath: "inputs/session.json",
      role: "live_session_metadata",
      mediaType: jsonMediaType,
      metadata: true
    });
    const stagedSession = validateLiveSessionDeclaration(
      await readPinnedJson(path.join(destinationRoot, sessionCopy.reference.path), maxMetadataBytes)
    );
    if (stableLiveJson(stagedSession) !== stableLiveJson(frozen.session)) {
      throw new Error("Live session metadata changed after the reconstruction snapshot.");
    }

    const receiptPath = path.join(sourceRoot, "auth-receipt.json");
    const receiptExists = await entryExists(receiptPath);
    if (frozen.authReceipt === null && receiptExists) {
      throw new Error("A live authentication receipt appeared after the reconstruction snapshot.");
    }
    if (frozen.authReceipt !== null) {
      if (!receiptExists || !frozen.authReceiptSha256) {
        throw new Error("The live authentication receipt is missing from the reconstruction snapshot.");
      }
      const receiptCopy = await stageCopy({
        sourcePath: receiptPath,
        relativePath: "inputs/auth-receipt.json",
        role: "live_auth_receipt",
        mediaType: jsonMediaType,
        expectedSha256: frozen.authReceiptSha256,
        metadata: true
      });
      const receipt = validateLiveAuthReceipt(
        await readPinnedJson(path.join(destinationRoot, receiptCopy.reference.path), maxMetadataBytes)
      );
      if (
        stableLiveJson(receipt) !== stableLiveJson(frozen.authReceipt)
        || receipt.session_id !== input.sessionId
        || receipt.authority !== "proposal_only"
      ) {
        throw new Error("Live authentication receipt differs from the staged session.");
      }
    }

    for (const frame of frozen.frames) {
      const directoryName = frame.sequence_id.toString().padStart(8, "0");
      const sourceFrameRoot = path.join(sourceFramesRoot, directoryName);
      await assertRealDirectory(sourceFrameRoot, `Committed frame ${frame.sequence_id}`);
      const relativeFrameRoot = `inputs/frames/${directoryName}`;
      const metadataCopy = await stageCopy({
        sourcePath: path.join(sourceFrameRoot, "metadata.json"),
        relativePath: `${relativeFrameRoot}/metadata.json`,
        role: "live_frame_metadata",
        mediaType: jsonMediaType,
        metadata: true
      });
      const stagedFrame = validateLiveFrame(
        await readPinnedJson(path.join(destinationRoot, metadataCopy.reference.path), maxMetadataBytes)
      );
      if (stableLiveJson(stagedFrame) !== stableLiveJson(frame)) {
        throw new Error(`Committed frame ${frame.sequence_id} metadata changed after the reconstruction snapshot.`);
      }
      for (const asset of declaredLiveAssets(frame)) {
        const fileName = receiverOwnedLiveAssetFileName(asset.role, asset.reference.media_type);
        await stageCopy({
          sourcePath: path.join(sourceFrameRoot, fileName),
          relativePath: `${relativeFrameRoot}/${fileName}`,
          role: asset.role,
          mediaType: asset.reference.media_type,
          expectedSize: asset.reference.size_bytes,
          expectedSha256: asset.reference.sha256
        });
      }
    }

    if (frozen.finalSequenceId !== null) {
      await this.stageFinalizedMetadata({
        frozen,
        sourceRoot,
        destinationRoot,
        stageCopy
      });
    }

    artifacts.sort((left, right) => left.path.localeCompare(right.path));
    const throughSequenceId = frozen.frames.at(-1)!.sequence_id;
    const missingRanges = missingRangesFor(frozen.frames, throughSequenceId);
    const evidenceDigest = digest(stableReconstructionJson(artifacts));
    const manifest = {
      schema: inputManifestSchema,
      session_id: input.sessionId,
      live_session_schema: frozen.session.schema,
      source_updated_at: frozen.updatedAt,
      captured_through_sequence_id: throughSequenceId,
      committed_frame_count: frozen.frames.length,
      committed_sequence_ids: frozen.frames.map((frame) => frame.sequence_id),
      missing_ranges: missingRanges,
      finalized: frozen.finalSequenceId !== null,
      final_sequence_id: frozen.finalSequenceId,
      evidence_artifacts: artifacts,
      evidence_artifacts_sha256: evidenceDigest,
      authority: "proposal_only",
      loaded_world_effect: "none"
    } as const;
    const manifestBytes = Buffer.from(`${stableReconstructionJson(manifest)}\n`, "utf8");
    assertCapacity(artifacts.length + 1, safeAdd(totalBytes, manifestBytes.byteLength, "Staged input bytes"), input.maxArtifacts, input.maxBytes);
    const manifestArtifact = await writeGeneratedArtifact(
      destinationRoot,
      "inputs/manifest.json",
      "live_input_manifest",
      jsonMediaType,
      manifestBytes
    );
    totalBytes = safeAdd(totalBytes, manifestArtifact.sizeBytes, "Staged input bytes");
    artifacts.push(manifestArtifact.reference);
    artifacts.sort((left, right) => left.path.localeCompare(right.path));
    assertCapacity(artifacts.length, totalBytes, input.maxArtifacts, input.maxBytes);
    await verifyPublishedInputTree(
      inputsRoot,
      new Set(artifacts.map((artifact) => artifact.path.slice("inputs/".length)))
    );

    if (
      frozen.finalSequenceId !== null
      && (throughSequenceId !== frozen.finalSequenceId || frozen.frames.length !== frozen.finalSequenceId)
    ) {
      throw new Error("Finalized live-session snapshot is not contiguous through its final sequence.");
    }

    return {
      source: {
        session_id: input.sessionId,
        live_session_schema: frozen.session.schema,
        final_sequence_id: frozen.finalSequenceId
      },
      inputs: artifacts,
      summary: {
        sessionId: input.sessionId,
        throughSequenceId,
        frameCount: frozen.frames.length,
        manifestSha256: digest(stableReconstructionJson(artifacts))
      }
    };
  }

  private async stageFinalizedMetadata(input: {
    frozen: LiveReconstructionInputSnapshot;
    sourceRoot: string;
    destinationRoot: string;
    stageCopy: (copy: {
      sourcePath: string;
      relativePath: string;
      role: string;
      mediaType: string;
      expectedSize?: number;
      expectedSha256?: string;
      metadata?: boolean;
    }) => Promise<CopiedArtifact>;
  }): Promise<void> {
    const markerCopy = await input.stageCopy({
      sourcePath: path.join(input.sourceRoot, "finalized.json"),
      relativePath: "inputs/finalized.json",
      role: "live_finalization_metadata",
      mediaType: jsonMediaType,
      expectedSha256: input.frozen.finalizedEvidence!.markerSha256,
      metadata: true
    });
    const markerValue = await readPinnedJson(
      path.join(input.destinationRoot, markerCopy.reference.path),
      maxMetadataBytes
    );
    if (stableLiveJson(markerValue) !== stableLiveJson(input.frozen.finalizedEvidence!.marker)) {
      throw new Error("Finalized marker changed after the reconstruction snapshot.");
    }
    const marker = validateFinalizedMarker(
      markerValue,
      input.frozen.session,
      input.frozen.finalSequenceId!
    );
    if (marker.schema === "capture_splat.live_finalized.v0.2") {
      const bindingCopy = await input.stageCopy({
        sourcePath: path.join(input.sourceRoot, "source-manifest-binding.json"),
        relativePath: "inputs/source-manifest-binding.json",
        role: "live_source_manifest_binding",
        mediaType: jsonMediaType,
        expectedSha256: input.frozen.finalizedEvidence!.bindingSha256!,
        metadata: true
      });
      const binding = validateLiveFinalize(
        await readPinnedJson(path.join(input.destinationRoot, bindingCopy.reference.path), maxMetadataBytes)
      );
      if (
        marker.source_manifest_binding_sha256 !== input.frozen.finalizedEvidence!.bindingSha256
        || stableLiveJson(binding) !== stableLiveJson(input.frozen.finalizedEvidence!.finalization)
        || binding.schema !== LIVE_FINALIZE_V2_SCHEMA
        || binding.session_id !== input.frozen.session.session_id
        || binding.final_sequence_id !== input.frozen.finalSequenceId
      ) {
        throw new Error("Finalized source-manifest binding differs from the live-session snapshot.");
      }
    }
    const handoffCopy = await input.stageCopy({
      sourcePath: path.join(input.sourceRoot, "capture-splat.world-studio.json"),
      relativePath: "inputs/capture-splat.world-studio.json",
      role: "live_handoff",
      mediaType: jsonMediaType,
      expectedSha256: input.frozen.finalizedEvidence!.handoffSha256,
      metadata: true
    });
    const handoffValue = await readPinnedJson(
      path.join(input.destinationRoot, handoffCopy.reference.path),
      maxMetadataBytes
    );
    if (stableLiveJson(handoffValue) !== stableLiveJson(input.frozen.finalizedEvidence!.handoff)) {
      throw new Error("Finalized handoff changed after the reconstruction snapshot.");
    }
    const handoff = record(
      handoffValue,
      "Finalized handoff"
    );
    if (
      marker.handoff_sha256 !== input.frozen.finalizedEvidence!.handoffSha256
      || handoff.schema !== "capture_splat.world_studio_handoff.v0.1"
      || handoff.authority !== "proposal_only"
      || handoff.session_id !== input.frozen.session.session_id
      || handoff.live_session_schema !== input.frozen.session.schema
      || handoff.final_sequence_id !== input.frozen.finalSequenceId
      || handoff.live_session !== "session.json"
      || stableLiveJson(handoff.source_manifest) !== stableLiveJson(input.frozen.finalizedEvidence!.sourceManifestBinding)
    ) {
      throw new Error("Finalized handoff differs from the live-session snapshot.");
    }
  }
}

function assertStageInput(input: {
  sessionId: string;
  destinationRoot: string;
  maxBytes: number;
  maxArtifacts: number;
}): void {
  if (!path.isAbsolute(input.destinationRoot)) throw new Error("Reconstruction destination root must be absolute.");
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) throw new Error("Reconstruction input byte limit must be positive.");
  if (!Number.isSafeInteger(input.maxArtifacts) || input.maxArtifacts < 1) throw new Error("Reconstruction input artifact limit must be positive.");
}

async function copyPinnedRegularFile(input: {
  sourcePath: string;
  destinationRoot: string;
  relativePath: string;
  role: string;
  mediaType: string;
  expectedSize?: number;
  expectedSha256?: string;
  maxBytes: number;
  maxFileBytes: number;
}): Promise<CopiedArtifact> {
  const relativePath = safeInputPath(input.relativePath);
  const destinationPath = path.join(input.destinationRoot, ...relativePath.split("/"));
  await ensureDestinationParent(input.destinationRoot, relativePath);
  const source = await openNoFollow(input.sourcePath, constants.O_RDONLY | constants.O_NONBLOCK, "source input");
  const temporaryPath = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${randomUUID()}.tmp`);
  let destination: FileHandle | null = null;
  let published = false;
  try {
    const sourceBefore = await assertPinnedRegularFile(source, "Source input");
    if (sourceBefore.nlink !== 1) throw new Error("Source input must not be hard-linked.");
    if (sourceBefore.size > input.maxFileBytes || sourceBefore.size > input.maxBytes) {
      throw new Error("Reconstruction input exceeds its file or total byte bound.");
    }
    if (input.expectedSize !== undefined && sourceBefore.size !== input.expectedSize) {
      throw new Error("Reconstruction input size differs from committed live metadata.");
    }
    destination = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    const sha256 = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(copyBufferBytes, Math.max(1, sourceBefore.size)));
    let offset = 0;
    while (offset < sourceBefore.size) {
      const requestBytes = Math.min(buffer.byteLength, sourceBefore.size - offset);
      const { bytesRead } = await source.read(buffer, 0, requestBytes, offset);
      if (bytesRead === 0) throw new Error("Source input was truncated while staging.");
      const chunk = buffer.subarray(0, bytesRead);
      sha256.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(chunk, written, bytesRead - written, offset + written);
        if (result.bytesWritten === 0) throw new Error("Staged input write made no progress.");
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    const sourceAfter = await assertPinnedRegularFile(source, "Source input");
    assertSameStats(sourceBefore, sourceAfter, "Source input changed while staging.");
    const actualSha256 = `sha256:${sha256.digest("hex")}`;
    if (input.expectedSha256 !== undefined && actualSha256 !== input.expectedSha256) {
      throw new Error("Reconstruction input checksum differs from committed live metadata.");
    }
    await destination.sync();
    const destinationBefore = await assertPinnedRegularFile(destination, "Staged input");
    if (destinationBefore.nlink !== 1 || destinationBefore.size !== sourceBefore.size) {
      throw new Error("Staged input file identity or size is invalid.");
    }
    await destination.close();
    destination = null;
    await rename(temporaryPath, destinationPath);
    published = true;
    await syncDirectory(path.dirname(destinationPath));
    const verified = await openNoFollow(destinationPath, constants.O_RDONLY | constants.O_NONBLOCK, "staged input");
    try {
      const destinationAfter = await assertPinnedRegularFile(verified, "Staged input");
      assertSameIdentity(destinationBefore, destinationAfter, "Staged input changed during publication.");
      const verifiedSha256 = await hashPinnedFile(verified, destinationAfter.size);
      if (verifiedSha256 !== actualSha256) throw new Error("Staged input checksum differs after publication.");
    } finally {
      await verified.close();
    }
    return {
      reference: {
        role: input.role,
        path: relativePath,
        sha256: actualSha256,
        size_bytes: sourceBefore.size,
        media_type: input.mediaType
      },
      sizeBytes: sourceBefore.size
    };
  } finally {
    await source.close();
    if (destination) await destination.close();
    await rm(temporaryPath, { force: true });
    if (!published) await rm(destinationPath, { force: true });
  }
}

async function writeGeneratedArtifact(
  destinationRoot: string,
  relativePathValue: string,
  role: string,
  mediaType: string,
  bytes: Buffer
): Promise<CopiedArtifact> {
  const relativePath = safeInputPath(relativePathValue);
  const destinationPath = path.join(destinationRoot, ...relativePath.split("/"));
  await ensureDestinationParent(destinationRoot, relativePath);
  const temporaryPath = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${randomUUID()}.tmp`);
  let file: FileHandle | null = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  let published = false;
  let before: Stats;
  try {
    await file.writeFile(bytes);
    await file.sync();
    before = await assertPinnedRegularFile(file, "Generated input manifest");
    if (before.nlink !== 1 || before.size !== bytes.byteLength) throw new Error("Generated input manifest size is invalid.");
    await file.close();
    file = null;
    await rename(temporaryPath, destinationPath);
    published = true;
    await syncDirectory(path.dirname(destinationPath));
    const verified = await openNoFollow(destinationPath, constants.O_RDONLY | constants.O_NONBLOCK, "generated input manifest");
    try {
      const after = await assertPinnedRegularFile(verified, "Generated input manifest");
      assertSameIdentity(before, after, "Generated input manifest changed during publication.");
      if (await hashPinnedFile(verified, after.size) !== digest(bytes)) {
        throw new Error("Generated input manifest checksum differs after publication.");
      }
    } finally {
      await verified.close();
    }
  } finally {
    if (file) await file.close();
    await rm(temporaryPath, { force: true });
    if (!published) await rm(destinationPath, { force: true });
  }
  return {
    reference: {
      role,
      path: relativePath,
      sha256: digest(bytes),
      size_bytes: bytes.byteLength,
      media_type: mediaType
    },
    sizeBytes: bytes.byteLength
  };
}

async function verifyPublishedInputTree(root: string, expectedFiles: Set<string>): Promise<void> {
  const found = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    await assertRealDirectory(directory, "Published reconstruction input directory");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Published reconstruction inputs contain a symbolic link.");
      if (entry.isDirectory()) {
        await visit(entryPath, relative);
        continue;
      }
      if (!entry.isFile()) throw new Error("Published reconstruction inputs contain a special file.");
      const info = await lstat(entryPath);
      if (info.nlink !== 1) throw new Error("Published reconstruction inputs contain a hard link.");
      if (!expectedFiles.has(relative)) throw new Error("Published reconstruction inputs contain an undeclared file.");
      found.add(relative);
    }
  };
  await visit(root, "");
  if (found.size !== expectedFiles.size || [...expectedFiles].some((file) => !found.has(file))) {
    throw new Error("Published reconstruction inputs are incomplete.");
  }
}

async function readPinnedJson(filePath: string, maxBytes: number): Promise<unknown> {
  const file = await openNoFollow(filePath, constants.O_RDONLY | constants.O_NONBLOCK, "staged JSON");
  try {
    const info = await assertPinnedRegularFile(file, "Staged JSON");
    if (info.nlink !== 1 || info.size > maxBytes) throw new Error("Staged JSON exceeds its safety bound.");
    const bytes = await file.readFile();
    let text: string;
    try {
      text = fatalUtf8Decoder.decode(bytes);
    } catch {
      throw new Error("Staged JSON must be valid UTF-8 without replacement bytes.");
    }
    return parseLiveJson(text);
  } finally {
    await file.close();
  }
}

async function hashPinnedFile(file: FileHandle, size: number): Promise<string> {
  const sha256 = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(copyBufferBytes, Math.max(1, size)));
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.byteLength, size - offset), offset);
    if (bytesRead === 0) throw new Error("Pinned input was truncated while hashing.");
    sha256.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return `sha256:${sha256.digest("hex")}`;
}

async function openNoFollow(filePath: string, flags: number, label: string): Promise<FileHandle> {
  try {
    return await open(filePath, flags | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error, "ELOOP")) throw new Error(`${label} must not be a symbolic link.`);
    throw error;
  }
}

async function assertPinnedRegularFile(file: FileHandle, label: string): Promise<Stats> {
  const info = await file.stat();
  if (!info.isFile()) throw new Error(`${label} must be a regular file.`);
  return info;
}

function assertSameStats(before: Stats, after: Stats, message: string): void {
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.mode !== after.mode
    || before.nlink !== after.nlink
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(message);
  }
}

function assertSameIdentity(before: Stats, after: Stats, message: string): void {
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.mode !== after.mode
    || before.nlink !== after.nlink
    || before.size !== after.size
  ) {
    throw new Error(message);
  }
}

async function ensureDestinationParent(root: string, relativePath: string): Promise<void> {
  const parts = relativePath.split("/").slice(0, -1);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error("Reconstruction input destination contains a non-directory component.");
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      await mkdir(current, { mode: 0o700 });
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error("Reconstruction input destination directory publication failed.");
      }
    }
  }
}

async function assertRealDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory.`);
}

async function assertEmptyRealDirectory(directory: string, label: string): Promise<void> {
  await assertRealDirectory(directory, label);
  if ((await readdir(directory)).length) throw new Error(`${label} must be empty before staging.`);
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function entryExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function safeInputPath(value: string): string {
  const safe = safeReconstructionRelativePath(value, "Reconstruction input path");
  if (!safe.startsWith("inputs/") || safe === "inputs/") {
    throw new Error("Reconstruction input path must remain under inputs/.");
  }
  return safe;
}

function validateFinalizedMarker(
  value: unknown,
  session: LiveSessionDeclaration,
  finalSequenceId: number
): FinalizedMarker {
  const marker = record(value, "Finalized marker");
  const v2 = marker.schema === "capture_splat.live_finalized.v0.2";
  const expectedKeys = v2
    ? [
        "schema",
        "session_id",
        "final_sequence_id",
        "source_manifest_binding_path",
        "source_manifest_binding_sha256",
        "handoff_path",
        "handoff_sha256",
        "finalized_at"
      ]
    : ["schema", "session_id", "final_sequence_id", "handoff_path", "handoff_sha256", "finalized_at"];
  if (Object.keys(marker).sort().join(",") !== expectedKeys.sort().join(",")) {
    throw new Error("Finalized marker contains unexpected fields.");
  }
  if (
    (!v2 && marker.schema !== "capture_splat.live_finalized.v0.1")
    || v2 !== (session.schema === LIVE_SESSION_V2_SCHEMA)
    || marker.session_id !== session.session_id
    || marker.final_sequence_id !== finalSequenceId
    || marker.handoff_path !== "capture-splat.world-studio.json"
    || typeof marker.handoff_sha256 !== "string"
    || !sha256Pattern.test(marker.handoff_sha256)
    || typeof marker.finalized_at !== "string"
    || !Number.isFinite(Date.parse(marker.finalized_at))
  ) {
    throw new Error("Finalized marker differs from the live-session snapshot.");
  }
  if (
    v2
    && (
      marker.source_manifest_binding_path !== "source-manifest-binding.json"
      || typeof marker.source_manifest_binding_sha256 !== "string"
      || !sha256Pattern.test(marker.source_manifest_binding_sha256)
    )
  ) {
    throw new Error("Finalized source-manifest marker is invalid.");
  }
  return marker as unknown as FinalizedMarker;
}

function missingRangesFor(frames: LiveFrame[], end: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let next = 1;
  for (const frame of frames) {
    if (frame.sequence_id > next) ranges.push({ start: next, end: frame.sequence_id - 1 });
    next = frame.sequence_id + 1;
  }
  if (next <= end) ranges.push({ start: next, end });
  return ranges;
}

function assertCapacity(count: number, bytes: number, maxArtifacts: number, maxBytes: number): void {
  if (count > maxArtifacts) throw new Error("Reconstruction input artifact count exceeds its bound.");
  if (bytes > maxBytes) throw new Error("Reconstruction input bytes exceed their bound.");
}

function safeAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} exceed the safe integer bound.`);
  return value;
}

function digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function isNodeError(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}
