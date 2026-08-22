import {
  validateCaptureSplatConsumerReceipt,
  type CaptureSplatConsumerIssueCode,
  type CaptureSplatConsumerReceiptV1,
} from "@world-studio/world-core";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

const manifestPath = "capture-splat.world-studio.json";
const maxJsonBytes = 64 * 1024 ** 2;
const maxFileBytes = Math.floor(1.5 * 1024 ** 3);
const maxTotalBytes = 2 * 1024 ** 4;
const maxFrames = 100_000;
const maxReferences = 200_000;
const maxIssues = 64;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const emptySha256 = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const captureFramePathKeys = ["rgb", "image", "image_path", "file_path", "depth", "confidence", "person_mask", "valid_mask", "object_mask"] as const;

interface FileReference {
  path: string;
  sizeBytes: number;
  checksum: string;
}

interface HashedFile {
  path: string;
  sizeBytes: number;
  checksum: string;
  identity: string;
  ancestorIdentities: ReadonlyMap<string, string>;
  bytes?: Buffer;
  stable: boolean;
}

interface ReceiptIssue {
  code: CaptureSplatConsumerIssueCode;
  artifact?: string;
  message: string;
}

export interface CaptureSplatConsumerVerification {
  receipt: CaptureSplatConsumerReceiptV1;
  manifest?: Record<string, unknown>;
  manifestText?: string;
  verifiedPaths: ReadonlySet<string>;
  readVerifiedFile(relativePath: string, byteLimit: number): Promise<Buffer | undefined>;
  verifyVerifiedFile(relativePath: string, byteLimit: number): Promise<boolean>;
}

