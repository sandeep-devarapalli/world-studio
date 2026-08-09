import {
  CANONICAL_ASSET_SCHEMA,
  CANONICAL_WORLD_SCHEMA,
  parseCanonicalGraphJson,
  safeCanonicalRelativePath,
  stableCanonicalJson,
  validateCanonicalAssetManifest,
  validateCanonicalDelta,
  validateCanonicalSha256,
  validateCanonicalTimestamp,
  validateCanonicalTransitionBinding,
  validateCanonicalWorldManifest,
  type CanonicalAssetManifestV1,
  type CanonicalContentReferenceV1,
  type CanonicalDeltaV1,
  type CanonicalRevisionKind,
  type CanonicalVersionReferenceV1,
  type CanonicalWorldManifestV2,
} from "@world-studio/world-core";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

const storeEntrySchema = "world_studio.canonical_package_store_entry.v0.1";
const manifestFile = "record/manifest.json";
const commitFile = "record/commit.json";
const copyBufferBytes = 64 * 1024;
const defaultMaxManifestBytes = 64 * 1024 * 1024;
const defaultMaxReferencedFileBytes = 2 * 1024 * 1024 * 1024;
const defaultMaxReadBytes = 16 * 1024 * 1024;
const defaultMaxRevisionBytes = 8 * 1024 * 1024 * 1024;
const defaultMaxReferencedFiles = 131_072;
const defaultMaxContentDirectories = 262_144;
const defaultMaxStoredVersions = 100_000;
const defaultMaxRecoveryReferences = 1_000_000;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const versionDirectoryPattern = /^[0-9]{10}$/;
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const incomingOwnerPattern = new RegExp(`^([1-9][0-9]*)\\.(${uuidPattern})\\.(${uuidPattern})$`);
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const processIdentity = randomUUID();
const rootOperationTails = new Map<string, Promise<void>>();

export type WorldPackageStoreErrorCode =
  | "invalid"
  | "not_found"
  | "conflict"
  | "corrupt"
  | "limit";

export class CanonicalWorldPackageStoreError extends Error {
  constructor(
    message: string,
    readonly code: WorldPackageStoreErrorCode,
  ) {
    super(message);
    this.name = "CanonicalWorldPackageStoreError";
  }
}

export { CanonicalWorldPackageStoreError as WorldPackageStoreError };

type WorldPackageStoreError = CanonicalWorldPackageStoreError;
const WorldPackageStoreError = CanonicalWorldPackageStoreError;

export interface CanonicalWorldPackageStoreBounds {
  maxManifestBytes?: number;
  maxReferencedFileBytes?: number;
  maxReadBytes?: number;
  maxRevisionBytes?: number;
  maxReferencedFiles?: number;
  maxContentDirectories?: number;
  maxStoredVersions?: number;
  maxRecoveryReferences?: number;
}

export interface CanonicalWorldPackageDirectoryInput {
  sourceRoot: string;
  manifestPath: string;
}

export interface CanonicalStoredWorldPackageVersion {
  reference: CanonicalVersionReferenceV1;
  manifest: CanonicalWorldManifestV2 | CanonicalAssetManifestV1;
  manifestBytes: Buffer;
  manifestSizeBytes: number;
  delta: CanonicalDeltaV1 | null;
  referenceInventory: CanonicalContentReferenceV1[];
}

export interface CanonicalWorldPackagePublishResult extends CanonicalStoredWorldPackageVersion {
  status: "accepted" | "duplicate";
}

interface RequiredStoreBounds {
  maxManifestBytes: number;
  maxReferencedFileBytes: number;
  maxReadBytes: number;
  maxRevisionBytes: number;
  maxReferencedFiles: number;
  maxContentDirectories: number;
  maxStoredVersions: number;
  maxRecoveryReferences: number;
}

interface RecoveryBudget {
  versions: number;
  references: number;
}

interface StoredCommit {
  schema: typeof storeEntrySchema;
  reference: CanonicalVersionReferenceV1;
  manifest: CanonicalContentReferenceV1;
  reference_inventory: CanonicalContentReferenceV1[];
  committed_at: string;
}

interface StoredEntry {
  root: string;
  reference: CanonicalVersionReferenceV1;
}

interface VerifiedEntry extends CanonicalStoredWorldPackageVersion {
  root: string;
  commit: StoredCommit;
}

interface ReferenceSource {
  root: string;
  relativePath: string;
  code: "invalid" | "corrupt";
}

interface PlannedReference {
  reference: CanonicalContentReferenceV1;
  source: ReferenceSource;
}

interface PinnedRead {
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
}

interface PinnedHash {
  header: Buffer;
  sha256: string;
  sizeBytes: number;
}

export class CanonicalWorldPackageStore {
  readonly root: string;
  readonly bounds: Readonly<RequiredStoreBounds>;

  private initialized = false;
  private initialization: Promise<void> | null = null;
  private operation: Promise<void> = Promise.resolve();
  private readonly entries = new Map<string, StoredEntry>();
  private recoveryVersionCount = 0;
  private recoveryReferenceCount = 0;

