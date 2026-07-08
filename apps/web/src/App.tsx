import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  createLoftWorldSession,
  detectPlyKind,
  parseObjMesh,
  parseObjMeshSummary,
  parsePointCloudPly,
  type LoftSceneManifest,
  type ParsedObjMesh,
  type PointRecord
} from "@world-studio/artifacts";
import { accents, WSButton, WSChip, WSControlsBar, WSDot, WSIcon, WSKey, WSPanel, WSPill, WSRamp, WSSliderRow, WSStatusBar, WSSwitch, WSWordmark, type WSIconName } from "@world-studio/design-system";
import { ThreeWorldRenderer } from "@world-studio/renderer";
import { buildCleanedPointCloudPly, cleanedPointRows } from "./edit-ply-export";
import { FeedCanvas, TimelineCapsule, TracksPanel, type FeedMode, type FeedPose } from "./instruments";
import { RapierSimulation, agentBodyPresets, unavailablePhysicsDiagnostics, type AgentBodyPreset, type AgentBodyPresetId, type DriveCommand } from "./simulation";
import {
  classifySimulateDrag,
  commandForKey,
  applyWorldOrientationToFirstPersonCamera,
  applyWorldOrientationToFrameCamera,
  dollyCamera,
  dollyFirstPersonCamera,
  estimateWorldOrientation,
  firstPersonCameraFromFrame,
  holdRepeatStepsPerSecond,
  moveFirstPersonCamera,
  moveFreeCamera,
  panCamera,
  panFirstPersonCamera,
  radiusFromWorldPoints,
  rotateFirstPersonCamera,
  rotateFirstPersonCameraClamped,
  rotateCamera,
  stepsForSceneRadius,
  type SimulateCameraMode,
  type SimulateDragKind,
  type SimulateKeyCommand
} from "./simulate-camera";
import type {
  AgentState,
  AuthorityStatus,
  CameraState,
  CropBounds,
  FirstPersonCamera,
  FrameCamera,
  LocalPackageInsight,
  LocalPackageIssue,
  LocalWorldPackagePayload,
  EpisodeBundleAsset,
  PhysicsDiagnostics,
  PointTransform,
  RendererDiagnostics,
  RenderAdapter,
  RenderMode,
  RenderOptions,
  SensorRigChannel,
  SparkRenderProfile,
  StudioMode,
  WorldAssetManifestEntry,
  WorldClass,
  WorldOrientation,
  WorldSession
} from "@world-studio/world-core";

const modes: Array<{ id: StudioMode; label: string; title: string; tag: string }> = [
  { id: "view", label: "View", title: "Inspect", tag: "read only" },
  { id: "edit", label: "Edit", title: "Edit", tag: "history on" },
  { id: "simulate", label: "Simulate", title: "Validate", tag: "twin check" },
  { id: "pilot", label: "Pilot", title: "Pilot", tag: "agent live" },
  { id: "sensors", label: "Sensors", title: "Rig", tag: "perception" },
  { id: "episode", label: "Episode", title: "Replay", tag: "timeline" }
];

const renderModes: RenderMode[] = ["splat", "points", "mesh", "semantic", "depth"];

const fallbackClassColors = ["#5b6f8a", "#3d4a5c", "#b04a8f", "#d9764a", "#c9a93f", "#e8e26a", "#4fae62", "#8f6fd9", "#4fc3d9"];

const controls: Record<StudioMode, Array<{ keyName?: string; glyph?: WSIconName; label: string }>> = {
  view: [
    { keyName: "L", label: "load" },
    { glyph: "mouseL", label: "orbit" },
    { glyph: "wheel", label: "zoom" }
  ],
  edit: [
    { glyph: "mouseL", label: "brush" },
    { keyName: "⌘Z", label: "undo" },
    { keyName: "Del", label: "delete" }
  ],
  simulate: [
    { keyName: "WASD/↑↓", label: "move" },
    { keyName: "←→", label: "look" },
    { keyName: "Shift+←→", label: "strafe" },
    { keyName: "Q/E", label: "rise" },
    { keyName: "R/F", label: "roll" },
    { keyName: "Space", label: "mouse look" },
    { glyph: "wheel", label: "zoom" },
    { glyph: "mouseL", label: "rotate" },
    { keyName: "Alt", label: "orbit" },
    { keyName: "F11", label: "fullscreen" }
  ],
  pilot: [
    { keyName: "WASD", label: "drive" },
    { keyName: "R", label: "reset" },
    { keyName: "P", label: "pip" }
  ],
  sensors: [
    { keyName: "G", label: "place" },
    { keyName: "/", label: "filter" },
    { glyph: "mouseL", label: "orbit" }
  ],
  episode: [
    { keyName: "Space", label: "play" },
    { keyName: "← →", label: "step" },
    { keyName: "E", label: "export" }
  ]
};

const simulateRailHints: Array<{ keyName?: string; glyph?: WSIconName; label: string }> = [
  { keyName: "WASD", label: "move" },
  { glyph: "mouseL", label: "look" },
  { keyName: "Space", label: "mouse look" },
  { keyName: "Shift", label: "strafe" },
  { keyName: "Q/E", label: "rise" },
  { keyName: "R/F", label: "roll" },
  { keyName: "Alt", label: "orbit" }
];

const stripCells: Array<{ mode: FeedMode; label: string }> = [
  { mode: "rgb", label: "RGB" },
  { mode: "depth", label: "DEPTH" },
  { mode: "semantic", label: "SEG" },
  { mode: "points", label: "LIDAR" }
];

const simFeedPose: FeedPose = { x: 1.6, y: 1.35, z: 2.0, heading: -2.2, pitch: -0.23 };

const sensorIcons: Record<SensorRigChannel["kind"], WSIconName> = {
  rgb: "camera",
  depth: "camera",
  segmentation: "layers",
  lidar: "lidar",
  imu: "imu"
};

const sensorKindOptions: SensorRigChannel["kind"][] = ["rgb", "depth", "segmentation", "lidar", "imu"];

const editTools: Array<{ id: string; icon: WSIconName; title: string }> = [
  { id: "orbit", icon: "orbit", title: "orbit" },
  { id: "brush", icon: "brush", title: "brush select" },
  { id: "rect", icon: "rect", title: "rect select" },
  { id: "crop", icon: "crop", title: "crop box" },
  { id: "move", icon: "move", title: "transform" },
  { id: "ruler", icon: "ruler", title: "measure" }
];

interface AssetSummary {
  gaussianKind: string;
  objFaces: number;
  objGroups: number;
  pointCount: number;
}

interface CaptureFrame {
  camera?: CameraState;
  frameCamera?: FrameCamera;
  name: string;
  path: string;
  previewDataUrl?: string;
  renderPreviewDataUrl?: string;
}

interface SensorCaptureArtifact {
  id: string;
  eventId: string;
  frame: number;
  sensorId: string;
  sensorLabel: string;
  sensorKind: SensorRigChannel["kind"];
  sensorSpec: string;
  capturedAt: string;
  previewDataUrl: string;
  assetPath?: string;
  assetStatus: "embedded" | "external" | "resolved" | "missing" | "metadata_mismatch";
  mimeType: "image/png";
  renderMode: RenderMode;
  rendererStatus: string;
  worldName: string;
  sourcePath: string;
  loadedVia: string;
  camera: CameraState;
  size: { width: number; height: number };
  bytes: number;
  sizeBytes: number;
  checksum: string;
}

interface LoadedWorldInput {
  name: string;
  scene?: LoftSceneManifest;
  captureFrames?: CaptureFrame[];
  pointsText?: string;
  gaussianHeaderText?: string;
  gaussianUrl?: string;
  objText?: string;
  loadedVia: string;
  sourcePath: string;
  sourceKind: string;
  packageKind: string;
  primaryArtifact: string;
  companionArtifacts: string[];
  assetManifest?: WorldAssetManifestEntry[];
  authorityStatus: AuthorityStatus;
  packageInsights?: LocalPackageInsight[];
  packageIssues?: LocalPackageIssue[];
}

interface LoadedWorldOptions {
  preserveEpisode?: boolean;
}

interface StageRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface CropRegion {
  bounds: CropBounds;
  stage: StageRect;
  hiddenCount: number;
}

interface SelectionHistoryItem {
  id: string;
  type: "select" | "delete";
  count: number;
  indices: number[];
}

interface CropHistoryItem {
  id: string;
  type: "crop";
  count: number;
  previousCrop: CropRegion | null;
  nextCrop: CropRegion | null;
}

interface TransformHistoryItem {
  id: string;
  type: "transform";
  count: number;
  indices: number[];
  delta: PointTransform;
  previousTransforms: Map<number, PointTransform>;
}

interface OptimizeHistoryItem {
  id: string;
  type: "optimize";
  count: number;
  indices: number[];
  label: string;
}

type PublishFormat = "ply" | "splat" | "sogs";
type PublishStatus = "idle" | "preview" | "exported";

type HistoryItem = SelectionHistoryItem | CropHistoryItem | TransformHistoryItem | OptimizeHistoryItem;

interface TransformDraft {
  dx: number;
  dz: number;
  count: number;
  stage: { x: number; y: number };
}

interface TransformDrag {
  startWorld: [number, number, number];
  indices: number[];
  baseTransforms: Map<number, PointTransform>;
}

interface EditOptimizeStats {
  totalPoints: number;
  exportPointCount: number;
  deletedCount: number;
  cropHiddenCount: number;
  movedCount: number;
  shDegree: number;
  format: PublishFormat;
  estimatedSizeBytes: number;
}

const initialCamera: CameraState = {
  yaw: 0.62,
  pitch: 0.42,
  distance: 7.2,
  target: [0, 0.7, -0.2],
  fov: 50
};

const initialSensors: SensorRigChannel[] = [
  { id: "rgb", label: "RGB", kind: "rgb", enabled: true, spec: "color stream", fovDeg: 72, rangeM: 18, resolution: "1920x1080" },
  { id: "depth", label: "DEPTH", kind: "depth", enabled: true, spec: "linear · meters", fovDeg: 72, rangeM: 8, resolution: "640x480" },
  { id: "seg", label: "SEG", kind: "segmentation", enabled: true, spec: "class id", fovDeg: 72, rangeM: 18, resolution: "1024x1024" },
  { id: "lidar", label: "LIDAR", kind: "lidar", enabled: false, spec: "32 beam · 20hz", fovDeg: 360, rangeM: 32, resolution: "32 beam" },
  { id: "imu", label: "IMU", kind: "imu", enabled: true, spec: "200hz", fovDeg: 0, rangeM: 0, resolution: "6-axis" }
];

const brushRadius = 42;
const defaultSpawn: AgentState = { x: 1.5, z: -0.5, heading: 4.4 };

interface SpawnChoice {
  id: string;
  label: string;
  agent: AgentState;
}

type SimulatedPropPreset = "crate" | "tall-crate";
type EpisodeLane = "agent" | "object" | "capture";

interface SimulatedPropState {
  id: string;
  label: string;
  preset: SimulatedPropPreset;
  contactState: "grounded" | "airborne" | "sleeping";
  x: number;
  y: number;
  z: number;
  footprintRadius: number;
}

interface EpisodeEvent {
  id: string;
  frame: number;
  lane: EpisodeLane;
  label: string;
  targetId?: string;
  status?: string;
}

interface ImportedEpisodeManifest {
  worldName: string | null;
  selectedEventId: string | null;
  playhead: number;
  events: EpisodeEvent[];
  trajectory: Array<[number, number]>;
  props: SimulatedPropState[];
  sensors: SensorRigChannel[];
  sensorCaptures: SensorCaptureArtifact[];
  provenance: EpisodeProvenanceSummary;
}

interface EpisodeProvenanceSummary {
  schema: string;
  source: "manifest" | "bundle";
  loadedFrom: string;
  worldName: string;
  packageKind: string;
  sourcePath: string;
  loadedVia: string;
  primaryArtifact: string;
  companionArtifacts: string[];
  assetManifest: WorldAssetManifestEntry[];
  authorityStatus: string;
  rendererMode: string;
  rendererStatus: string;
  notes: string[];
}

interface EpisodeSourceMatch {
  status: "matched" | "missing" | "mismatch" | "manifest";
  detail: string;
}

interface EpisodeAssetValidation {
  status: "validated" | "missing" | "mismatch" | "pending" | "manifest";
  detail: string;
}

interface EpisodeIntegrityRow {
  path: string;
  status: "validated" | "missing" | "mismatch" | "pending";
  expectedSize: string;
  expectedChecksum: string;
  actualSize: string;
  actualChecksum: string;
}

interface MeasurePoint {
  world: [number, number, number];
  stage: { x: number; y: number };
}

const defaultProps: SimulatedPropState[] = [
  { id: "prop-crate-a", label: "crate_a", preset: "crate", contactState: "grounded", x: -0.8, y: 0.18, z: 0.4, footprintRadius: 0.3 },
  { id: "prop-tall-a", label: "tall-crate_a", preset: "tall-crate", contactState: "grounded", x: 0.9, y: 0.42, z: 0.9, footprintRadius: 0.26 }
];

function normalizeStageRect(rect: StageRect): StageRect {
  return {
    x0: Math.min(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    x1: Math.max(rect.x0, rect.x1),
    y1: Math.max(rect.y0, rect.y1)
  };
}

function stageRectStyle(rect: StageRect): React.CSSProperties {
  const normalized = normalizeStageRect(rect);
  return {
    left: normalized.x0,
    top: normalized.y0,
    width: normalized.x1 - normalized.x0,
    height: normalized.y1 - normalized.y0
  };
}

function pointInsideCrop(point: PointRecord, bounds: CropBounds): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ;
}

function addPointTransform(base: PointTransform | undefined, delta: PointTransform): PointTransform {
  return {
    dx: (base?.dx ?? 0) + delta.dx,
    dy: (base?.dy ?? 0) + delta.dy,
    dz: (base?.dz ?? 0) + delta.dz
  };
}

