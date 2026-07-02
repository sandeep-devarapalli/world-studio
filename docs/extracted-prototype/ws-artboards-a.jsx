// ws-artboards-a.jsx — Section 1: three workspace layout variations (1920×1080)
// Uses shared components from ws-panels.jsx. Exports: LayoutOrbital, LayoutDual, LayoutCommand, wsRoot

const wsRoot = (t) =>
  "ws-root " + (t.density === "compact" ? "dense" : "") + " " + (t.panels === "docked" ? "docked" : "floating");

const wsVars = (t) => ({ "--acc": t.accent });

// ---------- shared fragments ----------
function WorldTree({ t, activeRow, onSelect }) {
  return (
    <WSPanel className="ws-tree" pad={false}>
      <div className="ws-search">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5L18 18" /></svg>
        <span className="ws-search-ph">Filter world…  ( / )</span>
        <WSKey>/</WSKey>
      </div>
      <div className="ws-tree-body">
        <div className="ws-group-head"><WSIcon name="chevD" size={11} /><span className="ws-head">Environment</span><span className="ws-head-right">loft_04 · scan v3</span></div>
        <WSLayerRow name="Gaussian field" chip="10,05,385" depth={1} icon="layers" active={activeRow === "splat"}
          onClick={onSelect ? () => onSelect("splat") : undefined} />
        <WSLayerRow name="Point cloud" chip="47,173" depth={1} icon="layers" active={activeRow === "points"}
          onClick={onSelect ? () => onSelect("points") : undefined} />
        <WSLayerRow name="Collision mesh" chip="12,408 tri" depth={1} icon="spawn" active={activeRow === "mesh"}
          onClick={onSelect ? () => onSelect("mesh") : undefined} />
        <div className="ws-group-head"><WSIcon name="chevD" size={11} /><span className="ws-head">Objects</span><span className="ws-head-right">14 props</span></div>
        <WSLayerRow name="sofa_01" chip="phys" depth={1} icon="spawn" />
        <WSLayerRow name="table_coffee" chip="phys" depth={1} icon="spawn" />
        <WSLayerRow name="lamp_floor" chip="light" depth={1} icon="spawn" />
        <WSLayerRow name="plant_ficus" chip="static" depth={1} icon="spawn" dim />
        <div className="ws-group-head"><WSIcon name="chev" size={11} /><span className="ws-head">Agents</span><span className="ws-head-right">1 · locobot</span></div>
        <div className="ws-group-head"><WSIcon name="chev" size={11} /><span className="ws-head">Sensors</span><span className="ws-head-right">rig_a · 6 ch</span></div>
      </div>
      <div className="ws-tree-foot">
        <span className="ws-key-group"><WSKey>←</WSKey><WSKey>→</WSKey><span className="ws-foot-label">layer</span></span>
        <span className="ws-key-group"><WSKey>J</WSKey><WSKey>K</WSKey><span className="ws-foot-label">channel</span></span>
      </div>
    </WSPanel>
  );
}

function ModeCard({ t, mode = "gaussians", chip = "10,05,385 splats" }) {
  return (
    <WSPanel className="ws-mode-card">
      <div className="ws-mode-title-row">
        <span className="ws-mode-title">{mode}</span>
        <WSChip accent>{chip}</WSChip>
      </div>
      <div className="ws-head" style={{ marginBottom: 8 }}>SH degree 3 · α-blend</div>
      <WSRamp from={0} to={0.978} label="magma" />
      <WSSliderRow label="Opacity" value="92" pct={92} />
      <WSSliderRow label="Splat scale" value="1.00" pct={50} />
    </WSPanel>
  );
}

function Timeline({ t, frame = 182, total = 292, playing, recording }) {
  const pct = (frame / total) * 100;
  return (
    <WSPanel className="ws-timeline">
      <button className="ws-play">{playing ? <WSIcon name="pause" size={16} /> : <WSIcon name="play" size={16} />}</button>
      <button className="ws-tl-btn"><WSIcon name="skip" size={13} /></button>
      <div className="ws-tl-track">
        <div className="ws-tl-ticks">{Array.from({ length: 30 }).map((_, i) => <span key={i} className={i % 5 === 0 ? "maj" : ""}></span>)}</div>
        <div className="ws-tl-fill" style={{ width: pct + "%" }}></div>
        <div className="ws-tl-head" style={{ left: pct + "%" }}></div>
      </div>
      <span className="ws-mono-val ws-tl-frame">{String(frame).padStart(4, "0")} / {String(total).padStart(4, "0")}</span>
      {recording ? <span className="ws-rec"><WSDot color="var(--acc)" pulse /> REC</span> : null}
    </WSPanel>
  );
}