  constructor(root: string, bounds: CanonicalWorldPackageStoreBounds = {}) {
    if (!path.isAbsolute(root)) {
      throw new CanonicalWorldPackageStoreError("Canonical package store root must be absolute.", "invalid");
    }
    this.root = path.resolve(root);
    this.bounds = Object.freeze({
      maxManifestBytes: positiveBound(bounds.maxManifestBytes ?? defaultMaxManifestBytes, "maxManifestBytes"),
      maxReferencedFileBytes: positiveBound(
        bounds.maxReferencedFileBytes ?? defaultMaxReferencedFileBytes,
        "maxReferencedFileBytes",
      ),
      maxReadBytes: positiveBound(bounds.maxReadBytes ?? defaultMaxReadBytes, "maxReadBytes"),
      maxRevisionBytes: positiveBound(bounds.maxRevisionBytes ?? defaultMaxRevisionBytes, "maxRevisionBytes"),
      maxReferencedFiles: positiveBound(bounds.maxReferencedFiles ?? defaultMaxReferencedFiles, "maxReferencedFiles"),
      maxContentDirectories: positiveBound(
        bounds.maxContentDirectories ?? defaultMaxContentDirectories,
        "maxContentDirectories",
      ),
      maxStoredVersions: positiveBound(bounds.maxStoredVersions ?? defaultMaxStoredVersions, "maxStoredVersions"),
      maxRecoveryReferences: positiveBound(
        bounds.maxRecoveryReferences ?? defaultMaxRecoveryReferences,
        "maxRecoveryReferences",
      ),
    });
    if (this.bounds.maxReadBytes > defaultMaxReadBytes) {
      throw new CanonicalWorldPackageStoreError(
        "maxReadBytes cannot exceed the 16 MiB hard cap.",
        "invalid",
      );
    }
    if (
      this.bounds.maxContentDirectories > defaultMaxContentDirectories
      || this.bounds.maxStoredVersions > defaultMaxStoredVersions
      || this.bounds.maxRecoveryReferences > defaultMaxRecoveryReferences
    ) {
      throw new CanonicalWorldPackageStoreError(
        "Recovery and directory bounds cannot exceed their hard safety ceilings.",
        "invalid",
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;
    this.initialization = this.withStoreOperation(async () => {
      await this.initializeStore();
    });
    try {
      await this.initialization;
      this.initialized = true;
    } finally {
      this.initialization = null;
    }
  }

  async publishDirectory(
    input: CanonicalWorldPackageDirectoryInput,
  ): Promise<CanonicalWorldPackagePublishResult> {
    return this.serialized(() => this.withStoreOperation(async () => {
      await this.initializeStore();
      this.initialized = true;
      const source = await this.readSourceManifest(input);
      const manifest = parseRevisionManifest(source.bytes, "invalid");
      const reference = versionReference(manifest, source.sha256);
      const target = this.revisionRoot(reference.kind, reference.id, reference.version);
      const existing = this.entries.get(entryKey(reference.kind, reference.id, reference.version));
      if (existing || await entryExists(target)) {
        const stored = await this.openTargetForPublish(target, reference);
        return { status: "duplicate", ...publicVersion(stored) };
      }

      await this.assertNoCaseFoldIdConflict(reference.kind, reference.id);
      const parent = await this.parentForPublish(manifest);
      const plans = new Map<string, PlannedReference>();
      if (manifest.schema === CANONICAL_WORLD_SCHEMA) {
        await this.addWorldAssetClosure(manifest, plans);
      }
      for (const content of directManifestReferences(manifest)) {
        addPlannedReference(plans, content, this.sourceForReference(content, input.sourceRoot, parent));
      }
      const inventory = [...plans.values()]
        .map((plan) => cloneContentReference(plan.reference))
        .sort((left, right) => compareText(left.path, right.path));
      validateReferenceInventory(inventory, this.bounds, source.sizeBytes, "invalid");
      if (this.recoveryVersionCount >= this.bounds.maxStoredVersions) {
        throw new WorldPackageStoreError("Canonical package store version count exceeds its recovery bound.", "limit");
      }
      if (
        safeAdd(this.recoveryReferenceCount, inventory.length, "Canonical package recovery references")
        > this.bounds.maxRecoveryReferences
      ) {
        throw new WorldPackageStoreError("Canonical package store references exceed their recovery bound.", "limit");
      }

      const delta = await this.deltaForPublish(manifest, plans);
      if (parent && delta) {
        validateTransition(
          parent.manifest,
          delta,
          manifest,
          parent.reference.manifest_sha256,
          manifest.applied_delta!.manifest.sha256,
          "conflict",
        );
      }

      const commit: StoredCommit = {
        schema: storeEntrySchema,
        reference,
        manifest: {
          path: manifestFile,
          sha256: source.sha256,
          size_bytes: source.sizeBytes,
          media_type: "application/json",
        },
        reference_inventory: inventory,
        committed_at: new Date().toISOString(),
      };
      const commitBytes = encodeCommit(commit, this.bounds);
      validateReferenceInventory(
        inventory,
        this.bounds,
        safeAdd(source.sizeBytes, commitBytes.byteLength, "Canonical package record bytes"),
        "invalid",
      );

      const incomingRoot = this.internalPath(".incoming");
      const publicationRoot = path.join(incomingRoot, incomingOwnerName());
      const stagingRoot = path.join(publicationRoot, "revision");
      await mkdir(publicationRoot, { mode: 0o700 });
      await syncDirectory(incomingRoot);
      await mkdir(stagingRoot, { mode: 0o700 });
      try {
        await mkdir(path.join(stagingRoot, "record"), { mode: 0o700 });
        await mkdir(path.join(stagingRoot, "content"), { mode: 0o700 });
        await writeAtomicBytes(path.join(stagingRoot, manifestFile), source.bytes, source.sha256);
        for (const plan of [...plans.values()].sort((left, right) => compareText(left.reference.path, right.reference.path))) {
          await copyPinnedReference(stagingRoot, plan, this.bounds);
        }
        await writeAtomicBytes(path.join(stagingRoot, commitFile), commitBytes);
        await syncDirectory(path.join(stagingRoot, "record"));
        await syncDirectory(path.join(stagingRoot, "content"));
        await syncDirectory(stagingRoot);

        const staged = await this.verifyEntry(stagingRoot, "invalid");
        await this.verifyImmediateDependencies(staged, true, "conflict");
        try {
          const idRoot = path.join(this.kindRoot(reference.kind), reference.id);
          if (await entryExists(idRoot)) {
            await this.assertLineageDirectories(reference.kind, reference.id);
            await rename(stagingRoot, target);
            await syncDirectory(path.dirname(target));
          } else {
            const lineageRoot = path.join(publicationRoot, "lineage");
            const lineageVersionsRoot = path.join(lineageRoot, "versions");
            await mkdir(lineageRoot, { mode: 0o700 });
            await mkdir(lineageVersionsRoot, { mode: 0o700 });
            await rename(stagingRoot, path.join(lineageVersionsRoot, versionDirectoryName(reference.version)));
            await syncDirectory(lineageVersionsRoot);
            await syncDirectory(lineageRoot);
            await rename(lineageRoot, idRoot);
            await syncDirectory(this.kindRoot(reference.kind));
          }
        } catch (error) {
          if (!isNodeError(error, "EEXIST") && !isNodeError(error, "ENOTEMPTY")) throw error;
          const stored = await this.openTargetForPublish(target, reference);
          return { status: "duplicate", ...publicVersion(stored) };
        }
        this.entries.set(entryKeyOf(reference), { root: target, reference });
        const stored = await this.verifyGraph({ root: target, reference }, "corrupt");
        return { status: "accepted", ...publicVersion(stored) };
      } finally {
        await rm(publicationRoot, { recursive: true, force: true });
        await syncDirectory(incomingRoot);
      }
    }));
  }

  async openVersion(referenceValue: CanonicalVersionReferenceV1): Promise<CanonicalStoredWorldPackageVersion> {
    const reference = validateVersionReferenceInput(referenceValue);
    return this.withStoreOperation(async () => {
      await this.initializeStore();
      this.initialized = true;
      return publicVersion(await this.openVersionUnlocked(reference));
    });
  }

  async readReferencedBytes(
    referenceValue: CanonicalVersionReferenceV1,
    relativePathValue: string,
    maxBytes?: number,
  ): Promise<Buffer> {
    const reference = validateVersionReferenceInput(referenceValue);
    const relativePath = safePath(relativePathValue, "Referenced path", "invalid");
    const requestedMaxBytes = positiveBound(maxBytes ?? this.bounds.maxReadBytes, "maxBytes");
    if (requestedMaxBytes > this.bounds.maxReadBytes) {
      throw new WorldPackageStoreError("Requested referenced bytes exceed the configured read cap.", "limit");
    }
    return this.withStoreOperation(async () => {
      await this.initializeStore();
      this.initialized = true;
      const opened = await this.openVersionUnlocked(reference);
      const content = opened.referenceInventory.find((entry) => entry.path === relativePath);
      if (!content) throw new WorldPackageStoreError("The referenced package file was not found.", "not_found");
      if (content.size_bytes > requestedMaxBytes) {
        throw new WorldPackageStoreError("The referenced package file exceeds the requested byte limit.", "limit");
      }
      const stored = this.entries.get(entryKeyOf(reference))!;
      const result = await readPinnedFile(
        stored.root,
        `content/${content.path}`,
        requestedMaxBytes,
        "Stored referenced file",
        "corrupt",
      );
      if (result.sizeBytes !== content.size_bytes || result.sha256 !== content.sha256) {
        throw new WorldPackageStoreError("Stored referenced file differs from its committed identity.", "corrupt");
      }
      validateMediaBytes(result.bytes, content, "corrupt");
      return Buffer.from(result.bytes);
    });
  }

  private async initializeStore(): Promise<void> {
    this.entries.clear();
    this.recoveryVersionCount = 0;
    this.recoveryReferenceCount = 0;
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await assertRealDirectory(this.root, "Canonical package store root", "corrupt");
      await ensureFixedDirectory(this.root, ".incoming", "corrupt");
      await ensureFixedDirectory(this.root, "worlds", "corrupt");
      await ensureFixedDirectory(this.root, "assets", "corrupt");
      await assertExactNames(this.root, new Set([".incoming", "worlds", "assets"]), "Canonical package store root");
      await this.discardStaleIncoming();

      const budget: RecoveryBudget = { versions: 0, references: 0 };
      await this.scanKind("world", budget);
      await this.scanKind("asset", budget);
      for (const entry of this.entries.values()) {
        const verified = await this.verifyEntry(entry.root, "corrupt");
        await this.verifyImmediateDependencies(verified, false, "corrupt");
      }
      this.recoveryVersionCount = budget.versions;
      this.recoveryReferenceCount = budget.references;
    } catch (error) {
      this.entries.clear();
      this.recoveryVersionCount = 0;
      this.recoveryReferenceCount = 0;
      throw asStoreError(error, "corrupt", "Canonical package store recovery failed.");
    }
  }

  private async discardStaleIncoming(): Promise<void> {
    const incomingRoot = this.internalPath(".incoming");
    for (const entry of await readdir(incomingRoot, { withFileTypes: true })) {
      const entryPath = path.join(incomingRoot, entry.name);
      let info: Stats;
      try {
        info = await lstat(entryPath);
      } catch (error) {
        if (isNodeError(error, "ENOENT")) continue;
        throw error;
      }
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new WorldPackageStoreError("Canonical package staging contains a non-directory entry.", "corrupt");
      }
      const owner = decodeIncomingOwner(entry.name);
      if (owner.pid !== process.pid && processIsAlive(owner.pid)) {
        throw new WorldPackageStoreError(
          "Canonical package staging is owned by another live process.",
          "conflict",
        );
      }
      await rm(entryPath, { recursive: true, force: true });
    }
    await syncDirectory(incomingRoot);
  }

