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
  AgentState,
  AuthorityStatus,
  CameraState,
  LocalWorldPackagePayload,
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

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<{ kind: "orbit" | "brush"; x: number; y: number } | null>(null);
  const brushStrokeRef = useRef<Set<number>>(new Set());
  const [scale, setScale] = useState(1);
  const [mode, setMode] = useStoredState<StudioMode>("ws-app-mode", "view");
  const [renderMode, setRenderMode] = useStoredState<RenderMode>("ws-app-vmode", "splat");
  const [accentName, setAccentName] = useStoredState<keyof typeof accents>("ws-app-accent", "ember");
  const [dense, setDense] = useStoredState("ws-app-density", false);
  const [docked, setDocked] = useStoredState("ws-app-docked", false);
  const [session, setSession] = useState<WorldSession | null>(null);
  const [assetSummary, setAssetSummary] = useState<AssetSummary | null>(null);
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
  const [agent, setAgent] = useState<AgentState>({ x: 1.5, z: -0.5, heading: 4.4 });
  const [trajectory, setTrajectory] = useState<Array<[number, number]>>([[1.5, -0.5]]);
  const [sensors, setSensors] = useState(initialSensors);
  const [playhead, setPlayhead] = useState(0.28);
  const [playing, setPlaying] = useState(false);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const accent = accents[accentName];

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
      grid: true
    }),
    [accent, agent, camera, deleted, density, exposure, isolatedClass, mode, renderMode, selected, showDeleted, trajectory]
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
  }, [mode, selected, history]);

  const resetTransientState = useCallback((worldSession: WorldSession) => {
    const spawn = worldSession.agentSpawn ?? { x: 1.5, z: -0.5, heading: 4.4 };
    setAgent(spawn);
    setTrajectory([[spawn.x, spawn.z]]);
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
      authorityStatus: "visual_evidence"
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
      authorityStatus: payload.authorityStatus
    });
  }, []);

  const applyLoadedWorld = useCallback((input: LoadedWorldInput) => {
    setLoadError(null);

    if (!input.pointsText) {
      const worldSession = createManifestOnlySession(input);
      setSession(worldSession);
      setRenderer(null);
      setAssetSummary({ gaussianKind: input.gaussianHeaderText ? detectPlyKind(input.gaussianHeaderText) : "unloaded", objFaces: 0, objGroups: 0, pointCount: 0 });
      resetTransientState(worldSession);
      return;
    }

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

  const resetAgent = () => {
    const spawn = session?.agentSpawn ?? { x: 1.5, z: -0.5, heading: 4.4 };
    setAgent(spawn);
    setTrajectory([[spawn.x, spawn.z]]);
  };

  const driveAgent = (key: string) => {
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
      return next;
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "edit" && renderer) {
      interactionRef.current = { kind: "brush", x: event.clientX, y: event.clientY };
      brushStrokeRef.current = new Set();
      paintAt(event);
    } else {
      interactionRef.current = { kind: "orbit", x: event.clientX, y: event.clientY };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.kind === "brush") {
      paintAt(event);
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

  const onPointerUp = () => {
    if (interactionRef.current?.kind === "brush" && brushStrokeRef.current.size) {
      const indices = [...brushStrokeRef.current];
      const entry: HistoryItem = { id: crypto.randomUUID(), type: "select", count: indices.length, indices };
      setHistory((current) => [entry, ...current].slice(0, 10));
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
            onPointerCancel={onPointerUp}
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
              { label: "three.js · spark path", accent: true }
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
      return (
        <WSPanel title="Tracks" meta={`${Math.round(playhead * 180)}f`}>
          <div className="ws-row-stack">
            {["agent", "object", "capture"].map((lane) => (
              <div className="ws-kv" key={lane}>
                <span>{lane}</span>
                <b>{lane === "agent" ? "move · turn · stop" : lane === "object" ? "spawn · collide" : "rgb · depth · seg"}</b>
              </div>
            ))}
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
          <div className="ws-btn-row">
            <WSButton onClick={resetAgent}>Reset</WSButton>
          </div>
        </WSPanel>
      );
    }

    return (
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

function getDesktopApi() {
  return window.worldStudioDesktop;
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
