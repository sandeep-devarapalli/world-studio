import type { CaptureSplatTrainingDatasetV1 } from "./gaussian-pipeline-contract.js";
import type { CaptureSplatConsumerReceiptV1 } from "./capture-splat-consumer-receipt-contract.js";

export type StudioMode = "view" | "edit" | "simulate" | "pilot" | "sensors" | "episode";

export * from "./gaussian-pipeline-contract.js";
export * from "./capture-splat-consumer-receipt-contract.js";
export * from "./world-graph-contract.js";
export * from "./physics-smoke-cell.js";

export type RenderMode = "splat" | "points" | "mesh" | "semantic" | "depth";

export type AssetKind =
  | "ordinary-ply"
  | "gaussian-ply"
  | "obj-mesh"
  | "budo-media-bundle"
  | "verified-semantic-export"
  | "unknown";

export type AuthorityStatus =
  | "visual_evidence"
  | "proposal_not_ground_truth"
  | "review_session_candidate_not_ground_truth"
  | "human_verified_semantic_labels"
  | "externally_validated_semantic_labels";

export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

export interface WorldClass {
  label: number;
  name: string;
  colorShaded?: string;
  colorFlat?: string;
  points?: number;
}

export interface WorldProvenance {
  sourceKind: string;
  loadedVia: string;
  sourcePath: string;
  primaryArtifact: string;
  loadedAt: string;
  companionArtifacts: string[];
  assetManifest?: WorldAssetManifestEntry[];
  packageKind?: string;
  authorityStatus: AuthorityStatus;
  captureSplatQuality?: CaptureSplatQualityHandoff;
}

export interface WorldAssetManifestEntry {
  relativePath: string;
  sizeBytes?: number;
  checksum?: string;
}

export interface WorldSession {
  id: string;
  name: string;
  version?: string;
  units: "meters" | string;
  upAxis: "x" | "y" | "z" | string;
  provenance: WorldProvenance;
  pointCount?: number;
  bounds?: Bounds3;
  classes: WorldClass[];
  agentSpawn?: AgentState;
}

export type LiveReceiverState =
  | "stopped"
  | "listening"
  | "receiving"
  | "interrupted"
  | "resuming"
  | "finalized";

export interface LiveMissingRange {
  start: number;
  end: number;
}

export type LiveEvidenceAssetRole =
  | "source"
  | "depth"
  | "confidence"
  | "mask-person"
  | "mask-valid"
  | "mask-object";

export interface LiveFrameIntrinsics {
  model: "pinhole";
  flX: number;
  flY: number;
  cx: number;
  cy: number;
  calibrationWidth: number;
  calibrationHeight: number;
  appliesTo: "source_frame" | "depth" | "confidence" | "unknown";
}

export interface LiveFrameQuality {
  accepted: boolean;
  reason?: string;
  score?: number;
  blurScore?: number;
  exposureMean?: number;
  exposureDelta?: number;
  clippedHighlightFraction?: number;
  nearClippedHighlightFraction?: number;
  clippedShadowFraction?: number;
  featureGridCoverage?: number;
  parallaxMeters?: number;
  angularVelocityDegS?: number;
  translationSpeedMS?: number;
  colmapOverlapScore?: number;
  validDepthRatio?: number;
  featurePointCount?: number;
}

export interface LiveFrameAssetSummary {
  role: LiveEvidenceAssetRole;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  width: number | null;
  height: number | null;
  previewAvailable: boolean;
}

export interface LiveFrameSummary {
  sequenceId: number;
  timestamp: number;
  clockDomain: string;
  sourceFrameName: string;
  sourceWidth: number;
  sourceHeight: number;
  cameraToWorld: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
  ];
  coordinateFrame: string;
  previewAvailable: boolean;
  intrinsics: LiveFrameIntrinsics;
  tracking: { state: string };
  quality: LiveFrameQuality;
  assets: LiveFrameAssetSummary[];
}

