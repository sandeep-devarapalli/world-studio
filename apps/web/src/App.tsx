import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createLoftWorldSession,
  detectPlyKind,
  parseObjMesh,
  parseObjMeshSummary,
  parsePointCloudPly,
  type LoftSceneManifest,
  type PointRecord
} from "@world-studio/artifacts";
import { accents, WSButton, WSChip, WSControlsBar, WSKey, WSPanel, WSPill, WSStatusBar, WSSwitch, WSWordmark } from "@world-studio/design-system";
import { ThreeWorldRenderer } from "@world-studio/renderer";
import type {
  AgentMoveResult,
  AgentState,
  AuthorityStatus,
  CameraState,
  LocalPackageInsight,
  LocalPackageIssue,
  LocalWorldPackagePayload,
  PhysicsDebugInfo,
  RenderAdapter,
  RendererDebugInfo,
  RenderMode,
  RenderOptions,
  SensorRigChannel,
  SimulationCommand,
  SimulatedPropPreset,
  SimulatedPropState,
  SpawnPlacementResult,
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

const controls: Record<StudioMode, Array<{ keyName: string; label: string }>> = {
  view: [
    { keyName: "L", label: "load" },
    { keyName: "drag", label: "orbit" },
    { keyName: "wheel", label: "zoom" }
  ],
  edit: [
    { keyName: "drag", label: "brush" },
    { keyName: "⌘Z", label: "undo" },
    { keyName: "Del", label: "delete" }
  ],
  simulate: [
    { keyName: "F", label: "frames" },
    { keyName: "drag", label: "inspect" },
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
    { keyName: "drag", label: "orbit" }
  ],
  episode: [
    { keyName: "Space", label: "play" },
    { keyName: "← →", label: "step" },
    { keyName: "E", label: "export" }
  ]
};

interface AssetSummary {
  gaussianKind: string;
  objFaces: number;
  objGroups: number;
  pointCount: number;
}

interface LoadedWorldInput {
  name: string;
  scene?: LoftSceneManifest;
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

interface HistoryItem {
  id: string;
  type: "select" | "delete";
  count: number;
  indices: number[];
}

type EpisodeLane = "agent" | "object" | "capture";

type EpisodeEventKind =
  | "agent-drive"
  | "agent-reset"
  | "agent-spawn"
  | "prop-spawn"
  | "prop-select"
  | "prop-move"
  | "prop-duplicate"
  | "prop-delete"
  | "prop-reset"
  | "simulation-step"
  | "simulation-reset";

interface EpisodeEvent {
  id: string;
  frame: number;
  lane: EpisodeLane;
  kind: EpisodeEventKind;
  label: string;
  targetId?: string;
  pose?: { x: number; y?: number; z: number; heading?: number };
  status?: string;
}

interface PointerInteraction {
  kind: "orbit" | "brush" | "prop-drag";
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  propId?: string;
  footprintRadius?: number;
}

const initialCamera: CameraState = {
  yaw: 0.62,
  pitch: 0.42,
  distance: 7.2,
  target: [0, 0.7, -0.2],
  fov: 50
};

const initialAgentSpawn: AgentState = { x: 1.5, z: -0.5, heading: 4.4 };
const agentFootprintRadius = 0.36;
const propPresets: SimulatedPropPreset[] = ["crate", "tall-crate"];

const initialSensors: SensorRigChannel[] = [
  { id: "rgb", label: "RGB", kind: "rgb", enabled: true, spec: "72° · 1920x1080" },
  { id: "depth", label: "DEPTH", kind: "depth", enabled: true, spec: "linear · meters" },
  { id: "seg", label: "SEG", kind: "segmentation", enabled: true, spec: "class id" },
  { id: "lidar", label: "LIDAR", kind: "lidar", enabled: false, spec: "32 beam · 20hz" },
  { id: "imu", label: "IMU", kind: "imu", enabled: true, spec: "200hz" }
];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const brushStrokeRef = useRef<Set<number>>(new Set());
  const simulationCommandSeq = useRef(0);
  const episodeFrameRef = useRef(0);
  const [scale, setScale] = useState(1);
  const [mode, setMode] = useStoredState<StudioMode>("ws-app-mode", "view");
  const [renderMode, setRenderMode] = useStoredState<RenderMode>("ws-app-vmode", "splat");
  const [accentName, setAccentName] = useStoredState<keyof typeof accents>("ws-app-accent", "ember");
  const [dense, setDense] = useStoredState("ws-app-density", false);
  const [docked, setDocked] = useStoredState("ws-app-docked", false);
  const [physicsDebug, setPhysicsDebug] = useStoredState("ws-app-physics-debug", false);
  const [session, setSession] = useState<WorldSession | null>(null);
  const [assetSummary, setAssetSummary] = useState<AssetSummary | null>(null);
  const [packageInsights, setPackageInsights] = useState<LocalPackageInsight[]>([]);
  const [packageIssues, setPackageIssues] = useState<LocalPackageIssue[]>([]);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<RenderAdapter | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [camera, setCamera] = useState(initialCamera);
  const [density, setDensity] = useState(0.9);
  const [exposure, setExposure] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [showDeleted, setShowDeleted] = useState(true);
  const [isolatedClass, setIsolatedClass] = useState<number | undefined>(undefined);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [spawn, setSpawn] = useState<AgentState>(initialAgentSpawn);
  const [agent, setAgent] = useState<AgentState>(initialAgentSpawn);
  const [trajectory, setTrajectory] = useState<Array<[number, number]>>([[initialAgentSpawn.x, initialAgentSpawn.z]]);
  const [spawnPlacement, setSpawnPlacement] = useState<SpawnPlacementResult | null>(null);
  const [agentMove, setAgentMove] = useState<AgentMoveResult | null>(null);
  const [physicsInfo, setPhysicsInfo] = useState<PhysicsDebugInfo | null>(null);
  const [rendererInfo, setRendererInfo] = useState<RendererDebugInfo | null>(null);
  const [simulationCommand, setSimulationCommand] = useState<SimulationCommand | null>(null);
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [draggingPropId, setDraggingPropId] = useState<string | null>(null);
  const [pilotTool, setPilotTool] = useState<"agent" | "prop">("agent");
  const [selectedPropPreset, setSelectedPropPreset] = useState<SimulatedPropPreset>("crate");
  const [sensors, setSensors] = useState(initialSensors);
  const [playhead, setPlayhead] = useState(0.28);
  const [playing, setPlaying] = useState(false);
  const [episodeEvents, setEpisodeEvents] = useState<EpisodeEvent[]>([]);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const accent = accents[accentName];
  const selectedProp = useMemo(() => {
    const props = physicsInfo?.props ?? [];
    return props.find((prop) => prop.id === selectedPropId) ?? props[0] ?? null;
  }, [physicsInfo, selectedPropId]);
  const selectedPropIdForRender = selectedProp?.id;

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
      agent: mode === "pilot" || mode === "episode" ? agent : undefined,
      trajectory: mode === "pilot" || mode === "episode" ? trajectory : undefined,
      spawnPlacement: mode === "pilot" ? spawnPlacement : null,
      agentMove: mode === "pilot" ? agentMove : null,
      physicsDebug: (mode === "pilot" || mode === "simulate") && physicsDebug,
      simulationVisible: mode === "pilot" || mode === "simulate",
      simulationCommand: mode === "pilot" || mode === "simulate" ? simulationCommand : null,
      selectedPropId: mode === "pilot" || mode === "simulate" ? selectedPropIdForRender : undefined,
      grid: true
    }),
    [
      accent,
      agent,
      agentMove,
      camera,
      deleted,
      density,
      exposure,
      isolatedClass,
      mode,
      physicsDebug,
      renderMode,
      selected,
      selectedPropIdForRender,
      showDeleted,
      simulationCommand,
      spawnPlacement,
      trajectory
    ]
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

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setPlayhead((value) => (value >= 1 ? 0 : Math.min(1, value + 0.012)));
    }, 80);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (mode !== "pilot") {
      setSpawnPlacement(null);
      setAgentMove(null);
      setDraggingPropId(null);
    }
  }, [mode]);

  useEffect(() => {
    if (!renderer?.getPhysicsDebugInfo || (mode !== "pilot" && mode !== "simulate")) {
      setPhysicsInfo(null);
      return;
    }
    const update = () => setPhysicsInfo(renderer.getPhysicsDebugInfo?.() ?? null);
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [agentMove, mode, physicsDebug, renderer, spawnPlacement]);

  useEffect(() => {
    if (!renderer?.getRendererDebugInfo) {
      setRendererInfo(null);
      return;
    }
    const update = () => setRendererInfo(renderer.getRendererDebugInfo?.() ?? null);
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [renderMode, renderer]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      setPressed((current) => new Set(current).add(event.key.toLowerCase()));
      if (event.key.toLowerCase() === "l") void (getDesktopApi()?.openLocalPackage ? loadLocalPackage() : loadFixture());
      if (event.key === " " && mode === "episode") setPlaying((value) => !value);
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
  }, [mode, selected, history, spawn, renderer]);

  const resetTransientState = useCallback((worldSession: WorldSession) => {
    const nextSpawn = worldSession.agentSpawn ?? initialAgentSpawn;
    setSpawn(nextSpawn);
    setAgent(nextSpawn);
    setTrajectory([[nextSpawn.x, nextSpawn.z]]);
    setSpawnPlacement(null);
    setAgentMove(null);
    setSelectedPropId(null);
    setDraggingPropId(null);
    setSimulationCommand(null);
    simulationCommandSeq.current = 0;
    episodeFrameRef.current = 0;
    setEpisodeEvents([]);
    setSelected(new Set());
    setDeleted(new Set());
    setHistory([]);
  }, []);

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

  const applyLocalPackage = useCallback((payload: LocalWorldPackagePayload) => {
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
      packageIssues: payload.packageIssues
    });
  }, []);

  const applyLoadedWorld = useCallback((input: LoadedWorldInput) => {
    setLoadError(null);

    if (!input.pointsText) {
      const nextInsights = input.packageInsights ?? [];
      const nextIssues = input.packageIssues ?? [];
      const worldSession = createManifestOnlySession(input);
      setSession(worldSession);
      setRenderer(null);
      setAssetSummary({ gaussianKind: input.gaussianHeaderText ? detectPlyKind(input.gaussianHeaderText) : "unloaded", objFaces: 0, objGroups: 0, pointCount: 0 });
      setPackageInsights(nextInsights);
      setPackageIssues(nextIssues);
      setSelectedInsightId(nextInsights[0]?.id ?? null);
      resetTransientState(worldSession);
      return;
    }

    const nextInsights = input.packageInsights ?? [];
    const nextIssues = input.packageIssues ?? [];
    const pointCloud = parsePointCloudPly(input.pointsText);
    const mesh = input.objText ? parseObjMesh(input.objText) : undefined;
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
    setRenderer(new ThreeWorldRenderer({ pointCloud, classes: worldSession.classes, mesh, gaussianUrl: input.gaussianUrl }));
    setAssetSummary({
      gaussianKind: input.gaussianHeaderText ? detectPlyKind(input.gaussianHeaderText) : "unloaded",
      objFaces: meshSummary.faces,
      objGroups: meshSummary.groups.length,
      pointCount: pointCloud.points.length
    });
    setPackageInsights(nextInsights);
    setPackageIssues(nextIssues);
    setSelectedInsightId(nextInsights[0]?.id ?? null);
    resetTransientState(worldSession);
  }, []);

  const paintAt = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      const indices = renderer.collectInRadius(canvas, options, event.clientX, event.clientY, 42);
      if (!indices.length) return;
      setSelected((current) => {
        const next = new Set(current);
        for (const index of indices) next.add(index);
        return next;
      });
      for (const index of indices) brushStrokeRef.current.add(index);
    },
    [options, renderer]
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
    setEpisodeEvents((current) => [{ ...event, id: `event-${frame}`, frame }, ...current].slice(0, 80));
  }, []);

  const resetAgent = () => {
    setAgent(spawn);
    setTrajectory([[spawn.x, spawn.z]]);
    setAgentMove(null);
    recordEpisodeEvent({
      lane: "agent",
      kind: "agent-reset",
      label: "agent reset",
      pose: { x: spawn.x, z: spawn.z, heading: spawn.heading },
      status: "spawn"
    });
  };

  const issueSimulationCommand = (
    action: SimulationCommand["action"],
    steps = 1,
    preset?: SimulatedPropPreset,
    position?: SimulationCommand["position"],
    targetPropId?: string,
    delta?: SimulationCommand["delta"]
  ) => {
    const id = simulationCommandSeq.current + 1;
    simulationCommandSeq.current = id;
    setSimulationCommand({ id, action, steps, preset, position, targetPropId, delta });
    if (action === "spawn-prop" || action === "duplicate-prop") setSelectedPropId(`pilot-${id}`);
    if (action === "delete-prop" && selectedPropId === targetPropId) setSelectedPropId(null);
    recordEpisodeEvent(simulationCommandToEpisode(action, steps, preset, position, targetPropId, delta));
  };

  const driveAgent = (key: string) => {
    setAgent((current) => {
      const step = 0.12;
      const turn = 0.16;
      let target = { ...current };
      if (key === "a") target = { ...target, heading: target.heading - turn };
      if (key === "d") target = { ...target, heading: target.heading + turn };
      if (key === "a" || key === "d") {
        setAgentMove(createAgentMoveStatus("clear", current, target, target, "turn clear"));
        setTrajectory((points) => [...points.slice(-42), [target.x, target.z]]);
        recordEpisodeEvent({
          lane: "agent",
          kind: "agent-drive",
          label: key === "a" ? "agent turn left" : "agent turn right",
          pose: { x: target.x, z: target.z, heading: target.heading },
          status: "clear"
        });
        return target;
      }
      if (key === "w" || key === "s") {
        const dir = key === "w" ? 1 : -1;
        target = {
          ...target,
          x: target.x + Math.cos(target.heading) * step * dir,
          z: target.z + Math.sin(target.heading) * step * dir
        };
      }
      const result =
        renderer?.queryAgentMove?.(current, target, agentFootprintRadius) ??
        createAgentMoveStatus("unavailable", current, target, current, "movement query unavailable");
      setAgentMove(result);
      if (result.status === "clear") {
        setTrajectory((points) => [...points.slice(-42), [result.resolved.x, result.resolved.z]]);
      }
      recordEpisodeEvent({
        lane: "agent",
        kind: "agent-drive",
        label: key === "w" ? "agent drive forward" : "agent drive reverse",
        pose: { x: result.resolved.x, z: result.resolved.z, heading: result.resolved.heading },
        status: result.status
      });
      return result.resolved;
    });
  };

  const queryPlacementAt = (event: React.PointerEvent<HTMLCanvasElement>, footprintRadius: number): SpawnPlacementResult | null => {
    const canvas = canvasRef.current;
    if (!canvas || !renderer?.querySpawnPlacement) return null;
    const placement = renderer.querySpawnPlacement(canvas, options, event.clientX, event.clientY, footprintRadius);
    setSpawnPlacement(placement);
    return placement;
  };

  const updateSpawnPlacement = (event: React.PointerEvent<HTMLCanvasElement>): SpawnPlacementResult | null => {
    const footprintRadius = pilotTool === "prop" ? propPresetFootprint(selectedPropPreset) : agentFootprintRadius;
    return queryPlacementAt(event, footprintRadius);
  };

  const propAt = (event: React.PointerEvent<HTMLCanvasElement>): SimulatedPropState | null => {
    const canvas = canvasRef.current;
    if (mode !== "pilot" || !canvas || !renderer?.queryPropAt) return null;
    return renderer.queryPropAt(canvas, options, event.clientX, event.clientY);
  };

  const selectPropAt = (event: React.PointerEvent<HTMLCanvasElement>): boolean => {
    const hit = propAt(event);
    if (!hit) return false;
    selectProp(hit.id, "canvas");
    return true;
  };

  const selectProp = (propId: string, source: "canvas" | "list" = "list") => {
    setPilotTool("prop");
    setSelectedPropId(propId);
    setSpawnPlacement(null);
    if (selectedPropId !== propId) {
      recordEpisodeEvent({
        lane: "object",
        kind: "prop-select",
        label: `prop select · ${source}`,
        targetId: propId,
        status: "active"
      });
    }
  };

  const placeSpawnAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const placement = updateSpawnPlacement(event);
    if (placement?.status !== "valid" || placement.x === undefined || placement.z === undefined) return;
    if (pilotTool === "prop") {
      issueSimulationCommand("spawn-prop", 1, selectedPropPreset, {
        x: placement.x,
        y: placement.y ?? 0,
        z: placement.z
      });
      return;
    }
    const nextSpawn = { x: placement.x, z: placement.z, heading: agent.heading };
    setSpawn(nextSpawn);
    setAgent(nextSpawn);
    setTrajectory([[nextSpawn.x, nextSpawn.z]]);
    setAgentMove(null);
    recordEpisodeEvent({
      lane: "agent",
      kind: "agent-spawn",
      label: "agent spawn set",
      pose: { x: nextSpawn.x, z: nextSpawn.z, heading: nextSpawn.heading },
      status: "valid"
    });
  };

  const moveSelectedPropTo = (propId: string | undefined, placement: SpawnPlacementResult | null) => {
    if (!propId || placement?.status !== "valid" || placement.x === undefined || placement.y === undefined || placement.z === undefined) return;
    issueSimulationCommand(
      "move-prop",
      1,
      undefined,
      {
        x: placement.x,
        y: placement.y,
        z: placement.z
      },
      propId
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "edit" && renderer) {
      interactionRef.current = { kind: "brush", x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
      brushStrokeRef.current = new Set();
      paintAt(event);
    } else {
      if (mode === "pilot") {
        const hit = propAt(event);
        if (hit) {
          selectProp(hit.id, "canvas");
          setDraggingPropId(hit.id);
          queryPlacementAt(event, hit.footprintRadius);
          interactionRef.current = {
            kind: "prop-drag",
            propId: hit.id,
            footprintRadius: hit.footprintRadius,
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            moved: false
          };
          return;
        }
        updateSpawnPlacement(event);
      }
      interactionRef.current = { kind: "orbit", x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) {
      if (mode === "pilot") updateSpawnPlacement(event);
      return;
    }
    if (interaction.kind === "brush") {
      paintAt(event);
      return;
    }
    if (interaction.kind === "prop-drag") {
      const moved = interaction.moved || Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) > 6;
      interactionRef.current = { ...interaction, x: event.clientX, y: event.clientY, moved };
      queryPlacementAt(event, interaction.footprintRadius ?? selectedProp?.footprintRadius ?? propPresetFootprint(selectedPropPreset));
      return;
    }
    const dx = event.clientX - interaction.x;
    const dy = event.clientY - interaction.y;
    const moved = interaction.moved || Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) > 6;
    interactionRef.current = { ...interaction, x: event.clientX, y: event.clientY, moved };
    setCamera((current) => ({
      ...current,
      yaw: current.yaw + dx * 0.006,
      pitch: Math.max(0.05, Math.min(1.2, current.pitch + dy * 0.004))
    }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (interactionRef.current?.kind === "brush" && brushStrokeRef.current.size) {
      const indices = [...brushStrokeRef.current];
      const entry: HistoryItem = { id: crypto.randomUUID(), type: "select", count: indices.length, indices };
      setHistory((current) => [entry, ...current].slice(0, 10));
    }
    if (interaction?.kind === "orbit" && mode === "pilot" && !interaction.moved) {
      if (!selectPropAt(event)) placeSpawnAt(event);
    }
    if (interaction?.kind === "prop-drag") {
      const placement = queryPlacementAt(event, interaction.footprintRadius ?? selectedProp?.footprintRadius ?? propPresetFootprint(selectedPropPreset));
      if (interaction.moved) moveSelectedPropTo(interaction.propId, placement);
      setDraggingPropId(null);
    }
    interactionRef.current = null;
    brushStrokeRef.current = new Set();
  };

  const onPointerCancel = () => {
    interactionRef.current = null;
    brushStrokeRef.current = new Set();
    setDraggingPropId(null);
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setCamera((current) => ({
      ...current,
      distance: Math.max(2.4, Math.min(14, current.distance + event.deltaY * 0.004))
    }));
  };

  const activeMode = modes.find((entry) => entry.id === mode) ?? modes[0];
  const rootClass = `ws-root ${dense ? "dense" : ""} ${docked ? "docked" : ""}`.trim();
  const hasDesktopApi = Boolean(getDesktopApi()?.openLocalPackage);

  return (
    <div className="ws-stage-shell">
      <div className="ws-stage" style={{ transform: `scale(${scale})` }}>
        <main className={rootClass} style={{ "--acc": accent } as React.CSSProperties}>
          <canvas
            ref={canvasRef}
            className="ws-canvas"
            data-testid="world-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onWheel={onWheel}
          />
          <div className="ws-overlay">
            <div className="ws-top-left">
              <WSWordmark context={session ? `${session.name} · ${session.version ?? "loaded"}` : "no world loaded"} />
              {mode === "edit" ? <ToolRail /> : null}
            </div>

            <div className="ws-top-center">
              <WSPanel className="ws-mode-switch">
                {modes.map((entry) => (
                  <WSPill key={entry.id} active={entry.id === mode} onClick={() => setMode(entry.id)}>
                    {entry.label}
                  </WSPill>
                ))}
              </WSPanel>
            </div>

            <div className="ws-render-row">
              {renderModes.map((entry) => (
                <WSPill key={entry} className="sm" active={entry === renderMode} onClick={() => setRenderMode(entry)}>
                  {entry}
                </WSPill>
              ))}
            </div>

            <aside className="ws-left">{renderLeftPanel()}</aside>
            <aside className="ws-right-col">{renderRightPanel()}</aside>

            <div className="ws-bottom-right">
              <WSPanel title={activeMode.title} meta={activeMode.tag} className="ws-mode-card">
                <ModeCard mode={mode} session={session} assetSummary={assetSummary} playhead={playhead} />
              </WSPanel>
            </div>

            <div className="ws-bottom-center">
              <WSControlsBar controls={controls[mode]} />
            </div>

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
              { label: rendererStatusLabel(renderMode, rendererInfo), accent: rendererInfo?.activeSplatBackend === "spark" }
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

    if (mode === "sensors") {
      return (
        <WSPanel title="Rig Channels" meta={`${sensors.filter((sensor) => sensor.enabled).length} on`}>
          <div className="ws-sensor-list">
            {sensors.map((sensor) => (
              <div
                key={sensor.id}
                className={`ws-sensor-row ${sensor.enabled ? "active" : "dim"}`}
                onClick={() =>
                  setSensors((items) => items.map((item) => (item.id === sensor.id ? { ...item, enabled: !item.enabled } : item)))
                }
              >
                <div className="ws-sensor-name">
                  <span>{sensor.label}</span>
                  <span className="ws-sensor-spec">{sensor.spec}</span>
                </div>
                <WSSwitch on={sensor.enabled} />
              </div>
            ))}
          </div>
        </WSPanel>
      );
    }

    if (mode === "episode") {
      const lanes: EpisodeLane[] = ["agent", "object", "capture"];
      return (
        <WSPanel title="Tracks" meta={`${episodeEvents.length} events`}>
          <div className="ws-row-stack">
            {lanes.map((lane) => (
              <div className="ws-kv" key={lane}>
                <span>{lane}</span>
                <b>
                  {episodeEvents.filter((event) => event.lane === lane).length} events
                </b>
              </div>
            ))}
            <div className="ws-episode-list" data-testid="episode-event-list">
              {episodeEvents.length ? (
                episodeEvents.slice(0, 10).map((event) => (
                  <div className={`ws-episode-row ${event.lane}`} key={event.id}>
                    <span className="ws-episode-frame">{String(event.frame).padStart(3, "0")}</span>
                    <span className="ws-episode-label">{event.label}</span>
                    <b>{event.status ?? event.lane}</b>
                  </div>
                ))
              ) : (
                <div className="ws-kv">
                  <span>events</span>
                  <b>none</b>
                </div>
              )}
            </div>
            <div className="ws-btn-row">
              <WSButton accent onClick={() => setPlaying((value) => !value)}>
                {playing ? "Pause" : "Play"}
              </WSButton>
            </div>
          </div>
        </WSPanel>
      );
    }

    return (
      <WSPanel title="World Tree" meta={session ? `${session.classes.length} classes` : "empty"}>
        <div className="ws-tree-body">
          <div className={`ws-layer-row ${session ? "active" : "dim"}`}>
            <span className="ws-row-ic">◉</span>
            <span className="ws-row-name">{session ? `${session.name} · ${session.version ?? "v"}` : "no loaded world"}</span>
            <WSChip>{session?.pointCount ?? 0}</WSChip>
          </div>
          {session?.classes.map((entry) => (
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

    if (mode === "pilot") {
      return (
        <div className="ws-row-stack">
          <WSPanel title="Agent" meta="keyboard">
            <div className="ws-pad">
              <WSKey active={pressed.has("w")}>W</WSKey>
              <WSKey active={pressed.has("a")}>A</WSKey>
              <WSKey active={pressed.has("s")}>S</WSKey>
              <WSKey active={pressed.has("d")}>D</WSKey>
            </div>
            <div className="ws-kv">
              <span>pose</span>
              <b>
                {agent.x.toFixed(2)} · {agent.z.toFixed(2)}
              </b>
            </div>
            <div className="ws-kv">
              <span>spawn</span>
              <b>
                {spawn.x.toFixed(2)} · {spawn.z.toFixed(2)}
              </b>
            </div>
            <div className="ws-kv">
              <span>footprint</span>
              <b>{agentFootprintRadius.toFixed(2)}m</b>
            </div>
            <div className={`ws-placement-state ${spawnPlacement?.status ?? "idle"}`} data-testid="spawn-placement-status">
              <span>{spawnPlacement?.status ?? "ready"}</span>
              <b>{spawnPlacement?.message ?? "ground query"}</b>
            </div>
            <div className={`ws-placement-state ${agentMove?.status ?? "idle"}`} data-testid="agent-move-status">
              <span>{agentMove?.status ?? "clear"}</span>
              <b>{agentMove?.message ?? "movement ready"}</b>
            </div>
            <div className="ws-btn-row">
              <WSButton onClick={resetAgent}>Reset</WSButton>
            </div>
          </WSPanel>
          <PilotPropPanel
            tool={pilotTool}
            preset={selectedPropPreset}
            placement={spawnPlacement}
            info={physicsInfo}
            selectedProp={selectedProp}
            selectedPropId={selectedProp?.id ?? null}
            draggingPropId={draggingPropId}
            onToolChange={setPilotTool}
            onPresetChange={setSelectedPropPreset}
            onSelectProp={(id) => selectProp(id, "list")}
            onReset={() => issueSimulationCommand("reset")}
            onDuplicateSelected={(propId) => issueSimulationCommand("duplicate-prop", 1, undefined, undefined, propId)}
            onResetSelected={(propId) => issueSimulationCommand("reset-prop", 1, undefined, undefined, propId)}
            onDeleteSelected={(propId) => issueSimulationCommand("delete-prop", 1, undefined, undefined, propId)}
            onNudgeSelected={(propId, delta) => issueSimulationCommand("nudge-prop", 1, undefined, undefined, propId, delta)}
          />
          <PhysicsDebugPanel
            enabled={physicsDebug}
            info={physicsInfo}
            onToggle={() => setPhysicsDebug((value) => !value)}
          />
        </div>
      );
    }

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
        {rendererInfo ? <RendererDebugPanel info={rendererInfo} renderMode={renderMode} /> : null}
        {mode === "simulate" ? (
          <>
            <SimulationControlPanel
              info={physicsInfo}
              onReset={() => issueSimulationCommand("reset")}
              onStep={() => issueSimulationCommand("step", 16)}
            />
            <PhysicsDebugPanel
              enabled={physicsDebug}
              info={physicsInfo}
              onToggle={() => setPhysicsDebug((value) => !value)}
            />
          </>
        ) : null}
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

function compactPath(value: string): string {
  if (value.length <= 42) return value;
  return `...${value.slice(-39)}`;
}

function createAgentMoveStatus(
  status: AgentMoveResult["status"],
  from: AgentState,
  target: AgentState,
  resolved: AgentState,
  message: string
): AgentMoveResult {
  return {
    status,
    from,
    target,
    resolved,
    footprintRadius: agentFootprintRadius,
    message,
    source: "renderer"
  };
}

function simulationCommandToEpisode(
  action: SimulationCommand["action"],
  steps = 1,
  preset?: SimulatedPropPreset,
  position?: SimulationCommand["position"],
  targetPropId?: string,
  delta?: SimulationCommand["delta"]
): Omit<EpisodeEvent, "id" | "frame"> {
  if (action === "spawn-prop") {
    return {
      lane: "object",
      kind: "prop-spawn",
      label: `prop spawn · ${preset ?? "crate"}`,
      pose: position,
      status: "queued"
    };
  }
  if (action === "duplicate-prop") {
    return {
      lane: "object",
      kind: "prop-duplicate",
      label: "prop duplicate",
      targetId: targetPropId,
      status: "queued"
    };
  }
  if (action === "delete-prop") {
    return {
      lane: "object",
      kind: "prop-delete",
      label: "prop delete",
      targetId: targetPropId,
      status: "queued"
    };
  }
  if (action === "reset-prop") {
    return {
      lane: "object",
      kind: "prop-reset",
      label: "prop reset",
      targetId: targetPropId,
      status: "spawn"
    };
  }
  if (action === "move-prop") {
    return {
      lane: "object",
      kind: "prop-move",
      label: "prop move",
      targetId: targetPropId,
      pose: position,
      status: "valid"
    };
  }
  if (action === "nudge-prop") {
    const offset = delta ? `${delta.x.toFixed(2)} · ${(delta.z ?? 0).toFixed(2)}` : "offset";
    return {
      lane: "object",
      kind: "prop-move",
      label: `prop nudge · ${offset}`,
      targetId: targetPropId,
      status: "queued"
    };
  }
  if (action === "step") {
    return {
      lane: "object",
      kind: "simulation-step",
      label: `physics step · ${steps}`,
      status: "deterministic"
    };
  }
  return {
    lane: "object",
    kind: "simulation-reset",
    label: "physics reset",
    status: "ready"
  };
}

function rendererStatusLabel(renderMode: RenderMode, info: RendererDebugInfo | null): string {
  if (!info) return "renderer · blank";
  if (renderMode === "splat") {
    if (info.activeSplatBackend === "spark") return "splat · Spark ready";
    if (info.sparkStatus === "loading") return "splat · Spark loading";
    return "splat · points fallback";
  }
  if (renderMode === "points") return "points · ordinary PLY";
  if (renderMode === "mesh") return "mesh · OBJ";
  if (renderMode === "semantic") return "semantic · point labels";
  return "depth · point distances";
}

function RendererDebugPanel({ info, renderMode }: { info: RendererDebugInfo | null; renderMode: RenderMode }) {
  return (
    <WSPanel title="Renderer" meta={info?.activeSplatBackend ?? "blank"} className="ws-renderer-panel">
      <div className="ws-row-stack" data-testid="renderer-debug-panel">
        <div className="ws-kv">
          <span>mode</span>
          <b>{renderMode}</b>
        </div>
        <div className="ws-kv" data-testid="renderer-splat-backend">
          <span>splat</span>
          <b>{info?.activeSplatBackend ?? "unavailable"}</b>
        </div>
        <div className="ws-kv" data-testid="renderer-spark-status">
          <span>spark</span>
          <b>{info?.sparkStatus ?? "unavailable"}</b>
        </div>
        <div className="ws-kv" data-testid="renderer-spark-splats">
          <span>splats</span>
          <b>{info?.sparkSplatCount ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>points</span>
          <b>{info?.pointCount ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>gaussian</span>
          <b title={info?.gaussianUrl}>{info?.gaussianUrl ? compactPath(info.gaussianUrl) : "none"}</b>
        </div>
        <div className="ws-kv">
          <span>state</span>
          <b>{info?.message ?? "waiting"}</b>
        </div>
      </div>
    </WSPanel>
  );
}

function PilotPropPanel({
  tool,
  preset,
  placement,
  info,
  selectedProp,
  selectedPropId,
  draggingPropId,
  onToolChange,
  onPresetChange,
  onSelectProp,
  onReset,
  onDuplicateSelected,
  onResetSelected,
  onDeleteSelected,
  onNudgeSelected
}: {
  tool: "agent" | "prop";
  preset: SimulatedPropPreset;
  placement: SpawnPlacementResult | null;
  info: PhysicsDebugInfo | null;
  selectedProp: SimulatedPropState | null;
  selectedPropId: string | null;
  draggingPropId: string | null;
  onToolChange: (tool: "agent" | "prop") => void;
  onPresetChange: (preset: SimulatedPropPreset) => void;
  onSelectProp: (id: string) => void;
  onReset: () => void;
  onDuplicateSelected: (id: string) => void;
  onResetSelected: (id: string) => void;
  onDeleteSelected: (id: string) => void;
  onNudgeSelected: (id: string, delta: NonNullable<SimulationCommand["delta"]>) => void;
}) {
  const props = info?.props ?? [];
  return (
    <WSPanel title="Props" meta={tool === "prop" ? "click place" : "agent tool"} className="ws-prop-panel">
      <div className="ws-row-stack" data-testid="pilot-prop-panel">
        <div className="ws-btn-row">
          <WSPill active={tool === "agent"} onClick={() => onToolChange("agent")}>
            Agent
          </WSPill>
          <WSPill active={tool === "prop"} onClick={() => onToolChange("prop")}>
            Prop
          </WSPill>
        </div>
        <div className="ws-btn-row">
          {propPresets.map((entry) => (
            <WSPill key={entry} active={preset === entry} onClick={() => onPresetChange(entry)}>
              {entry === "crate" ? "Crate" : "Tall"}
            </WSPill>
          ))}
        </div>
        <div className={`ws-placement-state ${placement?.status ?? "idle"}`} data-testid="pilot-prop-placement-status">
          <span>{tool === "prop" ? preset : "agent"}</span>
          <b>{tool === "prop" ? placement?.message ?? "click canvas" : "spawn click"}</b>
        </div>
        <div className="ws-kv" data-testid="pilot-prop-count">
          <span>props</span>
          <b>{info?.dynamicBodies ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>footprint</span>
          <b>{(tool === "prop" ? propPresetFootprint(preset) : agentFootprintRadius).toFixed(2)}m</b>
        </div>
        <div className="ws-btn-row">
          <WSButton onClick={onReset}>Reset Props</WSButton>
        </div>
        <div className="ws-prop-list" data-testid="pilot-prop-list">
          {props.length ? (
            props.slice(-6).map((prop) => (
              <button
                aria-label={`Select prop ${prop.label}`}
                aria-pressed={selectedPropId === prop.id}
                className={`ws-prop-row ${prop.contactState}`}
                key={prop.id}
                onClick={() => onSelectProp(prop.id)}
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
            <div className="ws-kv" data-testid="selected-prop-contact">
              <span>contact</span>
              <b>{selectedProp.contactState}</b>
            </div>
            <div className="ws-kv">
              <span>pose</span>
              <b data-testid="selected-prop-pose">{formatPropPose(selectedProp)}</b>
            </div>
            <div className="ws-kv">
              <span>footprint</span>
              <b>{selectedProp.footprintRadius.toFixed(2)}m</b>
            </div>
            <div className={`ws-placement-state ${draggingPropId === selectedProp.id ? placement?.status ?? "pending" : "idle"}`} data-testid="selected-prop-move-status">
              <span>move</span>
              <b>{draggingPropId === selectedProp.id ? placement?.message ?? "pending" : "idle"}</b>
            </div>
            <div className="ws-btn-row ws-prop-actions">
              <WSButton onClick={() => onDuplicateSelected(selectedProp.id)}>Duplicate</WSButton>
              <WSButton onClick={() => onResetSelected(selectedProp.id)}>Reset Selected</WSButton>
              <WSButton onClick={() => onDeleteSelected(selectedProp.id)}>Delete Selected</WSButton>
            </div>
            <div className="ws-prop-nudge" data-testid="selected-prop-nudge">
              <WSButton aria-label="Nudge selected prop west" onClick={() => onNudgeSelected(selectedProp.id, { x: -0.12, z: 0 })}>
                -X
              </WSButton>
              <WSButton aria-label="Nudge selected prop east" onClick={() => onNudgeSelected(selectedProp.id, { x: 0.12, z: 0 })}>
                +X
              </WSButton>
              <WSButton aria-label="Nudge selected prop north" onClick={() => onNudgeSelected(selectedProp.id, { x: 0, z: -0.12 })}>
                -Z
              </WSButton>
              <WSButton aria-label="Nudge selected prop south" onClick={() => onNudgeSelected(selectedProp.id, { x: 0, z: 0.12 })}>
                +Z
              </WSButton>
            </div>
          </div>
        ) : null}
      </div>
    </WSPanel>
  );
}

function SimulationControlPanel({
  info,
  onReset,
  onStep
}: {
  info: PhysicsDebugInfo | null;
  onReset: () => void;
  onStep: () => void;
}) {
  const primaryProp = info?.props?.[0];
  const pose = primaryProp ? `${primaryProp.x.toFixed(2)} · ${primaryProp.y.toFixed(2)} · ${primaryProp.z.toFixed(2)}` : "none";
  return (
    <WSPanel title="Prop Physics" meta="deterministic" className="ws-simulation-panel">
      <div className="ws-row-stack" data-testid="simulation-control-panel">
        <div className="ws-btn-row">
          <WSButton onClick={onReset}>Reset</WSButton>
          <WSButton accent onClick={onStep}>
            Step
          </WSButton>
        </div>
        <div className="ws-kv" data-testid="simulation-step-index">
          <span>step</span>
          <b>{info?.simulationStep ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>fixed dt</span>
          <b>{info?.fixedTimestep ? `${(info.fixedTimestep * 1000).toFixed(2)}ms` : "16.67ms"}</b>
        </div>
        <div className="ws-kv" data-testid="simulation-dynamic-bodies">
          <span>bodies</span>
          <b>{info?.dynamicBodies ?? 0}</b>
        </div>
        <div className="ws-kv" data-testid="simulation-prop-pose">
          <span>{primaryProp?.label ?? "prop"}</span>
          <b>{pose}</b>
        </div>
        <div className="ws-kv">
          <span>state</span>
          <b>{primaryProp?.contactState ?? "paused"}</b>
        </div>
      </div>
    </WSPanel>
  );
}

function PhysicsDebugPanel({
  enabled,
  info,
  onToggle
}: {
  enabled: boolean;
  info: PhysicsDebugInfo | null;
  onToggle: () => void;
}) {
  return (
    <WSPanel title="Physics" meta={enabled ? "overlay on" : "overlay off"} className="ws-physics-panel">
      <div className="ws-row-stack" data-testid="physics-debug-panel">
        <div className="ws-btn-row">
          <WSButton onClick={onToggle}>{enabled ? "Debug Off" : "Debug On"}</WSButton>
        </div>
        <div className="ws-kv">
          <span>status</span>
          <b>{info?.status ?? "unavailable"}</b>
        </div>
        <div className="ws-kv">
          <span>colliders</span>
          <b>{info?.colliders ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>bodies</span>
          <b>{info?.dynamicBodies ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>step</span>
          <b>{info?.simulationStep ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>triangles</span>
          <b>{info?.obstacleTriangles ?? 0}</b>
        </div>
        <div className="ws-kv">
          <span>source</span>
          <b>{info?.source ?? "renderer"}</b>
        </div>
      </div>
    </WSPanel>
  );
}

function getDesktopApi() {
  return window.worldStudioDesktop;
}

function propPresetFootprint(preset: SimulatedPropPreset): number {
  return preset === "tall-crate" ? 0.26 : 0.3;
}

function formatPropPose(prop: SimulatedPropState): string {
  return `${prop.x.toFixed(2)} · ${prop.y.toFixed(2)} · ${prop.z.toFixed(2)}`;
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
  session,
  assetSummary,
  playhead
}: {
  mode: StudioMode;
  session: WorldSession | null;
  assetSummary: AssetSummary | null;
  playhead: number;
}) {
  const title = modes.find((entry) => entry.id === mode)?.label ?? mode;
  return (
    <div className="ws-row-stack">
      <div className="ws-mode-title-row">
        <div className="ws-mode-title">{title}</div>
        <WSChip accent>{session ? "live" : "blank"}</WSChip>
      </div>
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

function ToolRail() {
  return (
    <div className="ws-rail">
      {["◌", "✕", "↺", "⇱"].map((item, index) => (
        <button className={`ws-rail-btn ${index === 0 ? "on" : ""}`} key={item} title={item}>
          {item}
        </button>
      ))}
    </div>
  );
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
