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

export type PlyScalarType = "char" | "uchar" | "short" | "ushort" | "int" | "uint" | "float" | "double";

export interface PreparedSparkGaussianPly {
  bytes: Uint8Array;
  converted: boolean;
  headerLength: number;
  sourceFormat: PlyHeader["format"];
  vertexCount: number;
}

interface PlyScalarProperty {
  type: PlyScalarType;
  name: string;
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

export interface ObjTriangle {
  a: number;
  b: number;
  c: number;
  group: string;
  material?: string;
}

export interface ParsedObjMesh {
  vertices: Array<[number, number, number]>;
  triangles: ObjTriangle[];
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

export function prepareGaussianPlyForSpark(source: Uint8Array | ArrayBuffer): PreparedSparkGaussianPly {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const headerLength = findPlyHeaderLength(bytes);
  if (headerLength < 0) throw new Error("PLY header is missing end_header");

  const headerText = new TextDecoder().decode(bytes.slice(0, headerLength));
  const header = parsePlyHeader(headerText);
  const kind = detectPlyKind(headerText);
  if (kind !== "gaussian-ply") throw new Error(`Expected Gaussian PLY, got ${kind}`);
  if (header.format !== "ascii") {
    return { bytes, converted: false, headerLength, sourceFormat: header.format, vertexCount: header.vertexCount };
  }

  const { properties, vertexCount } = parseAsciiPlySchema(headerText);
  const body = new TextDecoder().decode(bytes.slice(headerLength)).trim();
  const lines = body.length ? body.split(/\r?\n/) : [];
  if (lines.length < vertexCount) {
    throw new Error(`ASCII Gaussian PLY has ${lines.length} rows for ${vertexCount} vertices`);
  }

  const binaryHeader = headerText.replace(/^format\s+ascii\s+1\.0$/m, "format binary_little_endian 1.0");
  const headerBytes = new TextEncoder().encode(binaryHeader);
  const stride = properties.reduce((sum, property) => sum + plyScalarSize(property.type), 0);
  const output = new ArrayBuffer(headerBytes.length + vertexCount * stride);
  const outputBytes = new Uint8Array(output);
  outputBytes.set(headerBytes, 0);

  const view = new DataView(output);
  let offset = headerBytes.length;
  for (let rowIndex = 0; rowIndex < vertexCount; rowIndex++) {
    const cols = lines[rowIndex]?.trim().split(/\s+/) ?? [];
    if (cols.length < properties.length) {
      throw new Error(`ASCII Gaussian PLY row ${rowIndex + 1} has ${cols.length} columns`);
    }
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
      offset = writePlyScalar(view, offset, properties[propertyIndex], cols[propertyIndex]);
    }
  }

  return {
    bytes: outputBytes,
    converted: true,
    headerLength: headerBytes.length,
    sourceFormat: header.format,
    vertexCount
  };
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

function findPlyHeaderLength(bytes: Uint8Array): number {
  const marker = "end_header";
  for (let index = 0; index <= bytes.length - marker.length; index++) {
    let matched = true;
    for (let markerIndex = 0; markerIndex < marker.length; markerIndex++) {
      if (bytes[index + markerIndex] !== marker.charCodeAt(markerIndex)) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    const after = index + marker.length;
    if (bytes[after] === 13 && bytes[after + 1] === 10) return after + 2;
    if (bytes[after] === 10) return after + 1;
    return after;
  }
  return -1;
}

function parseAsciiPlySchema(headerText: string): { properties: PlyScalarProperty[]; vertexCount: number } {
  let vertexCount = 0;
  let inVertex = false;
  const properties: PlyScalarProperty[] = [];

  for (const line of headerText.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "element") {
      if (inVertex && Number(parts[2] ?? 0) > 0) {
        throw new Error("ASCII Gaussian PLY conversion only supports vertex elements");
      }
      inVertex = parts[1] === "vertex";
      if (inVertex) vertexCount = Number(parts[2] ?? 0);
    } else if (inVertex && parts[0] === "property") {
      if (parts[1] === "list") throw new Error("ASCII Gaussian PLY conversion does not support list properties");
      properties.push({ type: normalizePlyScalarType(parts[1]), name: parts[2] ?? "" });
    }
  }

  if (!vertexCount || properties.length === 0) throw new Error("ASCII Gaussian PLY has no vertex schema");
  return { properties, vertexCount };
}

function normalizePlyScalarType(type: string | undefined): PlyScalarType {
  switch (type) {
    case "char":
    case "int8":
      return "char";
    case "uchar":
    case "uint8":
      return "uchar";
    case "short":
    case "int16":
      return "short";
    case "ushort":
    case "uint16":
      return "ushort";
    case "int":
    case "int32":
      return "int";
    case "uint":
    case "uint32":
      return "uint";
    case "float":
    case "float32":
      return "float";
    case "double":
    case "float64":
      return "double";
    default:
      throw new Error(`Unsupported PLY scalar type: ${type ?? "missing"}`);
  }
}

function plyScalarSize(type: PlyScalarType): number {
  switch (type) {
    case "char":
    case "uchar":
      return 1;
    case "short":
    case "ushort":
      return 2;
    case "int":
    case "uint":
    case "float":
      return 4;
    case "double":
      return 8;
  }
}

function writePlyScalar(view: DataView, offset: number, property: PlyScalarProperty, rawValue: string | undefined): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) throw new Error(`PLY property ${property.name} is not finite`);

  switch (property.type) {
    case "char":
      view.setInt8(offset, value);
      return offset + 1;
    case "uchar":
      view.setUint8(offset, value);
      return offset + 1;
    case "short":
      view.setInt16(offset, value, true);
      return offset + 2;
    case "ushort":
      view.setUint16(offset, value, true);
      return offset + 2;
    case "int":
      view.setInt32(offset, value, true);
      return offset + 4;
    case "uint":
      view.setUint32(offset, value, true);
      return offset + 4;
    case "float":
      view.setFloat32(offset, value, true);
      return offset + 4;
    case "double":
      view.setFloat64(offset, value, true);
      return offset + 8;
  }
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

export function parseObjMesh(source: string): ParsedObjMesh {
  const vertices: Array<[number, number, number]> = [];
  const triangles: ObjTriangle[] = [];
  let group = "default";
  let material: string | undefined;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const tag = parts[0];

    if (tag === "v") {
      vertices.push([numericLiteral(parts[1], "OBJ vertex x"), numericLiteral(parts[2], "OBJ vertex y"), numericLiteral(parts[3], "OBJ vertex z")]);
    } else if (tag === "o" || tag === "g") {
      group = parts.slice(1).join(" ") || `group_${triangles.length}`;
    } else if (tag === "usemtl") {
      material = parts.slice(1).join(" ") || undefined;
    } else if (tag === "f") {
      const face = parts.slice(1).map((value) => parseObjVertexIndex(value, vertices.length));
      for (let index = 1; index < face.length - 1; index++) {
        triangles.push({ a: face[0], b: face[index], c: face[index + 1], group, material });
      }
    }
  }

  return { vertices, triangles };
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

function numericLiteral(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} is not finite`);
  }
  return parsed;
}

function parseObjVertexIndex(value: string, vertexCount: number): number {
  const raw = Number(value.split("/")[0]);
  if (!Number.isInteger(raw) || raw === 0) {
    throw new Error(`Invalid OBJ face index: ${value}`);
  }
  const index = raw > 0 ? raw - 1 : vertexCount + raw;
  if (index < 0 || index >= vertexCount) {
    throw new Error(`OBJ face index out of bounds: ${value}`);
  }
  return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