export interface LiveSessionSnapshot {
  state: LiveReceiverState;
  listening: { host: string; port: number } | null;
  sessionId: string | null;
  sourceManifestId: string | null;
  coordinateUnits: "meters" | "unknown" | null;
  expectedCount: number | null;
  finalSequenceId: number | null;
  receivedCount: number;
  contiguousCount: number;
  pendingCount: number;
  missingCount: number;
  nextExpectedSequenceId: number;
  missingRanges: LiveMissingRange[];
  frames: LiveFrameSummary[];
  authority: "proposal_only";
  updatedAt: string | null;
  error?: string;
}

export type LiveSecurityState =
  | "unavailable"
  | "loopback_only"
  | "pairing"
  | "pairing_pending"
  | "paired"
  | "secure_listening"
  | "error";

export interface LiveNetworkInterface {
  id: string;
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
}

export interface LivePairedDevice {
  deviceId: string;
  displayName: string;
  pairingEpoch: number;
  grantId: string;
  scopes: string[];
  pairedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastAuthenticatedAt: string | null;
}

export interface LivePendingPairingDevice {
  deviceId: string;
  displayName: string;
  pairingEpoch: number;
  requestedAt: string;
  expiresAt: string;
}

export interface LiveSecuritySnapshot {
  state: LiveSecurityState;
  desktopId: string | null;
  desktopName: string;
  interfaces: LiveNetworkInterface[];
  selectedInterfaceId: string | null;
  secureListening: { host: string; port: number; tls: true } | null;
  pairingInvitationUri: string | null;
  pairingVerificationCode: string | null;
  tlsCertificateSha256: string | null;
  pairingExpiresAt: string | null;
  pendingDevice: LivePendingPairingDevice | null;
  pairedDevices: LivePairedDevice[];
  updatedAt: string | null;
  error?: string;
}

export interface LiveFramePreview {
  sessionId: string;
  sequenceId: number;
  role: LiveEvidenceAssetRole;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  dataUrl: string;
  width: number | null;
  height: number | null;
}

export type ReconstructionWorkerState =
  | "unavailable"
  | "idle"
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

export interface ReconstructionWorkerBudget {
  maxWallTimeMs: number;
  maxMemoryBytes: number;
  maxOutputBytes: number;
  maxLogBytes: number;
  maxOutputArtifacts: number;
}

export interface ReconstructionWorkerCapabilitySummary {
  workerId: string;
  label: string;
  protocolVersion: string;
  available: boolean;
  unavailableReason: string | null;
  outputRoles: string[];
  budget: ReconstructionWorkerBudget;
}

export interface ReconstructionWorkerOutputSummary {
  outputId: string;
  role: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  coordinateFrame: string | null;
  status: "progressive" | "completed" | "discarded";
  previewAvailable: boolean;
}

export interface ReconstructionWorkerLogSummary {
  sequenceId: number;
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  code: string;
  message: string;
}

export interface ReconstructionWorkerJobSummary {
  jobId: string;
  workerId: string;
  attempt: number;
  state: ReconstructionWorkerState;
  input: {
    sessionId: string;
    throughSequenceId: number;
    frameCount: number;
    manifestSha256: string;
  };
  progress: number | null;
  budget: ReconstructionWorkerBudget;
  logs: ReconstructionWorkerLogSummary[];
  outputs: ReconstructionWorkerOutputSummary[];
  failure: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  authority: "proposal_only";
}

export interface ReconstructionWorkerSnapshot {
  state: ReconstructionWorkerState;
  capabilities: ReconstructionWorkerCapabilitySummary[];
  job: ReconstructionWorkerJobSummary | null;
  authority: "proposal_only";
  updatedAt: string | null;
  error?: string;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
  fov: number;
  roll?: number;
}

export interface FrameCamera {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  coordinateFrame?: string;
  authority?: string;
}

export interface FirstPersonCamera {
  position: [number, number, number];
  rotation: [number, number, number, number];
  fov: number;
  coordinateFrame?: string;
  authority?: string;
  roll?: number;
}

export interface WorldOrientation {
  rotation: [number, number, number, number];
  center: [number, number, number];
  sourceUp?: [number, number, number];
  authority?: string;
}

export interface AgentState {
  x: number;
  z: number;
  heading: number;
}

export interface PhysicsDiagnostics {
  backend: "rapier3d-compat" | "unavailable";
  stepRateHz: number;
  bodyCount: number;
  colliderCount: number;
  contactCount: number;
  grounded: boolean;
}

