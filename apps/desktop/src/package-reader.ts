import { buildGaussianPreviewPointCloudPly, buildPointCloudPreviewPly } from "@world-studio/artifacts";
import { validateCaptureSplatTrainingDataset, type AuthorityStatus, type CaptureSplatMetricHandoff, type CaptureSplatQualityHandoff, type CaptureSplatTrainingDatasetV1, type FrameCamera, type LocalPackageInsight, type LocalPackageIssue, type LocalWorldPackageBinaryFile, type LocalWorldPackagePayload, type LocalWorldPackageTextFile, type WorldAssetManifestEntry } from "@world-studio/world-core";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { verifyCaptureSplatConsumerPackage, type CaptureSplatConsumerVerification } from "./capture-splat-consumer-receipt.js";
import { verifyCaptureSplatMeasuredEvidence } from "./capture-splat-measured-evidence.js";

const maxTextBytes = 64 * 1024 * 1024;
const maxBinaryBytes = 384 * 1024 * 1024;
const maxGaussianPreviewPoints = 50_000;
const maxCapturePreviewFrames = 24;
const maxCapturePreviewImageBytes = 16 * 1024 * 1024;
const maxPreviewChars = 8_000;
const captureSplatManifestPath = "capture-splat.world-studio.json";
const captureFrameDirs = ["source", "images", "rgb", "frames", "renders"];
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

interface CaptureSplatManifestRefs {
  cameraTrajectoryPaths: string[];
  captureManifestPaths: string[];
  cameraPosePaths: string[];
  framePaths: string[];
  gaussianPlyPaths: string[];
  gaussianProxyPaths: string[];
  measurementPointPaths: string[];
  meshReportPaths: string[];
  navigationMeshPaths: string[];
  objMeshPaths: string[];
  pointsPlyPaths: string[];
  plyStatsPaths: string[];
  renderSourceQaPaths: string[];
  roomSemanticsPaths: string[];
}

interface CaptureFramePreview {
  checksum: string;
  camera?: unknown;
  frameCamera?: FrameCamera;
  dataUrl: string;
  displayName: string;
  mimeType: string;
  relativePath: string;
  renderDataUrl?: string;
  renderPath?: string;
  sizeBytes: number;
}

interface FrameCameraIndex {
  exact: Map<string, FrameCamera>;
  ambiguousExact: Set<string>;
  aliases: Map<string, { sourcePath: string; camera: FrameCamera }>;
  ambiguousAliases: Set<string>;
}

interface StableManifestMarker {
  file: LocalWorldPackageTextFile;
  identity: string;
}

export async function readLocalPackage(inputPath: string): Promise<LocalWorldPackagePayload> {
  const selectedPath = path.resolve(inputPath);
  const selectedInfo = await stat(selectedPath);
  const sourceRoot = selectedInfo.isDirectory() ? selectedPath : path.dirname(selectedPath);
  const selectedFile = selectedInfo.isFile() ? path.basename(selectedPath) : undefined;
  const packageIssues: LocalPackageIssue[] = [];
  const selectedTextPly = selectedFile && isPlyFileName(selectedFile) && selectedInfo.size <= maxTextBytes
    ? await readOptionalText(sourceRoot, selectedFile, packageIssues)
    : undefined;
  const selectedCleanedPly = isWorldStudioCleanedPly(selectedTextPly) ? selectedTextPly : undefined;
  const captureSplatMarkerPresent = await packageEntryPresent(sourceRoot, captureSplatManifestPath);
  const standaloneCleanedPly = selectedCleanedPly && !captureSplatMarkerPresent ? selectedCleanedPly : undefined;
  const selectedGaussianPly = selectedFile && isPlyFileName(selectedFile) && !selectedCleanedPly ? selectedFile : undefined;
  const payloadSourcePath = standaloneCleanedPly ? selectedPath : sourceRoot;
  const cleanedFolderCandidates = standaloneCleanedPly ? [] : await findCleanedPlyCandidates(sourceRoot);
  const stableCaptureSplatMarker = captureSplatMarkerPresent
    ? await readStableManifestMarker(sourceRoot, captureSplatManifestPath)
    : undefined;
  let captureSplatManifest = stableCaptureSplatMarker?.file;
  const initialCaptureSplatManifest = captureSplatManifest
    ? parseJsonRecord(captureSplatManifest.text, captureSplatManifest.relativePath, packageIssues)
    : undefined;
  const captureSplatSchema = initialCaptureSplatManifest?.schema;
  const legacyCaptureSplatSchema = captureSplatSchema === "capture_splat.world_studio_handoff.v0.1"
    || captureSplatSchema === "capture_splat.world_studio_handoff.v0.2";
  const supportedLegacyCaptureSplatManifest = legacyCaptureSplatSchema
    && stableCaptureSplatMarker !== undefined
    && await manifestMarkerIdentityMatches(sourceRoot, captureSplatManifestPath, stableCaptureSplatMarker.identity);
  const captureSplatConsumerVerification = captureSplatMarkerPresent && !supportedLegacyCaptureSplatManifest
    ? await verifyCaptureSplatConsumerPackage(sourceRoot)
    : undefined;
  if (captureSplatConsumerVerification) {
    const verifiedManifestBytes = await captureSplatConsumerVerification.readVerifiedFile(captureSplatManifestPath, maxTextBytes);
    captureSplatManifest = verifiedManifestBytes && captureSplatConsumerVerification.manifestText !== undefined
      ? {
          relativePath: captureSplatManifestPath,
          text: captureSplatConsumerVerification.manifestText,
          sizeBytes: verifiedManifestBytes.byteLength,
          checksum: checksumBytes(verifiedManifestBytes),
        }
      : undefined;
  }
  const parsedCaptureSplatManifest = captureSplatConsumerVerification
    ? captureSplatConsumerVerification.verifiedPaths.has(captureSplatManifestPath)
      ? captureSplatConsumerVerification.manifest
      : undefined
    : initialCaptureSplatManifest;
  const verifiedCaptureSplatPaths = captureSplatConsumerVerification?.verifiedPaths;
  const captureSplatTrainingDataset = parsedCaptureSplatManifest
    ? await readCaptureSplatTrainingDataset(sourceRoot, parsedCaptureSplatManifest, packageIssues, captureSplatConsumerVerification)
    : undefined;
  const captureSplatRefs = parsedCaptureSplatManifest
    ? filterCaptureSplatRefs(extractCaptureSplatManifestRefs(parsedCaptureSplatManifest), verifiedCaptureSplatPaths)
    : emptyCaptureSplatRefs();
  const captureSplatPointsTransform = parsedCaptureSplatManifest ? captureSplatPointTransform(parsedCaptureSplatManifest) : undefined;
  const sceneFile = standaloneCleanedPly || !isAllowedPackagePath("scene.json", verifiedCaptureSplatPaths) ? undefined : await readOptionalText(sourceRoot, "scene.json", packageIssues, captureSplatConsumerVerification);
  const sourcePointsPly = standaloneCleanedPly
    ?? await readFirstPointCloud(sourceRoot, allowedPackagePaths(uniquePaths([...captureSplatRefs.pointsPlyPaths, "points.ply", "point_cloud.ply", "cloud.ply", ...cleanedFolderCandidates]), verifiedCaptureSplatPaths), packageIssues, captureSplatPointsTransform, captureSplatConsumerVerification);
  const cleanedPointPly = isWorldStudioCleanedPly(sourcePointsPly);
  const selectedGaussianPlyPaths = selectedGaussianPly ? [selectedGaussianPly] : [];
  const gaussianPly = standaloneCleanedPly ? undefined : await readFirstBinary(sourceRoot, allowedPackagePaths(uniquePaths([...selectedGaussianPlyPaths, ...captureSplatRefs.gaussianPlyPaths, "gaussians.ply", "splats.ply", "splat.ply"]), verifiedCaptureSplatPaths), packageIssues, captureSplatConsumerVerification);
  const generatedPointsPly = !sourcePointsPly && gaussianPly
    ? await readGaussianPreviewPointCloud(sourceRoot, gaussianPly.relativePath, packageIssues, captureSplatConsumerVerification)
    : undefined;
  const pointsPly = sourcePointsPly ?? generatedPointsPly;
  const objMesh = standaloneCleanedPly ? undefined : await readFirstText(sourceRoot, allowedPackagePaths(uniquePaths([...captureSplatRefs.objMeshPaths, "collision_mesh.obj", "mesh.obj", "model.obj"]), verifiedCaptureSplatPaths), packageIssues, captureSplatConsumerVerification);
  const captureSplatMetric = parsedCaptureSplatManifest
    ? await readCaptureSplatMetricHandoff(sourceRoot, parsedCaptureSplatManifest, captureSplatRefs, packageIssues, captureSplatConsumerVerification)
    : undefined;
  const captureSplatQuality = parsedCaptureSplatManifest
    ? await readCaptureSplatQualityHandoff(sourceRoot, captureSplatRefs, gaussianPly?.relativePath, packageIssues, captureSplatConsumerVerification)
    : undefined;
  const sourceBudoMediaFrames = standaloneCleanedPly || !isAllowedPackagePath("budo.media_frames.v0.8.json", verifiedCaptureSplatPaths) ? undefined : await readOptionalText(sourceRoot, "budo.media_frames.v0.8.json", packageIssues, captureSplatConsumerVerification);
  const captureSplatManifestFrames = sourceBudoMediaFrames || standaloneCleanedPly
    ? undefined
    : parsedCaptureSplatManifest
      ? await readCaptureFrameManifestFromManifest(sourceRoot, parsedCaptureSplatManifest, packageIssues, verifiedCaptureSplatPaths, captureSplatConsumerVerification)
      : await readCaptureFrameManifestFromPaths(sourceRoot, captureSplatRefs.framePaths, packageIssues, captureSplatConsumerVerification);
  const generatedCaptureFrames = sourceBudoMediaFrames || captureSplatManifestFrames || standaloneCleanedPly || captureSplatConsumerVerification ? undefined : await readCaptureFrameManifest(sourceRoot, packageIssues);
  const budoMediaFrames = sourceBudoMediaFrames ?? captureSplatManifestFrames ?? generatedCaptureFrames;
  const articleFigureViews = standaloneCleanedPly || !isAllowedPackagePath("budo.article_figure_3d_views.v0.1.json", verifiedCaptureSplatPaths) ? undefined : await readOptionalText(sourceRoot, "budo.article_figure_3d_views.v0.1.json", packageIssues, captureSplatConsumerVerification);
  const verifiedExport = standaloneCleanedPly || !isAllowedPackagePath("verified_export/manifest.json", verifiedCaptureSplatPaths) ? undefined : await readOptionalText(sourceRoot, "verified_export/manifest.json", packageIssues, captureSplatConsumerVerification);
  const jsonManifests = standaloneCleanedPly ? [] : await readPackageJsonManifests(sourceRoot, packageIssues, verifiedCaptureSplatPaths, captureSplatConsumerVerification);
  const parsedSceneJson = sceneFile ? parseJsonRecord(sceneFile.text, sceneFile.relativePath, packageIssues) : undefined;
  const sceneJson = parsedSceneJson && isSceneManifestRecord(parsedSceneJson) ? parsedSceneJson : undefined;
  if (sceneFile && parsedSceneJson && !sceneJson) {
    pushIssue(packageIssues, {
      artifact: sceneFile.relativePath,
      code: "unsupported_layout",
      message: "scene.json was readable JSON, but it did not include the scene fields World Studio expects.",
      severity: "warning",
      title: "Unsupported scene manifest"
    });
  }
  const companionArtifacts = [...new Set([
    captureSplatManifest?.relativePath,
    sceneFile?.relativePath,
    sourcePointsPly?.relativePath,
    gaussianPly?.relativePath,
    objMesh?.relativePath,
    captureSplatMetric?.navigationMesh?.relativePath,
    captureSplatMetric?.measurementPoints?.relativePath,
    captureSplatMetric?.meshReport?.relativePath,
    captureSplatMetric?.roomSemantics?.relativePath,
    captureSplatMetric?.cameraTrajectory?.relativePath,
    captureSplatQuality?.renderSourceQa?.relativePath,
    captureSplatQuality?.plyStats?.relativePath,
    budoMediaFrames?.relativePath,
    articleFigureViews?.relativePath,
    verifiedExport?.relativePath,
    ...jsonManifests.map((file) => file.relativePath)
  ].filter((entry): entry is string => Boolean(entry)))];
  const assetManifest = buildAssetManifest([
    captureSplatManifest,
    sceneFile,
    sourcePointsPly,
    gaussianPly,
    objMesh,
    captureSplatMetric?.navigationMesh,
    captureSplatMetric?.measurementPoints,
    captureSplatMetric?.meshReport,
    captureSplatMetric?.roomSemantics,
    captureSplatMetric?.cameraTrajectory,
    captureSplatQuality?.renderSourceQa,
    captureSplatQuality?.plyStats,
    budoMediaFrames,
    articleFigureViews,
    verifiedExport,
    ...jsonManifests
  ]);
  const hasCaptureSplatPackage = Boolean(captureSplatMarkerPresent || captureSplatManifest || captureSplatManifestFrames || generatedCaptureFrames);

  const packageKind = hasCaptureSplatPackage
    ? "capture-splat-local-folder"
    : classifyPackage({ articleFigureViews, budoMediaFrames, cleanedPointPly, pointsPly: sourcePointsPly, sceneFile, verifiedExport });
  const authorityStatus = classifyAuthority(packageKind);
  const primaryArtifact =
    verifiedExport?.relativePath ??
    (cleanedPointPly ? sourcePointsPly?.relativePath : undefined) ??
    gaussianPly?.relativePath ??
    pointsPly?.relativePath ??
    budoMediaFrames?.relativePath ??
    articleFigureViews?.relativePath ??
    objMesh?.relativePath ??
    jsonManifests[0]?.relativePath ??
    "folder";
  addPackageLayoutIssues({
    articleFigureViews,
    budoMediaFrames,
    captureSplatManifest,
    companionArtifacts,
    gaussianPly,
    jsonManifests,
    objMesh,
    packageIssues,
    pointsPly: sourcePointsPly,
    sceneFile,
    verifiedExport
  });
  if (captureSplatConsumerVerification?.receipt.decision === "hold") {
    pushIssue(packageIssues, {
      artifact: captureSplatManifestPath,
      code: "invalid_capture_splat_consumer_receipt",
      message: `Capture Splat package integrity is held with ${captureSplatConsumerVerification.receipt.issue_count} bounded issue(s).`,
      severity: "error",
      title: "Capture Splat package integrity held"
    });
  }
  if (
    supportedLegacyCaptureSplatManifest
    && stableCaptureSplatMarker
    && !await manifestMarkerIdentityMatches(sourceRoot, captureSplatManifestPath, stableCaptureSplatMarker.identity)
  ) {
    throw new Error("Capture Splat legacy handoff changed while the package was being read.");
  }

  return {
    kind: "world-studio.local-package",
    name: standaloneCleanedPly ? path.basename(payloadSourcePath, path.extname(payloadSourcePath)) : path.basename(sourceRoot),
    sourcePath: payloadSourcePath,
    loadedVia: "electron-picker",
    sourceKind:
      packageKind === "capture-splat-local-folder"
        ? "capture_splat.local_folder"
        : packageKind.startsWith("budo") || packageKind === "verified-semantic-export"
        ? "budo.local_folder"
        : packageKind === "external-local-folder"
          ? "external.local_folder"
          : packageKind === "world-studio-cleaned-ply"
            ? "world-studio.cleaned_ply"
          : "world-studio.local_folder",
    packageKind,
    primaryArtifact,
    companionArtifacts,
    assetManifest,
    authorityStatus,
    sceneJson,
    pointsPly,
    gaussianPly,
    objMesh,
    budoMediaFrames,
    articleFigureViews,
    verifiedExport,
    jsonManifests,
    captureSplatMetric,
    captureSplatQuality,
    captureSplatTrainingDataset,
    captureSplatConsumerReceipt: captureSplatConsumerVerification?.receipt,
    ...extractHandoffSceneHints(parsedCaptureSplatManifest),
    packageInsights: buildPackageInsights({
      articleFigureViews,
      budoMediaFrames,
      captureSplatManifest,
      gaussianPly,
      cleanedPointPly,
      jsonManifests,
      objMesh,
      pointsPly,
      sceneFile,
      verifiedExport
    }, packageIssues),
    packageIssues
  };
}

