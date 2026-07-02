import type { ParsedPointCloud, PointRecord } from "@world-studio/artifacts";
import type { RenderAdapter, RenderOptions, WorldClass } from "@world-studio/world-core";

export interface CanvasRendererInput {
  pointCloud: ParsedPointCloud;
  classes: WorldClass[];
}

interface Projected {
  x: number;
  y: number;
  d: number;
}

const fallbackClassColors = [
  "#5b6f8a",
  "#3d4a5c",
  "#b04a8f",
  "#d9764a",
  "#c9a93f",
  "#e8e26a",
  "#4fae62",
  "#8f6fd9",
  "#4fc3d9"
];

export class CanvasWorldRenderer implements RenderAdapter {
  private readonly points: PointRecord[];
  private readonly classColors: Map<number, string>;
  private readonly classNames: Map<number, string>;

  constructor(input: CanvasRendererInput) {
    this.points = input.pointCloud.points;
    this.classColors = new Map(
      input.classes.map((entry, index) => [entry.label, entry.colorFlat ?? entry.colorShaded ?? fallbackClassColors[index % fallbackClassColors.length] ?? "#ece2d4"])
    );
    this.classNames = new Map(input.classes.map((entry) => [entry.label, entry.name]));
  }

  render(canvas: HTMLCanvasElement, options: RenderOptions): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
    const height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.fillStyle = "#15120e";
    ctx.fillRect(0, 0, width, height);
    this.drawGlow(ctx, width, height, options.accent);
    if (options.grid) this.drawGrid(ctx, width, height, options);

    const stride = options.density >= 1 ? 1 : Math.max(1, Math.round(1 / options.density));
    const depthMin = Math.max(0.5, options.camera.distance - 4);
    const depthMax = options.camera.distance + 5;

    for (let index = 0; index < this.points.length; index += stride) {
      const point = this.points[index];
      if (!point) continue;
      if (options.deleted.has(index) && !options.showDeleted) continue;
      if (options.isolatedClass !== undefined && point.semanticLabel !== options.isolatedClass && options.mode === "semantic") {
        ctx.globalAlpha = 0.18;
      } else {
        ctx.globalAlpha = 1;
      }

      const projected = projectPoint(point, width, height, options);
      if (!projected) continue;
      const selected = options.selected.has(index);
      const deleted = options.deleted.has(index);
      const color = deleted
        ? "rgba(220,70,50,0.14)"
        : selected
          ? options.accent
          : this.colorForPoint(point, options, projected.d, depthMin, depthMax);

      const radius = options.mode === "splat" ? Math.max(1.2, 14 / projected.d) : Math.max(0.8, 4.8 / projected.d);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, radius * window.devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    if (options.trajectory) this.drawTrajectory(ctx, width, height, options);
    if (options.agent) this.drawAgent(ctx, width, height, options);
    this.drawModeLabel(ctx, options);
  }

  collectInRadius(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number, radius: number): number[] {
    const rect = canvas.getBoundingClientRect();
    const sx = (x - rect.left) * window.devicePixelRatio;
    const sy = (y - rect.top) * window.devicePixelRatio;
    const r2 = radius * radius * window.devicePixelRatio * window.devicePixelRatio;
    const out: number[] = [];

    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      if (!point || options.deleted.has(index)) continue;
      const projected = projectPoint(point, canvas.width, canvas.height, options);
      if (!projected) continue;
      const dx = projected.x - sx;
      const dy = projected.y - sy;
      if (dx * dx + dy * dy <= r2) out.push(index);
    }

