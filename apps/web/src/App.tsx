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
import { FeedCanvas, TimelineCapsule, TracksPanel, type FeedMode, type FeedPose } from "./instruments";
import { RapierSimulation, agentBodyPresets, unavailablePhysicsDiagnostics, type AgentBodyPreset, type AgentBodyPresetId, type DriveCommand } from "./simulation";
import type {
  AgentState,
  AuthorityStatus,
  CameraState,
  LocalPackageInsight,
  LocalPackageIssue,
  LocalWorldPackagePayload,
  PhysicsDiagnostics,
  RendererDiagnostics,
  RenderAdapter,
  RenderMode,
  RenderOptions,
  SensorRigChannel,
  StudioMode,
  WorldClass,
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
    { keyName: "F", label: "frames" },
    { glyph: "mouseL", label: "inspect" },
    { keyName: "S", label: "sync" }
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
  name: string;
  path: string;
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
  authorityStatus: AuthorityStatus;
  packageInsights?: LocalPackageInsight[];
  packageIssues?: LocalPackageIssue[];
}

interface LoadedWorldOptions {
  preserveEpisode?: boolean;
}

interface HistoryItem {
  id: string;
  type: "select" | "delete";
  count: number;
  indices: number[];
}

const initialCamera: CameraState = {
  yaw: 0.62,
  pitch: 0.42,
  distance: 7.2,
  target: [0, 0.7, -0.2],
  fov: 50
};

const initialSensors: SensorRigChannel[] = [
  { id: "rgb", label: "RGB", kind: "rgb", enabled: true, spec: "72° · 1920x1080" },
  { id: "depth", label: "DEPTH", kind: "depth", enabled: true, spec: "linear · meters" },
  { id: "seg", label: "SEG", kind: "segmentation", enabled: true, spec: "class id" },
  { id: "lidar", label: "LIDAR", kind: "lidar", enabled: false, spec: "32 beam · 20hz" },
  { id: "imu", label: "IMU", kind: "imu", enabled: true, spec: "200hz" }
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
  authorityStatus: string;
  rendererMode: string;
  rendererStatus: string;
  notes: string[];
}

interface EpisodeSourceMatch {
  status: "matched" | "missing" | "mismatch" | "manifest";
  detail: string;
}

