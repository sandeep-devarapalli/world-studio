// ws-studio.jsx — "Studio" mode proposal: inspect, edit, optimize & publish 3DGS
// (SuperSplat-style workflow in the World Studio panel language.)
// Live in this proposal: orbit, brush-select, invert/clear/delete/undo + history,
// outlier removal, SH-degree + format size estimates, publish flow, brightness.

const STUDIO_N = window.WSRender.scene.pts.length;
const STUDIO_SPP = 59; // display splats per procedural point
const studioFmtIN = (n) => Math.round(n).toLocaleString("en-IN");
const STUDIO_SH_BYTES = { 0: 60, 1: 96, 2: 156, 3: 248 };
const STUDIO_FMT = { ".ply": 1, ".splat": 0.13, ".sogs": 0.05 };

function StudioSlider({ label, value, min, max, onChange, fmt }) {
  const ref = React.useRef(null);
  const pct = ((value - min) / (max - min)) * 100;
  const set = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(min + u * (max - min));
  };
  const down = (e) => {
    e.preventDefault();
    set(e.clientX);
    const mv = (ev) => set(ev.clientX);
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="ws-slider-row">
      <span className="ws-head" style={{ flex: "0 0 auto" }}>{label}</span>
      <div style={{ flex: 1, padding: "8px 0", cursor: "pointer" }} onPointerDown={down}>
        <div className="ws-track" ref={ref}>
          <div className="ws-fill" style={{ width: pct + "%" }}></div>
          <div className="ws-thumb" style={{ left: pct + "%" }}></div>
        </div>
      </div>
      <span className="ws-mono-val">{fmt ? fmt(value) : Math.round(value)}</span>
    </div>
  );
}

function StudioSwitcher({ name }) {
  return (
    <div className="ws-top-center" style={{ zIndex: 40 }}>
      <div className="ws-panel ws-mode-switch">
        <span className="ws-head" style={{ marginRight: 10 }}>Mode</span>
        <WSPill active small>{name}</WSPill>
        {["Simulate", "Pilot", "Sensors", "Episode"].map((m) => (
          <button key={m} className="ws-pill sm inert" title="Inert in this proposal">{m}</button>
        ))}
      </div>
    </div>
  );
}

