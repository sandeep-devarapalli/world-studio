import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createReadStream
} from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";
import type { LiveFrameSummary } from "@world-studio/world-core";
import {
  LIVE_ACK_SCHEMA,
  LIVE_FINALIZE_SCHEMA,
  LiveContractError,
  assertLiveAssetRole,
  declaredLiveAssets,
  parseLiveJson,
  stableLiveJson,
  validSessionId,
  validateLiveFinalize,
  validateLiveFrame,
  validateLiveSession,
  type DeclaredLiveAsset,
  type LiveAck,
  type LiveAssetReference,
  type LiveAssetRole,
  type LiveFinalizeRequest,
  type LiveFrame,
  type LiveMissingRange,
  type LiveSession
} from "./live-session-contract.js";

const frameDirectoryPattern = /^[0-9]{8}$/;
const frameMetadataFile = "metadata.json";
const handoffFile = "capture-splat.world-studio.json";
const finalizedFile = "finalized.json";
const stateFile = "state.json";
const defaultMaxAssetBytes = 1024 * 1024 * 1024;
const maxStoredSequenceId = 99_999_999;

export interface LiveStoreSnapshot {
  sessionId: string;
  sourceManifestId: string;
  expectedCount: number | null;
  finalSequenceId: number | null;
  receivedCount: number;
  contiguousCount: number;
  pendingCount: number;
  missingCount: number;
  nextExpectedSequenceId: number;
  missingRanges: LiveMissingRange[];
  finalized: boolean;
  frames: LiveFrameSummary[];
  authority: "proposal_only";
  updatedAt: string;
}

export interface LiveFramePreviewBytes {
  sessionId: string;
  sequenceId: number;
  mediaType: string;
  width: number;
  height: number;
  bytes: Buffer;
}

interface StoredSession {
  session: LiveSession;
  frames: Map<number, LiveFrame>;
  finalSequenceId: number | null;
  updatedAt: string;
}

interface FinalizedMarker {
  schema: "capture_splat.live_finalized.v0.1";
  session_id: string;
  final_sequence_id: number;
  handoff_path: typeof handoffFile;
  handoff_sha256: string;
  finalized_at: string;
}

