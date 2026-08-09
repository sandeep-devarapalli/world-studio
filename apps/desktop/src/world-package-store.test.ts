import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_ASSET_SCHEMA,
  CANONICAL_DELTA_SCHEMA,
  CANONICAL_WORLD_SCHEMA,
  validateCanonicalAssetManifest,
  validateCanonicalDelta,
  validateCanonicalTransitionBinding,
  validateCanonicalWorldManifest,
  type CanonicalArtifactBindingV1,
  type CanonicalAssetManifestV1,
  type CanonicalAuthorityDomain,
  type CanonicalAuthorityV1,
  type CanonicalContentReferenceV1,
  type CanonicalDeltaV1,
  type CanonicalProvenanceV1,
  type CanonicalReadinessV1,
  type CanonicalVersionReferenceV1,
  type CanonicalVersionedManifestReferenceV1,
  type CanonicalWorldManifestV2,
} from "@world-studio/world-core";
import {
  CanonicalWorldPackageStore,
  type CanonicalWorldPackageStoreError,
} from "./world-package-store.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const rendererReadCapBytes = 16 * 1024 * 1024;
let childStoreModuleUrl: string | null = null;
const units = { length: "m", mass: "kg", time: "s", angle: "rad", force: "N", torque: "N*m" } as const;
const unknown = { status: "unknown", reason: "No validated uncertainty bound." } as const;

interface AssetBundle {
  manifest: CanonicalAssetManifestV1;
  manifestBytes: Buffer;
  reference: CanonicalVersionReferenceV1 & { kind: "asset" };
  artifactBytes: Buffer;
  inheritedBytes: Buffer;
  delta: CanonicalDeltaV1 | null;
  deltaBytes: Buffer | null;
}

interface WorldBundle {
  manifest: CanonicalWorldManifestV2;
  manifestBytes: Buffer;
  reference: CanonicalVersionReferenceV1 & { kind: "world" };
  captureBytes: Buffer;
  visualBytes: Buffer;
  delta: CanonicalDeltaV1 | null;
  deltaBytes: Buffer | null;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  childStoreModuleUrl = null;
});

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Zeros(sizeBytes: number): string {
  const digest = createHash("sha256");
  const chunk = Buffer.alloc(64 * 1024);
  for (let remaining = sizeBytes; remaining > 0; remaining -= chunk.byteLength) {
    digest.update(chunk.subarray(0, Math.min(chunk.byteLength, remaining)));
  }
  return `sha256:${digest.digest("hex")}`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function minimalGlb(marker?: number): Buffer {
  const bytes = Buffer.alloc(marker === undefined ? 12 : 13);
  bytes.write("glTF", 0, "ascii");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.byteLength, 8);
  if (marker !== undefined) bytes[12] = marker;
  return bytes;
}

function content(path: string, bytes: Uint8Array, mediaType = "application/octet-stream"): CanonicalContentReferenceV1 {
  return { path, sha256: sha256(bytes), size_bytes: bytes.byteLength, media_type: mediaType };
}

function authority(domain: CanonicalAuthorityDomain, evidenceArtifactIds: string[] = []): CanonicalAuthorityV1 {
  return {
    domain,
    status: "proposal",
    approved_for: ["inspection"],
    not_approved_for: ["measurement", "collision", "navigation", "physics"],
    limitations: ["Proposal evidence only."],
    evidence_artifact_ids: evidenceArtifactIds,
  };
}

function provenance(
  createdAt: string,
  inputVersions: CanonicalVersionReferenceV1[] = [],
  inputArtifactIds: string[] = [],
): CanonicalProvenanceV1 {
  return {
    producer: "world_package_store_test",
    producer_version: "1.0",
    created_at: createdAt,
    run_id: null,
    input_artifact_ids: inputArtifactIds,
    input_versions: inputVersions,
  };
}

function artifact(
  artifactId: string,
  role: CanonicalArtifactBindingV1["role"],
  reference: CanonicalContentReferenceV1,
  domain: CanonicalAuthorityDomain,
  createdAt: string,
  frameId = "world_frame",
): CanonicalArtifactBindingV1 {
  return {
    artifact_id: artifactId,
    role,
    content: reference,
    frame_id: frameId,
    transform_id: null,
    authority: authority(domain),
    uncertainty: unknown,
    provenance: provenance(createdAt),
  };
}

function readiness(visualEvidence: string): CanonicalReadinessV1 {
  const unavailable = () => ({
    status: "unavailable" as const,
    evidence_artifact_ids: [],
    report: null,
    limitations: ["No validated layer is available."],
  });
  return {
    visual: {
      status: "proposal",
      evidence_artifact_ids: [visualEvidence],
      report: null,
      limitations: ["Visual proposal only."],
    },
    metric: unavailable(),
    collision: unavailable(),
    navigation: unavailable(),
    semantic: unavailable(),
    articulation: unavailable(),
    physics: unavailable(),
  };
}

function manifestReference(
  kind: "world" | "asset",
  id: string,
  versionId: string,
  version: number,
  bytes: Uint8Array,
): CanonicalVersionReferenceV1 {
  return { kind, id, version_id: versionId, version, manifest_sha256: sha256(bytes) };
}

function makeAsset(
  id = "test_asset",
  artifactBytes = minimalGlb(),
  inheritedBytes = Buffer.from("asset-texture-v1"),
): AssetBundle {
  const createdAt = "2026-08-09T10:00:00.000Z";
  const assetArtifact = artifact(
    `${id}_visual_v1`,
    "visual_mesh",
    content(`assets/${id}/visual.glb`, artifactBytes, "model/gltf-binary"),
    "visual",
    createdAt,
    "asset_local",
  );
  const inheritedArtifact = artifact(
    `${id}_texture_v1`,
    "visual_texture",
    content(`assets/${id}/texture.bin`, inheritedBytes),
    "visual",
    createdAt,
    "asset_local",
  );
  const manifest: CanonicalAssetManifestV1 = {
    schema: CANONICAL_ASSET_SCHEMA,
    asset_id: id,
    version_id: `${id}_v1`,
    version: 1,
    parent: null,
    created_at: createdAt,
    units,
    root_frame: { frame_id: "asset_local", handedness: "right", up_axis: "+Y", forward_axis: "-Z" },
    artifacts: [assetArtifact, inheritedArtifact],
    applied_delta: null,
    authorities: [authority("visual", [assetArtifact.artifact_id])],
    readiness: readiness(assetArtifact.artifact_id),
    provenance: provenance(createdAt),
  };
  validateCanonicalAssetManifest(manifest);
  const manifestBytes = jsonBytes(manifest);
  return {
    manifest,
    manifestBytes,
    reference: manifestReference("asset", id, manifest.version_id, 1, manifestBytes) as AssetBundle["reference"],
    artifactBytes,
    inheritedBytes,
    delta: null,
    deltaBytes: null,
  };
}

function makeAssetChild(parent: AssetBundle, artifactBytes = minimalGlb(2)): AssetBundle {
  const version = parent.manifest.version + 1;
  const createdAt = `2026-08-09T10:0${version}:00.000Z`;
  const before = parent.manifest.artifacts.find((entry) => entry.role === "visual_mesh")!;
  const inherited = parent.manifest.artifacts.find((entry) => entry.role === "visual_texture")!;
  const after = artifact(
    `${parent.manifest.asset_id}_visual_v${version}`,
    "visual_mesh",
    content(`assets/${parent.manifest.asset_id}/visual-v${version}.glb`, artifactBytes, "model/gltf-binary"),
    "visual",
    createdAt,
    "asset_local",
  );
  const versionId = `${parent.manifest.asset_id}_v${version}`;
  const delta: CanonicalDeltaV1 = {
    schema: CANONICAL_DELTA_SCHEMA,
    delta_id: `${parent.manifest.asset_id}_replace_v${version}`,
    scope: "asset",
    parent: parent.reference,
    result: { kind: "asset", id: parent.manifest.asset_id, version_id: versionId, version },
    created_at: createdAt,
    intent: "replace",
    operations: [{
      operation_id: `${parent.manifest.asset_id}_replace_visual_v${version}`,
      target_id: before.artifact_id,
      effect: { kind: "artifact_binding", before: [before], after: [after] },
    }],
    authority_effect: "none",
    provenance: provenance(createdAt, [parent.reference], [before.artifact_id]),
  };
  validateCanonicalDelta(delta);
  const deltaBytes = jsonBytes(delta);
  const manifest: CanonicalAssetManifestV1 = {
    ...structuredClone(parent.manifest),
    version_id: versionId,
    version,
    parent: parent.reference,
    created_at: createdAt,
    artifacts: [after, structuredClone(inherited)],
    applied_delta: {
      delta_id: delta.delta_id,
      manifest: content(`history/${delta.delta_id}.json`, deltaBytes, "application/json"),
    },
    authorities: [authority("visual", [after.artifact_id])],
    readiness: readiness(after.artifact_id),
    provenance: provenance(createdAt, [parent.reference]),
  };
  validateCanonicalAssetManifest(manifest);
  validateCanonicalTransitionBinding(parent.manifest, delta, manifest, {
    parent_manifest_sha256: parent.reference.manifest_sha256,
    delta_manifest_sha256: sha256(deltaBytes),
  });
  const manifestBytes = jsonBytes(manifest);
  return {
    manifest,
    manifestBytes,
    reference: manifestReference(
      "asset",
      manifest.asset_id,
      manifest.version_id,
      version,
      manifestBytes,
    ) as AssetBundle["reference"],
    artifactBytes,
    inheritedBytes: parent.inheritedBytes,
    delta,
    deltaBytes,
  };
}