function classifyPackage(input: {
  articleFigureViews?: LocalWorldPackageTextFile;
  budoMediaFrames?: LocalWorldPackageTextFile;
  cleanedPointPly: boolean;
  pointsPly?: LocalWorldPackageTextFile;
  sceneFile?: LocalWorldPackageTextFile;
  verifiedExport?: LocalWorldPackageTextFile;
}): string {
  if (input.verifiedExport) return "verified-semantic-export";
  if (input.budoMediaFrames || input.articleFigureViews) return "budo-media-bundle";
  if (input.cleanedPointPly) return "world-studio-cleaned-ply";
  if (input.sceneFile && input.pointsPly) return "world-studio-local-folder";
  return "external-local-folder";
}

function classifyAuthority(packageKind: string): AuthorityStatus {
  if (packageKind === "verified-semantic-export") return "human_verified_semantic_labels";
  if (packageKind === "world-studio-cleaned-ply") return "proposal_not_ground_truth";
  if (packageKind === "external-local-folder") return "proposal_not_ground_truth";
  return "visual_evidence";
}

async function packageEntryPresent(root: string, relativePath: string): Promise<boolean> {
  try {
    await lstat(resolveInside(root, relativePath));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

async function readStableManifestMarker(root: string, relativePath: string): Promise<StableManifestMarker | undefined> {
  const filePath = resolveInside(root, relativePath);
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxTextBytes)) return undefined;
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (stableFileIdentity(opened) !== stableFileIdentity(before)) return undefined;
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      sizeBytes += bytesRead;
      if (sizeBytes > maxTextBytes) return undefined;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const openedAfter = await handle.stat({ bigint: true });
    const after = await lstat(filePath, { bigint: true });
    if (
      sizeBytes !== Number(before.size)
      || stableFileIdentity(openedAfter) !== stableFileIdentity(before)
      || stableFileIdentity(after) !== stableFileIdentity(before)
    ) return undefined;
    const bytes = Buffer.concat(chunks, sizeBytes);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return {
      file: { relativePath, text, sizeBytes, checksum: checksumBytes(bytes) },
      identity: stableFileIdentity(before),
    };
  } catch {
    return undefined;
  } finally {
    try {
      await handle?.close();
    } catch {
      return undefined;
    }
  }
}

async function manifestMarkerIdentityMatches(root: string, relativePath: string, identity: string): Promise<boolean> {
  try {
    const info = await lstat(resolveInside(root, relativePath), { bigint: true });
    return !info.isSymbolicLink() && info.isFile() && stableFileIdentity(info) === identity;
  } catch {
    return false;
  }
}