export class LiveSessionStore {
  readonly root: string;
  readonly maxAssetBytes: number;
  private initialized = false;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(root: string, options: { maxAssetBytes?: number } = {}) {
    this.root = path.resolve(root);
    this.maxAssetBytes = options.maxAssetBytes ?? defaultMaxAssetBytes;
    if (!Number.isSafeInteger(this.maxAssetBytes) || this.maxAssetBytes < 1) {
      throw new LiveContractError("maxAssetBytes must be a positive integer.");
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await assertDirectory(this.root, "live session root");
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".creating-")) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new LiveContractError(`Stale session publication ${entry.name} is not a real directory.`, "corrupt");
        }
        await rm(path.join(this.root, entry.name), { recursive: true });
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) {
        throw new LiveContractError(`Live session root contains a symbolic link: ${entry.name}.`, "corrupt");
      }
      if (!entry.isDirectory()) continue;
      validSessionId(entry.name);
      const recovered = await this.recoverSession(entry.name);
      this.sessions.set(entry.name, recovered);
    }
    this.initialized = true;
  }

  async putSession(input: unknown): Promise<LiveAck> {
    const session = validateLiveSession(input);
    assertSessionStoreBounds(session);
    return this.withLock(session.session_id, async () => {
      await this.ensureInitialized();
      const existing = this.sessions.get(session.session_id);
      if (existing) {
        if (stableLiveJson(existing.session) !== stableLiveJson(session)) {
          throw new LiveContractError("Session ID already exists with different metadata.", "conflict");
        }
        return this.ack(existing, "session", "duplicate");
      }
      const sessionRoot = this.sessionRoot(session.session_id);
      await assertAbsentOrDirectory(sessionRoot, "session directory");
      if (await pathExists(sessionRoot)) {
        throw new LiveContractError("Session directory already exists without recoverable metadata.", "conflict");
      }
      const publicationRoot = path.join(this.root, `.creating-${randomUUID()}`);
      await mkdir(publicationRoot, { mode: 0o700 });
      try {
        await mkdir(path.join(publicationRoot, ".incoming"), { mode: 0o700 });
        await mkdir(path.join(publicationRoot, "frames"), { mode: 0o700 });
        await atomicWriteJson(path.join(publicationRoot, "session.json"), session);
        await syncDirectory(path.join(publicationRoot, ".incoming"));
        await syncDirectory(path.join(publicationRoot, "frames"));
        await syncDirectory(publicationRoot);
        await rename(publicationRoot, sessionRoot);
        await syncDirectory(this.root);
      } finally {
        await rm(publicationRoot, { recursive: true, force: true });
      }
      const stored: StoredSession = {
        session,
        frames: new Map(),
        finalSequenceId: null,
        updatedAt: new Date().toISOString()
      };
      this.sessions.set(session.session_id, stored);
      await this.writeDerivedState(stored);
      return this.ack(stored, "session", "accepted");
    });
  }

  async putFrame(input: unknown): Promise<LiveAck> {
    const frame = validateLiveFrame(input);
    if (frame.sequence_id > maxStoredSequenceId) {
      throw new LiveContractError(`sequence_id must not exceed ${maxStoredSequenceId}.`);
    }
    return this.withLock(frame.session_id, async () => {
      const stored = await this.requireSession(frame.session_id);
      this.assertWritable(stored);
      this.assertFrameMatchesSession(stored.session, frame);
      const committed = stored.frames.get(frame.sequence_id);
      if (committed) {
        if (stableLiveJson(committed) !== stableLiveJson(frame)) {
          throw new LiveContractError("Sequence ID already exists with different frame metadata.", "conflict");
        }
        return this.ack(stored, "frame", "duplicate", frame.sequence_id);
      }
      const incomingRoot = await this.incomingFrameRoot(stored, frame.sequence_id);
      const metadataPath = path.join(incomingRoot, frameMetadataFile);
      const existing = await readOptionalJson(metadataPath);
      if (existing !== undefined) {
        const pending = validateLiveFrame(existing);
        if (stableLiveJson(pending) !== stableLiveJson(frame)) {
          throw new LiveContractError("Sequence ID is already pending with different frame metadata.", "conflict");
        }
        return this.ack(stored, "frame", "duplicate", frame.sequence_id, undefined, "Identical frame metadata is already pending assets.");
      } else {
        await atomicWriteJson(metadataPath, frame);
      }
      return this.ack(stored, "frame", "incomplete", frame.sequence_id, undefined, "Frame metadata stored; assets are pending.");
    });
  }

  async putAsset(
    sessionIdValue: string,
    sequenceId: number,
    roleValue: string,
    body: AsyncIterable<Uint8Array>
  ): Promise<LiveAck> {
    const sessionId = validSessionId(sessionIdValue);
    const role = assertLiveAssetRole(roleValue);
    if (!Number.isSafeInteger(sequenceId) || sequenceId < 1) {
      throw new LiveContractError("sequence_id must be a positive integer.");
    }
    return this.withLock(sessionId, async () => {
      const stored = await this.requireSession(sessionId);
      this.assertWritable(stored);
      const committed = stored.frames.get(sequenceId);
      if (committed) {
        const declared = requireDeclaredAsset(committed, role);
        try {
          await this.consumeAndValidateDuplicate(stored, declared, body);
        } catch (error) {
          if (error instanceof LiveContractError && error.code === "bad_request") {
            throw new LiveContractError(error.message, "conflict");
          }
          throw error;
        }
        await verifyStoredAsset(
          path.join(
            this.committedFrameRoot(stored.session.session_id, sequenceId),
            assetFileName(role, declared.reference.media_type)
          ),
          declared.reference
        );
        return this.ack(stored, "asset", "duplicate", sequenceId, role);
      }
      const incomingRoot = await this.incomingFrameRoot(stored, sequenceId, false);
      const metadata = validateLiveFrame(
        await readRequiredJson(path.join(incomingRoot, frameMetadataFile), "Frame metadata must be PUT before its assets.")
      );
      if (metadata.sequence_id !== sequenceId) {
        throw new LiveContractError("Pending frame metadata differs from the route sequence.", "corrupt");
      }
      try {
        this.assertFrameMatchesSession(stored.session, metadata);
      } catch (error) {
        if (error instanceof LiveContractError) {
          throw new LiveContractError(`Pending frame metadata differs from its session: ${error.message}`, "corrupt");
        }
        throw error;
      }
      const declared = requireDeclaredAsset(metadata, role);
      const targetName = assetFileName(role, declared.reference.media_type);
      const targetPath = path.join(incomingRoot, targetName);
      const tempPath = path.join(incomingRoot, `.upload-${randomUUID()}.tmp`);
      const duplicatePendingAsset = await pathExists(targetPath);
      try {
        await writeValidatedAsset(tempPath, body, declared.reference, this.maxAssetBytes);
      } catch (error) {
        if (duplicatePendingAsset && error instanceof LiveContractError) {
          throw new LiveContractError(error.message, "conflict");
        }
        throw error;
      }
      if (duplicatePendingAsset) {
        try {
          await verifyStoredAsset(targetPath, declared.reference);
        } finally {
          await rm(tempPath, { force: true });
        }
      } else {
        await rename(tempPath, targetPath);
        await syncDirectory(incomingRoot);
      }
      const allPresent = await allAssetsPresent(incomingRoot, metadata);
      if (!allPresent) {
        return this.ack(
          stored,
          "asset",
          duplicatePendingAsset ? "duplicate" : "incomplete",
          sequenceId,
          role,
          duplicatePendingAsset ? "Identical asset is already pending." : "Asset stored; additional declared assets are pending."
        );
      }
      for (const asset of declaredLiveAssets(metadata)) {
        await verifyStoredAsset(
          path.join(incomingRoot, assetFileName(asset.role, asset.reference.media_type)),
          asset.reference
        );
      }
      const committedRoot = this.committedFrameRoot(stored.session.session_id, sequenceId);
      if (await pathExists(committedRoot)) {
        throw new LiveContractError("Committed frame directory already exists unexpectedly.", "conflict");
      }
      await rename(incomingRoot, committedRoot);
      await syncDirectory(path.dirname(committedRoot));
      stored.frames.set(sequenceId, metadata);
      stored.updatedAt = new Date().toISOString();
      await this.writeDerivedState(stored);
      return this.ack(stored, "asset", duplicatePendingAsset ? "duplicate" : "accepted", sequenceId, role);
    });
  }

  async resume(sessionIdValue: string): Promise<LiveAck> {
    const stored = await this.requireSession(validSessionId(sessionIdValue));
    return this.ack(stored, "resume", stored.finalSequenceId === null ? "accepted" : "finalized");
  }

  async finalize(input: unknown): Promise<LiveAck> {
    const request = validateLiveFinalize(input);
    if (request.final_sequence_id > maxStoredSequenceId) {
      throw new LiveContractError(`final_sequence_id must not exceed ${maxStoredSequenceId}.`);
    }
    return this.withLock(request.session_id, async () => {
      const stored = await this.requireSession(request.session_id);
      if (stored.finalSequenceId !== null) {
        if (stored.finalSequenceId !== request.final_sequence_id) {
          throw new LiveContractError("Session was already finalized with a different final sequence.", "conflict");
        }
        await this.verifyFinalSequence(stored, request);
        await this.verifyFinalizedPublication(stored, request);
        return this.ack(stored, "finalize", "finalized", undefined, undefined, "Finalization was already durable.");
      }
      await this.verifyFinalSequence(stored, request);
      const handoff = buildHandoff(stored, request);
      const handoffPath = path.join(this.sessionRoot(stored.session.session_id), handoffFile);
      await atomicWriteJson(handoffPath, handoff);
      const marker: FinalizedMarker = {
        schema: "capture_splat.live_finalized.v0.1",
        session_id: stored.session.session_id,
        final_sequence_id: request.final_sequence_id,
        handoff_path: handoffFile,
        handoff_sha256: await hashFile(handoffPath),
        finalized_at: new Date().toISOString()
      };
      await atomicWriteJson(path.join(this.sessionRoot(stored.session.session_id), finalizedFile), marker);
      stored.finalSequenceId = request.final_sequence_id;
      stored.updatedAt = marker.finalized_at;
      await this.writeDerivedState(stored);
      return this.ack(stored, "finalize", "finalized");
    });
  }

  async snapshot(sessionIdValue: string): Promise<LiveStoreSnapshot> {
    const stored = await this.requireSession(validSessionId(sessionIdValue));
    const progress = progressFor(stored);
    return {
      sessionId: stored.session.session_id,
      sourceManifestId: stored.session.source_manifest.sha256,
      expectedCount: stored.session.expected_frame_count ?? null,
      finalSequenceId: stored.finalSequenceId,
      receivedCount: progress.receivedCount,
      contiguousCount: progress.contiguousCount,
      pendingCount: progress.pendingCount,
      missingCount: progress.missingRanges.reduce((count, range) => count + range.end - range.start + 1, 0),
      nextExpectedSequenceId: progress.nextExpectedSequenceId,
      missingRanges: progress.missingRanges,
      finalized: stored.finalSequenceId !== null,
      frames: [...stored.frames.values()]
        .sort((left, right) => left.sequence_id - right.sequence_id)
        .map(frameSummary),
      authority: "proposal_only",
      updatedAt: stored.updatedAt
    };
  }

  async readFramePreview(
    sessionIdValue: string,
    sequenceId: number,
    maxBytes = 16 * 1024 * 1024
  ): Promise<LiveFramePreviewBytes | null> {
    const stored = await this.requireSession(validSessionId(sessionIdValue));
    if (!Number.isSafeInteger(sequenceId) || sequenceId < 1) throw new LiveContractError("sequence_id must be positive.");
    const frame = stored.frames.get(sequenceId);
    if (!frame) return null;
    const extension = sourceImageExtension(frame.source_frame.media_type);
    if (!extension) return null;
    const frameRoot = this.committedFrameRoot(stored.session.session_id, sequenceId);
    await assertDirectory(frameRoot, "committed frame directory");
    const sourcePath = path.join(frameRoot, `source${extension}`);
    await verifyStoredAsset(sourcePath, frame.source_frame);
    const fileInfo = await stat(sourcePath);
    if (fileInfo.size > maxBytes) throw new LiveContractError("Source frame exceeds the preview byte limit.");
    return {
      sessionId: stored.session.session_id,
      sequenceId,
      mediaType: frame.source_frame.media_type,
      width: frame.source_frame.width,
      height: frame.source_frame.height,
      bytes: await readFile(sourcePath)
    };
  }

  sessionDirectory(sessionIdValue: string): string {
    return this.sessionRoot(validSessionId(sessionIdValue));
  }

  private async recoverSession(sessionId: string): Promise<StoredSession> {
    const sessionRoot = this.sessionRoot(sessionId);
    await assertDirectory(sessionRoot, "session directory");
    const session = validateLiveSession(await readRequiredJson(path.join(sessionRoot, "session.json"), "Session metadata is missing."));
    try {
      assertSessionStoreBounds(session);
    } catch (error) {
      throw new LiveContractError(error instanceof Error ? error.message : "Session exceeds store bounds.", "corrupt");
    }
    if (session.session_id !== sessionId) throw new LiveContractError("Session directory and metadata ID differ.", "corrupt");
    const incomingRoot = path.join(sessionRoot, ".incoming");
    if (await pathExists(incomingRoot)) {
      await assertDirectory(incomingRoot, "incoming directory");
      await rm(incomingRoot, { recursive: true });
    }
    await mkdir(incomingRoot, { mode: 0o700 });
    const framesRoot = path.join(sessionRoot, "frames");
    await mkdir(framesRoot, { recursive: true, mode: 0o700 });
    await assertDirectory(framesRoot, "frames directory");
    const frames = new Map<number, LiveFrame>();
    for (const entry of await readdir(framesRoot, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new LiveContractError(`Committed frame ${entry.name} is a symbolic link.`, "corrupt");
      if (!entry.isDirectory() || !frameDirectoryPattern.test(entry.name)) {
        throw new LiveContractError(`Unexpected committed frame entry: ${entry.name}.`, "corrupt");
      }
      const sequenceId = Number(entry.name);
      const frameRoot = path.join(framesRoot, entry.name);
      await assertDirectory(frameRoot, "committed frame directory");
      const frame = validateLiveFrame(await readRequiredJson(path.join(frameRoot, frameMetadataFile), "Committed frame metadata is missing."));
      if (frame.session_id !== sessionId || frame.sequence_id !== sequenceId) {
        throw new LiveContractError(`Committed frame ${entry.name} metadata identity differs.`, "corrupt");
      }
      try {
        this.assertFrameMatchesSession(session, frame);
      } catch (error) {
        if (error instanceof LiveContractError) {
          throw new LiveContractError(`Committed frame ${entry.name} differs from its session: ${error.message}`, "corrupt");
        }
        throw error;
      }
      for (const asset of declaredLiveAssets(frame)) {
        await verifyStoredAsset(path.join(frameRoot, assetFileName(asset.role, asset.reference.media_type)), asset.reference);
      }
      frames.set(sequenceId, frame);
    }
    const markerValue = await readOptionalJson(path.join(sessionRoot, finalizedFile));
    const marker = markerValue === undefined ? undefined : validateFinalizedMarker(markerValue, sessionId);
    if (marker) {
      if (
        session.expected_frame_count !== undefined
        && marker.final_sequence_id !== session.expected_frame_count
      ) {
        throw new LiveContractError("Finalized marker differs from session expected_frame_count.", "corrupt");
      }
      if (missingRanges(frames, marker.final_sequence_id).length) {
        throw new LiveContractError("Finalized session is missing committed frames.", "corrupt");
      }
      if ([...frames.keys()].some((sequenceId) => sequenceId > marker.final_sequence_id)) {
        throw new LiveContractError("Finalized session contains frames beyond its final sequence.", "corrupt");
      }
      const handoffPath = path.join(sessionRoot, handoffFile);
      if (await hashFile(handoffPath) !== marker.handoff_sha256) {
        throw new LiveContractError("Finalized handoff checksum differs.", "corrupt");
      }
    }
    const stateValue = await readOptionalJson(path.join(sessionRoot, stateFile));
    const updatedAt = isRecord(stateValue) && typeof stateValue.updated_at === "string"
      ? stateValue.updated_at
      : marker?.finalized_at ?? session.created_at;
    const stored = {
      session,
      frames,
      finalSequenceId: marker?.final_sequence_id ?? null,
      updatedAt
    };
    if (marker) {
      await this.verifyFinalizedPublication(stored, {
        schema: LIVE_FINALIZE_SCHEMA,
        session_id: sessionId,
        final_sequence_id: marker.final_sequence_id
      });
    }
    await this.writeDerivedState(stored);
    return stored;
  }

  private async verifyFinalSequence(stored: StoredSession, request: LiveFinalizeRequest): Promise<void> {
    const expected = stored.session.expected_frame_count;
    if (expected !== undefined && request.final_sequence_id !== expected) {
      throw new LiveContractError(
        `Final sequence ${request.final_sequence_id} does not match expected frame count ${expected}.`,
        "conflict"
      );
    }
    const missing = missingRanges(stored.frames, request.final_sequence_id);
    if (missing.length) {
      throw new LiveContractError(`Cannot finalize with missing frame ranges: ${formatMissingRanges(missing)}.`, "conflict");
    }
    const extraSequence = [...stored.frames.keys()].find((sequenceId) => sequenceId > request.final_sequence_id);
    if (extraSequence !== undefined) {
      throw new LiveContractError(
        `Cannot finalize at ${request.final_sequence_id}; committed frame ${extraSequence} is beyond the final sequence.`,
        "conflict"
      );
    }
    for (let sequenceId = 1; sequenceId <= request.final_sequence_id; sequenceId += 1) {
      const frame = stored.frames.get(sequenceId);
      if (!frame) throw new LiveContractError(`Committed frame ${sequenceId} is missing.`, "corrupt");
      await this.verifyCommittedFrame(stored, frame);
    }
  }

  private async verifyFinalizedPublication(stored: StoredSession, request: LiveFinalizeRequest): Promise<void> {
    const sessionRoot = this.sessionRoot(stored.session.session_id);
    const session = validateLiveSession(
      await readRequiredJson(path.join(sessionRoot, "session.json"), "Session metadata is missing.")
    );
    if (stableLiveJson(session) !== stableLiveJson(stored.session)) {
      throw new LiveContractError("Finalized session metadata changed.", "corrupt");
    }
    const marker = validateFinalizedMarker(
      await readRequiredJson(path.join(sessionRoot, finalizedFile), "Finalized marker is missing."),
      stored.session.session_id
    );
    if (marker.final_sequence_id !== request.final_sequence_id) {
      throw new LiveContractError("Finalized marker differs from the declared final sequence.", "corrupt");
    }
    const handoffPath = path.join(sessionRoot, handoffFile);
    if (await hashFile(handoffPath) !== marker.handoff_sha256) {
      throw new LiveContractError("Finalized handoff checksum differs.", "corrupt");
    }
    const handoff = await readRequiredJson(handoffPath, "Finalized handoff is missing.");
    if (stableLiveJson(handoff) !== stableLiveJson(buildHandoff(stored, request))) {
      throw new LiveContractError("Finalized handoff differs from committed session evidence.", "corrupt");
    }
  }

  private async verifyCommittedFrame(stored: StoredSession, frame: LiveFrame): Promise<void> {
    const frameRoot = this.committedFrameRoot(stored.session.session_id, frame.sequence_id);
    await assertDirectory(frameRoot, "committed frame directory");
    const metadata = validateLiveFrame(await readRequiredJson(path.join(frameRoot, frameMetadataFile), "Committed frame metadata is missing."));
    if (stableLiveJson(metadata) !== stableLiveJson(frame)) {
      throw new LiveContractError(`Committed frame ${frame.sequence_id} metadata changed.`, "corrupt");
    }
    for (const asset of declaredLiveAssets(frame)) {
      await verifyStoredAsset(path.join(frameRoot, assetFileName(asset.role, asset.reference.media_type)), asset.reference);
    }
  }

  private async consumeAndValidateDuplicate(
    stored: StoredSession,
    declared: DeclaredLiveAsset,
    body: AsyncIterable<Uint8Array>
  ): Promise<void> {
    const incomingRoot = path.join(this.sessionRoot(stored.session.session_id), ".incoming");
    await assertDirectory(incomingRoot, "incoming directory");
    const tempPath = path.join(incomingRoot, `.duplicate-${randomUUID()}.tmp`);
    try {
      await writeValidatedAsset(tempPath, body, declared.reference, this.maxAssetBytes);
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  private assertFrameMatchesSession(session: LiveSession, frame: LiveFrame): void {
    if (frame.session_id !== session.session_id) throw new LiveContractError("Frame session_id differs from the route.", "conflict");
    if (frame.coordinate_frame !== session.coordinate_system.id) {
      throw new LiveContractError("Frame coordinate_frame differs from the session coordinate system.", "conflict");
    }
    if (session.expected_frame_count !== undefined && frame.sequence_id > session.expected_frame_count) {
      throw new LiveContractError("Frame sequence exceeds expected_frame_count.", "conflict");
    }
  }

  private assertWritable(stored: StoredSession): void {
    if (stored.finalSequenceId !== null) throw new LiveContractError("Finalized sessions reject all writes.", "sealed");
  }

  private async incomingFrameRoot(stored: StoredSession, sequenceId: number, create = true): Promise<string> {
    const incomingRoot = path.join(this.sessionRoot(stored.session.session_id), ".incoming");
    await assertDirectory(incomingRoot, "incoming directory");
    const frameRoot = path.join(incomingRoot, frameDirectoryName(sequenceId));
    if (create) await mkdir(frameRoot, { recursive: true, mode: 0o700 });
    if (!(await pathExists(frameRoot))) throw new LiveContractError("Frame metadata must be PUT before its assets.", "not_found");
    await assertDirectory(frameRoot, "incoming frame directory");
    return frameRoot;
  }

  private committedFrameRoot(sessionId: string, sequenceId: number): string {
    return path.join(this.sessionRoot(sessionId), "frames", frameDirectoryName(sequenceId));
  }

  private sessionRoot(sessionId: string): string {
    return path.join(this.root, sessionId);
  }

  private async requireSession(sessionId: string): Promise<StoredSession> {
    await this.ensureInitialized();
    const stored = this.sessions.get(sessionId);
    if (!stored) throw new LiveContractError(`Live session ${sessionId} was not found.`, "not_found");
    return stored;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private ack(
    stored: StoredSession,
    operation: LiveAck["operation"],
    status: LiveAck["status"],
    sequenceId?: number,
    assetRole?: LiveAssetRole,
    message?: string
  ): LiveAck {
    const progress = progressFor(stored);
    return {
      schema: LIVE_ACK_SCHEMA,
      session_id: stored.session.session_id,
      operation,
      status,
      ...(sequenceId === undefined ? {} : { sequence_id: sequenceId }),
      ...(assetRole === undefined ? {} : { asset_role: assetRole }),
      received_count: progress.receivedCount,
      contiguous_count: progress.contiguousCount,
      pending_count: progress.pendingCount,
      expected_frame_count: stored.session.expected_frame_count ?? null,
      next_expected_sequence_id: progress.nextExpectedSequenceId,
      missing_ranges: progress.missingRanges,
      finalized: stored.finalSequenceId !== null,
      ...(message === undefined ? {} : { message })
    };
  }

  private async writeDerivedState(stored: StoredSession): Promise<void> {
    const progress = progressFor(stored);
    await atomicWriteJson(path.join(this.sessionRoot(stored.session.session_id), stateFile), {
      schema: "capture_splat.live_store_state.v0.1",
      session_id: stored.session.session_id,
      expected_frame_count: stored.session.expected_frame_count ?? null,
      final_sequence_id: stored.finalSequenceId,
      received_count: progress.receivedCount,
      contiguous_count: progress.contiguousCount,
      pending_count: progress.pendingCount,
      next_expected_sequence_id: progress.nextExpectedSequenceId,
      missing_ranges: progress.missingRanges,
      finalized: stored.finalSequenceId !== null,
      updated_at: stored.updatedAt
    });
  }

  private async withLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(sessionId) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(() => current);
    this.locks.set(sessionId, queued);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(sessionId) === queued) this.locks.delete(sessionId);
    }
  }
}