function makeWorld(options: {
  worldId?: string;
  visualBytes?: Buffer;
  asset?: AssetBundle;
} = {}): WorldBundle {
  const worldId = options.worldId ?? "test_world";
  const createdAt = "2026-08-09T10:10:00.000Z";
  const captureBytes = Buffer.from("{\"schema\":\"capture_splat.v0.3\"}\n");
  const visualBytes = options.visualBytes ?? Buffer.from("world-visual-v1");
  const captureReference = content("evidence/capture.json", captureBytes, "application/json");
  const captureArtifact = artifact("capture_manifest", "source_manifest", captureReference, "capture", createdAt);
  const visualArtifact = artifact(
    "world_visual_v1",
    "visual_splat",
    content("world/visual-v1.spz", visualBytes, "application/octet-stream"),
    "visual",
    createdAt,
  );
  const assets: CanonicalVersionedManifestReferenceV1[] = options.asset ? [{
    revision: options.asset.reference,
    manifest: content(`dependencies/${options.asset.manifest.asset_id}/manifest.json`, options.asset.manifestBytes, "application/json"),
  }] : [];
  const manifest: CanonicalWorldManifestV2 = {
    schema: CANONICAL_WORLD_SCHEMA,
    world_id: worldId,
    version_id: `${worldId}_v1`,
    version: 1,
    parent: null,
    created_at: createdAt,
    units,
    transform_graph: {
      root_frame_id: "world_frame",
      nodes: [{ frame_id: "world_frame", handedness: "right", up_axis: "+Y", forward_axis: "-Z" }],
      edges: [],
    },
    capture_evidence: [{
      session_id: "capture_session",
      manifest: captureReference,
      verification: "rehashed_bytes",
      authority: authority("capture", [captureArtifact.artifact_id]),
      uncertainty: unknown,
    }],
    artifacts: [captureArtifact, visualArtifact],
    assets,
    applied_delta: null,
    authorities: [authority("visual", [visualArtifact.artifact_id])],
    readiness: readiness(visualArtifact.artifact_id),
    provenance: provenance(createdAt, options.asset ? [options.asset.reference] : []),
  };
  validateCanonicalWorldManifest(manifest);
  const manifestBytes = jsonBytes(manifest);
  return {
    manifest,
    manifestBytes,
    reference: manifestReference("world", worldId, manifest.version_id, 1, manifestBytes) as WorldBundle["reference"],
    captureBytes,
    visualBytes,
    delta: null,
    deltaBytes: null,
  };
}

function makeChild(parent: WorldBundle, options: {
  versionId?: string;
  visualBytes?: Buffer;
  createdAt?: string;
} = {}): WorldBundle {
  const version = parent.manifest.version + 1;
  const versionId = options.versionId ?? `${parent.manifest.world_id}_v${version}`;
  const createdAt = options.createdAt ?? `2026-08-09T10:${10 + version}:00.000Z`;
  const visualBytes = options.visualBytes ?? Buffer.from(`world-visual-v${version}`);
  const before = parent.manifest.artifacts.find((entry) => entry.role === "visual_splat")!;
  const after = artifact(
    `world_visual_v${version}`,
    "visual_splat",
    content(`world/visual-v${version}.spz`, visualBytes, "application/octet-stream"),
    "visual",
    createdAt,
  );
  const delta: CanonicalDeltaV1 = {
    schema: CANONICAL_DELTA_SCHEMA,
    delta_id: `replace_visual_v${version}_${versionId}`,
    scope: "world",
    parent: parent.reference,
    result: { kind: "world", id: parent.manifest.world_id, version_id: versionId, version },
    created_at: createdAt,
    intent: "replace",
    operations: [{
      operation_id: `replace_visual_v${version}`,
      target_id: before.artifact_id,
      effect: { kind: "artifact_binding", before: [before], after: [after] },
    }],
    authority_effect: "none",
    provenance: provenance(createdAt, [parent.reference], [before.artifact_id]),
  };
  validateCanonicalDelta(delta);
  const deltaBytes = jsonBytes(delta);
  const captureArtifact = parent.manifest.artifacts.find((entry) => entry.role === "source_manifest")!;
  const manifest: CanonicalWorldManifestV2 = {
    ...structuredClone(parent.manifest),
    version_id: versionId,
    version,
    parent: parent.reference,
    created_at: createdAt,
    artifacts: [structuredClone(captureArtifact), after],
    applied_delta: {
      delta_id: delta.delta_id,
      manifest: content(`history/${delta.delta_id}.json`, deltaBytes, "application/json"),
    },
    authorities: [authority("visual", [after.artifact_id])],
    readiness: readiness(after.artifact_id),
    provenance: provenance(createdAt, [parent.reference]),
  };
  validateCanonicalWorldManifest(manifest);
  validateCanonicalTransitionBinding(parent.manifest, delta, manifest, {
    parent_manifest_sha256: parent.reference.manifest_sha256,
    delta_manifest_sha256: sha256(deltaBytes),
  });
  const manifestBytes = jsonBytes(manifest);
  return {
    manifest,
    manifestBytes,
    reference: manifestReference(
      "world",
      manifest.world_id,
      manifest.version_id,
      version,
      manifestBytes,
    ) as WorldBundle["reference"],
    captureBytes: parent.captureBytes,
    visualBytes,
    delta,
    deltaBytes,
  };
}

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `world-package-store-${name}-`));
  temporaryRoots.push(root);
  return root;
}

async function compiledChildStoreUrl(): Promise<string> {
  if (childStoreModuleUrl) return childStoreModuleUrl;
  const outputRoot = await temporaryRoot("child-store-module");
  const storeSourcePath = fileURLToPath(new URL("./world-package-store.ts", import.meta.url));
  const coreSourcePath = fileURLToPath(
    new URL("../../../packages/world-core/src/world-graph-contract.ts", import.meta.url),
  );
  const [storeSource, coreSource] = await Promise.all([
    readFile(storeSourcePath, "utf8"),
    readFile(coreSourcePath, "utf8"),
  ]);
  const typescript = createRequire(import.meta.url)("typescript") as typeof import("typescript");
  const compilerOptions: import("typescript").CompilerOptions = {
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.ES2022,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
  };
  const coreOutput = typescript.transpileModule(coreSource, { compilerOptions }).outputText;
  const storeOutput = typescript.transpileModule(
    storeSource.replaceAll('"@world-studio/world-core"', '"./world-core.mjs"'),
    { compilerOptions },
  ).outputText;
  await writeFile(join(outputRoot, "world-core.mjs"), coreOutput);
  const storeOutputPath = join(outputRoot, "world-package-store.mjs");
  await writeFile(storeOutputPath, storeOutput);
  childStoreModuleUrl = pathToFileURL(storeOutputPath).href;
  return childStoreModuleUrl;
}

interface ChildStoreOutcome {
  ok: boolean;
  status?: string;
  code?: string;
  message?: string;
}

interface RecoveryMemoryProbeResult {
  peakHeavyEntries: number;
  retainedHeavyEntries: number;
  lightweightEntryShapes: string[];
  openedReferences: CanonicalVersionReferenceV1[];
}

function spawnStoreOperation(
  moduleUrl: string,
  root: string,
  action: "initialize" | "publish",
  sourceRoot = "",
): { child: ReturnType<typeof spawn>; completed: Promise<ChildStoreOutcome> } {
  const script = `
    const { CanonicalWorldPackageStore } = await import(process.env.WPS_MODULE_URL);
    try {
      const store = new CanonicalWorldPackageStore(process.env.WPS_ROOT);
      if (process.env.WPS_ACTION === "publish") {
        const result = await store.publishDirectory({ sourceRoot: process.env.WPS_SOURCE_ROOT, manifestPath: "manifest.json" });
        process.stdout.write(JSON.stringify({ ok: true, status: result.status }) + "\\n");
      } else {
        await store.initialize();
        process.stdout.write(JSON.stringify({ ok: true }) + "\\n");
      }
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        code: error && typeof error === "object" && "code" in error ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      }) + "\\n");
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      ...process.env,
      WPS_MODULE_URL: moduleUrl,
      WPS_ROOT: root,
      WPS_ACTION: action,
      WPS_SOURCE_ROOT: sourceRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const completed = new Promise<ChildStoreOutcome>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", () => {
      const line = stdout.trim().split("\n").at(-1);
      if (!line) {
        reject(new Error(`Child store process returned no result. ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(line) as ChildStoreOutcome);
      } catch {
        reject(new Error(`Child store process returned invalid JSON: ${stdout} ${stderr}`));
      }
    });
  });
  return { child, completed };
}