  private async scanKind(kind: CanonicalRevisionKind, budget: RecoveryBudget): Promise<void> {
    const kindRoot = this.kindRoot(kind);
    const foldedIds = new Set<string>();
    for (const idEntry of await readdir(kindRoot, { withFileTypes: true })) {
      if (!identifierPattern.test(idEntry.name)) {
        throw new WorldPackageStoreError("Canonical package store contains an invalid record ID.", "corrupt");
      }
      const folded = idEntry.name.toLowerCase();
      if (foldedIds.has(folded)) {
        throw new WorldPackageStoreError("Canonical package record IDs collide by case.", "corrupt");
      }
      foldedIds.add(folded);
      const idRoot = path.join(kindRoot, idEntry.name);
      await assertRealDirectory(idRoot, "Canonical package record directory", "corrupt");
      await assertExactNames(idRoot, new Set(["versions"]), "Canonical package record directory");
      const versionsRoot = path.join(idRoot, "versions");
      await assertRealDirectory(versionsRoot, "Canonical package versions directory", "corrupt");
      const versionEntries = await readdir(versionsRoot, { withFileTypes: true });
      if (versionEntries.length === 0) {
        throw new WorldPackageStoreError("Canonical package store contains an orphan empty record.", "corrupt");
      }
      for (const versionEntry of versionEntries) {
        if (!versionDirectoryPattern.test(versionEntry.name)) {
          throw new WorldPackageStoreError("Canonical package store contains an invalid version directory.", "corrupt");
        }
        const version = Number(versionEntry.name);
        if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
          throw new WorldPackageStoreError("Canonical package store contains an invalid version number.", "corrupt");
        }
        const revisionRoot = path.join(versionsRoot, versionEntry.name);
        await assertRealDirectory(revisionRoot, "Canonical package revision directory", "corrupt");
        const verified = await this.verifyEntry(revisionRoot, "corrupt");
        if (
          verified.reference.kind !== kind
          || verified.reference.id !== idEntry.name
          || verified.reference.version !== version
        ) {
          throw new WorldPackageStoreError("Canonical package directory identity differs from its manifest.", "corrupt");
        }
        const key = entryKeyOf(verified.reference);
        if (this.entries.has(key)) {
          throw new WorldPackageStoreError("Canonical package store contains a duplicate version.", "corrupt");
        }
        budget.versions = safeAdd(budget.versions, 1, "Canonical package stored versions");
        if (budget.versions > this.bounds.maxStoredVersions) {
          throw new WorldPackageStoreError("Canonical package store version count exceeds its recovery bound.", "limit");
        }
        budget.references = safeAdd(
          budget.references,
          verified.referenceInventory.length,
          "Canonical package recovery references",
        );
        if (budget.references > this.bounds.maxRecoveryReferences) {
          throw new WorldPackageStoreError("Canonical package store references exceed their recovery bound.", "limit");
        }
        this.entries.set(key, { root: revisionRoot, reference: verified.reference });
      }
    }
  }

  private async verifyEntry(
    revisionRoot: string,
    code: "invalid" | "corrupt",
  ): Promise<VerifiedEntry> {
    try {
      await assertRealDirectory(revisionRoot, "Canonical package revision", code);
      await assertExactNames(revisionRoot, new Set(["record", "content"]), "Canonical package revision");
      const recordRoot = path.join(revisionRoot, "record");
      const contentRoot = path.join(revisionRoot, "content");
      await assertRealDirectory(recordRoot, "Canonical package record", code);
      await assertRealDirectory(contentRoot, "Canonical package content", code);
      await assertExactNames(recordRoot, new Set(["manifest.json", "commit.json"]), "Canonical package record");

      const manifestRead = await readPinnedFile(
        revisionRoot,
        manifestFile,
        this.bounds.maxManifestBytes,
        "Stored canonical manifest",
        code,
      );
      const manifest = parseRevisionManifest(manifestRead.bytes, code);
      const computedReference = versionReference(manifest, manifestRead.sha256);
      const commitRead = await readPinnedFile(
        revisionRoot,
        commitFile,
        this.bounds.maxManifestBytes,
        "Canonical package commit marker",
        code,
      );
      const commit = decodeCommit(commitRead.bytes, this.bounds, code);
      validateReferenceInventory(
        commit.reference_inventory,
        this.bounds,
        safeAdd(manifestRead.sizeBytes, commitRead.sizeBytes, "Canonical package record bytes"),
        code,
      );
      if (
        !sameVersionReference(commit.reference, computedReference)
        || commit.manifest.path !== manifestFile
        || commit.manifest.sha256 !== manifestRead.sha256
        || commit.manifest.size_bytes !== manifestRead.sizeBytes
        || commit.manifest.media_type !== "application/json"
      ) {
        throw new WorldPackageStoreError("Canonical package commit marker differs from its manifest.", code);
      }
      await assertExactContentTree(contentRoot, commit.reference_inventory, this.bounds, code);
      for (const content of commit.reference_inventory) {
        await verifyStoredReference(revisionRoot, content, this.bounds, code);
      }
      const delta = await readStoredDelta(revisionRoot, manifest, this.bounds, code);
      return {
        root: revisionRoot,
        reference: computedReference,
        manifest,
        manifestBytes: Buffer.from(manifestRead.bytes),
        manifestSizeBytes: manifestRead.sizeBytes,
        delta,
        referenceInventory: commit.reference_inventory.map(cloneContentReference),
        commit,
      };
    } catch (error) {
      throw asStoreError(error, code, "Canonical package revision is invalid.");
    }
  }

  private async verifyGraph(
    entry: StoredEntry,
    code: "conflict" | "corrupt",
  ): Promise<VerifiedEntry> {
    const verified = await this.verifyIndexedEntry(entry, code);
    let current = verified;
    while (true) {
      const parent = await this.verifyImmediateDependencies(current, true, code);
      if (!parent) break;
      current = parent;
    }
    return verified;
  }

  private async verifyIndexedEntry(
    entry: StoredEntry,
    code: "conflict" | "corrupt",
  ): Promise<VerifiedEntry> {
    const verified = await this.verifyEntry(entry.root, code === "conflict" ? "corrupt" : code);
    if (!sameVersionReference(verified.reference, entry.reference)) {
      throw new WorldPackageStoreError("Canonical package index differs from its stored version.", code);
    }
    return verified;
  }

  private async verifyImmediateDependencies(
    verified: VerifiedEntry,
    verifyAssetLineages: boolean,
    code: "conflict" | "corrupt",
  ): Promise<VerifiedEntry | null> {
    const manifest = verified.manifest;
    let parent: VerifiedEntry | null = null;
    if (manifest.parent) {
      const parentEntry = this.entries.get(entryKeyOf(manifest.parent));
      if (!parentEntry || !sameVersionReference(parentEntry.reference, manifest.parent)) {
        throw new WorldPackageStoreError("Canonical package parent version is missing or differs.", code);
      }
      parent = await this.verifyIndexedEntry(parentEntry, code);
      if (!verified.delta || !manifest.applied_delta) {
        throw new WorldPackageStoreError("Canonical package child is missing its Delta.", code);
      }
      validateTransition(
        parent.manifest,
        verified.delta,
        manifest,
        parent.reference.manifest_sha256,
        manifest.applied_delta.manifest.sha256,
        code,
      );
    } else if (verified.delta) {
      throw new WorldPackageStoreError("Canonical package root cannot contain an applied Delta.", code);
    }

    const expected = new Map<string, CanonicalContentReferenceV1>();
    for (const content of directManifestReferences(manifest)) addExpectedReference(expected, content, code);
    if (manifest.schema === CANONICAL_WORLD_SCHEMA) {
      for (const assetLink of manifest.assets) {
        if (assetLink.manifest.media_type !== "application/json") {
          throw new WorldPackageStoreError("Canonical Asset manifest references must use application/json.", code);
        }
        const assetEntry = this.entries.get(entryKeyOf(assetLink.revision));
        if (!assetEntry || !sameVersionReference(assetEntry.reference, assetLink.revision)) {
          throw new WorldPackageStoreError("Canonical World references a missing exact Asset version.", code);
        }
        const asset = await this.verifyIndexedEntry(assetEntry, code);
        if (verifyAssetLineages) {
          let currentAsset = asset;
          while (true) {
            const assetParent = await this.verifyImmediateDependencies(currentAsset, false, code);
            if (!assetParent) break;
            currentAsset = assetParent;
          }
        }
        addExpectedReference(expected, assetLink.manifest, code);
        for (const content of asset.referenceInventory) addExpectedReference(expected, content, code);
        const worldAssetManifest = await readPinnedFile(
          verified.root,
          `content/${assetLink.manifest.path}`,
          this.bounds.maxManifestBytes,
          "World Asset manifest copy",
          code === "conflict" ? "corrupt" : code,
        );
        const assetManifest = await readPinnedFile(
          asset.root,
          manifestFile,
          this.bounds.maxManifestBytes,
          "Stored Asset manifest",
          code === "conflict" ? "corrupt" : code,
        );
        if (!worldAssetManifest.bytes.equals(assetManifest.bytes)) {
          throw new WorldPackageStoreError("World Asset manifest copy differs from its exact stored Asset.", code);
        }
      }
    }
    assertInventoryEqual(expected, verified.referenceInventory, code);
    return parent;
  }

  private async parentForPublish(
    manifest: CanonicalWorldManifestV2 | CanonicalAssetManifestV1,
  ): Promise<VerifiedEntry | null> {
    if (!manifest.parent) return null;
    const parentEntry = this.entries.get(entryKeyOf(manifest.parent));
    if (!parentEntry || !sameVersionReference(parentEntry.reference, manifest.parent)) {
      throw new WorldPackageStoreError("Canonical package append requires its exact immediate parent.", "conflict");
    }
    return this.verifyGraph(parentEntry, "conflict");
  }

  private async addWorldAssetClosure(
    manifest: CanonicalWorldManifestV2,
    plans: Map<string, PlannedReference>,
  ): Promise<void> {
    for (const assetLink of manifest.assets) {
      if (assetLink.manifest.media_type !== "application/json") {
        throw new WorldPackageStoreError("Canonical Asset manifest references must use application/json.", "conflict");
      }
      const assetEntry = this.entries.get(entryKeyOf(assetLink.revision));
      if (!assetEntry || !sameVersionReference(assetEntry.reference, assetLink.revision)) {
        throw new WorldPackageStoreError("Canonical World requires its exact Asset version to be committed first.", "conflict");
      }
      const asset = await this.verifyGraph(assetEntry, "conflict");
      addPlannedReference(plans, assetLink.manifest, {
        root: asset.root,
        relativePath: manifestFile,
        code: "corrupt",
      });
      for (const content of asset.referenceInventory) {
        addPlannedReference(plans, content, {
          root: asset.root,
          relativePath: `content/${content.path}`,
          code: "corrupt",
        });
      }
    }
  }

  private sourceForReference(
    content: CanonicalContentReferenceV1,
    sourceRoot: string,
    parent: VerifiedEntry | null,
  ): ReferenceSource {
    const previous = parent?.referenceInventory.find((candidate) =>
      candidate.path === content.path && sameContentReference(candidate, content));
    return previous
      ? { root: parent!.root, relativePath: `content/${content.path}`, code: "corrupt" }
      : { root: sourceRoot, relativePath: content.path, code: "invalid" };
  }

  private async deltaForPublish(
    manifest: CanonicalWorldManifestV2 | CanonicalAssetManifestV1,
    plans: Map<string, PlannedReference>,
  ): Promise<CanonicalDeltaV1 | null> {
    if (!manifest.applied_delta) return null;
    const deltaReference = manifest.applied_delta.manifest;
    if (deltaReference.media_type !== "application/json") {
      throw new WorldPackageStoreError("Canonical Delta references must use application/json.", "conflict");
    }
    const plan = plans.get(deltaReference.path);
    if (!plan || !sameContentReference(plan.reference, deltaReference)) {
      throw new WorldPackageStoreError("Canonical Delta bytes are missing from the publication plan.", "conflict");
    }
    const deltaRead = await readPinnedFile(
      plan.source.root,
      plan.source.relativePath,
      this.bounds.maxManifestBytes,
      "Canonical Delta source",
      plan.source.code,
    );
    if (deltaRead.sizeBytes !== deltaReference.size_bytes || deltaRead.sha256 !== deltaReference.sha256) {
      throw new WorldPackageStoreError("Canonical Delta source differs from its declared identity.", plan.source.code);
    }
    const delta = parseDeltaBytes(deltaRead.bytes, plan.source.code);
    if (delta.delta_id !== manifest.applied_delta.delta_id) {
      throw new WorldPackageStoreError("Canonical Delta identity differs from the child manifest.", "conflict");
    }
    return delta;
  }

  private async readSourceManifest(input: CanonicalWorldPackageDirectoryInput): Promise<PinnedRead> {
    if (!input || typeof input.sourceRoot !== "string" || !path.isAbsolute(input.sourceRoot)) {
      throw new WorldPackageStoreError("Canonical package sourceRoot must be absolute.", "invalid");
    }
    const manifestPath = safePath(input.manifestPath, "Canonical package manifestPath", "invalid");
    return readPinnedFile(
      path.resolve(input.sourceRoot),
      manifestPath,
      this.bounds.maxManifestBytes,
      "Canonical package source manifest",
      "invalid",
    );
  }

  private async openTargetForPublish(
    target: string,
    expected: CanonicalVersionReferenceV1,
  ): Promise<VerifiedEntry> {
    if (!(await entryExists(target))) {
      throw new WorldPackageStoreError("Canonical package version publication collided.", "conflict");
    }
    const stored = await this.verifyEntry(target, "corrupt");
    if (!sameVersionReference(stored.reference, expected)) {
      throw new WorldPackageStoreError("Canonical package version already exists with different bytes.", "conflict");
    }
    const indexed = this.entries.get(entryKeyOf(expected));
    if (!indexed) this.entries.set(entryKeyOf(expected), { root: target, reference: stored.reference });
    return this.verifyGraph({ root: target, reference: stored.reference }, "corrupt");
  }

  private async openVersionUnlocked(reference: CanonicalVersionReferenceV1): Promise<VerifiedEntry> {
    const stored = this.entries.get(entryKeyOf(reference));
    if (!stored || !sameVersionReference(stored.reference, reference)) {
      throw new WorldPackageStoreError("The exact canonical package version was not found.", "not_found");
    }
    const verified = await this.verifyGraph(stored, "corrupt");
    if (!sameVersionReference(verified.reference, reference)) {
      throw new WorldPackageStoreError("The exact canonical package version was not found.", "not_found");
    }
    return verified;
  }

  private async assertNoCaseFoldIdConflict(kind: CanonicalRevisionKind, id: string): Promise<void> {
    for (const entry of await readdir(this.kindRoot(kind), { withFileTypes: true })) {
      if (entry.name.toLowerCase() === id.toLowerCase() && entry.name !== id) {
        throw new WorldPackageStoreError("Canonical package ID collides by case with an existing record.", "conflict");
      }
    }
  }

  private async assertLineageDirectories(kind: CanonicalRevisionKind, id: string): Promise<void> {
    const kindRoot = this.kindRoot(kind);
    const idRoot = path.join(kindRoot, id);
    await assertRealDirectory(idRoot, "Canonical package record directory", "conflict");
    await assertExactNames(idRoot, new Set(["versions"]), "Canonical package record directory");
    await assertRealDirectory(path.join(idRoot, "versions"), "Canonical package versions directory", "conflict");
  }

  private kindRoot(kind: CanonicalRevisionKind): string {
    return this.internalPath(kind === "world" ? "worlds" : "assets");
  }

  private revisionRoot(kind: CanonicalRevisionKind, id: string, version: number): string {
    return path.join(this.kindRoot(kind), id, "versions", versionDirectoryName(version));
  }

  private internalPath(relativePath: string): string {
    return path.join(this.root, ...relativePath.split("/"));
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.operation;
    let release = (): void => {};
    this.operation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await operation();
    } catch (error) {
      throw asStoreError(error, "invalid", "Canonical package publication failed.");
    } finally {
      release();
    }
  }

  private async withStoreOperation<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await assertRealDirectory(this.root, "Canonical package store root", "corrupt");
    const canonicalRoot = await realpath(this.root);
    return serializeRootOperation(canonicalRoot, async () => {
      await assertRealDirectory(this.root, "Canonical package store root", "corrupt");
      if (await realpath(this.root) !== canonicalRoot) {
        throw new WorldPackageStoreError("Canonical package store root changed while awaiting ownership.", "corrupt");
      }
      return operation();
    });
  }
}

