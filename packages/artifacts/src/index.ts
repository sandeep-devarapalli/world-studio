import type {
  Bounds3,
  BudoArticleFigureViewsManifest,
  BudoMediaFramesManifest,
  VerifiedSemanticExportManifest,
  WorldClass,
  WorldSession
} from "@world-studio/world-core";

export type PlyKind = "ordinary-ply" | "gaussian-ply" | "unknown-ply";

export interface PlyHeader {
  format: "ascii" | "binary_little_endian" | "binary_big_endian" | "unknown";
  vertexCount: number;
  properties: string[];
  headerLength: number;
}

export interface PointRecord {
  x: number;
  y: number;
  z: number;
  red?: number;
  green?: number;
  blue?: number;
  semanticLabel?: number;
}

export interface ParsedPointCloud {
  kind: "ordinary-ply";
  points: PointRecord[];
  bounds: Bounds3;
}

export interface ObjMeshSummary {
  vertices: number;
  faces: number;
  groups: Array<{ name: string; faces: number; material?: string }>;
}

export interface LoftSceneManifest {
  dataset: string;
  version: string;
  up_axis: string;
  units: string;
  files: Record<string, string>;
  points_total: number;
  classes: Array<{
    label: number;
    name: string;
    color_shaded: string;
    color_flat: string;
    points: number;
  }>;
  agent_spawn?: {
    x: number;
    z: number;
    heading_rad: number;
  };
}

export function parsePlyHeader(source: string): PlyHeader {
  if (!source.startsWith("ply")) {
    throw new Error("Not a PLY file");
  }

  const end = source.indexOf("end_header");
  if (end < 0) {
    throw new Error("PLY header is missing end_header");
  }

  const endLine = source.indexOf("\n", end);
  const headerLength = endLine >= 0 ? endLine + 1 : source.length;
  const lines = source.slice(0, headerLength).split(/\r?\n/);
  const properties: string[] = [];
  let vertexCount = 0;
  let inVertex = false;
  let format: PlyHeader["format"] = "unknown";

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "format") {
      format = parts[1] === "ascii" || parts[1] === "binary_little_endian" || parts[1] === "binary_big_endian" ? parts[1] : "unknown";
    } else if (parts[0] === "element") {
      inVertex = parts[1] === "vertex";
      if (inVertex) {
        vertexCount = Number(parts[2] ?? 0);
      }
    } else if (inVertex && parts[0] === "property") {
      properties.push(parts[parts.length - 1] ?? "");
    }
  }

  return { format, vertexCount, properties, headerLength };
}

export function detectPlyKind(source: string): PlyKind {
  const header = parsePlyHeader(source);
  const props = new Set(header.properties);
  const hasPosition = props.has("x") && props.has("y") && props.has("z");
  const hasGaussianFields =
    props.has("opacity") &&
    (props.has("scale_0") || props.has("scale_1") || props.has("scale_2")) &&
    (props.has("rot_0") || props.has("rot_1") || props.has("rot_2") || props.has("rot_3")) &&
    (props.has("f_dc_0") || props.has("features_dc_0"));

  if (hasGaussianFields) return "gaussian-ply";
  if (hasPosition) return "ordinary-ply";
  return "unknown-ply";
}

export function parsePointCloudPly(source: string, maxPoints = Number.POSITIVE_INFINITY): ParsedPointCloud {
  const header = parsePlyHeader(source);
  if (header.format !== "ascii") {
    throw new Error(`Only ASCII PLY parsing is implemented in this scaffold, got ${header.format}`);
  }

  const kind = detectPlyKind(source);
  if (kind !== "ordinary-ply") {
    throw new Error(`Expected ordinary point-cloud PLY, got ${kind}`);
  }

  const propertyIndex = new Map(header.properties.map((property, index) => [property, index]));
  const body = source.slice(header.headerLength).trim();
  const lines = body.length ? body.split(/\r?\n/) : [];
  const points: PointRecord[] = [];
  const bounds: Bounds3 = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  };

  for (let index = 0; index < Math.min(lines.length, header.vertexCount, maxPoints); index++) {
    const cols = lines[index]?.trim().split(/\s+/) ?? [];
    const point: PointRecord = {
      x: numeric(cols, propertyIndex.get("x")),
      y: numeric(cols, propertyIndex.get("y")),
      z: numeric(cols, propertyIndex.get("z"))
    };

    const red = optionalNumeric(cols, propertyIndex.get("red"));
    const green = optionalNumeric(cols, propertyIndex.get("green"));
    const blue = optionalNumeric(cols, propertyIndex.get("blue"));
    const semanticLabel = optionalNumeric(cols, propertyIndex.get("semantic_label") ?? propertyIndex.get("semantic_class"));

    if (red !== undefined) point.red = red;
    if (green !== undefined) point.green = green;
    if (blue !== undefined) point.blue = blue;
    if (semanticLabel !== undefined) point.semanticLabel = semanticLabel;

    bounds.min = [
      Math.min(bounds.min[0], point.x),
      Math.min(bounds.min[1], point.y),
      Math.min(bounds.min[2], point.z)
    ];
    bounds.max = [
      Math.max(bounds.max[0], point.x),
      Math.max(bounds.max[1], point.y),
      Math.max(bounds.max[2], point.z)
    ];

    points.push(point);
  }

  return { kind: "ordinary-ply", points, bounds };
}