export async function verifyCaptureSplatConsumerPackage(root: string): Promise<CaptureSplatConsumerVerification> {
  const packageRoot = await realpath(root);
  const issues: ReceiptIssue[] = [];
  let issueCount = 0;
  const addIssue = (issue: ReceiptIssue) => {
    issueCount += 1;
    if (issues.length < maxIssues) issues.push(issue);
  };
  const hashed = new Map<string, HashedFile>();
  const hashAttempts = new Set<string>();
  const missing = new Set<string>();
  const mismatched = new Set<string>();
  const conflicts = new Set<string>();
  const symlinks = new Set<string>();
  const nonRegular = new Set<string>();
  const mutable = new Set<string>();
  const unreferenced = new Set<string>();
  const invalidActualPaths = new Set<string>();
  const unhashed = new Set<string>();
  const declarations = new Map<string, FileReference>();
  let declarationLimitReported = false;

  hashAttempts.add(manifestPath);
  const manifestHash = await hashFile(packageRoot, manifestPath, true, maxJsonBytes, addIssue, { symlinks, nonRegular, mutable });
  if (manifestHash) hashed.set(manifestPath, manifestHash);
  let manifest: Record<string, unknown> | undefined;
  let manifestText: string | undefined;
  if (manifestHash?.stable && manifestHash.bytes) {
    manifestText = decodeUtf8(manifestHash.bytes, manifestPath, "invalid_handoff_manifest", addIssue);
    manifest = manifestText === undefined ? undefined : parseJsonRecordText(manifestText, manifestPath, "invalid_handoff_manifest", addIssue);
    if (manifest?.schema !== "capture_splat.world_studio_handoff.v0.3") {
      addIssue({ code: "invalid_handoff_manifest", artifact: manifestPath, message: "Handoff schema must be capture_splat.world_studio_handoff.v0.3." });
      manifest = undefined;
    }
  }

  let sourceFrameCount = 0;
  let declaredReferenceCount = 0;
  let declaredUniqueAssetCount = 0;
  let declaredDuplicateReferenceCount = 0;
  let declaredVerifiedAssetCount = 0;
  let recomputedReferenceCount = 0;
  let recomputedUniqueAssetCount = 0;
  let recomputedDuplicateReferenceCount = 0;
  let inventorySchemaValid = false;

  const addDeclaration = (reference: FileReference) => {
    const existing = declarations.get(reference.path);
    if (!existing) {
      if (declarations.size >= maxReferences) {
        if (!declarationLimitReported) {
          declarationLimitReported = true;
          addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: `Package declarations exceed the ${maxReferences} reference limit.` });
        }
        return;
      }
      declarations.set(reference.path, reference);
      return;
    }
    if (existing.sizeBytes !== reference.sizeBytes || existing.checksum !== reference.checksum) {
      conflicts.add(reference.path);
      addIssue({ code: "conflicting_declaration", artifact: reference.path, message: "The package declares conflicting size or SHA-256 metadata for this path." });
    }
  };

  let inventoryReferences: FileReference[] = [];
  let captureReference: FileReference | undefined;
  if (manifest) {
    const sourceFrames = Array.isArray(manifest.source_frames) ? manifest.source_frames : undefined;
    const frames = Array.isArray(manifest.frames) ? manifest.frames : undefined;
    if (!sourceFrames || !frames || sourceFrames.length > maxFrames || frames.length > maxFrames) {
      addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: `source_frames and frames must be arrays containing at most ${maxFrames} entries.` });
    } else {
      sourceFrameCount = sourceFrames.length;
      if (canonicalJson(sourceFrames) !== canonicalJson(frames)) {
        addIssue({ code: "invalid_handoff_manifest", artifact: manifestPath, message: "source_frames and frames must be deeply identical." });
      }
      for (let index = 0; index < sourceFrames.length; index += 1) {
        const reference = parseReference(sourceFrames[index], "rgb_path", `source_frames[${index}]`, addIssue);
        if (reference) addDeclaration(reference);
      }
    }

    const assets = record(manifest.assets);
    if (!assets) {
      addIssue({ code: "invalid_handoff_manifest", artifact: manifestPath, message: "Handoff assets must be an object." });
    } else {
      for (const reference of collectAssetReferences(assets, addIssue)) addDeclaration(reference);
      captureReference = parseReference(assets.capture_manifest, "path", "assets.capture_manifest", addIssue);
    }

    const inventory = record(manifest.capture_manifest_assets);
    if (!inventory) {
      addIssue({ code: "invalid_capture_inventory", artifact: manifestPath, message: "capture_manifest_assets must be an object." });
    } else {
      inventorySchemaValid = inventory.schema === "capture_splat.capture_manifest_assets.v0.1"
        && inventory.verification === "source_destination_size_and_sha256";
      if (!inventorySchemaValid) {
        addIssue({ code: "invalid_capture_inventory", artifact: manifestPath, message: "Capture inventory schema and verification method are unsupported." });
      }
      declaredReferenceCount = safeCounter(inventory.reference_count, "reference_count", addIssue);
      declaredUniqueAssetCount = safeCounter(inventory.unique_asset_count, "unique_asset_count", addIssue);
      declaredDuplicateReferenceCount = safeCounter(inventory.duplicate_reference_count, "duplicate_reference_count", addIssue);
      declaredVerifiedAssetCount = safeCounter(inventory.verified_asset_count, "verified_asset_count", addIssue);
      const rawInventoryAssets = Array.isArray(inventory.assets) ? inventory.assets : [];
      if (!Array.isArray(inventory.assets) || rawInventoryAssets.length > maxReferences) {
        addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: `Capture inventory assets must contain at most ${maxReferences} entries.` });
      } else {
        inventoryReferences = rawInventoryAssets.flatMap((value, index) => {
          const reference = parseReference(value, "path", `capture_manifest_assets.assets[${index}]`, addIssue);
          return reference ? [reference] : [];
        });
        for (const reference of inventoryReferences) addDeclaration(reference);
      }
      validateInventoryCounters(inventory, inventoryReferences, {
        declaredReferenceCount,
        declaredUniqueAssetCount,
        declaredDuplicateReferenceCount,
        declaredVerifiedAssetCount,
        recomputedReferenceCount,
        recomputedUniqueAssetCount,
        recomputedDuplicateReferenceCount,
      }, addIssue);
    }
  }

  let capturePaths: string[] = [];
  if (captureReference) {
    hashAttempts.add(captureReference.path);
    const captureHash = await hashFile(packageRoot, captureReference.path, true, maxJsonBytes, addIssue, { symlinks, nonRegular, mutable });
    if (captureHash) hashed.set(captureReference.path, captureHash);
    if (captureHash && matchesReference(captureHash, captureReference) && captureHash.stable) {
      const capture = captureHash.bytes ? parseJsonRecord(captureHash.bytes, captureReference.path, "invalid_capture_manifest", addIssue) : undefined;
      if (capture) capturePaths = collectCapturePaths(capture, addIssue);
    } else if (captureHash) {
      mismatched.add(captureReference.path);
      addIssue({ code: "metadata_mismatch", artifact: captureReference.path, message: "Capture manifest bytes differ from the declared size or SHA-256." });
    }
  }
  recomputedReferenceCount = capturePaths.length;
  recomputedUniqueAssetCount = new Set(capturePaths).size;
  recomputedDuplicateReferenceCount = recomputedReferenceCount - recomputedUniqueAssetCount;
  const inventoryPaths = new Set(inventoryReferences.map((reference) => reference.path));
  if (!sameSet(new Set(capturePaths), inventoryPaths)) {
    addIssue({ code: "inventory_mismatch", artifact: manifestPath, message: "Capture-manifest file references and capture_manifest_assets.assets must have the same canonical path set." });
  }
  if (
    declaredReferenceCount !== recomputedReferenceCount
    || declaredUniqueAssetCount !== recomputedUniqueAssetCount
    || declaredDuplicateReferenceCount !== recomputedDuplicateReferenceCount
    || declaredVerifiedAssetCount !== recomputedUniqueAssetCount
  ) {
    addIssue({ code: "inventory_mismatch", artifact: manifestPath, message: "Capture-manifest raw reference counts do not reconcile with declared inventory counters." });
  }

  if (declarations.size > maxReferences) {
    addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: `Package declarations exceed the ${maxReferences} reference limit.` });
  }
  let declaredReferenceBytes = 0;
  for (const reference of declarations.values()) declaredReferenceBytes += reference.sizeBytes;
  if (declaredReferenceBytes > maxTotalBytes) {
    addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: "Declared package bytes exceed the 2 TiB verification limit." });
  }

  const references = [...declarations.values()].sort(compareReferences).slice(0, maxReferences);
  for (const reference of references) {
    if (conflicts.has(reference.path)) continue;
    if (reference.sizeBytes > maxFileBytes) {
      addIssue({ code: "bounds_exceeded", artifact: reference.path, message: "Declared file exceeds the 1.5 GiB per-file verification limit." });
      continue;
    }
    let result = hashed.get(reference.path);
    if (!result && !hashAttempts.has(reference.path)) {
      hashAttempts.add(reference.path);
      result = await hashFile(packageRoot, reference.path, false, maxFileBytes, addIssue, { symlinks, nonRegular, mutable });
      if (result) hashed.set(reference.path, result);
    }
    if (!result) {
      if (!hasPathOrAncestor(symlinks, reference.path) && !hasPathOrAncestor(nonRegular, reference.path) && !hasPathOrAncestor(mutable, reference.path) && !missing.has(reference.path)) {
        missing.add(reference.path);
        addIssue({ code: "missing_file", artifact: reference.path, message: "Declared package file is missing." });
      }
      continue;
    }
    if (!matchesReference(result, reference)) {
      if (!mismatched.has(reference.path)) {
        mismatched.add(reference.path);
        addIssue({ code: "metadata_mismatch", artifact: reference.path, message: "File bytes differ from the declared size or SHA-256." });
      }
      continue;
    }
  }

  const actualFiles = new Map<string, HashedFile>();
  const regularFiles = new Map<string, number>();
  await enumeratePackage(packageRoot, "", hashed, hashAttempts, actualFiles, regularFiles, addIssue, { invalidActualPaths, symlinks, nonRegular, mutable, unhashed });
  if (!actualFiles.has(manifestPath) && !symlinks.has(manifestPath) && !nonRegular.has(manifestPath)) {
    if (manifestHash) {
      if (!mutable.has(manifestPath)) {
        mutable.add(manifestPath);
        addIssue({ code: "mutable_file", artifact: manifestPath, message: "Handoff manifest changed or disappeared after content verification." });
      }
    } else if (!regularFiles.has(manifestPath) && !missing.has(manifestPath)) {
      missing.add(manifestPath);
      addIssue({ code: "missing_file", artifact: manifestPath, message: "The required handoff manifest is missing." });
    }
  }
  for (const relativePath of actualFiles.keys()) {
    if (relativePath !== manifestPath && !declarations.has(relativePath)) {
      unreferenced.add(relativePath);
      addIssue({ code: "unreferenced_file", artifact: relativePath, message: "Regular package file is not covered by a verified declaration." });
    }
  }
  for (const reference of declarations.values()) {
    if (!actualFiles.has(reference.path) && !hasPathOrAncestor(symlinks, reference.path) && !hasPathOrAncestor(nonRegular, reference.path)) {
      if (!missing.has(reference.path)) {
        missing.add(reference.path);
        addIssue({ code: "missing_file", artifact: reference.path, message: "Declared package file is missing." });
      }
    }
  }

  const treeEntries = [...actualFiles.values()].sort((left, right) => Buffer.compare(Buffer.from(left.path.normalize("NFC"), "utf8"), Buffer.from(right.path.normalize("NFC"), "utf8")));
  const treeComplete = !treeEntries.some((entry) => !entry.stable)
    && invalidActualPaths.size === 0
    && symlinks.size === 0
    && nonRegular.size === 0
    && mutable.size === 0
    && unhashed.size === 0
    && actualFiles.size === regularFiles.size;
  const treeDigest = createHash("sha256");
  const treeSizeBytes = [...regularFiles.values()].reduce((sum, sizeBytes) => sum + sizeBytes, 0);
  for (const entry of treeEntries) {
    treeDigest.update(entry.path.normalize("NFC"), "utf8");
    treeDigest.update("\0", "ascii");
    treeDigest.update(String(entry.sizeBytes), "ascii");
    treeDigest.update("\0", "ascii");
    treeDigest.update(entry.checksum, "ascii");
    treeDigest.update("\n", "ascii");
  }
  if (treeSizeBytes > maxTotalBytes + maxJsonBytes) {
    addIssue({ code: "bounds_exceeded", message: "Enumerated package bytes exceed the 2 TiB verification limit." });
  }

  const verifiedFiles = new Map<string, HashedFile>();
  const verifiedPaths = new Set<string>();
  const revokedPaths = new Set<string>();
  for (const [relativePath, file] of hashed) {
    const reference = declarations.get(relativePath);
    const actual = actualFiles.get(relativePath);
    if (
      (relativePath === manifestPath || reference !== undefined)
      && file.stable
      && actual?.identity === file.identity
      && !hasPathOrAncestor(symlinks, relativePath)
      && !hasPathOrAncestor(nonRegular, relativePath)
      && !hasPathOrAncestor(mutable, relativePath)
      && !conflicts.has(relativePath)
      && (relativePath === manifestPath || (reference !== undefined && matchesReference(file, reference)))
    ) {
      verifiedFiles.set(relativePath, file);
      verifiedPaths.add(relativePath);
    }
  }
  const receipt: CaptureSplatConsumerReceiptV1 = {
    schema: "world_studio.capture_splat_consumer_receipt.v0.1",
    consumer: { name: "world-studio", verifier: "capture-splat-package-v0.1" },
    handoff: {
      schema: "capture_splat.world_studio_handoff.v0.3",
      manifest: {
        path: manifestPath,
        size_bytes: manifestHash?.sizeBytes ?? 0,
        checksum: manifestHash?.checksum ?? emptySha256,
      },
    },
    inventory: {
      schema: "capture_splat.capture_manifest_assets.v0.1",
      verification: "source_destination_size_and_sha256",
      declared_reference_count: declaredReferenceCount,
      declared_unique_asset_count: declaredUniqueAssetCount,
      declared_duplicate_reference_count: declaredDuplicateReferenceCount,
      declared_verified_asset_count: declaredVerifiedAssetCount,
      recomputed_reference_count: recomputedReferenceCount,
      recomputed_unique_asset_count: recomputedUniqueAssetCount,
      recomputed_duplicate_reference_count: recomputedDuplicateReferenceCount,
    },
    closure: {
      source_frame_count: sourceFrameCount,
      declared_reference_file_count: declarations.size,
      declared_reference_bytes: declaredReferenceBytes,
      verified_reference_file_count: [...declarations.keys()].filter((relativePath) => verifiedPaths.has(relativePath) && !conflicts.has(relativePath)).length,
      missing_file_count: missing.size,
      metadata_mismatch_count: mismatched.size,
      conflicting_declaration_count: conflicts.size,
      unreferenced_file_count: unreferenced.size,
      symlink_count: symlinks.size,
      non_regular_file_count: nonRegular.size,
      mutable_file_count: mutable.size,
    },
    tree: {
      status: treeComplete ? "complete" : "incomplete",
      algorithm: "sha256_utf8_nfc_path_nul_size_nul_sha256_lf_v1",
      scope: "all_regular_files_under_package_root",
      file_count: regularFiles.size,
      size_bytes: treeSizeBytes,
      ...(treeComplete ? { checksum: `sha256:${treeDigest.digest("hex")}` } : {}),
      includes_handoff_manifest: true,
      includes_receipt: false,
    },
    verification: {
      content: "sha256_stream_1mib_stable_stat_v1",
      paths: "capture_splat_portable_relative_path_v1",
      references: "capture_splat_world_studio_handoff_v0.3_v1",
    },
    issue_count: issueCount,
    issues_truncated: issueCount > issues.length,
    issues,
    decision: issueCount === 0 ? "ready" : "hold",
    authority: "package_integrity_evidence_only",
    authenticity: "not_established",
  };
  if (!inventorySchemaValid && receipt.decision === "ready") receipt.decision = "hold";
  const verification: CaptureSplatConsumerVerification = {
    receipt: validateCaptureSplatConsumerReceipt(receipt),
    manifest,
    manifestText,
    verifiedPaths,
    async readVerifiedFile(relativePath, byteLimit) {
      return consumeVerifiedFile(packageRoot, relativePath, byteLimit, true, verifiedFiles, verifiedPaths, declarations, revokedPaths, verification);
    },
    async verifyVerifiedFile(relativePath, byteLimit) {
      return (await consumeVerifiedFile(packageRoot, relativePath, byteLimit, false, verifiedFiles, verifiedPaths, declarations, revokedPaths, verification)) !== undefined;
    },
  };
  return verification;
}