async function serializeRootOperation<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const prior = rootOperationTails.get(root) ?? Promise.resolve();
  let release = (): void => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  rootOperationTails.set(root, current);
  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (rootOperationTails.get(root) === current) rootOperationTails.delete(root);
  }
}

function incomingOwnerName(): string {
  return `${process.pid}.${processIdentity}.${randomUUID()}`;
}

function decodeIncomingOwner(name: string): { pid: number; processIdentity: string } {
  const match = incomingOwnerPattern.exec(name);
  const pid = match ? Number(match[1]) : Number.NaN;
  if (!match || !Number.isSafeInteger(pid) || pid < 1) {
    throw new WorldPackageStoreError("Canonical package staging owner name is invalid.", "corrupt");
  }
  return { pid, processIdentity: match[2]! };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

function parseRevisionManifest(
  bytes: Buffer,
  code: "invalid" | "corrupt",
): CanonicalWorldManifestV2 | CanonicalAssetManifestV1 {
  const value = parseStrictJson(bytes, "Canonical package manifest", code);
  const schema = isRecord(value) ? value.schema : undefined;
  try {
    if (schema === CANONICAL_WORLD_SCHEMA || schema === "world_studio.world.v0.1") {
      return validateCanonicalWorldManifest(value);
    }
    if (schema === CANONICAL_ASSET_SCHEMA) return validateCanonicalAssetManifest(value);
  } catch (error) {
    throw asStoreError(error, code, "Canonical package manifest failed validation.");
  }
  throw new WorldPackageStoreError("Canonical package manifest schema is unsupported.", code);
}

function parseDeltaBytes(bytes: Buffer, code: "invalid" | "corrupt"): CanonicalDeltaV1 {
  try {
    return validateCanonicalDelta(parseStrictJson(bytes, "Canonical Delta", code));
  } catch (error) {
    throw asStoreError(error, code, "Canonical Delta failed validation.");
  }
}

function parseStrictJson(bytes: Buffer, label: string, code: "invalid" | "corrupt"): unknown {
  let text: string;
  try {
    text = fatalUtf8Decoder.decode(bytes);
  } catch {
    throw new WorldPackageStoreError(`${label} must be valid UTF-8.`, code);
  }
  try {
    return parseCanonicalGraphJson(text);
  } catch (error) {
    throw asStoreError(error, code, `${label} must be strict JSON.`);
  }
}

function versionReference(
  manifest: CanonicalWorldManifestV2 | CanonicalAssetManifestV1,
  manifestSha256: string,
): CanonicalVersionReferenceV1 {
  return {
    kind: manifest.schema === CANONICAL_WORLD_SCHEMA ? "world" : "asset",
    id: manifest.schema === CANONICAL_WORLD_SCHEMA ? manifest.world_id : manifest.asset_id,
    version_id: manifest.version_id,
    version: manifest.version,
    manifest_sha256: manifestSha256,
  };
}

function directManifestReferences(
  manifest: CanonicalWorldManifestV2 | CanonicalAssetManifestV1,
): CanonicalContentReferenceV1[] {
  const references: CanonicalContentReferenceV1[] = manifest.artifacts.map((artifact) => artifact.content);
  for (const lane of Object.values(manifest.readiness)) {
    if (lane.report) references.push(lane.report);
  }
  if (manifest.applied_delta) references.push(manifest.applied_delta.manifest);
  if (manifest.schema === CANONICAL_WORLD_SCHEMA) {
    references.push(...manifest.capture_evidence.map((capture) => capture.manifest));
    references.push(...manifest.assets.map((asset) => asset.manifest));
  }
  return references;
}

function addPlannedReference(
  plans: Map<string, PlannedReference>,
  reference: CanonicalContentReferenceV1,
  source: ReferenceSource,
): void {
  const safe = validateContentReferenceShape(reference, "conflict");
  const existing = plans.get(safe.path);
  if (existing) {
    if (!sameContentReference(existing.reference, safe)) {
      throw new WorldPackageStoreError("Canonical package path has conflicting content identities.", "conflict");
    }
    return;
  }
  plans.set(safe.path, { reference: safe, source });
}

function addExpectedReference(
  references: Map<string, CanonicalContentReferenceV1>,
  reference: CanonicalContentReferenceV1,
  code: "conflict" | "corrupt",
): void {
  const safe = validateContentReferenceShape(reference, code);
  const existing = references.get(safe.path);
  if (existing && !sameContentReference(existing, safe)) {
    throw new WorldPackageStoreError("Canonical package path has conflicting content identities.", code);
  }
  references.set(safe.path, safe);
}

function validateReferenceInventory(
  inventoryValue: CanonicalContentReferenceV1[],
  bounds: RequiredStoreBounds,
  manifestBytes: number,
  code: WorldPackageStoreErrorCode,
): void {
  if (inventoryValue.length > bounds.maxReferencedFiles) {
    throw new WorldPackageStoreError("Canonical package reference count exceeds its configured bound.", "limit");
  }
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  let total = manifestBytes;
  for (const value of inventoryValue) {
    const reference = validateContentReferenceShape(value, code);
    if (reference.size_bytes > bounds.maxReferencedFileBytes) {
      throw new WorldPackageStoreError("Canonical package referenced file exceeds its configured bound.", "limit");
    }
    total = safeAdd(total, reference.size_bytes, "Canonical package revision bytes");
    if (total > bounds.maxRevisionBytes) {
      throw new WorldPackageStoreError("Canonical package revision exceeds its configured byte bound.", "limit");
    }
    if (exact.has(reference.path)) {
      throw new WorldPackageStoreError("Canonical package inventory contains a duplicate path.", code);
    }
    exact.add(reference.path);
    const caseFolded = reference.path.toLowerCase();
    const prior = folded.get(caseFolded);
    if (prior && prior !== reference.path) {
      throw new WorldPackageStoreError("Canonical package paths collide by case.", code);
    }
    folded.set(caseFolded, reference.path);
  }
  const paths = [...folded.keys()].sort(compareText);
  for (let index = 1; index < paths.length; index += 1) {
    if (paths[index]!.startsWith(`${paths[index - 1]}/`)) {
      throw new WorldPackageStoreError("Canonical package file paths overlap a directory path.", code);
    }
  }
  collectContentDirectories(inventoryValue, bounds, code);
}

function collectContentDirectories(
  inventory: CanonicalContentReferenceV1[],
  bounds: RequiredStoreBounds,
  code: WorldPackageStoreErrorCode,
): Set<string> {
  const directories = new Set<string>();
  for (const reference of inventory) {
    const parts = reference.path.split("/");
    let prefix = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      prefix = prefix ? `${prefix}/${parts[index]}` : parts[index]!;
      directories.add(prefix);
      if (directories.size > bounds.maxContentDirectories) {
        throw new WorldPackageStoreError(
          "Canonical package content directories exceed their configured bound.",
          "limit",
        );
      }
    }
  }
  return directories;
}