export function parseObjMeshSummary(source: string): ObjMeshSummary {
  let vertices = 0;
  let faces = 0;
  let current = { name: "default", faces: 0, material: undefined as string | undefined };
  const groups = [current];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      vertices++;
    } else if (trimmed.startsWith("f ")) {
      faces++;
      current.faces++;
    } else if (trimmed.startsWith("o ") || trimmed.startsWith("g ")) {
      current = { name: trimmed.slice(2).trim() || `group_${groups.length}`, faces: 0, material: undefined };
      groups.push(current);
    } else if (trimmed.startsWith("usemtl ")) {
      current.material = trimmed.slice(7).trim();
    }
  }

  return { vertices, faces, groups: groups.filter((group) => group.faces > 0) };
}

export function createLoftWorldSession(scene: LoftSceneManifest, loadedVia: string): WorldSession {
  const classes: WorldClass[] = scene.classes.map((entry) => ({
    label: entry.label,
    name: entry.name,
    colorShaded: entry.color_shaded,
    colorFlat: entry.color_flat,
    points: entry.points
  }));

  return {
    id: `${scene.dataset}-${scene.version}`,
    name: scene.dataset,
    version: scene.version,
    units: scene.units,
    upAxis: scene.up_axis,
    pointCount: scene.points_total,
    classes,
    agentSpawn: scene.agent_spawn
      ? { x: scene.agent_spawn.x, z: scene.agent_spawn.z, heading: scene.agent_spawn.heading_rad }
      : undefined,
    provenance: {
      sourceKind: "world-studio.fixture.loft_04",
      packageKind: "fixture",
      loadedVia,
      sourcePath: loadedVia,
      primaryArtifact: "gaussians.ply",
      companionArtifacts: Object.keys(scene.files),
      loadedAt: new Date().toISOString(),
      authorityStatus: "visual_evidence"
    }
  };
}

export function validateBudoMediaFramesManifest(value: unknown): BudoMediaFramesManifest {
  if (!isRecord(value) || !Array.isArray(value.frames)) {
    throw new Error("Expected budo.media_frames manifest with a frames array");
  }
  return value as BudoMediaFramesManifest;
}

export function validateBudoArticleFigureViewsManifest(value: unknown): BudoArticleFigureViewsManifest {
  if (!isRecord(value) || (!Array.isArray(value.views) && !Array.isArray(value.frames))) {
    throw new Error("Expected article figure views manifest with views or frames");
  }
  return value as BudoArticleFigureViewsManifest;
}

export function validateVerifiedSemanticExportManifest(value: unknown): VerifiedSemanticExportManifest {
  if (!isRecord(value)) {
    throw new Error("Expected verified export manifest object");
  }
  if (typeof value.schema !== "string" || typeof value.status !== "string") {
    throw new Error("Verified export manifest requires schema and status");
  }
  if (value.schema !== "budo.semantic_labels.verified_export.v0.1") {
    throw new Error(`Unsupported verified export schema: ${value.schema}`);
  }
  if (value.status !== "human_verified_semantic_labels") {
    throw new Error(`Unsupported verified export status: ${value.status}`);
  }
  if (typeof value.component_count !== "number" || !isRecord(value.files) || !isRecord(value.hashes)) {
    throw new Error("Verified export manifest requires component_count, files, and hashes");
  }
  return value as unknown as VerifiedSemanticExportManifest;
}

function numeric(cols: string[], index: number | undefined): number {
  if (index === undefined) {
    throw new Error("Required PLY property missing");
  }
  const value = Number(cols[index]);
  if (!Number.isFinite(value)) {
    throw new Error("PLY property is not finite");
  }
  return value;
}

function optionalNumeric(cols: string[], index: number | undefined): number | undefined {
  if (index === undefined || cols[index] === undefined) return undefined;
  const value = Number(cols[index]);
  return Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

