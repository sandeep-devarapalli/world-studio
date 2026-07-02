// ws-panels.jsx — shared World Studio panel language (floating panels, mono labels)
// Exports to window: WSPanel, WSHead, WSChip, WSPill, WSKey, WSSliderRow, WSLayerRow,
// WSToolRail, WSWordmark, WSCanvas, WSIcon, WSDot, WSRamp, WSStatusBar

const WSIcons = {
  select: <path d="M5 3l12 7-5.2 1.6L9 17z" />,
  move: <path d="M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5" />,
  spawn: <path d="M10 2l7 4v8l-7 4-7-4V6zM10 10l7-4M10 10L3 6M10 10v8" />,
  agent: <path d="M10 3a3 3 0 110 6 3 3 0 010-6zM5 17c0-2.8 2.2-5 5-5s5 2.2 5 5M10 1v2" />,
  camera: <path d="M3 6h4l1.5-2h3L13 6h4v9H3zM10 13.4a2.9 2.9 0 100-5.8 2.9 2.9 0 000 5.8z" />,
  ruler: <path d="M2 14L14 2l4 4L6 18zM6.5 9.5l1.6 1.6M9.5 6.5l1.6 1.6M12.5 3.5l1.6 1.6" />,
  layers: <path d="M10 2l8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" />,
  play: <path d="M6 4l10 6-10 6z" fill="currentColor" stroke="none" />,
  pause: <path d="M6 4h2.6v12H6zM11.4 4H14v12h-2.6z" fill="currentColor" stroke="none" />,
  eye: <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 12.2a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4z" />,
  chev: <path d="M7 4.5L13 10l-6 5.5" />,
  chevD: <path d="M4.5 7L10 13l5.5-6" />,
  rec: <circle cx="10" cy="10" r="5" fill="currentColor" stroke="none" />,
  lidar: <path d="M10 10m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M10 10m-4.6 0a4.6 4.6 0 1 0 9.2 0M10 10m-7.6 0a7.6 7.6 0 1 0 15.2 0" />,
  imu: <path d="M4 10a6 6 0 0112 0M2 10a8 8 0 0116 0M10 10l3.5-3.5M10 10.2a.2.2 0 100-.4.2.2 0 000 .4z" />,
  skip: <path d="M4 4l7 6-7 6zM13 4h2.4v12H13z" fill="currentColor" stroke="none" />,
  brush: <path d="M3 17c2.6-.4 3.2-1.6 4.4-2.8L14 7.6l-1.6-1.6-6.6 6.6C4.6 13.8 3.4 14.4 3 17zM13.5 4.9l1.6-1.6 1.6 1.6-1.6 1.6z" />,
  orbit: <path d="M10 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M10 10m-8.2 0a8.2 3.4 0 1 0 16.4 0a8.2 3.4 0 1 0-16.4 0" />,
  rect: <path d="M3.5 5.5h13v9h-13z" strokeDasharray="2.5 2" />,
  crop: <path d="M5.5 1.5v13h13M1.5 5.5h13v13" />,
  undo: <path d="M4 8.5h8.5a3.5 3.5 0 110 7H9M4 8.5L7 5.5M4 8.5l3 3" />,
  upload: <path d="M10 13.5V3.5M6 7l4-4 4 4M3.5 16.5h13" />,
  mouseL: <g><path d="M10 2.75V9H5.75V7A4.25 4.25 0 0 1 10 2.75z" fill="currentColor" stroke="none" /><rect x="5.75" y="2.75" width="8.5" height="14.5" rx="4.25" /><path d="M10 2.75V9M5.75 9h8.5" /></g>,
  mouseR: <g><path d="M10 2.75A4.25 4.25 0 0 1 14.25 7v2H10z" fill="currentColor" stroke="none" /><rect x="5.75" y="2.75" width="8.5" height="14.5" rx="4.25" /><path d="M10 2.75V9M5.75 9h8.5" /></g>,
  wheel: <g><rect x="5.75" y="2.75" width="8.5" height="14.5" rx="4.25" /><rect x="9.1" y="5.2" width="1.8" height="4.4" rx="0.9" fill="currentColor" stroke="none" /></g>,
};