function stableFileIdentity(info: { dev: bigint; ino: bigint; size: bigint; mode: bigint; mtimeNs: bigint; ctimeNs: bigint }): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mode}:${info.mtimeNs}:${info.ctimeNs}`;
}

async function findCleanedPlyCandidates(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isCleanedPlyFileName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function isPlyFileName(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() === ".ply";
}

function isCleanedPlyFileName(fileName: string): boolean {
  return /^world-studio-cleaned-.+\.ply$/i.test(fileName);
}

function isWorldStudioCleanedPly(file?: LocalWorldPackageTextFile): boolean {
  if (!file) return false;
  return isCleanedPlyFileName(path.basename(file.relativePath))
    || file.text.slice(0, 4096).includes("World Studio cleaned ordinary PLY export");
}

async function readFirstText(root: string, relativePaths: string[], packageIssues?: LocalPackageIssue[], verification?: CaptureSplatConsumerVerification): Promise<LocalWorldPackageTextFile | undefined> {
  for (const relativePath of relativePaths) {
    const file = await readOptionalText(root, relativePath, packageIssues, verification);
    if (file) return file;
  }
  return undefined;
}

async function readFirstPointCloud(root: string, relativePaths: string[], packageIssues?: LocalPackageIssue[], transform?: number[][], verification?: CaptureSplatConsumerVerification): Promise<LocalWorldPackageTextFile | undefined> {
  for (const relativePath of relativePaths) {
    const filePath = resolveInside(root, relativePath);
    try {
      const bytes = verification
        ? await verification.readVerifiedFile(relativePath, maxBinaryBytes)
        : await readBoundedRegularFile(filePath, relativePath, maxBinaryBytes, "point-cloud assets", packageIssues);
      if (!bytes) continue;
      const headerText = bytes.subarray(0, 32 * 1024).toString("utf8");
      const text = headerText.includes("format ascii 1.0") && !transform
        ? bytes.toString("utf8")
        : buildPointCloudPreviewPly(bytes, { maxPoints: maxGaussianPreviewPoints, transform });
      return { relativePath, text, sizeBytes: bytes.byteLength, checksum: checksumBytes(bytes) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      pushIssue(packageIssues, {
        artifact: relativePath,
        code: "unsupported_layout",
        message: error instanceof Error ? `Could not prepare point-cloud preview: ${error.message}` : "Could not prepare point-cloud preview.",
        severity: "warning",
        title: "Point-cloud preview unavailable"
      });
    }
  }
  return undefined;
}

async function readBoundedRegularFile(
  filePath: string,
  relativePath: string,
  byteLimit: number,
  assetKind: string,
  packageIssues?: LocalPackageIssue[],
): Promise<Buffer | undefined> {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) return undefined;
  if (info.size > byteLimit) {
    pushIssue(packageIssues, {
      artifact: relativePath,
      code: "file_too_large",
      message: `${relativePath} is ${info.size} bytes; World Studio reads ${assetKind} up to ${byteLimit} bytes in this desktop bridge.`,
      severity: "error",
      title: "File too large"
    });
    return undefined;
  }
  return readFile(filePath);
}

async function readOptionalText(root: string, relativePath: string, packageIssues?: LocalPackageIssue[], verification?: CaptureSplatConsumerVerification): Promise<LocalWorldPackageTextFile | undefined> {
  const filePath = resolveInside(root, relativePath);
  try {
    if (verification) {
      const bytes = await verification.readVerifiedFile(relativePath, maxTextBytes);
      if (!bytes) return undefined;
      return { relativePath, text: bytes.toString("utf8"), sizeBytes: bytes.byteLength, checksum: checksumBytes(bytes) };
    }
    const info = await lstat(filePath);
    if (info.isSymbolicLink()) return undefined;
    if (!info.isFile()) return undefined;
    if (info.size > maxTextBytes) {
      pushIssue(packageIssues, {
        artifact: relativePath,
        code: "file_too_large",
        message: `${relativePath} is ${info.size} bytes; World Studio reads text manifests up to ${maxTextBytes} bytes.`,
        severity: "error",
        title: "File too large"
      });
      return undefined;
    }
    const text = await readFile(filePath, "utf8");
    const bytes = Buffer.from(text, "utf8");
    return { relativePath, text, sizeBytes: bytes.byteLength, checksum: checksumBytes(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    pushIssue(packageIssues, {
      artifact: relativePath,
      code: "unsupported_layout",
      message: `${relativePath} could not be read as a regular text file.`,
      severity: "warning",
      title: "Text file unavailable"
    });
    return undefined;
  }
}

async function readPackageJsonManifests(
  root: string,
  packageIssues?: LocalPackageIssue[],
  allowedPaths?: ReadonlySet<string>,
  verification?: CaptureSplatConsumerVerification,
): Promise<LocalWorldPackageTextFile[]> {
  const candidates = new Set<string>();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) candidates.add(entry.name);
  }
  for (const directory of ["metadata", "verified_export"]) {
    try {
      for (const entry of await readdir(resolveInside(root, directory), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) candidates.add(`${directory}/${entry.name}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const out: LocalWorldPackageTextFile[] = [];
  for (const relativePath of [...candidates].sort()) {
    if (!isAllowedPackagePath(relativePath, allowedPaths)) continue;
    const file = await readOptionalText(root, relativePath, packageIssues, verification);
    if (file) out.push(file);
  }
  return out;
}

async function readFirstBinary(root: string, relativePaths: string[], packageIssues?: LocalPackageIssue[], verification?: CaptureSplatConsumerVerification) {
  for (const relativePath of relativePaths) {
    const file = await readOptionalBinary(root, relativePath, packageIssues, verification);
    if (file) return file;
  }
  return undefined;
}