function progressFor(stored: StoredSession): {
  receivedCount: number;
  contiguousCount: number;
  pendingCount: number;
  nextExpectedSequenceId: number;
  missingRanges: LiveMissingRange[];
} {
  const ids = [...stored.frames.keys()].sort((left, right) => left - right);
  let contiguousCount = 0;
  for (const sequenceId of ids) {
    if (sequenceId !== contiguousCount + 1) break;
    contiguousCount = sequenceId;
  }
  const expectedEnd = stored.session.expected_frame_count
    ?? stored.finalSequenceId
    ?? ids.at(-1)
    ?? 0;
  return {
    receivedCount: ids.length,
    contiguousCount,
    pendingCount: ids.length - contiguousCount,
    nextExpectedSequenceId: contiguousCount + 1,
    missingRanges: missingRangesFromIds(ids, expectedEnd)
  };
}

function missingRanges(frames: Map<number, LiveFrame>, end: number): LiveMissingRange[] {
  return missingRangesFromIds([...frames.keys()].sort((left, right) => left - right), end);
}

function missingRangesFromIds(ids: number[], end: number): LiveMissingRange[] {
  const ranges: LiveMissingRange[] = [];
  let nextMissing = 1;
  for (const sequenceId of ids) {
    if (sequenceId > end) break;
    if (sequenceId < nextMissing) continue;
    if (sequenceId > nextMissing) ranges.push({ start: nextMissing, end: sequenceId - 1 });
    nextMissing = sequenceId + 1;
  }
  if (nextMissing <= end) ranges.push({ start: nextMissing, end });
  return ranges;
}