function collectAssetReferences(assets: Record<string, unknown>, addIssue: (issue: ReceiptIssue) => void): FileReference[] {
  const references: FileReference[] = [];
  const stack: Array<{ value: unknown; label: string; depth: number }> = [{ value: assets, label: "assets", depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop()!;
    visited += 1;
    if (current.depth > 64) {
      addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: "Handoff assets structure exceeds the 64-level traversal limit." });
      continue;
    }
    if (visited > 1_000_000) {
      addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: "Handoff assets structure exceeds the traversal limit." });
      break;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) stack.push({ value: current.value[index], label: `${current.label}[${index}]`, depth: current.depth + 1 });
      continue;
    }
    const value = record(current.value);
    if (!value) continue;
    const hasReferenceField = Object.hasOwn(value, "path") || Object.hasOwn(value, "size_bytes") || Object.hasOwn(value, "checksum");
    if (hasReferenceField) {
      const reference = parseReference(value, "path", current.label, addIssue);
      if (reference) references.push(reference);
      if (references.length > maxReferences) {
        addIssue({ code: "bounds_exceeded", artifact: manifestPath, message: `Handoff assets exceed the ${maxReferences} reference limit.` });
        break;
      }
      continue;
    }
    const entries = Object.entries(value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index]!;
      stack.push({ value: child, label: `${current.label}.${key}`, depth: current.depth + 1 });
    }
  }
  return references;
}