async function runRecoveryMemoryProbe(
  moduleUrl: string,
  root: string,
  references: CanonicalVersionReferenceV1[],
): Promise<RecoveryMemoryProbeResult> {
  const script = `
    const { CanonicalWorldPackageStore } = await import(process.env.WPS_MODULE_URL);
    const prototype = CanonicalWorldPackageStore.prototype;
    const originalVerifyEntry = prototype.verifyEntry;
    const weakEntries = [];
    let peakHeavyEntries = 0;
    const collect = async () => {
      for (let pass = 0; pass < 3; pass += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        global.gc();
      }
    };
    const liveHeavyEntries = () => weakEntries.reduce(
      (count, reference) => count + (reference.deref() ? 1 : 0),
      0,
    );
    prototype.verifyEntry = async function (...args) {
      const verified = await originalVerifyEntry.apply(this, args);
      weakEntries.push(new WeakRef(verified));
      global.gc();
      peakHeavyEntries = Math.max(peakHeavyEntries, liveHeavyEntries());
      return verified;
    };
    try {
      const store = new CanonicalWorldPackageStore(process.env.WPS_ROOT);
      await store.initialize();
      prototype.verifyEntry = originalVerifyEntry;
      await collect();
      const retainedHeavyEntries = liveHeavyEntries();
      const lightweightEntryShapes = [...store.entries.values()]
        .map((entry) => Object.keys(entry).sort().join(","));
      const openedReferences = [];
      for (const reference of JSON.parse(process.env.WPS_REFERENCES)) {
        openedReferences.push((await store.openVersion(reference)).reference);
      }
      process.stdout.write(JSON.stringify({
        ok: true,
        peakHeavyEntries,
        retainedHeavyEntries,
        lightweightEntryShapes,
        openedReferences,
      }) + "\\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.stack : String(error),
      }) + "\\n");
    } finally {
      prototype.verifyEntry = originalVerifyEntry;
    }
  `;
  const child = spawn(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], {
    env: {
      ...process.env,
      WPS_MODULE_URL: moduleUrl,
      WPS_ROOT: root,
      WPS_REFERENCES: JSON.stringify(references),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", () => {
      const line = stdout.trim().split("\n").at(-1);
      if (!line) {
        reject(new Error(`Recovery memory probe returned no result. ${stderr}`));
        return;
      }
      const result = JSON.parse(line) as { ok: boolean; message?: string } & RecoveryMemoryProbeResult;
      if (!result.ok) {
        reject(new Error(`Recovery memory probe failed: ${result.message ?? stderr}`));
        return;
      }
      resolve(result);
    });
  });
}