function validateContentReferenceShape(
  value: CanonicalContentReferenceV1,
  code: WorldPackageStoreErrorCode,
): CanonicalContentReferenceV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "sha256", "size_bytes", "media_type"])) {
    throw new WorldPackageStoreError("Canonical content reference has unexpected fields.", code);
  }
  const safePathValue = safePath(value.path, "Canonical content path", code);
  let sha256: string;
  try {
    sha256 = validateCanonicalSha256(value.sha256, "Canonical content SHA-256");
  } catch (error) {
    throw asStoreError(error, code, "Canonical content SHA-256 is invalid.");
  }
  if (!Number.isSafeInteger(value.size_bytes) || Number(value.size_bytes) < 0) {
    throw new WorldPackageStoreError("Canonical content size is invalid.", code);
  }
  if (typeof value.media_type !== "string" || !mediaTypePattern.test(value.media_type)) {
    throw new WorldPackageStoreError("Canonical content media type is invalid.", code);
  }
  return {
    path: safePathValue,
    sha256,
    size_bytes: Number(value.size_bytes),
    media_type: value.media_type,
  };
}

function decodeCommit(
  bytes: Buffer,
  bounds: RequiredStoreBounds,
  code: "invalid" | "corrupt",
): StoredCommit {
  const value = parseStrictJson(bytes, "Canonical package commit marker", code);
  if (!isRecord(value) || !hasExactKeys(value, [
    "schema", "reference", "manifest", "reference_inventory", "committed_at",
  ])) {
    throw new WorldPackageStoreError("Canonical package commit marker has unexpected fields.", code);
  }
  if (value.schema !== storeEntrySchema || !Array.isArray(value.reference_inventory)) {
    throw new WorldPackageStoreError("Canonical package commit marker is invalid.", code);
  }
  const reference = validateVersionReferenceInput(value.reference, code);
  const manifest = validateContentReferenceShape(value.manifest as CanonicalContentReferenceV1, code);
  const inventory = value.reference_inventory.map((entry) =>
    validateContentReferenceShape(entry as CanonicalContentReferenceV1, code));
  validateReferenceInventory(inventory, bounds, manifest.size_bytes, code);
  const sorted = [...inventory].sort((left, right) => compareText(left.path, right.path));
  if (stableCanonicalJson(inventory) !== stableCanonicalJson(sorted)) {
    throw new WorldPackageStoreError("Canonical package reference inventory must be sorted.", code);
  }
  try {
    validateCanonicalTimestamp(value.committed_at, "Canonical package committed_at");
  } catch (error) {
    throw asStoreError(error, code, "Canonical package committed_at is invalid.");
  }
  return {
    schema: storeEntrySchema,
    reference,
    manifest,
    reference_inventory: inventory,
    committed_at: value.committed_at as string,
  };
}