function RigTopology({ t }) {
  const Node = ({ children, on }) => <span className={"ws-node" + (on ? " on" : "")}>{children}</span>;
  return (
    <WSPanel title="Sensor rig — rig_a" className="ws-rig">
      <div className="ws-rig-grid">
        <div className="ws-rig-col">
          <Node>CAM F</Node><Node>CAM L</Node><Node>CAM R</Node>
        </div>
        <div className="ws-rig-lines">
          <span></span><span></span><span></span>
        </div>
        <div className="ws-rig-col">
          <Node on>RGB</Node><Node>DEPTH</Node><Node>SEG</Node>
        </div>
      </div>
      <div className="ws-rig-row2">
        <Node>LIDAR · 64ch</Node><Node>IMU · 200Hz</Node>
      </div>
    </WSPanel>
  );
}

// ---------- Layout A — Orbital ----------
function LayoutOrbital({ t }) {
  return (
    <div className={wsRoot(t)} style={wsVars(t)} data-screen-label="Workspace A — Orbital">
      <WSCanvas mode="splat" accent={t.accent} yaw={0.7} pitch={0.4} dist={6.8} agent={{ x: 0.9, z: 0.9, heading: 3.6 }} />
      <div className="ws-overlay">
        <div className="ws-top-left">
          <WSWordmark scene="LOFT_04" sub="WORLD" />
          {t.showRail ? <WSToolRail active="select" /> : null}
        </div>
        <div className="ws-left"><WorldTree t={t} activeRow="splat" /></div>
        {t.showRig ? <div className="ws-top-right"><RigTopology t={t} /></div> : null}
        {t.showModeCard ? <div className="ws-bottom-right"><ModeCard t={t} /></div> : null}
        {(t.showTimeline || t.showControls) ? (
          <div className="ws-bottom-center"><div className="ws-bottom-stack">
            {t.showTimeline ? <Timeline t={t} frame={182} playing recording /> : null}
            {t.showControls ? <WSControlsBar controls={WS_CONTROLS.view} /> : null}
          </div></div>
        ) : null}
        <WSStatusBar items={[
          { text: "loft_04 · mipnerf360 capture · 292 frames" },
          { text: "physics: bullet @ 240 Hz", acc: false },
          { text: "GPU 2.6 / 12.9 GB", acc: false },
          { text: "62 fps", acc: true },
        ]} />
      </div>
    </div>
  );
}