    return out;
  }

  capture(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL("image/png");
  }

  private colorForPoint(point: PointRecord, options: RenderOptions, depth: number, depthMin: number, depthMax: number): string {
    if (options.mode === "depth") {
      return depthColor((depth - depthMin) / (depthMax - depthMin));
    }
    if (options.mode === "semantic") {
      return this.classColors.get(point.semanticLabel ?? -1) ?? "#ece2d4";
    }
    if (options.mode === "mesh") {
      return "rgba(236,226,212,0.26)";
    }
    const red = clampColor((point.red ?? 236) * options.exposure);
    const green = clampColor((point.green ?? 226) * options.exposure);
    const blue = clampColor((point.blue ?? 212) * options.exposure);
    const alpha = options.mode === "splat" ? 0.52 : 0.95;
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  private drawGlow(ctx: CanvasRenderingContext2D, width: number, height: number, accent: string): void {
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.62, height * 0.1, width * 0.5, height * 0.62, height * 0.85);
    glow.addColorStop(0, hexWithAlpha(accent, 0.09));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, options: RenderOptions): void {
    ctx.strokeStyle = "rgba(232,221,208,0.08)";
    ctx.lineWidth = window.devicePixelRatio;
    for (let i = -6; i <= 6; i++) {
      line3(ctx, width, height, options, [i, 0, -6], [i, 0, 6]);
      line3(ctx, width, height, options, [-6, 0, i], [6, 0, i]);
    }
  }

  private drawTrajectory(ctx: CanvasRenderingContext2D, width: number, height: number, options: RenderOptions): void {
    if (!options.trajectory) return;
    ctx.strokeStyle = options.accent;
    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.setLineDash([8 * window.devicePixelRatio, 7 * window.devicePixelRatio]);
    ctx.beginPath();
    let started = false;
    for (const [x, z] of options.trajectory) {
      const projected = project3([x, 0.03, z], width, height, options);
      if (!projected) continue;
      if (!started) {
        ctx.moveTo(projected.x, projected.y);
        started = true;
      } else {
        ctx.lineTo(projected.x, projected.y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawAgent(ctx: CanvasRenderingContext2D, width: number, height: number, options: RenderOptions): void {
    if (!options.agent) return;
    const base = project3([options.agent.x, 0.05, options.agent.z], width, height, options);
    const top = project3([options.agent.x, 0.9, options.agent.z], width, height, options);
    const heading = project3(
      [options.agent.x + Math.cos(options.agent.heading) * 0.8, 0.05, options.agent.z + Math.sin(options.agent.heading) * 0.8],
      width,
      height,
      options
    );
    if (!base || !top) return;
    ctx.strokeStyle = options.accent;
    ctx.fillStyle = options.accent;
    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.beginPath();
    ctx.arc(base.x, base.y, 16 * window.devicePixelRatio, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(top.x, top.y, 6 * window.devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
    if (heading) {
      ctx.setLineDash([6 * window.devicePixelRatio, 5 * window.devicePixelRatio]);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(heading.x, heading.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawModeLabel(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
    ctx.font = `${12 * window.devicePixelRatio}px IBM Plex Mono, monospace`;
    ctx.fillStyle = "rgba(236,226,212,0.68)";
    const isolate =
      options.isolatedClass === undefined ? "" : ` · isolate ${this.classNames.get(options.isolatedClass) ?? options.isolatedClass}`;
    ctx.fillText(`${options.mode}${isolate}`, 24 * window.devicePixelRatio, 32 * window.devicePixelRatio);
  }
}

export function createSparkRendererAdapter(): never {
  throw new Error("Spark/Three.js adapter is planned behind RenderAdapter; canvas fallback is active in this scaffold.");
}

function projectPoint(point: PointRecord, width: number, height: number, options: RenderOptions): Projected | null {
  return project3([point.x, point.y, point.z], width, height, options);
}

function project3(point: [number, number, number], width: number, height: number, options: RenderOptions): Projected | null {
  const { yaw, pitch, distance, target, fov } = options.camera;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const eye = [
    target[0] + distance * cp * sy,
    target[1] + distance * sp,
    target[2] + distance * cp * cy
  ];
  const dx = point[0] - eye[0];
  const dy = point[1] - eye[1];
  const dz = point[2] - eye[2];
  const rx = dx * cy - dz * sy;
  const ry = -dx * sp * sy + dy * cp - dz * sp * cy;
  const d = -dx * cp * sy - dy * sp - dz * cp * cy;
  if (d < 0.1) return null;
  const fl = (height / 2) / Math.tan((fov * Math.PI) / 360);
  return {
    x: width / 2 + (rx / d) * fl,
    y: height / 2 - (ry / d) * fl,
    d
  };
}

function line3(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: RenderOptions,
  a: [number, number, number],
  b: [number, number, number]
): void {
  const pa = project3(a, width, height, options);
  const pb = project3(b, width, height, options);
  if (!pa || !pb) return;
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
}

function depthColor(t: number): string {
  const stops = [
    [252, 222, 156],
    [240, 142, 86],
    [196, 78, 82],
    [120, 41, 99],
    [48, 18, 76],
    [8, 6, 25]
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const f = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(f));
  const u = f - index;
  const a = stops[index] ?? stops[0];
  const b = stops[index + 1] ?? stops[stops.length - 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(224,104,58,${alpha})`;
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

