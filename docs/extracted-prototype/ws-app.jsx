// ws-app.jsx — World Studio single-app prototype.
// Modes: Edit (splat inspect/edit/optimize/publish) · Simulate (Dual) · Pilot (Command, WASD-drivable)
//        Sensors (rig config) · Episode (timeline replay)
// Reuses layouts + fragments from ws-artboards-a/b.jsx, ws-studio.jsx and ws-panels.jsx.

function WSStage({ children }) {
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#080604", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 1920, height: 1080, transform: "translate(-50%, -50%) scale(" + scale + ")" }}>
        {children}
      </div>
    </div>
  );
}

const WS_MODES = [
  ["view", "View"],
  ["edit", "Edit"],
  ["sim", "Simulate"],
  ["pilot", "Pilot"],
  ["sensors", "Sensors"],
  ["episode", "Episode"],
];

function ModeSwitcher({ mode, onChange }) {
  return (
    <div className="ws-top-center" style={{ zIndex: 40 }}>
      <div className="ws-panel ws-mode-switch">
        <span className="ws-head" style={{ marginRight: 10 }}>Mode</span>
        {WS_MODES.map(([id, label]) => (
          <WSPill key={id} active={id === mode} small onClick={() => onChange(id)}>{label}</WSPill>
        ))}
      </div>
    </div>
  );
}

const WS_CLASSES = [
  ["sofa", "#d9764a", "8,412"], ["table", "#c9a93f", "2,180"], ["lamp", "#e8e26a", "1,022"],
  ["plant", "#4fae62", "1,940"], ["shelf", "#8f6fd9", "3,310"], ["rug", "#b04a8f", "4,505"],
  ["window", "#4fc3d9", "2,002"], ["floor", "#5b6f8a", "12,604"], ["wall", "#3d4a5c", "9,198"],
];

function ClassLegend({ isolate, onIsolate }) {
  return (
    <WSPanel title="Classes" right={isolate ? "9 · " + isolate + " isolated" : "9 · all visible"} pad={false} className="ws-legend">
      <div className="ws-legend-body">
        {WS_CLASSES.map(([name, color, count]) => (
          <div key={name} className={"ws-class-row" + (name === isolate ? " active" : "")} style={{ cursor: "pointer" }}
            onClick={() => onIsolate(isolate === name ? null : name)}>
            <span className="ws-class-swatch" style={{ background: color }}></span>
            <span className="ws-row-name">{name}</span>
            <WSChip>{count}</WSChip>
            <span className="ws-row-eye"><WSIcon name="eye" size={13} /></span>
          </div>
        ))}
      </div>
      <div className="ws-tree-foot">
        <span className="ws-key-group"><WSKey>I</WSKey><span className="ws-foot-label">isolate</span></span>
        <span className="ws-key-group"><WSKey>0–9</WSKey><span className="ws-foot-label">class</span></span>
      </div>
    </WSPanel>
  );
}

const WS_VIEW_MODES = [["splat", "Gaussians"], ["points", "Points"], ["mesh", "Mesh"], ["semantic", "Semantic"], ["depth", "Depth"]];
const WS_MODE_META = {
  splat: ["gaussians", "10,05,385 splats"],
  points: ["points", "47,173 pts"],
  mesh: ["mesh", "12,408 tri"],
  semantic: ["semantic", "9 classes"],
  depth: ["depth", "0.4–11.2 m"],
};

// View mode — read-only inspection: render modes, world tree, class isolation.
function ViewMode({ t }) {
  const [vmode, setVmodeRaw] = React.useState(() => localStorage.getItem("ws-app-vmode") || "splat");
  const setVmode = (v) => { setVmodeRaw(v); localStorage.setItem("ws-app-vmode", v); };
  const [isolate, setIsolate] = React.useState(null);
  const meta = WS_MODE_META[vmode];
  return (
    <div className={wsRoot(t)} data-screen-label="Mode — View">
      <WSCanvas mode={vmode} accent={t.accent} yaw={0.7} pitch={0.4} dist={6.8}
        highlight={vmode === "semantic" || vmode === "mesh" ? isolate : null} />
      <div className="ws-overlay">
        <div className="ws-top-left">
          <WSWordmark scene="LOFT_04" sub="WORLD" />
        </div>
        <div className="ws-top-center" style={{ top: 96 }}>
          <div className="ws-panel ws-mode-switch">
            <span className="ws-head" style={{ marginRight: 10 }}>Render</span>
            {WS_VIEW_MODES.map(([id, label]) => (
              <WSPill key={id} active={id === vmode} small onClick={() => setVmode(id)}>{label}</WSPill>
            ))}
          </div>
        </div>
        <div className="ws-left"><WorldTree t={t}
          activeRow={vmode === "points" ? "points" : vmode === "mesh" ? "mesh" : "splat"}
          onSelect={setVmode} /></div>
        {(vmode === "semantic" || vmode === "mesh") ? (
          <div className="ws-right-col" style={{ top: 170 }}>
            <ClassLegend isolate={isolate} onIsolate={setIsolate} />
          </div>
        ) : (t.showRig ? <div className="ws-top-right"><RigTopology t={t} /></div> : null)}
        {t.showModeCard ? (
          <div className="ws-bottom-right">
            <WSPanel className="ws-mode-card">
              <div className="ws-mode-title-row">
                <span className="ws-mode-title">{meta[0]}</span>
                <WSChip accent>{meta[1]}</WSChip>
              </div>
              <div className="ws-head" style={{ marginBottom: 8 }}>
                {vmode === "depth" ? "metric depth · magma ramp" : vmode === "semantic" ? "CH 3 (instance) · argmax" : "SH degree 3 · α-blend"}
              </div>
              {vmode === "depth" || vmode === "semantic" ? null : <WSRamp from={0} to={0.978} label="magma" />}
              <WSSliderRow label="Opacity" value="92" pct={92} />
              <WSSliderRow label={vmode === "points" ? "Point size" : "Splat scale"} value="1.00" pct={50} />
            </WSPanel>
          </div>
        ) : null}
        {(t.showTimeline || t.showControls) ? (
          <div className="ws-bottom-center"><div className="ws-bottom-stack">
            {t.showTimeline ? <Timeline t={t} frame={182} playing recording /> : null}
            {t.showControls ? <WSControlsBar controls={WS_CONTROLS.view} /> : null}
          </div></div>
        ) : null}
        <WSStatusBar items={[
          { text: "loft_04 · mipnerf360 capture · 292 frames" },
          { text: "physics: bullet @ 240 Hz" },
          { text: "GPU 2.6 / 12.9 GB" },
          { text: meta[0] + " · 62 fps", acc: true },
        ]} />
      </div>
    </div>
  );
}