async function readOptionalBinary(root: string, relativePath: string, packageIssues?: LocalPackageIssue[], verification?: CaptureSplatConsumerVerification): Promise<LocalWorldPackageBinaryFile | undefined> {
  const filePath = resolveInside(root, relativePath);
  try {
    if (verification) {
      const bytes = await verification.readVerifiedFile(relativePath, maxBinaryBytes);
      if (!bytes) return undefined;
      return {
        relativePath,
        dataUrl: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
        headerText: bytes.subarray(0, 32 * 1024).toString("utf8"),
        sizeBytes: bytes.byteLength,
        checksum: checksumBytes(bytes)
      };
    }
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    if (info.size > maxBinaryBytes) {
      pushIssue(packageIssues, {
        artifact: relativePath,
        code: "file_too_large",
        message: `${relativePath} is ${info.size} bytes; World Studio reads binary assets up to ${maxBinaryBytes} bytes in this desktop bridge.`,
        severity: "error",
        title: "File too large"
      });
      return undefined;
    }
    const bytes = await readFile(filePath);
    return {
      relativePath,
      dataUrl: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
      headerText: bytes.subarray(0, 32 * 1024).toString("utf8"),
      sizeBytes: bytes.byteLength,
      checksum: checksumBytes(bytes)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readCaptureSplatMetricHandoff(
  root: string,
  manifest: Record<string, unknown>,
  refs: CaptureSplatManifestRefs,
  packageIssues: LocalPackageIssue[],
  verification?: CaptureSplatConsumerVerification,
): Promise<CaptureSplatMetricHandoff | undefined> {
  const registration = isRecord(manifest.metric_registration) ? manifest.metric_registration : undefined;
  const eligibility = isRecord(manifest.walk_eligibility) ? manifest.walk_eligibility : undefined;
  const navigationMesh = await readFirstBinary(root, refs.navigationMeshPaths, packageIssues, verification);
  const measurementPoints = await readFirstBinary(root, refs.measurementPointPaths, packageIssues, verification);
  const meshReport = await readFirstText(root, refs.meshReportPaths, packageIssues, verification);
  const roomSemantics = await readFirstText(root, refs.roomSemanticsPaths, packageIssues, verification);
  const cameraTrajectory = await readFirstText(root, refs.cameraTrajectoryPaths, packageIssues, verification);
  if (!registration && !eligibility && !navigationMesh && !measurementPoints && !meshReport && !roomSemantics && !cameraTrajectory) {
    return undefined;
  }
  const registrationValue = stringValue(registration?.status);
  const registrationStatus: CaptureSplatMetricHandoff["registrationStatus"] =
    registrationValue === "accepted" || registrationValue === "held" ? registrationValue : "unavailable";
  const eligibilityValue = stringValue(eligibility?.status);
  const walkEligibility: CaptureSplatMetricHandoff["walkEligibility"] =
    eligibilityValue === "eligible" || eligibilityValue === "held" ? eligibilityValue : "missing";
  const navigationMeshTransform = registrationStatus === "accepted"
    ? matrix4(firstValue(registration?.arkit_to_target, registration?.arkitToTarget))
    : undefined;
  return {
    walkEligibility,
    walkReason: stringValue(eligibility?.reason) ?? "metric_geometry_missing",
    registrationStatus,
    registration,
    navigationMesh,
    navigationMeshTransform,
    metersPerTargetUnit: numberValue(registration?.meters_per_target_unit),
    measurementPoints,
    meshReport,
    roomSemantics,
    cameraTrajectory
  };
}

async function readCaptureSplatQualityHandoff(
  root: string,
  refs: CaptureSplatManifestRefs,
  gaussianRelativePath: string | undefined,
  packageIssues: LocalPackageIssue[],
  verification?: CaptureSplatConsumerVerification,
): Promise<CaptureSplatQualityHandoff | undefined> {
  const renderSourceQa = await readFirstText(root, refs.renderSourceQaPaths, packageIssues, verification);
  const plyStats = await readFirstText(root, refs.plyStatsPaths, packageIssues, verification);
  if (!renderSourceQa && !plyStats) return undefined;
  const parsedQa = renderSourceQa
    ? parseJsonRecord(renderSourceQa.text, renderSourceQa.relativePath, packageIssues)
    : undefined;
  const parsedStats = plyStats
    ? parseJsonRecord(plyStats.text, plyStats.relativePath, packageIssues)
    : undefined;
  const qa = validRenderSourceQa(parsedQa, renderSourceQa?.relativePath, packageIssues);
  const stats = validPlyStats(parsedStats, gaussianRelativePath, plyStats?.relativePath, packageIssues);
  const renderSourceDecision = (stringValue(qa?.decision) ?? "unavailable") as CaptureSplatQualityHandoff["renderSourceDecision"];
  const weakFrames = Array.isArray(qa?.weak_frames) ? qa.weak_frames : [];
  const nonFiniteCount = numberValue(stats?.non_finite_count);
  return {
    renderSourceDecision,
    frameCount: numberValue(qa?.frame_count),
    validFrameCount: numberValue(qa?.valid_frame_count),
    weakFrameCount: weakFrames.length,
    finitePly: stats ? stats.finite === true && nonFiniteCount === 0 : undefined,
    splatCount: numberValue(stats?.splat_count),
    renderSourceQa,
    plyStats
  };
}

function validRenderSourceQa(
  qa: Record<string, unknown> | undefined,
  artifact: string | undefined,
  packageIssues: LocalPackageIssue[]
): Record<string, unknown> | undefined {
  if (!qa) return undefined;
  const decision = stringValue(qa.decision);
  const frameCount = numberValue(qa.frame_count);
  const validFrameCount = numberValue(qa.valid_frame_count);
  const weakFrames = qa.weak_frames;
  const valid = qa.schema === "capture_splat.render_source_qa.v0.1"
    && (decision === "promote" || decision === "hold" || decision === "reject")
    && Number.isInteger(frameCount) && (frameCount ?? -1) >= 0
    && Number.isInteger(validFrameCount) && (validFrameCount ?? -1) >= 0
    && (validFrameCount ?? 0) <= (frameCount ?? -1)
    && Array.isArray(weakFrames) && weakFrames.every((value) => typeof value === "string");
  if (valid) return qa;
  pushIssue(packageIssues, {
    artifact,
    code: "invalid_capture_splat_render_source_qa",
    message: "Render/source QA evidence has an unsupported schema or invalid decision/count fields and was not trusted.",
    severity: "warning",
    title: "Invalid Capture Splat QA evidence"
  });
  return undefined;
}

function validPlyStats(
  stats: Record<string, unknown> | undefined,
  gaussianRelativePath: string | undefined,
  artifact: string | undefined,
  packageIssues: LocalPackageIssue[]
): Record<string, unknown> | undefined {
  if (!stats) return undefined;
  const statsPath = stringValue(stats.path);
  const nonFiniteCount = numberValue(stats.non_finite_count);
  const splatCount = numberValue(stats.splat_count);
  const boundPath = statsPath && gaussianRelativePath
    ? path.normalize(statsPath) === path.normalize(gaussianRelativePath)
    : false;
  const valid = stats.schema === "capture_splat.ply_stats.v0.1"
    && typeof stats.finite === "boolean"
    && Number.isInteger(nonFiniteCount) && (nonFiniteCount ?? -1) >= 0
    && stats.finite === (nonFiniteCount === 0)
    && Number.isInteger(splatCount) && (splatCount ?? -1) >= 0
    && boundPath;
  if (valid) return stats;
  pushIssue(packageIssues, {
    artifact,
    code: "invalid_capture_splat_ply_stats",
    message: "PLY statistics were not trusted because their schema, finite counts, or Gaussian path binding is invalid.",
    severity: "warning",
    title: "Invalid Capture Splat PLY evidence"
  });
  return undefined;
}

async function readGaussianPreviewPointCloud(
  root: string,
  gaussianRelativePath: string,
  packageIssues?: LocalPackageIssue[],
  verification?: CaptureSplatConsumerVerification,
): Promise<LocalWorldPackageTextFile | undefined> {
  const filePath = resolveInside(root, gaussianRelativePath);
  try {
    const bytes = verification
      ? await verification.readVerifiedFile(gaussianRelativePath, maxBinaryBytes)
      : await readFile(filePath);
    if (!bytes) return undefined;
    const text = buildGaussianPreviewPointCloudPly(bytes, { maxPoints: maxGaussianPreviewPoints });
    const textBytes = Buffer.from(text, "utf8");
    return {
      relativePath: `${gaussianRelativePath}#preview-points`,
      text,
      sizeBytes: textBytes.byteLength,
      checksum: checksumBytes(textBytes)
    };
  } catch (error) {
    pushIssue(packageIssues, {
      artifact: gaussianRelativePath,
      code: "unsupported_layout",
      message: error instanceof Error
        ? `Could not derive preview points from Gaussian PLY: ${error.message}`
        : "Could not derive preview points from Gaussian PLY.",
      severity: "warning",
      title: "Gaussian preview unavailable"
    });
    return undefined;
  }
}

async function readCaptureFrameManifest(
  root: string,
  packageIssues?: LocalPackageIssue[]
): Promise<LocalWorldPackageTextFile | undefined> {
  const frames = await readCaptureFrameFiles(root, packageIssues);
  if (!frames.length) return undefined;
  return createCaptureFrameManifest(frames, "capture_splat.image_folder");
}

async function readCaptureFrameManifestFromPaths(
  root: string,
  framePaths: string[],
  packageIssues?: LocalPackageIssue[],
  verification?: CaptureSplatConsumerVerification,
): Promise<LocalWorldPackageTextFile | undefined> {
  if (!framePaths.length) return undefined;
  const frames = [];
  const imagePaths = uniquePaths(framePaths).filter((relativePath) => imageExtensions.has(path.extname(relativePath).toLowerCase()));
  for (const relativePath of sampleFramesEvenly(imagePaths, maxCapturePreviewFrames)) {
    const frame = await readImagePreviewFile(root, relativePath, packageIssues, verification);
    if (frame) frames.push(frame);
  }
  if (!frames.length) return undefined;
  return createCaptureFrameManifest(frames, "capture_splat.world_studio_handoff");
}

async function readCaptureFrameManifestFromManifest(
  root: string,
  manifest: Record<string, unknown>,
  packageIssues?: LocalPackageIssue[],
  allowedPaths?: ReadonlySet<string>,
  verification?: CaptureSplatConsumerVerification,
): Promise<LocalWorldPackageTextFile | undefined> {
  const assets = isRecord(manifest.assets) ? manifest.assets : {};
  const refs = extractCaptureSplatManifestRefs(manifest);
  const frameCameras = await readCaptureSplatFrameCameras(root, manifest, refs, packageIssues, verification);
  const entries = collectFrameEntries(manifest.source_frames, manifest.sourceFrames, manifest.frames, manifest.rgb_frames, manifest.images, assets.source_frames, assets.sourceFrames, assets.frames, assets.rgb);
  const frames: CaptureFramePreview[] = [];
  for (const entry of sampleFramesEvenly(entries.filter((value) => isAllowedPackagePath(value.relativePath, allowedPaths)), maxCapturePreviewFrames)) {
    const frame = await readImagePreviewFile(root, entry.relativePath, packageIssues, verification);
    if (frame) {
      const frameCamera = frameCameraFromRecord(firstRecordValue(entry.camera)) ?? lookupFrameCamera(frameCameras, entry.relativePath);
      const renderFrame = entry.renderPath && isAllowedPackagePath(entry.renderPath, allowedPaths) ? await readImagePreviewFile(root, entry.renderPath, packageIssues, verification) : undefined;
      frames.push({ ...frame, camera: entry.camera, frameCamera, renderDataUrl: renderFrame?.dataUrl, renderPath: renderFrame?.relativePath });
    }
  }
  if (!frames.length) return readCaptureFrameManifestFromPaths(root, refs.framePaths, packageIssues, verification);
  return createCaptureFrameManifest(frames, "capture_splat.world_studio_handoff");
}

function collectFrameEntries(...values: unknown[]): Array<{ relativePath: string; camera?: unknown; renderPath?: string }> {
  const out: Array<{ relativePath: string; camera?: unknown; renderPath?: string }> = [];
  for (const value of values) {
    if (typeof value === "string") {
      const relativePath = normalizeManifestRelativePath(value);
      if (relativePath) out.push({ relativePath });
    } else if (Array.isArray(value)) {
      out.push(...collectFrameEntries(...value));
    } else if (isRecord(value)) {
      const relativePath = firstPathValue(value.path, value.relativePath, value.rgb_path, value.file, value.uri);
      const renderPath = firstPathValue(value.render_path, value.renderPath, value.render, value.rendered_path, value.renderedPath);
      const camera = firstRecordValue(value.camera, value.camera_state, value.cameraState, value.frame_camera, value.frameCamera) ?? value;
      if (relativePath) out.push({ relativePath, camera, renderPath });
    }
  }
  const seen = new Set<string>();
  return out.filter((entry) => {
    if (seen.has(entry.relativePath)) return false;
    seen.add(entry.relativePath);
    return true;
  });
}

function sampleFramesEvenly<T>(frames: T[], limit: number): T[] {
  if (frames.length <= limit) return frames;
  const step = (frames.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => frames[Math.round(index * step)]);
}

async function readCaptureSplatFrameCameras(
  root: string,
  manifest: Record<string, unknown>,
  refs: CaptureSplatManifestRefs,
  packageIssues?: LocalPackageIssue[],
  verification?: CaptureSplatConsumerVerification,
): Promise<FrameCameraIndex> {
  const cameras: FrameCameraIndex = { exact: new Map(), ambiguousExact: new Set(), aliases: new Map(), ambiguousAliases: new Set() };
  for (const relativePath of refs.cameraPosePaths) {
    if (path.basename(relativePath) !== "transforms.json") continue;
    const text = await readRelativeUtf8(root, relativePath, packageIssues, verification);
    if (!text) continue;
    for (const [key, camera] of parseTransformsFrameCameras(text)) {
      setFrameCameraAliases(cameras, key, camera);
    }
  }

  const assets = isRecord(manifest.assets) ? manifest.assets : {};
  const sparse = isRecord(assets.colmap_sparse) ? assets.colmap_sparse : {};
  const camerasPath = firstPathValue(sparse["cameras.txt"], sparse.cameras, assets.cameras);
  const imagesPath = firstPathValue(sparse["images.txt"], sparse.images, assets.images_txt);
  if (camerasPath && imagesPath) {
    const camerasText = await readRelativeUtf8(root, camerasPath, packageIssues, verification);
    const imagesText = await readRelativeUtf8(root, imagesPath, packageIssues, verification);
    if (camerasText && imagesText) {
      const worldTransform = captureSplatDataparserTransform(manifest);
      for (const [key, camera] of parseColmapFrameCameras(camerasText, imagesText, worldTransform)) {
        setFrameCameraAliases(cameras, key, camera);
      }
    }
  }
  return cameras;
}

function extractHandoffSceneHints(manifest: Record<string, unknown> | undefined): {
  sceneRadius?: number;
  medianStructureDistance?: number;
  captureProfile?: string;
  splatTrainer?: string;
  worldUp?: [number, number, number];
  initialCamera?: { position: [number, number, number]; coordinateFrame?: string; mode?: "inside" | "orbit" };
} {
  if (!manifest) return {};
  const hints: ReturnType<typeof extractHandoffSceneHints> = {};
  const radius = finiteNumber(manifest.scene_radius, manifest.sceneRadius);
  if (radius !== undefined && radius > 0) hints.sceneRadius = radius;
  const median = finiteNumber(manifest.median_structure_distance, manifest.medianStructureDistance);
  if (median !== undefined && median > 0) hints.medianStructureDistance = median;
  const profile = stringValue(manifest.capture_profile) ?? stringValue(manifest.captureProfile);
  if (profile) hints.captureProfile = profile;
  const sceneTransform = firstRecordValue(manifest.scene_transform, manifest.sceneTransform);
  const trainer = stringValue(sceneTransform?.trainer);
  if (trainer) hints.splatTrainer = trainer;
  const registration = firstRecordValue(manifest.metric_registration, manifest.metricRegistration);
  const registrationStatus = stringValue(registration?.status);
  const accepted = registration?.accepted === true || registrationStatus === "accepted";
  const arkitToTarget = accepted ? matrix4(firstValue(registration?.arkit_to_target, registration?.arkitToTarget)) : undefined;
  if (arkitToTarget) {
    const up = normalizeVector3([arkitToTarget[0][1], arkitToTarget[1][1], arkitToTarget[2][1]]);
    if (up) hints.worldUp = up;
  }
  const camera = firstRecordValue(manifest.initial_camera, manifest.initialCamera);
  if (camera) {
    const position = finiteTuple(camera.position, 3);
    if (position) {
      const mode = stringValue(camera.mode);
      hints.initialCamera = {
        position,
        coordinateFrame: stringValue(camera.coordinate_frame) ?? stringValue(camera.coordinateFrame),
        mode: mode === "orbit" || mode === "inside" ? mode : undefined
      };
    }
  }
  return hints;
}

function captureSplatPointTransform(manifest: Record<string, unknown>): number[][] | undefined {
  const assets = isRecord(manifest.assets) ? manifest.assets : {};
  const points = firstRecordValue(assets.points);
  const measurementPoints = firstRecordValue(assets.measurement_points, assets.measurementPoints);
  const pointsFrame = stringValue(firstValue(points?.coordinate_frame, points?.coordinateFrame));
  const measurementFrame = stringValue(firstValue(measurementPoints?.coordinate_frame, measurementPoints?.coordinateFrame));
  const sharesMetricEvidence = Boolean(
    points && measurementPoints && (
      stringValue(points.path) === stringValue(measurementPoints.path) ||
      stringValue(points.checksum) === stringValue(measurementPoints.checksum)
    )
  );
  if (pointsFrame !== "colmap_world" && !(sharesMetricEvidence && measurementFrame === "colmap_world")) return undefined;
  return captureSplatDataparserTransform(manifest);
}

function normalizeVector3(value: [number, number, number]): [number, number, number] | undefined {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length <= 1e-12) return undefined;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function captureSplatDataparserTransform(manifest: Record<string, unknown>): number[][] | undefined {
  const assets = isRecord(manifest.assets) ? manifest.assets : {};
  const gaussian = isRecord(assets.gaussian_ply) ? assets.gaussian_ply : {};
  const value = firstValue(
    manifest.dataparser_transform,
    manifest.dataparserTransform,
    gaussian.dataparser_transform,
    gaussian.dataparserTransform
  );
  return matrix4(value) ?? matrix4FromFlat(value);
}

function matrix4FromFlat(value: unknown): number[][] | undefined {
  if (!Array.isArray(value) || value.length !== 16) return undefined;
  const values = value.map(Number);
  if (!values.every(Number.isFinite)) return undefined;
  return [values.slice(0, 4), values.slice(4, 8), values.slice(8, 12), values.slice(12, 16)];
}

async function readRelativeUtf8(root: string, relativePath: string, packageIssues?: LocalPackageIssue[], verification?: CaptureSplatConsumerVerification): Promise<string | undefined> {
  try {
    if (verification) {
      const bytes = await verification.readVerifiedFile(relativePath, maxTextBytes);
      return bytes ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) : undefined;
    }
    return await readFile(resolveInside(root, relativePath), "utf8");
  } catch {
    pushIssue(packageIssues, {
      artifact: relativePath,
      code: "unsupported_layout",
      message: `Camera metadata ${relativePath} could not be read.`,
      severity: "warning",
      title: "Frame camera metadata skipped"
    });
    return undefined;
  }
}

function lookupFrameCamera(cameras: FrameCameraIndex, relativePath: string): FrameCamera | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  return cameras.exact.get(normalized)
    ?? cameras.aliases.get(path.basename(normalized))?.camera
    ?? cameras.aliases.get(path.basename(normalized, path.extname(normalized)))?.camera;
}

function setFrameCameraAliases(cameras: FrameCameraIndex, relativePath: string, camera: FrameCamera): void {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const existingExact = cameras.exact.get(normalized);
  const exactConflict = cameras.ambiguousExact.has(normalized)
    || (existingExact !== undefined && frameCameraSignature(existingExact) !== frameCameraSignature(camera));
  if (exactConflict) {
    cameras.exact.delete(normalized);
    cameras.ambiguousExact.add(normalized);
  } else if (!existingExact) {
    cameras.exact.set(normalized, camera);
  }
  const aliases = new Set([path.basename(normalized), path.basename(normalized, path.extname(normalized))]);
  for (const alias of aliases) {
    if (exactConflict) {
      cameras.aliases.delete(alias);
      cameras.ambiguousAliases.add(alias);
      continue;
    }
    if (cameras.ambiguousAliases.has(alias)) continue;
    const existing = cameras.aliases.get(alias);
    if (existing && existing.sourcePath !== normalized) {
      cameras.aliases.delete(alias);
      cameras.ambiguousAliases.add(alias);
    } else if (existing && frameCameraSignature(existing.camera) !== frameCameraSignature(camera)) {
      cameras.aliases.delete(alias);
      cameras.ambiguousAliases.add(alias);
    } else {
      cameras.aliases.set(alias, { sourcePath: normalized, camera });
    }
  }
}

function frameCameraSignature(camera: FrameCamera): string {
  return JSON.stringify([
    camera.width,
    camera.height,
    camera.fx,
    camera.fy,
    camera.cx,
    camera.cy,
    camera.translation,
    camera.rotation,
    camera.coordinateFrame ?? null,
    camera.authority ?? null,
  ]);
}

function parseTransformsFrameCameras(text: string): Array<[string, FrameCamera]> {
  const manifest = parseJsonRecord(text);
  const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
  const out: Array<[string, FrameCamera]> = [];
  for (const frame of frames) {
    if (!isRecord(frame)) continue;
    const relativePath = firstPathValue(frame.file_path, frame.rgb_path, frame.path, frame.file);
    const matrix = matrix4(frame.transform_matrix);
    if (!relativePath || !matrix) continue;
    const camera = frameCameraFromRecord({
      width: numberValue(frame.w) ?? numberValue(manifest.w),
      height: numberValue(frame.h) ?? numberValue(manifest.h),
      fx: numberValue(frame.fl_x) ?? numberValue(manifest.fl_x) ?? numberValue(frame.fx) ?? numberValue(manifest.fx),
      fy: numberValue(frame.fl_y) ?? numberValue(manifest.fl_y) ?? numberValue(frame.fy) ?? numberValue(manifest.fy),
      cx: numberValue(frame.cx) ?? numberValue(manifest.cx),
      cy: numberValue(frame.cy) ?? numberValue(manifest.cy),
      translation: [matrix[0][3], matrix[1][3], matrix[2][3]],
      rotation: rotationMatrixToQuaternionWxyz([
        [matrix[0][0], matrix[0][1], matrix[0][2]],
        [matrix[1][0], matrix[1][1], matrix[1][2]],
        [matrix[2][0], matrix[2][1], matrix[2][2]]
      ]),
      coordinate_frame: "nerfstudio_transform",
      authority: "Nerfstudio transforms"
    });
    if (camera) out.push([relativePath, camera]);
  }
  return out;
}

function parseColmapFrameCameras(camerasText: string, imagesText: string, worldTransform?: number[][]): Array<[string, FrameCamera]> {
  const cameras = new Map<number, { width: number; height: number; fx: number; fy: number; cx: number; cy: number }>();
  for (const rawLine of camerasText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const cameraId = Number(parts[0]);
    const model = parts[1];
    const width = Number(parts[2]);
    const height = Number(parts[3]);
    const params = parts.slice(4).map(Number);
    if (!Number.isFinite(cameraId) || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    const intrinsics = colmapIntrinsics(model, width, height, params);
    if (intrinsics) cameras.set(cameraId, intrinsics);
  }

  const out: Array<[string, FrameCamera]> = [];
  const lines = imagesText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index]?.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 10) continue;
    const qw = Number(parts[1]);
    const qx = Number(parts[2]);
    const qy = Number(parts[3]);
    const qz = Number(parts[4]);
    const tx = Number(parts[5]);
    const ty = Number(parts[6]);
    const tz = Number(parts[7]);
    const cameraId = Number(parts[8]);
    const name = parts.slice(9).join(" ");
    const intrinsics = cameras.get(cameraId);
    if (!intrinsics || !name) continue;
    const worldToCamera = quaternionWxyzToRotationMatrix([qw, qx, qy, qz]);
    const cameraToWorld = transpose3(worldToCamera);
    const origin = multiplyMat3Vec(cameraToWorld, [-tx, -ty, -tz]);
    let rotationMatrix = cameraToWorld;
    let translation = origin;
    if (worldTransform) {
      // Trainers like VkSplat train splats in a normalized world; map raw COLMAP
      // camera-to-world poses through the similarity transform so frame cameras
      // land in the same world as the trained splat means.
      const linear = worldTransform.map((row) => row.slice(0, 3));
      translation = multiplyMat3Vec(linear, origin);
      translation = [
        translation[0] + worldTransform[0][3],
        translation[1] + worldTransform[1][3],
        translation[2] + worldTransform[2][3]
      ];
      const scale = Math.hypot(linear[0][0], linear[1][0], linear[2][0]) || 1;
      rotationMatrix = multiplyMat3(linear, cameraToWorld).map((row) => row.map((value) => value / scale));
    }
    const camera = frameCameraFromRecord({
      ...intrinsics,
      translation,
      rotation: rotationMatrixToQuaternionWxyz(rotationMatrix),
      coordinate_frame: worldTransform ? "trainer_normalized_world" : "colmap_world",
      authority: worldTransform
        ? "COLMAP sparse reconstruction · trainer dataparser transform"
        : "COLMAP sparse reconstruction"
    });
    if (camera) out.push([name, camera]);
  }
  return out;
}