function encodeCommit(commit: StoredCommit, bounds: RequiredStoreBounds): Buffer {
  const prefix = `{"schema":${JSON.stringify(commit.schema)},"reference":${JSON.stringify(commit.reference)},`
    + `"manifest":${JSON.stringify(commit.manifest)},"reference_inventory":[`;
  const suffix = `],"committed_at":${JSON.stringify(commit.committed_at)}}\n`;
  let sizeBytes = safeAdd(Buffer.byteLength(prefix), Buffer.byteLength(suffix), "Canonical package commit bytes");
  const entries: string[] = [];
  for (let index = 0; index < commit.reference_inventory.length; index += 1) {
    const encoded = JSON.stringify(commit.reference_inventory[index]);
    sizeBytes = safeAdd(sizeBytes, Buffer.byteLength(encoded), "Canonical package commit bytes");
    if (index > 0) sizeBytes = safeAdd(sizeBytes, 1, "Canonical package commit bytes");
    if (sizeBytes > bounds.maxManifestBytes) {
      throw new WorldPackageStoreError("Canonical package commit index exceeds its configured byte bound.", "limit");
    }
    entries.push(encoded);
  }
  if (sizeBytes > bounds.maxManifestBytes) {
    throw new WorldPackageStoreError("Canonical package commit index exceeds its configured byte bound.", "limit");
  }
  const bytes = Buffer.from(`${prefix}${entries.join(",")}${suffix}`, "utf8");
  if (bytes.byteLength !== sizeBytes) {
    throw new WorldPackageStoreError("Canonical package commit index size accounting failed.", "invalid");
  }
  return bytes;
}

function validateVersionReferenceInput(
  value: unknown,
  code: WorldPackageStoreErrorCode = "invalid",
): CanonicalVersionReferenceV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "id", "version_id", "version", "manifest_sha256"])) {
    throw new WorldPackageStoreError("Canonical version reference has unexpected fields.", code);
  }
  if (value.kind !== "world" && value.kind !== "asset") {
    throw new WorldPackageStoreError("Canonical version reference kind is invalid.", code);
  }
  if (typeof value.id !== "string" || !identifierPattern.test(value.id)
    || typeof value.version_id !== "string" || !identifierPattern.test(value.version_id)) {
    throw new WorldPackageStoreError("Canonical version reference identity is invalid.", code);
  }
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1 || Number(value.version) > 2_147_483_647) {
    throw new WorldPackageStoreError("Canonical version reference number is invalid.", code);
  }
  let manifestSha256: string;
  try {
    manifestSha256 = validateCanonicalSha256(value.manifest_sha256, "Canonical manifest SHA-256");
  } catch (error) {
    throw asStoreError(error, code, "Canonical manifest SHA-256 is invalid.");
  }
  return {
    kind: value.kind,
    id: value.id,
    version_id: value.version_id,
    version: Number(value.version),
    manifest_sha256: manifestSha256,
  };
}

async function readStoredDelta(
  revisionRoot: string,
  manifest: CanonicalWorldManifestV2 | CanonicalAssetManifestV1,
  bounds: RequiredStoreBounds,
  code: "invalid" | "corrupt",
): Promise<CanonicalDeltaV1 | null> {
  if (!manifest.applied_delta) return null;
  const reference = manifest.applied_delta.manifest;
  if (reference.media_type !== "application/json") {
    throw new WorldPackageStoreError("Canonical Delta references must use application/json.", code);
  }
  const read = await readPinnedFile(
    revisionRoot,
    `content/${reference.path}`,
    Math.min(bounds.maxManifestBytes, bounds.maxReferencedFileBytes),
    "Stored Canonical Delta",
    code,
  );
  if (read.sizeBytes !== reference.size_bytes || read.sha256 !== reference.sha256) {
    throw new WorldPackageStoreError("Stored Canonical Delta differs from its content reference.", code);
  }
  const delta = parseDeltaBytes(read.bytes, code);
  if (delta.delta_id !== manifest.applied_delta.delta_id) {
    throw new WorldPackageStoreError("Stored Canonical Delta identity differs from its manifest.", code);
  }
  return delta;
}

function validateTransition(
  parent: CanonicalWorldManifestV2 | CanonicalAssetManifestV1,
  delta: CanonicalDeltaV1,
  result: CanonicalWorldManifestV2 | CanonicalAssetManifestV1,
  parentSha256: string,
  deltaSha256: string,
  code: "conflict" | "corrupt",
): void {
  try {
    validateCanonicalTransitionBinding(parent, delta, result, {
      parent_manifest_sha256: parentSha256,
      delta_manifest_sha256: deltaSha256,
    });
  } catch (error) {
    throw asStoreError(error, code, "Canonical package transition binding failed.");
  }
}

function assertInventoryEqual(
  expected: Map<string, CanonicalContentReferenceV1>,
  actual: CanonicalContentReferenceV1[],
  code: "conflict" | "corrupt",
): void {
  if (expected.size !== actual.length) {
    throw new WorldPackageStoreError("Canonical package stored inventory differs from its manifest closure.", code);
  }
  for (const reference of actual) {
    const expectedReference = expected.get(reference.path);
    if (!expectedReference || !sameContentReference(expectedReference, reference)) {
      throw new WorldPackageStoreError("Canonical package stored inventory differs from its manifest closure.", code);
    }
  }
}