function collectCapturePaths(capture: Record<string, unknown>, addIssue: (issue: ReceiptIssue) => void): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(capture)) {
    if (!key.endsWith("_file")) continue;
    if (typeof value !== "string") {
      addIssue({ code: "invalid_capture_manifest", message: `Explicit capture.${key} must be a string path.` });
      continue;
    }
    addCapturePath(paths, value, `capture.${key}`, addIssue);
  }
  const frames = capture.frames === undefined ? [] : capture.frames;
  if (!Array.isArray(frames) || frames.length > maxFrames) {
    addIssue({ code: "invalid_capture_manifest", message: `Capture frames must be an array containing at most ${maxFrames} entries.` });
    return paths;
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = record(frames[index]);
    if (!frame) {
      addIssue({ code: "invalid_capture_manifest", message: `Capture frame ${index} must be an object.` });
      continue;
    }
    for (const key of captureFramePathKeys) {
      const value = frame[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== "string") {
        addIssue({ code: "invalid_capture_manifest", message: `Capture frame ${index} ${key} path must be a string.` });
        continue;
      }
      addCapturePath(paths, value, `capture.frames[${index}].${key}`, addIssue);
    }
  }
  return paths;
}

function addCapturePath(paths: string[], value: string, label: string, addIssue: (issue: ReceiptIssue) => void): void {
  if (!portablePath(value)) {
    addIssue({ code: "invalid_path", message: `${label} is not a canonical ASCII portable relative path.` });
    return;
  }
  paths.push(value);
}