function colmapIntrinsics(model: string | undefined, width: number, height: number, params: number[]): FrameCamera | undefined {
  if (!model || params.some((value) => !Number.isFinite(value))) return undefined;
  if (model === "SIMPLE_PINHOLE" || model === "SIMPLE_RADIAL" || model === "RADIAL") {
    const [f, cx, cy] = params;
    return frameCameraFromRecord({ width, height, fx: f, fy: f, cx, cy, translation: [0, 0, 0], rotation: [1, 0, 0, 0] });
  }
  const [fx, fy, cx, cy] = params;
  return frameCameraFromRecord({ width, height, fx, fy, cx, cy, translation: [0, 0, 0], rotation: [1, 0, 0, 0] });
}

function frameCameraFromRecord(value: Record<string, unknown> | undefined): FrameCamera | undefined {
  if (!value) return undefined;
  const intrinsics = firstRecordValue(value.intrinsics) ?? value;
  const pose = firstRecordValue(value.pose) ?? value;
  const width = finiteNumber(value.width, value.w, intrinsics.width, intrinsics.w);
  const height = finiteNumber(value.height, value.h, intrinsics.height, intrinsics.h);
  const fx = finiteNumber(value.fx, value.fl_x, intrinsics.fx, intrinsics.fl_x);
  const fy = finiteNumber(value.fy, value.fl_y, intrinsics.fy, intrinsics.fl_y);
  const cx = finiteNumber(value.cx, intrinsics.cx);
  const cy = finiteNumber(value.cy, intrinsics.cy);
  const translation = finiteTuple(firstValue(value.translation, pose.translation, pose.t), 3);
  const rotation = finiteTuple(firstValue(value.rotation, pose.rotation, pose.qvec, pose.quaternion), 4);
  if (!width || !height || !fx || !fy || cx === undefined || cy === undefined || !translation || !rotation) return undefined;
  return {
    width,
    height,
    fx,
    fy,
    cx,
    cy,
    translation,
    rotation,
    coordinateFrame: stringValue(firstValue(value.coordinate_frame, value.coordinateFrame, pose.coordinate_frame, pose.coordinateFrame)),
    authority: stringValue(firstValue(value.authority, pose.authority))
  };
}

function finiteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function finiteTuple(value: unknown, length: 3): [number, number, number] | undefined;
function finiteTuple(value: unknown, length: 4): [number, number, number, number] | undefined;
function finiteTuple(value: unknown, length: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== length) return undefined;
  return value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value.slice() as number[] : undefined;
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function matrix4(value: unknown): number[][] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const rows = value.map((row) => Array.isArray(row) && row.length === 4 ? row.map(Number) : undefined);
  return rows.every((row) => row?.every(Number.isFinite)) ? rows as number[][] : undefined;
}

function quaternionWxyzToRotationMatrix(q: [number, number, number, number]): number[][] {
  const [qw, qx, qy, qz] = normalizeQuaternion(q);
  return [
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]
  ];
}