function frameSummary(frame: LiveFrame): LiveFrameSummary {
  return {
    sequenceId: frame.sequence_id,
    timestamp: frame.timestamp.value,
    clockDomain: frame.timestamp.clock_domain,
    sourceFrameName: path.posix.basename(frame.source_frame.path),
    sourceWidth: frame.source_frame.width,
    sourceHeight: frame.source_frame.height,
    cameraToWorld: frame.camera_to_world,
    coordinateFrame: frame.coordinate_frame,
    previewAvailable: sourceImageExtension(frame.source_frame.media_type) !== undefined
  };
}

function requireDeclaredAsset(frame: LiveFrame, role: LiveAssetRole): DeclaredLiveAsset {
  const declared = declaredLiveAssets(frame).find((asset) => asset.role === role);
  if (!declared) throw new LiveContractError(`Frame does not declare asset role ${role}.`);
  return declared;
}

function frameDirectoryName(sequenceId: number): string {
  if (!Number.isSafeInteger(sequenceId) || sequenceId < 1 || sequenceId > maxStoredSequenceId) {
    throw new LiveContractError("sequence_id cannot be represented by the receiver store.");
  }
  return sequenceId.toString().padStart(8, "0");
}

function assertSessionStoreBounds(session: LiveSession): void {
  if (session.expected_frame_count !== undefined && session.expected_frame_count > maxStoredSequenceId) {
    throw new LiveContractError(`expected_frame_count must not exceed ${maxStoredSequenceId}.`);
  }
}