function WSIcon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">{WSIcons[name]}</svg>
  );
}

function WSPanel({ title, right, children, style, className, pad }) {
  return (
    <div className={"ws-panel " + (className || "")} style={style}>
      {title ? (
        <div className="ws-panel-head">
          <span className="ws-head">{title}</span>
          {right ? <span className="ws-head-right">{right}</span> : null}
        </div>
      ) : null}
      <div className="ws-panel-body" style={pad === false ? { padding: 0 } : null}>{children}</div>
    </div>
  );
}

function WSHead({ children }) { return <div className="ws-head">{children}</div>; }
function WSChip({ children, accent }) { return <span className={"ws-chip" + (accent ? " acc" : "")}>{children}</span>; }
function WSKey({ children }) { return <span className="ws-key">{children}</span>; }
function WSDot({ color, pulse }) { return <span className={"ws-dot" + (pulse ? " pulse" : "")} style={{ background: color }}></span>; }

function WSPill({ children, active, onClick, small }) {
  return <button className={"ws-pill" + (active ? " on" : "") + (small ? " sm" : "")} onClick={onClick}>{children}</button>;
}

function WSSliderRow({ label, value, pct, mono }) {
  return (
    <div className="ws-slider-row">
      <span className="ws-head" style={{ flex: "0 0 auto" }}>{label}</span>
      <div className="ws-track"><div className="ws-fill" style={{ width: (pct ?? 60) + "%" }}></div><div className="ws-thumb" style={{ left: (pct ?? 60) + "%" }}></div></div>
      <span className="ws-mono-val">{value}</span>
    </div>
  );
}

function WSLayerRow({ name, chip, depth, open, active, icon, dim, onClick }) {
  return (
    <div className={"ws-layer-row" + (active ? " active" : "") + (dim ? " dim" : "")}
      style={{ paddingLeft: 14 + (depth || 0) * 18, cursor: onClick ? "pointer" : undefined }} onClick={onClick}>
      {open !== undefined ? <span className={"ws-tw" + (open ? " open" : "")}><WSIcon name="chev" size={11} /></span> : <span className="ws-tw-sp"></span>}
      {icon ? <span className="ws-row-ic"><WSIcon name={icon} size={14} /></span> : null}
      <span className="ws-row-name">{name}</span>
      {chip ? <WSChip>{chip}</WSChip> : null}
    </div>
  );
}

function WSToolRail({ active, vertical = true, tools }) {
  const list = tools || ["select", "move", "spawn", "agent", "camera", "ruler"];
  return (
    <div className={"ws-rail" + (vertical ? "" : " horiz")}>
      {list.map((t) => (
        <button key={t} className={"ws-rail-btn" + (t === active ? " on" : "")} title={t}>
          <WSIcon name={t} size={19} />
        </button>
      ))}
    </div>
  );
}

function WSWordmark({ scene, sub }) {
  return (
    <div className="ws-panel ws-wordmark">
      <div className="ws-logo-glyph">
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="15" r="3.2" fill="var(--acc)" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <circle key={i} cx={15 + Math.cos(i * Math.PI / 4) * 9.5} cy={15 + Math.sin(i * Math.PI / 4) * 9.5} r="1.3" fill="var(--acc)" opacity={0.35 + (i % 4) * 0.16} />
          ))}
        </svg>
      </div>
      <div>
        <div className="ws-logo-name">World Studio</div>
        <div className="ws-logo-sub">{sub || "SCENE"} · {scene}</div>
      </div>
    </div>
  );
}

function WSRamp({ from = 0, to = 1, label }) {
  return (
    <div className="ws-ramp-wrap">
      <div className="ws-ramp"></div>
      <div className="ws-ramp-vals"><span>{from.toFixed(4)}</span><span>{((from + to) / 2).toFixed(4)}</span><span>{to.toFixed(4)}</span></div>
      {label ? <div className="ws-ramp-label"><span className="ws-chip">{label}</span><span className="ws-ramp-note">· 1–99 pct stretch</span></div> : null}
    </div>
  );
}

function WSStatusBar({ items }) {
  return (
    <div className="ws-statusbar">
      {items.map((it, i) => <span key={i} className={"ws-status-item" + (it.acc ? " acc" : "")}>{it.text}</span>)}
    </div>
  );
}

