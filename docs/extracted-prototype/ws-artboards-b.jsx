// ws-artboards-b.jsx — Section 2: key screens (1920×1080)
// Exports: ScreenModes, ScreenRig, ScreenTimeline

// ---------- Screen 1 — Render modes / semantic inspection ----------
function ScreenModes({ t }) {
  const classes = [
    ["sofa", "#d9764a", "8,412"], ["table", "#c9a93f", "2,180"], ["lamp", "#e8e26a", "1,022"],
    ["plant", "#4fae62", "1,940"], ["shelf", "#8f6fd9", "3,310"], ["rug", "#b04a8f", "4,505"],
    ["window", "#4fc3d9", "2,002"], ["floor", "#5b6f8a", "12,604"], ["wall", "#3d4a5c", "9,198"],
  ];
  return (
    <div className={wsRoot(t)} style={wsVars(t)} data-screen-label="Screen — Render modes">
      <WSCanvas mode="semantic" accent={t.accent} yaw={0.8} pitch={0.46} dist={7.0} highlight="sofa" />
      <div className="ws-overlay">
        <div className="ws-top-left"><WSWordmark scene="LOFT_04" sub="WORLD" /></div>
        <div className="ws-top-center">
          <div className="ws-panel ws-mode-switch">
            <span className="ws-head" style={{ marginRight: 10 }}>View</span>
            {["Gaussians", "Points", "Mesh", "Semantic", "Depth"].map((m) => (
              <WSPill key={m} active={m === "Semantic"} small>{m}</WSPill>
            ))}
          </div>
        </div>
        <div className="ws-left">
          <WSPanel title="Classes" right="9 · sofa isolated" pad={false} className="ws-legend">
            <div className="ws-legend-body">
              {classes.map(([name, color, count]) => (
                <div key={name} className={"ws-class-row" + (name === "sofa" ? " active" : "")}>
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
        </div>
        {t.showModeCard ? (
          <div className="ws-bottom-right">
            <WSPanel className="ws-mode-card">
              <div className="ws-mode-title-row">
                <span className="ws-mode-title">semantic</span>
                <WSChip accent>sofa · 8,412 pts</WSChip>
              </div>
              <div className="ws-head" style={{ marginBottom: 8 }}>CH 3 (instance) · argmax</div>
              <WSSliderRow label="Isolation" value="82" pct={82} />
              <WSSliderRow label="Overlay α" value="90" pct={90} />
            </WSPanel>
          </div>
        ) : null}
        <WSStatusBar items={[
          { text: "semantic head · thor_seg_v2 · 9 classes" },
          { text: "mIoU 0.847 vs collision mesh" },
          { text: "sofa isolated", acc: true },
        ]} />
      </div>
    </div>
  );
}

// ---------- Screen 2 — Sensor rig configuration ----------
function ScreenRig({ t }) {
  const frustums = [
    { x: 1.6, y: 1.35, z: 2.0, yaw: 3.6, label: "cam_front" },
    { x: -2.4, y: 1.6, z: 1.8, yaw: 2.6, label: "cam_left", color: "#8a7d6d" },
    { x: 2.4, y: 2.2, z: -1.6, yaw: 5.6, pitch: 0.5, label: "cam_top", color: "#8a7d6d" },
  ];
  const sensors = [
    ["camera", "cam_front", "RGB · 1920×1080 · 30 Hz", true],
    ["camera", "cam_left", "RGB · 1280×720 · 30 Hz", false],
    ["camera", "cam_top", "RGB-D · 640×480 · 15 Hz", false],
    ["lidar", "lidar_top", "64 ch · 10 Hz · 120 m", false],
    ["imu", "imu_base", "200 Hz · 6-axis", false],
    ["camera", "cam_rear", "RGB · 1280×720 · 30 Hz", false],
  ];
  const [on, setOn] = React.useState({ cam_front: true, cam_left: true, cam_top: true, lidar_top: true, imu_base: true, cam_rear: false });
  const nOn = Object.values(on).filter(Boolean).length;
  return (
    <div className={wsRoot(t)} style={wsVars(t)} data-screen-label="Screen — Sensor rig">
      <WSCanvas mode="points" accent={t.accent} yaw={0.5} pitch={0.5} dist={8.0} frustums={frustums} agent={{ x: 1.6, z: 2.0, heading: 3.6 }} />
      <div className="ws-overlay">
        <div className="ws-top-left"><WSWordmark scene="LOFT_04 · RIG_A" sub="SENSORS" /></div>
        <div className="ws-right-col">
          <WSPanel title="Rig — rig_a" right={"6 channels · " + nOn + " active"} pad={false} className="ws-sensor-list">
            {sensors.map(([icon, name, spec, active]) => (
              <div key={name} className={"ws-sensor-row" + (active ? " active" : "") + (!on[name] ? " dim" : "")}>
                <span className="ws-row-ic"><WSIcon name={icon} size={15} /></span>
                <span className="ws-sensor-name">
                  <span className="ws-row-name">{name}</span>
                  <span className="ws-sensor-spec">{spec}</span>
                </span>
                <span className={"ws-switch" + (on[name] ? " on" : "")} style={{ cursor: "pointer" }}
                  onClick={() => setOn((s) => ({ ...s, [name]: !s[name] }))}><span></span></span>
              </div>
            ))}
            <div className="ws-tree-foot">
              <span className="ws-key-group"><WSKey>N</WSKey><span className="ws-foot-label">add sensor</span></span>
              <span className="ws-key-group"><WSKey>G</WSKey><span className="ws-foot-label">grab / place</span></span>
            </div>
          </WSPanel>
          <WSPanel title="cam_front — intrinsics" className="ws-intrinsics">
            <div className="ws-kv"><span>FOV</span><b>62° h · 38° v</b></div>
            <div className="ws-kv"><span>fx / fy</span><b>1454.2 / 1452.8</b></div>
            <div className="ws-kv"><span>Distortion</span><b>brown–conrady k3</b></div>
            <WSSliderRow label="Noise σ" value="0.012" pct={18} />
            <WSSliderRow label="Motion blur" value="off" pct={0} />
          </WSPanel>
        </div>
        <div className="ws-bottom-left ws-previews">
          {[{ m: "splat", lab: "cam_front · RGB", feed: true }, { m: "depth", lab: "cam_front · DEPTH" }].map((s) => (
            <div key={s.lab} className="ws-preview-card">
              <WSCanvas mode={s.m} feed={s.feed} accent={t.accent} yaw={-0.45} grid={false} density={0.5} cw={600} ch={376} style={{ borderRadius: 9 }} />
              <span className="ws-strip-lab">{s.lab}</span>
            </div>
          ))}
        </div>
        {t.showControls ? <div className="ws-bottom-center"><WSControlsBar controls={WS_CONTROLS.sensors} /></div> : null}
        <WSStatusBar items={[
          { text: "rig_a · extrinsics locked to agent base" },
          { text: "bandwidth 412 MB/s simulated" },
          { text: "cam_front selected", acc: true },
        ]} />
      </div>
    </div>
  );
}

// ---------- Screen 3 — Episode timeline / playback ----------
function ScreenTimeline({ t }) {
  const traj = [[-2.3, 1.7], [-1.6, 1.5], [-0.8, 1.2], [0.0, 1.05], [0.8, 0.95], [1.3, 0.4], [1.5, -0.3], [1.1, -1.0]];
  const TOTAL = 120;
  const [step, setStep] = React.useState(64);
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % (TOTAL + 1)), 160);
    return () => clearInterval(id);
  }, [playing]);
  const pct = (step / TOTAL) * 100;
  // agent follows trajectory with playback
  const fi = Math.min(traj.length - 1.001, (step / TOTAL) * (traj.length - 1));
  const i0 = Math.floor(fi), u = fi - i0;
  const ax = traj[i0][0] + (traj[i0 + 1][0] - traj[i0][0]) * u;
  const az = traj[i0][1] + (traj[i0 + 1][1] - traj[i0][1]) * u;
  const heading = Math.atan2(traj[i0 + 1][1] - traj[i0][1], traj[i0 + 1][0] - traj[i0][0]);
  const actions = [
    { x: 2, w: 10, lab: "MoveAhead ×4" }, { x: 13, w: 5, lab: "Rotate 45°" },
    { x: 19, w: 12, lab: "MoveAhead ×5" }, { x: 32, w: 7, lab: "PickUp(mug)" },
    { x: 40, w: 9, lab: "MoveAhead ×3" }, { x: 50, w: 6, lab: "Put(table)" },
  ];
  return (
    <div className={wsRoot(t)} style={wsVars(t)} data-screen-label="Screen — Episode timeline">
      <WSCanvas mode="splat" accent={t.accent} yaw={2.1} pitch={0.62} dist={8.2} trajectory={traj} agent={{ x: ax, z: az, heading: heading }} />
      <div className="ws-overlay">
        <div className="ws-top-left"><WSWordmark scene="EP_0042 · LOFT_04" sub="EPISODE" /></div>
        <div className="ws-top-right">
          <WSPanel title="Episode" className="ws-episode-card">
            <div className="ws-kv"><span>Task</span><b>put mug on table</b></div>
            <div className="ws-kv"><span>Steps</span><b>{step} / {TOTAL}</b></div>
            <div className="ws-kv"><span>Reward</span><b className="acc">+0.82</b></div>
            <div className="ws-kv"><span>Captures</span><b>RGB · DEPTH · SEG</b></div>
          </WSPanel>
        </div>
        <div className="ws-bottom-full">
          <WSPanel pad={false} className="ws-tracks-panel">
            <div className="ws-tracks-head">
              <button className="ws-play" onClick={() => setPlaying((p) => !p)}>{playing ? <WSIcon name="pause" size={16} /> : <WSIcon name="play" size={16} />}</button>
              <button className="ws-tl-btn" onClick={() => setStep(0)}><WSIcon name="skip" size={13} /></button>
              <span className="ws-mono-val">{String(step).padStart(4, "0")} / {String(TOTAL).padStart(4, "0")}</span>
              <span className="ws-rec"><WSDot color="var(--acc)" pulse /> REC</span>
              <span className="ws-key-group" style={{ marginLeft: 14 }}><WSKey>Space</WSKey><span className="ws-foot-label">play</span></span>
              <span className="ws-key-group"><WSKey>←</WSKey><WSKey>→</WSKey><span className="ws-foot-label">step</span></span>
              <span className="ws-head" style={{ marginLeft: "auto" }}>1.0× · sim time {("0" + Math.floor(step * 0.666 / 60)).slice(-2)}:{("0" + (step * 0.666 % 60).toFixed(1)).slice(-4)}</span>
            </div>
            <div className="ws-tracks">
              <div className="ws-track-row">
                <span className="ws-head ws-track-lab">Agent</span>
                <div className="ws-track-lane">
                  {actions.map((a, i) => <span key={i} className={"ws-act" + (pct >= a.x && pct < a.x + a.w ? " on" : "")} style={{ left: a.x + "%", width: a.w + "%" }}>{a.lab}</span>)}
                </div>
              </div>
              <div className="ws-track-row">
                <span className="ws-head ws-track-lab">Objects</span>
                <div className="ws-track-lane">
                  {[33, 51].map((x, i) => <span key={i} className="ws-evt" style={{ left: x + "%" }}>{i === 0 ? "mug grasped" : "mug placed"}</span>)}
                </div>
              </div>
              <div className="ws-track-row">
                <span className="ws-head ws-track-lab">Captures</span>
                <div className="ws-track-lane ws-cap-lane">
                  {Array.from({ length: 40 }).map((_, i) => <span key={i} className="ws-cap" style={{ left: i * 2.5 + "%" }}></span>)}
                </div>
              </div>
              <div className="ws-playhead" style={{ left: "calc(116px + (100% - 132px) * " + pct / 100 + ")", marginLeft: 0 }}></div>
            </div>
          </WSPanel>
        </div>
        <WSStatusBar items={[
          { text: "episode EP_0042 · seed 1337 · deterministic replay" },
          { text: "export: hdf5 + mp4" },
          { text: "step " + step, acc: true },
        ]} />
      </div>
    </div>
  );
}

Object.assign(window, { ScreenModes, ScreenRig, ScreenTimeline });