function rotationMatrixToQuaternionWxyz(m: number[][]): [number, number, number, number] {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let qw: number;
  let qx: number;
  let qy: number;
  let qz: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m[2][1] - m[1][2]) / s;
    qy = (m[0][2] - m[2][0]) / s;
    qz = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    qw = (m[2][1] - m[1][2]) / s;
    qx = 0.25 * s;
    qy = (m[0][1] + m[1][0]) / s;
    qz = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    qw = (m[0][2] - m[2][0]) / s;
    qx = (m[0][1] + m[1][0]) / s;
    qy = 0.25 * s;
    qz = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    qw = (m[1][0] - m[0][1]) / s;
    qx = (m[0][2] + m[2][0]) / s;
    qy = (m[1][2] + m[2][1]) / s;
    qz = 0.25 * s;
  }
  return normalizeQuaternion([qw, qx, qy, qz]);
}

function normalizeQuaternion(q: [number, number, number, number]): [number, number, number, number] {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(length) || length <= 1e-12) return [1, 0, 0, 0];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function transpose3(m: number[][]): number[][] {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]]
  ];
}

function multiplyMat3(a: number[][], b: number[][]): number[][] {
  return [0, 1, 2].map((row) => [0, 1, 2].map((col) =>
    a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col]
  ));
}

function multiplyMat3Vec(m: number[][], v: [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}

function createCaptureFrameManifest(
  frames: CaptureFramePreview[],
  sourceKind: string
): LocalWorldPackageTextFile {
  const manifest = {
    schema: "budo.media_frames.v0.8",
    source_kind: sourceKind,
    generated_by: "world-studio.local-package-reader",
    frames: frames.map((frame, index) => ({
      display_name: frame.displayName,
      frame_index: index,
      rgb_path: frame.relativePath,
      preview_data_url: frame.dataUrl,
      ...(frame.renderDataUrl ? { render_preview_data_url: frame.renderDataUrl } : {}),
      ...(frame.renderPath ? { render_path: frame.renderPath } : {}),
      mime_type: frame.mimeType,
      size_bytes: frame.sizeBytes,
      checksum: frame.checksum,
      ...(isRecord(frame.camera) ? { camera: frame.camera } : {}),
      ...(frame.frameCamera ? { frame_camera: frame.frameCamera } : {})
    }))
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const bytes = Buffer.from(text, "utf8");
  return {
    relativePath: "capture-splat.media_frames.generated.json",
    text,
    sizeBytes: bytes.byteLength,
    checksum: checksumBytes(bytes)
  };
}

function emptyCaptureSplatRefs(): CaptureSplatManifestRefs {
  return {
    cameraTrajectoryPaths: [],
    captureManifestPaths: [],
    cameraPosePaths: [],
    framePaths: [],
    gaussianPlyPaths: [],
    gaussianProxyPaths: [],
    measurementPointPaths: [],
    meshReportPaths: [],
    navigationMeshPaths: [],
    objMeshPaths: [],
    pointsPlyPaths: [],
    plyStatsPaths: [],
    renderSourceQaPaths: [],
    roomSemanticsPaths: []
  };
}

function filterCaptureSplatRefs(refs: CaptureSplatManifestRefs, allowedPaths?: ReadonlySet<string>): CaptureSplatManifestRefs {
  if (!allowedPaths) return refs;
  return Object.fromEntries(Object.entries(refs).map(([key, paths]) => [key, (paths as string[]).filter((relativePath: string) => allowedPaths.has(relativePath))])) as unknown as CaptureSplatManifestRefs;
}

function allowedPackagePaths(paths: string[], allowedPaths?: ReadonlySet<string>): string[] {
  return allowedPaths ? paths.filter((relativePath) => allowedPaths.has(relativePath)) : paths;
}

function isAllowedPackagePath(relativePath: string, allowedPaths?: ReadonlySet<string>): boolean {
  return !allowedPaths || allowedPaths.has(relativePath);
}

async function readCaptureSplatTrainingDataset(
  root: string,
  manifest: Record<string, unknown>,
  packageIssues: LocalPackageIssue[],
  verification?: CaptureSplatConsumerVerification,
): Promise<CaptureSplatTrainingDatasetV1 | undefined> {
  if (manifest.schema !== "capture_splat.world_studio_handoff.v0.3") return undefined;
  try {
    const dataset = validateCaptureSplatTrainingDataset(manifest.training_dataset);
    const frames = Array.isArray(manifest.source_frames) ? manifest.source_frames : [];
    if (frames.length !== dataset.source_frame_set.count) {
      throw new Error("training_dataset source frame count differs from source_frames.");
    }
    const identities = frames.map((value, index) => captureFrameIdentity(value, index));
    if (new Set(identities.map((frame) => frame.path)).size !== identities.length) {
      throw new Error("training_dataset source frame paths must be unique.");
    }
    const digest = createHash("sha256");
    for (const frame of identities.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
      digest.update(frame.path, "utf8");
      digest.update("\0");
      digest.update(String(frame.sizeBytes), "ascii");
      digest.update("\0");
      digest.update(frame.checksum, "ascii");
      digest.update("\n");
    }
    if (`sha256:${digest.digest("hex")}` !== dataset.source_frame_set.digest) {
      throw new Error("training_dataset source frame digest differs from source_frames.");
    }
    await verifyCaptureSplatMeasuredEvidence(root, manifest, dataset, verification);
    return dataset;
  } catch (error) {
    pushIssue(packageIssues, {
      artifact: captureSplatManifestPath,
      code: "invalid_capture_splat_training_dataset",
      message: error instanceof Error ? error.message : "Capture Splat training_dataset is invalid.",
      severity: "error",
      title: "Invalid Capture Splat training dataset"
    });
    return undefined;
  }
}

function captureFrameIdentity(value: unknown, index: number): { path: string; sizeBytes: number; checksum: string } {
  if (!isRecord(value)) throw new Error(`source_frames[${index}] must be an object.`);
  if (typeof value.rgb_path !== "string") throw new Error(`source_frames[${index}].rgb_path must be a relative path.`);
  const relativePath = normalizeManifestRelativePath(value.rgb_path);
  if (!relativePath || relativePath !== value.rgb_path) throw new Error(`source_frames[${index}].rgb_path must be canonical.`);
  if (!Number.isSafeInteger(value.size_bytes) || (value.size_bytes as number) < 1) {
    throw new Error(`source_frames[${index}].size_bytes must be a positive safe integer.`);
  }
  if (typeof value.checksum !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.checksum)) {
    throw new Error(`source_frames[${index}].checksum must be SHA-256.`);
  }
  return { path: relativePath, sizeBytes: value.size_bytes as number, checksum: value.checksum };
}

function extractCaptureSplatManifestRefs(manifest: Record<string, unknown>): CaptureSplatManifestRefs {
  const refs = emptyCaptureSplatRefs();
  const assets = isRecord(manifest.assets) ? manifest.assets : {};
  collectPathValues(refs.framePaths, manifest.source_frames, manifest.sourceFrames, manifest.frames, manifest.rgb_frames, manifest.images, assets.source_frames, assets.sourceFrames, assets.frames, assets.rgb);
  collectPathValues(refs.pointsPlyPaths, manifest.points, manifest.points_ply, manifest.point_cloud, manifest.pointCloud, assets.points, assets.points_ply, assets.point_cloud, assets.pointCloud);
  collectPathValues(refs.objMeshPaths, manifest.mesh, manifest.collision_mesh, manifest.collisionMesh, assets.mesh, assets.collision_mesh, assets.collisionMesh);
  collectPathValues(refs.navigationMeshPaths, manifest.navigation_mesh, manifest.navigationMesh, assets.navigation_mesh, assets.navigationMesh);
  collectPathValues(refs.measurementPointPaths, manifest.measurement_points, manifest.measurementPoints, assets.measurement_points, assets.measurementPoints);
  collectPathValues(refs.meshReportPaths, manifest.mesh_report, manifest.meshReport, assets.mesh_report, assets.meshReport);
  collectPathValues(refs.roomSemanticsPaths, manifest.room_semantics, manifest.roomSemantics, assets.room_semantics, assets.roomSemantics);
  collectPathValues(refs.cameraTrajectoryPaths, manifest.camera_trajectory, manifest.cameraTrajectory, assets.camera_trajectory, assets.cameraTrajectory);
  collectPathValues(refs.renderSourceQaPaths, manifest.render_source_qa, manifest.renderSourceQa, assets.render_source_qa, assets.renderSourceQa);
  collectPathValues(refs.plyStatsPaths, manifest.ply_stats, manifest.plyStats, assets.ply_stats, assets.plyStats);
  collectPathValues(refs.cameraPosePaths, manifest.camera_poses, manifest.cameraPoses, manifest.transforms, manifest.poses, assets.camera_poses, assets.cameraPoses, assets.transforms, assets.poses);
  collectPathValues(refs.captureManifestPaths, manifest.capture_json, manifest.captureJson, manifest.capture_manifest, manifest.captureManifest, assets.capture_json, assets.captureJson, assets.capture_manifest, assets.captureManifest);
  collectGaussianPathValues(refs, manifest.gaussian, manifest.gaussians, manifest.gaussian_ply, manifest.splat, manifest.spz, assets.gaussian, assets.gaussians, assets.gaussian_ply, assets.splat, assets.spz);

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) continue;
    const artifactPath = firstPathValue(artifact.path, artifact.relativePath, artifact.file, artifact.uri);
    if (!artifactPath) continue;
    const kind = `${stringValue(artifact.kind) ?? ""} ${stringValue(artifact.type) ?? ""} ${stringValue(artifact.role) ?? ""}`.toLowerCase();
    const extension = path.extname(artifactPath).toLowerCase();
    if (kind.includes("frame") || kind.includes("image") || kind.includes("rgb")) refs.framePaths.push(artifactPath);
    else if ((kind.includes("point") || kind.includes("ordinary")) && extension === ".ply") refs.pointsPlyPaths.push(artifactPath);
    else if (kind.includes("gaussian") || kind.includes("splat") || extension === ".splat" || extension === ".spz") addGaussianPath(refs, artifactPath);
    else if (kind.includes("mesh") || extension === ".obj") refs.objMeshPaths.push(artifactPath);
    else if (kind.includes("camera") || kind.includes("pose") || kind.includes("transform")) refs.cameraPosePaths.push(artifactPath);
    else if (kind.includes("capture") || path.basename(artifactPath) === "capture.json") refs.captureManifestPaths.push(artifactPath);
  }

  return {
    cameraTrajectoryPaths: uniquePaths(refs.cameraTrajectoryPaths),
    captureManifestPaths: uniquePaths(refs.captureManifestPaths),
    cameraPosePaths: uniquePaths(refs.cameraPosePaths),
    framePaths: uniquePaths(refs.framePaths),
    gaussianPlyPaths: uniquePaths(refs.gaussianPlyPaths),
    gaussianProxyPaths: uniquePaths(refs.gaussianProxyPaths),
    measurementPointPaths: uniquePaths(refs.measurementPointPaths),
    meshReportPaths: uniquePaths(refs.meshReportPaths),
    navigationMeshPaths: uniquePaths(refs.navigationMeshPaths),
    objMeshPaths: uniquePaths(refs.objMeshPaths),
    pointsPlyPaths: uniquePaths(refs.pointsPlyPaths),
    plyStatsPaths: uniquePaths(refs.plyStatsPaths),
    renderSourceQaPaths: uniquePaths(refs.renderSourceQaPaths),
    roomSemanticsPaths: uniquePaths(refs.roomSemanticsPaths)
  };
}