// ---- controls bar — per-mode input bindings (bottom-center capsule) ----
const WS_MOUSE_GLYPHS = { "@LMB": "mouseL", "@RMB": "mouseR", "@WHEEL": "wheel" };

const WS_CONTROLS = {
  view: [["Move", ["W", "A", "S", "D"]], ["Rise / Fall", ["Q", "E"]], ["Orbit", ["@LMB"]], ["Pan", ["@RMB"]], ["Zoom", ["@WHEEL"]], ["Fullscreen", ["F11"]]],
  edit: [["Brush", ["@LMB"]], ["Orbit", ["Alt", "@LMB"]], ["Pan", ["@RMB"]], ["Zoom", ["@WHEEL"]], ["Radius", ["[", "]"]], ["Undo", ["⌘", "Z"]]],
  sim: [["Scrub", ["←", "→"]], ["Play", ["Space"]], ["Orbit", ["@LMB"]], ["Zoom", ["@WHEEL"]]],
  pilot: [["Drive", ["W", "A", "S", "D"]], ["Orbit", ["@LMB"]], ["Pan", ["@RMB"]], ["Zoom", ["@WHEEL"]]],
  sensors: [["Orbit", ["@LMB"]], ["Pan", ["@RMB"]], ["Zoom", ["@WHEEL"]], ["Grab / Place", ["G"]], ["Add sensor", ["N"]]],
  episode: [["Play", ["Space"]], ["Step", ["←", "→"]], ["Orbit", ["@LMB"]], ["Zoom", ["@WHEEL"]]],
};

function WSControlsBar({ controls }) {
  return (
    <div className="ws-panel ws-ctrlbar">
      {controls.map(([label, keys]) => (
        <span key={label} className="ws-ctrl">
          <span className="ws-ctrl-label">{label}</span>
          <span className="ws-key-group">
            {keys.map((k, i) => WS_MOUSE_GLYPHS[k]
              ? <span key={i} className="ws-key ws-key-mouse"><WSIcon name={WS_MOUSE_GLYPHS[k]} size={15} /></span>
              : <span key={i} className="ws-key">{k}</span>)}
          </span>
        </span>
      ))}
    </div>
  );
}

// ---- interactive viewport canvas (drag to orbit) ----
function WSCanvas({ mode = "splat", yaw = 0.6, pitch = 0.42, dist = 7.2, target, fov, agent, frustums, trajectory, highlight, feed, accent, grid, bg, style, density, cw = 1920, ch = 1080 }) {
  const ref = React.useRef(null);
  const view = React.useRef({ yaw, pitch });
  const [, force] = React.useState(0);

  const draw = React.useCallback(() => {
    const c = ref.current;
    if (!c || !window.WSRender) return;
    const opts = { mode, yaw: view.current.yaw, pitch: view.current.pitch, dist, target, fov, agent, frustums, trajectory, highlight, accent, grid, bg, density };
    if (feed) window.WSRender.renderFeed(c, opts);
    else window.WSRender.render(c, opts);
  }, [mode, dist, fov, agent, frustums, trajectory, highlight, accent, grid, bg, feed, density, target && target.join(",")]);

  React.useEffect(() => { view.current = { yaw, pitch }; draw(); }, [draw, yaw, pitch]);

  const onDown = (e) => {
    const c = ref.current;
    const start = { x: e.clientX, y: e.clientY, yaw: view.current.yaw, pitch: view.current.pitch };
    const move = (ev) => {
      view.current.yaw = start.yaw + (ev.clientX - start.x) * 0.006;
      view.current.pitch = Math.max(0.05, Math.min(1.2, start.pitch + (ev.clientY - start.y) * 0.004));
      draw();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.stopPropagation();
  };

  return <canvas ref={ref} width={cw} height={ch} className="ws-canvas" style={style} onPointerDown={onDown}></canvas>;
}

Object.assign(window, { WSPanel, WSHead, WSChip, WSPill, WSKey, WSDot, WSSliderRow, WSLayerRow, WSToolRail, WSWordmark, WSCanvas, WSIcon, WSRamp, WSStatusBar, WSControlsBar, WS_CONTROLS });