const defaultProps: SimulatedPropState[] = [
  { id: "prop-crate-a", label: "crate_a", preset: "crate", contactState: "grounded", x: -0.8, y: 0.18, z: 0.4, footprintRadius: 0.3 },
  { id: "prop-tall-a", label: "tall-crate_a", preset: "tall-crate", contactState: "grounded", x: 0.9, y: 0.42, z: 0.9, footprintRadius: 0.26 }
];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<{ kind: "orbit" | "brush" | "rect"; x: number; y: number } | null>(null);
  const brushStrokeRef = useRef<Set<number>>(new Set());
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [showDeleted, setShowDeleted] = useState(true);
  const [isolatedClass, setIsolatedClass] = useState<number | undefined>(undefined);
  const [history, setHistory] = useState<HistoryItem[]>([]);
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
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState("brush");
  const [worldPoints, setWorldPoints] = useState<PointRecord[]>([]);
  const [captureFrames, setCaptureFrames] = useState<CaptureFrame[]>([]);
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
  const episodeTimeline = useMemo(() => [...episodeEvents].sort((a, b) => a.frame - b.frame), [episodeEvents]);
  const selectedEpisodeEvent = useMemo(
    () => episodeTimeline.find((event) => event.id === selectedEpisodeEventId) ?? episodeTimeline.at(-1) ?? null,
    [episodeTimeline, selectedEpisodeEventId]
  );
  const episodeSourceMatch = useMemo(
    () => (episodeProvenance ? describeEpisodeSourceMatch(episodeProvenance, session) : null),
    [episodeProvenance, session]
  );
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
      debugCollision,
      agentBodyRadius: bodyPreset?.radius,
      grid: true
    }),
    [accent, agent, bodyPreset?.radius, camera, debugCollision, deleted, density, exposure, isolatedClass, mode, renderMode, replayAgent, selected, showDeleted, spawn, trajectory]
  );
  const activePackageInsight = useMemo(
    () => packageInsights.find((insight) => insight.id === selectedInsightId) ?? packageInsights[0] ?? null,
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
    if (!playing) return;
    const id = window.setInterval(() => {
      setPlayhead((value) => (value >= 1 ? 0 : Math.min(1, value + 0.012)));
    }, 80);
    return () => window.clearInterval(id);
  }, [playing]);

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
      if (event.key.toLowerCase() === "e" && mode === "episode") exportEpisodeManifest();
      if (event.key.toLowerCase() === "s" && mode === "simulate") stepPhysics({ move: 0, turn: 0 }, "PhysicsStep(1/60s)");
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
      setPressed((current) => {
        const next = new Set(current);
        next.delete(event.key.toLowerCase());
        return next;
      });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, selected, history, trajectory, selectedEpisodeEventId, episodeEvents, episodeTotalFrames]);

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
    setStepCount(0);
    setLastAction("idle");
    setProps(defaultProps);
    setSelectedPropId(null);
    setEpisodeEvents([]);
    setSelectedEpisodeEventId(null);
    setEpisodeExportText(null);
    setEpisodeSaveStatus(null);
    setEpisodeProvenance(null);
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
    const base = "/fixtures/loft_04";
    const [sceneResponse, pointsResponse, gaussiansResponse, objResponse] = await Promise.all([
      fetch(`${base}/scene.json`),
      fetch(`${base}/points.ply`),
      fetch(`${base}/gaussians.ply`),
      fetch(`${base}/collision_mesh.obj`)
    ]);
    if (!sceneResponse.ok || !pointsResponse.ok || !gaussiansResponse.ok || !objResponse.ok) {
      throw new Error("Failed to load loft_04 fixture");
    }
    const scene = (await sceneResponse.json()) as LoftSceneManifest;
    const [pointsText, gaussiansText, objText] = await Promise.all([
      pointsResponse.text(),
      gaussiansResponse.text(),
      objResponse.text()
    ]);
    applyLoadedWorld({
      name: scene.dataset,
      scene,
      pointsText,
      gaussianHeaderText: gaussiansText,
      gaussianUrl: `${base}/gaussians.ply`,
      objText,
      loadedVia: base,
      sourcePath: base,
      sourceKind: "world-studio.fixture.loft_04",
      packageKind: "fixture",
      primaryArtifact: "gaussians.ply",
      companionArtifacts: Object.keys(scene.files),
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
      authorityStatus: payload.authorityStatus,
      packageInsights: payload.packageInsights,
      packageIssues: payload.packageIssues,
      captureFrames: parseCaptureFrames(payload)
    }, options);
  }, []);

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
      setSelectedInsightId(nextInsights[0]?.id ?? null);
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
    setSelectedInsightId(nextInsights[0]?.id ?? null);
    if (!options?.preserveEpisode) resetTransientState(worldSession);
    initializeSimulation(worldSession, mesh, worldSession.agentSpawn ?? defaultSpawn, bodyPreset);
  }, [bodyPreset, initializeSimulation, resetTransientState]);

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
      if (last.type === "delete") {
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

  const recordEpisodeEvent = useCallback((event: Omit<EpisodeEvent, "id" | "frame">) => {
    episodeFrameRef.current += 1;
    const frame = episodeFrameRef.current;
    const id = `event-${frame}`;
    setEpisodeEvents((current) => [{ ...event, id, frame }, ...current].slice(0, 80));
    setSelectedEpisodeEventId(id);
    setEpisodeExportText(null);
    setEpisodeSaveStatus(null);
    setEpisodeProvenance(null);
  }, []);

  const selectEpisodeEvent = useCallback(
    (event: EpisodeEvent) => {
      setSelectedEpisodeEventId(event.id);
      setPlayhead(Math.min(1, Math.max(0, event.frame / episodeTotalFrames)));
    },
    [episodeTotalFrames]
  );

  const stepEpisodeEvent = useCallback(
    (direction: -1 | 1) => {
      if (!episodeTimeline.length) return;
      const currentIndex = Math.max(0, episodeTimeline.findIndex((event) => event.id === selectedEpisodeEvent?.id));
      const nextIndex = Math.min(episodeTimeline.length - 1, Math.max(0, currentIndex + direction));
      selectEpisodeEvent(episodeTimeline[nextIndex] ?? episodeTimeline[0]!);
    },
    [episodeTimeline, selectEpisodeEvent, selectedEpisodeEvent?.id]
  );

  const createEpisodeManifest = useCallback(() => {
    return buildEpisodeManifest({
      session,
      events: episodeTimeline,
      selectedEventId: selectedEpisodeEvent?.id ?? null,
      playhead,
      trajectory,
      props,
      sensors
    });
  }, [episodeTimeline, playhead, props, selectedEpisodeEvent?.id, sensors, session, trajectory]);

  const createEpisodeManifestText = useCallback(() => {
    const manifest = createEpisodeManifest();
    return JSON.stringify(manifest, null, 2);
  }, [createEpisodeManifest]);

  const createEpisodeBundleText = useCallback(() => {
    const bundle = buildEpisodeBundle({
      episodeManifest: createEpisodeManifest(),
      session,
      renderMode,
      rendererStatus: rendererStatusLabel(renderMode, rendererDiagnostics),
      rendererDiagnostics
    });
    return JSON.stringify(bundle, null, 2);
  }, [createEpisodeManifest, renderMode, rendererDiagnostics, session]);

  const exportEpisodeManifest = useCallback(() => {
    setEpisodeExportText(createEpisodeManifestText());
    setEpisodeSaveStatus("preview ready");
  }, [createEpisodeManifestText]);

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
    const text = createEpisodeBundleText();
    const suggestedName = episodeBundleFileName(session);
    setEpisodeExportText(text);
    const desktopSave = getDesktopApi()?.saveEpisodeBundle;
    if (desktopSave) {
      const result = await desktopSave({ suggestedName, text });
      setEpisodeSaveStatus(result?.path ? `saved package ${compactPath(result.path)}` : "package save canceled");
      return;
    }
    downloadTextFile(suggestedName, text, "application/json");
    setEpisodeSaveStatus(`downloaded package ${suggestedName}`);
  }, [createEpisodeBundleText, episodeTimeline.length, session]);

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
    setEpisodeExportText(text);
    setEpisodeSaveStatus(`loaded ${compactPath(sourceLabel)}${imported.worldName ? ` · ${imported.worldName}` : ""}`);
    setEpisodeProvenance({ ...imported.provenance, loadedFrom: sourceLabel });
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
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "edit" && renderer && tool === "brush") {
      interactionRef.current = { kind: "brush", x: event.clientX, y: event.clientY };
      brushStrokeRef.current = new Set();
      paintAt(event);
    } else if (mode === "edit" && renderer && tool === "rect") {
      interactionRef.current = { kind: "rect", x: event.clientX, y: event.clientY };
      const start = toStage(event.clientX, event.clientY);
      setSelectRect({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
    } else {
      interactionRef.current = { kind: "orbit", x: event.clientX, y: event.clientY };
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
    const dx = event.clientX - interaction.x;
    const dy = event.clientY - interaction.y;
    interactionRef.current = { ...interaction, x: event.clientX, y: event.clientY };
    setCamera((current) => ({
      ...current,
      yaw: current.yaw + dx * 0.006,
      pitch: Math.max(0.05, Math.min(1.2, current.pitch + dy * 0.004))
    }));
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
    interactionRef.current = null;
    brushStrokeRef.current = new Set();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setCamera((current) => ({
      ...current,
      distance: Math.max(2.4, Math.min(14, current.distance + event.deltaY * 0.004))
    }));
  };

  const activeMode = modes.find((entry) => entry.id === mode) ?? modes[0];
  const rootClass = `ws-root mode-${mode} ${dense ? "dense" : ""} ${docked ? "docked" : ""}`.trim();
  const hasDesktopApi = Boolean(getDesktopApi()?.openLocalPackage);

  return (
    <div className="ws-stage-shell">
      {hasDesktopApi ? <div className="ws-drag-strip" /> : null}
      <div className="ws-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <main className={rootClass} style={{ "--acc": accent } as React.CSSProperties}>
          <canvas
            ref={canvasRef}
            className={`ws-canvas ${mode === "simulate" ? "dual-right" : ""} ${
              mode === "edit" && (tool === "brush" || tool === "rect") ? "edit-tool" : ""
            }`.trim()}
            data-testid="world-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setCursor(null)}
            onWheel={onWheel}
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
          <div className="ws-overlay">
            {mode === "simulate" ? (
              <>
                <div className="ws-dual-left">
                  <FeedCanvas points={worldPoints} classes={session?.classes ?? []} mode="rgb" pose={simFeedPose} cw={960} ch={1080} />
                  <div className="ws-view-tag">
                    <span className="ws-head">Sensor feed</span>
                    <WSChip>{captureFrames.length ? `${captureFrames.length} frames` : "cam_front · synthetic"}</WSChip>
                  </div>
                </div>
                <div className="ws-dual-split" />
                <div className="ws-view-tag metric">
                  <span className="ws-head">Metric view</span>
                  <WSChip>{session ? `aligned · ${session.pointCount} pts` : "no world"}</WSChip>
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

            <aside className="ws-left">{renderLeftPanel()}</aside>
            <aside className="ws-right-col">{renderRightPanel()}</aside>

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

            {mode !== "pilot" && mode !== "simulate" && mode !== "episode" ? (
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
                  {(mode === "view" || mode === "simulate") && captureFrames.length ? (
                    <TimelineCapsule
                      frame={Math.round(playhead * captureFrames.length)}
                      total={captureFrames.length}
                      playing={playing}
                      onToggle={() => setPlaying((value) => !value)}
                      onRewind={() => setPlayhead(0)}
                    />
                  ) : null}
                  <WSControlsBar controls={controls[mode]} />
                </div>
              </div>
            )}

            {!session ? (
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
              { label: `${selected.size} selected · ${deleted.size} hidden` },
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
              captureFrames.slice(0, 7).map((frame) => (
                <div key={frame.name} className="ws-frame-row">
                  <span className="ws-frame-thumb" />
                  <span className="ws-row-name">{frame.name}</span>
                  <WSChip>ok</WSChip>
                </div>
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
    if (mode === "edit") {
      return (
        <WSPanel title="Optimize" meta="local">
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
          <div className="ws-kv">
            <span>export</span>
            <b>.ply · .splat · .sog stub</b>
          </div>
        </WSPanel>
      );
    }

    if (mode === "sensors") {
      const selectedSensor = sensors.find((sensor) => sensor.id === selectedSensorId) ?? sensors[0];
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
                    setSensors((items) =>
                      items.map((item) => (item.id === sensor.id ? { ...item, enabled: !item.enabled } : item))
                    );
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
            <WSPanel title={`${selectedSensor.label} — channel`} className="ws-intrinsics">
              <div className="ws-kv">
                <span>kind</span>
                <b>{selectedSensor.kind}</b>
              </div>
              <div className="ws-kv">
                <span>spec</span>
                <b>{selectedSensor.spec}</b>
              </div>
              <div className="ws-kv">
                <span>state</span>
                <b>{selectedSensor.enabled ? "streaming" : "off"}</b>
              </div>
              <WSSliderRow label="Noise σ" value="0.000" pct={0} />
              <WSSliderRow label="Blur" value="off" pct={0} />
            </WSPanel>
          ) : null}
        </>
      );
    }

    if (mode !== "view") return null;

    return (
      <div className="ws-row-stack">
        <WSPanel title="Provenance" meta={session?.provenance.packageKind ?? "none"}>
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
        <PackageInspector insights={packageInsights} selectedId={activePackageInsight?.id ?? null} onSelect={setSelectedInsightId} />
        <PackageInsightDetail insight={activePackageInsight} />
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
    return `spark gaussian · ${diagnostics.gaussianSplatCount ?? "ready"} splats`;
  }
  if (diagnostics.sparkState === "failed") return `splat fallback · ${diagnostics.sparkFailureReason ?? "spark failed"}`;
  return "splat fallback · not renderable";
}

function rendererPreparationLabel(diagnostics: RendererDiagnostics | null): string {
  if (!diagnostics?.hasGaussianSource) return "none";
  if (diagnostics.gaussianPreparedForSpark === undefined) return "pending";
  return diagnostics.gaussianPreparedForSpark ? "converted" : "native";
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
    const parsed = JSON.parse(text) as { frames?: Array<{ display_name?: string; rgb_path?: string }> };
    if (!Array.isArray(parsed.frames)) return [];
    return parsed.frames.map((frame, index) => ({
      name: frame.display_name ?? `frame ${index + 1}`,
      path: frame.rgb_path ?? ""
    }));
  } catch {
    return [];
  }
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

function knownEpisodeValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "unknown" || trimmed === "not supplied" || trimmed === "not bundled") return null;
  return trimmed;
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
    spec: typeof value.spec === "string" ? value.spec : fallback.spec
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

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`missing ${label}`);
  return value;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${label}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  sensors
}: {
  session: WorldSession | null;
  events: EpisodeEvent[];
  selectedEventId: string | null;
  playhead: number;
  trajectory: Array<[number, number]>;
  props: SimulatedPropState[];
  sensors: SensorRigChannel[];
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
      spec: sensor.spec
    }))
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