async function copyPinnedReference(
  stagingRoot: string,
  plan: PlannedReference,
  bounds: RequiredStoreBounds,
): Promise<void> {
  const reference = plan.reference;
  if (reference.size_bytes > bounds.maxReferencedFileBytes) {
    throw new WorldPackageStoreError("Canonical package referenced file exceeds its configured bound.", "limit");
  }
  const sourcePath = internalFilePath(plan.source.root, plan.source.relativePath, plan.source.code);
  await assertRealParentChain(plan.source.root, plan.source.relativePath, "Referenced source parent", plan.source.code);
  const source = await openNoFollow(sourcePath, constants.O_RDONLY | constants.O_NONBLOCK, "Referenced source", plan.source.code);
  const destinationPath = internalFilePath(stagingRoot, `content/${reference.path}`, "invalid");
  await ensureDestinationParent(stagingRoot, `content/${reference.path}`);
  const temporaryPath = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${randomUUID()}.tmp`);
  let destination: FileHandle | null = null;
  let published = false;
  try {
    const before = await assertPinnedRegularFile(source, "Referenced source", plan.source.code);
    if (before.size !== reference.size_bytes) {
      throw new WorldPackageStoreError("Referenced source size differs from its manifest.", plan.source.code);
    }
    destination = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(copyBufferBytes, Math.max(1, before.size)));
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.byteLength, before.size - offset), offset);
      if (!bytesRead) throw new WorldPackageStoreError("Referenced source was truncated during copy.", plan.source.code);
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(chunk, written, bytesRead - written, offset + written);
        if (!result.bytesWritten) throw new WorldPackageStoreError("Canonical package copy made no progress.", "invalid");
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    const after = await assertPinnedRegularFile(source, "Referenced source", plan.source.code);
    assertSameStats(before, after, "Referenced source changed during copy.", plan.source.code);
    await assertRealParentChain(plan.source.root, plan.source.relativePath, "Referenced source parent", plan.source.code);
    const actualSha256 = `sha256:${digest.digest("hex")}`;
    if (actualSha256 !== reference.sha256) {
      throw new WorldPackageStoreError("Referenced source SHA-256 differs from its manifest.", plan.source.code);
    }
    await destination.sync();
    const destinationBefore = await assertPinnedRegularFile(destination, "Staged referenced file", "invalid");
    if (destinationBefore.size !== before.size) {
      throw new WorldPackageStoreError("Staged referenced file size differs after copy.", "invalid");
    }
    await destination.close();
    destination = null;
    await rename(temporaryPath, destinationPath);
    published = true;
    await syncDirectory(path.dirname(destinationPath));
    await verifyStoredReference(stagingRoot, reference, bounds, "invalid");
  } finally {
    await source.close();
    if (destination) await destination.close();
    await rm(temporaryPath, { force: true });
    if (!published) await rm(destinationPath, { force: true });
  }
}

async function verifyStoredReference(
  revisionRoot: string,
  reference: CanonicalContentReferenceV1,
  bounds: RequiredStoreBounds,
  code: "invalid" | "corrupt",
): Promise<void> {
  const maxBytes = reference.media_type === "application/json"
    ? Math.min(bounds.maxManifestBytes, bounds.maxReferencedFileBytes)
    : bounds.maxReferencedFileBytes;
  if (reference.size_bytes > maxBytes) {
    throw new WorldPackageStoreError(
      reference.media_type === "application/json"
        ? "Canonical JSON reference exceeds the configured manifest bound."
        : "Canonical reference exceeds the configured file bound.",
      "limit",
    );
  }
  const relativePath = `content/${reference.path}`;
  if (reference.media_type === "application/json") {
    const read = await readPinnedFile(
      revisionRoot,
      relativePath,
      maxBytes,
      "Stored referenced JSON",
      code,
    );
    if (read.sizeBytes !== reference.size_bytes || read.sha256 !== reference.sha256) {
      throw new WorldPackageStoreError("Stored referenced file differs from its committed identity.", code);
    }
    validateMediaBytes(read.bytes, reference, code);
    return;
  }
  const hashed = await hashPinnedFile(
    revisionRoot,
    relativePath,
    maxBytes,
    "Stored referenced file",
    code,
  );
  if (hashed.sizeBytes !== reference.size_bytes || hashed.sha256 !== reference.sha256) {
    throw new WorldPackageStoreError("Stored referenced file differs from its committed identity.", code);
  }
  validateMediaHeader(hashed.header, hashed.sizeBytes, reference, code);
}

function validateMediaBytes(
  bytes: Buffer,
  reference: CanonicalContentReferenceV1,
  code: "invalid" | "corrupt",
): void {
  if (reference.media_type === "application/json") {
    parseStrictJson(bytes, `Canonical JSON reference ${reference.path}`, code);
    return;
  }
  validateMediaHeader(bytes.subarray(0, 12), bytes.byteLength, reference, code);
}

function validateMediaHeader(
  header: Buffer,
  sizeBytes: number,
  reference: CanonicalContentReferenceV1,
  code: "invalid" | "corrupt",
): void {
  if (reference.media_type !== "model/gltf-binary") return;
  if (
    sizeBytes < 12
    || header.byteLength < 12
    || header.subarray(0, 4).toString("ascii") !== "glTF"
    || header.readUInt32LE(4) !== 2
    || header.readUInt32LE(8) !== sizeBytes
  ) {
    throw new WorldPackageStoreError("Canonical GLB reference has an invalid header or declared length.", code);
  }
}

async function hashPinnedFile(
  root: string,
  relativePath: string,
  maxBytes: number,
  label: string,
  code: "invalid" | "corrupt",
): Promise<PinnedHash> {
  positiveBound(maxBytes, "maxBytes");
  const filePath = internalFilePath(root, relativePath, code);
  try {
    await assertRealParentChain(root, relativePath, `${label} parent`, code);
    const file = await openNoFollow(filePath, constants.O_RDONLY | constants.O_NONBLOCK, label, code);
    try {
      const before = await assertPinnedRegularFile(file, label, code);
      if (before.size > maxBytes) throw new WorldPackageStoreError(`${label} exceeds its byte bound.`, "limit");
      const digest = createHash("sha256");
      const header = Buffer.alloc(Math.min(12, before.size));
      const buffer = Buffer.allocUnsafe(Math.min(copyBufferBytes, Math.max(1, before.size)));
      let offset = 0;
      while (offset < before.size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.byteLength, before.size - offset), offset);
        if (!bytesRead) throw new WorldPackageStoreError(`${label} ended before its declared size.`, code);
        const chunk = buffer.subarray(0, bytesRead);
        digest.update(chunk);
        if (offset < header.byteLength) {
          chunk.copy(header, offset, 0, Math.min(bytesRead, header.byteLength - offset));
        }
        offset += bytesRead;
      }
      const after = await assertPinnedRegularFile(file, label, code);
      assertSameStats(before, after, `${label} changed while being hashed.`, code);
      await assertRealParentChain(root, relativePath, `${label} parent`, code);
      return {
        header,
        sha256: `sha256:${digest.digest("hex")}`,
        sizeBytes: before.size,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    throw asStoreError(error, code, `${label} could not be hashed safely.`);
  }
}

async function readPinnedFile(
  root: string,
  relativePath: string,
  maxBytes: number,
  label: string,
  code: "invalid" | "corrupt",
): Promise<PinnedRead> {
  positiveBound(maxBytes, "maxBytes");
  const filePath = internalFilePath(root, relativePath, code);
  try {
    await assertRealParentChain(root, relativePath, `${label} parent`, code);
    const file = await openNoFollow(filePath, constants.O_RDONLY | constants.O_NONBLOCK, label, code);
    try {
      const before = await assertPinnedRegularFile(file, label, code);
      if (before.size > maxBytes) throw new WorldPackageStoreError(`${label} exceeds its byte bound.`, "limit");
      const bytes = Buffer.allocUnsafe(before.size);
      const digest = createHash("sha256");
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesRead } = await file.read(bytes, offset, Math.min(copyBufferBytes, bytes.byteLength - offset), offset);
        if (!bytesRead) throw new WorldPackageStoreError(`${label} ended before its declared size.`, code);
        digest.update(bytes.subarray(offset, offset + bytesRead));
        offset += bytesRead;
      }
      const after = await assertPinnedRegularFile(file, label, code);
      assertSameStats(before, after, `${label} changed while being read.`, code);
      await assertRealParentChain(root, relativePath, `${label} parent`, code);
      return {
        bytes,
        sha256: `sha256:${digest.digest("hex")}`,
        sizeBytes: before.size,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    throw asStoreError(error, code, `${label} could not be read safely.`);
  }
}

async function writeAtomicBytes(filePath: string, bytes: Buffer, expectedSha256?: string): Promise<void> {
  const directory = path.dirname(filePath);
  await assertRealDirectory(directory, "Canonical package destination parent", "invalid");
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let file: FileHandle | null = null;
  try {
    file = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await file.writeFile(bytes);
    await file.sync();
    const before = await assertPinnedRegularFile(file, "Canonical package destination", "invalid");
    if (before.size !== bytes.byteLength) {
      throw new WorldPackageStoreError("Canonical package destination size differs after write.", "invalid");
    }
    await file.close();
    file = null;
    await rename(temporaryPath, filePath);
    await syncDirectory(directory);
    const read = await readPinnedFile(
      path.dirname(directory),
      `${path.basename(directory)}/${path.basename(filePath)}`,
      Math.max(1, bytes.byteLength),
      "Canonical package destination",
      "invalid",
    );
    const expected = expectedSha256 ?? `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (read.sha256 !== expected || !read.bytes.equals(bytes)) {
      throw new WorldPackageStoreError("Canonical package destination changed during publication.", "invalid");
    }
  } finally {
    if (file) await file.close();
    await rm(temporaryPath, { force: true });
  }
}