function collectGaussianPathValues(refs: CaptureSplatManifestRefs, ...values: unknown[]) {
  for (const relativePath of collectPathValues([], ...values)) {
    addGaussianPath(refs, relativePath);
  }
}

function addGaussianPath(refs: CaptureSplatManifestRefs, relativePath: string) {
  if (path.extname(relativePath).toLowerCase() === ".ply") refs.gaussianPlyPaths.push(relativePath);
  else refs.gaussianProxyPaths.push(relativePath);
}

function collectPathValues(out: string[], ...values: unknown[]): string[] {
  for (const value of values) {
    if (typeof value === "string") {
      const relativePath = normalizeManifestRelativePath(value);
      if (relativePath) out.push(relativePath);
    } else if (Array.isArray(value)) {
      collectPathValues(out, ...value);
    } else if (isRecord(value)) {
      collectPathValues(out, value.path, value.relativePath, value.rgb_path, value.file, value.uri);
    }
  }
  return out;
}

function firstPathValue(...values: unknown[]): string | undefined {
  return collectPathValues([], ...values)[0];
}

function firstRecordValue(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function normalizeManifestRelativePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) return undefined;
  if (normalized.split("/").includes("..")) return undefined;
  return normalized;
}

async function readCaptureFrameFiles(
  root: string,
  packageIssues?: LocalPackageIssue[]
): Promise<CaptureFramePreview[]> {
  for (const directory of captureFrameDirs) {
    const dirPath = resolveInside(root, directory);
    let entries;
    try {
      const info = await stat(dirPath);
      if (!info.isDirectory()) continue;
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const imageEntries = sampleFramesEvenly(
      entries
        .filter((entry) => entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      maxCapturePreviewFrames
    );
    const frames = [];
    for (const entry of imageEntries) {
      const relativePath = `${directory}/${entry.name}`;
      const frame = await readImagePreviewFile(root, relativePath, packageIssues);
      if (frame) frames.push(frame);
    }
    if (frames.length) return frames;
  }
  return [];
}

async function readImagePreviewFile(
  root: string,
  relativePath: string,
  packageIssues?: LocalPackageIssue[],
  verification?: CaptureSplatConsumerVerification,
): Promise<CaptureFramePreview | undefined> {
  const filePath = resolveInside(root, relativePath);
  try {
    if (verification) {
      const bytes = await verification.readVerifiedFile(relativePath, maxCapturePreviewImageBytes);
      if (!bytes) return undefined;
      const mimeType = imageMimeType(relativePath);
      return {
        relativePath,
        displayName: path.basename(relativePath, path.extname(relativePath)),
        mimeType,
        sizeBytes: bytes.byteLength,
        checksum: checksumBytes(bytes),
        dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`
      };
    }
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    if (info.size > maxCapturePreviewImageBytes) {
      pushIssue(packageIssues, {
        artifact: relativePath,
        code: "file_too_large",
        message: `${relativePath} is ${info.size} bytes; World Studio embeds source frame previews up to ${maxCapturePreviewImageBytes} bytes each.`,
        severity: "warning",
        title: "Source frame preview skipped"
      });
      return undefined;
    }
    const bytes = await readFile(filePath);
    const mimeType = imageMimeType(relativePath);
    return {
      relativePath,
      displayName: path.basename(relativePath, path.extname(relativePath)),
      mimeType,
      sizeBytes: bytes.byteLength,
      checksum: checksumBytes(bytes),
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`
    };
  } catch {
    return undefined;
  }
}

function imageMimeType(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function buildAssetManifest(files: Array<LocalWorldPackageTextFile | LocalWorldPackageBinaryFile | undefined>): WorldAssetManifestEntry[] {
  const seen = new Set<string>();
  return files.flatMap((file) => {
    if (!file) return [];
    if (seen.has(file.relativePath)) return [];
    seen.add(file.relativePath);
    return [{
      relativePath: file.relativePath,
      ...(typeof file.sizeBytes === "number" ? { sizeBytes: file.sizeBytes } : {}),
      ...(file.checksum ? { checksum: file.checksum } : {})
    }];
  });
}

function checksumBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

function resolveInside(root: string, relativePath: string): string {
  const base = path.resolve(root);
  const filePath = path.resolve(base, relativePath);
  if (filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Package file escaped selected folder: ${relativePath}`);
  }
  return filePath;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function buildPackageInsights(input: {
  articleFigureViews?: LocalWorldPackageTextFile;
  budoMediaFrames?: LocalWorldPackageTextFile;
  captureSplatManifest?: LocalWorldPackageTextFile;
  cleanedPointPly: boolean;
  gaussianPly?: { relativePath: string };
  jsonManifests: LocalWorldPackageTextFile[];
  objMesh?: LocalWorldPackageTextFile;
  pointsPly?: LocalWorldPackageTextFile;
  sceneFile?: LocalWorldPackageTextFile;
  verifiedExport?: LocalWorldPackageTextFile;
}, packageIssues: LocalPackageIssue[] = []): LocalPackageInsight[] {
  const insights: LocalPackageInsight[] = [];
  const handled = new Set<string>();
  const hasGeneratedPreviewPoints = input.pointsPly?.relativePath.endsWith("#preview-points") ?? false;

  if (input.pointsPly || input.gaussianPly || input.objMesh) {
    insights.push({
      id: "assets",
      kind: "asset-set",
      title: "Asset Set",
      artifact: "local files",
      summary: input.cleanedPointPly
        ? "Cleaned ordinary PLY export detected; Gaussian/splat payloads are not part of this artifact."
        : hasGeneratedPreviewPoints
        ? "Renderable Gaussian source detected; preview points were generated for bounds only."
        : "Renderable package assets detected in the selected folder.",
      metrics: [
        { label: "points", value: input.pointsPly ? input.pointsPly.relativePath : "missing" },
        { label: "gaussian", value: input.gaussianPly ? input.gaussianPly.relativePath : "missing" },
        { label: "mesh", value: input.objMesh ? input.objMesh.relativePath : "missing" }
      ],
      details: hasGeneratedPreviewPoints
        ? [{ label: "points source", value: "generated preview, not a package file" }]
        : input.cleanedPointPly
          ? [{ label: "boundary", value: "ordinary point-cloud PLY only" }]
        : [],
      sections: [
        {
          title: "Renderable Assets",
          rows: [
            { label: "points", value: input.pointsPly ? input.pointsPly.relativePath : "missing" },
            { label: "gaussian", value: input.gaussianPly ? input.gaussianPly.relativePath : "missing" },
            { label: "mesh", value: input.objMesh ? input.objMesh.relativePath : "missing" }
          ]
        }
      ]
    });
  }

  if (input.sceneFile) {
    handled.add(input.sceneFile.relativePath);
    const scene = parseJsonRecord(input.sceneFile.text);
    insights.push({
      id: "scene",
      kind: "scene-manifest",
      title: "Scene Manifest",
      artifact: input.sceneFile.relativePath,
      summary: stringValue(scene.dataset) ?? "World scene metadata",
      metrics: [
        { label: "version", value: stringValue(scene.version) ?? "unknown" },
        { label: "classes", value: Array.isArray(scene.classes) ? scene.classes.length : 0 },
        { label: "points", value: numberValue(scene.points_total) ?? "unknown" }
      ],
      details: [
        { label: "units", value: stringValue(scene.units) ?? "unknown" },
        { label: "up", value: stringValue(scene.up_axis) ?? "unknown" }
      ],
      sections: [
        {
          title: "Scene",
          rows: [
            { label: "dataset", value: stringValue(scene.dataset) ?? "unknown" },
            { label: "version", value: stringValue(scene.version) ?? "unknown" },
            { label: "units", value: stringValue(scene.units) ?? "unknown" },
            { label: "up", value: stringValue(scene.up_axis) ?? "unknown" }
          ]
        },
        { title: "Top Level", rows: rowsFromRecord(scene) }
      ],
      previewText: previewJson(scene)
    });
  }

  if (input.captureSplatManifest) {
    handled.add(input.captureSplatManifest.relativePath);
    const manifest = parseJsonRecord(input.captureSplatManifest.text, input.captureSplatManifest.relativePath, packageIssues);
    const refs = extractCaptureSplatManifestRefs(manifest);
    const schema = stringValue(manifest.schema) ?? "capture_splat.world_studio_handoff.v0.1";
    const registration = isRecord(manifest.metric_registration) ? manifest.metric_registration : {};
    const eligibility = isRecord(manifest.walk_eligibility) ? manifest.walk_eligibility : {};
    insights.push({
      id: "capture-splat-manifest",
      kind: "capture-splat-manifest",
      title: "Capture Splat Handoff",
      artifact: input.captureSplatManifest.relativePath,
      summary: "Capture Splat package handoff for source frames and 3DGS review.",
      status: stringValue(manifest.status) ?? "visual_evidence",
      metrics: [
        { label: "frames", value: refs.framePaths.length },
        { label: "points", value: refs.pointsPlyPaths[0] ?? "missing" },
        { label: "gaussian", value: refs.gaussianPlyPaths[0] ?? refs.gaussianProxyPaths[0] ?? "missing" },
        { label: "walk", value: stringValue(eligibility.status) ?? "missing" }
      ],
      details: [
        { label: "schema", value: schema },
        { label: "registration", value: stringValue(registration.status) ?? "unavailable" },
        { label: "authority", value: "source frames visual evidence; 3DGS proposal" }
      ],
      sections: [
        {
          title: "Renderable Assets",
          rows: [
            { label: "points", value: refs.pointsPlyPaths[0] ?? "missing" },
            { label: "gaussian ply", value: refs.gaussianPlyPaths[0] ?? "missing" },
            { label: "mesh", value: refs.objMeshPaths[0] ?? "missing" },
            { label: "splat/spz", value: refs.gaussianProxyPaths[0] ?? "missing" }
          ]
        },
        {
          title: "Metric Interaction",
          rows: [
            { label: "walk", value: stringValue(eligibility.status) ?? "missing" },
            { label: "reason", value: stringValue(eligibility.reason) ?? "metric geometry missing" },
            { label: "registration", value: stringValue(registration.status) ?? "unavailable" },
            { label: "navigation mesh", value: refs.navigationMeshPaths[0] ?? "missing" },
            { label: "measurement points", value: refs.measurementPointPaths[0] ?? "missing" },
            { label: "mesh report", value: refs.meshReportPaths[0] ?? "missing" },
            { label: "room semantics", value: refs.roomSemanticsPaths[0] ?? "missing" },
            { label: "trajectory", value: refs.cameraTrajectoryPaths[0] ?? "missing" }
          ]
        },
        {
          title: "Source Frames",
          rows: refs.framePaths.length
            ? refs.framePaths.slice(0, maxCapturePreviewFrames).map((relativePath, index) => ({ label: `frame ${index + 1}`, value: relativePath }))
            : [{ label: "frames", value: "missing" }]
        },
        {
          title: "Camera And Capture Metadata",
          rows: [
            { label: "capture", value: refs.captureManifestPaths[0] ?? "missing" },
            { label: "poses", value: refs.cameraPosePaths[0] ?? "missing" }
          ]
        },
        { title: "Top Level", rows: rowsFromRecord(manifest) }
      ],
      previewText: previewJson(manifest)
    });
  }

  if (input.budoMediaFrames) {
    handled.add(input.budoMediaFrames.relativePath);
    const manifest = parseJsonRecord(input.budoMediaFrames.text, input.budoMediaFrames.relativePath, packageIssues);
    const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
    const firstFrame = isRecord(frames[0]) ? frames[0] : {};
    insights.push({
      id: "media-frames",
      kind: "media-frames",
      title: "Media Frames",
      artifact: input.budoMediaFrames.relativePath,
      summary: "Media-frame manifest adapter",
      status: stringValue(manifest.source_kind),
      metrics: [
        { label: "frames", value: frames.length },
        { label: "width", value: numberValue(firstFrame.width) ?? "unknown" },
        { label: "height", value: numberValue(firstFrame.height) ?? "unknown" }
      ],
      details: [
        { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
        { label: "first", value: stringValue(firstFrame.display_name) ?? stringValue(firstFrame.rgb_path) ?? "none" }
      ],
      sections: [
        {
          title: "Manifest",
          rows: [
            { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
            { label: "source", value: stringValue(manifest.source_kind) ?? "unknown" },
            { label: "artifact", value: input.budoMediaFrames.relativePath }
          ]
        },
        { title: "First Frame", rows: rowsFromRecord(firstFrame) },
        { title: "Frame Paths", rows: rowsForRecords(frames, "frame", (frame) => stringValue(frame.display_name) ?? stringValue(frame.rgb_path) ?? "unknown") }
      ],
      previewText: previewJson(manifest)
    });
  }

  if (input.articleFigureViews) {
    handled.add(input.articleFigureViews.relativePath);
    const manifest = parseJsonRecord(input.articleFigureViews.text, input.articleFigureViews.relativePath, packageIssues);
    const views = Array.isArray(manifest.views) ? manifest.views : Array.isArray(manifest.frames) ? manifest.frames : [];
    const firstView = isRecord(views[0]) ? views[0] : {};
    insights.push({
      id: "figure-views",
      kind: "figure-views",
      title: "Figure Views",
      artifact: input.articleFigureViews.relativePath,
      summary: "Saved 3D view manifest adapter",
      metrics: [
        { label: "views", value: views.length },
        { label: "point clouds", value: countField(views, "point_cloud_path") },
        { label: "mesh refs", value: countArrayField(views, "mesh_paths") }
      ],
      details: [
        { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
        { label: "first", value: stringValue(firstView.display_name) ?? stringValue(firstView.notes) ?? "none" }
      ],
      sections: [
        {
          title: "Manifest",
          rows: [
            { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
            { label: "artifact", value: input.articleFigureViews.relativePath },
            { label: "views", value: views.length }
          ]
        },
        { title: "First View", rows: rowsFromRecord(firstView) },
        {
          title: "View References",
          rows: rowsForRecords(views, "view", (view) => stringValue(view.point_cloud_path) ?? stringValue(view.display_name) ?? stringValue(view.notes) ?? "unknown")
        }
      ],
      previewText: previewJson(manifest)
    });
  }

  if (input.verifiedExport) {
    handled.add(input.verifiedExport.relativePath);
    const manifest = parseJsonRecord(input.verifiedExport.text, input.verifiedExport.relativePath, packageIssues);
    const files = isRecord(manifest.files) ? manifest.files : {};
    const hashes = isRecord(manifest.hashes) ? manifest.hashes : {};
    insights.push({
      id: "verified-export",
      kind: "verified-export",
      title: "Verified Export",
      artifact: input.verifiedExport.relativePath,
      summary: stringValue(manifest.boundary) ?? "Verified semantic export manifest",
      status: stringValue(manifest.status),
      metrics: [
        { label: "components", value: numberValue(manifest.component_count) ?? "unknown" },
        { label: "files", value: Object.keys(files).length },
        { label: "hashes", value: Object.keys(hashes).length }
      ],
      details: [
        { label: "schema", value: stringValue(manifest.schema) ?? "unknown" },
        { label: "status", value: stringValue(manifest.status) ?? "unknown" }
      ],
      sections: [
        {
          title: "Authority",
          rows: [
            { label: "status", value: stringValue(manifest.status) ?? "unknown" },
            { label: "boundary", value: stringValue(manifest.boundary) ?? "unknown" },
            { label: "components", value: numberValue(manifest.component_count) ?? "unknown" }
          ]
        },
        { title: "Files", rows: rowsFromRecord(files) },
        { title: "Hashes", rows: rowsFromRecord(hashes, 4) }
      ],
      previewText: previewJson(manifest)
    });
  }

  for (const file of input.jsonManifests) {
    if (handled.has(file.relativePath)) continue;
    const manifest = parseJsonRecord(file.text, file.relativePath, packageIssues);
    const schema = stringValue(manifest.schema) ?? stringValue(manifest.type) ?? stringValue(manifest.kind);
    const metrics = [
      { label: "keys", value: Object.keys(manifest).length },
      { label: "arrays", value: Object.values(manifest).filter(Array.isArray).length },
      { label: "objects", value: Object.values(manifest).filter(isRecord).length }
    ];
    insights.push({
      id: `json-${file.relativePath}`,
      kind: "json-manifest",
      title: schema ? "JSON Manifest" : "JSON File",
      artifact: file.relativePath,
      summary: schema ?? "Generic JSON package metadata",
      metrics,
      details: [
        { label: "schema", value: schema ?? "none" },
        { label: "artifact", value: file.relativePath }
      ],
      sections: [
        {
          title: "Structure",
          rows: [
            { label: "schema", value: schema ?? "none" },
            { label: "artifact", value: file.relativePath },
            ...metrics
          ]
        },
        { title: "Top Level", rows: rowsFromRecord(manifest) }
      ],
      previewText: previewJson(manifest)
    });
  }

  return insights;
}

function addPackageLayoutIssues(input: {
  articleFigureViews?: LocalWorldPackageTextFile;
  budoMediaFrames?: LocalWorldPackageTextFile;
  captureSplatManifest?: LocalWorldPackageTextFile;
  companionArtifacts: string[];
  gaussianPly?: { relativePath: string };
  jsonManifests: LocalWorldPackageTextFile[];
  objMesh?: LocalWorldPackageTextFile;
  packageIssues: LocalPackageIssue[];
  pointsPly?: LocalWorldPackageTextFile;
  sceneFile?: LocalWorldPackageTextFile;
  verifiedExport?: LocalWorldPackageTextFile;
}) {
  const hasRenderable = Boolean(input.pointsPly || input.gaussianPly || input.objMesh);
  const hasManifest = Boolean(input.captureSplatManifest || input.sceneFile || input.budoMediaFrames || input.articleFigureViews || input.verifiedExport || input.jsonManifests.length);
  if (!input.companionArtifacts.length) {
    pushIssue(input.packageIssues, {
      code: "unsupported_layout",
      message: "World Studio did not find scene.json, recognized PLY/OBJ assets, Budo-compatible manifests, verified_export/manifest.json, or generic JSON manifests in this folder.",
      severity: "error",
      title: "Unsupported package layout"
    });
    return;
  }

  if (!hasRenderable && !input.verifiedExport && !input.budoMediaFrames && !input.articleFigureViews) {
    pushIssue(input.packageIssues, {
      code: "missing_primary_artifact",
      message: hasManifest
        ? "This package can be inspected as metadata, but no points, Gaussian PLY, or OBJ mesh was found for rendering."
        : "No renderable primary artifact was found.",
      severity: "warning",
      title: "Missing renderable primary artifact"
    });
  }
}

function parseJsonRecord(text: string, artifact?: string, packageIssues?: LocalPackageIssue[]): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : {};
  } catch (error) {
    pushIssue(packageIssues, {
      artifact,
      code: "malformed_json",
      message: `${artifact ?? "JSON manifest"} could not be parsed: ${error instanceof Error ? error.message : "invalid JSON"}`,
      severity: "error",
      title: "Malformed JSON"
    });
    return {};
  }
}

function pushIssue(packageIssues: LocalPackageIssue[] | undefined, issue: Omit<LocalPackageIssue, "id">) {
  if (!packageIssues) return;
  const id = `${issue.code}:${issue.artifact ?? "package"}`;
  if (packageIssues.some((entry) => entry.id === id)) return;
  packageIssues.push({ id, ...issue });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSceneManifestRecord(value: Record<string, unknown>) {
  return typeof value.dataset === "string" && typeof value.version === "string" && Array.isArray(value.classes);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function countField(values: unknown[], field: string): number {
  return values.filter((value) => isRecord(value) && typeof value[field] === "string").length;
}

function countArrayField(values: unknown[], field: string): number {
  return values.reduce<number>((count, value) => count + (isRecord(value) && Array.isArray(value[field]) ? value[field].length : 0), 0);
}

function previewJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? "{}";
  return text.length > maxPreviewChars ? `${text.slice(0, maxPreviewChars)}\n... truncated` : text;
}

function rowsFromRecord(record: Record<string, unknown>, limit = 8): Array<{ label: string; value: string | number }> {
  return Object.entries(record)
    .slice(0, limit)
    .map(([label, value]) => ({ label, value: summarizeValue(value) }));
}

function rowsForRecords(
  values: unknown[],
  label: string,
  pickValue: (value: Record<string, unknown>) => string | number,
  limit = 6
): Array<{ label: string; value: string | number }> {
  return values.slice(0, limit).map((value, index) => ({
    label: `${label} ${index + 1}`,
    value: isRecord(value) ? pickValue(value) : summarizeValue(value)
  }));
}

function summarizeValue(value: unknown): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length) return value;
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  if (isRecord(value)) return `${Object.keys(value).length} keys`;
  if (value === null) return "null";
  return "unknown";
}