function isZeroTransform(transform: PointTransform): boolean {
  return Math.hypot(transform.dx, transform.dy, transform.dz) < 0.0001;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<{ kind: "camera" | "brush" | "rect" | "crop" | "move"; x: number; y: number; dragKind?: SimulateDragKind } | null>(null);
  const brushStrokeRef = useRef<Set<number>>(new Set());
  const transformDragRef = useRef<TransformDrag | null>(null);
  const simulationRef = useRef<RapierSimulation | null>(null);
  const simulationTokenRef = useRef(0);
  const propSeqRef = useRef(defaultProps.length);
  const episodeFrameRef = useRef(0);
  const collisionMeshRef = useRef<ParsedObjMesh | undefined>(undefined);
  const episodeImportInputRef = useRef<HTMLInputElement | null>(null);
  const [scale, setScale] = useState(1);
  const [mode, setMode] = useStoredState<StudioMode>("ws-app-mode", "view");
  const [renderMode, setRenderMode] = useStoredState<RenderMode>("ws-app-vmode", "splat");
  const [accentName, setAccentName] = useStoredState<keyof typeof accents>("ws-app-accent", "ember");
  const [dense, setDense] = useStoredState("ws-app-density", false);
  const [docked, setDocked] = useStoredState("ws-app-docked", false);
  const [session, setSession] = useState<WorldSession | null>(null);
  const [assetSummary, setAssetSummary] = useState<AssetSummary | null>(null);
  const [packageInsights, setPackageInsights] = useState<LocalPackageInsight[]>([]);
  const [packageIssues, setPackageIssues] = useState<LocalPackageIssue[]>([]);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<RenderAdapter | null>(null);
  const [rendererDiagnostics, setRendererDiagnostics] = useState<RendererDiagnostics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [camera, setCamera] = useState(initialCamera);
  const [density, setDensity] = useState(0.9);
  const [exposure, setExposure] = useState(1);
  const [shDegree, setShDegree] = useState(3);
  const [publishFormat, setPublishFormat] = useState<PublishFormat>("ply");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [editPublishText, setEditPublishText] = useState<string | null>(null);
  const [editPublishMessage, setEditPublishMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [showDeleted, setShowDeleted] = useState(true);
  const [isolatedClass, setIsolatedClass] = useState<number | undefined>(undefined);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [cropRegion, setCropRegion] = useState<CropRegion | null>(null);
  const [cropDraft, setCropDraft] = useState<StageRect | null>(null);
  const [pointTransforms, setPointTransforms] = useState<Map<number, PointTransform>>(new Map());
  const [transformDraft, setTransformDraft] = useState<TransformDraft | null>(null);
  const [lastTransformDelta, setLastTransformDelta] = useState<TransformDraft | null>(null);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [agent, setAgent] = useState<AgentState>(defaultSpawn);
  const [spawn, setSpawn] = useState<AgentState>(defaultSpawn);
  const [bodyPresetId, setBodyPresetId] = useState<AgentBodyPresetId>("locobot");
  const [debugCollision, setDebugCollision] = useState(false);
  const [trajectory, setTrajectory] = useState<Array<[number, number]>>([[defaultSpawn.x, defaultSpawn.z]]);
  const [physicsDiagnostics, setPhysicsDiagnostics] = useState<PhysicsDiagnostics>(unavailablePhysicsDiagnostics());
  const [sensors, setSensors] = useState(initialSensors);
  const [playhead, setPlayhead] = useState(0.28);
  const [playing, setPlaying] = useState(false);
  const [props, setProps] = useState<SimulatedPropState[]>(defaultProps);
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [selectedPropPreset, setSelectedPropPreset] = useState<SimulatedPropPreset>("crate");
  const [episodeEvents, setEpisodeEvents] = useState<EpisodeEvent[]>([]);
  const [selectedEpisodeEventId, setSelectedEpisodeEventId] = useState<string | null>(null);
  const [episodeExportText, setEpisodeExportText] = useState<string | null>(null);
  const [episodeSaveStatus, setEpisodeSaveStatus] = useState<string | null>(null);
  const [episodeProvenance, setEpisodeProvenance] = useState<EpisodeProvenanceSummary | null>(null);
  const [episodeIntegrityOpen, setEpisodeIntegrityOpen] = useState(false);
  const [captureCompareIds, setCaptureCompareIds] = useState<string[]>([]);
  const [selectedSourceFrameIndex, setSelectedSourceFrameIndex] = useState(0);
  const [simulateCameraMode, setSimulateCameraMode] = useState<SimulateCameraMode>("frame");
  const [firstPersonCamera, setFirstPersonCamera] = useState<FirstPersonCamera | null>(null);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState("brush");
  const [worldPoints, setWorldPoints] = useState<PointRecord[]>([]);
  const [captureFrames, setCaptureFrames] = useState<CaptureFrame[]>([]);
  const [sensorCaptures, setSensorCaptures] = useState<SensorCaptureArtifact[]>([]);
  const [selectedSensorId, setSelectedSensorId] = useState(initialSensors[0]?.id ?? "rgb");
  const [stepCount, setStepCount] = useState(0);
  const [lastAction, setLastAction] = useState("idle");
  const [treeFilter, setTreeFilter] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [selectRect, setSelectRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const accent = accents[accentName];
  const totalSteps = Math.max(trajectory.length - 1, 1);
  const replayAgent = useMemo(() => interpolateTrajectory(trajectory, playhead), [trajectory, playhead]);
  const bodyPreset = useMemo(
    () => agentBodyPresets.find((preset) => preset.id === bodyPresetId) ?? agentBodyPresets[1],
    [bodyPresetId]
  );
  const spawnChoices = useMemo(() => buildSpawnChoices(session), [session]);
  const selectedProp = useMemo(
    () => props.find((prop) => prop.id === selectedPropId) ?? props[0] ?? null,
    [props, selectedPropId]
  );
  const selectedSensor = useMemo(
    () => sensors.find((sensor) => sensor.id === selectedSensorId) ?? sensors[0] ?? null,
    [selectedSensorId, sensors]
  );
  const cleanedPlyImport = session?.provenance.packageKind === "world-studio-cleaned-ply";
  const selectedSensorCaptures = useMemo(
    () => sensorCaptures.filter((capture) => capture.sensorId === selectedSensor?.id),
    [selectedSensor?.id, sensorCaptures]
  );
  const editOptimizeStats = useMemo(
    () => buildEditOptimizeStats(worldPoints, deleted, cropRegion, pointTransforms, publishFormat, shDegree),
    [cropRegion, deleted, pointTransforms, publishFormat, shDegree, worldPoints]
  );
  const measurementDistance = useMemo(() => {
    if (measurePoints.length < 2) return null;
    const [a, b] = measurePoints;
    if (!a || !b) return null;
    return Math.hypot(b.world[0] - a.world[0], b.world[1] - a.world[1], b.world[2] - a.world[2]);
  }, [measurePoints]);
  const latestSensorCapture = selectedSensorCaptures[0] ?? null;
  const episodeTimeline = useMemo(() => [...episodeEvents].sort((a, b) => a.frame - b.frame), [episodeEvents]);
  const selectedEpisodeEvent = useMemo(
    () => episodeTimeline.find((event) => event.id === selectedEpisodeEventId) ?? episodeTimeline.at(-1) ?? null,
    [episodeTimeline, selectedEpisodeEventId]
  );
  const selectedEpisodeCapture = useMemo(
    () => sensorCaptures.find((capture) => capture.eventId === selectedEpisodeEvent?.id) ?? null,
    [selectedEpisodeEvent?.id, sensorCaptures]
  );
  const captureCompareCandidates = useMemo(
    () => [...sensorCaptures].sort((a, b) => a.frame - b.frame),
    [sensorCaptures]
  );
  const captureComparison = useMemo(
    () => captureCompareIds.flatMap((id) => sensorCaptures.find((capture) => capture.id === id) ?? []),
    [captureCompareIds, sensorCaptures]
  );
  const simulateCompareCaptures = captureComparison.length ? captureComparison : captureCompareCandidates;
  const selectedSourceFrame = captureFrames[selectedSourceFrameIndex] ?? captureFrames.find((frame) => frame.previewDataUrl) ?? null;
  const simulateComparisonCapture = selectedEpisodeCapture ?? simulateCompareCaptures[0] ?? latestSensorCapture;
  const simulateSourceFrame = simulateComparisonCapture ? null : selectedSourceFrame;
  const worldOrientation = useMemo<WorldOrientation | undefined>(
    () => estimateWorldOrientation(captureFrames.map((frame) => frame.frameCamera), centerFromWorldPoints(worldPoints)),
    [captureFrames, worldPoints]
  );
  const sceneRadius = useMemo(
    () => radiusFromWorldPoints(worldPoints, centerFromWorldPoints(worldPoints)),
    [worldPoints]
  );
  const simulateSteps = useMemo(() => stepsForSceneRadius(sceneRadius), [sceneRadius]);
  const leveledSourceFrameCamera = simulateSourceFrame?.frameCamera
    ? applyWorldOrientationToFrameCamera(simulateSourceFrame.frameCamera, worldOrientation)
    : undefined;
  const heldSimulateKeysRef = useRef(new Map<string, SimulateKeyCommand>());
  const firstPersonCameraRef = useRef<FirstPersonCamera | null>(null);
  const leveledSourceFrameCameraRef = useRef<FrameCamera | undefined>(undefined);
  const simulateStepsRef = useRef(simulateSteps);
  useEffect(() => {
    firstPersonCameraRef.current = firstPersonCamera;
  }, [firstPersonCamera]);
  useEffect(() => {
    leveledSourceFrameCameraRef.current = leveledSourceFrameCamera;
  }, [leveledSourceFrameCamera]);
  useEffect(() => {
    simulateStepsRef.current = simulateSteps;
  }, [simulateSteps]);
  const applySimulateCommand = useCallback((command: SimulateKeyCommand, fraction = 1) => {
    const leveled = leveledSourceFrameCameraRef.current;
    const steps = simulateStepsRef.current;
    if (firstPersonCameraRef.current || leveled) {
      setFirstPersonCamera((current) => {
        const base = current ?? (leveled ? firstPersonCameraFromFrame(leveled) : null);
        return base ? moveFirstPersonCamera(base, command, steps, fraction) : base;
      });
    } else {
      setCamera((current) => moveFreeCamera(current, command, steps, fraction));
    }
  }, []);
  const [pointerLocked, setPointerLocked] = useState(false);
  const togglePointerLock = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
      return;
    }
    setSimulateCameraMode("free");
    const leveled = leveledSourceFrameCameraRef.current;
    setFirstPersonCamera((current) => current ?? (leveled ? firstPersonCameraFromFrame(leveled) : current));
    canvas.requestPointerLock();
  }, []);
  useEffect(() => {
    const onChange = () => {
      const locked = document.pointerLockElement === canvasRef.current;
      setPointerLocked(locked);
      setLastAction(locked ? "mouse look on" : "mouse look off");
    };
    const onMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvasRef.current) return;
      setFirstPersonCamera((current) => (current ? rotateFirstPersonCameraClamped(current, event.movementX, event.movementY) : current));
    };
    document.addEventListener("pointerlockchange", onChange);
    window.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);
  useEffect(() => {
    if (mode !== "simulate" && document.pointerLockElement === canvasRef.current) document.exitPointerLock();
  }, [mode]);
  const simulateFrameCamera = mode === "simulate" && simulateCameraMode === "frame" ? leveledSourceFrameCamera : undefined;
  const simulateFirstPersonCamera = mode === "simulate" && simulateCameraMode === "free" ? firstPersonCamera ?? undefined : undefined;
  const simulateRenderEvidenceUrl = mode === "simulate" && simulateCameraMode === "frame" ? simulateSourceFrame?.renderPreviewDataUrl : undefined;
  const activeWorldOrientation = mode === "simulate" && (simulateFrameCamera || simulateFirstPersonCamera) ? worldOrientation : undefined;
  const simulateCameraLabel =
    simulateCameraMode === "frame"
      ? simulateFrameCamera
        ? "frame · aligned camera"
        : "frame camera missing"
      : simulateCameraMode === "free"
        ? firstPersonCamera
          ? pointerLocked
            ? "free · mouse look"
            : "free · frame seeded"
          : "free · orbit fallback"
      : simulateCameraMode;
  const episodeSourceMatch = useMemo(
    () => (episodeProvenance ? describeEpisodeSourceMatch(episodeProvenance, session) : null),
    [episodeProvenance, session]
  );
  const episodeAssetValidation = useMemo(
    () => (episodeProvenance && episodeSourceMatch ? describeEpisodeAssetValidation(episodeProvenance, session, episodeSourceMatch.status) : null),
    [episodeProvenance, episodeSourceMatch, session]
  );
  const episodeIntegrityRows = useMemo(
    () => (episodeProvenance && episodeSourceMatch ? buildEpisodeIntegrityRows(episodeProvenance, session, episodeSourceMatch.status) : []),
    [episodeProvenance, episodeSourceMatch, session]
  );
  const sensorCaptureAssetValidation = useMemo(
    () => describeSensorCaptureAssetValidation(sensorCaptures),
    [sensorCaptures]
  );
  const timelineTotal = Math.max(captureFrames.length, session ? 292 : 0, 1);
  const episodeTotalFrames = Math.max(totalSteps, episodeTimeline.at(-1)?.frame ?? 0, 1);
  const episodeStep = Math.round(playhead * episodeTotalFrames);
  const agentEye: FeedPose = {
    x: agent.x - Math.cos(agent.heading) * 0.35,
    y: 0.62,
    z: agent.z - Math.sin(agent.heading) * 0.35,
    heading: agent.heading,
    pitch: -0.06
  };

  const options: RenderOptions = useMemo(
    () => ({
      mode: renderMode,
      camera,
      frameCamera: simulateFrameCamera,
      firstPersonCamera: simulateFirstPersonCamera,
      worldOrientation: activeWorldOrientation,
      density,
      exposure,
      accent,
      selected,
      deleted,
      showDeleted,
      isolatedClass,
      agent: mode === "simulate" || mode === "pilot" ? agent : mode === "episode" ? replayAgent : undefined,
      spawn,
      trajectory: mode === "simulate" || mode === "pilot" || mode === "episode" ? trajectory : undefined,
      sensors,
      selectedSensorId: mode === "sensors" ? selectedSensorId : undefined,
      debugCollision,
      agentBodyRadius: bodyPreset?.radius,
      grid: true,
      cropBounds: cropRegion?.bounds,
      pointTransforms
    }),
    [accent, activeWorldOrientation, agent, bodyPreset?.radius, camera, cropRegion, debugCollision, deleted, density, exposure, firstPersonCamera, isolatedClass, mode, pointTransforms, renderMode, replayAgent, selected, selectedSensorId, sensors, showDeleted, simulateFirstPersonCamera, simulateFrameCamera, spawn, trajectory]
  );
  const activePackageInsight = useMemo(
    () => (selectedInsightId ? packageInsights.find((insight) => insight.id === selectedInsightId) ?? null : null),
    [packageInsights, selectedInsightId]
  );

  useEffect(() => {
    const resize = () => {
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!renderer) {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      gl?.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }
    renderer.render(canvas, options);
  }, [renderer, options, scale]);

  useEffect(() => () => renderer?.dispose?.(), [renderer]);
  useEffect(() => () => simulationRef.current?.dispose(), []);

  useEffect(() => {
    setPublishStatus("idle");
    setEditPublishText(null);
    setEditPublishMessage(null);
  }, [density, editOptimizeStats, exposure, history]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setPlayhead((value) => (value >= 1 ? 0 : Math.min(1, value + 0.012)));
    }, 80);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    setSelectedSourceFrameIndex(0);
    setSimulateCameraMode("frame");
    setFirstPersonCamera(captureFrames[0]?.frameCamera ? firstPersonCameraFromFrame(applyWorldOrientationToFrameCamera(captureFrames[0].frameCamera, worldOrientation)) : null);
  }, [captureFrames, worldOrientation]);

  const requestStageFullscreen = useCallback(async () => {
    const stage = canvasRef.current?.closest(".ws-stage-shell") as HTMLElement | null;
    if (!stage?.requestFullscreen) {
      setLastAction("fullscreen unavailable");
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
      setLastAction("fullscreen");
    } catch {
      setLastAction("fullscreen blocked");
    }
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      setPressed((current) => new Set(current).add(event.key.toLowerCase()));
      if (event.key === "/" && mode === "view") {
        event.preventDefault();
        filterRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === "l") void (getDesktopApi()?.openLocalPackage ? loadLocalPackage() : loadFixture());
      if (event.key === " " && mode === "episode") setPlaying((value) => !value);
      if (event.key === " " && mode === "simulate") {
        event.preventDefault();
        togglePointerLock();
        return;
      }
      if (event.key.toLowerCase() === "e" && mode === "episode") exportEpisodeManifest();
      if (event.key === "F11" && mode === "simulate") {
        event.preventDefault();
        void requestStageFullscreen();
      }
      const simulateCommand = mode === "simulate" && !event.metaKey && !event.ctrlKey && !event.altKey ? commandForKey(event.key, event.shiftKey) : undefined;
      if (simulateCommand) {
        event.preventDefault();
        heldSimulateKeysRef.current.set(event.key.toLowerCase(), simulateCommand);
        if (event.repeat) return;
        setSimulateCameraMode("free");
        applySimulateCommand(simulateCommand, 1);
        setLastAction(`inside ${simulateCommand}`);
        return;
      }
      if (mode === "episode" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        stepEpisodeEvent(event.key === "ArrowRight" ? 1 : -1);
      }
      if (event.key.toLowerCase() === "r" && mode === "pilot") resetAgent();
      if (event.key === "Delete" && mode === "edit") deleteSelected();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") undoLast();
      if (mode === "pilot" && ["w", "a", "s", "d"].includes(event.key.toLowerCase())) {
        driveAgent(event.key.toLowerCase());
      }
    };
    const up = (event: KeyboardEvent) => {
      heldSimulateKeysRef.current.delete(event.key.toLowerCase());
      setPressed((current) => {
        const next = new Set(current);
        next.delete(event.key.toLowerCase());
        return next;
      });
    };
    const clearHeld = () => heldSimulateKeysRef.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clearHeld);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clearHeld);
    };
  }, [applySimulateCommand, episodeEvents, episodeTotalFrames, firstPersonCamera, history, leveledSourceFrameCamera, mode, selected, selectedEpisodeEventId, togglePointerLock, trajectory]);

  useEffect(() => {
    if (mode !== "simulate") {
      heldSimulateKeysRef.current.clear();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const held = heldSimulateKeysRef.current;
      if (held.size > 0 && dt > 0) {
        const fraction = dt * holdRepeatStepsPerSecond;
        for (const command of held.values()) applySimulateCommand(command, fraction);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [applySimulateCommand, mode]);

  const initializeSimulation = useCallback((worldSession: WorldSession, mesh: ParsedObjMesh | undefined, nextSpawn: AgentState, body: AgentBodyPreset) => {
    const token = simulationTokenRef.current + 1;
    simulationTokenRef.current = token;
    simulationRef.current?.dispose();
    simulationRef.current = null;
    setPhysicsDiagnostics(unavailablePhysicsDiagnostics());

    void RapierSimulation.create({ mesh, agent: nextSpawn, body })
      .then((simulation) => {
        if (simulationTokenRef.current !== token) {
          simulation.dispose();
          return;
        }
        simulationRef.current = simulation;
        const step = simulation.reset(nextSpawn);
        setAgent(step.agent);
        setPhysicsDiagnostics(step.diagnostics);
      })
      .catch(() => {
        if (simulationTokenRef.current === token) {
          setPhysicsDiagnostics(unavailablePhysicsDiagnostics());
        }
      });
  }, []);

  const resetTransientState = useCallback((worldSession: WorldSession) => {
    const nextSpawn = worldSession.agentSpawn ?? defaultSpawn;
    setAgent(nextSpawn);
    setSpawn(nextSpawn);
    setTrajectory([[nextSpawn.x, nextSpawn.z]]);
    setSelected(new Set());
    setDeleted(new Set());
    setHistory([]);
    setCropRegion(null);
    setCropDraft(null);
    setPointTransforms(new Map());
    setTransformDraft(null);
    setLastTransformDelta(null);
    transformDragRef.current = null;
    setPublishStatus("idle");
    setEditPublishText(null);
    setEditPublishMessage(null);
    setMeasurePoints([]);
    setStepCount(0);
    setLastAction("idle");
    setProps(defaultProps);
    setSelectedPropId(null);
    setEpisodeEvents([]);
    setSelectedEpisodeEventId(null);
    setEpisodeExportText(null);
    setEpisodeSaveStatus(null);
    setEpisodeProvenance(null);
    setEpisodeIntegrityOpen(false);
    setCaptureCompareIds([]);
    setSensorCaptures([]);
    propSeqRef.current = defaultProps.length;
    episodeFrameRef.current = 0;
    setPhysicsDiagnostics(unavailablePhysicsDiagnostics());
  }, []);

  const restartSimulationAt = useCallback(
    (nextSpawn: AgentState, body: AgentBodyPreset, action: string) => {
      setSpawn(nextSpawn);
      setAgent(nextSpawn);
      setTrajectory([[nextSpawn.x, nextSpawn.z]]);
      setStepCount(0);
      setLastAction(action);
      setPhysicsDiagnostics(unavailablePhysicsDiagnostics());
      if (session) initializeSimulation(session, collisionMeshRef.current, nextSpawn, body);
    },
    [initializeSimulation, session]
  );

  const loadFixture = useCallback(async () => {
    const fixtureLabel = "/fixtures/loft_04";
    const fixtureUrl = new URL("./fixtures/loft_04/", window.location.href);
    const fixtureAsset = (name: string) => new URL(name, fixtureUrl).href;
    const [sceneResponse, pointsResponse, gaussiansResponse, objResponse] = await Promise.all([
      fetch(fixtureAsset("scene.json")),
      fetch(fixtureAsset("points.ply")),
      fetch(fixtureAsset("gaussians.ply")),
      fetch(fixtureAsset("collision_mesh.obj"))
    ]);
    if (!sceneResponse.ok || !pointsResponse.ok || !gaussiansResponse.ok || !objResponse.ok) {
      throw new Error("Failed to load loft_04 fixture");
    }
    const [sceneText, pointsText, gaussiansText, objText] = await Promise.all([
      sceneResponse.text(),
      pointsResponse.text(),
      gaussiansResponse.text(),
      objResponse.text()
    ]);
    const scene = JSON.parse(sceneText) as LoftSceneManifest;
    applyLoadedWorld({
      name: scene.dataset,
      scene,
      pointsText,
      gaussianHeaderText: gaussiansText,
      gaussianUrl: fixtureAsset("gaussians.ply"),
      objText,
      loadedVia: fixtureLabel,
      sourcePath: fixtureLabel,
      sourceKind: "world-studio.fixture.loft_04",
      packageKind: "fixture",
      primaryArtifact: "gaussians.ply",
      companionArtifacts: Object.keys(scene.files),
      assetManifest: buildTextAssetManifest([
        { relativePath: "scene.json", text: sceneText },
        { relativePath: "points.ply", text: pointsText },
        { relativePath: "gaussians.ply", text: gaussiansText },
        { relativePath: "collision_mesh.obj", text: objText }
      ]),
      authorityStatus: "visual_evidence",
      packageInsights: buildFixtureInsights(scene),
      packageIssues: []
    });
  }, []);

  const loadLocalPackage = useCallback(async () => {
    try {
      const payload = await getDesktopApi()?.openLocalPackage?.();
      if (!payload) return;
      applyLocalPackage(payload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load local package");
    }
  }, []);

  const applyLocalPackage = useCallback((payload: LocalWorldPackagePayload, options?: LoadedWorldOptions) => {
    applyLoadedWorld({
      name: payload.name,
      scene: payload.sceneJson as LoftSceneManifest | undefined,
      pointsText: payload.pointsPly?.text,
      gaussianHeaderText: payload.gaussianPly?.headerText,
      gaussianUrl: payload.gaussianPly?.dataUrl,
      objText: payload.objMesh?.text,
      loadedVia: payload.loadedVia,
      sourcePath: payload.sourcePath,
      sourceKind: payload.sourceKind,
      packageKind: payload.packageKind,
      primaryArtifact: payload.primaryArtifact,
      companionArtifacts: payload.companionArtifacts,
      assetManifest: payload.assetManifest,
      authorityStatus: payload.authorityStatus,
      packageInsights: payload.packageInsights,
      packageIssues: payload.packageIssues,
      captureFrames: parseCaptureFrames(payload)
    }, options);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadInitialPackage = async () => {
      const payload = await getDesktopApi()?.initialLocalPackage?.();
      if (!payload || cancelled) return;
      applyLocalPackage(payload);
    };
    void loadInitialPackage().catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Failed to load initial package");
    });
    return () => {
      cancelled = true;
    };
  }, [applyLocalPackage]);

  const applyLoadedWorld = useCallback((input: LoadedWorldInput, options?: LoadedWorldOptions) => {
    setLoadError(null);

    if (!input.pointsText) {
      const mesh = input.objText ? parseObjMesh(input.objText) : undefined;
      collisionMeshRef.current = mesh;
      const nextInsights = input.packageInsights ?? [];
      const nextIssues = input.packageIssues ?? [];
      const worldSession = createManifestOnlySession(input);
      setSession(worldSession);
      setRenderer(null);
      setRendererDiagnostics(null);
      setWorldPoints([]);
      setCaptureFrames(input.captureFrames ?? []);
      setAssetSummary({ gaussianKind: input.gaussianHeaderText ? detectPlyKind(input.gaussianHeaderText) : "unloaded", objFaces: 0, objGroups: 0, pointCount: 0 });
      setPackageInsights(nextInsights);
      setPackageIssues(nextIssues);
      setSelectedInsightId(null);
      if (input.gaussianUrl && input.captureFrames?.some((frame) => frame.frameCamera)) {
        setMode("simulate");
        setSimulateCameraMode("frame");
      }
      if (!options?.preserveEpisode) resetTransientState(worldSession);
      initializeSimulation(worldSession, mesh, worldSession.agentSpawn ?? defaultSpawn, bodyPreset);
      return;
    }

    const nextInsights = input.packageInsights ?? [];
    const nextIssues = input.packageIssues ?? [];
    const pointCloud = parsePointCloudPly(input.pointsText);
    const mesh = input.objText ? parseObjMesh(input.objText) : undefined;
    collisionMeshRef.current = mesh;
    const meshSummary = input.objText ? parseObjMeshSummary(input.objText) : { faces: 0, groups: [] };
    const created = input.scene ? createLoftWorldSession(input.scene, input.loadedVia) : createPointCloudSession(input, pointCloud.points.length, classesFromPointCloud(pointCloud.points));
    const worldSession: WorldSession = {
      ...created,
      bounds: pointCloud.bounds,
      pointCount: pointCloud.points.length,
      provenance: {
        sourceKind: input.sourceKind,
        packageKind: input.packageKind,
        loadedVia: input.loadedVia,
        sourcePath: input.sourcePath,
        primaryArtifact: input.primaryArtifact,
        companionArtifacts: input.companionArtifacts,
        assetManifest: input.assetManifest,
        loadedAt: new Date().toISOString(),
        authorityStatus: input.authorityStatus
      }
    };

    setSession(worldSession);
    const nextRenderer = new ThreeWorldRenderer({
      pointCloud,
      classes: worldSession.classes,
      mesh,
      gaussianUrl: input.gaussianUrl,
      sparkProfile: sparkProfileForLoadedWorld(input),
      onDiagnosticsChange: setRendererDiagnostics
    });
    setRenderer(nextRenderer);
    setRendererDiagnostics(nextRenderer.getDiagnostics());
    setWorldPoints(pointCloud.points);
    setCaptureFrames(input.captureFrames ?? []);
    setAssetSummary({
      gaussianKind: input.gaussianHeaderText ? detectPlyKind(input.gaussianHeaderText) : "unloaded",
      objFaces: meshSummary.faces,
      objGroups: meshSummary.groups.length,
      pointCount: pointCloud.points.length
    });
    setPackageInsights(nextInsights);
    setPackageIssues(nextIssues);
    setSelectedInsightId(null);
    if (input.gaussianUrl && input.captureFrames?.some((frame) => frame.frameCamera)) {
      setMode("simulate");
      setSimulateCameraMode("frame");
    }
    if (!options?.preserveEpisode) resetTransientState(worldSession);
    initializeSimulation(worldSession, mesh, worldSession.agentSpawn ?? defaultSpawn, bodyPreset);
  }, [bodyPreset, initializeSimulation, resetTransientState, setMode]);

  const toStage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [scale]
  );

  const paintAt = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      const indices = renderer.collectInRadius(canvas, options, event.clientX, event.clientY, brushRadius * scale);
      if (!indices.length) return;
      setSelected((current) => {
        const next = new Set(current);
        for (const index of indices) next.add(index);
        return next;
      });
      for (const index of indices) brushStrokeRef.current.add(index);
    },
    [options, renderer, scale]
  );

  const measureAt = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !renderer?.projectToGround) return;
      const world = renderer.projectToGround(canvas, options, event.clientX, event.clientY);
      if (!world) return;
      const point: MeasurePoint = { world, stage: toStage(event.clientX, event.clientY) };
      setMeasurePoints((current) => (current.length >= 2 ? [point] : [...current, point]));
      setLastAction("measure point");
    },
    [options, renderer, toStage]
  );

  const countPointsOutsideCrop = useCallback(
    (bounds: CropBounds) => worldPoints.reduce((count, point) => (pointInsideCrop(point, bounds) ? count : count + 1), 0),
    [worldPoints]
  );

  const applyCropFromDrag = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !renderer?.projectToGround) {
        setLastAction("crop unavailable");
        return;
      }
      const startStage = toStage(startX, startY);
      const endStage = toStage(endX, endY);
      const stage = normalizeStageRect({ x0: startStage.x, y0: startStage.y, x1: endStage.x, y1: endStage.y });
      if (stage.x1 - stage.x0 < 12 || stage.y1 - stage.y0 < 12) {
        setLastAction("crop too small");
        return;
      }
      const start = renderer.projectToGround(canvas, options, startX, startY);
      const end = renderer.projectToGround(canvas, options, endX, endY);
      if (!start || !end) {
        setLastAction("crop missed ground");
        return;
      }
      const bounds: CropBounds = {
        minX: Math.min(start[0], end[0]),
        maxX: Math.max(start[0], end[0]),
        minZ: Math.min(start[2], end[2]),
        maxZ: Math.max(start[2], end[2])
      };
      if (bounds.maxX - bounds.minX < 0.05 || bounds.maxZ - bounds.minZ < 0.05) {
        setLastAction("crop too small");
        return;
      }
      const nextCrop: CropRegion = {
        bounds,
        stage,
        hiddenCount: countPointsOutsideCrop(bounds)
      };
      setCropRegion(nextCrop);
      const entry: HistoryItem = { id: crypto.randomUUID(), type: "crop", count: nextCrop.hiddenCount, previousCrop: cropRegion, nextCrop };
      setHistory((current) => [entry, ...current].slice(0, 10));
      setLastAction(`crop ${nextCrop.hiddenCount} hidden`);
    },
    [countPointsOutsideCrop, cropRegion, options, renderer, toStage]
  );

  const applyTransformDelta = useCallback((drag: TransformDrag, delta: PointTransform) => {
    setPointTransforms((current) => {
      const next = new Map(current);
      for (const index of drag.indices) {
        const moved = addPointTransform(drag.baseTransforms.get(index), delta);
        if (isZeroTransform(moved)) next.delete(index);
        else next.set(index, moved);
      }
      return next;
    });
  }, []);

  const restoreTransformBase = useCallback((drag: TransformDrag) => {
    setPointTransforms((current) => {
      const next = new Map(current);
      for (const index of drag.indices) {
        const base = drag.baseTransforms.get(index);
        if (base && !isZeroTransform(base)) next.set(index, base);
        else next.delete(index);
      }
      return next;
    });
  }, []);

  const updateTransformDrag = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = transformDragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas || !renderer?.projectToGround) return null;
      const current = renderer.projectToGround(canvas, options, event.clientX, event.clientY);
      if (!current) return null;
      const delta: PointTransform = { dx: current[0] - drag.startWorld[0], dy: 0, dz: current[2] - drag.startWorld[2] };
      applyTransformDelta(drag, delta);
      setTransformDraft({ dx: delta.dx, dz: delta.dz, count: drag.indices.length, stage: toStage(event.clientX, event.clientY) });
      return delta;
    },
    [applyTransformDelta, options, renderer, toStage]
  );

  const deleteSelected = useCallback(() => {
    if (!selected.size) return;
    const indices = [...selected];
    setDeleted((current) => {
      const next = new Set(current);
      for (const index of indices) next.add(index);
      return next;
    });
    setSelected(new Set());
    const entry: HistoryItem = { id: crypto.randomUUID(), type: "delete", count: indices.length, indices };
    setHistory((current) => [entry, ...current].slice(0, 10));
  }, [selected]);

  const undoLast = useCallback(() => {
    setHistory((current) => {
      const [last, ...rest] = current;
      if (!last) return current;
      if (last.type === "crop") {
        setCropRegion(last.previousCrop);
        setCropDraft(null);
      } else if (last.type === "transform") {
        setPointTransforms((transformSet) => {
          const next = new Map(transformSet);
          for (const index of last.indices) {
            const previous = last.previousTransforms.get(index);
            if (previous && !isZeroTransform(previous)) next.set(index, previous);
            else next.delete(index);
          }
          return next;
        });
        setTransformDraft(null);
        setLastTransformDelta(null);
      } else if (last.type === "delete") {
        setDeleted((deletedSet) => {
          const next = new Set(deletedSet);
          for (const index of last.indices) next.delete(index);
          return next;
        });
      } else if (last.type === "optimize") {
        setDeleted((deletedSet) => {
          const next = new Set(deletedSet);
          for (const index of last.indices) next.delete(index);
          return next;
        });
      } else {
        setSelected((selectedSet) => {
          const next = new Set(selectedSet);
          for (const index of last.indices) next.delete(index);
          return next;
        });
      }
      return rest;
    });
  }, []);

  const clearSelected = () => setSelected(new Set());

  const clearCrop = useCallback(() => {
    if (!cropRegion) return;
    setCropRegion(null);
    setCropDraft(null);
    const entry: HistoryItem = { id: crypto.randomUUID(), type: "crop", count: cropRegion.hiddenCount, previousCrop: cropRegion, nextCrop: null };
    setHistory((current) => [entry, ...current].slice(0, 10));
    setLastAction("crop clear");
  }, [cropRegion]);

  const removeOutliers = useCallback(() => {
    const indices = findOutlierIndices(worldPoints, deleted, cropRegion, pointTransforms);
    if (!indices.length) {
      setLastAction("no outliers found");
      return;
    }
    setDeleted((current) => {
      const next = new Set(current);
      for (const index of indices) next.add(index);
      return next;
    });
    setSelected((current) => {
      const next = new Set(current);
      for (const index of indices) next.delete(index);
      return next;
    });
    const entry: HistoryItem = { id: crypto.randomUUID(), type: "optimize", count: indices.length, indices, label: "remove outliers" };
    setHistory((current) => [entry, ...current].slice(0, 10));
    setPublishStatus("idle");
    setEditPublishText(null);
    setEditPublishMessage(null);
    setLastAction(`outliers ${indices.length} removed`);
  }, [cropRegion, deleted, pointTransforms, worldPoints]);

  const createEditPublishText = useCallback(() => {
    const manifest = buildEditPublishManifest({
      session,
      stats: editOptimizeStats,
      density,
      exposure,
      rendererStatus: rendererStatusLabel(renderMode, rendererDiagnostics),
      rendererDiagnostics,
      history
    });
    return JSON.stringify(manifest, null, 2);
  }, [density, editOptimizeStats, exposure, history, renderMode, rendererDiagnostics, session]);

  const previewEditPublish = useCallback(() => {
    if (!session) {
      setEditPublishMessage("load a world first");
      return;
    }
    setEditPublishText(createEditPublishText());
    setPublishStatus("preview");
    setEditPublishMessage("publish preview ready");
    setLastAction("publish preview");
  }, [createEditPublishText, session]);

  const exportEditPublish = useCallback(async () => {
    if (!session) {
      setEditPublishMessage("load a world first");
      return;
    }
    const text = createEditPublishText();
    const suggestedName = editPublishFileName(session, publishFormat);
    setEditPublishText(text);
    const desktopSave = getDesktopApi()?.saveEpisodeManifest;
    if (desktopSave) {
      const result = await desktopSave({ suggestedName, text });
      setPublishStatus(result?.path ? "exported" : "preview");
      setEditPublishMessage(result?.path ? `saved ${compactPath(result.path)}` : "export canceled");
      return;
    }
    downloadTextFile(suggestedName, text, "application/json");
    setPublishStatus("exported");
    setEditPublishMessage(`downloaded ${suggestedName}`);
  }, [createEditPublishText, publishFormat, session]);

  const exportCleanedPointCloud = useCallback(async () => {
    if (!session) {
      setEditPublishMessage("load a world first");
      return;
    }
    if (publishFormat !== "ply") {
      setEditPublishMessage("clean PLY requires .ply format");
      return;
    }
    const ply = buildCleanedPointCloudPly({
      points: worldPoints,
      deleted,
      cropBounds: cropRegion?.bounds,
      pointTransforms,
      session
    });
    const suggestedName = cleanedPlyFileName(session);
    const desktopSave = getDesktopApi()?.saveEpisodeManifest;
    if (desktopSave) {
      const result = await desktopSave({ suggestedName, text: ply.text });
      setPublishStatus(result?.path ? "exported" : "preview");
      setEditPublishMessage(result?.path ? `saved cleaned PLY ${compactPath(result.path)}` : "clean PLY export canceled");
      if (result?.path) setLastAction(`clean PLY ${ply.rowCount} points`);
      return;
    }
    downloadTextFile(suggestedName, ply.text, "model/ply;charset=utf-8");
    setPublishStatus("exported");
    setEditPublishMessage(`downloaded cleaned PLY ${suggestedName}`);
    setLastAction(`clean PLY ${ply.rowCount} points`);
  }, [cropRegion, deleted, pointTransforms, publishFormat, session, worldPoints]);

  const updateSensor = useCallback((sensorId: string, patch: Partial<SensorRigChannel>) => {
    setSensors((items) => items.map((item) => (item.id === sensorId ? { ...item, ...patch } : item)));
    setEpisodeExportText(null);
    setEpisodeSaveStatus(null);
  }, []);

  const recordEpisodeEvent = useCallback((event: Omit<EpisodeEvent, "id" | "frame">) => {
    episodeFrameRef.current += 1;
    const frame = episodeFrameRef.current;
    const id = `event-${frame}`;
    const nextEvent = { ...event, id, frame };
    setEpisodeEvents((current) => [nextEvent, ...current].slice(0, 80));
    setSelectedEpisodeEventId(id);
    setEpisodeExportText(null);
    setEpisodeSaveStatus(null);
    setEpisodeProvenance(null);
    setEpisodeIntegrityOpen(false);
    return nextEvent;
  }, []);

  const captureSensorFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedSensor || !session) return;
    if (!selectedSensor.enabled) {
      setEpisodeSaveStatus("capture blocked · sensor off");
      return;
    }

    try {
      const previewDataUrl = renderer?.capture(canvas) ?? canvas.toDataURL("image/png");
      const event = recordEpisodeEvent({
        lane: "capture",
        label: `sensor capture · ${selectedSensor.label}`,
        targetId: selectedSensor.id,
        status: `${selectedSensor.kind} · ${renderMode}`
      });
      const bytes = dataUrlToBytes(previewDataUrl);
      const assetPath = sensorCaptureAssetPath(event.frame, selectedSensor.id);
      const artifact: SensorCaptureArtifact = {
        id: `sensor-capture-${event.frame}`,
        eventId: event.id,
        frame: event.frame,
        sensorId: selectedSensor.id,
        sensorLabel: selectedSensor.label,
        sensorKind: selectedSensor.kind,
        sensorSpec: selectedSensor.spec,
        capturedAt: new Date().toISOString(),
        previewDataUrl,
        assetPath,
        assetStatus: "embedded",
        mimeType: "image/png",
        renderMode,
        rendererStatus: rendererStatusLabel(renderMode, rendererDiagnostics),
        worldName: session.name,
        sourcePath: session.provenance.sourcePath,
        loadedVia: session.provenance.loadedVia,
        camera,
        size: { width: canvas.width, height: canvas.height },
        bytes: bytes.byteLength,
        sizeBytes: bytes.byteLength,
        checksum: checksumBytes(bytes)
      };
      setSensorCaptures((current) => [artifact, ...current].slice(0, 24));
      setEpisodeSaveStatus(`captured ${selectedSensor.label}`);
    } catch (error) {
      setEpisodeSaveStatus(error instanceof Error ? `capture failed · ${error.message}` : "capture failed");
    }
  }, [camera, recordEpisodeEvent, renderMode, renderer, rendererDiagnostics, selectedSensor, session]);

  const selectEpisodeEvent = useCallback(
    (event: EpisodeEvent) => {
      setSelectedEpisodeEventId(event.id);
      setPlayhead(Math.min(1, Math.max(0, event.frame / episodeTotalFrames)));
    },
    [episodeTotalFrames]
  );

  const toggleCaptureComparison = useCallback((captureId: string) => {
    setCaptureCompareIds((current) => {
      if (current.includes(captureId)) return current.filter((id) => id !== captureId);
      return [...current.slice(-1), captureId];
    });
    setEpisodeExportText(null);
    setEpisodeSaveStatus(null);
  }, []);

  const clearCaptureComparison = useCallback(() => {
    setCaptureCompareIds([]);
    setEpisodeExportText(null);
    setEpisodeSaveStatus(null);
  }, []);

  const applySourceFrameCamera = useCallback((frame: CaptureFrame | null, action: string) => {
    setSimulateCameraMode("frame");
    if (frame?.frameCamera) {
      setFirstPersonCamera(firstPersonCameraFromFrame(applyWorldOrientationToFrameCamera(frame.frameCamera, worldOrientation)));
      setLastAction(action);
    } else {
      setFirstPersonCamera(null);
      setLastAction("frame camera unavailable");
    }
  }, [worldOrientation]);

  const enterFreeCamera = useCallback((action = "inside free camera") => {
    setSimulateCameraMode("free");
    if (leveledSourceFrameCamera) {
      setFirstPersonCamera((current) => current ?? firstPersonCameraFromFrame(leveledSourceFrameCamera));
      setLastAction(action);
    } else {
      setLastAction("free camera");
    }
  }, [leveledSourceFrameCamera]);

  const selectSourceFrame = useCallback((index: number) => {
    setCaptureCompareIds([]);
    setSelectedSourceFrameIndex(index);
    applySourceFrameCamera(captureFrames[index] ?? null, "frame camera");
  }, [applySourceFrameCamera, captureFrames]);

  const resetSimulateFrameCamera = useCallback(() => {
    if (mode !== "simulate") return;
    applySourceFrameCamera(simulateSourceFrame, "frame reset");
  }, [applySourceFrameCamera, mode, simulateSourceFrame]);

  const toggleCapturePlayback = useCallback(() => {
    setPlaying((current) => {
      const next = !current;
      if (next) applySourceFrameCamera(captureFrames[selectedSourceFrameIndex] ?? null, "capture playback");
      return next;
    });
  }, [applySourceFrameCamera, captureFrames, selectedSourceFrameIndex]);

  useEffect(() => {
    if (!playing || mode !== "simulate" || simulateCameraMode !== "frame" || captureFrames.length < 2) return;
    const id = window.setTimeout(() => {
      selectSourceFrame((selectedSourceFrameIndex + 1) % captureFrames.length);
    }, 600);
    return () => window.clearTimeout(id);
  }, [captureFrames.length, mode, playing, selectSourceFrame, selectedSourceFrameIndex, simulateCameraMode]);

  useEffect(() => {
    if (playing && mode === "simulate" && simulateCameraMode !== "frame") setPlaying(false);
  }, [mode, playing, simulateCameraMode]);

  const stepEpisodeEvent = useCallback(
    (direction: -1 | 1) => {
      if (!episodeTimeline.length) return;
      const currentIndex = Math.max(0, episodeTimeline.findIndex((event) => event.id === selectedEpisodeEvent?.id));
      const nextIndex = Math.min(episodeTimeline.length - 1, Math.max(0, currentIndex + direction));
      selectEpisodeEvent(episodeTimeline[nextIndex] ?? episodeTimeline[0]!);
    },
    [episodeTimeline, selectEpisodeEvent, selectedEpisodeEvent?.id]
  );

  const createEpisodeManifest = useCallback((options?: { includeCapturePreviews?: boolean }) => {
    return buildEpisodeManifest({
      session,
      events: episodeTimeline,
      selectedEventId: selectedEpisodeEvent?.id ?? null,
      playhead,
      trajectory,
      props,
      sensors,
      sensorCaptures,
      includeCapturePreviews: options?.includeCapturePreviews ?? true
    });
  }, [episodeTimeline, playhead, props, selectedEpisodeEvent?.id, sensorCaptures, sensors, session, trajectory]);

  const createEpisodeManifestText = useCallback(() => {
    const manifest = createEpisodeManifest();
    return JSON.stringify(manifest, null, 2);
  }, [createEpisodeManifest]);

  const createEpisodeBundlePayload = useCallback((options?: { externalizeCapturePreviews?: boolean }) => {
    const externalizeCapturePreviews = options?.externalizeCapturePreviews ?? false;
    const bundle = buildEpisodeBundle({
      episodeManifest: createEpisodeManifest({ includeCapturePreviews: !externalizeCapturePreviews }),
      session,
      renderMode,
      rendererStatus: rendererStatusLabel(renderMode, rendererDiagnostics),
      rendererDiagnostics
    });
    return {
      text: JSON.stringify(bundle, null, 2),
      assets: externalizeCapturePreviews ? sensorCaptureBundleAssets(sensorCaptures) : []
    };
  }, [createEpisodeManifest, renderMode, rendererDiagnostics, sensorCaptures, session]);

  const createEpisodeBundleText = useCallback(() => createEpisodeBundlePayload().text, [createEpisodeBundlePayload]);

  const createSensorCaptureManifestText = useCallback(() => {
    const manifest = buildSensorCaptureManifest({
      session,
      captures: captureComparison,
      events: episodeTimeline
    });
    return JSON.stringify(manifest, null, 2);
  }, [captureComparison, episodeTimeline, session]);

  const exportEpisodeManifest = useCallback(() => {
    setEpisodeExportText(createEpisodeManifestText());
    setEpisodeSaveStatus("preview ready");
  }, [createEpisodeManifestText]);

  const exportSensorCaptureManifest = useCallback(async () => {
    if (!captureComparison.length) return;
    const text = createSensorCaptureManifestText();
    const suggestedName = sensorCaptureManifestFileName(session);
    setEpisodeExportText(text);
    const desktopSave = getDesktopApi()?.saveEpisodeManifest;
    if (desktopSave) {
      const result = await desktopSave({ suggestedName, text });
      setEpisodeSaveStatus(result?.path ? `saved captures ${compactPath(result.path)}` : "capture export canceled");
      return;
    }
    downloadTextFile(suggestedName, text, "application/json");
    setEpisodeSaveStatus(`downloaded captures ${suggestedName}`);
  }, [captureComparison.length, createSensorCaptureManifestText, session]);

  const saveEpisodeManifest = useCallback(async () => {
    if (!episodeTimeline.length) return;
    const text = createEpisodeManifestText();
    const suggestedName = episodeFileName(session);
    setEpisodeExportText(text);
    const desktopSave = getDesktopApi()?.saveEpisodeManifest;
    if (desktopSave) {
      const result = await desktopSave({ suggestedName, text });
      setEpisodeSaveStatus(result?.path ? `saved ${compactPath(result.path)}` : "save canceled");
      return;
    }
    downloadTextFile(suggestedName, text, "application/json");
    setEpisodeSaveStatus(`downloaded ${suggestedName}`);
  }, [createEpisodeManifestText, episodeTimeline.length, session]);

  const saveEpisodeBundle = useCallback(async () => {
    if (!episodeTimeline.length) return;
    const suggestedName = episodeBundleFileName(session);
    const desktopSave = getDesktopApi()?.saveEpisodeBundle;
    const payload = createEpisodeBundlePayload({ externalizeCapturePreviews: Boolean(desktopSave) });
    setEpisodeExportText(payload.text);
    if (desktopSave) {
      const result = await desktopSave({ suggestedName, text: payload.text, assets: payload.assets });
      setEpisodeSaveStatus(result?.path ? `saved package ${compactPath(result.path)}` : "package save canceled");
      return;
    }
    downloadTextFile(suggestedName, payload.text, "application/json");
    setEpisodeSaveStatus(`downloaded package ${suggestedName}`);
  }, [createEpisodeBundlePayload, episodeTimeline.length, session]);

  const applyEpisodeManifestText = useCallback((text: string, sourceLabel: string) => {
    const imported = parseEpisodeManifestText(text);
    const maxFrame = Math.max(0, ...imported.events.map((event) => event.frame));
    const selectedEventId = imported.events.some((event) => event.id === imported.selectedEventId)
      ? imported.selectedEventId
      : (imported.events.at(-1)?.id ?? null);

    setEpisodeEvents(imported.events);
    setSelectedEpisodeEventId(selectedEventId);
    setPlayhead(imported.playhead);
    setPlaying(false);
    setTrajectory(imported.trajectory);
    setProps(imported.props);
    setSelectedPropId(imported.props[0]?.id ?? null);
    setSensors(imported.sensors);
    setSelectedSensorId(imported.sensors[0]?.id ?? initialSensors[0]?.id ?? "rgb");
    setSensorCaptures(imported.sensorCaptures);
    setCaptureCompareIds([]);
    setEpisodeExportText(text);
    setEpisodeSaveStatus(`loaded ${compactPath(sourceLabel)}${imported.worldName ? ` · ${imported.worldName}` : ""}`);
    setEpisodeProvenance({ ...imported.provenance, loadedFrom: sourceLabel });
    setEpisodeIntegrityOpen(false);
    episodeFrameRef.current = maxFrame;
    propSeqRef.current = Math.max(defaultProps.length, imported.props.length);
  }, []);

  const loadEpisodeManifest = useCallback(async () => {
    const desktopOpen = getDesktopApi()?.openEpisodeManifest;
    if (!desktopOpen) {
      episodeImportInputRef.current?.click();
      return;
    }
    try {
      const result = await desktopOpen();
      if (!result) {
        setEpisodeSaveStatus("load canceled");
        return;
      }
      applyEpisodeManifestText(result.text, result.path);
    } catch (error) {
      setEpisodeExportText(null);
      setEpisodeProvenance(null);
      setEpisodeSaveStatus(error instanceof Error ? `load failed · ${error.message}` : "load failed");
    }
  }, [applyEpisodeManifestText]);

  const relinkEpisodeWorldPackage = useCallback(async () => {
    const desktopOpen = getDesktopApi()?.openLocalPackage;
    if (!desktopOpen) {
      setEpisodeSaveStatus("relink requires desktop package picker");
      return;
    }
    try {
      const payload = await desktopOpen();
      if (!payload) {
        setEpisodeSaveStatus("relink canceled");
        return;
      }
      applyLocalPackage(payload, { preserveEpisode: true });
      setEpisodeSaveStatus(`relinked ${compactPath(payload.sourcePath)}`);
    } catch (error) {
      setEpisodeSaveStatus(error instanceof Error ? `relink failed · ${error.message}` : "relink failed");
    }
  }, [applyLocalPackage]);

  const handleEpisodeFileImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      try {
        applyEpisodeManifestText(await file.text(), file.name);
      } catch (error) {
        setEpisodeExportText(null);
        setEpisodeProvenance(null);
        setEpisodeSaveStatus(error instanceof Error ? `load failed · ${error.message}` : "load failed");
      }
    },
    [applyEpisodeManifestText]
  );

  const resetAgent = () => {
    restartSimulationAt(spawn, bodyPreset, "ResetToSpawn");
    recordEpisodeEvent({ lane: "agent", label: "agent reset", status: "spawn" });
  };

  const selectSpawn = (choice: SpawnChoice) => {
    restartSimulationAt(choice.agent, bodyPreset, `Spawn(${choice.label})`);
    recordEpisodeEvent({ lane: "agent", label: `agent spawn · ${choice.label}`, status: "valid" });
  };

  const setSpawnHere = () => {
    const nextSpawn = { ...agent };
    setSpawn(nextSpawn);
    setLastAction("SetSpawnHere");
    recordEpisodeEvent({ lane: "agent", label: "agent spawn set", status: "valid" });
  };

  const selectBodyPreset = (id: AgentBodyPresetId) => {
    const nextBody = agentBodyPresets.find((preset) => preset.id === id) ?? bodyPreset;
    setBodyPresetId(nextBody.id);
    restartSimulationAt(spawn, nextBody, `Body(${nextBody.label})`);
    recordEpisodeEvent({ lane: "agent", label: `agent body · ${nextBody.label}`, status: "ready" });
  };

  const stepPhysics = (command: DriveCommand, action: string) => {
    setStepCount((count) => count + 1);
    setLastAction(action);
    const step = simulationRef.current?.step(command);
    if (step) {
      setAgent(step.agent);
      setPhysicsDiagnostics(step.diagnostics);
      setTrajectory((points) => [...points.slice(-42), [step.agent.x, step.agent.z]]);
      recordEpisodeEvent({ lane: "agent", label: action, status: step.diagnostics.grounded ? "grounded" : "airborne" });
      return true;
    }
    return false;
  };

  const driveAgent = (key: string) => {
    if (stepPhysics(driveCommandForKey(key), driveActionLabel(key))) return;

    setAgent((current) => {
      const step = 0.12;
      const turn = 0.16;
      let next = { ...current };
      if (key === "a") next = { ...next, heading: next.heading - turn };
      if (key === "d") next = { ...next, heading: next.heading + turn };
      if (key === "w" || key === "s") {
        const dir = key === "w" ? 1 : -1;
        next = {
          ...next,
          x: next.x + Math.cos(next.heading) * step * dir,
          z: next.z + Math.sin(next.heading) * step * dir
        };
      }
      setTrajectory((points) => [...points.slice(-42), [next.x, next.z]]);
      recordEpisodeEvent({ lane: "agent", label: driveActionLabel(key), status: "fallback" });
      return next;
    });
  };

  const resetProps = () => {
    setProps(defaultProps);
    setSelectedPropId(null);
    propSeqRef.current = defaultProps.length;
    recordEpisodeEvent({ lane: "object", label: "prop reset all", status: "ready" });
  };

  const spawnProp = (preset: SimulatedPropPreset) => {
    const nextIndex = propSeqRef.current + 1;
    propSeqRef.current = nextIndex;
    const nextProp: SimulatedPropState = {
      id: `prop-${nextIndex}`,
      label: `${preset}_${nextIndex}`,
      preset,
      contactState: "grounded",
      x: agent.x + Math.cos(agent.heading) * 0.48,
      y: preset === "tall-crate" ? 0.42 : 0.18,
      z: agent.z + Math.sin(agent.heading) * 0.48,
      footprintRadius: preset === "tall-crate" ? 0.26 : 0.3
    };
    setProps((current) => [...current, nextProp]);
    setSelectedPropId(nextProp.id);
    setSelectedPropPreset(preset);
    recordEpisodeEvent({ lane: "object", label: `prop spawn · ${preset}`, targetId: nextProp.id, status: "grounded" });
  };

  const selectProp = (id: string) => {
    setSelectedPropId(id);
    recordEpisodeEvent({ lane: "object", label: "prop select", targetId: id, status: "active" });
  };

  const duplicateSelectedProp = () => {
    if (!selectedProp) return;
    const nextIndex = propSeqRef.current + 1;
    propSeqRef.current = nextIndex;
    const duplicate = {
      ...selectedProp,
      id: `prop-${nextIndex}`,
      label: `${selectedProp.preset}_${nextIndex}`,
      x: selectedProp.x + 0.18,
      z: selectedProp.z + 0.18
    };
    setProps((current) => [...current, duplicate]);
    setSelectedPropId(duplicate.id);
    recordEpisodeEvent({ lane: "object", label: "prop duplicate", targetId: selectedProp.id, status: "grounded" });
  };

  const resetSelectedProp = () => {
    if (!selectedProp) return;
    setProps((current) =>
      current.map((prop) =>
        prop.id === selectedProp.id
          ? { ...prop, x: selectedProp.preset === "tall-crate" ? 0.9 : -0.8, z: selectedProp.preset === "tall-crate" ? 0.9 : 0.4, contactState: "grounded" }
          : prop
      )
    );
    recordEpisodeEvent({ lane: "object", label: "prop reset", targetId: selectedProp.id, status: "grounded" });
  };

  const deleteSelectedProp = () => {
    if (!selectedProp) return;
    setProps((current) => current.filter((prop) => prop.id !== selectedProp.id));
    setSelectedPropId(null);
    recordEpisodeEvent({ lane: "object", label: "prop delete", targetId: selectedProp.id, status: "removed" });
  };

  const nudgeSelectedProp = (dx: number, dz: number) => {
    if (!selectedProp) return;
    setProps((current) =>
      current.map((prop) => (prop.id === selectedProp.id ? { ...prop, x: prop.x + dx, z: prop.z + dz, contactState: "grounded" } : prop))
    );
    recordEpisodeEvent({ lane: "object", label: "prop nudge", targetId: selectedProp.id, status: "grounded" });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "edit" && renderer && tool === "brush") {
      interactionRef.current = { kind: "brush", x: event.clientX, y: event.clientY };
      brushStrokeRef.current = new Set();
      paintAt(event);
    } else if (mode === "edit" && renderer && tool === "rect") {
      interactionRef.current = { kind: "rect", x: event.clientX, y: event.clientY };
      const start = toStage(event.clientX, event.clientY);
      setSelectRect({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
    } else if (mode === "edit" && renderer && tool === "crop") {
      interactionRef.current = { kind: "crop", x: event.clientX, y: event.clientY };
      const start = toStage(event.clientX, event.clientY);
      setCropDraft({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
    } else if (mode === "edit" && renderer && tool === "move") {
      const canvas = canvasRef.current;
      if (!selected.size) {
        interactionRef.current = null;
        setLastAction("transform needs selection");
        return;
      }
      if (!canvas || !renderer.projectToGround) {
        interactionRef.current = null;
        setLastAction("transform unavailable");
        return;
      }
      const startWorld = renderer.projectToGround(canvas, options, event.clientX, event.clientY);
      if (!startWorld) {
        interactionRef.current = null;
        setLastAction("transform missed ground");
        return;
      }
      const indices = [...selected].filter((index) => !deleted.has(index));
      if (!indices.length) {
        interactionRef.current = null;
        setLastAction("transform needs visible selection");
        return;
      }
      transformDragRef.current = {
        startWorld,
        indices,
        baseTransforms: new Map(indices.flatMap((index) => {
          const transform = pointTransforms.get(index);
          return transform ? [[index, transform] as const] : [];
        }))
      };
      interactionRef.current = { kind: "move", x: event.clientX, y: event.clientY };
      setTransformDraft({ dx: 0, dz: 0, count: indices.length, stage: toStage(event.clientX, event.clientY) });
    } else if (mode === "edit" && renderer && tool === "ruler") {
      interactionRef.current = null;
      measureAt(event);
    } else {
      const dragKind = mode === "simulate" ? classifySimulateDrag(event) : "orbit";
      if (mode === "simulate") {
        if (dragKind === "orbit") {
          setSimulateCameraMode("orbit");
        } else {
          enterFreeCamera(dragKind === "pan" ? "inside pan" : "inside look");
        }
        setLastAction(dragKind === "orbit" ? "orbit" : dragKind === "pan" ? "inside pan" : "inside look");
      }
      interactionRef.current = { kind: "camera", x: event.clientX, y: event.clientY, dragKind };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === "edit" && tool === "brush") {
      setCursor(toStage(event.clientX, event.clientY));
    }
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.kind === "brush") {
      paintAt(event);
      return;
    }
    if (interaction.kind === "rect") {
      const point = toStage(event.clientX, event.clientY);
      setSelectRect((current) => (current ? { ...current, x1: point.x, y1: point.y } : current));
      return;
    }
    if (interaction.kind === "crop") {
      const point = toStage(event.clientX, event.clientY);
      setCropDraft((current) => (current ? { ...current, x1: point.x, y1: point.y } : current));
      return;
    }
    if (interaction.kind === "move") {
      updateTransformDrag(event);
      return;
    }
    const dx = event.clientX - interaction.x;
    const dy = event.clientY - interaction.y;
    interactionRef.current = { ...interaction, x: event.clientX, y: event.clientY };
    if (interaction.kind === "camera" && interaction.dragKind === "pan") {
      if (mode === "simulate" && simulateCameraMode === "free" && firstPersonCamera) {
        setFirstPersonCamera((current) => current ? panFirstPersonCamera(current, dx, dy, simulateSteps.scale) : current);
        return;
      }
      setCamera((current) => panCamera(current, dx, dy));
      return;
    }
    if (interaction.kind === "camera" && mode === "simulate" && simulateCameraMode === "free" && firstPersonCamera && interaction.dragKind !== "orbit") {
      setFirstPersonCamera((current) => current ? rotateFirstPersonCamera(current, dx, dy) : current);
      return;
    }
    setCamera((current) => rotateCamera(current, dx, dy));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (interaction?.kind === "brush" && brushStrokeRef.current.size) {
      const indices = [...brushStrokeRef.current];
      const entry: HistoryItem = { id: crypto.randomUUID(), type: "select", count: indices.length, indices };
      setHistory((current) => [entry, ...current].slice(0, 10));
    }
    if (interaction?.kind === "rect") {
      const canvas = canvasRef.current;
      const indices =
        canvas && renderer?.collectInRect
          ? renderer.collectInRect(canvas, options, interaction.x, interaction.y, event.clientX, event.clientY)
          : [];
      if (indices.length) {
        setSelected((current) => {
          const next = new Set(current);
          for (const index of indices) next.add(index);
          return next;
        });
        const entry: HistoryItem = { id: crypto.randomUUID(), type: "select", count: indices.length, indices };
        setHistory((current) => [entry, ...current].slice(0, 10));
      }
      setSelectRect(null);
    }
    if (interaction?.kind === "crop") {
      applyCropFromDrag(interaction.x, interaction.y, event.clientX, event.clientY);
      setCropDraft(null);
    }
    if (interaction?.kind === "move") {
      const drag = transformDragRef.current;
      const delta = updateTransformDrag(event);
      if (drag && delta && Math.hypot(delta.dx, delta.dz) >= 0.01) {
        const entry: HistoryItem = {
          id: crypto.randomUUID(),
          type: "transform",
          count: drag.indices.length,
          indices: drag.indices,
          delta,
          previousTransforms: new Map(drag.baseTransforms)
        };
        setHistory((current) => [entry, ...current].slice(0, 10));
        setLastTransformDelta({ dx: delta.dx, dz: delta.dz, count: drag.indices.length, stage: toStage(event.clientX, event.clientY) });
        setLastAction(`transform ${drag.indices.length} moved`);
      } else if (drag) {
        restoreTransformBase(drag);
        setLastTransformDelta(null);
        setLastAction("transform too small");
      }
      transformDragRef.current = null;
      setTransformDraft(null);
    }
    interactionRef.current = null;
    brushStrokeRef.current = new Set();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (mode === "simulate") {
      enterFreeCamera("inside dolly");
      if (firstPersonCamera || leveledSourceFrameCamera) {
        setFirstPersonCamera((current) => {
          const base = current ?? (leveledSourceFrameCamera ? firstPersonCameraFromFrame(leveledSourceFrameCamera) : null);
          return base ? dollyFirstPersonCamera(base, event.deltaY, simulateSteps.scale) : base;
        });
        return;
      }
    }
    setCamera((current) => dollyCamera(current, event.deltaY));
  };

  const activeMode = modes.find((entry) => entry.id === mode) ?? modes[0];
  const rootClass = `ws-root mode-${mode} ${dense ? "dense" : ""} ${docked ? "docked" : ""}`.trim();
  const hasDesktopApi = Boolean(getDesktopApi()?.openLocalPackage);
  const measureStart = measurePoints[0];
  const measureEnd = measurePoints[1];
  const measureLineStyle =
    measureStart && measureEnd
      ? {
          left: measureStart.stage.x,
          top: measureStart.stage.y,
          width: Math.hypot(measureEnd.stage.x - measureStart.stage.x, measureEnd.stage.y - measureStart.stage.y),
          transform: `rotate(${Math.atan2(measureEnd.stage.y - measureStart.stage.y, measureEnd.stage.x - measureStart.stage.x)}rad)`
        }
      : undefined;
  const measureLabelStyle =
    measureStart && measureEnd
      ? {
          left: (measureStart.stage.x + measureEnd.stage.x) / 2,
          top: (measureStart.stage.y + measureEnd.stage.y) / 2
        }
      : undefined;

  return (
    <div className="ws-stage-shell">
      {hasDesktopApi ? <div className="ws-drag-strip" /> : null}
      <div className="ws-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <main className={rootClass} style={{ "--acc": accent } as React.CSSProperties}>
          <canvas
            ref={canvasRef}
            className={`ws-canvas ${mode === "simulate" ? "dual-right" : ""} ${
              mode === "edit" && (tool === "brush" || tool === "rect" || tool === "crop" || tool === "move" || tool === "ruler") ? "edit-tool" : ""
            }`.trim()}
            data-testid="world-canvas"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={onWheel}
            onDoubleClick={resetSimulateFrameCamera}
          />
          {mode === "edit" && tool === "brush" && cursor ? (
            <div
              className="ws-brush-ring"
              style={{ left: cursor.x, top: cursor.y, width: brushRadius * 2, height: brushRadius * 2 }}
            />
          ) : null}
          {mode === "edit" && selectRect ? (
            <div
              className="ws-select-rect"
              style={{
                left: Math.min(selectRect.x0, selectRect.x1),
                top: Math.min(selectRect.y0, selectRect.y1),
                width: Math.abs(selectRect.x1 - selectRect.x0),
                height: Math.abs(selectRect.y1 - selectRect.y0)
              }}
            />
          ) : null}
          {mode === "edit" && (cropRegion || cropDraft) ? (
            <div className="ws-crop-overlay">
              {cropRegion ? <div className="ws-crop-rect active" data-testid="crop-overlay" style={stageRectStyle(cropRegion.stage)} /> : null}
              {cropDraft ? <div className="ws-crop-rect draft" data-testid="crop-draft" style={stageRectStyle(cropDraft)} /> : null}
            </div>
          ) : null}
          {mode === "edit" && transformDraft ? (
            <div className="ws-transform-label" data-testid="transform-delta" style={{ left: transformDraft.stage.x, top: transformDraft.stage.y }}>
              dx {transformDraft.dx.toFixed(2)} · dz {transformDraft.dz.toFixed(2)} m
            </div>
          ) : null}
          {mode === "edit" && measurePoints.length ? (
            <div className="ws-measure-overlay" data-testid="measure-overlay">
              {measureLineStyle ? <div className="ws-measure-line" style={measureLineStyle} /> : null}
              {measurePoints.map((point, index) => (
                <div className="ws-measure-dot" key={`${point.world.join(":")}-${index}`} style={{ left: point.stage.x, top: point.stage.y }}>
                  {index + 1}
                </div>
              ))}
              {measurementDistance !== null && measureLabelStyle ? (
                <div className="ws-measure-label" data-testid="measure-overlay-label" style={measureLabelStyle}>
                  {measurementDistance.toFixed(2)} m
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="ws-overlay">
            {mode === "simulate" ? (
              <>
                <div className={`ws-dual-left ${simulateComparisonCapture?.previewDataUrl || simulateSourceFrame?.previewDataUrl ? "has-comparison" : ""}`.trim()}>
                  {simulateComparisonCapture?.previewDataUrl ? (
                    <img
                      alt="Selected comparison capture evidence"
                      className="ws-sim-comparison-preview"
                      src={simulateComparisonCapture.previewDataUrl}
                    />
                  ) : simulateSourceFrame?.previewDataUrl ? (
                    <img
                      alt="Selected source frame evidence"
                      className="ws-sim-comparison-preview"
                      src={simulateSourceFrame.previewDataUrl}
                    />
                  ) : (
                    <FeedCanvas points={worldPoints} classes={session?.classes ?? []} mode="rgb" pose={simFeedPose} cw={960} ch={1080} />
                  )}
                  <div className="ws-view-tag">
                    <span className="ws-head">{simulateComparisonCapture || simulateSourceFrame ? "Source evidence" : "Sensor feed"}</span>
                    <WSChip>
                      {simulateComparisonCapture
                        ? `frame ${simulateComparisonCapture.frame}`
                        : simulateSourceFrame
                          ? simulateSourceFrame.name
                        : captureFrames.length
                          ? `${captureFrames.length} frames`
                          : "cam_front · synthetic"}
                    </WSChip>
                  </div>
                </div>
                <div className="ws-dual-right-frame" />
                <div className="ws-dual-split" />
                {simulateRenderEvidenceUrl ? (
                  <img
                    alt={`${simulateSourceFrame?.name ?? "source frame"} native render evidence`}
                    className="ws-native-render-evidence"
                    src={simulateRenderEvidenceUrl}
                  />
                ) : null}
                <div className="ws-view-tag metric">
                  <span className="ws-head">3DGS visual proxy</span>
                  <WSChip>{session ? `${simulateRenderEvidenceUrl ? "native render evidence" : simulateCameraLabel} · ${session.pointCount} pts` : "load splat package"}</WSChip>
                </div>
              </>
            ) : null}
            <div className="ws-top-left">
              <WSWordmark context={session ? `${session.name} · ${session.version ?? "loaded"}` : "no world loaded"} />
              {mode === "edit" ? <ToolRail tool={tool} onSelect={setTool} /> : null}
            </div>

            <div className="ws-top-center">
              <WSPanel className="ws-mode-switch">
                <span className="ws-head">Mode</span>
                {modes.map((entry) => (
                  <WSPill key={entry.id} active={entry.id === mode} onClick={() => setMode(entry.id)}>
                    {entry.label}
                  </WSPill>
                ))}
              </WSPanel>
            </div>

            {hasDesktopApi && (session || simulateComparisonCapture) ? (
              <div className="ws-open-local-action">
                <WSPanel className="ws-header-actions">
                  <WSButton onClick={() => void loadLocalPackage()}>Open Local</WSButton>
                </WSPanel>
              </div>
            ) : null}

            {mode === "view" || mode === "edit" ? (
              <div className="ws-render-row">
                <WSPanel className="ws-mode-switch">
                  <span className="ws-head">Render</span>
                  {renderModes.map((entry) => (
                    <WSPill key={entry} className="sm" active={entry === renderMode} onClick={() => setRenderMode(entry)}>
                      {entry}
                    </WSPill>
                  ))}
                </WSPanel>
              </div>
            ) : null}

            {mode === "pilot" ? (
              <div className="ws-render-row">
                <div className="ws-strip">
                  {stripCells.map((cell) => (
                    <div key={cell.label} className={`ws-strip-cell ${cell.label === "RGB" ? "on" : ""}`}>
                      <FeedCanvas points={worldPoints} classes={session?.classes ?? []} mode={cell.mode} pose={agentEye} cw={400} ch={240} />
                      <span className="ws-strip-lab">{cell.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <aside className={`ws-left ws-left-${mode}`}>{renderLeftPanel()}</aside>
            <aside className={`ws-right-col ws-right-col-${mode}`}>{renderRightPanel()}</aside>

            {mode === "pilot" ? (
              <>
                <div className="ws-bottom-right ws-pip">
                  <FeedCanvas points={worldPoints} classes={session?.classes ?? []} mode="rgb" pose={agentEye} cw={880} ch={536} />
                  <span className="ws-pip-lab">
                    <WSDot pulse /> agent eye · cam_front
                  </span>
                </div>
                <div className="ws-bottom-left">
                  <WSPanel title={activeMode.title} meta={activeMode.tag} className="ws-mode-card">
                    <ModeCard mode={mode} renderMode={renderMode} session={session} assetSummary={assetSummary} playhead={playhead} />
                  </WSPanel>
                </div>
              </>
            ) : null}

            {mode === "sensors" ? (
              <div className="ws-bottom-left ws-previews">
                {[
                  { mode: "rgb" as FeedMode, label: "cam_front · RGB" },
                  { mode: "depth" as FeedMode, label: "cam_front · DEPTH" }
                ].map((cell) => (
                  <div key={cell.label} className="ws-preview-card">
                    <FeedCanvas points={worldPoints} classes={session?.classes ?? []} mode={cell.mode} pose={simFeedPose} cw={600} ch={376} />
                    <span className="ws-strip-lab">{cell.label}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {mode === "simulate" ? (
              <div className="ws-bottom-tray">
                <WSPanel title="Session" className="ws-card">
                  <div className="ws-kv">
                    <span>dataset</span>
                    <b>{session?.name ?? "none"}</b>
                  </div>
                  <div className="ws-kv">
                    <span>points</span>
                    <b>{session?.pointCount ?? 0}</b>
                  </div>
                  <div className="ws-kv">
                    <span>loaded</span>
                    <b>{session ? new Date(session.provenance.loadedAt).toLocaleTimeString() : "—"}</b>
                  </div>
                </WSPanel>
                <WSPanel title="Agent state" className="ws-card">
                  <div className="ws-kv">
                    <span>pose</span>
                    <b>
                      x {agent.x.toFixed(2)} · z {agent.z.toFixed(2)} · θ {Math.round(((agent.heading * 180) / Math.PI) % 360)}°
                    </b>
                  </div>
                  <div className="ws-kv">
                    <span>action</span>
                    <b>{lastAction}</b>
                  </div>
                  <div className="ws-kv">
                    <span>steps</span>
                    <b>{stepCount}</b>
                  </div>
                </WSPanel>
                <WSPanel title="Physics" className="ws-card">
                  <div className="ws-kv">
                    <span>backend</span>
                    <b>{physicsDiagnostics.backend}</b>
                  </div>
                  <div className="ws-kv">
                    <span>body</span>
                    <b>{bodyPreset?.label ?? "unknown"}</b>
                  </div>
                  <div className="ws-kv">
                    <span>spawn</span>
                    <b>
                      x {spawn.x.toFixed(2)} · z {spawn.z.toFixed(2)}
                    </b>
                  </div>
                  <div className="ws-kv">
                    <span>rate</span>
                    <b>{physicsDiagnostics.stepRateHz}hz</b>
                  </div>
                  <div className="ws-kv">
                    <span>bodies</span>
                    <b>
                      {physicsDiagnostics.bodyCount} bodies · {physicsDiagnostics.colliderCount} colliders
                    </b>
                  </div>
                  <div className="ws-kv">
                    <span>contacts</span>
                    <b>
                      {physicsDiagnostics.contactCount} · {physicsDiagnostics.grounded ? "grounded" : "airborne"}
                    </b>
                  </div>
                  <div className="ws-kv">
                    <span>debug</span>
                    <button className="ws-node click" onClick={() => setDebugCollision((value) => !value)}>
                      {debugCollision ? "collision on" : "collision off"}
                    </button>
                  </div>
                </WSPanel>
                <WSPanel title="3DGS Performance" meta="visual proposal" className="ws-performance-card">
                  <div className="ws-kv">
                    <span>density</span>
                    <b>{Math.round(density * 100)}% preview</b>
                  </div>
                  <div className="ws-kv">
                    <span>spark</span>
                    <b>{rendererDiagnostics?.sparkState ?? "unknown"}</b>
                  </div>
                  <div className="ws-kv">
                    <span>profile</span>
                    <b>{rendererDiagnostics?.sparkProfile ?? "default"}</b>
                  </div>
                  <div className="ws-kv">
                    <span>splats</span>
                    <b>{rendererDiagnostics?.gaussianSplatCount ?? assetSummary?.pointCount ?? session?.pointCount ?? "unknown"}</b>
                  </div>
                  <div className="ws-kv">
                    <span>source</span>
                    <b>{rendererDiagnostics?.gaussianPreparedForSpark === undefined ? "pending" : rendererDiagnostics.gaussianPreparedForSpark ? "converted" : "native"}</b>
                  </div>
                  <div className="ws-kv">
                    <span>authority</span>
                    <b>review proposal</b>
                  </div>
                </WSPanel>
                <WSPanel title={activeMode.title} meta={activeMode.tag} className="ws-mode-card">
                  <ModeCard mode={mode} renderMode={renderMode} session={session} assetSummary={assetSummary} playhead={playhead} />
                </WSPanel>
              </div>
            ) : null}

            {mode === "episode" ? (
              <div className="ws-top-right">
                <WSPanel title="Episode" meta={activeMode.tag} className="ws-episode-card">
                  <div className="ws-mode-title-row">
                    <div className="ws-mode-title">Episode</div>
                    <WSChip accent={playing}>{playing ? "playing" : "paused"}</WSChip>
                  </div>
                  <div className="ws-kv">
                    <span>steps</span>
                    <b>
                      {episodeStep} / {totalSteps}
                    </b>
                  </div>
                  <div className="ws-kv">
                    <span>captures</span>
                    <b>{sensors.filter((sensor) => sensor.enabled).map((sensor) => sensor.label).join(" · ") || "none"}</b>
                  </div>
                  <div className="ws-kv">
                    <span>source</span>
                    <b>{episodeEvents.length ? "pilot events" : trajectory.length > 1 ? "pilot drive" : "no recording"}</b>
                  </div>
                  <div className="ws-kv" data-testid="episode-selected-event">
                    <span>selected</span>
                    <b>{selectedEpisodeEvent ? `${selectedEpisodeEvent.frame} · ${selectedEpisodeEvent.label}` : "none"}</b>
                  </div>
                  <div className="ws-episode-list" data-testid="episode-event-list">
                    {episodeTimeline.length ? (
                      episodeTimeline.map((event) => (
                        <button
                          aria-label={`Select episode event ${event.label}`}
                          aria-pressed={selectedEpisodeEvent?.id === event.id}
                          className={`ws-episode-row ${event.lane}`}
                          key={event.id}
                          onClick={() => selectEpisodeEvent(event)}
                          type="button"
                        >
                          <span className="ws-episode-frame">{String(event.frame).padStart(3, "0")}</span>
                          <span className="ws-episode-label">{event.label}</span>
                          <b>{event.status ?? event.lane}</b>
                        </button>
                      ))
                    ) : (
                      <div className="ws-kv">
                        <span>events</span>
                        <b>none</b>
                      </div>
                    )}
                  </div>
                  {selectedEpisodeEvent?.lane === "capture" ? (
                    <div className="ws-episode-capture-detail" data-testid="episode-capture-detail">
                      <div className="ws-detail-heading">
                        <span>Capture Detail</span>
                        <b>{selectedEpisodeCapture ? selectedEpisodeCapture.assetStatus : "event only"}</b>
                      </div>
                      {selectedEpisodeCapture ? (
                        <>
                          {selectedEpisodeCapture.previewDataUrl ? (
                            <img
                              alt="Selected episode capture preview"
                              className="ws-capture-preview"
                              src={selectedEpisodeCapture.previewDataUrl}
                            />
                          ) : (
                            <div className="ws-capture-missing">
                              <span className="ws-frame-thumb" />
                              <span className="ws-row-name">missing capture asset</span>
                            </div>
                          )}
                          <div className="ws-kv">
                            <span>event</span>
                            <b>{selectedEpisodeCapture.eventId} · frame {selectedEpisodeCapture.frame}</b>
                          </div>
                          <div className="ws-kv">
                            <span>sensor</span>
                            <b>{selectedEpisodeCapture.sensorLabel} · {selectedEpisodeCapture.sensorKind}</b>
                          </div>
                          <div className="ws-kv">
                            <span>source</span>
                            <b>{selectedEpisodeCapture.rendererStatus}</b>
                          </div>
                          <div className="ws-kv">
                            <span>asset</span>
                            <b>{selectedEpisodeCapture.assetPath ?? "embedded preview"}</b>
                          </div>
                          <div className="ws-kv">
                            <span>bytes</span>
                            <b>{selectedEpisodeCapture.sizeBytes.toLocaleString()}</b>
                          </div>
                          <div className="ws-kv">
                            <span>checksum</span>
                            <b>{selectedEpisodeCapture.checksum}</b>
                          </div>
                          <div className={`ws-kv ws-capture-asset-validation ${selectedEpisodeCapture.assetStatus}`}>
                            <span>integrity</span>
                            <b>{formatSensorCaptureAssetStatus(selectedEpisodeCapture)}</b>
                          </div>
                          <div className="ws-kv">
                            <span>camera</span>
                            <b>{formatCaptureCamera(selectedEpisodeCapture.camera)}</b>
                          </div>
                        </>
                      ) : (
                        <div className="ws-capture-empty">
                          <span className="ws-frame-thumb" />
                          <span className="ws-row-name">no capture artifact for selected event</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {sensorCaptures.length ? (
                    <div className="ws-capture-compare" data-testid="episode-capture-compare">
                      <div className="ws-detail-heading">
                        <span>Capture Compare</span>
                        <b>{captureComparison.length}/2 selected</b>
                      </div>
                      <div className="ws-compare-grid">
                        {captureComparison.map((capture) => (
                          <div className={`ws-compare-card ${capture.assetStatus}`} key={capture.id}>
                            {capture.previewDataUrl ? (
                              <img
                                alt={`Compare capture ${capture.eventId}`}
                                className="ws-capture-preview"
                                src={capture.previewDataUrl}
                              />
                            ) : (
                              <div className="ws-capture-missing">
                                <span className="ws-frame-thumb" />
                                <span className="ws-row-name">missing capture asset</span>
                              </div>
                            )}
                            <div className="ws-kv">
                              <span>frame</span>
                              <b>{capture.eventId} · {capture.frame}</b>
                            </div>
                            <div className="ws-kv">
                              <span>sensor</span>
                              <b>{capture.sensorLabel} · {capture.sensorKind}</b>
                            </div>
                            <div className={`ws-kv ws-capture-asset-validation ${capture.assetStatus}`}>
                              <span>integrity</span>
                              <b>{formatSensorCaptureAssetStatus(capture)}</b>
                            </div>
                          </div>
                        ))}
                        {captureComparison.length < 2 ? (
                          <div className="ws-compare-empty">
                            <span className="ws-frame-thumb" />
                            <span className="ws-row-name">select another capture</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="ws-capture-list">
                        {captureCompareCandidates.slice(0, 6).map((capture) => {
                          const selectedForCompare = captureCompareIds.includes(capture.id);
                          return (
                            <button
                              aria-label={`${selectedForCompare ? "Remove" : "Add"} capture ${capture.eventId} comparison`}
                              className={`ws-capture-row ${selectedForCompare ? "selected" : ""}`}
                              key={capture.id}
                              onClick={() => toggleCaptureComparison(capture.id)}
                              type="button"
                            >
                              <span>{String(capture.frame).padStart(3, "0")}</span>
                              <b>{capture.sensorLabel}</b>
                              <span>{selectedForCompare ? "selected" : capture.assetStatus}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="ws-btn-row">
                        {selectedEpisodeCapture ? (
                          <WSButton onClick={() => toggleCaptureComparison(selectedEpisodeCapture.id)}>
                            {captureCompareIds.includes(selectedEpisodeCapture.id) ? "Remove Selected" : "Add Selected to Compare"}
                          </WSButton>
                        ) : null}
                        <WSButton accent disabled={!captureComparison.length} onClick={() => void exportSensorCaptureManifest()}>
                          Export Captures
                        </WSButton>
                        <WSButton disabled={!captureComparison.length} onClick={clearCaptureComparison}>
                          Clear
                        </WSButton>
                      </div>
                    </div>
                  ) : null}
                  <div className="ws-btn-row">
                    <WSButton onClick={() => void loadEpisodeManifest()}>Load Episode</WSButton>
                    <WSButton accent disabled={!episodeTimeline.length} onClick={exportEpisodeManifest}>
                      Preview JSON
                    </WSButton>
                    <WSButton disabled={!episodeTimeline.length} onClick={() => void saveEpisodeManifest()}>
                      Save Episode
                    </WSButton>
                    <WSButton disabled={!episodeTimeline.length} onClick={() => void saveEpisodeBundle()}>
                      Export Package
                    </WSButton>
                  </div>
                  <input
                    accept="application/json,.json"
                    aria-label="Episode manifest file"
                    data-testid="episode-import-input"
                    hidden
                    onChange={(event) => void handleEpisodeFileImport(event)}
                    ref={episodeImportInputRef}
                    type="file"
                  />
                  <div className="ws-kv" data-testid="episode-save-status">
                    <span>file</span>
                    <b>{episodeSaveStatus ?? (getDesktopApi()?.saveEpisodeManifest ? "desktop save ready" : "browser download ready")}</b>
                  </div>
                  {episodeProvenance ? (
                    <div className="ws-episode-provenance" data-testid="episode-provenance">
                      <div className="ws-kv">
                        <span>schema</span>
                        <b>{episodeProvenance.schema}</b>
                      </div>
                      <div className="ws-kv">
                        <span>world</span>
                        <b>{episodeProvenance.worldName}</b>
                      </div>
                      <div className="ws-kv">
                        <span>package</span>
                        <b>{episodeProvenance.packageKind}</b>
                      </div>
                      <div className="ws-kv">
                        <span>source</span>
                        <b>{compactPath(episodeProvenance.sourcePath)}</b>
                      </div>
                      <div className="ws-kv">
                        <span>artifact</span>
                        <b>{episodeProvenance.primaryArtifact}</b>
                      </div>
                      <div className="ws-kv">
                        <span>authority</span>
                        <b>{episodeProvenance.authorityStatus}</b>
                      </div>
                      <div className="ws-kv">
                        <span>renderer</span>
                        <b>{episodeProvenance.rendererStatus}</b>
                      </div>
                      {episodeSourceMatch ? (
                        <div className={`ws-kv ws-source-match ${episodeSourceMatch.status}`}>
                          <span>source match</span>
                          <b>{episodeSourceMatch.status} · {episodeSourceMatch.detail}</b>
                        </div>
                      ) : null}
                      {episodeAssetValidation ? (
                        <div className={`ws-kv ws-asset-validation ${episodeAssetValidation.status}`}>
                          <span>assets</span>
                          <b>{episodeAssetValidation.status} · {episodeAssetValidation.detail}</b>
                        </div>
                      ) : null}
                      {sensorCaptureAssetValidation ? (
                        <div className={`ws-kv ws-capture-asset-validation ${sensorCaptureAssetValidation.status}`}>
                          <span>capture assets</span>
                          <b>{sensorCaptureAssetValidation.status} · {sensorCaptureAssetValidation.detail}</b>
                        </div>
                      ) : null}
                      {episodeIntegrityRows.length ? (
                        <div className="ws-integrity-block">
                          <div className="ws-btn-row">
                            <WSButton onClick={() => setEpisodeIntegrityOpen((value) => !value)}>
                              {episodeIntegrityOpen ? "Hide Asset Details" : "Asset Details"}
                            </WSButton>
                          </div>
                          {episodeIntegrityOpen ? (
                            <div className="ws-integrity-table-wrap" data-testid="episode-integrity-table">
                              <table className="ws-integrity-table">
                                <thead>
                                  <tr>
                                    <th>path</th>
                                    <th>status</th>
                                    <th>expected size</th>
                                    <th>expected checksum</th>
                                    <th>actual size</th>
                                    <th>actual checksum</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {episodeIntegrityRows.map((row) => (
                                    <tr className={row.status} key={row.path}>
                                      <td>{row.path}</td>
                                      <td>{row.status}</td>
                                      <td>{row.expectedSize}</td>
                                      <td>{row.expectedChecksum}</td>
                                      <td>{row.actualSize}</td>
                                      <td>{row.actualChecksum}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="ws-kv">
                        <span>notes</span>
                        <b>{episodeProvenance.notes.join(" · ")}</b>
                      </div>
                      {episodeProvenance.source === "bundle" && episodeSourceMatch?.status !== "matched" ? (
                        <div className="ws-btn-row">
                          <WSButton disabled={!getDesktopApi()?.openLocalPackage} onClick={() => void relinkEpisodeWorldPackage()}>
                            Relink World Package
                          </WSButton>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {episodeExportText ? (
                    <pre className="ws-episode-export" data-testid="episode-export-preview">
                      {episodeExportText}
                    </pre>
                  ) : null}
                </WSPanel>
              </div>
            ) : null}

            {mode !== "pilot" && mode !== "simulate" && mode !== "sensors" && mode !== "episode" ? (
              <div className="ws-bottom-right">
                <WSPanel title={activeMode.title} meta={activeMode.tag} className="ws-mode-card">
                  <ModeCard mode={mode} renderMode={renderMode} session={session} assetSummary={assetSummary} playhead={playhead} />
                </WSPanel>
              </div>
            ) : null}

            {mode === "episode" ? (
              <div className="ws-bottom-full">
                <TracksPanel
                  step={episodeStep}
                  total={episodeTotalFrames}
                  playing={playing}
                  hasTrajectory={trajectory.length > 1}
                  capturing={sensors.some((sensor) => sensor.enabled) || episodeTimeline.length > 0}
                  onToggle={() => setPlaying((value) => !value)}
                  onRewind={() => {
                    setPlayhead(0);
                    setPlaying(false);
                    setSelectedEpisodeEventId(episodeTimeline[0]?.id ?? null);
                  }}
                />
              </div>
            ) : (
              <div className="ws-bottom-center">
                <div className="ws-bottom-stack">
                  {mode === "view" || mode === "simulate" ? (
                    mode === "simulate" && captureFrames.length > 0 ? (
                      <TimelineCapsule
                        frame={selectedSourceFrameIndex + 1}
                        total={captureFrames.length}
                        playing={playing}
                        onToggle={toggleCapturePlayback}
                        onRewind={() => {
                          setPlaying(false);
                          selectSourceFrame(0);
                        }}
                      />
                    ) : (
                      <TimelineCapsule
                        frame={Math.round(playhead * timelineTotal)}
                        total={timelineTotal}
                        playing={playing}
                        recording={mode === "view" && Boolean(session)}
                        onToggle={() => setPlaying((value) => !value)}
                        onRewind={() => setPlayhead(0)}
                      />
                    )
                  ) : null}
                  {mode === "simulate" ? (
                    <div className="ws-sim-camera-strip" data-testid="simulate-camera-mode">
                      <div className="ws-sim-mode-group" aria-label="Camera mode">
                        <button className={simulateCameraMode === "frame" ? "on" : ""} onClick={resetSimulateFrameCamera}>
                          Frame
                        </button>
                        <button className={simulateCameraMode === "orbit" ? "on" : ""} onClick={() => setSimulateCameraMode("orbit")}>
                          Orbit
                        </button>
                        <button className={simulateCameraMode === "free" ? "on" : ""} onClick={() => enterFreeCamera()}>
                          Free
                        </button>
                      </div>
                      <div className="ws-sim-nudge-group" data-testid="simulate-camera-dpad">
                        <button aria-label="Fullscreen" onClick={() => void requestStageFullscreen()}>F11</button>
                      </div>
                      <div className="ws-sim-shortcuts" aria-label="Simulate controls">
                        {simulateRailHints.map((hint) => (
                          <span className="ws-sim-shortcut" key={`${hint.glyph ?? hint.keyName}-${hint.label}`}>
                            <WSKey className={hint.glyph ? "ws-key-mouse" : ""}>
                              {hint.glyph ? <WSIcon name={hint.glyph} size={12} /> : hint.keyName}
                            </WSKey>
                            <span>{hint.label}</span>
                          </span>
                        ))}
                      </div>
                      <span className="ws-sim-camera-status">{simulateCameraLabel}</span>
                    </div>
                  ) : null}
                  {mode === "simulate" ? null : <WSControlsBar controls={controls[mode]} />}
                </div>
              </div>
            )}

            {!session && !(mode === "simulate" && simulateComparisonCapture) ? (
              <div className="ws-empty-state">
                <WSPanel title="Open World" meta="explicit">
                  <div className="ws-row-stack">
                    <div className="ws-kv">
                      <span>fixture</span>
                      <b>loft_04 · y-up · meters</b>
                    </div>
                    <div className="ws-row-actions">
                      <WSButton accent onClick={() => void loadFixture()}>
                        Load loft_04
                      </WSButton>
                      {hasDesktopApi ? <WSButton onClick={() => void loadLocalPackage()}>Open Local</WSButton> : null}
                    </div>
                    {loadError ? <div className="ws-mode-copy">{loadError}</div> : null}
                  </div>
                </WSPanel>
              </div>
            ) : null}
          </div>

          <WSStatusBar
            items={[
              { label: session ? `${session.name} · ${session.provenance.authorityStatus}` : "startup blank" },
              { label: `${renderMode} · ${Math.round(density * 100)}% density` },
              { label: cropRegion ? `${selected.size} selected · ${deleted.size} deleted · crop ${cropRegion.hiddenCount}` : `${selected.size} selected · ${deleted.size} hidden` },
              mode === "pilot"
                ? { label: `physics ${physicsDiagnostics.backend} · step ${stepCount}`, accent: true }
                : mode === "simulate"
                  ? { label: `physics ${physicsDiagnostics.backend} · ${physicsDiagnostics.colliderCount} colliders`, accent: true }
                : mode === "episode"
                  ? { label: `step ${episodeStep} / ${totalSteps}`, accent: true }
                  : { label: rendererStatusLabel(renderMode, rendererDiagnostics), accent: true }
            ]}
          />
        </main>
      </div>
    </div>
  );

  function renderLeftPanel() {
    if (mode === "edit") {
      const transformReadout = transformDraft ?? lastTransformDelta;
      return (
        <div className="ws-row-stack">
          <WSPanel title="Selection" meta={`${selected.size} splats`}>
            <div className="ws-btn-row">
              <WSButton disabled={!selected.size} onClick={clearSelected}>
                Clear
              </WSButton>
              <WSButton disabled={!selected.size} onClick={deleteSelected}>
                Delete
              </WSButton>
              <WSButton disabled={!history.length} onClick={undoLast}>
                Undo
              </WSButton>
            </div>
            <div className="ws-kv">
              <span>ghost</span>
              <button className="ws-node click" onClick={() => setShowDeleted((value) => !value)}>
                {showDeleted ? "visible" : "hidden"}
              </button>
            </div>
          </WSPanel>
          <WSPanel title="Crop Box" meta={cropRegion ? "active" : "drag"} data-testid="crop-panel">
            <div className="ws-kv" data-testid="crop-readout">
              <span>outside</span>
              <b>{cropRegion ? `${cropRegion.hiddenCount} points` : "draw box"}</b>
            </div>
            <div className="ws-kv">
              <span>x range</span>
              <b>{cropRegion ? `${cropRegion.bounds.minX.toFixed(2)} … ${cropRegion.bounds.maxX.toFixed(2)} m` : "unset"}</b>
            </div>
            <div className="ws-kv">
              <span>z range</span>
              <b>{cropRegion ? `${cropRegion.bounds.minZ.toFixed(2)} … ${cropRegion.bounds.maxZ.toFixed(2)} m` : "unset"}</b>
            </div>
            <div className="ws-kv">
              <span>path</span>
              <b>point cloud</b>
            </div>
            <div className="ws-btn-row">
              <WSButton disabled={!cropRegion} onClick={clearCrop}>
                Clear Crop
              </WSButton>
            </div>
          </WSPanel>
          <WSPanel title="Transform" meta={selected.size ? "ground delta" : "select"} data-testid="transform-panel">
            <div className="ws-kv" data-testid="transform-readout">
              <span>selected</span>
              <b>{selected.size} points</b>
            </div>
            <div className="ws-kv" data-testid="transform-delta-readout">
              <span>delta</span>
              <b>{transformReadout ? `${transformReadout.dx.toFixed(2)} · ${transformReadout.dz.toFixed(2)} m` : "0.00 · 0.00 m"}</b>
            </div>
            <div className="ws-kv" data-testid="transform-moved-readout">
              <span>moved</span>
              <b>{pointTransforms.size} points</b>
            </div>
            <div className="ws-kv">
              <span>path</span>
              <b>point cloud</b>
            </div>
          </WSPanel>
          <WSPanel title="Measure" meta={measurementDistance === null ? "two clicks" : "ground plane"} data-testid="measure-panel">
            <div className="ws-kv" data-testid="measure-readout">
              <span>distance</span>
              <b>{measurementDistance === null ? (measurePoints.length ? "pick end" : "pick start") : `${measurementDistance.toFixed(2)} m`}</b>
            </div>
            <div className="ws-kv">
              <span>basis</span>
              <b>ground plane · meters</b>
            </div>
            <div className="ws-btn-row">
              <WSButton disabled={!measurePoints.length} onClick={() => setMeasurePoints([])}>
                Clear Measure
              </WSButton>
            </div>
          </WSPanel>
          <WSPanel title="History" meta={`${history.length} ops`}>
            {history.length ? (
              history.map((entry, index) => (
                <div className="ws-hist-row" key={entry.id}>
                  <span className="ws-hist-ix">{String(index + 1).padStart(2, "0")}</span>
                  <span>{entry.type}</span>
                  <span className="ws-head-right">{entry.count}</span>
                </div>
              ))
            ) : (
              <div className="ws-kv">
                <span>ops</span>
                <b>none</b>
              </div>
            )}
          </WSPanel>
        </div>
      );
    }

    if (mode === "simulate") {
      return (
        <WSPanel title="Frames" meta={captureFrames.length ? `${captureFrames.length} captured` : "none"} pad={false}>
          <div className="ws-frame-list">
            {captureFrames.length ? (
              captureFrames.slice(0, 7).map((frame, index) => (
                <button key={frame.name} className={`ws-frame-row ${index === selectedSourceFrameIndex && !simulateComparisonCapture ? "active" : ""}`.trim()} onClick={() => selectSourceFrame(index)}>
                  {frame.previewDataUrl ? (
                    <img alt={`${frame.name} preview`} className="ws-frame-thumb image" src={frame.previewDataUrl} />
                  ) : (
                    <span className="ws-frame-thumb" />
                  )}
                  <span className="ws-row-name">{frame.name}</span>
                  <WSChip>ok</WSChip>
                </button>
              ))
            ) : (
              <div className="ws-frame-row dim">
                <span className="ws-frame-thumb" />
                <span className="ws-row-name">no capture frames in package</span>
              </div>
            )}
          </div>
        </WSPanel>
      );
    }

    if (mode === "pilot") {
      return (
        <div className="ws-row-stack">
          <WSPanel title={`Agent — ${bodyPreset?.label ?? "body"}`} className="ws-agent-pad">
            <div className="ws-pad">
              <span />
              <WSKey active={pressed.has("w")}>W</WSKey>
              <span />
              <WSKey active={pressed.has("a")}>A</WSKey>
              <WSKey active={pressed.has("s")}>S</WSKey>
              <WSKey active={pressed.has("d")}>D</WSKey>
            </div>
            <div className="ws-kv">
              <span>pose</span>
              <b>
                x {agent.x.toFixed(2)} · z {agent.z.toFixed(2)}
              </b>
            </div>
            <div className="ws-kv">
              <span>physics</span>
              <b>{physicsDiagnostics.backend}</b>
            </div>
            <div className="ws-kv">
              <span>spawn</span>
              <b>
                x {spawn.x.toFixed(2)} · z {spawn.z.toFixed(2)}
              </b>
            </div>
            <div className="ws-kv">
              <span>contacts</span>
              <b>
                {physicsDiagnostics.contactCount} · {physicsDiagnostics.grounded ? "grounded" : "airborne"}
              </b>
            </div>
            <div className="ws-kv">
              <span>debug</span>
              <button className="ws-node click" onClick={() => setDebugCollision((value) => !value)}>
                {debugCollision ? "collision on" : "collision off"}
              </button>
            </div>
            <div className="ws-btn-row">
              {agentBodyPresets.map((preset) => (
                <WSButton
                  accent={preset.id === bodyPresetId}
                  aria-label={`${preset.label} body`}
                  key={preset.id}
                  onClick={() => selectBodyPreset(preset.id)}
                >
                  {preset.label}
                </WSButton>
              ))}
            </div>
            <div className="ws-spawn-grid">
              {spawnChoices.map((choice) => (
                <button
                  aria-label={`Spawn at ${choice.label}`}
                  className={`ws-spawn-item ${samePose(choice.agent, spawn) ? "on" : ""}`.trim()}
                  key={choice.id}
                  onClick={() => selectSpawn(choice)}
                  type="button"
                >
                  <WSIcon name="spawn" size={17} />
                  <span>{choice.label}</span>
                </button>
              ))}
            </div>
            <div className="ws-kv">
              <span>MoveAhead</span>
              <b>0.12 m</b>
            </div>
            <div className="ws-kv">
              <span>Rotate</span>
              <b>9°</b>
            </div>
            <div className="ws-btn-row">
              <WSButton onClick={resetAgent}>Reset to Spawn</WSButton>
              <WSButton onClick={setSpawnHere}>Set Spawn Here</WSButton>
            </div>
          </WSPanel>
          <PilotPropPanel
            props={props}
            preset={selectedPropPreset}
            selectedProp={selectedProp}
            onPresetChange={setSelectedPropPreset}
            onSpawn={spawnProp}
            onSelect={selectProp}
            onDuplicate={duplicateSelectedProp}
            onResetSelected={resetSelectedProp}
            onDelete={deleteSelectedProp}
            onResetAll={resetProps}
            onNudge={nudgeSelectedProp}
          />
        </div>
      );
    }

    if (mode === "sensors" || mode === "episode") return null;

    const filteredClasses = (session?.classes ?? []).filter((entry) =>
      entry.name.toLowerCase().includes(treeFilter.toLowerCase())
    );
    return (
      <WSPanel pad={false} className="ws-tree">
        <div className="ws-search">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13.5 13.5L18 18" />
          </svg>
          <input
            ref={filterRef}
            value={treeFilter}
            onChange={(event) => setTreeFilter(event.target.value)}
            placeholder="Filter world…"
            aria-label="Filter world"
          />
          <WSKey>/</WSKey>
        </div>
        <div className="ws-tree-body">
          <div className="ws-group-head">
            <WSIcon name="chevD" size={11} />
            <span className="ws-head">Environment</span>
            <span className="ws-head-right">{session ? `${session.name} · ${session.version ?? "local"}` : "empty"}</span>
          </div>
          {session ? (
            <>
              <div className={`ws-layer-row ${renderMode === "splat" ? "active" : ""}`} onClick={() => setRenderMode("splat")}>
                <span className="ws-row-ic">
                  <WSIcon name="layers" size={15} />
                </span>
                <span className="ws-row-name">Gaussian field</span>
                <WSChip>{assetSummary?.gaussianKind ?? "unloaded"}</WSChip>
              </div>
              <div className={`ws-layer-row ${renderMode === "points" ? "active" : ""}`} onClick={() => setRenderMode("points")}>
                <span className="ws-row-ic">
                  <WSIcon name="layers" size={15} />
                </span>
                <span className="ws-row-name">Point cloud</span>
                <WSChip>{session.pointCount}</WSChip>
              </div>
              <div className={`ws-layer-row ${renderMode === "mesh" ? "active" : ""}`} onClick={() => setRenderMode("mesh")}>
                <span className="ws-row-ic">
                  <WSIcon name="spawn" size={15} />
                </span>
                <span className="ws-row-name">Collision mesh</span>
                <WSChip>{assetSummary ? `${assetSummary.objFaces} tri` : "unloaded"}</WSChip>
              </div>
            </>
          ) : (
            <div className="ws-layer-row dim">
              <span className="ws-row-ic">◉</span>
              <span className="ws-row-name">no loaded world</span>
              <WSChip>0</WSChip>
            </div>
          )}
          <div className="ws-group-head">
            <WSIcon name="chev" size={11} />
            <span className="ws-head">Sensors</span>
            <span className="ws-head-right">rig_a · {sensors.length} ch</span>
          </div>
          <div className="ws-group-head">
            <WSIcon name="chevD" size={11} />
            <span className="ws-head">Classes</span>
            <span className="ws-head-right">{filteredClasses.length}</span>
          </div>
          {filteredClasses.map((entry) => (
            <div
              className={`ws-class-row ${isolatedClass === entry.label ? "active" : ""}`}
              key={entry.label}
              onClick={() => setIsolatedClass((value) => (value === entry.label ? undefined : entry.label))}
            >
              <span className="ws-class-swatch" style={{ background: entry.colorFlat ?? entry.colorShaded }} />
              <span className="ws-row-name">{entry.name}</span>
              <span className="ws-head-right">{entry.points ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="ws-tree-foot">
          <span className="ws-key-group">
            <WSKey>I</WSKey>
            <span className="ws-foot-label">isolate</span>
          </span>
          <span className="ws-key-group">
            <WSKey>/</WSKey>
            <span className="ws-foot-label">filter</span>
          </span>
        </div>
      </WSPanel>
    );
  }

  function renderRightPanel() {
    if (mode === "simulate") {
      return (
        <WSPanel
          title="3DGS Compare"
          meta={simulateComparisonCapture || simulateSourceFrame ? "visual proxy" : "no episode"}
          className="ws-sim-comparison-panel"
          data-testid="simulate-comparison-panel"
        >
          <div className="ws-kv">
            <span>left</span>
            <b>{simulateComparisonCapture ? "source/render evidence" : simulateSourceFrame ? "source evidence" : "synthetic sensor feed"}</b>
          </div>
          <div className="ws-kv">
            <span>right</span>
            <b>{session ? `${renderMode} · ${assetSummary?.gaussianKind ?? "world asset"}` : "3DGS package not loaded"}</b>
          </div>
          <div className="ws-kv">
            <span>authority</span>
            <b>{episodeProvenance?.authorityStatus ?? "visual proxy · not collision authority"}</b>
          </div>
          <div className="ws-kv">
            <span>decision</span>
            <b>{simulateComparisonCapture?.rendererStatus ?? episodeProvenance?.rendererStatus ?? "no QA summary loaded"}</b>
          </div>
          {simulateComparisonCapture ? (
            <>
              <div className="ws-kv">
                <span>frame</span>
                <b>{simulateComparisonCapture.eventId} · {simulateComparisonCapture.sensorLabel}</b>
              </div>
              <div className={`ws-kv ws-capture-asset-validation ${simulateComparisonCapture.assetStatus}`}>
                <span>asset</span>
                <b>{formatSensorCaptureAssetStatus(simulateComparisonCapture)}</b>
              </div>
            </>
          ) : null}
          {simulateCompareCaptures.length ? (
            <div className="ws-sim-frame-picks" data-testid="simulate-comparison-frames">
              {simulateCompareCaptures.slice(0, 8).map((capture) => (
                <button
                  aria-label={`Show comparison frame ${capture.frame}`}
                  className={`ws-sim-frame-pick ${capture.id === simulateComparisonCapture?.id ? "on" : ""}`.trim()}
                  key={capture.id}
                  onClick={() => {
                    setSelectedEpisodeEventId(capture.eventId);
                    setCaptureCompareIds([capture.id]);
                  }}
                  type="button"
                >
                  <span>{String(capture.frame).padStart(3, "0")}</span>
                  <b>{capture.sensorLabel}</b>
                </button>
              ))}
            </div>
          ) : null}
        </WSPanel>
      );
    }

    if (mode === "edit") {
      return (
        <div className="ws-row-stack">
          <WSPanel title="Optimize" meta={`SH ${shDegree} · ${editOptimizeStats.exportPointCount} pts`} data-testid="optimize-panel">
            <div className="ws-kv" data-testid="optimize-counts-readout">
              <span>export points</span>
              <b>{editOptimizeStats.exportPointCount} / {editOptimizeStats.totalPoints}</b>
            </div>
            <div className="ws-kv" data-testid="optimize-outlier-readout">
              <span>removed</span>
              <b>{editOptimizeStats.deletedCount} points</b>
            </div>
            <div className="ws-kv">
              <span>cropped</span>
              <b>{editOptimizeStats.cropHiddenCount} hidden</b>
            </div>
            <div className="ws-kv">
              <span>moved</span>
              <b>{editOptimizeStats.movedCount} points</b>
            </div>
            <div className="ws-slider-row">
              <span className="ws-head">density</span>
              <input type="range" min="0.15" max="1" step="0.05" value={density} onChange={(event) => setDensity(Number(event.target.value))} />
              <span className="ws-mono-val">{Math.round(density * 100)}%</span>
            </div>
            <div className="ws-slider-row">
              <span className="ws-head">expose</span>
              <input type="range" min="0.5" max="1.8" step="0.05" value={exposure} onChange={(event) => setExposure(Number(event.target.value))} />
              <span className="ws-mono-val">{exposure.toFixed(2)}</span>
            </div>
            <div className="ws-kv" data-testid="sh-degree-readout">
              <span>SH degree</span>
              <b>{shDegree}</b>
            </div>
            <div className="ws-btn-row" role="group" aria-label="SH degree">
              {[0, 1, 2, 3].map((degree) => (
                <WSButton accent={degree === shDegree} aria-label={`SH degree ${degree}`} key={degree} onClick={() => setShDegree(degree)}>
                  SH {degree}
                </WSButton>
              ))}
            </div>
            <div className="ws-btn-row">
              <WSButton disabled={!editOptimizeStats.exportPointCount} onClick={removeOutliers}>
                Remove outliers
              </WSButton>
            </div>
          </WSPanel>
          <WSPanel title="Publish" meta={`${formatBytes(editOptimizeStats.estimatedSizeBytes)} est`} data-testid="publish-panel">
            <div className="ws-kv">
              <span>format</span>
              <b>.{publishFormat}</b>
            </div>
            <div className="ws-btn-row" role="group" aria-label="Publish format">
              {(["ply", "splat", "sogs"] as const).map((format) => (
                <WSButton
                  accent={format === publishFormat}
                  aria-label={`Export format .${format}`}
                  key={format}
                  onClick={() => {
                    setPublishFormat(format);
                    setPublishStatus("idle");
                    setEditPublishText(null);
                    setEditPublishMessage(null);
                  }}
                >
                  .{format}
                </WSButton>
              ))}
            </div>
            <div className="ws-kv" data-testid="publish-size-readout">
              <span>est. size</span>
              <b>{formatBytes(editOptimizeStats.estimatedSizeBytes)}</b>
            </div>
            <div className="ws-kv" data-testid="publish-payload-readout">
              <span>payload</span>
              <b>{publishFormat === "ply" ? "cleaned ordinary PLY" : "manifest only"}</b>
            </div>
            <div className="ws-kv">
              <span>authority</span>
              <b>proposal</b>
            </div>
            <div className="ws-kv" data-testid="publish-status-readout">
              <span>status</span>
              <b>{editPublishMessage ?? (publishStatus === "idle" ? "not staged" : publishStatus)}</b>
            </div>
            <div className="ws-btn-row">
              <WSButton disabled={!session} onClick={previewEditPublish}>
                Preview Publish
              </WSButton>
              <WSButton accent disabled={!session} onClick={() => void exportEditPublish()}>
                Export Manifest
              </WSButton>
              <WSButton disabled={!session || publishFormat !== "ply"} onClick={() => void exportCleanedPointCloud()}>
                Export Clean PLY
              </WSButton>
            </div>
            {editPublishText ? (
              <pre className="ws-episode-export" data-testid="edit-publish-preview">
                {editPublishText}
              </pre>
            ) : null}
          </WSPanel>
        </div>
      );
    }

    if (mode === "sensors") {
      return (
        <>
          <WSPanel
            title="Rig — rig_a"
            meta={`${sensors.length} channels · ${sensors.filter((sensor) => sensor.enabled).length} active`}
            pad={false}
            className="ws-sensor-list"
          >
            {sensors.map((sensor) => (
              <div
                key={sensor.id}
                className={`ws-sensor-row ${sensor.id === selectedSensorId ? "active" : ""} ${sensor.enabled ? "" : "dim"}`.trim()}
                onClick={() => setSelectedSensorId(sensor.id)}
              >
                <span className="ws-row-ic">
                  <WSIcon name={sensorIcons[sensor.kind]} size={15} />
                </span>
                <span className="ws-sensor-name">
                  <span className="ws-row-name">{sensor.label}</span>
                  <span className="ws-sensor-spec">{sensor.spec}</span>
                </span>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    updateSensor(sensor.id, { enabled: !sensor.enabled });
                  }}
                >
                  <WSSwitch on={sensor.enabled} />
                </span>
              </div>
            ))}
            <div className="ws-tree-foot">
              <span className="ws-key-group">
                <WSKey>G</WSKey>
                <span className="ws-foot-label">grab / place</span>
              </span>
              <span className="ws-key-group">
                <WSKey>N</WSKey>
                <span className="ws-foot-label">add sensor</span>
              </span>
            </div>
          </WSPanel>
          {selectedSensor ? (
            <WSPanel title={`${selectedSensor.label} — channel`} className="ws-intrinsics" data-testid="sensor-editor">
              <label className="ws-field">
                <span>label</span>
                <input
                  aria-label="Sensor label"
                  value={selectedSensor.label}
                  onChange={(event) => updateSensor(selectedSensor.id, { label: event.target.value })}
                />
              </label>
              <div className="ws-field-grid">
                <label className="ws-field">
                  <span>kind</span>
                  <select
                    aria-label="Sensor kind"
                    value={selectedSensor.kind}
                    onChange={(event) =>
                      updateSensor(selectedSensor.id, { kind: parseSensorKind(event.target.value, selectedSensor.kind) })
                    }
                  >
                    {sensorKindOptions.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ws-field">
                  <span>state</span>
                  <button
                    className={`ws-node click ${selectedSensor.enabled ? "on" : ""}`.trim()}
                    onClick={() => updateSensor(selectedSensor.id, { enabled: !selectedSensor.enabled })}
                    type="button"
                  >
                    {selectedSensor.enabled ? "streaming" : "off"}
                  </button>
                </label>
              </div>
              <label className="ws-field">
                <span>spec</span>
                <input
                  aria-label="Sensor spec"
                  value={selectedSensor.spec}
                  onChange={(event) => updateSensor(selectedSensor.id, { spec: event.target.value })}
                />
              </label>
              <div className="ws-field-grid">
                <label className="ws-field">
                  <span>FOV</span>
                  <input
                    aria-label="Sensor FOV"
                    min="0"
                    max="360"
                    step="1"
                    type="number"
                    value={selectedSensor.fovDeg}
                    onChange={(event) => updateSensor(selectedSensor.id, { fovDeg: clampNumberInput(event, selectedSensor.fovDeg, 0, 360) })}
                  />
                </label>
                <label className="ws-field">
                  <span>range</span>
                  <input
                    aria-label="Sensor range"
                    min="0"
                    max="100"
                    step="0.5"
                    type="number"
                    value={selectedSensor.rangeM}
                    onChange={(event) => updateSensor(selectedSensor.id, { rangeM: clampNumberInput(event, selectedSensor.rangeM, 0, 100) })}
                  />
                </label>
              </div>
              <label className="ws-field">
                <span>resolution</span>
                <input
                  aria-label="Sensor resolution"
                  value={selectedSensor.resolution}
                  onChange={(event) => updateSensor(selectedSensor.id, { resolution: event.target.value })}
                />
              </label>
              <div className="ws-kv">
                <span>frustum</span>
                <b>
                  {selectedSensor.fovDeg.toFixed(0)}° · {selectedSensor.rangeM.toFixed(1)}m
                </b>
              </div>
              <div className="ws-btn-row">
                <WSButton
                  accent
                  disabled={!selectedSensor.enabled || !session}
                  onClick={captureSensorFrame}
                >
                  Capture Frame
                </WSButton>
                <WSButton
                  onClick={() =>
                    recordEpisodeEvent({
                      lane: "capture",
                      label: "sensor rig update",
                      targetId: selectedSensor.id,
                      status: `${selectedSensor.label} · ${selectedSensor.kind} · ${selectedSensor.fovDeg.toFixed(0)}° · ${selectedSensor.rangeM.toFixed(1)}m`
                    })
                  }
                >
                  Record Rig
                </WSButton>
              </div>
              <WSSliderRow label="Noise σ" value="0.000" pct={0} />
              <WSSliderRow label="Blur" value="off" pct={0} />
            </WSPanel>
          ) : null}
          <WSPanel
            title="Capture Artifact"
            meta={selectedSensorCaptures.length ? `${selectedSensorCaptures.length} records` : "no records"}
            className="ws-capture-artifacts"
            data-testid="sensor-capture-artifacts"
          >
            {latestSensorCapture ? (
              <>
                {latestSensorCapture.previewDataUrl ? (
                  <img alt="Latest sensor capture preview" className="ws-capture-preview" src={latestSensorCapture.previewDataUrl} />
                ) : (
                  <div className="ws-capture-missing">
                    <span className="ws-frame-thumb" />
                    <span className="ws-row-name">missing capture asset</span>
                  </div>
                )}
                <div className="ws-kv">
                  <span>sensor</span>
                  <b>{latestSensorCapture.sensorLabel} · {latestSensorCapture.sensorKind}</b>
                </div>
                <div className="ws-kv">
                  <span>event</span>
                  <b>{latestSensorCapture.eventId} · frame {latestSensorCapture.frame}</b>
                </div>
                <div className="ws-kv">
                  <span>source</span>
                  <b>{latestSensorCapture.rendererStatus}</b>
                </div>
                <div className="ws-kv">
                  <span>bytes</span>
                  <b>{latestSensorCapture.sizeBytes.toLocaleString()}</b>
                </div>
                <div className="ws-kv">
                  <span>asset</span>
                  <b>{latestSensorCapture.assetPath ?? "embedded"}</b>
                </div>
                <div className={`ws-kv ws-capture-asset-validation ${latestSensorCapture.assetStatus}`}>
                  <span>integrity</span>
                  <b>{formatSensorCaptureAssetStatus(latestSensorCapture)}</b>
                </div>
                <div className="ws-capture-list">
                  {selectedSensorCaptures.slice(0, 4).map((capture) => (
                    <div className="ws-capture-row" key={capture.id}>
                      <span>{String(capture.frame).padStart(3, "0")}</span>
                      <b>{capture.sensorLabel}</b>
                      <span>{capture.assetStatus}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="ws-capture-empty">
                <span className="ws-frame-thumb" />
                <span className="ws-row-name">no sensor captures yet</span>
              </div>
            )}
          </WSPanel>
        </>
      );
    }

    if (mode !== "view") return null;

    return (
      <div className="ws-row-stack">
        <WSPanel title="Provenance" meta={session?.provenance.packageKind ?? "none"}>
          {cleanedPlyImport ? (
            <>
              <div className="ws-kv ws-cleaned-ply-row" data-testid="cleaned-ply-source-row">
                <span>source type</span>
                <b>
                  <WSChip accent className="ws-source-chip">cleaned ordinary PLY</WSChip>
                </b>
              </div>
              <div className="ws-kv" data-testid="cleaned-ply-boundary-row">
                <span>boundary</span>
                <b>ordinary PLY only</b>
              </div>
            </>
          ) : null}
          <div className="ws-kv">
            <span>via</span>
            <b>{session?.provenance.loadedVia ?? "blank"}</b>
          </div>
          <div className="ws-kv">
            <span>path</span>
            <b title={session?.provenance.sourcePath}>{session ? compactPath(session.provenance.sourcePath) : "none"}</b>
          </div>
          <div className="ws-kv">
            <span>primary</span>
            <b>{session?.provenance.primaryArtifact ?? "none"}</b>
          </div>
          <div className="ws-kv">
            <span>status</span>
            <b>{session?.provenance.authorityStatus ?? "none"}</b>
          </div>
          <div className="ws-kv">
            <span>renderer</span>
            <b>{rendererStatusLabel(renderMode, rendererDiagnostics)}</b>
          </div>
          <div className="ws-kv">
            <span>ply source</span>
            <b>{rendererDiagnostics?.gaussianSourceFormat ?? "unknown"}</b>
          </div>
          <div className="ws-kv">
            <span>spark prep</span>
            <b>{rendererPreparationLabel(rendererDiagnostics)}</b>
          </div>
          {rendererDiagnostics?.sparkFailureReason ? (
            <div className="ws-kv">
              <span>fallback</span>
              <b>{rendererDiagnostics.sparkFailureReason}</b>
            </div>
          ) : null}
          <div className="ws-kv">
            <span>ui</span>
            <button className="ws-node click" onClick={() => setDense((value) => !value)}>
              {dense ? "dense" : "regular"}
            </button>
          </div>
          <div className="ws-kv">
            <span>panel</span>
            <button className="ws-node click" onClick={() => setDocked((value) => !value)}>
              {docked ? "docked" : "floating"}
            </button>
          </div>
          <div className="ws-kv">
            <span>accent</span>
            <button className="ws-node click" onClick={() => setAccentName(nextAccent(accentName))}>
              {accentName}
            </button>
          </div>
        </WSPanel>
        <PackageIssues issues={packageIssues} />
        <PackageInspector insights={packageInsights} selectedId={selectedInsightId} onSelect={setSelectedInsightId} />
        {activePackageInsight ? <PackageInsightDetail insight={activePackageInsight} /> : null}
      </div>
    );
  }
}

function createManifestOnlySession(input: LoadedWorldInput): WorldSession {
  return {
    id: `local-${input.name}`,
    name: input.name,
    units: input.scene?.units ?? "unknown",
    upAxis: input.scene?.up_axis ?? "unknown",
    pointCount: 0,
    classes: input.scene?.classes.map(sceneClassToWorldClass) ?? [],
    provenance: {
      sourceKind: input.sourceKind,
      packageKind: input.packageKind,
      loadedVia: input.loadedVia,
      sourcePath: input.sourcePath,
      primaryArtifact: input.primaryArtifact,
      companionArtifacts: input.companionArtifacts,
      assetManifest: input.assetManifest,
      loadedAt: new Date().toISOString(),
      authorityStatus: input.authorityStatus
    }
  };
}

function rendererStatusLabel(renderMode: RenderMode, diagnostics: RendererDiagnostics | null): string {
  if (renderMode === "points") return "three.js · ordinary PLY";
  if (renderMode === "mesh") return "three.js · OBJ mesh";
  if (renderMode === "semantic") return "three.js · semantic points";
  if (renderMode === "depth") return "three.js · depth points";

  if (!diagnostics?.hasGaussianSource) return "splat fallback · no gaussian";
  if (diagnostics.sparkState === "idle" || diagnostics.sparkState === "loading") return "spark loading · point fallback";
  if (diagnostics.splatRenderPath === "spark-gaussian") {
    return `spark gaussian · ${diagnostics.sparkProfile ?? "default"} · ${diagnostics.gaussianSplatCount ?? "ready"} splats`;
  }
  if (diagnostics.sparkState === "failed") return `splat fallback · ${diagnostics.sparkFailureReason ?? "spark failed"}`;
  return "splat fallback · not renderable";
}

function sparkProfileForLoadedWorld(input: LoadedWorldInput): SparkRenderProfile {
  if (input.packageKind === "capture-splat-local-folder" || input.sourceKind === "capture_splat.local_folder") {
    return "capture-splat-vksplat";
  }
  return "world-studio-default";
}

function rendererPreparationLabel(diagnostics: RendererDiagnostics | null): string {
  if (!diagnostics?.hasGaussianSource) return "none";
  if (diagnostics.gaussianPreparedForSpark === undefined) return "pending";
  const previewLimits: string[] = [];
  if (diagnostics.gaussianClampedScaleCount) previewLimits.push(`${diagnostics.gaussianClampedScaleCount} scales clamped`);
  if (diagnostics.gaussianDroppedOutlierCount) previewLimits.push(`${diagnostics.gaussianDroppedOutlierCount} outliers hidden`);
  if (diagnostics.gaussianNormalizedRotationCount) previewLimits.push(`${diagnostics.gaussianNormalizedRotationCount} rotations normalized`);
  if (previewLimits.length) {
    return `spark preview limited · ${previewLimits.join(" · ")} · native render evidence authoritative`;
  }
  return diagnostics.gaussianPreparedForSpark ? "converted" : "native";
}

function buildEditOptimizeStats(
  points: PointRecord[],
  deleted: ReadonlySet<number>,
  cropRegion: CropRegion | null,
  pointTransforms: ReadonlyMap<number, PointTransform>,
  format: PublishFormat,
  shDegree: number
): EditOptimizeStats {
  const exportPointCount = cleanedPointRows({ points, deleted, cropBounds: cropRegion?.bounds, pointTransforms }).length;
  const cropHiddenCount = Math.max(0, points.length - deleted.size - exportPointCount);
  return {
    totalPoints: points.length,
    exportPointCount,
    deletedCount: deleted.size,
    cropHiddenCount,
    movedCount: pointTransforms.size,
    shDegree,
    format,
    estimatedSizeBytes: estimateEditPublishBytes(exportPointCount, format, shDegree)
  };
}

function estimateEditPublishBytes(pointCount: number, format: PublishFormat, shDegree: number): number {
  const perPoint = format === "ply" ? 32 + shDegree * 10 : format === "splat" ? 48 + shDegree * 18 : 20 + shDegree * 6;
  const overhead = format === "ply" ? 1800 : format === "splat" ? 4096 : 8192;
  return Math.max(0, Math.round(overhead + pointCount * perPoint));
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function findOutlierIndices(
  points: PointRecord[],
  deleted: ReadonlySet<number>,
  cropRegion: CropRegion | null,
  pointTransforms: ReadonlyMap<number, PointTransform>
): number[] {
  const visible = cleanedPointRows({ points, deleted, cropBounds: cropRegion?.bounds, pointTransforms });
  if (visible.length < 50) return [];
  const center = visible.reduce(
    (sum, entry) => ({
      x: sum.x + entry.x,
      y: sum.y + entry.y,
      z: sum.z + entry.z
    }),
    { x: 0, y: 0, z: 0 }
  );
  center.x /= visible.length;
  center.y /= visible.length;
  center.z /= visible.length;
  const scored = visible
    .map((entry) => ({
      index: entry.index,
      distance: Math.hypot(entry.x - center.x, entry.y - center.y, entry.z - center.z)
    }))
    .sort((a, b) => a.distance - b.distance);
  const q1 = scored[Math.floor(scored.length * 0.25)]?.distance ?? 0;
  const q3 = scored[Math.floor(scored.length * 0.75)]?.distance ?? q1;
  const threshold = q3 + Math.max(0.15, 1.5 * (q3 - q1));
  const limit = Math.max(1, Math.min(512, Math.ceil(visible.length * 0.01)));
  const outliers = scored.filter((entry) => entry.distance > threshold).slice(-limit);
  const candidates = outliers.length ? outliers : scored.slice(-Math.max(1, Math.ceil(visible.length * 0.004)));
  return candidates.map((entry) => entry.index);
}

function buildEditPublishManifest({
  session,
  stats,
  density,
  exposure,
  rendererStatus,
  rendererDiagnostics,
  history
}: {
  session: WorldSession | null;
  stats: EditOptimizeStats;
  density: number;
  exposure: number;
  rendererStatus: string;
  rendererDiagnostics: RendererDiagnostics | null;
  history: HistoryItem[];
}) {
  return {
    schema: "world-studio.edit_publish.v0.1",
    createdAt: new Date().toISOString(),
    authorityStatus: "proposal",
    world: session
      ? {
          id: session.id,
          name: session.name,
          version: session.version ?? null,
          units: session.units,
          upAxis: session.upAxis,
          provenance: session.provenance
        }
      : null,
    edit: {
      totalPoints: stats.totalPoints,
      exportPointCount: stats.exportPointCount,
      deletedPoints: stats.deletedCount,
      cropHiddenPoints: stats.cropHiddenCount,
      movedPoints: stats.movedCount,
      shDegree: stats.shDegree,
      exposure,
      previewDensity: density
    },
    publish: {
      format: `.${stats.format}`,
      estimatedSizeBytes: stats.estimatedSizeBytes,
      estimatedSizeLabel: formatBytes(stats.estimatedSizeBytes),
      readiness: "manifest_preview",
      ordinaryPly:
        stats.format === "ply" && session
          ? {
              status: "available",
              suggestedName: cleanedPlyFileName(session),
              pointCount: stats.exportPointCount
            }
          : {
              status: "manifest_only",
              reason: "cleaned payload export is only implemented for ordinary .ply"
            },
      boundary: "proposal export manifest; cleaned ordinary PLY is separate from Gaussian/splat payloads"
    },
    renderer: {
      status: rendererStatus,
      sparkState: rendererDiagnostics?.sparkState ?? "unavailable",
      sparkProfile: rendererDiagnostics?.sparkProfile ?? null,
      splatRenderPath: rendererDiagnostics?.splatRenderPath ?? "point-fallback",
      hasGaussianSource: rendererDiagnostics?.hasGaussianSource ?? false,
      gaussianSplatCount: rendererDiagnostics?.gaussianSplatCount ?? null
    },
    operations: history.map((entry) => ({
      type: entry.type,
      count: entry.count,
      ...(entry.type === "transform" ? { delta: entry.delta } : {}),
      ...(entry.type === "optimize" ? { label: entry.label } : {})
    })),
    notes: [
      "This manifest records the Edit-mode cleanup proposal and publish settings.",
      "Use verified export manifests for human-verified semantic boundaries."
    ]
  };
}

function createPointCloudSession(input: LoadedWorldInput, pointCount: number, classes: WorldClass[]): WorldSession {
  return {
    id: `local-${input.name}`,
    name: input.name,
    units: "meters",
    upAxis: "y",
    pointCount,
    classes,
    provenance: {
      sourceKind: input.sourceKind,
      packageKind: input.packageKind,
      loadedVia: input.loadedVia,
      sourcePath: input.sourcePath,
      primaryArtifact: input.primaryArtifact,
      companionArtifacts: input.companionArtifacts,
      assetManifest: input.assetManifest,
      loadedAt: new Date().toISOString(),
      authorityStatus: input.authorityStatus
    }
  };
}

function buildFixtureInsights(scene: LoftSceneManifest): LocalPackageInsight[] {
  return [
    {
      id: "scene",
      kind: "scene-manifest",
      title: "Scene Manifest",
      artifact: "scene.json",
      summary: scene.dataset,
      metrics: [
        { label: "version", value: scene.version },
        { label: "classes", value: scene.classes.length },
        { label: "points", value: scene.points_total }
      ],
      details: [
        { label: "units", value: scene.units },
        { label: "up", value: scene.up_axis }
      ],
      sections: [
        {
          title: "Scene",
          rows: [
            { label: "dataset", value: scene.dataset },
            { label: "version", value: scene.version },
            { label: "units", value: scene.units },
            { label: "up", value: scene.up_axis }
          ]
        }
      ],
      previewText: JSON.stringify(scene, null, 2)
    },
    {
      id: "assets",
      kind: "asset-set",
      title: "Asset Set",
      artifact: "loft_04",
      summary: "Renderable fixture assets",
      metrics: [
        { label: "points", value: scene.files.points ?? "points.ply" },
        { label: "gaussian", value: scene.files.gaussians ?? "gaussians.ply" },
        { label: "mesh", value: scene.files.collision_mesh ?? "collision_mesh.obj" }
      ],
      details: [],
      sections: [
        {
          title: "Renderable Assets",
          rows: [
            { label: "points", value: scene.files.points ?? "points.ply" },
            { label: "gaussian", value: scene.files.gaussians ?? "gaussians.ply" },
            { label: "mesh", value: scene.files.collision_mesh ?? "collision_mesh.obj" }
          ]
        }
      ]
    }
  ];
}

function classesFromPointCloud(points: PointRecord[]): WorldClass[] {
  const labels = new Set<number>();
  for (const point of points) {
    if (point.semanticLabel !== undefined) labels.add(point.semanticLabel);
  }
  return [...labels]
    .sort((a, b) => a - b)
    .map((label, index) => ({
      label,
      name: `class ${label}`,
      colorFlat: fallbackClassColors[index % fallbackClassColors.length],
      points: points.filter((point) => point.semanticLabel === label).length
    }));
}

function centerFromWorldPoints(points: PointRecord[]): [number, number, number] {
  if (!points.length) return [0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxZ = Math.max(maxZ, point.z);
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return [0, 0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

function sceneClassToWorldClass(entry: LoftSceneManifest["classes"][number]): WorldClass {
  return {
    label: entry.label,
    name: entry.name,
    colorShaded: entry.color_shaded,
    colorFlat: entry.color_flat,
    points: entry.points
  };
}

function interpolateTrajectory(trajectory: Array<[number, number]>, t: number): AgentState {
  const first = trajectory[0];
  if (!first || trajectory.length < 2) {
    return { x: first?.[0] ?? 0, z: first?.[1] ?? 0, heading: 0 };
  }
  const fi = Math.min(trajectory.length - 1.001, Math.max(0, t) * (trajectory.length - 1));
  const index = Math.floor(fi);
  const u = fi - index;
  const a = trajectory[index] ?? first;
  const b = trajectory[index + 1] ?? a;
  return {
    x: a[0] + (b[0] - a[0]) * u,
    z: a[1] + (b[1] - a[1]) * u,
    heading: Math.atan2(b[1] - a[1], b[0] - a[0])
  };
}

function parseCaptureFrames(payload: LocalWorldPackagePayload): CaptureFrame[] {
  const text = payload.budoMediaFrames?.text;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { frames?: Array<{ camera?: unknown; frame_camera?: unknown; frameCamera?: unknown; display_name?: string; rgb_path?: string; preview_data_url?: string; previewDataUrl?: string; render_preview_data_url?: string; renderPreviewDataUrl?: string; intrinsics?: unknown; pose?: unknown; width?: unknown; height?: unknown }> };
    if (!Array.isArray(parsed.frames)) return [];
    return parsed.frames.map((frame, index) => ({
      camera: parseFrameCamera(frame.camera),
      frameCamera: parseSourceFrameCamera(frame),
      name: frame.display_name ?? `frame ${index + 1}`,
      path: frame.rgb_path ?? "",
      previewDataUrl: typeof frame.preview_data_url === "string" && frame.preview_data_url.startsWith("data:image/")
        ? frame.preview_data_url
        : typeof frame.previewDataUrl === "string" && frame.previewDataUrl.startsWith("data:image/")
          ? frame.previewDataUrl
          : undefined,
      renderPreviewDataUrl: typeof frame.render_preview_data_url === "string" && frame.render_preview_data_url.startsWith("data:image/")
        ? frame.render_preview_data_url
        : typeof frame.renderPreviewDataUrl === "string" && frame.renderPreviewDataUrl.startsWith("data:image/")
          ? frame.renderPreviewDataUrl
          : undefined
    }));
  } catch {
    return [];
  }
}

function parseFrameCamera(value: unknown): CameraState | undefined {
  if (!isRecord(value)) return undefined;
  return parseEpisodeCamera(value);
}

function parseSourceFrameCamera(frame: Record<string, unknown>): FrameCamera | undefined {
  const explicit = firstRecord(frame.frame_camera, frame.frameCamera);
  return parseFrameCameraRecord(explicit) ?? parseFrameCameraRecord(frame) ?? parseFrameCameraRecord(firstRecord(frame.camera));
}

function parseFrameCameraRecord(value: Record<string, unknown> | undefined): FrameCamera | undefined {
  if (!value) return undefined;
  const intrinsics = firstRecord(value.intrinsics) ?? value;
  const pose = firstRecord(value.pose) ?? value;
  const width = finiteNumber(firstValue(value.width, value.w, intrinsics.width, intrinsics.w), 1, 100000);
  const height = finiteNumber(firstValue(value.height, value.h, intrinsics.height, intrinsics.h), 1, 100000);
  const fx = finiteNumber(firstValue(value.fx, value.fl_x, intrinsics.fx, intrinsics.fl_x), 0.000001, 1000000);
  const fy = finiteNumber(firstValue(value.fy, value.fl_y, intrinsics.fy, intrinsics.fl_y), 0.000001, 1000000);
  const cx = finiteNumber(firstValue(value.cx, intrinsics.cx), -1000000, 1000000);
  const cy = finiteNumber(firstValue(value.cy, intrinsics.cy), -1000000, 1000000);
  const translation = finiteTuple(firstValue(value.translation, pose.translation, pose.t), 3, -1000000, 1000000);
  const rotation = finiteTuple(firstValue(value.rotation, pose.rotation, pose.qvec, pose.quaternion), 4, -2, 2);
  if (
    width === undefined ||
    height === undefined ||
    fx === undefined ||
    fy === undefined ||
    cx === undefined ||
    cy === undefined ||
    !translation ||
    !rotation
  ) {
    return undefined;
  }
  return {
    width,
    height,
    fx,
    fy,
    cx,
    cy,
    translation,
    rotation,
    coordinateFrame: optionalString(firstValue(value.coordinate_frame, value.coordinateFrame, pose.coordinate_frame, pose.coordinateFrame)) ?? undefined,
    authority: optionalString(firstValue(value.authority, pose.authority)) ?? undefined
  };
}

function parseEpisodeManifestText(text: string): ImportedEpisodeManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("malformed episode JSON");
  }
  return parseEpisodePayload(parsed);
}

function parseEpisodePayload(parsed: unknown): ImportedEpisodeManifest {
  let episode = parsed;
  const isBundle = isRecord(parsed) && parsed.schema === "world-studio.episode_bundle.v0.1";
  if (isRecord(parsed) && parsed.schema === "world-studio.episode_bundle.v0.1") {
    if (!isRecord(parsed.episodeManifest)) throw new Error("missing bundled episode");
    episode = parsed.episodeManifest;
  }
  if (!isRecord(episode) || episode.schema !== "world-studio.episode.v0.1") {
    throw new Error("unsupported episode schema");
  }

  const playback = isRecord(episode.playback) ? episode.playback : {};
  const events = readArray(episode.events, "events").map(parseEpisodeEvent);
  if (!events.length) throw new Error("episode has no events");

  const trajectory = Array.isArray(episode.agentTrajectory)
    ? episode.agentTrajectory.map(parseTrajectoryPoint).filter((point): point is [number, number] => Boolean(point))
    : [];
  const props = Array.isArray(episode.props) ? episode.props.map(parseEpisodeProp) : defaultProps;
  const sensors = Array.isArray(episode.sensors) ? episode.sensors.map(parseEpisodeSensor) : initialSensors;
  const sensorCaptures = Array.isArray(episode.sensorCaptures)
    ? episode.sensorCaptures.map(parseEpisodeSensorCapture)
    : [];
  const selectedEventId = typeof playback.selectedEventId === "string" ? playback.selectedEventId : null;
  const world = isRecord(episode.world) ? episode.world : null;
  const worldName = world && typeof world.name === "string" ? world.name : null;

  return {
    worldName,
    selectedEventId,
    playhead: clamp01(typeof playback.playhead === "number" ? playback.playhead : 0),
    events,
    trajectory: trajectory.length ? trajectory : [[defaultSpawn.x, defaultSpawn.z]],
    props,
    sensors,
    sensorCaptures,
    provenance: isBundle && isRecord(parsed)
      ? parseEpisodeBundleProvenance(parsed, worldName)
      : parseStandaloneEpisodeProvenance(episode, worldName)
  };
}

function parseEpisodeBundleProvenance(bundle: Record<string, unknown>, fallbackWorldName: string | null): EpisodeProvenanceSummary {
  const worldContext = isRecord(bundle.worldContext) ? bundle.worldContext : {};
  const packageInfo = isRecord(bundle.package) ? bundle.package : {};
  const renderer = isRecord(bundle.renderer) ? bundle.renderer : {};
  const compatibility = isRecord(bundle.compatibility) ? bundle.compatibility : {};
  const notes = Array.isArray(compatibility.notes) ? compatibility.notes.filter((note): note is string => typeof note === "string" && note.length > 0) : [];
  return {
    schema: "world-studio.episode_bundle.v0.1",
    source: "bundle",
    loadedFrom: "unknown",
    worldName: optionalString(worldContext.name) ?? fallbackWorldName ?? "unknown",
    packageKind: optionalString(packageInfo.kind) ?? "unknown",
    sourcePath: optionalString(packageInfo.sourcePath) ?? "not supplied",
    loadedVia: optionalString(packageInfo.loadedVia) ?? "not supplied",
    primaryArtifact: optionalString(packageInfo.primaryArtifact) ?? "not supplied",
    companionArtifacts: readStringList(packageInfo.companionArtifacts),
    assetManifest: readAssetManifest(packageInfo.assetManifest),
    authorityStatus: optionalString(packageInfo.authorityStatus) ?? "not supplied",
    rendererMode: optionalString(renderer.mode) ?? "not supplied",
    rendererStatus: optionalString(renderer.status) ?? "not supplied",
    notes: notes.length ? notes : ["No compatibility notes supplied."]
  };
}

function parseStandaloneEpisodeProvenance(episode: unknown, fallbackWorldName: string | null): EpisodeProvenanceSummary {
  const world = isRecord(episode) && isRecord(episode.world) ? episode.world : {};
  const provenance = isRecord(world.provenance) ? world.provenance : {};
  const notes = ["Standalone Episode manifest; world source assets are not embedded."];
  if (!isRecord(world.provenance)) notes.push("No package provenance supplied.");
  return {
    schema: "world-studio.episode.v0.1",
    source: "manifest",
    loadedFrom: "unknown",
    worldName: optionalString(world.name) ?? fallbackWorldName ?? "unknown",
    packageKind: optionalString(provenance.packageKind) ?? "not bundled",
    sourcePath: optionalString(provenance.sourcePath) ?? "not supplied",
    loadedVia: optionalString(provenance.loadedVia) ?? "not supplied",
    primaryArtifact: optionalString(provenance.primaryArtifact) ?? "not supplied",
    companionArtifacts: readStringList(provenance.companionArtifacts),
    assetManifest: readAssetManifest(provenance.assetManifest),
    authorityStatus: optionalString(provenance.authorityStatus) ?? "not supplied",
    rendererMode: "not bundled",
    rendererStatus: "not bundled",
    notes
  };
}

function describeEpisodeSourceMatch(provenance: EpisodeProvenanceSummary, session: WorldSession | null): EpisodeSourceMatch {
  if (provenance.source === "manifest") {
    return { status: "manifest", detail: "standalone episode; load matching world manually" };
  }

  if (!session) {
    return { status: "missing", detail: "load the source world package" };
  }

  const actual = session.provenance;
  const expectedKind = knownEpisodeValue(provenance.packageKind);
  const expectedPath = knownEpisodeValue(provenance.sourcePath);
  const expectedArtifact = knownEpisodeValue(provenance.primaryArtifact);
  const kindMatches = !expectedKind || actual.packageKind === expectedKind;
  const pathMatches = !expectedPath || actual.sourcePath === expectedPath;
  const artifactMatches = !expectedArtifact || actual.primaryArtifact === expectedArtifact;

  if (kindMatches && pathMatches && artifactMatches) {
    return { status: "matched", detail: `${session.name} · ${compactPath(actual.sourcePath)}` };
  }

  return {
    status: "mismatch",
    detail: `loaded ${actual.packageKind ?? "unknown"} · ${compactPath(actual.sourcePath)}`
  };
}

function describeEpisodeAssetValidation(provenance: EpisodeProvenanceSummary, session: WorldSession | null, sourceStatus: EpisodeSourceMatch["status"]): EpisodeAssetValidation {
  const expectedArtifacts = episodeExpectedArtifacts(provenance);
  if (provenance.source === "manifest") {
    return { status: "manifest", detail: "standalone episode; companion assets are not bundled" };
  }

  if (!expectedArtifacts.length) {
    return { status: "pending", detail: "no companion artifact list in bundle" };
  }

  if (!session || sourceStatus !== "matched") {
    return { status: "pending", detail: `${expectedArtifacts.length} relative assets waiting for matching source` };
  }

  const actualArtifacts = new Set([
    ...session.provenance.companionArtifacts,
    ...(session.provenance.assetManifest ?? []).map((entry) => entry.relativePath)
  ]);
  const missing = expectedArtifacts.filter((artifact) => !actualArtifacts.has(artifact));
  if (missing.length) {
    return {
      status: "missing",
      detail: `${missing.length}/${expectedArtifacts.length} missing: ${formatArtifactList(missing)}`
    };
  }

  const expectedManifest = provenance.assetManifest.filter(hasComparableAssetMetadata);
  if (!expectedManifest.length) {
    return {
      status: "validated",
      detail: `${expectedArtifacts.length}/${expectedArtifacts.length} relative asset names`
    };
  }

  const actualManifest = new Map((session.provenance.assetManifest ?? []).map((entry) => [entry.relativePath, entry]));
  if (!actualManifest.size) {
    return {
      status: "pending",
      detail: `${expectedArtifacts.length}/${expectedArtifacts.length} names found; no relink metadata`
    };
  }

  const mismatched = expectedManifest.filter((expected) => !assetMetadataMatches(expected, actualManifest.get(expected.relativePath)));
  if (mismatched.length) {
    return {
      status: "mismatch",
      detail: `${mismatched.length}/${expectedManifest.length} stale: ${formatArtifactList(mismatched.map((entry) => entry.relativePath))}`
    };
  }

  return {
    status: "validated",
    detail: `${expectedArtifacts.length}/${expectedArtifacts.length} names · ${expectedManifest.length} metadata checked`
  };
}

function buildEpisodeIntegrityRows(provenance: EpisodeProvenanceSummary, session: WorldSession | null, sourceStatus: EpisodeSourceMatch["status"]): EpisodeIntegrityRow[] {
  if (provenance.source === "manifest") return [];
  const expectedArtifacts = episodeExpectedArtifacts(provenance);
  if (!expectedArtifacts.length) return [];

  const expectedManifest = new Map(provenance.assetManifest.map((entry) => [entry.relativePath, entry]));
  const actualManifest = new Map((session?.provenance.assetManifest ?? []).map((entry) => [entry.relativePath, entry]));
  const actualArtifacts = new Set([
    ...(session?.provenance.companionArtifacts ?? []),
    ...actualManifest.keys()
  ]);

  return expectedArtifacts.map((path) => {
    const expected = expectedManifest.get(path);
    const actual = actualManifest.get(path);
    return {
      path,
      status: episodeIntegrityStatus(path, expected, actual, actualArtifacts, sourceStatus),
      expectedSize: formatAssetSize(expected?.sizeBytes),
      expectedChecksum: formatAssetChecksum(expected?.checksum),
      actualSize: formatAssetSize(actual?.sizeBytes, actualArtifacts.has(path)),
      actualChecksum: formatAssetChecksum(actual?.checksum, actualArtifacts.has(path))
    };
  });
}

function episodeIntegrityStatus(
  path: string,
  expected: WorldAssetManifestEntry | undefined,
  actual: WorldAssetManifestEntry | undefined,
  actualArtifacts: Set<string>,
  sourceStatus: EpisodeSourceMatch["status"]
): EpisodeIntegrityRow["status"] {
  if (sourceStatus !== "matched") return "pending";
  if (!actualArtifacts.has(path)) return "missing";
  if (expected && hasComparableAssetMetadata(expected)) {
    if (!actual) return "pending";
    return assetMetadataMatches(expected, actual) ? "validated" : "mismatch";
  }
  return "validated";
}

function formatAssetSize(value: number | undefined, artifactPresent = true): string {
  if (!artifactPresent) return "missing";
  return typeof value === "number" ? `${value} b` : "not supplied";
}

function formatAssetChecksum(value: string | undefined, artifactPresent = true): string {
  if (!artifactPresent) return "missing";
  return value ?? "not supplied";
}

function episodeExpectedArtifacts(provenance: EpisodeProvenanceSummary): string[] {
  return uniqueStrings([
    ...provenance.companionArtifacts,
    ...provenance.assetManifest.map((entry) => entry.relativePath),
    knownEpisodeValue(provenance.primaryArtifact)
  ]);
}

function hasComparableAssetMetadata(entry: WorldAssetManifestEntry): boolean {
  return typeof entry.sizeBytes === "number" || Boolean(entry.checksum);
}

function assetMetadataMatches(expected: WorldAssetManifestEntry, actual: WorldAssetManifestEntry | undefined): boolean {
  if (!actual) return false;
  if (typeof expected.sizeBytes === "number" && actual.sizeBytes !== expected.sizeBytes) return false;
  if (expected.checksum && actual.checksum !== expected.checksum) return false;
  return true;
}

function formatArtifactList(artifacts: string[]): string {
  const shown = artifacts.slice(0, 3).join(", ");
  return artifacts.length > 3 ? `${shown}, +${artifacts.length - 3} more` : shown;
}

function knownEpisodeValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "unknown" || trimmed === "not supplied" || trimmed === "not bundled") return null;
  return trimmed;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)) : [];
}

function readAssetManifest(value: unknown): WorldAssetManifestEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const relativePath = optionalString(entry.relativePath);
    if (!relativePath) return [];
    const sizeBytes = typeof entry.sizeBytes === "number" && Number.isFinite(entry.sizeBytes) && entry.sizeBytes >= 0 ? entry.sizeBytes : undefined;
    const checksum = optionalString(entry.checksum) ?? undefined;
    return [{
      relativePath,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(checksum ? { checksum } : {})
    }];
  });
}

function buildTextAssetManifest(files: Array<{ relativePath: string; text: string }>): WorldAssetManifestEntry[] {
  return files.map((file) => {
    const bytes = new TextEncoder().encode(file.text);
    return {
      relativePath: file.relativePath,
      sizeBytes: bytes.byteLength,
      checksum: checksumBytes(bytes)
    };
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

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return new Uint8Array();
  const payload = dataUrl.slice(comma + 1);
  const binary = dataUrl.includes(";base64,") ? window.atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const [, payload = ""] = dataUrl.split(",", 2);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function checksumDataUrl(dataUrl: string): string {
  return checksumBytes(dataUrlToBytes(dataUrl));
}

function sensorCaptureAssetPath(frame: number, sensorId: string): string {
  return `captures/event-${String(frame).padStart(4, "0")}-${safePathPart(sensorId)}.png`;
}

function safePathPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "sensor";
}

function sensorCaptureBundleAssets(captures: SensorCaptureArtifact[]): EpisodeBundleAsset[] {
  return captures.flatMap((capture) => {
    if (!capture.previewDataUrl || !capture.assetPath) return [];
    return [{
      relativePath: capture.assetPath,
      dataUrl: capture.previewDataUrl,
      mimeType: capture.mimeType,
      sizeBytes: capture.sizeBytes,
      checksum: capture.checksum
    }];
  });
}

function sensorCaptureAssetStatus({
  assetPath,
  assetStatus,
  checksum,
  previewDataUrl,
  sizeBytes
}: {
  assetPath?: string;
  assetStatus?: string;
  checksum?: string;
  previewDataUrl: string;
  sizeBytes: number;
}): SensorCaptureArtifact["assetStatus"] {
  if (!previewDataUrl) return assetPath ? "missing" : "missing";
  const actualSize = estimateDataUrlBytes(previewDataUrl);
  if (sizeBytes > 0 && actualSize !== sizeBytes) return "metadata_mismatch";
  if (checksum && checksumDataUrl(previewDataUrl) !== checksum) return "metadata_mismatch";
  if (assetPath && assetStatus === "external") return "resolved";
  return "embedded";
}

function describeSensorCaptureAssetValidation(captures: SensorCaptureArtifact[]): { status: string; detail: string } | null {
  if (!captures.length) return null;
  const external = captures.filter((capture) => capture.assetPath);
  const missing = captures.filter((capture) => capture.assetStatus === "missing");
  const mismatched = captures.filter((capture) => capture.assetStatus === "metadata_mismatch");
  if (mismatched.length) return { status: "mismatch", detail: `${mismatched.length}/${captures.length} checksum or size mismatch` };
  if (missing.length) return { status: "missing", detail: `${missing.length}/${captures.length} companion PNG missing` };
  if (external.length) return { status: "validated", detail: `${external.length}/${external.length} capture assets resolved` };
  return { status: "embedded", detail: `${captures.length} embedded previews` };
}

function formatSensorCaptureAssetStatus(capture: SensorCaptureArtifact): string {
  if (capture.assetStatus === "metadata_mismatch") return "metadata mismatch";
  if (capture.assetStatus === "missing") return "missing asset";
  if (capture.assetStatus === "resolved") return `${capture.assetPath ?? "asset"} · resolved`;
  if (capture.assetStatus === "external") return `${capture.assetPath ?? "asset"} · external`;
  return `${capture.assetPath ?? "embedded"} · ready`;
}

function formatCaptureCamera(camera: CameraState): string {
  return `yaw ${camera.yaw.toFixed(2)} · pitch ${camera.pitch.toFixed(2)} · fov ${camera.fov.toFixed(0)}°`;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function parseEpisodeEvent(value: unknown, index: number): EpisodeEvent {
  if (!isRecord(value)) throw new Error(`invalid event ${index + 1}`);
  const frame = readFiniteNumber(value.frame, `event ${index + 1} frame`);
  const lane = parseEpisodeLane(value.lane, index);
  return {
    id: typeof value.id === "string" && value.id ? value.id : `event-${frame}`,
    frame,
    lane,
    label: typeof value.label === "string" && value.label ? value.label : lane,
    targetId: typeof value.targetId === "string" ? value.targetId : undefined,
    status: typeof value.status === "string" ? value.status : undefined
  };
}

function parseEpisodeProp(value: unknown, index: number): SimulatedPropState {
  if (!isRecord(value)) throw new Error(`invalid prop ${index + 1}`);
  const preset = value.preset === "tall-crate" ? "tall-crate" : "crate";
  const contactState =
    value.contactState === "airborne" || value.contactState === "sleeping" || value.contactState === "grounded"
      ? value.contactState
      : "grounded";
  return {
    id: typeof value.id === "string" && value.id ? value.id : `prop-${index + 1}`,
    label: typeof value.label === "string" && value.label ? value.label : `${preset}_${index + 1}`,
    preset,
    contactState,
    x: readFiniteNumber(value.x, `prop ${index + 1} x`),
    y: readFiniteNumber(value.y, `prop ${index + 1} y`),
    z: readFiniteNumber(value.z, `prop ${index + 1} z`),
    footprintRadius: readFiniteNumber(value.footprintRadius, `prop ${index + 1} radius`)
  };
}

function parseEpisodeSensor(value: unknown, index: number): SensorRigChannel {
  if (!isRecord(value)) throw new Error(`invalid sensor ${index + 1}`);
  const fallback = initialSensors[index] ?? initialSensors[0]!;
  return {
    id: typeof value.id === "string" && value.id ? value.id : fallback.id,
    label: typeof value.label === "string" && value.label ? value.label : fallback.label,
    kind: parseSensorKind(value.kind, fallback.kind),
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    spec: typeof value.spec === "string" ? value.spec : fallback.spec,
    fovDeg: readOptionalFiniteNumber(value.fovDeg, fallback.fovDeg, 0, 360),
    rangeM: readOptionalFiniteNumber(value.rangeM, fallback.rangeM, 0, 100),
    resolution: typeof value.resolution === "string" && value.resolution ? value.resolution : fallback.resolution
  };
}

function parseEpisodeSensorCapture(value: unknown, index: number): SensorCaptureArtifact {
  if (!isRecord(value)) throw new Error(`invalid sensor capture ${index + 1}`);
  const fallback = initialSensors.find((sensor) => sensor.id === value.sensorId) ?? initialSensors[index] ?? initialSensors[0]!;
  const previewDataUrl = typeof value.previewDataUrl === "string" && value.previewDataUrl.startsWith("data:image/")
    ? value.previewDataUrl
    : "";
  const assetPath = typeof value.assetPath === "string" && value.assetPath ? value.assetPath : undefined;
  if (!previewDataUrl && !assetPath) throw new Error(`invalid sensor capture ${index + 1} preview`);
  const size = isRecord(value.size) ? value.size : {};
  const renderMode = isRenderMode(value.renderMode) ? value.renderMode : "splat";
  const sizeBytes = readOptionalFiniteNumber(
    value.sizeBytes,
    readOptionalFiniteNumber(value.bytes, estimateDataUrlBytes(previewDataUrl), 0, 100_000_000),
    0,
    100_000_000
  );
  const checksum = typeof value.checksum === "string" && value.checksum ? value.checksum : (previewDataUrl ? checksumDataUrl(previewDataUrl) : "");
  const assetStatus = sensorCaptureAssetStatus({
    assetPath,
    assetStatus: typeof value.assetStatus === "string" ? value.assetStatus : undefined,
    checksum,
    previewDataUrl,
    sizeBytes
  });
  return {
    id: typeof value.id === "string" && value.id ? value.id : `sensor-capture-${index + 1}`,
    eventId: typeof value.eventId === "string" && value.eventId ? value.eventId : `event-${index + 1}`,
    frame: readOptionalFiniteNumber(value.frame, index + 1, 0, 1_000_000),
    sensorId: typeof value.sensorId === "string" && value.sensorId ? value.sensorId : fallback.id,
    sensorLabel: typeof value.sensorLabel === "string" && value.sensorLabel ? value.sensorLabel : fallback.label,
    sensorKind: parseSensorKind(value.sensorKind, fallback.kind),
    sensorSpec: typeof value.sensorSpec === "string" ? value.sensorSpec : fallback.spec,
    capturedAt: typeof value.capturedAt === "string" && value.capturedAt ? value.capturedAt : new Date(0).toISOString(),
    previewDataUrl,
    assetPath,
    assetStatus,
    mimeType: "image/png",
    renderMode,
    rendererStatus: typeof value.rendererStatus === "string" ? value.rendererStatus : "unknown",
    worldName: typeof value.worldName === "string" ? value.worldName : "unknown",
    sourcePath: typeof value.sourcePath === "string" ? value.sourcePath : "unknown",
    loadedVia: typeof value.loadedVia === "string" ? value.loadedVia : "unknown",
    camera: parseEpisodeCamera(value.camera),
    size: {
      width: readOptionalFiniteNumber(size.width, 0, 0, 10000),
      height: readOptionalFiniteNumber(size.height, 0, 0, 10000)
    },
    bytes: readOptionalFiniteNumber(value.bytes, sizeBytes, 0, 100_000_000),
    sizeBytes,
    checksum
  };
}

function parseEpisodeCamera(value: unknown): CameraState {
  if (!isRecord(value)) return initialCamera;
  const target = Array.isArray(value.target) ? value.target : [];
  return {
    yaw: readOptionalFiniteNumber(value.yaw, initialCamera.yaw, -360, 360),
    pitch: readOptionalFiniteNumber(value.pitch, initialCamera.pitch, -360, 360),
    distance: readOptionalFiniteNumber(value.distance, initialCamera.distance, 0, 1000),
    target: [
      readOptionalFiniteNumber(target[0], initialCamera.target[0], -1000, 1000),
      readOptionalFiniteNumber(target[1], initialCamera.target[1], -1000, 1000),
      readOptionalFiniteNumber(target[2], initialCamera.target[2], -1000, 1000)
    ],
    fov: readOptionalFiniteNumber(value.fov, initialCamera.fov, 1, 179)
  };
}

function parseTrajectoryPoint(value: unknown): [number, number] | null {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.z !== "number") return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.z)) return null;
  return [value.x, value.z];
}

function parseEpisodeLane(value: unknown, index: number): EpisodeLane {
  if (value === "agent" || value === "object" || value === "capture") return value;
  throw new Error(`invalid event ${index + 1} lane`);
}

function parseSensorKind(value: unknown, fallback: SensorRigChannel["kind"]): SensorRigChannel["kind"] {
  if (value === "rgb" || value === "depth" || value === "segmentation" || value === "lidar" || value === "imu") return value;
  return fallback;
}

function isRenderMode(value: unknown): value is RenderMode {
  return value === "splat" || value === "points" || value === "mesh" || value === "semantic" || value === "depth";
}

function clampNumberInput(event: ChangeEvent<HTMLInputElement>, fallback: number, min: number, max: number): number {
  const value = Number(event.target.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`missing ${label}`);
  return value;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${label}`);
  return value;
}

function readOptionalFiniteNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function finiteNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function finiteTuple(value: unknown, length: 3, min: number, max: number): [number, number, number] | undefined;
function finiteTuple(value: unknown, length: 4, min: number, max: number): [number, number, number, number] | undefined;
function finiteTuple(value: unknown, length: number, min: number, max: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== length) return undefined;
  const numbers = value.map((item) => finiteNumber(item, min, max));
  return numbers.every((item) => item !== undefined) ? numbers as number[] : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function buildEpisodeManifest({
  session,
  events,
  selectedEventId,
  playhead,
  trajectory,
  props,
  sensors,
  sensorCaptures,
  includeCapturePreviews
}: {
  session: WorldSession | null;
  events: EpisodeEvent[];
  selectedEventId: string | null;
  playhead: number;
  trajectory: Array<[number, number]>;
  props: SimulatedPropState[];
  sensors: SensorRigChannel[];
  sensorCaptures: SensorCaptureArtifact[];
  includeCapturePreviews: boolean;
}) {
  return {
    schema: "world-studio.episode.v0.1",
    createdAt: new Date().toISOString(),
    world: session
      ? {
          id: session.id,
          name: session.name,
          version: session.version ?? null,
          units: session.units,
          upAxis: session.upAxis,
          provenance: session.provenance
        }
      : null,
    playback: {
      playhead,
      selectedEventId,
      eventCount: events.length
    },
    events: events.map((event) => ({
      id: event.id,
      frame: event.frame,
      lane: event.lane,
      label: event.label,
      targetId: event.targetId ?? null,
      status: event.status ?? null
    })),
    agentTrajectory: trajectory.map(([x, z], index) => ({ frame: index, x, z })),
    props: props.map((prop) => ({
      id: prop.id,
      label: prop.label,
      preset: prop.preset,
      contactState: prop.contactState,
      x: prop.x,
      y: prop.y,
      z: prop.z,
      footprintRadius: prop.footprintRadius
    })),
    sensors: sensors.map((sensor) => ({
      id: sensor.id,
      label: sensor.label,
      kind: sensor.kind,
      enabled: sensor.enabled,
      spec: sensor.spec,
      fovDeg: sensor.fovDeg,
      rangeM: sensor.rangeM,
      resolution: sensor.resolution
    })),
    sensorCaptures: sensorCaptures.map((capture) => {
      const serialized = {
        id: capture.id,
        eventId: capture.eventId,
        frame: capture.frame,
        sensorId: capture.sensorId,
        sensorLabel: capture.sensorLabel,
        sensorKind: capture.sensorKind,
        sensorSpec: capture.sensorSpec,
        capturedAt: capture.capturedAt,
        assetPath: capture.assetPath ?? null,
        assetStatus: includeCapturePreviews ? capture.assetStatus : "external",
        mimeType: capture.mimeType,
        renderMode: capture.renderMode,
        rendererStatus: capture.rendererStatus,
        worldName: capture.worldName,
        sourcePath: capture.sourcePath,
        loadedVia: capture.loadedVia,
        camera: capture.camera,
        size: capture.size,
        bytes: capture.bytes,
        sizeBytes: capture.sizeBytes,
        checksum: capture.checksum
      };
      return includeCapturePreviews ? { ...serialized, previewDataUrl: capture.previewDataUrl } : serialized;
    })
  };
}

function buildSensorCaptureManifest({
  session,
  captures,
  events
}: {
  session: WorldSession | null;
  captures: SensorCaptureArtifact[];
  events: EpisodeEvent[];
}) {
  const eventById = new Map(events.map((event) => [event.id, event]));
  return {
    schema: "world-studio.sensor_capture_manifest.v0.1",
    createdAt: new Date().toISOString(),
    world: session
      ? {
          id: session.id,
          name: session.name,
          version: session.version ?? null,
          units: session.units,
          upAxis: session.upAxis,
          provenance: session.provenance
        }
      : null,
    selection: {
      captureCount: captures.length,
      frames: captures.map((capture) => capture.frame),
      eventIds: captures.map((capture) => capture.eventId)
    },
    captures: captures.map((capture) => {
      const event = eventById.get(capture.eventId);
      return {
        id: capture.id,
        eventId: capture.eventId,
        eventLabel: event?.label ?? null,
        eventStatus: event?.status ?? null,
        frame: capture.frame,
        sensor: {
          id: capture.sensorId,
          label: capture.sensorLabel,
          kind: capture.sensorKind,
          spec: capture.sensorSpec
        },
        capturedAt: capture.capturedAt,
        renderMode: capture.renderMode,
        rendererStatus: capture.rendererStatus,
        asset: {
          path: capture.assetPath ?? null,
          status: capture.assetStatus,
          mimeType: capture.mimeType,
          sizeBytes: capture.sizeBytes,
          checksum: capture.checksum
        },
        image: capture.size,
        camera: capture.camera,
        provenance: {
          worldName: capture.worldName,
          sourcePath: capture.sourcePath,
          loadedVia: capture.loadedVia
        }
      };
    }),
    notes: ["Capture previews are not embedded; use asset.path plus checksum/size for relink validation."]
  };
}

function buildEpisodeBundle({
  episodeManifest,
  session,
  renderMode,
  rendererStatus,
  rendererDiagnostics
}: {
  episodeManifest: ReturnType<typeof buildEpisodeManifest>;
  session: WorldSession | null;
  renderMode: RenderMode;
  rendererStatus: string;
  rendererDiagnostics: RendererDiagnostics | null;
}) {
  const provenance = session?.provenance ?? null;
  return {
    schema: "world-studio.episode_bundle.v0.1",
    createdAt: new Date().toISOString(),
    episodeManifest,
    worldContext: session
      ? {
          id: session.id,
          name: session.name,
          version: session.version ?? null,
          units: session.units,
          upAxis: session.upAxis,
          pointCount: session.pointCount ?? null,
          bounds: session.bounds ?? null
        }
      : null,
    package: provenance
      ? {
          kind: provenance.packageKind ?? "unknown",
          sourceKind: provenance.sourceKind,
          sourcePath: provenance.sourcePath,
          loadedVia: provenance.loadedVia,
          primaryArtifact: provenance.primaryArtifact,
          companionArtifacts: provenance.companionArtifacts,
          assetManifest: provenance.assetManifest ?? [],
          authorityStatus: provenance.authorityStatus
        }
      : null,
    renderer: {
      mode: renderMode,
      status: rendererStatus,
      sparkState: rendererDiagnostics?.sparkState ?? "unavailable",
      splatRenderPath: rendererDiagnostics?.splatRenderPath ?? "point-fallback",
      hasGaussianSource: rendererDiagnostics?.hasGaussianSource ?? false,
      gaussianSplatCount: rendererDiagnostics?.gaussianSplatCount ?? null
    },
    compatibility: {
      notes: episodeBundleCompatibilityNotes(session, rendererDiagnostics)
    }
  };
}

function episodeBundleCompatibilityNotes(session: WorldSession | null, diagnostics: RendererDiagnostics | null): string[] {
  const notes = ["Episode state is embedded; world source assets remain external."];
  const provenance = session?.provenance;
  if (!provenance) {
    notes.push("No loaded world provenance is attached to this bundle.");
    return notes;
  }
  if (provenance.loadedVia === "electron-picker") {
    notes.push("Local package assets are referenced by filesystem path and are not embedded.");
  }
  if (provenance.packageKind === "fixture") {
    notes.push("Fixture assets are referenced by app fixture path and are not embedded.");
  }
  if (!diagnostics?.hasGaussianSource) {
    notes.push("No Gaussian source is available for splat replay.");
  } else if (diagnostics.splatRenderPath !== "spark-gaussian") {
    notes.push("Splat replay may use point fallback unless the Gaussian source is available and Spark-ready.");
  }
  return notes;
}

function episodeFileName(session: WorldSession | null): string {
  const name = session?.name ?? "untitled";
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  return `world-studio-episode-${safeName}.json`;
}

function episodeBundleFileName(session: WorldSession | null): string {
  const name = session?.name ?? "untitled";
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  return `world-studio-episode-${safeName}.world-episode.json`;
}

function editPublishFileName(session: WorldSession, format: PublishFormat): string {
  const safeName = safePathPart(session.name);
  return `world-studio-edit-publish-${safeName}-${format}.json`;
}

function cleanedPlyFileName(session: WorldSession): string {
  const safeName = safePathPart(session.name);
  return `world-studio-cleaned-${safeName}.ply`;
}

function sensorCaptureManifestFileName(session: WorldSession | null): string {
  const name = session?.name ?? "untitled";
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  return `world-studio-captures-${safeName}.sensor-captures.json`;
}

function downloadTextFile(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function compactPath(value: string): string {
  if (value.length <= 42) return value;
  return `...${value.slice(-39)}`;
}

function getDesktopApi() {
  return window.worldStudioDesktop;
}

function PackageIssues({ issues }: { issues: LocalPackageIssue[] }) {
  if (!issues.length) return null;
  return (
    <WSPanel title="Package Issues" meta={`${issues.length} findings`} className="ws-issue-panel">
      <div className="ws-issue-list">
        {issues.map((issue) => (
          <div className={`ws-issue-row ${issue.severity}`} key={issue.id}>
            <div className="ws-insight-head">
              <span>{issue.title}</span>
              <b>{issue.severity}</b>
            </div>
            <div className="ws-insight-summary">{issue.message}</div>
            <div className="ws-kv">
              <span>code</span>
              <b>{issue.code}</b>
            </div>
            {issue.artifact ? (
              <div className="ws-kv">
                <span>artifact</span>
                <b>{issue.artifact}</b>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </WSPanel>
  );
}

function PackageInspector({
  insights,
  selectedId,
  onSelect
}: {
  insights: LocalPackageInsight[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <WSPanel title="Package Inspector" meta={`${insights.length} records`}>
      {insights.length ? (
        <div className="ws-insight-list">
          {insights.map((insight) => (
            <button
              aria-label={`Open ${insight.title} detail`}
              aria-pressed={selectedId === insight.id}
              className={`ws-insight-row ${selectedId === insight.id ? "active" : ""}`}
              key={insight.id}
              onClick={() => onSelect(insight.id)}
              type="button"
            >
              <div className="ws-insight-head">
                <span>{insight.title}</span>
                <b>{insight.kind}</b>
              </div>
              <div className="ws-insight-summary">{insight.summary}</div>
              <div className="ws-kv">
                <span>artifact</span>
                <b>{insight.artifact}</b>
              </div>
              {insight.status ? (
                <div className="ws-kv">
                  <span>status</span>
                  <b>{insight.status}</b>
                </div>
              ) : null}
              {insight.metrics.slice(0, 3).map((metric) => (
                <div className="ws-kv" key={`${insight.id}-metric-${metric.label}`}>
                  <span>{metric.label}</span>
                  <b>{metric.value}</b>
                </div>
              ))}
              {insight.details.slice(0, 2).map((detail) => (
                <div className="ws-kv" key={`${insight.id}-detail-${detail.label}`}>
                  <span>{detail.label}</span>
                  <b>{detail.value}</b>
                </div>
              ))}
            </button>
          ))}
        </div>
      ) : (
        <div className="ws-kv">
          <span>records</span>
          <b>none</b>
        </div>
      )}
    </WSPanel>
  );
}

function PackageInsightDetail({ insight }: { insight: LocalPackageInsight | null }) {
  return (
    <WSPanel title="Inspector Detail" meta={insight?.kind ?? "none"} className="ws-detail-panel">
      {insight ? (
        <div className="ws-detail-body">
          <div className="ws-insight-head">
            <span>{insight.title}</span>
            <b>{insight.artifact}</b>
          </div>
          <div className="ws-insight-summary">{insight.summary}</div>
          {insight.status ? (
            <div className="ws-kv">
              <span>status</span>
              <b>{insight.status}</b>
            </div>
          ) : null}
          {[...(insight.metrics ?? []), ...(insight.details ?? [])].map((row) => (
            <div className="ws-kv" key={`${insight.id}-detail-row-${row.label}`}>
              <span>{row.label}</span>
              <b>{row.value}</b>
            </div>
          ))}
          {insight.sections?.map((section) => (
            <div className="ws-detail-section" key={`${insight.id}-section-${section.title}`}>
              <div className="ws-detail-section-title">{section.title}</div>
              {section.rows.length ? (
                section.rows.map((row) => (
                  <div className="ws-kv" key={`${insight.id}-${section.title}-${row.label}`}>
                    <span>{row.label}</span>
                    <b>{row.value}</b>
                  </div>
                ))
              ) : (
                <div className="ws-kv">
                  <span>rows</span>
                  <b>none</b>
                </div>
              )}
              {section.previewText ? <pre className="ws-detail-preview">{section.previewText}</pre> : null}
            </div>
          ))}
          {insight.previewText ? (
            <div className="ws-detail-section">
              <div className="ws-detail-section-title">JSON Preview</div>
              <pre className="ws-detail-preview">{insight.previewText}</pre>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ws-kv">
          <span>detail</span>
          <b>none</b>
        </div>
      )}
    </WSPanel>
  );
}

function ModeCard({
  mode,
  renderMode,
  session,
  assetSummary,
  playhead
}: {
  mode: StudioMode;
  renderMode: RenderMode;
  session: WorldSession | null;
  assetSummary: AssetSummary | null;
  playhead: number;
}) {
  const title = modes.find((entry) => entry.id === mode)?.label ?? mode;
  return (
    <div className="ws-row-stack">
      <div className="ws-mode-title-row">
        <div className="ws-mode-title">{title}</div>
        <WSChip accent={Boolean(session)}>{session ? "live" : "blank"}</WSChip>
      </div>
      {renderMode === "depth" ? <WSRamp from={0} to={0.978} label="magma" /> : null}
      <div className="ws-kv">
        <span>points</span>
        <b>{assetSummary?.pointCount ?? session?.pointCount ?? 0}</b>
      </div>
      <div className="ws-kv">
        <span>gaussian</span>
        <b>{assetSummary?.gaussianKind ?? "unloaded"}</b>
      </div>
      <div className="ws-kv">
        <span>mesh</span>
        <b>{assetSummary ? `${assetSummary.objFaces} faces · ${assetSummary.objGroups} groups` : "unloaded"}</b>
      </div>
      {mode === "episode" ? (
        <div className="ws-progress">
          <div style={{ width: `${Math.round(playhead * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function ToolRail({ tool, onSelect }: { tool: string; onSelect: (tool: string) => void }) {
  return (
    <div className="ws-rail">
      {editTools.map((entry) => (
        <button
          className={`ws-rail-btn ${entry.id === tool ? "on" : ""}`}
          key={entry.id}
          title={entry.title}
          onClick={() => onSelect(entry.id)}
        >
          <WSIcon name={entry.icon} />
        </button>
      ))}
    </div>
  );
}

function PilotPropPanel({
  props,
  preset,
  selectedProp,
  onPresetChange,
  onSpawn,
  onSelect,
  onDuplicate,
  onResetSelected,
  onDelete,
  onResetAll,
  onNudge
}: {
  props: SimulatedPropState[];
  preset: SimulatedPropPreset;
  selectedProp: SimulatedPropState | null;
  onPresetChange: (preset: SimulatedPropPreset) => void;
  onSpawn: (preset: SimulatedPropPreset) => void;
  onSelect: (id: string) => void;
  onDuplicate: () => void;
  onResetSelected: () => void;
  onDelete: () => void;
  onResetAll: () => void;
  onNudge: (dx: number, dz: number) => void;
}) {
  return (
    <WSPanel title="Props" meta={`${props.length} bodies`} className="ws-prop-panel">
      <div className="ws-row-stack" data-testid="pilot-prop-panel">
        <div className="ws-btn-row">
          {(["crate", "tall-crate"] as SimulatedPropPreset[]).map((entry) => (
            <WSButton accent={preset === entry} key={entry} onClick={() => onPresetChange(entry)}>
              {entry === "crate" ? "Crate" : "Tall"}
            </WSButton>
          ))}
        </div>
        <div className="ws-btn-row">
          <WSButton accent onClick={() => onSpawn(preset)}>
            Spawn Prop
          </WSButton>
          <WSButton onClick={onResetAll}>Reset Props</WSButton>
        </div>
        <div className="ws-kv" data-testid="pilot-prop-count">
          <span>props</span>
          <b>{props.length} bodies</b>
        </div>
        <div className="ws-prop-list" data-testid="pilot-prop-list">
          {props.length ? (
            props.slice(-6).map((prop) => (
              <button
                aria-label={`Select prop ${prop.label}`}
                aria-pressed={selectedProp?.id === prop.id}
                className={`ws-prop-row ${prop.contactState}`}
                key={prop.id}
                onClick={() => onSelect(prop.id)}
                type="button"
              >
                <span>{prop.label}</span>
                <b>{prop.contactState}</b>
              </button>
            ))
          ) : (
            <div className="ws-kv">
              <span>list</span>
              <b>none</b>
            </div>
          )}
        </div>
        {selectedProp ? (
          <div className="ws-prop-inspector" data-testid="selected-prop-inspector">
            <div className="ws-insight-head">
              <span>{selectedProp.label}</span>
              <b>{selectedProp.preset}</b>
            </div>
            <div className="ws-kv">
              <span>pose</span>
              <b data-testid="selected-prop-pose">
                {selectedProp.x.toFixed(2)} · {selectedProp.y.toFixed(2)} · {selectedProp.z.toFixed(2)}
              </b>
            </div>
            <div className="ws-kv">
              <span>contact</span>
              <b>{selectedProp.contactState}</b>
            </div>
            <div className="ws-btn-row ws-prop-actions">
              <WSButton onClick={onDuplicate}>Duplicate</WSButton>
              <WSButton onClick={onResetSelected}>Reset Selected</WSButton>
              <WSButton onClick={onDelete}>Delete Selected</WSButton>
            </div>
            <div className="ws-prop-nudge" data-testid="selected-prop-nudge">
              <WSButton aria-label="Nudge selected prop west" onClick={() => onNudge(-0.12, 0)}>
                -X
              </WSButton>
              <WSButton aria-label="Nudge selected prop east" onClick={() => onNudge(0.12, 0)}>
                +X
              </WSButton>
              <WSButton aria-label="Nudge selected prop north" onClick={() => onNudge(0, -0.12)}>
                -Z
              </WSButton>
              <WSButton aria-label="Nudge selected prop south" onClick={() => onNudge(0, 0.12)}>
                +Z
              </WSButton>
            </div>
          </div>
        ) : null}
      </div>
    </WSPanel>
  );
}

function driveCommandForKey(key: string): DriveCommand {
  if (key === "w") return { move: 1, turn: 0 };
  if (key === "s") return { move: -1, turn: 0 };
  if (key === "a") return { move: 0, turn: -1 };
  return { move: 0, turn: 1 };
}

function driveActionLabel(key: string): string {
  if (key === "w") return "MoveAhead(0.12)";
  if (key === "s") return "MoveBack(0.12)";
  if (key === "a") return "Rotate(-9deg)";
  return "Rotate(+9deg)";
}

function buildSpawnChoices(session: WorldSession | null): SpawnChoice[] {
  const scene = session?.agentSpawn ?? defaultSpawn;
  return [
    { id: "scene", label: "Scene", agent: scene },
    { id: "origin", label: "Origin", agent: { x: 0, z: 0, heading: 0 } },
    { id: "window", label: "Window", agent: { x: -1.8, z: 1.3, heading: -0.65 } },
    { id: "shelf", label: "Shelf", agent: { x: 2.0, z: 1.4, heading: 2.8 } }
  ];
}

function samePose(a: AgentState, b: AgentState): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.z - b.z) < 0.001 && Math.abs(a.heading - b.heading) < 0.001;
}

function nextAccent(current: keyof typeof accents): keyof typeof accents {
  const keys = Object.keys(accents) as Array<keyof typeof accents>;
  const index = keys.indexOf(current);
  return keys[(index + 1) % keys.length] ?? "ember";
}

function useStoredState<T>(key: string, initial: T): [T, (value: T | ((current: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  const setStored = useCallback(
    (value: T | ((current: T) => T)) => {
      setState((current) => {
        const next = typeof value === "function" ? (value as (current: T) => T)(current) : value;
        window.localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    },
    [key]
  );

  return [state, setStored];
}