function StudioMode({ t, modeName, embedded }) {
  const [vmode, setVmode] = React.useState("splat");
  const [tool, setTool] = React.useState("brush");
  const [brushR, setBrushR] = React.useState(60);
  const [exposure, setExposure] = React.useState(1);
  const [showDeleted, setShowDeleted] = React.useState(true);
  const [shDeg, setShDeg] = React.useState(3);
  const [fmt, setFmt] = React.useState(".sogs");
  const [pub, setPub] = React.useState("idle"); // idle | busy | done
  const [counts, setCounts] = React.useState({ sel: 0, del: 0 });
  const [history, setHistory] = React.useState([]);
  const sel = React.useRef(new Uint8Array(STUDIO_N));
  const del = React.useRef(new Uint8Array(STUDIO_N));
  const undoStack = React.useRef([]);
  const view = React.useRef({ yaw: 0.7, pitch: 0.4, dist: 6.8 });
  const canvasRef = React.useRef(null);
  const ringRef = React.useRef(null);

  const draw = React.useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    window.WSRender.render(c, {
      mode: vmode, yaw: view.current.yaw, pitch: view.current.pitch, dist: view.current.dist,
      accent: t.accent, selected: sel.current, deleted: del.current, showDeleted, exposure,
    });
  }, [vmode, t.accent, showDeleted, exposure]);
  React.useEffect(draw, [draw]);

  const recount = () => {
    let s = 0, d = 0;
    for (let i = 0; i < STUDIO_N; i++) { if (del.current[i]) d++; else if (sel.current[i]) s++; }
    setCounts({ sel: s, del: d });
  };
  const pushOp = (label, op) => {
    undoStack.current.push(op);
    setHistory((h) => [{ label }, ...h].slice(0, 6));
  };

  // ---- edit actions ----
  const doDelete = () => {
    const idx = [];
    for (let i = 0; i < STUDIO_N; i++) if (sel.current[i] && !del.current[i]) idx.push(i);
    if (!idx.length) return;
    idx.forEach((i) => { del.current[i] = 1; sel.current[i] = 0; });
    pushOp("Delete · " + studioFmtIN(idx.length * STUDIO_SPP), { type: "delete", indices: idx, resel: true });
    recount(); draw();
  };
  const doInvert = () => {
    for (let i = 0; i < STUDIO_N; i++) if (!del.current[i]) sel.current[i] ^= 1;
    pushOp("Invert selection", { type: "invert" });
    recount(); draw();
  };
  const doClear = () => {
    const idx = [];
    for (let i = 0; i < STUDIO_N; i++) if (sel.current[i]) { idx.push(i); sel.current[i] = 0; }
    if (!idx.length) return;
    pushOp("Clear selection", { type: "select-off", indices: idx });
    recount(); draw();
  };
  const doOutliers = () => {
    const idx = [];
    for (let i = 0; i < STUDIO_N; i++) if (!del.current[i] && Math.random() < 0.02) idx.push(i);
    idx.forEach((i) => { del.current[i] = 1; sel.current[i] = 0; });
    pushOp("Remove outliers · " + studioFmtIN(idx.length * STUDIO_SPP), { type: "delete", indices: idx, resel: false });
    recount(); draw();
  };
  const doUndo = () => {
    const op = undoStack.current.pop();
    if (!op) return;
    if (op.type === "delete") op.indices.forEach((i) => { del.current[i] = 0; if (op.resel) sel.current[i] = 1; });
    else if (op.type === "select-on") op.indices.forEach((i) => { sel.current[i] = 0; });
    else if (op.type === "select-off") op.indices.forEach((i) => { sel.current[i] = 1; });
    else if (op.type === "invert") { for (let i = 0; i < STUDIO_N; i++) if (!del.current[i]) sel.current[i] ^= 1; }
    setHistory((h) => h.slice(1));
    recount(); draw();
  };

  // ---- canvas interaction ----
  const toCanvasXY = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 1920, ((e.clientY - r.top) / r.height) * 1080];
  };
  const onDown = (e) => {
    if (tool === "brush") {
      const changed = [];
      const paint = (ev) => {
        const [x, y] = toCanvasXY(ev);
        const idx = window.WSRender.collectInRadius(view.current, 1920, 1080, x, y, brushR);
        let dirty = false;
        for (const i of idx) if (!sel.current[i] && !del.current[i]) { sel.current[i] = 1; changed.push(i); dirty = true; }
        if (dirty) draw();
        moveRing(ev);
      };
      paint(e);
      const up = () => {
        window.removeEventListener("pointermove", paint);
        window.removeEventListener("pointerup", up);
        if (changed.length) { pushOp("Brush select · " + studioFmtIN(changed.length * STUDIO_SPP), { type: "select-on", indices: changed }); recount(); }
      };
      window.addEventListener("pointermove", paint);
      window.addEventListener("pointerup", up);
    } else {
      const start = { x: e.clientX, y: e.clientY, yaw: view.current.yaw, pitch: view.current.pitch };
      const mv = (ev) => {
        view.current.yaw = start.yaw + (ev.clientX - start.x) * 0.006;
        view.current.pitch = Math.max(0.05, Math.min(1.2, start.pitch + (ev.clientY - start.y) * 0.004));
        draw();
      };
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
    }
  };
  const moveRing = (e) => {
    const ring = ringRef.current;
    if (!ring || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const scale = r.width / 1920;
    ring.style.left = (e.clientX - r.left) / scale + "px";
    ring.style.top = (e.clientY - r.top) / scale + "px";
    ring.style.width = brushR * 2 + "px";
    ring.style.height = brushR * 2 + "px";
    ring.style.opacity = tool === "brush" ? 1 : 0;
  };

  // ---- derived stats ----
  const alive = STUDIO_N - counts.del;
  const splats = alive * STUDIO_SPP;
  const sizeMB = (splats * STUDIO_SH_BYTES[shDeg] * STUDIO_FMT[fmt]) / 1e6;
  const doPublish = () => {
    if (pub === "busy") return;
    setPub("busy");
    setTimeout(() => setPub("done"), 1900);
  };

  return (
    <div className={wsRoot(t)} style={wsVars(t)} data-screen-label={"Mode — " + modeName} onPointerMove={moveRing}>
      <canvas ref={canvasRef} width={1920} height={1080} className="ws-canvas"
        style={{ cursor: tool === "brush" ? "crosshair" : "grab" }} onPointerDown={onDown}></canvas>
      <div ref={ringRef} className="ws-brush-ring" style={{ opacity: 0 }}></div>
      <div className="ws-overlay">
        <div className="ws-top-left">
          <WSWordmark scene="LOFT_04 · v3" sub={modeName} />
          <div className="ws-rail">
            {[["orbit", "orbit"], ["brush", "brush select"], ["rect", "rect select"], ["crop", "crop box"], ["move", "transform"], ["ruler", "measure"]].map(([id, title]) => (
              <button key={id} className={"ws-rail-btn" + (id === tool ? " on" : "")} title={title} onClick={() => setTool(id)}>
                <WSIcon name={id} size={19} />
              </button>
            ))}
          </div>
        </div>
        {embedded ? null : <StudioSwitcher name={modeName} />}
        <div className="ws-top-center" style={{ top: 96 }}>
          <div className="ws-panel ws-mode-switch">
            <span className="ws-head" style={{ marginRight: 10 }}>Render</span>
            {[["splat", "Gaussians"], ["points", "Points"], ["mesh", "Mesh"], ["semantic", "Semantic"], ["depth", "Depth"]].map(([id, label]) => (
              <WSPill key={id} active={id === vmode} small onClick={() => setVmode(id)}>{label}</WSPill>
            ))}
          </div>
        </div>

        <div className="ws-left">
          <WSPanel title="Selection" right={studioFmtIN(counts.sel * STUDIO_SPP) + " splats"}>
            <div className="ws-btn-row" style={{ marginBottom: 10 }}>
              <button className="ws-btn" onClick={doInvert}>Invert</button>
              <button className="ws-btn" onClick={doClear} disabled={!counts.sel}>Clear</button>
              <button className="ws-btn acc" onClick={doDelete} disabled={!counts.sel}>Delete</button>
              <button className="ws-btn" onClick={doUndo} disabled={!history.length}><WSIcon name="undo" size={11} /> Undo</button>
            </div>
            <StudioSlider label="Brush" value={brushR} min={20} max={160} onChange={setBrushR} fmt={(v) => Math.round(v) + "px"} />
            <div className="ws-slider-row" style={{ height: "auto", paddingTop: 4 }}>
              <span className="ws-head" style={{ flex: 1 }}>Ghost deleted</span>
              <span className={"ws-switch" + (showDeleted ? " on" : "")} style={{ cursor: "pointer" }}
                onClick={() => setShowDeleted(!showDeleted)}><span></span></span>
            </div>
          </WSPanel>
          <WSPanel title="History" right={history.length + " ops"} pad={false} style={{ marginTop: 14 }}>
            <div style={{ padding: 6, minHeight: 44 }}>
              {history.length === 0 ? <div className="ws-hist-row">— brush over the splats to select</div> :
                history.map((h, i) => (
                  <div key={history.length - i} className="ws-hist-row">
                    <span className="ws-hist-ix">{String(history.length - i).padStart(2, "0")}</span>{h.label}
                  </div>
                ))}
            </div>
          </WSPanel>
        </div>

        <div className="ws-right-col" style={{ top: 170 }}>
          <WSPanel title="Optimize" right={"SH " + shDeg + " · " + studioFmtIN(splats) + " splats"}>
            <div className="ws-kv"><span>Splats</span><b>{studioFmtIN(splats)}</b></div>
            <div className="ws-kv"><span>Deleted</span><b>{studioFmtIN(counts.del * STUDIO_SPP)}</b></div>
            <div className="ws-kv" style={{ alignItems: "center" }}>
              <span>SH degree</span>
              <span style={{ display: "flex", gap: 6 }}>
                {[0, 1, 2, 3].map((d) => (
                  <span key={d} className={"ws-node click" + (d === shDeg ? " on" : "")} style={{ padding: "4px 9px" }}
                    onClick={() => setShDeg(d)}>{d}</span>
                ))}
              </span>
            </div>
            <StudioSlider label="Brightness" value={exposure} min={0.4} max={1.6} onChange={setExposure} fmt={(v) => v.toFixed(2)} />
            <div className="ws-btn-row" style={{ marginTop: 8 }}>
              <button className="ws-btn" onClick={doOutliers}>Remove outliers</button>
            </div>
          </WSPanel>
          <WSPanel title="Publish" right={sizeMB.toFixed(1) + " MB est"}>
            <div className="ws-kv" style={{ alignItems: "center" }}>
              <span>Format</span>
              <span style={{ display: "flex", gap: 6 }}>
                {[".ply", ".splat", ".sogs"].map((f) => (
                  <span key={f} className={"ws-node click" + (f === fmt ? " on" : "")} style={{ padding: "4px 9px" }}
                    onClick={() => { setFmt(f); setPub("idle"); }}>{f}</span>
                ))}
              </span>
            </div>
            <div className="ws-kv"><span>Est. size</span><b className="acc">{sizeMB.toFixed(1)} MB</b></div>
            {pub === "idle" ? (
              <div className="ws-btn-row" style={{ marginTop: 10 }}>
                <button className="ws-btn acc" style={{ flex: 1, textAlign: "center" }} onClick={doPublish}>
                  <WSIcon name="upload" size={11} /> Publish to World Hub
                </button>
                <button className="ws-btn">Export</button>
              </div>
            ) : pub === "busy" ? (
              <div style={{ marginTop: 14 }}>
                <div className="ws-progress"><div style={{ width: "92%" }}></div></div>
                <div className="ws-head" style={{ marginTop: 8 }}>Compressing {fmt} · uploading…</div>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <div className="ws-kv"><span>Live at</span><b className="acc">hub.worldstudio.dev/s/loft04_v3</b></div>
                <div className="ws-btn-row" style={{ marginTop: 6 }}>
                  <button className="ws-btn">Copy link</button>
                  <button className="ws-btn" onClick={() => setPub("idle")}>Republish</button>
                </div>
              </div>
            )}
          </WSPanel>
        </div>

        {t.showControls ? <div className="ws-bottom-center"><WSControlsBar controls={WS_CONTROLS.edit} /></div> : null}
        <WSStatusBar items={[
          { text: modeName.toLowerCase() + " mode · view + edit + optimize + publish" },
          { text: "loft_04 · v3 · gaussian field" },
          { text: studioFmtIN(splats) + " splats", acc: true },
        ]} />
      </div>
    </div>
  );
}

Object.assign(window, { StudioMode, StudioSlider, StudioSwitcher });
