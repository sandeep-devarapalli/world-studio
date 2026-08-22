export const CAPTURE_SPLAT_CONSUMER_RECEIPT_SCHEMA =
  "world_studio.capture_splat_consumer_receipt.v0.1" as const;

export type CaptureSplatConsumerIssueCode =
  | "bounds_exceeded"
  | "conflicting_declaration"
  | "invalid_capture_inventory"
  | "invalid_capture_manifest"
  | "invalid_handoff_manifest"
  | "invalid_path"
  | "invalid_reference"
  | "inventory_mismatch"
  | "metadata_mismatch"
  | "missing_file"
  | "mutable_file"
  | "non_regular_file"
  | "symlink"
  | "unreferenced_file";

export interface CaptureSplatConsumerReceiptV1 {
  schema: typeof CAPTURE_SPLAT_CONSUMER_RECEIPT_SCHEMA;
  consumer: {
    name: "world-studio";
    verifier: "capture-splat-package-v0.1";
  };
  handoff: {
    schema: "capture_splat.world_studio_handoff.v0.3";
    manifest: {
      path: "capture-splat.world-studio.json";
      size_bytes: number;
      checksum: string;
    };
  };
  inventory: {
    schema: "capture_splat.capture_manifest_assets.v0.1";
    verification: "source_destination_size_and_sha256";
    declared_reference_count: number;
    declared_unique_asset_count: number;
    declared_duplicate_reference_count: number;
    declared_verified_asset_count: number;
    recomputed_reference_count: number;
    recomputed_unique_asset_count: number;
    recomputed_duplicate_reference_count: number;
  };
  closure: {
    source_frame_count: number;
    declared_reference_file_count: number;
    declared_reference_bytes: number;
    verified_reference_file_count: number;
    missing_file_count: number;
    metadata_mismatch_count: number;
    conflicting_declaration_count: number;
    unreferenced_file_count: number;
    symlink_count: number;
    non_regular_file_count: number;
    mutable_file_count: number;
  };
  tree: {
    status: "complete" | "incomplete";
    algorithm: "sha256_utf8_nfc_path_nul_size_nul_sha256_lf_v1";
    scope: "all_regular_files_under_package_root";
    file_count: number;
    size_bytes: number;
    checksum?: string;
    includes_handoff_manifest: true;
    includes_receipt: false;
  };
  verification: {
    content: "sha256_stream_1mib_stable_stat_v1";
    paths: "capture_splat_portable_relative_path_v1";
    references: "capture_splat_world_studio_handoff_v0.3_v1";
  };
  issue_count: number;
  issues_truncated: boolean;
  issues: Array<{
    code: CaptureSplatConsumerIssueCode;
    artifact?: string;
    message: string;
  }>;
  decision: "ready" | "hold";
  authority: "package_integrity_evidence_only";
  authenticity: "not_established";
}

export class CaptureSplatConsumerReceiptContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureSplatConsumerReceiptContractError";
  }
}

const issueCodes: CaptureSplatConsumerIssueCode[] = [
  "bounds_exceeded",
  "conflicting_declaration",
  "invalid_capture_inventory",
  "invalid_capture_manifest",
  "invalid_handoff_manifest",
  "invalid_path",
  "invalid_reference",
  "inventory_mismatch",
  "metadata_mismatch",
  "missing_file",
  "mutable_file",
  "non_regular_file",
  "symlink",
  "unreferenced_file",
];
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;