export interface SensorRigChannel {
  id: string;
  label: string;
  kind: "rgb" | "depth" | "segmentation" | "lidar" | "imu";
  enabled: boolean;
  spec: string;
  fovDeg: number;
  rangeM: number;
  resolution: string;
}

export interface EpisodeTrackBlock {
  id: string;
  lane: "agent" | "object" | "capture";
  start: number;
  end: number;
  label: string;
}

export interface RenderOptions {
  mode: RenderMode;
  camera: CameraState;
  frameCamera?: FrameCamera;
  firstPersonCamera?: FirstPersonCamera;
  worldOrientation?: WorldOrientation;
  evidenceMeshMode?: "off" | "overlay" | "only";
  density: number;
  exposure: number;
  accent: string;
  selected: ReadonlySet<number>;
  deleted: ReadonlySet<number>;
  showDeleted: boolean;
  isolatedClass?: number;
  agent?: AgentState;
  spawn?: AgentState;
  trajectory?: Array<[number, number]>;
  sensors?: SensorRigChannel[];
  selectedSensorId?: string;
  debugCollision: boolean;
  agentBodyRadius?: number;
  grid: boolean;
  gridY?: number;
  cropBounds?: CropBounds;
  pointTransforms?: ReadonlyMap<number, PointTransform>;
}

export interface CropBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PointTransform {
  dx: number;
  dy: number;
  dz: number;
}

export type SparkLoadState = "unavailable" | "idle" | "loading" | "ready" | "failed";

export type SplatRenderPath = "spark-gaussian" | "point-fallback";

export type SparkRenderProfile =
  | "world-studio-default"
  | "capture-splat-generic"
  | "capture-splat-vksplat"
  | "capture-splat-gsplat";

export interface RendererDiagnostics {
  splatRenderPath: SplatRenderPath;
  sparkState: SparkLoadState;
  sparkRenderable: boolean;
  sparkVisible: boolean;
  pointFallbackVisible: boolean;
  hasGaussianSource: boolean;
  sparkProfile?: SparkRenderProfile;
  gaussianSourceFormat?: string;
  gaussianPreparedForSpark?: boolean;
  gaussianSplatCount?: number;
  gaussianClampedScaleCount?: number;
  gaussianNormalizedRotationCount?: number;
  gaussianDroppedOutlierCount?: number;
  sparkFailureReason?: string;
}

export interface RenderAdapter {
  render(canvas: HTMLCanvasElement, options: RenderOptions): void;
  collectInRadius(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number, radius: number): number[];
  collectInRect?(canvas: HTMLCanvasElement, options: RenderOptions, x0: number, y0: number, x1: number, y1: number): number[];
  projectToGround?(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number): [number, number, number] | null;
  capture(canvas: HTMLCanvasElement): string;
  getDiagnostics?(): RendererDiagnostics;
  dispose?(): void;
}

export interface LocalWorldPackageTextFile {
  relativePath: string;
  text: string;
  sizeBytes?: number;
  checksum?: string;
}

export interface LocalWorldPackageBinaryFile {
  relativePath: string;
  dataUrl: string;
  headerText: string;
  sizeBytes?: number;
  checksum?: string;
}

export interface LocalPackageInsightMetric {
  label: string;
  value: string | number;
}

export interface LocalPackageInsightSection {
  title: string;
  rows: LocalPackageInsightMetric[];
  previewText?: string;
}

export interface LocalPackageInsight {
  id: string;
  kind: "asset-set" | "scene-manifest" | "media-frames" | "figure-views" | "verified-export" | "json-manifest" | "capture-splat-manifest";
  title: string;
  artifact: string;
  summary: string;
  status?: string;
  metrics: LocalPackageInsightMetric[];
  details: LocalPackageInsightMetric[];
  sections?: LocalPackageInsightSection[];
  previewText?: string;
}

export interface LocalPackageIssue {
  id: string;
  severity: "error" | "warning";
  code:
    | "file_too_large"
    | "invalid_capture_splat_ply_stats"
    | "invalid_capture_splat_render_source_qa"
    | "invalid_capture_splat_consumer_receipt"
    | "invalid_capture_splat_training_dataset"
    | "malformed_json"
    | "missing_primary_artifact"
    | "unsupported_layout";
  title: string;
  message: string;
  artifact?: string;
}

