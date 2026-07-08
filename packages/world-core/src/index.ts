export type StudioMode = "view" | "edit" | "simulate" | "pilot" | "sensors" | "episode";

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

export type SparkRenderProfile = "world-studio-default" | "capture-splat-vksplat";

export interface RendererDiagnostics {
  splatRenderPath: SplatRenderPath;
  sparkState: SparkLoadState;
  sparkRenderable: boolean;
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
  code: "file_too_large" | "malformed_json" | "missing_primary_artifact" | "unsupported_layout";
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
  initialCamera?: HandoffInitialCamera;
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