export function validateCaptureSplatConsumerReceipt(value: unknown): CaptureSplatConsumerReceiptV1 {
  const receipt = record(value, "Capture Splat consumer receipt");
  exactKeys(receipt, ["schema", "consumer", "handoff", "inventory", "closure", "tree", "verification", "issue_count", "issues_truncated", "issues", "decision", "authority", "authenticity"], "Capture Splat consumer receipt");
  literal(receipt.schema, CAPTURE_SPLAT_CONSUMER_RECEIPT_SCHEMA, "receipt schema");

  const consumer = record(receipt.consumer, "receipt consumer");
  exactKeys(consumer, ["name", "verifier"], "receipt consumer");
  literal(consumer.name, "world-studio", "consumer name");
  literal(consumer.verifier, "capture-splat-package-v0.1", "consumer verifier");

  const handoff = record(receipt.handoff, "receipt handoff");
  exactKeys(handoff, ["schema", "manifest"], "receipt handoff");
  literal(handoff.schema, "capture_splat.world_studio_handoff.v0.3", "handoff schema");
  const manifest = record(handoff.manifest, "handoff manifest");
  exactKeys(manifest, ["path", "size_bytes", "checksum"], "handoff manifest");
  literal(manifest.path, "capture-splat.world-studio.json", "handoff manifest path");
  const manifestSize = integer(manifest.size_bytes, "handoff manifest size", 0, 64 * 1024 ** 2);
  const manifestChecksum = sha256(manifest.checksum, "handoff manifest checksum");

  const inventory = record(receipt.inventory, "receipt inventory");
  const inventoryKeys = ["schema", "verification", "declared_reference_count", "declared_unique_asset_count", "declared_duplicate_reference_count", "declared_verified_asset_count", "recomputed_reference_count", "recomputed_unique_asset_count", "recomputed_duplicate_reference_count"];
  exactKeys(inventory, inventoryKeys, "receipt inventory");
  literal(inventory.schema, "capture_splat.capture_manifest_assets.v0.1", "inventory schema");
  literal(inventory.verification, "source_destination_size_and_sha256", "inventory verification");
  const inventoryNumbers = Object.fromEntries(inventoryKeys.slice(2).map((key) => [key, integer(inventory[key], `inventory ${key}`, 0, 200_000)])) as Record<string, number>;

  const closure = record(receipt.closure, "receipt closure");
  const closureKeys = ["source_frame_count", "declared_reference_file_count", "declared_reference_bytes", "verified_reference_file_count", "missing_file_count", "metadata_mismatch_count", "conflicting_declaration_count", "unreferenced_file_count", "symlink_count", "non_regular_file_count", "mutable_file_count"];
  exactKeys(closure, closureKeys, "receipt closure");
  const closureNumbers = Object.fromEntries(closureKeys.map((key) => [key, integer(
    closure[key],
    `closure ${key}`,
    0,
    key === "source_frame_count" ? 100_000 : key === "declared_reference_file_count" || key === "verified_reference_file_count" ? 200_000 : Number.MAX_SAFE_INTEGER,
  )])) as Record<string, number>;

  const tree = record(receipt.tree, "receipt tree");
  const treeStatus = oneOf(tree.status, ["complete", "incomplete"] as const, "tree status");
  exactKeys(tree, treeStatus === "complete" ? ["status", "algorithm", "scope", "file_count", "size_bytes", "checksum", "includes_handoff_manifest", "includes_receipt"] : ["status", "algorithm", "scope", "file_count", "size_bytes", "includes_handoff_manifest", "includes_receipt"], "receipt tree");
  literal(tree.algorithm, "sha256_utf8_nfc_path_nul_size_nul_sha256_lf_v1", "tree algorithm");
  literal(tree.scope, "all_regular_files_under_package_root", "tree scope");
  const treeFileCount = integer(tree.file_count, "tree file_count", 0, Number.MAX_SAFE_INTEGER);
  const treeSizeBytes = integer(tree.size_bytes, "tree size_bytes", 0, Number.MAX_SAFE_INTEGER);
  const treeChecksum = treeStatus === "complete" ? sha256(tree.checksum, "tree checksum") : undefined;
  literal(tree.includes_handoff_manifest, true, "tree includes_handoff_manifest");
  literal(tree.includes_receipt, false, "tree includes_receipt");

  const verification = record(receipt.verification, "receipt verification");
  exactKeys(verification, ["content", "paths", "references"], "receipt verification");
  literal(verification.content, "sha256_stream_1mib_stable_stat_v1", "content verification");
  literal(verification.paths, "capture_splat_portable_relative_path_v1", "path verification");
  literal(verification.references, "capture_splat_world_studio_handoff_v0.3_v1", "reference verification");

  const issueCount = integer(receipt.issue_count, "receipt issue_count", 0, Number.MAX_SAFE_INTEGER);
  if (typeof receipt.issues_truncated !== "boolean") fail("Receipt issues_truncated must be boolean.");
  if (!Array.isArray(receipt.issues) || receipt.issues.length > 64) fail("Receipt issues must contain at most 64 entries.");
  const issues = receipt.issues.map((value, index) => validateIssue(value, index));
  if (issueCount < issues.length || receipt.issues_truncated !== (issueCount > issues.length)) {
    fail("Receipt issue count and truncation flag must agree with retained issues.");
  }
  const decision = oneOf(receipt.decision, ["ready", "hold"] as const, "receipt decision");
  literal(receipt.authority, "package_integrity_evidence_only", "receipt authority");
  literal(receipt.authenticity, "not_established", "receipt authenticity");
  const zeroClosureFailures = ["missing_file_count", "metadata_mismatch_count", "conflicting_declaration_count", "unreferenced_file_count", "symlink_count", "non_regular_file_count", "mutable_file_count"].every((key) => closureNumbers[key] === 0);
  const reconciledInventory = inventoryNumbers.declared_reference_count === inventoryNumbers.recomputed_reference_count
    && inventoryNumbers.declared_unique_asset_count === inventoryNumbers.recomputed_unique_asset_count
    && inventoryNumbers.declared_duplicate_reference_count === inventoryNumbers.recomputed_duplicate_reference_count
    && inventoryNumbers.declared_duplicate_reference_count === inventoryNumbers.declared_reference_count - inventoryNumbers.declared_unique_asset_count
    && inventoryNumbers.declared_verified_asset_count === inventoryNumbers.declared_unique_asset_count;
  if (decision === "ready" && (issueCount !== 0 || !zeroClosureFailures || !reconciledInventory || treeStatus !== "complete" || closureNumbers.verified_reference_file_count !== closureNumbers.declared_reference_file_count)) {
    fail("A ready receipt requires complete tree and reference closure with no issues.");
  }

  return {
    schema: CAPTURE_SPLAT_CONSUMER_RECEIPT_SCHEMA,
    consumer: { name: "world-studio", verifier: "capture-splat-package-v0.1" },
    handoff: { schema: "capture_splat.world_studio_handoff.v0.3", manifest: { path: "capture-splat.world-studio.json", size_bytes: manifestSize, checksum: manifestChecksum } },
    inventory: {
      schema: "capture_splat.capture_manifest_assets.v0.1",
      verification: "source_destination_size_and_sha256",
      declared_reference_count: inventoryNumbers.declared_reference_count,
      declared_unique_asset_count: inventoryNumbers.declared_unique_asset_count,
      declared_duplicate_reference_count: inventoryNumbers.declared_duplicate_reference_count,
      declared_verified_asset_count: inventoryNumbers.declared_verified_asset_count,
      recomputed_reference_count: inventoryNumbers.recomputed_reference_count,
      recomputed_unique_asset_count: inventoryNumbers.recomputed_unique_asset_count,
      recomputed_duplicate_reference_count: inventoryNumbers.recomputed_duplicate_reference_count,
    },
    closure: closureNumbers as CaptureSplatConsumerReceiptV1["closure"],
    tree: { status: treeStatus, algorithm: "sha256_utf8_nfc_path_nul_size_nul_sha256_lf_v1", scope: "all_regular_files_under_package_root", file_count: treeFileCount, size_bytes: treeSizeBytes, ...(treeChecksum ? { checksum: treeChecksum } : {}), includes_handoff_manifest: true, includes_receipt: false },
    verification: { content: "sha256_stream_1mib_stable_stat_v1", paths: "capture_splat_portable_relative_path_v1", references: "capture_splat_world_studio_handoff_v0.3_v1" },
    issue_count: issueCount,
    issues_truncated: receipt.issues_truncated,
    issues,
    decision,
    authority: "package_integrity_evidence_only",
    authenticity: "not_established",
  };
}