// ---------- Layout B — Dual (sensor feed | world) ----------
function LayoutDual({ t }) {
  return (
    <div className={wsRoot(t)} style={wsVars(t)} data-screen-label="Workspace B — Dual">
      <div className="ws-dual">
        <div className="ws-dual-half">
          <WSCanvas feed accent={t.accent} yaw={-0.4} cw={960} ch={1080} />
          <div className="ws-view-tag"><span className="ws-head">Sensor feed</span><WSChip>cam_front · frame 0182</WSChip></div>
        </div>
        <div className="ws-dual-half">
          <WSCanvas mode="points" accent={t.accent} yaw={0.55} pitch={0.45} dist={7.4} cw={960} ch={1080}
            frustums={[{ x: 1.6, y: 1.3, z: 2.0, yaw: 3.5, label: "cam_front" }]} />
          <div className="ws-view-tag right"><span className="ws-head">Metric view</span><WSChip>aligned · 47,173 pts</WSChip></div>
        </div>
        <div className="ws-dual-split"></div>
      </div>
      <div className="ws-overlay">
        <div className="ws-top-left"><WSWordmark scene="LOFT_04" sub="WORLD" /></div>
        <div className="ws-left ws-frames-panel">
          <WSPanel title="Frames" right="292 · DSCF5565–5857" pad={false}>
            <div className="ws-frame-list">
              {[178, 179, 180, 181, 182, 183, 184].map((f) => (
                <div key={f} className={"ws-frame-row" + (f === 182 ? " active" : "")}>
                  <span className="ws-frame-thumb"></span>
                  <span className="ws-row-name">Frame {f}</span>
                  <WSChip>{f === 182 ? "● live" : "ok"}</WSChip>
                </div>
              ))}
            </div>
          </WSPanel>
        </div>
        <div className="ws-bottom-tray">
          <WSPanel title="Session" className="ws-card">
            <div className="ws-kv"><span>Dataset</span><b>edgs_m1_loft_04</b></div>
            <div className="ws-kv"><span>Splats</span><b>10,05,385</b></div>
            <div className="ws-kv"><span>Loaded</span><b>22:44:48</b></div>
          </WSPanel>
          <WSPanel title="Agent state" className="ws-card">
            <div className="ws-kv"><span>Pose</span><b>x 0.92 · z 0.87 · θ 206°</b></div>
            <div className="ws-kv"><span>Action</span><b>MoveAhead(0.25)</b></div>
            <div className="ws-kv"><span>Collisions</span><b>0</b></div>
          </WSPanel>
          <WSPanel title="Cloud job" className="ws-card">
            <div className="ws-kv"><span>Endpoint</span><b>runpod · edgs-m1</b></div>
            <div className="ws-kv"><span>Job</span><b>1651d9c2 · refine 15k</b></div>
            <div className="ws-kv"><span>Status</span><b className="acc">polling…</b></div>
          </WSPanel>
          {t.showModeCard ? <ModeCard t={t} /> : null}
        </div>
        {(t.showTimeline || t.showControls) ? (
          <div className="ws-bottom-center dual-tl"><div className="ws-bottom-stack">
            {t.showTimeline ? <Timeline t={t} frame={182} playing /> : null}
            {t.showControls ? <WSControlsBar controls={WS_CONTROLS.sim} /> : null}
          </div></div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Layout C — Command (PiP + sensor strip) ----------
function LayoutCommand({ t, agent, traj, padKey, stripTop, frame, total }) {
  const traj2 = traj || [[-2.2, 1.6], [-1.4, 1.2], [-0.6, 1.1], [0.2, 1.0], [0.9, 0.9], [1.4, 0.3], [1.5, -0.5]];
  const ag = agent || { x: 1.5, z: -0.5, heading: 4.4 };
  return (
    <div className={wsRoot(t)} style={wsVars(t)} data-screen-label="Workspace C — Command">
      <WSCanvas mode="splat" accent={t.accent} yaw={2.4} pitch={0.52} dist={7.6}
        agent={ag} trajectory={traj2} />
      <div className="ws-overlay">
        <div className="ws-top-left">
          <WSWordmark scene="LOFT_04 · EP_0042" sub="EPISODE" />
          {t.showRail ? <WSToolRail active="agent" /> : null}
        </div>
        <div className="ws-top-center" style={stripTop ? { top: stripTop } : null}>
          <div className="ws-strip">
            {[
              { m: "splat", lab: "RGB", feed: true },
              { m: "depth", lab: "DEPTH" },
              { m: "semantic", lab: "SEG" },
              { m: "points", lab: "LIDAR" },
            ].map((s) => (
              <div key={s.lab} className={"ws-strip-cell" + (s.lab === "RGB" ? " on" : "")}>
                <WSCanvas mode={s.m} feed={s.feed} accent={t.accent} yaw={-0.4} grid={false} density={0.4} cw={400} ch={240} style={{ borderRadius: 8 }} />
                <span className="ws-strip-lab">{s.lab}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="ws-left ws-spawn-panel">
          <WSPanel title="Spawn props" right="thor_lib · 212" pad={false}>
            <div className="ws-spawn-grid">
              {["sofa", "table", "lamp", "plant", "chair", "shelf", "mug", "book"].map((p) => (
                <div key={p} className="ws-spawn-item"><span className="ws-spawn-ph"><WSIcon name="spawn" size={16} /></span><span>{p}</span></div>
              ))}
            </div>
            <div className="ws-spawn-foot"><span className="ws-head">Drag into world · physics on</span></div>
          </WSPanel>
          <WSPanel title="Agent — locobot_01" className="ws-agent-pad">
            <div className="ws-pad">
              <span></span><span className={"ws-key" + (padKey === "w" ? " on" : "")}>W</span><span></span>
              <span className={"ws-key" + (padKey === "a" ? " on" : "")}>A</span><span className={"ws-key" + (padKey === "s" ? " on" : "")}>S</span><span className={"ws-key" + (padKey === "d" ? " on" : "")}>D</span>
            </div>
            <div className="ws-kv"><span>MoveAhead</span><b>0.25 m</b></div>
            <div className="ws-kv"><span>Rotate</span><b>15°</b></div>
          </WSPanel>
        </div>
        <div className="ws-bottom-right ws-pip">
          <WSCanvas feed accent={t.accent} yaw={-0.5} cw={880} ch={536} style={{ borderRadius: 10 }} />
          <span className="ws-pip-lab"><WSDot color="var(--acc)" pulse /> agent eye · cam_front</span>
        </div>
        {(t.showTimeline || t.showControls) ? (
          <div className="ws-bottom-center"><div className="ws-bottom-stack">
            {t.showTimeline ? <Timeline t={t} frame={frame ?? 64} total={total ?? 120} recording /> : null}
            {t.showControls ? <WSControlsBar controls={WS_CONTROLS.pilot} /> : null}
          </div></div>
        ) : null}
        <WSStatusBar items={[
          { text: "episode EP_0042 · recording actions" },
          { text: "props: 14 · agents: 1" },
          { text: "step " + (frame ?? 64) + " / " + (total ?? 120), acc: true },
        ]} />
      </div>
    </div>
  );
}

Object.assign(window, { LayoutOrbital, LayoutDual, LayoutCommand, WorldTree, ModeCard, Timeline, RigTopology, wsRoot, wsVars });