function validateInventoryCounters(
  inventory: Record<string, unknown>,
  references: FileReference[],
  counters: Record<string, number>,
  addIssue: (issue: ReceiptIssue) => void,
): void {
  const copiedPaths = Array.isArray(inventory.copied_paths) ? inventory.copied_paths : [];
  const copied = safeCounter(inventory.copied, "copied", addIssue);
  const existing = safeCounter(inventory.existing, "existing", addIssue);
  const copiedSet = new Set<string>();
  for (const value of copiedPaths) {
    if (typeof value !== "string" || !portablePath(value)) {
      addIssue({ code: "invalid_capture_inventory", artifact: manifestPath, message: "copied_paths must contain canonical ASCII portable relative paths." });
      continue;
    }
    copiedSet.add(value);
  }
  const assetPaths = new Set(references.map((reference) => reference.path));
  const valid = inventory.complete === true
    && inventory.decision === "ready"
    && Array.isArray(inventory.missing) && inventory.missing.length === 0
    && Array.isArray(inventory.conflicts) && inventory.conflicts.length === 0
    && counters.declaredReferenceCount === references.length
    && counters.declaredUniqueAssetCount === assetPaths.size
    && counters.declaredDuplicateReferenceCount === references.length - assetPaths.size
    && counters.declaredVerifiedAssetCount === assetPaths.size
    && copied === copiedPaths.length
    && copiedSet.size === copiedPaths.length
    && [...copiedSet].every((relativePath) => assetPaths.has(relativePath))
    && copied + existing === assetPaths.size;
  if (!valid) addIssue({ code: "inventory_mismatch", artifact: manifestPath, message: "Capture inventory counters, copied paths, conflicts, or completion state do not reconcile." });
}

function parseReference(value: unknown, pathKey: "path" | "rgb_path", label: string, addIssue: (issue: ReceiptIssue) => void): FileReference | undefined {
  const reference = record(value);
  if (!reference || typeof reference[pathKey] !== "string" || !portablePath(reference[pathKey] as string) || !Number.isSafeInteger(reference.size_bytes) || (reference.size_bytes as number) < 0 || typeof reference.checksum !== "string" || !sha256Pattern.test(reference.checksum)) {
    addIssue({ code: "invalid_reference", artifact: manifestPath, message: `${label} must bind a canonical ASCII portable path, non-negative size_bytes, and lowercase SHA-256 checksum.` });
    return undefined;
  }
  return { path: reference[pathKey] as string, sizeBytes: reference.size_bytes as number, checksum: reference.checksum };
}

async function enumeratePackage(
  root: string,
  directory: string,
  hashed: Map<string, HashedFile>,
  hashAttempts: Set<string>,
  actualFiles: Map<string, HashedFile>,
  regularFiles: Map<string, number>,
  addIssue: (issue: ReceiptIssue) => void,
  sets: { invalidActualPaths: Set<string>; symlinks: Set<string>; nonRegular: Set<string>; mutable: Set<string>; unhashed: Set<string> },
): Promise<void> {
  const absoluteDirectory = directory ? path.join(root, ...directory.split("/")) : root;
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    addIssue({ code: "non_regular_file", ...(directory ? { artifact: directory } : {}), message: "Package directory could not be enumerated." });
    return;
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name.normalize("NFC"), "utf8"), Buffer.from(right.name.normalize("NFC"), "utf8")));
  const folded = new Map<string, string>();
  for (const entry of entries) {
    const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
    const portable = portablePath(relativePath);
    const collisionKey = entry.name.normalize("NFC").toLowerCase();
    const existing = folded.get(collisionKey);
    if (!portable || existing) {
      sets.invalidActualPaths.add(relativePath);
      addIssue({ code: "invalid_path", ...artifactField(relativePath), message: existing ? "Package directory contains an ASCII portable-path name collision." : "Package entry is not a canonical ASCII portable relative path." });
    } else {
      folded.set(collisionKey, entry.name);
    }
    const absolutePath = path.join(root, ...relativePath.split("/"));
    let info;
    try {
      info = await lstat(absolutePath, { bigint: true });
    } catch {
      sets.mutable.add(relativePath);
      addIssue({ code: "mutable_file", ...artifactField(relativePath), message: "Package entry changed during enumeration." });
      continue;
    }
    if (info.isSymbolicLink()) {
      if (!sets.symlinks.has(relativePath)) {
        sets.symlinks.add(relativePath);
        addIssue({ code: "symlink", ...artifactField(relativePath), message: "Package symlinks are not followed or consumed." });
      }
      continue;
    }
    if (info.isDirectory()) {
      await enumeratePackage(root, relativePath, hashed, hashAttempts, actualFiles, regularFiles, addIssue, sets);
      continue;
    }
    if (!info.isFile()) {
      if (!sets.nonRegular.has(relativePath)) {
        sets.nonRegular.add(relativePath);
        addIssue({ code: "non_regular_file", ...artifactField(relativePath), message: "Package entry is not a regular file." });
      }
      continue;
    }
    regularFiles.set(relativePath, Number(info.size));
    let file = hashed.get(relativePath);
    if (file && file.identity !== statIdentity(info)) {
      sets.mutable.add(relativePath);
      sets.unhashed.add(relativePath);
      addIssue({ code: "mutable_file", ...artifactField(relativePath), message: "Package file changed after content verification." });
      continue;
    }
    if (!file && !hashAttempts.has(relativePath)) {
      hashAttempts.add(relativePath);
      file = await hashFile(root, relativePath, false, maxFileBytes, addIssue, sets);
      if (file) hashed.set(relativePath, file);
    }
    if (file) actualFiles.set(relativePath, file);
    else sets.unhashed.add(relativePath);
  }
}