function assetFileName(role: LiveAssetRole, mediaType: string): string {
  if (role === "source") {
    const extension = sourceImageExtension(mediaType);
    return extension ? `source${extension}` : "source.bin";
  }
  const extension = safeAssetExtension(mediaType);
  return `${role}${extension}`;
}

function sourceImageExtension(mediaType: string): ".jpg" | ".png" | ".webp" | undefined {
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/webp") return ".webp";
  return undefined;
}

function safeAssetExtension(mediaType: string): string {
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "application/x-npy") return ".npy";
  return ".bin";
}

async function allAssetsPresent(frameRoot: string, frame: LiveFrame): Promise<boolean> {
  for (const asset of declaredLiveAssets(frame)) {
    if (!(await pathExists(path.join(frameRoot, assetFileName(asset.role, asset.reference.media_type))))) return false;
  }
  return true;
}

async function writeValidatedAsset(
  tempPath: string,
  body: AsyncIterable<Uint8Array>,
  reference: LiveAssetReference,
  maxAssetBytes: number
): Promise<void> {
  if (reference.size_bytes > maxAssetBytes) throw new LiveContractError("Declared asset exceeds receiver byte limit.");
  const file = await open(tempPath, "wx", 0o600);
  const digest = createHash("sha256");
  let bytesWritten = 0;
  try {
    for await (const chunkValue of body) {
      const chunk = Buffer.from(chunkValue);
      bytesWritten += chunk.byteLength;
      if (bytesWritten > reference.size_bytes || bytesWritten > maxAssetBytes) {
        throw new LiveContractError("Asset body exceeds its declared byte size.");
      }
      digest.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const result = await file.write(chunk, offset, chunk.byteLength - offset);
        offset += result.bytesWritten;
      }
    }
    if (bytesWritten !== reference.size_bytes) {
      throw new LiveContractError(`Asset byte size mismatch: expected ${reference.size_bytes}, received ${bytesWritten}.`);
    }
    const actualSha256 = `sha256:${digest.digest("hex")}`;
    if (actualSha256 !== reference.sha256) throw new LiveContractError("Asset SHA-256 mismatch.");
    await file.sync();
  } catch (error) {
    await file.close();
    await rm(tempPath, { force: true });
    throw error;
  }
  await file.close();
}