function PilotMode({ t }) {
  const [agent, setAgent] = React.useState({ x: 1.5, z: -0.5, heading: 4.4 });
  const [traj, setTraj] = React.useState([[-1.4, 1.2], [-0.6, 1.1], [0.2, 1.0], [0.9, 0.9], [1.4, 0.3], [1.5, -0.5]]);
  const [padKey, setPadKey] = React.useState(null);
  const [steps, setSteps] = React.useState(64);

  React.useEffect(() => {
    const down = (e) => {
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d"].includes(k)) return;
      e.preventDefault();
      setPadKey(k);
      setAgent((a) => {
        let { x, z, heading } = a;
        if (k === "a") heading -= Math.PI / 12;
        else if (k === "d") heading += Math.PI / 12;
        else {
          const dir = k === "w" ? 1 : -1;
          x = Math.max(-2.7, Math.min(2.7, x + Math.cos(heading) * 0.25 * dir));
          z = Math.max(-2.2, Math.min(2.2, z + Math.sin(heading) * 0.25 * dir));
          setTraj((tr) => [...tr.slice(-24), [x, z]]);
        }
        return { x, z, heading };
      });
      setSteps((s) => Math.min(120, s + 1));
    };
    const up = () => setPadKey(null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  return <LayoutCommand t={t} agent={agent} traj={traj} padKey={padKey} stripTop={96} frame={steps} total={120} />;
}

function WorldStudioApp() {
  const [t, setTweak] = useTweaks(WS_APP_TWEAKS);
  const [mode, setMode] = React.useState(() => {
    const m = localStorage.getItem("ws-app-mode");
    return m && WS_MODES.some(([id]) => id === m) ? m : "view";
  });
  React.useEffect(() => { localStorage.setItem("ws-app-mode", mode); }, [mode]);

  return (
    <React.Fragment>
      <WSStage>
        <div className={wsRoot(t)} style={wsVars(t)}>
          {mode === "view" ? <ViewMode t={t} /> : null}
          {mode === "edit" ? <StudioMode t={t} modeName="Edit" embedded /> : null}
          {mode === "sim" ? <LayoutDual t={t} /> : null}
          {mode === "pilot" ? <PilotMode t={t} /> : null}
          {mode === "sensors" ? <ScreenRig t={t} /> : null}
          {mode === "episode" ? <ScreenTimeline t={t} /> : null}
          <ModeSwitcher mode={mode} onChange={setMode} />
        </div>
      </WSStage>
      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakColor label="Accent" value={t.accent}
          options={["#E0683A", "#4A8FD9", "#3FAE7C", "#C9A93F"]}
          onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Panels" />
        <TweakRadio label="Style" value={t.panels} options={["floating", "docked"]}
          onChange={(v) => setTweak("panels", v)} />
        <TweakRadio label="Density" value={t.density} options={["regular", "compact"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakSection label="Visibility" />
        <TweakToggle label="Tool rail" value={t.showRail} onChange={(v) => setTweak("showRail", v)} />
        <TweakToggle label="Rig topology" value={t.showRig} onChange={(v) => setTweak("showRig", v)} />
        <TweakToggle label="Render-mode card" value={t.showModeCard} onChange={(v) => setTweak("showModeCard", v)} />
        <TweakToggle label="Timeline" value={t.showTimeline} onChange={(v) => setTweak("showTimeline", v)} />
        <TweakToggle label="Controls bar" value={t.showControls} onChange={(v) => setTweak("showControls", v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}

Object.assign(window, { WorldStudioApp, WSStage, ModeSwitcher, ClassLegend, ViewMode, PilotMode });