async function hashFile(
  root: string,
  relativePath: string,
  retainBytes: boolean,
  byteLimit: number,
  addIssue: (issue: ReceiptIssue) => void,
  sets: { symlinks: Set<string>; nonRegular: Set<string>; mutable: Set<string>; unhashed?: Set<string> },
): Promise<HashedFile | undefined> {
  if (!portablePath(relativePath)) {
    addIssue({ code: "invalid_path", ...artifactField(relativePath), message: "Declared path is not a canonical ASCII portable relative path." });
    return undefined;
  }
  const ancestorIdentities = await inspectAncestors(root, relativePath, addIssue, sets);
  if (!ancestorIdentities) return undefined;
  const absolutePath = path.join(root, ...relativePath.split("/"));
  let before;
  try {
    before = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    addIssue({ code: "non_regular_file", artifact: relativePath, message: "Package file metadata could not be read." });
    return undefined;
  }
  if (before.isSymbolicLink()) {
    if (!sets.symlinks.has(relativePath)) {
      sets.symlinks.add(relativePath);
      addIssue({ code: "symlink", artifact: relativePath, message: "Package symlinks are not followed or consumed." });
    }
    return undefined;
  }
  if (!before.isFile()) {
    if (!sets.nonRegular.has(relativePath)) {
      sets.nonRegular.add(relativePath);
      addIssue({ code: "non_regular_file", artifact: relativePath, message: "Declared package path is not a regular file." });
    }
    return undefined;
  }
  const sizeBytes = Number(before.size);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes > byteLimit) {
    addIssue({ code: "bounds_exceeded", artifact: relativePath, message: `Package file exceeds the ${byteLimit}-byte verification limit.` });
    sets.unhashed?.add(relativePath);
    return undefined;
  }
  const digest = createHash("sha256");
  const chunks: Buffer[] = [];
  let streamedBytes = 0;
  let closeFailed = false;
  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (statIdentity(opened) !== statIdentity(before)) throw new Error("identity");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      streamedBytes += bytesRead;
      if (streamedBytes > byteLimit) throw new Error("bounds");
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      if (retainBytes) chunks.push(Buffer.from(chunk));
    }
    const openedAfter = await handle.stat({ bigint: true });
    if (statIdentity(openedAfter) !== statIdentity(before)) throw new Error("identity");
  } catch {
    addIssue({ code: "mutable_file", artifact: relativePath, message: "Package file could not be read as one stable stream." });
    sets.mutable.add(relativePath);
    sets.unhashed?.add(relativePath);
    return undefined;
  } finally {
    try {
      await handle?.close();
    } catch {
      closeFailed = true;
    }
  }
  if (closeFailed) {
    addIssue({ code: "mutable_file", artifact: relativePath, message: "Package file could not be closed after content verification." });
    sets.mutable.add(relativePath);
    sets.unhashed?.add(relativePath);
    return undefined;
  }
  let after;
  try {
    after = await lstat(absolutePath, { bigint: true });
  } catch {
    sets.mutable.add(relativePath);
    addIssue({ code: "mutable_file", artifact: relativePath, message: "Package file disappeared during content verification." });
    return undefined;
  }
  const stable = statIdentity(before) === statIdentity(after)
    && streamedBytes === sizeBytes
    && await ancestorIdentitiesMatch(root, ancestorIdentities)
    && await resolvesToSelf(absolutePath);
  if (!stable) {
    sets.mutable.add(relativePath);
    addIssue({ code: "mutable_file", artifact: relativePath, message: "Package file changed during content verification." });
  }
  return {
    path: relativePath,
    sizeBytes: streamedBytes,
    checksum: `sha256:${digest.digest("hex")}`,
    identity: statIdentity(after),
    ancestorIdentities,
    ...(retainBytes ? { bytes: Buffer.concat(chunks, streamedBytes) } : {}),
    stable,
  };
}