async function verifyStoredAsset(filePath: string, reference: LiveAssetReference, hash = true): Promise<void> {
  await assertRegularFile(filePath, "stored asset");
  const info = await stat(filePath);
  if (info.size !== reference.size_bytes) throw new LiveContractError(`Stored asset size differs: ${path.basename(filePath)}.`, "corrupt");
  if (hash && await hashFile(filePath) !== reference.sha256) {
    throw new LiveContractError(`Stored asset checksum differs: ${path.basename(filePath)}.`, "corrupt");
  }
}

async function hashFile(filePath: string): Promise<string> {
  await assertRegularFile(filePath, "hashed file");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return `sha256:${digest.digest("hex")}`;
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await assertDirectory(directory, "JSON parent directory");
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const file = await open(tempPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(tempPath, filePath);
  await syncDirectory(directory);
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readRequiredJson(filePath: string, message: string): Promise<unknown> {
  try {
    await assertRegularFile(filePath, "JSON file");
    return parseLiveJson(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) throw new LiveContractError(message, "not_found");
    throw error;
  }
}

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  try {
    await assertRegularFile(filePath, "JSON file");
    return parseLiveJson(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function assertDirectory(filePath: string, label: string): Promise<void> {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new LiveContractError(`${label} must be a real directory, not a symbolic link.`, "corrupt");
  }
}

async function assertAbsentOrDirectory(filePath: string, label: string): Promise<void> {
  try {
    await assertDirectory(filePath, label);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new LiveContractError(`${label} must be a regular file, not a symbolic link.`, "corrupt");
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function validateFinalizedMarker(value: unknown, sessionId: string): FinalizedMarker {
  if (!isRecord(value)) throw new LiveContractError("Finalized marker must be an object.", "corrupt");
  const keys = Object.keys(value).sort();
  const expected = ["final_sequence_id", "finalized_at", "handoff_path", "handoff_sha256", "schema", "session_id"];
  if (stableLiveJson(keys) !== stableLiveJson(expected)) throw new LiveContractError("Finalized marker has unexpected fields.", "corrupt");
  if (
    value.schema !== "capture_splat.live_finalized.v0.1"
    || value.session_id !== sessionId
    || value.handoff_path !== handoffFile
    || typeof value.final_sequence_id !== "number"
    || !Number.isSafeInteger(value.final_sequence_id)
    || value.final_sequence_id < 1
    || typeof value.handoff_sha256 !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(value.handoff_sha256)
    || typeof value.finalized_at !== "string"
  ) {
    throw new LiveContractError("Finalized marker is invalid.", "corrupt");
  }
  return value as unknown as FinalizedMarker;
}

function buildHandoff(stored: StoredSession, request: LiveFinalizeRequest): Record<string, unknown> {
  const sourceFrames = [...stored.frames.values()]
    .sort((left, right) => left.sequence_id - right.sequence_id)
    .map((frame) => {
      const frameRoot = `frames/${frameDirectoryName(frame.sequence_id)}`;
      const sourcePath = `${frameRoot}/${assetFileName("source", frame.source_frame.media_type)}`;
      const scaleX = frame.source_frame.width / frame.intrinsics.calibration_width;
      const scaleY = frame.source_frame.height / frame.intrinsics.calibration_height;
      const displayIntrinsics = {
        fx: frame.intrinsics.fl_x * scaleX,
        fy: frame.intrinsics.fl_y * scaleY,
        cx: frame.intrinsics.cx * scaleX,
        cy: frame.intrinsics.cy * scaleY
      };
      if (!Object.values(displayIntrinsics).every(Number.isFinite)) {
        throw new LiveContractError("Display camera intrinsics overflowed while scaling to the source frame.", "corrupt");
      }
      const matrix = frame.camera_to_world;
      return {
        sequence_id: frame.sequence_id,
        path: sourcePath,
        rgb_path: sourcePath,
        checksum: frame.source_frame.sha256,
        size_bytes: frame.source_frame.size_bytes,
        width: frame.source_frame.width,
        height: frame.source_frame.height,
        timestamp: frame.timestamp,
        camera_to_world: frame.camera_to_world,
        intrinsics: frame.intrinsics,
        camera: {
          width: frame.source_frame.width,
          height: frame.source_frame.height,
          ...displayIntrinsics,
          translation: [matrix[3], matrix[7], matrix[11]],
          rotation: rotationMatrixToQuaternionWxyz(matrix),
          coordinate_frame: frame.coordinate_frame,
          authority: "Capture Splat live camera evidence; proposal only"
        },
        metadata_path: `${frameRoot}/${frameMetadataFile}`,
        assets: Object.fromEntries(
          declaredLiveAssets(frame)
            .filter((asset) => asset.role !== "source")
            .map((asset) => [
              asset.role.replace("-", "_"),
              {
                path: `${frameRoot}/${assetFileName(asset.role, asset.reference.media_type)}`,
                sha256: asset.reference.sha256,
                size_bytes: asset.reference.size_bytes,
                media_type: asset.reference.media_type
              }
            ])
        )
      };
    });
  return {
    schema: "capture_splat.world_studio_handoff.v0.1",
    status: "visual_evidence",
    authority: "proposal_only",
    session_id: stored.session.session_id,
    live_session_schema: stored.session.schema,
    live_session: "session.json",
    source_manifest: stored.session.source_manifest,
    coordinate_system: stored.session.coordinate_system,
    final_sequence_id: request.final_sequence_id,
    source_frames: sourceFrames,
    artifacts: sourceFrames.flatMap((frame) => {
      const source = frame as { path: string; checksum: string; size_bytes: number; sequence_id: number };
      return [{
        kind: "source_frame",
        role: "source",
        path: source.path,
        checksum: source.checksum,
        size_bytes: source.size_bytes,
        sequence_id: source.sequence_id
      }];
    })
  };
}

function rotationMatrixToQuaternionWxyz(matrix: LiveFrame["camera_to_world"]): [number, number, number, number] {
  const m00 = matrix[0];
  const m01 = matrix[1];
  const m02 = matrix[2];
  const m10 = matrix[4];
  const m11 = matrix[5];
  const m12 = matrix[6];
  const m20 = matrix[8];
  const m21 = matrix[9];
  const m22 = matrix[10];
  const trace = m00 + m11 + m22;
  let qw: number;
  let qx: number;
  let qy: number;
  let qz: number;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * scale;
    qx = (m21 - m12) / scale;
    qy = (m02 - m20) / scale;
    qz = (m10 - m01) / scale;
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / scale;
    qx = 0.25 * scale;
    qy = (m01 + m10) / scale;
    qz = (m02 + m20) / scale;
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / scale;
    qx = (m01 + m10) / scale;
    qy = 0.25 * scale;
    qz = (m12 + m21) / scale;
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / scale;
    qx = (m02 + m20) / scale;
    qy = (m12 + m21) / scale;
    qz = 0.25 * scale;
  }
  const length = Math.hypot(qw, qx, qy, qz);
  if (!Number.isFinite(length) || length <= 1e-12) throw new LiveContractError("Camera rotation is not usable.", "corrupt");
  return [qw / length, qx / length, qy / length, qz / length];
}

function formatMissingRanges(ranges: LiveMissingRange[]): string {
  return ranges.map((range) => range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`).join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}