async function assertExactContentTree(
  contentRoot: string,
  inventory: CanonicalContentReferenceV1[],
  bounds: RequiredStoreBounds,
  code: "invalid" | "corrupt",
): Promise<void> {
  const expected = new Set(inventory.map((entry) => entry.path));
  const expectedDirectories = collectContentDirectories(inventory, bounds, code);
  const found = new Set<string>();
  let directoryCount = 0;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    await assertRealDirectory(directory, "Canonical package content directory", code);
    const entries = await readdir(directory, { withFileTypes: true });
    if (prefix && entries.length === 0) {
      throw new WorldPackageStoreError("Canonical package content contains an undeclared empty directory.", code);
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      safePath(relative, "Stored canonical content path", code);
      const entryPath = path.join(directory, entry.name);
      const info = await lstat(entryPath);
      if (info.isSymbolicLink()) {
        throw new WorldPackageStoreError("Canonical package content contains a symbolic link.", code);
      }
      if (info.isDirectory()) {
        if (!expectedDirectories.has(relative)) {
          throw new WorldPackageStoreError("Canonical package content contains an undeclared directory.", code);
        }
        directoryCount += 1;
        if (directoryCount > bounds.maxContentDirectories) {
          throw new WorldPackageStoreError("Canonical package content has too many directories.", "limit");
        }
        await visit(entryPath, relative);
      } else if (info.isFile()) {
        if (info.nlink !== 1) {
          throw new WorldPackageStoreError("Canonical package content contains a hard-linked file.", code);
        }
        if (!expected.has(relative)) {
          throw new WorldPackageStoreError("Canonical package content contains an undeclared file.", code);
        }
        found.add(relative);
      } else {
        throw new WorldPackageStoreError("Canonical package content contains a special file.", code);
      }
    }
  };
  await visit(contentRoot, "");
  if (found.size !== expected.size || [...expected].some((entry) => !found.has(entry))) {
    throw new WorldPackageStoreError("Canonical package content inventory is incomplete.", code);
  }
}

async function assertExactNames(
  directory: string,
  expected: Set<string>,
  label: string,
  allowMissing = false,
): Promise<void> {
  const actual = await readdir(directory);
  if (allowMissing && actual.length === 0) return;
  if (actual.length !== expected.size || actual.some((entry) => !expected.has(entry))) {
    throw new WorldPackageStoreError(`${label} contains unexpected entries.`, "corrupt");
  }
}

async function ensureFixedDirectory(
  parent: string,
  name: string,
  code: "conflict" | "corrupt",
): Promise<void> {
  await assertRealDirectory(parent, "Canonical package directory parent", code);
  const target = path.join(parent, name);
  try {
    await mkdir(target, { mode: 0o700 });
    await syncDirectory(parent);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  await assertRealDirectory(target, "Canonical package directory", code);
}

async function ensureDestinationParent(root: string, relativePath: string): Promise<void> {
  const safe = safePath(relativePath, "Canonical package destination path", "invalid");
  let current = root;
  for (const part of safe.split("/").slice(0, -1)) {
    const parent = current;
    current = path.join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
      await syncDirectory(parent);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertRealDirectory(current, "Canonical package destination directory", "invalid");
  }
}

async function assertRealParentChain(
  root: string,
  relativePath: string,
  label: string,
  code: "invalid" | "corrupt",
): Promise<void> {
  const safe = safePath(relativePath, label, code);
  await assertRealDirectory(root, `${label} root`, code);
  const canonicalRoot = await realpath(root);
  let current = root;
  let canonicalCurrent = canonicalRoot;
  for (const part of safe.split("/").slice(0, -1)) {
    current = path.join(current, part);
    canonicalCurrent = path.join(canonicalCurrent, part);
    await assertRealDirectory(current, label, code);
    if (await realpath(current) !== canonicalCurrent) {
      throw new WorldPackageStoreError(`${label} must not traverse a symbolic directory.`, code);
    }
  }
}

async function assertRealDirectory(
  directory: string,
  label: string,
  code: "invalid" | "conflict" | "corrupt",
): Promise<void> {
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new WorldPackageStoreError(`${label} must be a real directory.`, code);
    }
  } catch (error) {
    throw asStoreError(error, code, `${label} must be a real directory.`);
  }
}

async function openNoFollow(
  filePath: string,
  flags: number,
  label: string,
  code: "invalid" | "corrupt",
): Promise<FileHandle> {
  try {
    return await open(filePath, flags | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error, "ELOOP")) {
      throw new WorldPackageStoreError(`${label} must not be a symbolic link.`, code);
    }
    throw error;
  }
}

async function assertPinnedRegularFile(
  file: FileHandle,
  label: string,
  code: "invalid" | "corrupt",
): Promise<Stats> {
  const info = await file.stat();
  if (!info.isFile()) throw new WorldPackageStoreError(`${label} must be a regular file.`, code);
  if (info.nlink !== 1) throw new WorldPackageStoreError(`${label} must not be hard-linked.`, code);
  return info;
}

function assertSameStats(
  before: Stats,
  after: Stats,
  message: string,
  code: "invalid" | "corrupt",
): void {
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.mode !== after.mode
    || before.nlink !== after.nlink
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
  ) {
    throw new WorldPackageStoreError(message, code);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function internalFilePath(
  root: string,
  relativePath: string,
  code: WorldPackageStoreErrorCode,
): string {
  const safe = safePath(relativePath, "Canonical package file path", code);
  return path.join(root, ...safe.split("/"));
}

function safePath(value: unknown, label: string, code: WorldPackageStoreErrorCode): string {
  try {
    return safeCanonicalRelativePath(value, label);
  } catch (error) {
    throw asStoreError(error, code, `${label} is unsafe.`);
  }
}

function sameContentReference(
  left: CanonicalContentReferenceV1,
  right: CanonicalContentReferenceV1,
): boolean {
  return left.path === right.path
    && left.sha256 === right.sha256
    && left.size_bytes === right.size_bytes
    && left.media_type === right.media_type;
}

function sameVersionReference(
  left: CanonicalVersionReferenceV1,
  right: CanonicalVersionReferenceV1,
): boolean {
  return left.kind === right.kind
    && left.id === right.id
    && left.version_id === right.version_id
    && left.version === right.version
    && left.manifest_sha256 === right.manifest_sha256;
}

function publicVersion(value: VerifiedEntry): CanonicalStoredWorldPackageVersion {
  return {
    reference: structuredClone(value.reference),
    manifest: structuredClone(value.manifest),
    manifestBytes: Buffer.from(value.manifestBytes),
    manifestSizeBytes: value.manifestSizeBytes,
    delta: value.delta ? structuredClone(value.delta) : null,
    referenceInventory: value.referenceInventory.map(cloneContentReference),
  };
}

function cloneContentReference(value: CanonicalContentReferenceV1): CanonicalContentReferenceV1 {
  return { ...value };
}

function entryKeyOf(reference: Pick<CanonicalVersionReferenceV1, "kind" | "id" | "version">): string {
  return entryKey(reference.kind, reference.id, reference.version);
}

function entryKey(kind: CanonicalRevisionKind, id: string, version: number): string {
  return `${kind}:${id}:${version}`;
}

function versionDirectoryName(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new WorldPackageStoreError("Canonical package version is outside the storage bound.", "invalid");
  }
  return version.toString().padStart(10, "0");
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorldPackageStoreError(`${label} must be a positive safe integer.`, "invalid");
  }
  return value;
}

function safeAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new WorldPackageStoreError(`${label} exceed the safe integer bound.`, "limit");
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareText);
  const sorted = [...expected].sort(compareText);
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
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

function isNodeError(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && (value as NodeJS.ErrnoException).code === code;
}

function asStoreError(
  error: unknown,
  code: WorldPackageStoreErrorCode,
  fallback: string,
): WorldPackageStoreError {
  if (error instanceof WorldPackageStoreError) return error;
  const message = error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback;
  return new WorldPackageStoreError(message, code);
}