async function inspectAncestors(
  root: string,
  relativePath: string,
  addIssue: (issue: ReceiptIssue) => void,
  sets: { symlinks: Set<string>; nonRegular: Set<string> },
): Promise<ReadonlyMap<string, string> | undefined> {
  const identities = new Map<string, string>();
  const parts = relativePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = parts.slice(0, index).join("/");
    let info;
    try {
      info = await lstat(path.join(root, ...parts.slice(0, index)), { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (!sets.nonRegular.has(ancestor)) {
        sets.nonRegular.add(ancestor);
        addIssue({ code: "non_regular_file", artifact: ancestor, message: "Declared package ancestor metadata could not be read." });
      }
      return undefined;
    }
    if (info.isSymbolicLink()) {
      if (!sets.symlinks.has(ancestor)) {
        sets.symlinks.add(ancestor);
        addIssue({ code: "symlink", artifact: ancestor, message: "Package symlinks are not followed or consumed." });
      }
      return undefined;
    }
    if (!info.isDirectory()) {
      if (!sets.nonRegular.has(ancestor)) {
        sets.nonRegular.add(ancestor);
        addIssue({ code: "non_regular_file", artifact: ancestor, message: "Declared package ancestor is not a directory." });
      }
      return undefined;
    }
    identities.set(ancestor, directoryIdentity(info));
  }
  return identities;
}

async function ancestorIdentitiesMatch(root: string, identities: ReadonlyMap<string, string>): Promise<boolean> {
  for (const [ancestor, identity] of identities) {
    try {
      const info = await lstat(path.join(root, ...ancestor.split("/")), { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory() || directoryIdentity(info) !== identity) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function resolvesToSelf(absolutePath: string): Promise<boolean> {
  try {
    return await realpath(absolutePath) === absolutePath;
  } catch {
    return false;
  }
}

async function consumeVerifiedFile(
  root: string,
  relativePath: string,
  byteLimit: number,
  retainBytes: boolean,
  verifiedFiles: Map<string, HashedFile>,
  verifiedPaths: Set<string>,
  declarations: ReadonlyMap<string, FileReference>,
  revokedPaths: Set<string>,
  verification: CaptureSplatConsumerVerification,
): Promise<Buffer | undefined> {
  const expected = verifiedFiles.get(relativePath);
  if (!expected || !Number.isSafeInteger(byteLimit) || byteLimit < 0 || expected.sizeBytes > byteLimit) return undefined;
  const revoke = (artifact: string, message: string) => {
    revokeVerifiedFiles(artifact, message, verifiedFiles, verifiedPaths, declarations, revokedPaths, verification);
  };
  const parts = relativePath.split("/");
  for (const [ancestor, identity] of expected.ancestorIdentities) {
    try {
      const info = await lstat(path.join(root, ...ancestor.split("/")), { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory() || directoryIdentity(info) !== identity) {
        revoke(ancestor, "A verified package ancestor changed before file consumption.");
        return undefined;
      }
    } catch {
      revoke(ancestor, "A verified package ancestor became unreadable before file consumption.");
      return undefined;
    }
  }

  const absolutePath = path.join(root, ...parts);
  let handle;
  const digest = createHash("sha256");
  const chunks: Buffer[] = [];
  let streamedBytes = 0;
  let closeFailed = false;
  try {
    const before = await lstat(absolutePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || statIdentity(before) !== expected.identity || !await resolvesToSelf(absolutePath)) throw new Error("identity");
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (statIdentity(opened) !== expected.identity) throw new Error("identity");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      streamedBytes += bytesRead;
      if (streamedBytes > byteLimit || streamedBytes > expected.sizeBytes) throw new Error("bounds");
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      if (retainBytes) chunks.push(Buffer.from(chunk));
    }
    const openedAfter = await handle.stat({ bigint: true });
    if (statIdentity(openedAfter) !== expected.identity) throw new Error("identity");
  } catch {
    revoke(relativePath, "A verified package file changed or became unreadable before consumption.");
    return undefined;
  } finally {
    try {
      await handle?.close();
    } catch {
      closeFailed = true;
    }
  }
  if (closeFailed) {
    revoke(relativePath, "A verified package file could not be closed after consumption.");
    return undefined;
  }

  try {
    const after = await lstat(absolutePath, { bigint: true });
    if (after.isSymbolicLink() || !after.isFile() || statIdentity(after) !== expected.identity || !await resolvesToSelf(absolutePath)) throw new Error("identity");
  } catch {
    revoke(relativePath, "A verified package path changed during file consumption.");
    return undefined;
  }
  for (const [ancestor, identity] of expected.ancestorIdentities) {
    try {
      const info = await lstat(path.join(root, ...ancestor.split("/")), { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory() || directoryIdentity(info) !== identity) {
        revoke(ancestor, "A verified package ancestor changed during file consumption.");
        return undefined;
      }
    } catch {
      revoke(ancestor, "A verified package ancestor became unreadable during file consumption.");
      return undefined;
    }
  }
  const checksum = `sha256:${digest.digest("hex")}`;
  if (streamedBytes !== expected.sizeBytes || checksum !== expected.checksum) {
    revoke(relativePath, "Verified package bytes no longer match the receipt-bound file.");
    return undefined;
  }
  return retainBytes ? Buffer.concat(chunks, streamedBytes) : Buffer.alloc(0);
}

function revokeVerifiedFiles(
  artifact: string,
  message: string,
  verifiedFiles: Map<string, HashedFile>,
  verifiedPaths: Set<string>,
  declarations: ReadonlyMap<string, FileReference>,
  revokedPaths: Set<string>,
  verification: CaptureSplatConsumerVerification,
): void {
  if (revokedPaths.has(artifact)) return;
  const affected = [...verifiedFiles.keys()].filter((relativePath) => relativePath === artifact || relativePath.startsWith(`${artifact}/`));
  if (!affected.length) return;
  revokedPaths.add(artifact);
  for (const relativePath of affected) {
    verifiedFiles.delete(relativePath);
    verifiedPaths.delete(relativePath);
  }
  const current = verification.receipt;
  const nextIssueCount = current.issue_count + 1;
  const nextIssues = current.issues.length < maxIssues
    ? [...current.issues, { code: "mutable_file" as const, artifact, message }]
    : current.issues;
  verification.receipt = validateCaptureSplatConsumerReceipt({
    ...current,
    closure: {
      ...current.closure,
      verified_reference_file_count: [...verifiedFiles.keys()].filter((relativePath) => declarations.has(relativePath)).length,
      mutable_file_count: current.closure.mutable_file_count + 1,
    },
    tree: {
      status: "incomplete",
      algorithm: current.tree.algorithm,
      scope: current.tree.scope,
      file_count: current.tree.file_count,
      size_bytes: current.tree.size_bytes,
      includes_handoff_manifest: current.tree.includes_handoff_manifest,
      includes_receipt: current.tree.includes_receipt,
    },
    issue_count: nextIssueCount,
    issues_truncated: nextIssueCount > nextIssues.length,
    issues: nextIssues,
    decision: "hold",
  });
}

function parseJsonRecord(bytes: Buffer, artifact: string, code: "invalid_handoff_manifest" | "invalid_capture_manifest", addIssue: (issue: ReceiptIssue) => void): Record<string, unknown> | undefined {
  const text = decodeUtf8(bytes, artifact, code, addIssue);
  return text === undefined ? undefined : parseJsonRecordText(text, artifact, code, addIssue);
}

function decodeUtf8(bytes: Buffer, artifact: string, code: "invalid_handoff_manifest" | "invalid_capture_manifest", addIssue: (issue: ReceiptIssue) => void): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    addIssue({ code, artifact, message: "JSON must be valid UTF-8 with an object root." });
    return undefined;
  }
}

function parseJsonRecordText(text: string, artifact: string, code: "invalid_handoff_manifest" | "invalid_capture_manifest", addIssue: (issue: ReceiptIssue) => void): Record<string, unknown> | undefined {
  try {
    const parsed = record(JSON.parse(text) as unknown);
    if (!parsed) throw new Error("root is not an object");
    return parsed;
  } catch {
    addIssue({ code, artifact, message: "JSON must be valid UTF-8 with an object root." });
    return undefined;
  }
}

function portablePath(value: string): boolean {
  if (!value || !/^[\x20-\x7e]+$/.test(value) || value !== value.normalize("NFC") || Buffer.byteLength(value, "utf8") > 1024 || value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value)) return false;
  const reserved = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  return parts.every((part) => {
    const stem = part.replace(/[ .]+$/g, "").split(".", 1)[0]!.replace(/[ .]+$/g, "");
    return !/[ .]$/.test(part) && !reserved.test(stem) && ![...part].some((character) => character.codePointAt(0)! < 32 || /[<>:"|?*]/.test(character));
  });
}

function statIdentity(info: { dev: bigint; ino: bigint; size: bigint; mode: bigint; mtimeNs: bigint; ctimeNs: bigint }): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mode}:${info.mtimeNs}:${info.ctimeNs}`;
}

function directoryIdentity(info: { dev: bigint; ino: bigint; mode: bigint }): string {
  return `${info.dev}:${info.ino}:${info.mode}`;
}

function hasPathOrAncestor(paths: ReadonlySet<string>, relativePath: string): boolean {
  if (paths.has(relativePath)) return true;
  const parts = relativePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    if (paths.has(parts.slice(0, index).join("/"))) return true;
  }
  return false;
}

function matchesReference(file: HashedFile, reference: FileReference): boolean {
  return file.sizeBytes === reference.sizeBytes && file.checksum === reference.checksum;
}

function compareReferences(left: FileReference, right: FileReference): number {
  return Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function safeCounter(value: unknown, label: string, addIssue: (issue: ReceiptIssue) => void): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maxReferences) {
    addIssue({ code: "invalid_capture_inventory", artifact: manifestPath, message: `Capture inventory ${label} must be a non-negative bounded integer.` });
    return 0;
  }
  return value as number;
}

function safeArtifact(value: string): string | undefined {
  return portablePath(value) ? value : undefined;
}

function artifactField(value: string): { artifact?: string } {
  const artifact = safeArtifact(value);
  return artifact ? { artifact } : {};
}
