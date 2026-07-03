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
  packageKind?: string;
  authorityStatus: AuthorityStatus;
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
}

export interface AgentState {
  x: number;
  z: number;
  heading: number;
}

export type SpawnPlacementStatus = "valid" | "blocked" | "miss" | "pending" | "unavailable";

export interface SpawnPlacementResult {
  status: SpawnPlacementStatus;
  x?: number;
  y?: number;
  z?: number;
  footprintRadius: number;
  message: string;
  source: "rapier-collision-world" | "ground-plane" | "renderer";
}

export type AgentMoveStatus = "clear" | "blocked" | "outside_bounds" | "pending" | "unavailable";

export interface AgentMoveResult {
  status: AgentMoveStatus;
  from: AgentState;
  target: AgentState;
  resolved: AgentState;
  footprintRadius: number;
  message: string;
  source: "rapier-collision-world" | "renderer";
}

export type PhysicsDebugStatus = "idle" | "loading" | "ready" | "failed" | "unavailable";

export interface PhysicsDebugInfo {
  status: PhysicsDebugStatus;
  obstacleTriangles: number;
  colliders: number;
  dynamicBodies?: number;
  fixedTimestep?: number;
  simulationStep?: number;
  lastStepMs?: number;
  props?: SimulatedPropState[];
  footprintRadius?: number;
  source: "rapier-collision-world" | "renderer";
}

export type SimulatedPropShape = "box";

export type SimulatedPropPreset = "crate" | "tall-crate";

export type PropContactState = "airborne" | "grounded" | "sleeping";

export interface SimulatedPropState {
  id: string;
  label: string;
  shape: SimulatedPropShape;
  preset: SimulatedPropPreset;
  contactState: PropContactState;
  footprintRadius: number;
  height: number;
  x: number;
  y: number;
  z: number;
  sleeping: boolean;
}

export interface SimulationCommand {
  id: number;
  action: "reset" | "step" | "spawn-prop" | "delete-prop" | "duplicate-prop" | "reset-prop" | "nudge-prop" | "move-prop";
  steps?: number;
  preset?: SimulatedPropPreset;
  targetPropId?: string;
  position?: {
    x: number;
    y: number;
    z: number;
  };
  delta?: {
    x: number;
    y?: number;
    z: number;
  };
}

export type RendererBackendStatus = "idle" | "loading" | "ready" | "failed" | "unavailable";

export type SplatBackend = "spark" | "points-fallback" | "unavailable";

export interface RendererDebugInfo {
  activeSplatBackend: SplatBackend;
  sparkStatus: RendererBackendStatus;
  sparkRenderable: boolean;
  sparkSplatCount: number;
  pointCount: number;
  gaussianUrl?: string;
  message: string;
}

export interface SensorRigChannel {
  id: string;
  label: string;
  kind: "rgb" | "depth" | "segmentation" | "lidar" | "imu";
  enabled: boolean;
  spec: string;
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
  density: number;
  exposure: number;
  accent: string;
  selected: ReadonlySet<number>;
  deleted: ReadonlySet<number>;
  showDeleted: boolean;
  isolatedClass?: number;
  agent?: AgentState;
  trajectory?: Array<[number, number]>;
  spawnPlacement?: SpawnPlacementResult | null;
  agentMove?: AgentMoveResult | null;
  physicsDebug?: boolean;
  simulationVisible?: boolean;
  simulationCommand?: SimulationCommand | null;
  selectedPropId?: string;
  grid: boolean;
}

export interface RenderAdapter {
  render(canvas: HTMLCanvasElement, options: RenderOptions): void;
  collectInRadius(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number, radius: number): number[];
  querySpawnPlacement?(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number, footprintRadius: number): SpawnPlacementResult;
  queryAgentMove?(from: AgentState, target: AgentState, footprintRadius: number): AgentMoveResult;
  queryPropAt?(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number): SimulatedPropState | null;
  getPhysicsDebugInfo?(): PhysicsDebugInfo;
  getRendererDebugInfo?(): RendererDebugInfo;
  capture(canvas: HTMLCanvasElement): string;
  dispose?(): void;
}

export interface LocalWorldPackageTextFile {
  relativePath: string;
  text: string;
}

export interface LocalWorldPackageBinaryFile {
  relativePath: string;
  dataUrl: string;
  headerText: string;
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
  kind: "asset-set" | "scene-manifest" | "media-frames" | "figure-views" | "verified-export" | "json-manifest";
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
}

export interface BudoMediaFrame {
  display_name?: string;
  rgb_path?: string;
  width?: number;
  height?: number;
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
