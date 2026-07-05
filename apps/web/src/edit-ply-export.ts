import type { PointRecord } from "@world-studio/artifacts";
import type { CropBounds, PointTransform, WorldSession } from "@world-studio/world-core";

export interface CleanedPointRow {
  index: number;
  x: number;
  y: number;
  z: number;
  red: number;
  green: number;
  blue: number;
  semanticLabel: number;
}

export interface CleanedPointCloudInput {
  points: PointRecord[];
  deleted: ReadonlySet<number>;
  cropBounds?: CropBounds;
  pointTransforms: ReadonlyMap<number, PointTransform>;
}

export function cleanedPointRows(input: CleanedPointCloudInput): CleanedPointRow[] {
  const rows: CleanedPointRow[] = [];
  for (let index = 0; index < input.points.length; index += 1) {
    const point = input.points[index];
    if (!point || input.deleted.has(index)) continue;
    const transform = input.pointTransforms.get(index);
    const x = point.x + (transform?.dx ?? 0);
    const y = point.y + (transform?.dy ?? 0);
    const z = point.z + (transform?.dz ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (input.cropBounds && !pointInsideCrop({ x, z }, input.cropBounds)) continue;
    rows.push({
      index,
      x,
      y,
      z,
      red: clampByte(point.red ?? 255),
      green: clampByte(point.green ?? 255),
      blue: clampByte(point.blue ?? 255),
      semanticLabel: Number.isFinite(point.semanticLabel) ? Math.round(point.semanticLabel ?? -1) : -1
    });
  }
  return rows;
}

export function buildCleanedPointCloudPly(input: CleanedPointCloudInput & { session: WorldSession | null }) {
  const rows = cleanedPointRows(input);
  const text = [
    "ply",
    "format ascii 1.0",
    "comment generated_by World Studio cleaned ordinary PLY export v0.1",
    "comment authority proposal",
    `comment world ${sanitizePlyComment(input.session?.name ?? "untitled")}`,
    `comment source ${sanitizePlyComment(input.session?.provenance.sourcePath ?? "unknown")}`,
    "comment boundary ordinary point-cloud PLY only; Gaussian/splat payloads are not written here",
    `element vertex ${rows.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "property int semantic_label",
    "end_header",
    ...rows.map((row) => [
      formatPlyFloat(row.x),
      formatPlyFloat(row.y),
      formatPlyFloat(row.z),
      row.red,
      row.green,
      row.blue,
      row.semanticLabel
    ].join(" "))
  ].join("\n") + "\n";
  return {
    text,
    rowCount: rows.length,
    sizeBytes: new TextEncoder().encode(text).byteLength
  };
}

function pointInsideCrop(point: { x: number; z: number }, bounds: CropBounds): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 255;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function formatPlyFloat(value: number): string {
  const normalized = Math.abs(value) < 0.0000005 ? 0 : value;
  return normalized.toFixed(6).replace(/\.?0+$/, "") || "0";
}

function sanitizePlyComment(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim() || "unknown";
}