function validateIssue(value: unknown, index: number): CaptureSplatConsumerReceiptV1["issues"][number] {
  const issue = record(value, `receipt issue ${index}`);
  exactKeys(issue, typeof issue.artifact === "string" ? ["code", "artifact", "message"] : ["code", "message"], `receipt issue ${index}`);
  const code = oneOf(issue.code, issueCodes, `receipt issue ${index} code`);
  if (typeof issue.message !== "string" || !issue.message || utf8Bytes(issue.message) > 512) fail(`Receipt issue ${index} message is invalid.`);
  if (issue.artifact !== undefined && (typeof issue.artifact !== "string" || !portablePath(issue.artifact))) fail(`Receipt issue ${index} artifact is invalid.`);
  return { code, ...(typeof issue.artifact === "string" ? { artifact: issue.artifact } : {}), message: issue.message };
}

function portablePath(value: string): boolean {
  return /^[\x20-\x7e]+$/.test(value) && value === value.normalize("NFC") && utf8Bytes(value) <= 1024 && Boolean(value) && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => !part || part === "." || part === "..");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} must contain exactly: ${expected.join(", ")}.`);
}

function literal<T extends string | boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) fail(`${label} must be ${JSON.stringify(expected)}.`);
  return expected;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(`${label} is unsupported.`);
  return value as T;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(`${label} must be a safe integer from ${minimum} through ${maximum}.`);
  return value as number;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) fail(`${label} must be lowercase SHA-256.`);
  return value;
}

function fail(message: string): never {
  throw new CaptureSplatConsumerReceiptContractError(message);
}
