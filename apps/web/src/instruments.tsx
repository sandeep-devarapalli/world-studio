import { useEffect, useRef } from "react";
import type { PointRecord } from "@world-studio/artifacts";
import { WSDot, WSIcon, WSKey, WSPanel } from "@world-studio/design-system";
import type { WorldClass } from "@world-studio/world-core";

export type FeedMode = "rgb" | "depth" | "semantic" | "points";

export interface FeedPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch?: number;
}

const depthStops: Array<[number, number, number]> = [
  [252, 224, 157],
  [240, 142, 86],
  [196, 78, 82],
  [120, 41, 99],
  [48, 18, 76],
  [8, 6, 25]
];

const fallbackClassColors = ["#5b6f8a", "#3d4a5c", "#b04a8f", "#d9764a", "#c9a93f", "#e8e26a", "#4fae62", "#8f6fd9", "#4fc3d9"];

export function FeedCanvas({
  points,
  classes,
  mode,
  pose,
  cw,
  ch,
  className = "ws-canvas"
}: {
  points: PointRecord[];
  classes: WorldClass[];
  mode: FeedMode;
  pose: FeedPose;
  cw: number;
  ch: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawFeed(ctx, canvas.width, canvas.height, points, classes, mode, pose);
  }, [points, classes, mode, pose.x, pose.y, pose.z, pose.heading, pose.pitch]);

  return <canvas ref={ref} width={cw} height={ch} className={className} />;
}

function drawFeed(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: PointRecord[],
  classes: WorldClass[],
  mode: FeedMode,
  pose: FeedPose
): void {
  ctx.fillStyle = "#0d0a07";
  ctx.fillRect(0, 0, width, height);
  if (!points.length) {
    ctx.fillStyle = "rgba(236, 226, 212, 0.28)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("no world loaded", width / 2, height / 2);
    return;
  }

  const classColors = new Map<number, string>(
    classes.map((entry, index) => [
      entry.label,
      entry.colorFlat ?? entry.colorShaded ?? fallbackClassColors[index % fallbackClassColors.length] ?? "#ece2d4"
    ])
  );
  const cosH = Math.cos(pose.heading);
  const sinH = Math.sin(pose.heading);
  const pitch = pose.pitch ?? 0;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const focal = height * 0.9;
  const size = Math.max(2, Math.round(width / 220));
  const stride = Math.max(1, Math.ceil(points.length / 9000));
  let maxDepth = 1;
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    if (!point) continue;
    const dx = point.x - pose.x;
    const dz = point.z - pose.z;
    const depth = dx * cosH + dz * sinH;
    if (depth > maxDepth) maxDepth = depth;
  }

  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    if (!point) continue;
    const dx = point.x - pose.x;
    const dy = point.y - pose.y;
    const dz = point.z - pose.z;
    const forward = dx * cosH + dz * sinH;
    const right = -dx * sinH + dz * cosH;
    const up = dy * cosP - forward * sinP;
    const depth = dy * sinP + forward * cosP;
    if (depth < 0.15) continue;
    const sx = width / 2 + (right / depth) * focal;
    const sy = height / 2 - (up / depth) * focal;
    if (sx < -size || sx > width + size || sy < -size || sy > height + size) continue;
    ctx.fillStyle = feedColor(point, mode, depth / maxDepth, classColors);
    ctx.fillRect(sx, sy, size, size);
  }
}

function feedColor(point: PointRecord, mode: FeedMode, depthT: number, classColors: Map<number, string>): string {
  if (mode === "depth") return depthColor(depthT);
  if (mode === "semantic") return classColors.get(point.semanticLabel ?? -1) ?? "#ece2d4";
  if (mode === "points") {
    const alpha = Math.max(0.25, 1 - depthT * 0.8);
    return `rgba(236, 226, 212, ${alpha.toFixed(2)})`;
  }
  const fade = Math.max(0.35, 1 - depthT * 0.55);
  return `rgb(${Math.round((point.red ?? 236) * fade)}, ${Math.round((point.green ?? 226) * fade)}, ${Math.round((point.blue ?? 212) * fade)})`;
}

function depthColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const f = clamped * (depthStops.length - 1);
  const index = Math.min(depthStops.length - 2, Math.floor(f));
  const u = f - index;
  const a = depthStops[index] ?? depthStops[0]!;
  const b = depthStops[index + 1] ?? a;
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)}, ${Math.round(a[1] + (b[1] - a[1]) * u)}, ${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

export function TimelineCapsule({
  frame,
  total,
  playing,
  recording,
  onToggle,
  onRewind
}: {
  frame: number;
  total: number;
  playing: boolean;
  recording?: boolean;
  onToggle: () => void;
  onRewind: () => void;
}) {
  const pct = total > 0 ? (frame / total) * 100 : 0;
  return (
    <WSPanel className="ws-timeline">
      <button className="ws-play" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
        <WSIcon name={playing ? "pause" : "play"} size={16} />
      </button>
      <button className="ws-tl-btn" onClick={onRewind} aria-label="Rewind">
        <WSIcon name="skip" size={13} />
      </button>
      <div className="ws-tl-track">
        <div className="ws-tl-ticks">
          {Array.from({ length: 30 }).map((_, index) => (
            <span key={index} className={index % 5 === 0 ? "maj" : ""} />
          ))}
        </div>
        <div className="ws-tl-fill" style={{ width: `${pct}%` }} />
        <div className="ws-tl-head" style={{ left: `${pct}%` }} />
      </div>
      <span className="ws-mono-val ws-tl-frame">
        {String(frame).padStart(4, "0")} / {String(total).padStart(4, "0")}
      </span>
      {recording ? (
        <span className="ws-rec">
          <WSDot pulse /> REC
        </span>
      ) : null}
    </WSPanel>
  );
}

export function TracksPanel({
  step,
  total,
  playing,
  hasTrajectory,
  capturing,
  onToggle,
  onRewind
}: {
  step: number;
  total: number;
  playing: boolean;
  hasTrajectory: boolean;
  capturing: boolean;
  onToggle: () => void;
  onRewind: () => void;
}) {
  const pct = total > 0 ? (step / total) * 100 : 0;
  return (
    <WSPanel pad={false} className="ws-tracks-panel">
      <div className="ws-tracks-head">
        <button className="ws-play" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
          <WSIcon name={playing ? "pause" : "play"} size={16} />
        </button>
        <button className="ws-tl-btn" onClick={onRewind} aria-label="Rewind">
          <WSIcon name="skip" size={13} />
        </button>
        <span className="ws-mono-val">
          {String(step).padStart(4, "0")} / {String(total).padStart(4, "0")}
        </span>
        <span className="ws-key-group">
          <WSKey>Space</WSKey>
          <span className="ws-foot-label">play</span>
        </span>
        <span className="ws-key-group">
          <WSKey>←</WSKey>
          <WSKey>→</WSKey>
          <span className="ws-foot-label">step</span>
        </span>
        <span className="ws-head ws-tracks-right">deterministic replay</span>
      </div>
      <div className="ws-tracks">
        <div className="ws-track-row">
          <span className="ws-head ws-track-lab">Agent</span>
          <div className="ws-track-lane">
            {hasTrajectory ? (
              <span className={`ws-act ${playing ? "on" : ""}`} style={{ left: "1%", width: "98%" }}>
                drive · {total} steps
              </span>
            ) : null}
          </div>
        </div>
        <div className="ws-track-row">
          <span className="ws-head ws-track-lab">Objects</span>
          <div className="ws-track-lane" />
        </div>
        <div className="ws-track-row">
          <span className="ws-head ws-track-lab">Captures</span>
          <div className="ws-track-lane ws-cap-lane">
            {capturing
              ? Array.from({ length: 40 }).map((_, index) => (
                  <span key={index} className="ws-cap" style={{ left: `${index * 2.5}%` }} />
                ))
              : null}
          </div>
        </div>
        <div className="ws-playhead" style={{ left: `calc(116px + (100% - 132px) * ${pct / 100})`, marginLeft: 0 }} />
      </div>
    </WSPanel>
  );
}