function spawnForeignIncomingOwner(
  root: string,
  holdMilliseconds: number,
): { child: ReturnType<typeof spawn>; ready: Promise<{ name: string }>; completed: Promise<void> } {
  const script = `
    const { mkdir, writeFile } = require("node:fs/promises");
    const { randomUUID } = require("node:crypto");
    const path = require("node:path");
    process.on("SIGTERM", () => process.exit(0));
    (async () => {
      const name = process.pid + "." + randomUUID() + "." + randomUUID();
      const revision = path.join(process.env.WPS_ROOT, ".incoming", name, "revision");
      await mkdir(revision, { recursive: true });
      await writeFile(path.join(revision, "sentinel"), "preserve");
      process.stdout.write(JSON.stringify({ name }) + "\\n");
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.WPS_HOLD_MS)));
    })().catch((error) => {
      process.stderr.write(String(error));
      process.exitCode = 1;
    });
  `;
  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, WPS_ROOT: root, WPS_HOLD_MS: String(holdMilliseconds) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = new Promise<{ name: string }>((resolve, reject) => {
    let stdout = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      stdout += chunk;
      const line = stdout.split("\n")[0];
      if (!line) return;
      try {
        resolve(JSON.parse(line) as { name: string });
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
  });
  const completed = new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Foreign incoming owner exited ${code}: ${stderr}`));
    });
  });
  return { child, ready, completed };
}

async function writeRelative(root: string, relativePath: string, bytes: Uint8Array): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function writeAssetSource(bundle: AssetBundle, name = "asset-source"): Promise<string> {
  const root = await temporaryRoot(name);
  await writeRelative(root, "manifest.json", bundle.manifestBytes);
  const visual = bundle.manifest.artifacts.find((entry) => entry.role === "visual_mesh")!;
  await writeRelative(root, visual.content.path, bundle.artifactBytes);
  if (!bundle.manifest.parent) {
    const inherited = bundle.manifest.artifacts.find((entry) => entry.role === "visual_texture")!;
    await writeRelative(root, inherited.content.path, bundle.inheritedBytes);
  }
  if (bundle.delta && bundle.deltaBytes && bundle.manifest.applied_delta) {
    await writeRelative(root, bundle.manifest.applied_delta.manifest.path, bundle.deltaBytes);
  }
  return root;
}

async function writeWorldSource(bundle: WorldBundle, name = "world-source"): Promise<string> {
  const root = await temporaryRoot(name);
  await writeRelative(root, "manifest.json", bundle.manifestBytes);
  await writeRelative(root, bundle.manifest.capture_evidence[0]!.manifest.path, bundle.captureBytes);
  const visual = bundle.manifest.artifacts.find((entry) => entry.role === "visual_splat")!;
  await writeRelative(root, visual.content.path, bundle.visualBytes);
  if (bundle.delta && bundle.deltaBytes && bundle.manifest.applied_delta) {
    await writeRelative(root, bundle.manifest.applied_delta.manifest.path, bundle.deltaBytes);
  }
  return root;
}

function versionRoot(storeRoot: string, reference: CanonicalVersionReferenceV1): string {
  const collection = reference.kind === "world" ? "worlds" : "assets";
  return join(storeRoot, collection, reference.id, "versions", reference.version.toString().padStart(10, "0"));
}

async function initializedStore(name: string, bounds?: ConstructorParameters<typeof CanonicalWorldPackageStore>[1]) {
  const root = await temporaryRoot(name);
  const store = new CanonicalWorldPackageStore(root, bounds);
  await store.initialize();
  return { root, store };
}

async function expectStoreCode(
  operation: Promise<unknown>,
  code: CanonicalWorldPackageStoreError["code"],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ name: "CanonicalWorldPackageStoreError", code });
}

async function waitForIncomingPublication(root: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await readdir(join(root, ".incoming"))).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for an active canonical package publication.");
}

describe("CanonicalWorldPackageStore publication", () => {
  it("publishes an Asset before a World, stores its transitive closure, and reopens exact bytes without the sources", async () => {
    const { root, store } = await initializedStore("transitive");
    const asset = makeAsset();
    const assetSource = await writeAssetSource(asset);
    expect((await store.publishDirectory({ sourceRoot: assetSource, manifestPath: "manifest.json" })).status).toBe("accepted");

    const world = makeWorld({ asset });
    const worldSource = await writeWorldSource(world);
    const wrongNestedManifest = jsonBytes(makeAsset("wrong_asset").manifest);
    await writeRelative(worldSource, world.manifest.assets[0]!.manifest.path, wrongNestedManifest);
    expect((await store.publishDirectory({ sourceRoot: worldSource, manifestPath: "manifest.json" })).status).toBe("accepted");
    await rm(assetSource, { recursive: true, force: true });
    await rm(worldSource, { recursive: true, force: true });

    const reopened = await new CanonicalWorldPackageStore(root).openVersion(world.reference);
    expect(reopened.reference).toEqual(world.reference);
    expect(reopened.manifest).toEqual(world.manifest);
    expect(reopened.manifestBytes).toEqual(world.manifestBytes);
    expect(reopened.manifestSizeBytes).toBe(world.manifestBytes.byteLength);
    expect(reopened.delta).toBeNull();
    expect(await readFile(join(versionRoot(root, world.reference), "record/manifest.json"))).toEqual(world.manifestBytes);
    expect(await store.readReferencedBytes(world.reference, "evidence/capture.json", 1_000)).toEqual(world.captureBytes);
    expect(await store.readReferencedBytes(world.reference, world.manifest.assets[0]!.manifest.path, 100_000))
      .toEqual(asset.manifestBytes);
    expect(await store.readReferencedBytes(world.reference, asset.manifest.artifacts[0]!.content.path, 1_000))
      .toEqual(asset.artifactBytes);
    expect(await store.readReferencedBytes(world.reference, asset.manifest.artifacts[1]!.content.path, 1_000))
      .toEqual(asset.inheritedBytes);
  });

  it("appends an immediate child with an exact parent and Delta while copying unchanged parent bytes", async () => {
    const { store } = await initializedStore("append");
    const parent = makeWorld();
    await store.publishDirectory({ sourceRoot: await writeWorldSource(parent), manifestPath: "manifest.json" });
    const child = makeChild(parent);
    const childSource = await writeWorldSource(child);
    await rm(join(childSource, child.manifest.capture_evidence[0]!.manifest.path));

    const result = await store.publishDirectory({ sourceRoot: childSource, manifestPath: "manifest.json" });

    expect(result.status).toBe("accepted");
    expect(result.reference).toEqual(child.reference);
    expect(result.delta).toEqual(child.delta);
    expect(await store.readReferencedBytes(child.reference, "evidence/capture.json", 1_000)).toEqual(parent.captureBytes);
    expect(await store.readReferencedBytes(child.reference, child.manifest.applied_delta!.manifest.path, 100_000))
      .toEqual(child.deltaBytes);
    await expectStoreCode(store.readReferencedBytes(child.reference, "world/visual-v1.spz", 1_000), "not_found");
    expect((await store.openVersion(parent.reference)).manifest).toEqual(parent.manifest);
  });

  it("publishes an Asset child from inherited and changed bytes, then freezes that exact closure into a World", async () => {
    const { root, store } = await initializedStore("asset-child-closure");
    const assetParent = makeAsset("revisioned_asset");
    const parentSource = await writeAssetSource(assetParent, "asset-parent-source");
    await store.publishDirectory({ sourceRoot: parentSource, manifestPath: "manifest.json" });
    await rm(parentSource, { recursive: true, force: true });

    const assetChild = makeAssetChild(assetParent);
    const childSource = await writeAssetSource(assetChild, "asset-child-source");
    const inheritedPath = assetChild.manifest.artifacts.find((entry) => entry.role === "visual_texture")!.content.path;
    await expect(readFile(join(childSource, inheritedPath))).rejects.toMatchObject({ code: "ENOENT" });
    await store.publishDirectory({ sourceRoot: childSource, manifestPath: "manifest.json" });
    await rm(childSource, { recursive: true, force: true });

    const world = makeWorld({ worldId: "asset_child_world", asset: assetChild });
    const worldSource = await writeWorldSource(world, "asset-child-world-source");
    await store.publishDirectory({ sourceRoot: worldSource, manifestPath: "manifest.json" });
    await rm(worldSource, { recursive: true, force: true });

    const restarted = new CanonicalWorldPackageStore(root);
    await restarted.initialize();
    const reopenedAsset = await restarted.openVersion(assetChild.reference);
    expect(reopenedAsset.manifestBytes).toEqual(assetChild.manifestBytes);
    expect(reopenedAsset.delta).toEqual(assetChild.delta);
    expect(await restarted.readReferencedBytes(assetChild.reference, inheritedPath, 1_000)).toEqual(assetChild.inheritedBytes);
    expect(await restarted.readReferencedBytes(
      assetChild.reference,
      assetChild.manifest.artifacts.find((entry) => entry.role === "visual_mesh")!.content.path,
      1_000,
    )).toEqual(assetChild.artifactBytes);
    expect(await restarted.readReferencedBytes(world.reference, world.manifest.assets[0]!.manifest.path, 100_000))
      .toEqual(assetChild.manifestBytes);
    expect(await restarted.readReferencedBytes(world.reference, inheritedPath, 1_000)).toEqual(assetChild.inheritedBytes);
    expect(await restarted.readReferencedBytes(world.reference, assetChild.manifest.applied_delta!.manifest.path, 100_000))
      .toEqual(assetChild.deltaBytes);
  });

  it("treats exact retries and concurrent identical publications as duplicates, but rejects changed identities", async () => {
    const { store } = await initializedStore("idempotence");
    const first = makeWorld();
    const source = await writeWorldSource(first);
    expect((await store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" })).status).toBe("accepted");
    expect((await store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" })).status).toBe("duplicate");

    const concurrent = makeWorld({ worldId: "concurrent_world" });
    const concurrentSource = await writeWorldSource(concurrent, "concurrent-source");
    const results = await Promise.all([
      store.publishDirectory({ sourceRoot: concurrentSource, manifestPath: "manifest.json" }),
      store.publishDirectory({ sourceRoot: concurrentSource, manifestPath: "manifest.json" }),
    ]);
    expect(results.map((entry) => entry.status).sort()).toEqual(["accepted", "duplicate"]);

    const changed = makeWorld({ visualBytes: Buffer.from("conflicting-visual") });
    await expectStoreCode(
      store.publishDirectory({ sourceRoot: await writeWorldSource(changed, "conflict-source"), manifestPath: "manifest.json" }),
      "conflict",
    );
  }, 20_000);

  it("serializes conflicting concurrent children and rejects a second branch at the same version", async () => {
    const { store } = await initializedStore("branches");
    const parent = makeWorld();
    await store.publishDirectory({ sourceRoot: await writeWorldSource(parent), manifestPath: "manifest.json" });
    const left = makeChild(parent, { versionId: "test_world_v2_left", visualBytes: Buffer.from("left") });
    const right = makeChild(parent, { versionId: "test_world_v2_right", visualBytes: Buffer.from("right") });
    const settled = await Promise.allSettled([
      store.publishDirectory({ sourceRoot: await writeWorldSource(left, "left-branch"), manifestPath: "manifest.json" }),
      store.publishDirectory({ sourceRoot: await writeWorldSource(right, "right-branch"), manifestPath: "manifest.json" }),
    ]);

    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected")!;
    expect(rejected.reason).toMatchObject({ name: "CanonicalWorldPackageStoreError", code: "conflict" });
  });

  it("coordinates identical and conflicting publications from independent store instances", async () => {
    const identicalRoot = await temporaryRoot("independent-identical");
    const identicalStores = [
      new CanonicalWorldPackageStore(identicalRoot),
      new CanonicalWorldPackageStore(identicalRoot),
    ];
    await Promise.all(identicalStores.map((store) => store.initialize()));
    const identical = makeWorld({ worldId: "independent_identical" });
    const identicalSource = await writeWorldSource(identical, "independent-identical-source");
    const identicalResults = await Promise.all(identicalStores.map((store) =>
      store.publishDirectory({ sourceRoot: identicalSource, manifestPath: "manifest.json" })));
    expect(identicalResults.map((entry) => entry.status).sort()).toEqual(["accepted", "duplicate"]);

    const conflictingRoot = await temporaryRoot("independent-conflicting");
    const conflictingStores = [
      new CanonicalWorldPackageStore(conflictingRoot),
      new CanonicalWorldPackageStore(conflictingRoot),
    ];
    await Promise.all(conflictingStores.map((store) => store.initialize()));
    const left = makeWorld({ worldId: "independent_conflict", visualBytes: Buffer.from("left-visual") });
    const right = makeWorld({ worldId: "independent_conflict", visualBytes: Buffer.from("right-visual") });
    const conflictingResults = await Promise.allSettled([
      conflictingStores[0]!.publishDirectory({
        sourceRoot: await writeWorldSource(left, "independent-left"),
        manifestPath: "manifest.json",
      }),
      conflictingStores[1]!.publishDirectory({
        sourceRoot: await writeWorldSource(right, "independent-right"),
        manifestPath: "manifest.json",
      }),
    ]);
    expect(conflictingResults.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    const conflict = conflictingResults.find((entry): entry is PromiseRejectedResult => entry.status === "rejected")!;
    expect(conflict.reason).toMatchObject({ name: "CanonicalWorldPackageStoreError", code: "conflict" });
  }, 30_000);

  it("does not let a second store initialization delete another instance's active incoming publication", async () => {
    const root = await temporaryRoot("active-incoming");
    const publisher = new CanonicalWorldPackageStore(root);
    await publisher.initialize();
    const bundle = makeWorld({
      worldId: "active_incoming_world",
      visualBytes: Buffer.alloc(4 * 1024 * 1024, 0x5a),
    });
    const source = await writeWorldSource(bundle, "active-incoming-source");

    const publication = publisher.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" });
    await waitForIncomingPublication(root);
    const recovering = new CanonicalWorldPackageStore(root);
    await Promise.all([publication, recovering.initialize()]);

    expect((await recovering.openVersion(bundle.reference)).manifestBytes).toEqual(bundle.manifestBytes);
    expect(await readdir(join(root, ".incoming"))).toEqual([]);
  }, 30_000);

  it("reconciles true child-process final-slot races without accepting conflicting bytes", async () => {
    const moduleUrl = await compiledChildStoreUrl();
    const identicalRoot = await temporaryRoot("child-identical-race");
    const identical = makeWorld({ worldId: "child_identical_race" });
    const identicalSource = await writeWorldSource(identical, "child-identical-source");
    const identicalChildren = [
      spawnStoreOperation(moduleUrl, identicalRoot, "publish", identicalSource),
      spawnStoreOperation(moduleUrl, identicalRoot, "publish", identicalSource),
    ];
    const identicalOutcomes = await Promise.all(identicalChildren.map((entry) => entry.completed));
    expect(identicalOutcomes.filter((entry) => entry.ok && entry.status === "accepted")).toHaveLength(1);
    expect(identicalOutcomes.filter((entry) =>
      (entry.ok && entry.status === "duplicate") || (!entry.ok && entry.code === "conflict"))).toHaveLength(1);
    const identicalStore = new CanonicalWorldPackageStore(identicalRoot);
    await identicalStore.initialize();
    expect((await identicalStore.publishDirectory({
      sourceRoot: identicalSource,
      manifestPath: "manifest.json",
    })).status).toBe("duplicate");
    expect((await readdir(identicalRoot)).sort()).toEqual([".incoming", "assets", "worlds"]);

    const conflictingRoot = await temporaryRoot("child-conflicting-race");
    const left = makeWorld({ worldId: "child_conflicting_race", visualBytes: Buffer.from("child-left") });
    const right = makeWorld({ worldId: "child_conflicting_race", visualBytes: Buffer.from("child-right") });
    const conflictingChildren = [
      spawnStoreOperation(
        moduleUrl,
        conflictingRoot,
        "publish",
        await writeWorldSource(left, "child-conflicting-left"),
      ),
      spawnStoreOperation(
        moduleUrl,
        conflictingRoot,
        "publish",
        await writeWorldSource(right, "child-conflicting-right"),
      ),
    ];
    const conflictingOutcomes = await Promise.all(conflictingChildren.map((entry) => entry.completed));
    expect(conflictingOutcomes.filter((entry) => entry.ok && entry.status === "accepted")).toHaveLength(1);
    expect(conflictingOutcomes.filter((entry) => !entry.ok && entry.code === "conflict")).toHaveLength(1);
    const winningReference = conflictingOutcomes[0]!.ok ? left.reference : right.reference;
    expect((await new CanonicalWorldPackageStore(conflictingRoot).openVersion(winningReference)).reference)
      .toEqual(winningReference);
  }, 30_000);

  it("refreshes independent stale indexes before exact reads and child publication", async () => {
    const root = await temporaryRoot("stale-indexes");
    const first = new CanonicalWorldPackageStore(root);
    const second = new CanonicalWorldPackageStore(root);
    await Promise.all([first.initialize(), second.initialize()]);
    const parent = makeWorld({ worldId: "stale_index_world" });
    await first.publishDirectory({ sourceRoot: await writeWorldSource(parent), manifestPath: "manifest.json" });

    expect((await second.openVersion(parent.reference)).manifestBytes).toEqual(parent.manifestBytes);
    const child = makeChild(parent);
    expect((await second.publishDirectory({
      sourceRoot: await writeWorldSource(child),
      manifestPath: "manifest.json",
    })).status).toBe("accepted");
    expect((await first.openVersion(child.reference)).manifestBytes).toEqual(child.manifestBytes);
  });

  it("leaves no committed or incoming revision after a late source failure and returns duplicate after restart", async () => {
    const { root, store } = await initializedStore("atomic-failure");
    const bundle = makeWorld({ worldId: "CaseReserved" });
    const source = await writeWorldSource(bundle, "atomic-failure-source");
    await rm(join(source, "world/visual-v1.spz"));

    await expectStoreCode(store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" }), "invalid");
    await expectStoreCode(store.openVersion(bundle.reference), "not_found");
    expect(await readdir(join(root, ".incoming"))).toEqual([]);
    expect(await readdir(join(root, "worlds"))).toEqual([]);
    await expect(readFile(join(versionRoot(root, bundle.reference), "record/commit.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const later = makeWorld({ worldId: "casereserved" });
    const laterSource = await writeWorldSource(later, "casefold-later-source");
    expect((await store.publishDirectory({ sourceRoot: laterSource, manifestPath: "manifest.json" })).status).toBe("accepted");
    const restarted = new CanonicalWorldPackageStore(root);
    await restarted.initialize();
    expect((await restarted.publishDirectory({ sourceRoot: laterSource, manifestPath: "manifest.json" })).status).toBe("duplicate");
  });
});

describe("CanonicalWorldPackageStore source validation", () => {
  it.each([
    ["truncated JSON", Buffer.from("{\"schema\":")],
    ["duplicate members", Buffer.from(`{\"schema\":\"${CANONICAL_WORLD_SCHEMA}\",\"schema\":\"${CANONICAL_WORLD_SCHEMA}\"}`)],
    ["NaN", Buffer.from(`{\"schema\":\"${CANONICAL_WORLD_SCHEMA}\",\"version\":NaN}`)],
    ["invalid UTF-8", Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])],
  ])("rejects %s", async (_label, manifestBytes) => {
    const { store } = await initializedStore("malformed");
    const source = await temporaryRoot("malformed-source");
    await writeRelative(source, "manifest.json", manifestBytes);
    await expectStoreCode(store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" }), "invalid");
  });

  it("rejects legacy World v0.1 until it is explicitly migrated", async () => {
    const { store } = await initializedStore("legacy");
    const bundle = makeWorld();
    const source = await temporaryRoot("legacy-source");
    await writeRelative(
      source,
      "manifest.json",
      Buffer.from(bundle.manifestBytes.toString("utf8").replace(CANONICAL_WORLD_SCHEMA, "world_studio.world.v0.1")),
    );
    await expectStoreCode(store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" }), "invalid");
  });

  it("rejects missing, wrong-sized, and checksum-mismatched referenced source bytes", async () => {
    const bundle = makeWorld();

    const missing = await initializedStore("missing-source");
    const missingSource = await writeWorldSource(bundle, "missing-source-files");
    await rm(join(missingSource, "world/visual-v1.spz"));
    await expectStoreCode(missing.store.publishDirectory({ sourceRoot: missingSource, manifestPath: "manifest.json" }), "invalid");

    const wrongSize = await initializedStore("wrong-size");
    const wrongSizeSource = await writeWorldSource(bundle, "wrong-size-files");
    await writeFile(join(wrongSizeSource, "world/visual-v1.spz"), "short");
    await expectStoreCode(wrongSize.store.publishDirectory({ sourceRoot: wrongSizeSource, manifestPath: "manifest.json" }), "invalid");

    const wrongHash = await initializedStore("wrong-hash");
    const wrongHashSource = await writeWorldSource(bundle, "wrong-hash-files");
    await writeFile(join(wrongHashSource, "world/visual-v1.spz"), Buffer.alloc(bundle.visualBytes.byteLength, 0x78));
    await expectStoreCode(wrongHash.store.publishDirectory({ sourceRoot: wrongHashSource, manifestPath: "manifest.json" }), "invalid");
  });

  it("strictly validates referenced JSON and GLB bytes after their declared hashes match", async () => {
    const jsonCase = await initializedStore("referenced-json");
    const world = makeWorld({ worldId: "bad_referenced_json" });
    world.captureBytes = Buffer.from("{\"schema\":1,\"schema\":2}\n");
    const captureReference = content("evidence/capture.json", world.captureBytes, "application/json");
    world.manifest.artifacts[0]!.content = captureReference;
    world.manifest.capture_evidence[0]!.manifest = captureReference;
    validateCanonicalWorldManifest(world.manifest);
    world.manifestBytes = jsonBytes(world.manifest);
    await expectStoreCode(
      jsonCase.store.publishDirectory({ sourceRoot: await writeWorldSource(world), manifestPath: "manifest.json" }),
      "invalid",
    );

    const glbCase = await initializedStore("referenced-glb");
    const asset = makeAsset("bad_glb_asset", Buffer.from("not-a-valid-glb"));
    await expectStoreCode(
      glbCase.store.publishDirectory({ sourceRoot: await writeAssetSource(asset), manifestPath: "manifest.json" }),
      "invalid",
    );
  });

  it("rejects a symlinked source root and a manifest reached through a symlinked parent", async () => {
    const bundle = makeWorld({ worldId: "symlinked_source" });
    const realSource = await writeWorldSource(bundle, "real-source-root");
    const linkContainer = await temporaryRoot("source-root-link");
    const sourceLink = join(linkContainer, "linked-source");
    await symlink(realSource, sourceLink);
    const rootStore = await initializedStore("source-root-link-store");
    await expectStoreCode(
      rootStore.store.publishDirectory({ sourceRoot: sourceLink, manifestPath: "manifest.json" }),
      "invalid",
    );

    const manifestContainer = await temporaryRoot("manifest-parent-container");
    const manifestOutside = await temporaryRoot("manifest-parent-outside");
    await writeRelative(manifestOutside, "manifest.json", bundle.manifestBytes);
    await symlink(manifestOutside, join(manifestContainer, "linked"));
    const manifestStore = await initializedStore("manifest-parent-store");
    await expectStoreCode(
      manifestStore.store.publishDirectory({ sourceRoot: manifestContainer, manifestPath: "linked/manifest.json" }),
      "invalid",
    );
  });

  it.each(["../escape", "/absolute", "file:///tmp/evidence", "world\\visual.spz"])(
    "rejects unsafe path %s",
    async (unsafePath) => {
      const { store } = await initializedStore("unsafe-path");
      const bundle = makeWorld();
      bundle.manifest.artifacts[1]!.content.path = unsafePath;
      const source = await temporaryRoot("unsafe-source");
      await writeRelative(source, "manifest.json", jsonBytes(bundle.manifest));
      await expectStoreCode(store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" }), "invalid");
    },
  );

  it("rejects case-fold and file-prefix path conflicts before copying", async () => {
    const caseFold = makeWorld();
    const shared = Buffer.from("same-bytes");
    caseFold.manifest.artifacts[0]!.content = content("world/Case.bin", shared);
    caseFold.manifest.capture_evidence[0]!.manifest = caseFold.manifest.artifacts[0]!.content;
    caseFold.manifest.artifacts[1]!.content = content("world/case.bin", shared);
    validateCanonicalWorldManifest(caseFold.manifest);
    const caseSource = await temporaryRoot("casefold-source");
    await writeRelative(caseSource, "manifest.json", jsonBytes(caseFold.manifest));
    await writeRelative(caseSource, "world/Case.bin", shared);
    await writeRelative(caseSource, "world/case.bin", shared);
    const caseStore = await initializedStore("casefold-store");
    await expectStoreCode(caseStore.store.publishDirectory({ sourceRoot: caseSource, manifestPath: "manifest.json" }), "invalid");

    const prefix = makeWorld();
    prefix.manifest.artifacts[0]!.content.path = "world/blob";
    prefix.manifest.capture_evidence[0]!.manifest.path = "world/blob";
    prefix.manifest.artifacts[1]!.content.path = "world/blob/child.spz";
    validateCanonicalWorldManifest(prefix.manifest);
    const prefixSource = await temporaryRoot("prefix-source");
    await writeRelative(prefixSource, "manifest.json", jsonBytes(prefix.manifest));
    const prefixStore = await initializedStore("prefix-store");
    await expectStoreCode(prefixStore.store.publishDirectory({ sourceRoot: prefixSource, manifestPath: "manifest.json" }), "invalid");
  });

  it("rejects symlinks, hard links, and FIFOs as referenced evidence", async () => {
    const bundle = makeWorld();
    const referencePath = bundle.manifest.artifacts[1]!.content.path;

    const symlinkStore = await initializedStore("symlink-store");
    const symlinkSource = await writeWorldSource(bundle, "symlink-source");
    const outside = join(await temporaryRoot("symlink-outside"), "outside.spz");
    await writeFile(outside, bundle.visualBytes);
    await rm(join(symlinkSource, referencePath));
    await symlink(outside, join(symlinkSource, referencePath));
    await expectStoreCode(symlinkStore.store.publishDirectory({ sourceRoot: symlinkSource, manifestPath: "manifest.json" }), "invalid");

    const hardlinkStore = await initializedStore("hardlink-store");
    const hardlinkSource = await writeWorldSource(bundle, "hardlink-source");
    const original = join(hardlinkSource, "original.spz");
    await writeFile(original, bundle.visualBytes);
    await rm(join(hardlinkSource, referencePath));
    await link(original, join(hardlinkSource, referencePath));
    await expectStoreCode(hardlinkStore.store.publishDirectory({ sourceRoot: hardlinkSource, manifestPath: "manifest.json" }), "invalid");

    const fifoStore = await initializedStore("fifo-store");
    const fifoSource = await writeWorldSource(bundle, "fifo-source");
    const fifoPath = join(fifoSource, referencePath);
    await rm(fifoPath);
    await execFileAsync("mkfifo", [fifoPath]);
    await expectStoreCode(fifoStore.store.publishDirectory({ sourceRoot: fifoSource, manifestPath: "manifest.json" }), "invalid");
  });
});

describe("CanonicalWorldPackageStore lineage and dependencies", () => {
  it("requires an exact previously published Asset and ignores wrong source-side nested bytes", async () => {
    const { store } = await initializedStore("asset-dependency");
    const asset = makeAsset();
    const world = makeWorld({ asset });
    await expectStoreCode(
      store.publishDirectory({ sourceRoot: await writeWorldSource(world), manifestPath: "manifest.json" }),
      "conflict",
    );

    await store.publishDirectory({ sourceRoot: await writeAssetSource(asset), manifestPath: "manifest.json" });
    const source = await writeWorldSource(world, "nested-wrong-source");
    await writeRelative(source, world.manifest.assets[0]!.manifest.path, Buffer.from("wrong nested asset"));
    await store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" });
    expect(await store.readReferencedBytes(world.reference, world.manifest.assets[0]!.manifest.path, 100_000))
      .toEqual(asset.manifestBytes);
  });

  it("rejects a child without its parent, a skipped revision, and a second branch", async () => {
    const noParent = await initializedStore("no-parent");
    const parent = makeWorld();
    const child = makeChild(parent);
    await expectStoreCode(
      noParent.store.publishDirectory({ sourceRoot: await writeWorldSource(child), manifestPath: "manifest.json" }),
      "conflict",
    );

    const skipped = await initializedStore("skipped");
    await skipped.store.publishDirectory({ sourceRoot: await writeWorldSource(parent), manifestPath: "manifest.json" });
    const third = makeChild(child);
    await expectStoreCode(
      skipped.store.publishDirectory({ sourceRoot: await writeWorldSource(third), manifestPath: "manifest.json" }),
      "conflict",
    );

    const branched = await initializedStore("branched");
    await branched.store.publishDirectory({ sourceRoot: await writeWorldSource(parent), manifestPath: "manifest.json" });
    await branched.store.publishDirectory({ sourceRoot: await writeWorldSource(child), manifestPath: "manifest.json" });
    const other = makeChild(parent, { versionId: "test_world_v2_other", visualBytes: Buffer.from("other-branch") });
    await expectStoreCode(
      branched.store.publishDirectory({ sourceRoot: await writeWorldSource(other), manifestPath: "manifest.json" }),
      "conflict",
    );
  });

  it("rejects record IDs that collide by case across publications", async () => {
    const { store } = await initializedStore("casefold-ids");
    const upper = makeWorld({ worldId: "CaseFoldWorld" });
    const lower = makeWorld({ worldId: "casefoldworld" });
    await store.publishDirectory({ sourceRoot: await writeWorldSource(upper), manifestPath: "manifest.json" });
    await expectStoreCode(
      store.publishDirectory({ sourceRoot: await writeWorldSource(lower), manifestPath: "manifest.json" }),
      "conflict",
    );
  });

  it("fails corrupt when a committed parent, Asset dependency, or duplicate target was tampered", async () => {
    const parentCase = await initializedStore("corrupt-parent-reuse");
    const parent = makeWorld({ worldId: "corrupt_parent_reuse" });
    await parentCase.store.publishDirectory({ sourceRoot: await writeWorldSource(parent), manifestPath: "manifest.json" });
    await writeFile(join(versionRoot(parentCase.root, parent.reference), "content/world/visual-v1.spz"), "tampered");
    const child = makeChild(parent);
    await expectStoreCode(
      parentCase.store.publishDirectory({ sourceRoot: await writeWorldSource(child), manifestPath: "manifest.json" }),
      "corrupt",
    );

    const assetCase = await initializedStore("corrupt-asset-reuse");
    const asset = makeAsset("corrupt_asset_reuse");
    await assetCase.store.publishDirectory({ sourceRoot: await writeAssetSource(asset), manifestPath: "manifest.json" });
    await writeFile(
      join(versionRoot(assetCase.root, asset.reference), "content", asset.manifest.artifacts[0]!.content.path),
      "tampered",
    );
    const world = makeWorld({ worldId: "corrupt_asset_world", asset });
    await expectStoreCode(
      assetCase.store.publishDirectory({ sourceRoot: await writeWorldSource(world), manifestPath: "manifest.json" }),
      "corrupt",
    );

    const duplicateCase = await initializedStore("corrupt-duplicate");
    const duplicate = makeWorld({ worldId: "corrupt_duplicate" });
    const duplicateSource = await writeWorldSource(duplicate);
    await duplicateCase.store.publishDirectory({ sourceRoot: duplicateSource, manifestPath: "manifest.json" });
    const storedPath = join(versionRoot(duplicateCase.root, duplicate.reference), "content/world/visual-v1.spz");
    await writeFile(storedPath, "tampered");
    await expectStoreCode(
      duplicateCase.store.publishDirectory({ sourceRoot: duplicateSource, manifestPath: "manifest.json" }),
      "corrupt",
    );
    expect(await readFile(storedPath, "utf8")).toBe("tampered");
  });
});

describe("CanonicalWorldPackageStore recovery and corruption", () => {
  it("keeps recovery verification disposable and the durable index lightweight across many dependencies", async () => {
    const { root, store } = await initializedStore("bounded-recovery-memory");
    const asset = makeAsset("recovery_memory_asset");
    await store.publishDirectory({ sourceRoot: await writeAssetSource(asset), manifestPath: "manifest.json" });

    const versions = [makeWorld({ worldId: "recovery_memory_world", asset })];
    await store.publishDirectory({ sourceRoot: await writeWorldSource(versions[0]!), manifestPath: "manifest.json" });
    while (versions.length < 12) {
      const child = makeChild(versions.at(-1)!);
      await store.publishDirectory({ sourceRoot: await writeWorldSource(child), manifestPath: "manifest.json" });
      versions.push(child);
    }

    const references = [asset.reference, versions[0]!.reference, versions.at(-1)!.reference];
    const moduleUrl = await compiledChildStoreUrl();
    for (let pass = 0; pass < 2; pass += 1) {
      const probe = await runRecoveryMemoryProbe(moduleUrl, root, references);
      expect(probe.peakHeavyEntries).toBeLessThanOrEqual(4);
      expect(probe.retainedHeavyEntries).toBeLessThanOrEqual(1);
      expect(probe.lightweightEntryShapes).toHaveLength(13);
      expect(new Set(probe.lightweightEntryShapes)).toEqual(new Set(["reference,root"]));
      expect(probe.openedReferences).toEqual(references);
    }
  }, 30_000);

  it("discards stale incoming state and reopens a committed version after restart", async () => {
    const { root, store } = await initializedStore("restart");
    const bundle = makeWorld();
    await store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" });
    const deadOwner = spawnForeignIncomingOwner(root, 0);
    const { name: deadName } = await deadOwner.ready;
    await deadOwner.completed;
    const stale = join(root, ".incoming", deadName);

    const restarted = new CanonicalWorldPackageStore(root);
    await restarted.initialize();

    await expect(readFile(join(stale, "revision/sentinel"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await restarted.openVersion(bundle.reference)).manifest).toEqual(bundle.manifest);
  });

  it("never deletes live foreign staging and reclaims it only after its child owner exits", async () => {
    const { root } = await initializedStore("live-foreign-owner");
    const owner = spawnForeignIncomingOwner(root, 5_000);
    const { name } = await owner.ready;
    const sentinel = join(root, ".incoming", name, "revision/sentinel");
    try {
      await expectStoreCode(new CanonicalWorldPackageStore(root).initialize(), "conflict");
      expect(await readFile(sentinel, "utf8")).toBe("preserve");
    } finally {
      owner.child.kill("SIGTERM");
      await owner.completed;
    }

    await new CanonicalWorldPackageStore(root).initialize();
    await expect(readFile(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims dead-owner incoming state but fails closed on an unreachable empty final lineage", async () => {
    const { root } = await initializedStore("crash-empty-lineage");
    const lineage = join(root, "worlds/CrashResidue/versions");
    await mkdir(lineage, { recursive: true });
    const deadOwner = spawnForeignIncomingOwner(root, 0);
    const { name } = await deadOwner.ready;
    await deadOwner.completed;

    await expectStoreCode(new CanonicalWorldPackageStore(root).initialize(), "corrupt");

    await expect(readFile(join(root, ".incoming", name, "revision/sentinel"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(lineage)).toEqual([]);
  });

  it("fails closed on a non-directory incoming entry or unexpected root inventory", async () => {
    const symlinkCase = await initializedStore("incoming-symlink");
    const outside = await temporaryRoot("incoming-symlink-target");
    const sentinel = join(outside, "sentinel");
    await writeFile(sentinel, "preserve");
    await rm(join(symlinkCase.root, ".incoming"), { recursive: true });
    await symlink(outside, join(symlinkCase.root, ".incoming"));
    await expectStoreCode(new CanonicalWorldPackageStore(symlinkCase.root).initialize(), "corrupt");
    expect(await readFile(sentinel, "utf8")).toBe("preserve");

    const inventoryCase = await initializedStore("unexpected-root-entry");
    await writeFile(join(inventoryCase.root, ".untracked"), "unexpected");
    await expectStoreCode(new CanonicalWorldPackageStore(inventoryCase.root).initialize(), "corrupt");

    const malformedCase = await initializedStore("malformed-incoming-owner");
    await mkdir(join(malformedCase.root, ".incoming/not-an-owner/revision"), { recursive: true });
    await expectStoreCode(new CanonicalWorldPackageStore(malformedCase.root).initialize(), "corrupt");
  });

  it("reclaims current-PID staging from a prior process identity", async () => {
    const { root } = await initializedStore("same-pid-prior-identity");
    const ownerName = `${process.pid}.${randomUUID()}.${randomUUID()}`;
    const sentinel = join(root, ".incoming", ownerName, "revision/sentinel");
    await writeRelative(root, `.incoming/${ownerName}/revision/sentinel`, Buffer.from("stale"));

    await new CanonicalWorldPackageStore(root).initialize();

    await expect(readFile(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symlinked committed record, content, and version directories without touching their targets", async () => {
    for (const subtree of ["record", "content", "."] as const) {
      const storeCase = await initializedStore(`stored-symlink-${subtree.replace(".", "version")}`);
      const bundle = makeWorld({ worldId: `stored_symlink_${subtree.replace(".", "version")}` });
      await storeCase.store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" });
      const outside = await temporaryRoot(`stored-symlink-target-${subtree.replace(".", "version")}`);
      const sentinel = join(outside, "sentinel");
      await writeFile(sentinel, "preserve");
      const revision = versionRoot(storeCase.root, bundle.reference);
      const target = subtree === "." ? revision : join(revision, subtree);
      await rm(target, { recursive: true });
      await symlink(outside, target);

      await expectStoreCode(new CanonicalWorldPackageStore(storeCase.root).initialize(), "corrupt");
      expect(await readFile(sentinel, "utf8")).toBe("preserve");
    }
  });

  it("detects tampered manifests, referenced content, Delta bytes, and commit records", async () => {
    const manifestCase = await initializedStore("tamper-manifest");
    const manifestBundle = makeWorld({ worldId: "tamper_manifest" });
    await manifestCase.store.publishDirectory({ sourceRoot: await writeWorldSource(manifestBundle), manifestPath: "manifest.json" });
    await writeFile(join(versionRoot(manifestCase.root, manifestBundle.reference), "record/manifest.json"), "{}\n");
    await expectStoreCode(new CanonicalWorldPackageStore(manifestCase.root).initialize(), "corrupt");

    const contentCase = await initializedStore("tamper-content");
    const contentBundle = makeWorld({ worldId: "tamper_content" });
    await contentCase.store.publishDirectory({ sourceRoot: await writeWorldSource(contentBundle), manifestPath: "manifest.json" });
    await writeFile(join(versionRoot(contentCase.root, contentBundle.reference), "content/world/visual-v1.spz"), "tampered");
    await expectStoreCode(new CanonicalWorldPackageStore(contentCase.root).initialize(), "corrupt");

    const deltaCase = await initializedStore("tamper-delta");
    const deltaParent = makeWorld({ worldId: "tamper_delta" });
    await deltaCase.store.publishDirectory({ sourceRoot: await writeWorldSource(deltaParent), manifestPath: "manifest.json" });
    const deltaChild = makeChild(deltaParent);
    await deltaCase.store.publishDirectory({ sourceRoot: await writeWorldSource(deltaChild), manifestPath: "manifest.json" });
    await writeFile(
      join(versionRoot(deltaCase.root, deltaChild.reference), "content", deltaChild.manifest.applied_delta!.manifest.path),
      "{}\n",
    );
    await expectStoreCode(new CanonicalWorldPackageStore(deltaCase.root).initialize(), "corrupt");

    const commitCase = await initializedStore("tamper-commit");
    const commitBundle = makeWorld({ worldId: "tamper_commit" });
    await commitCase.store.publishDirectory({ sourceRoot: await writeWorldSource(commitBundle), manifestPath: "manifest.json" });
    await writeFile(join(versionRoot(commitCase.root, commitBundle.reference), "record/commit.json"), "{}\n");
    await expectStoreCode(new CanonicalWorldPackageStore(commitCase.root).initialize(), "corrupt");
  });

  it("rejects extra and missing files in a stored inventory", async () => {
    const extraCase = await initializedStore("extra-inventory");
    const extraBundle = makeWorld({ worldId: "extra_inventory" });
    await extraCase.store.publishDirectory({ sourceRoot: await writeWorldSource(extraBundle), manifestPath: "manifest.json" });
    await writeRelative(versionRoot(extraCase.root, extraBundle.reference), "content/undeclared.bin", Buffer.from("extra"));
    await expectStoreCode(new CanonicalWorldPackageStore(extraCase.root).initialize(), "corrupt");

    const missingCase = await initializedStore("missing-inventory");
    const missingBundle = makeWorld({ worldId: "missing_inventory" });
    await missingCase.store.publishDirectory({ sourceRoot: await writeWorldSource(missingBundle), manifestPath: "manifest.json" });
    await rm(join(versionRoot(missingCase.root, missingBundle.reference), "content/world/visual-v1.spz"));
    await expectStoreCode(new CanonicalWorldPackageStore(missingCase.root).initialize(), "corrupt");
  });

  it("rejects undeclared empty directories in finalized content inventory", async () => {
    const storeCase = await initializedStore("empty-final-directory");
    const bundle = makeWorld({ worldId: "empty_final_directory" });
    await storeCase.store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" });
    await mkdir(join(versionRoot(storeCase.root, bundle.reference), "content/undeclared/empty"), { recursive: true });

    await expectStoreCode(new CanonicalWorldPackageStore(storeCase.root).initialize(), "corrupt");
  });
});

describe("CanonicalWorldPackageStore bounds", () => {
  it("bounds aggregate recovery versions and references across a stored lineage", async () => {
    const { root, store } = await initializedStore("aggregate-recovery-bounds");
    const parent = makeWorld({ worldId: "aggregate_recovery_bounds" });
    const child = makeChild(parent);
    await store.publishDirectory({ sourceRoot: await writeWorldSource(parent), manifestPath: "manifest.json" });
    await store.publishDirectory({ sourceRoot: await writeWorldSource(child), manifestPath: "manifest.json" });

    await expectStoreCode(
      new CanonicalWorldPackageStore(root, { maxStoredVersions: 1 }).initialize(),
      "limit",
    );
    await expectStoreCode(
      new CanonicalWorldPackageStore(root, { maxRecoveryReferences: 4 }).initialize(),
      "limit",
    );
  });

  it("bounds deep directory-prefix expansion before touching referenced source files", async () => {
    const bundle = makeWorld({ worldId: "directory_prefix_bound" });
    const capture = bundle.manifest.capture_evidence[0]!.manifest;
    const captureArtifact = bundle.manifest.artifacts.find((entry) => entry.role === "source_manifest")!;
    const deepPrefix = Array.from({ length: 32 }, (_, index) => `level-${index.toString().padStart(2, "0")}`).join("/");
    capture.path = `${deepPrefix}/capture.json`;
    captureArtifact.content.path = capture.path;
    validateCanonicalWorldManifest(bundle.manifest);
    bundle.manifestBytes = jsonBytes(bundle.manifest);
    bundle.reference = manifestReference(
      "world",
      bundle.manifest.world_id,
      bundle.manifest.version_id,
      bundle.manifest.version,
      bundle.manifestBytes,
    ) as WorldBundle["reference"];

    const source = await temporaryRoot("directory-prefix-bound-source");
    await writeRelative(source, "manifest.json", bundle.manifestBytes);
    const { root, store } = await initializedStore("directory-prefix-bound-store", {
      maxContentDirectories: 4,
    });
    await expectStoreCode(store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" }), "limit");
    expect(await readdir(join(root, ".incoming"))).toEqual([]);
    expect(await readdir(join(root, "worlds"))).toEqual([]);
  });

  it("enforces manifest, file, revision, and referenced-file count bounds", async () => {
    const bundle = makeWorld();

    const manifestBound = await initializedStore("manifest-bound", { maxManifestBytes: 32 });
    await expectStoreCode(
      manifestBound.store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" }),
      "limit",
    );

    const fileBound = await initializedStore("file-bound", { maxReferencedFileBytes: bundle.visualBytes.byteLength - 1 });
    await expectStoreCode(
      fileBound.store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" }),
      "limit",
    );

    const revisionBound = await initializedStore("revision-bound", { maxRevisionBytes: bundle.manifestBytes.byteLength });
    await expectStoreCode(
      revisionBound.store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" }),
      "limit",
    );

    const countBound = await initializedStore("count-bound", { maxReferencedFiles: 1 });
    await expectStoreCode(
      countBound.store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" }),
      "limit",
    );
  });

  it("rehashes bounded reads and rejects unknown paths, excessive reads, and inexact references", async () => {
    const { store } = await initializedStore("bounded-read");
    const bundle = makeWorld();
    await store.publishDirectory({ sourceRoot: await writeWorldSource(bundle), manifestPath: "manifest.json" });

    expect(await store.readReferencedBytes(bundle.reference, "world/visual-v1.spz", bundle.visualBytes.byteLength))
      .toEqual(bundle.visualBytes);
    await expectStoreCode(
      store.readReferencedBytes(bundle.reference, "world/visual-v1.spz", bundle.visualBytes.byteLength - 1),
      "limit",
    );
    await expectStoreCode(store.readReferencedBytes(bundle.reference, "undeclared.bin", 1_000), "not_found");
    await expectStoreCode(
      store.openVersion({ ...bundle.reference, manifest_sha256: `sha256:${"f".repeat(64)}` }),
      "not_found",
    );
  });

  it("defaults renderer reads to 16 MiB and rejects explicit or referenced bytes above that hard cap", async () => {
    const constructorRoot = await temporaryRoot("renderer-cap-constructor");
    let constructorError: unknown;
    try {
      new CanonicalWorldPackageStore(constructorRoot, { maxReadBytes: rendererReadCapBytes + 1 });
    } catch (error) {
      constructorError = error;
    }
    expect(constructorError).toMatchObject({ name: "CanonicalWorldPackageStoreError", code: "invalid" });

    const smallCase = await initializedStore("default-renderer-read");
    const small = makeWorld({ worldId: "default_renderer_read" });
    await smallCase.store.publishDirectory({ sourceRoot: await writeWorldSource(small), manifestPath: "manifest.json" });
    expect(await smallCase.store.readReferencedBytes(small.reference, "world/visual-v1.spz")).toEqual(small.visualBytes);
    await expectStoreCode(
      smallCase.store.readReferencedBytes(
        small.reference,
        "world/visual-v1.spz",
        rendererReadCapBytes + 1,
      ),
      "limit",
    );

    const largeCase = await initializedStore("over-default-renderer-read");
    const large = makeWorld({ worldId: "over_default_renderer_read" });
    const largeSize = rendererReadCapBytes + 1;
    const largeVisual = large.manifest.artifacts.find((entry) => entry.role === "visual_splat")!;
    largeVisual.content = {
      ...largeVisual.content,
      sha256: sha256Zeros(largeSize),
      size_bytes: largeSize,
    };
    validateCanonicalWorldManifest(large.manifest);
    large.manifestBytes = jsonBytes(large.manifest);
    large.reference = manifestReference(
      "world",
      large.manifest.world_id,
      large.manifest.version_id,
      large.manifest.version,
      large.manifestBytes,
    ) as WorldBundle["reference"];
    const largeSource = await temporaryRoot("over-default-renderer-read-source");
    await writeRelative(largeSource, "manifest.json", large.manifestBytes);
    await writeRelative(largeSource, large.manifest.capture_evidence[0]!.manifest.path, large.captureBytes);
    await writeRelative(largeSource, largeVisual.content.path, Buffer.alloc(0));
    await truncate(join(largeSource, largeVisual.content.path), largeSize);
    await largeCase.store.publishDirectory({ sourceRoot: largeSource, manifestPath: "manifest.json" });
    await expectStoreCode(
      largeCase.store.readReferencedBytes(large.reference, "world/visual-v1.spz"),
      "limit",
    );
  }, 30_000);

  it("accounts for a long-path commit index in revision bounds before committing", async () => {
    const segment = "long-segment-".padEnd(180, "x");
    const bundle = makeWorld({ worldId: "long_commit_index" });
    const visual = bundle.manifest.artifacts.find((entry) => entry.role === "visual_splat")!;
    visual.content.path = `long/${segment}/${segment}/${segment}/visual.spz`;
    validateCanonicalWorldManifest(bundle.manifest);
    bundle.manifestBytes = jsonBytes(bundle.manifest);
    bundle.reference = manifestReference(
      "world",
      bundle.manifest.world_id,
      bundle.manifest.version_id,
      bundle.manifest.version,
      bundle.manifestBytes,
    ) as WorldBundle["reference"];
    const declaredRevisionBytes = bundle.manifestBytes.byteLength
      + bundle.manifest.capture_evidence[0]!.manifest.size_bytes
      + visual.content.size_bytes;
    const { root, store } = await initializedStore("long-commit-index-store", {
      maxManifestBytes: bundle.manifestBytes.byteLength,
      maxRevisionBytes: declaredRevisionBytes,
    });

    const source = await writeWorldSource(bundle);
    await rm(join(source, visual.content.path));
    await expectStoreCode(store.publishDirectory({ sourceRoot: source, manifestPath: "manifest.json" }), "limit");
    expect(await readdir(join(root, ".incoming"))).toEqual([]);
    expect(await readdir(join(root, "worlds"))).toEqual([]);
  });
});