export interface LocalWorldPackagePayload {
  kind: "world-studio.local-package";
  name: string;
  sourcePath: string;
  loadedVia: "electron-picker";
  sourceKind: string;
  packageKind: string;
  primaryArtifact: string;
  companionArtifacts: string[];
  assetManifest?: WorldAssetManifestEntry[];
  authorityStatus: AuthorityStatus;
  sceneJson?: unknown;
  pointsPly?: LocalWorldPackageTextFile;
  gaussianPly?: LocalWorldPackageBinaryFile;
  objMesh?: LocalWorldPackageTextFile;
  budoMediaFrames?: LocalWorldPackageTextFile;
  articleFigureViews?: LocalWorldPackageTextFile;
  verifiedExport?: LocalWorldPackageTextFile;
  jsonManifests?: LocalWorldPackageTextFile[];
  packageInsights?: LocalPackageInsight[];
  packageIssues?: LocalPackageIssue[];
  sceneRadius?: number;
  medianStructureDistance?: number;
  captureProfile?: string;
  splatTrainer?: string;
  worldUp?: [number, number, number];
  initialCamera?: HandoffInitialCamera;
  captureSplatMetric?: CaptureSplatMetricHandoff;
  captureSplatQuality?: CaptureSplatQualityHandoff;
  captureSplatTrainingDataset?: CaptureSplatTrainingDatasetV1;
  captureSplatConsumerReceipt?: CaptureSplatConsumerReceiptV1;
}

export interface CaptureSplatQualityHandoff {
  renderSourceDecision: "promote" | "hold" | "reject" | "unavailable";
  frameCount?: number;
  validFrameCount?: number;
  weakFrameCount?: number;
  finitePly?: boolean;
  splatCount?: number;
  renderSourceQa?: LocalWorldPackageTextFile;
  plyStats?: LocalWorldPackageTextFile;
}

export interface CaptureSplatMetricHandoff {
  walkEligibility: "eligible" | "held" | "missing";
  walkReason: string;
  registrationStatus: "accepted" | "held" | "unavailable";
  registration?: Record<string, unknown>;
  navigationMesh?: LocalWorldPackageBinaryFile;
  navigationMeshTransform?: number[][];
  metersPerTargetUnit?: number;
  measurementPoints?: LocalWorldPackageBinaryFile;
  meshReport?: LocalWorldPackageTextFile;
  roomSemantics?: LocalWorldPackageTextFile;
  cameraTrajectory?: LocalWorldPackageTextFile;
}

export interface HandoffInitialCamera {
  position: [number, number, number];
  coordinateFrame?: string;
  mode?: "inside" | "orbit";
}

export interface EpisodeBundleAsset {
  relativePath: string;
  dataUrl: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
}

export interface SaveEpisodeBundleInput {
  suggestedName: string;
  text: string;
  assets?: EpisodeBundleAsset[];
}

export interface BudoMediaFrame {
  display_name?: string;
  rgb_path?: string;
  width?: number;
  height?: number;
  camera?: CameraState;
  frame_camera?: FrameCamera;
  intrinsics?: Record<string, unknown>;
  pose?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BudoMediaFramesManifest {
  schema?: string;
  source_kind?: string;
  frames: BudoMediaFrame[];
  [key: string]: unknown;
}

export interface BudoArticleFigureView {
  display_name?: string;
  point_cloud_path?: string;
  mesh_paths?: string[];
  notes?: string;
  [key: string]: unknown;
}

export interface BudoArticleFigureViewsManifest {
  schema?: string;
  views?: BudoArticleFigureView[];
  frames?: BudoArticleFigureView[];
  [key: string]: unknown;
}

export interface VerifiedSemanticExportManifest {
  schema: "budo.semantic_labels.verified_export.v0.1" | string;
  status: "human_verified_semantic_labels" | string;
  component_count: number;
  files: Record<string, string>;
  human_signoff: Record<string, unknown>;
  hashes: Record<string, string>;
  boundary: string;
}
