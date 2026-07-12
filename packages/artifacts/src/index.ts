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
  clampedScaleCount?: number;
  normalizedRotationCount?: number;
  droppedOutlierCount?: number;
}

export interface GaussianPreviewPointCloudOptions {
  maxPoints?: number;
}

export interface PointCloudPreviewOptions extends GaussianPreviewPointCloudOptions {
  transform?: number[][];
}

export interface SparkGaussianPlyPrepareOptions {
  maxScale?: number;
  normalizeRotations?: boolean;
  hideOutliersBeyondRadius?: number;
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

export interface ParsedEvidenceMesh extends ParsedObjMesh {
  sourceVertexCount: number;
  sourceFaceCount: number;
  sampledFaceCount: number;
  classificationCounts: Record<string, number>;
}

export interface PlyMeshOptions {
  maxFaces?: number;
  transform?: number[][];
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

export function prepareGaussianPlyForSpark(source: Uint8Array | ArrayBuffer, options: SparkGaussianPlyPrepareOptions = {}): PreparedSparkGaussianPly {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const headerLength = findPlyHeaderLength(bytes);
  if (headerLength < 0) throw new Error("PLY header is missing end_header");

  const headerText = new TextDecoder().decode(bytes.slice(0, headerLength));
  const header = parsePlyHeader(headerText);
  const kind = detectPlyKind(headerText);
  if (kind !== "gaussian-ply") throw new Error(`Expected Gaussian PLY, got ${kind}`);
  const maxLogScale = options.maxScale && options.maxScale > 0 ? Math.log(options.maxScale) : undefined;
  const hideRadius = options.hideOutliersBeyondRadius && options.hideOutliersBeyondRadius > 0 ? options.hideOutliersBeyondRadius : undefined;
  if (header.format !== "ascii") {
    if (header.format === "binary_little_endian" && (maxLogScale !== undefined || options.normalizeRotations || hideRadius !== undefined)) {
      const prepared = prepareBinaryGaussianRows(bytes, headerText, headerLength, {
        maxLogScale,
        normalizeRotations: options.normalizeRotations,
        hideOutliersBeyondRadius: hideRadius
      });
      return {
        bytes: prepared.bytes,
        converted: prepared.clampedScaleCount > 0 || prepared.normalizedRotationCount > 0 || prepared.droppedOutlierCount > 0,
        headerLength,
        sourceFormat: header.format,
        vertexCount: header.vertexCount,
        clampedScaleCount: prepared.clampedScaleCount,
        normalizedRotationCount: prepared.normalizedRotationCount,
        droppedOutlierCount: prepared.droppedOutlierCount
      };
    }
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
    let clampedScaleCount = 0;
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
      const property = properties[propertyIndex]!;
      const rawValue = cols[propertyIndex];
      const value = maxLogScale === undefined ? rawValue : clampGaussianScaleRawValue(property, rawValue, maxLogScale);
      if (value !== rawValue) clampedScaleCount++;
      offset = writePlyScalar(view, offset, property, value);
    }
  }

  const normalized = options.normalizeRotations || hideRadius !== undefined
    ? prepareBinaryGaussianRows(outputBytes, binaryHeader, headerBytes.length, {
        normalizeRotations: options.normalizeRotations,
        hideOutliersBeyondRadius: hideRadius
      })
    : { bytes: outputBytes, normalizedRotationCount: 0, clampedScaleCount: 0, droppedOutlierCount: 0 };

  return {
    bytes: normalized.bytes,
    converted: true,
    headerLength: headerBytes.length,
    sourceFormat: header.format,
    vertexCount,
    clampedScaleCount: maxLogScale === undefined ? undefined : countAsciiGaussianScaleClamps(lines, properties, maxLogScale),
    normalizedRotationCount: options.normalizeRotations ? normalized.normalizedRotationCount : undefined,
    droppedOutlierCount: hideRadius === undefined ? undefined : normalized.droppedOutlierCount
  };
}

export function buildGaussianPreviewPointCloudPly(
  source: Uint8Array | ArrayBuffer,
  options: GaussianPreviewPointCloudOptions = {}
): string {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const headerLength = findPlyHeaderLength(bytes);
  if (headerLength < 0) throw new Error("PLY header is missing end_header");

  const headerText = new TextDecoder().decode(bytes.slice(0, headerLength));
  const header = parsePlyHeader(headerText);
  const kind = detectPlyKind(headerText);
  if (kind !== "gaussian-ply") throw new Error(`Expected Gaussian PLY, got ${kind}`);
  if (header.format !== "ascii" && header.format !== "binary_little_endian") {
    throw new Error(`Gaussian preview only supports ASCII or binary little-endian PLY, got ${header.format}`);
  }

  const { properties, vertexCount } = parseAsciiPlySchema(headerText);
  const propertyIndex = new Map(properties.map((property, index) => [property.name, index]));
  const xIndex = requireProperty(propertyIndex, "x");
  const yIndex = requireProperty(propertyIndex, "y");
  const zIndex = requireProperty(propertyIndex, "z");
  const maxPoints = Math.max(1, Math.floor(options.maxPoints ?? 50_000));
  const sampleStep = Math.max(1, Math.ceil(vertexCount / maxPoints));
  const rows: string[] = [];

  if (header.format === "ascii") {
    const body = new TextDecoder().decode(bytes.slice(headerLength)).trim();
    const lines = body.length ? body.split(/\r?\n/) : [];
    if (lines.length < vertexCount) {
      throw new Error(`ASCII Gaussian PLY has ${lines.length} rows for ${vertexCount} vertices`);
    }
    for (let index = 0; index < vertexCount; index += sampleStep) {
      const cols = lines[index]?.trim().split(/\s+/) ?? [];
      rows.push(formatPreviewPoint(
        numeric(cols, xIndex),
        numeric(cols, yIndex),
        numeric(cols, zIndex),
        readAsciiGaussianColor(cols, propertyIndex)
      ));
    }
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offsets = propertyByteOffsets(properties);
    const stride = properties.reduce((sum, property) => sum + plyScalarSize(property.type), 0);
    for (let index = 0; index < vertexCount; index += sampleStep) {
      const rowOffset = headerLength + index * stride;
      rows.push(formatPreviewPoint(
        readPlyScalar(view, rowOffset + offsets[xIndex]!, properties[xIndex]!),
        readPlyScalar(view, rowOffset + offsets[yIndex]!, properties[yIndex]!),
        readPlyScalar(view, rowOffset + offsets[zIndex]!, properties[zIndex]!),
        readBinaryGaussianColor(view, rowOffset, offsets, properties, propertyIndex)
      ));
    }
  }

  return [
    "ply",
    "format ascii 1.0",
    "comment generated by World Studio from Gaussian PLY positions for preview bounds only",
    `element vertex ${rows.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
    ...rows
  ].join("\n") + "\n";
}

export function buildPointCloudPreviewPly(
  source: Uint8Array | ArrayBuffer,
  options: PointCloudPreviewOptions = {}
): string {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const headerLength = findPlyHeaderLength(bytes);
  if (headerLength < 0) throw new Error("PLY header is missing end_header");

  const headerText = new TextDecoder().decode(bytes.slice(0, headerLength));
  const header = parsePlyHeader(headerText);
  const kind = detectPlyKind(headerText);
  if (kind !== "ordinary-ply") throw new Error(`Expected ordinary point-cloud PLY, got ${kind}`);
  if (header.format !== "ascii" && header.format !== "binary_little_endian") {
    throw new Error(`Point-cloud preview only supports ASCII or binary little-endian PLY, got ${header.format}`);
  }

  const { properties, vertexCount } = parseAsciiPlySchema(headerText);
  const propertyIndex = new Map(properties.map((property, index) => [property.name, index]));
  const xIndex = requireProperty(propertyIndex, "x");
  const yIndex = requireProperty(propertyIndex, "y");
  const zIndex = requireProperty(propertyIndex, "z");
  const maxPoints = Math.max(1, Math.floor(options.maxPoints ?? 50_000));
  const sampleStep = Math.max(1, Math.ceil(vertexCount / maxPoints));
  const rows: string[] = [];

  if (header.format === "ascii") {
    const body = new TextDecoder().decode(bytes.slice(headerLength)).trim();
    const lines = body.length ? body.split(/\r?\n/) : [];
    if (lines.length < vertexCount) {
      throw new Error(`ASCII point-cloud PLY has ${lines.length} rows for ${vertexCount} vertices`);
    }
    for (let index = 0; index < vertexCount; index += sampleStep) {
      const cols = lines[index]?.trim().split(/\s+/) ?? [];
      const position = transformPreviewPoint(numeric(cols, xIndex), numeric(cols, yIndex), numeric(cols, zIndex), options.transform);
      rows.push(formatPreviewPoint(position[0], position[1], position[2], readAsciiPointColor(cols, propertyIndex)));
    }
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offsets = propertyByteOffsets(properties);
    const stride = properties.reduce((sum, property) => sum + plyScalarSize(property.type), 0);
    for (let index = 0; index < vertexCount; index += sampleStep) {
      const rowOffset = headerLength + index * stride;
      const position = transformPreviewPoint(
        readPlyScalar(view, rowOffset + offsets[xIndex]!, properties[xIndex]!),
        readPlyScalar(view, rowOffset + offsets[yIndex]!, properties[yIndex]!),
        readPlyScalar(view, rowOffset + offsets[zIndex]!, properties[zIndex]!),
        options.transform
      );
      rows.push(formatPreviewPoint(position[0], position[1], position[2], readBinaryPointColor(view, rowOffset, offsets, properties, propertyIndex)));
    }
  }

  return [
    "ply",
    "format ascii 1.0",
    "comment generated by World Studio from ordinary PLY for bounded preview rendering",
    `element vertex ${rows.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
    ...rows
  ].join("\n") + "\n";
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

export function parsePlyMesh(source: Uint8Array | ArrayBuffer, options: PlyMeshOptions = {}): ParsedEvidenceMesh {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const headerLength = findPlyHeaderLength(bytes);
  if (headerLength < 0) throw new Error("PLY mesh header is missing end_header");
  const headerText = new TextDecoder().decode(bytes.slice(0, headerLength));
  const header = parsePlyHeader(headerText);
  if (header.format !== "ascii" && header.format !== "binary_little_endian") {
    throw new Error(`PLY mesh only supports ASCII or binary little-endian data, got ${header.format}`);
  }
  const schema = parsePlyMeshSchema(headerText);
  const vertexElement = schema.find((element) => element.name === "vertex");
  const faceElement = schema.find((element) => element.name === "face");
  if (!vertexElement?.count || !faceElement?.count) throw new Error("PLY mesh requires vertex and face elements");
  if (vertexElement.properties.some((property) => property.kind === "list")) throw new Error("PLY mesh vertex lists are unsupported");
  const vertexProperties = vertexElement.properties as MeshScalarProperty[];
  const vertexIndex = new Map(vertexProperties.map((property, index) => [property.name, index]));
  const xIndex = requireProperty(vertexIndex, "x");
  const yIndex = requireProperty(vertexIndex, "y");
  const zIndex = requireProperty(vertexIndex, "z");
  const vertices: Array<[number, number, number]> = [];
  const triangles: ObjTriangle[] = [];
  const classificationCounts: Record<string, number> = {};
  const maxFaces = Math.max(1, Math.floor(options.maxFaces ?? 60_000));
  const sampleStep = Math.max(1, Math.ceil(faceElement.count / maxFaces));

  if (header.format === "ascii") {
    const lines = new TextDecoder().decode(bytes.slice(headerLength)).trim().split(/\r?\n/);
    if (lines.length < vertexElement.count + faceElement.count) throw new Error("ASCII PLY mesh rows are incomplete");
    for (let index = 0; index < vertexElement.count; index++) {
      const cols = lines[index]!.trim().split(/\s+/);
      vertices.push(transformPreviewPoint(numeric(cols, xIndex), numeric(cols, yIndex), numeric(cols, zIndex), options.transform));
    }
    for (let index = 0; index < faceElement.count; index++) {
      const values = lines[vertexElement.count + index]!.trim().split(/\s+/).map(Number);
      const count = values[0] ?? 0;
      const indices = values.slice(1, 1 + count);
      const classification = values[1 + count] ?? 0;
      appendEvidenceFace(triangles, indices, classification, index, sampleStep, vertices.length, classificationCounts);
    }
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offsets = propertyByteOffsets(vertexProperties);
    const stride = vertexProperties.reduce((sum, property) => sum + plyScalarSize(property.type), 0);
    for (let index = 0; index < vertexElement.count; index++) {
      const rowOffset = headerLength + index * stride;
      vertices.push(transformPreviewPoint(
        readPlyScalar(view, rowOffset + offsets[xIndex]!, vertexProperties[xIndex]!),
        readPlyScalar(view, rowOffset + offsets[yIndex]!, vertexProperties[yIndex]!),
        readPlyScalar(view, rowOffset + offsets[zIndex]!, vertexProperties[zIndex]!),
        options.transform
      ));
    }
    let offset = headerLength + vertexElement.count * stride;
    for (let index = 0; index < faceElement.count; index++) {
      const row = readBinaryMeshFace(view, offset, faceElement.properties);
      offset = row.offset;
      appendEvidenceFace(triangles, row.indices, row.classification, index, sampleStep, vertices.length, classificationCounts);
    }
  }

  return {
    vertices,
    triangles,
    sourceVertexCount: vertexElement.count,
    sourceFaceCount: faceElement.count,
    sampledFaceCount: Math.ceil(faceElement.count / sampleStep),
    classificationCounts
  };
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

interface MeshScalarProperty extends PlyScalarProperty {
  kind: "scalar";
}

interface MeshListProperty {
  kind: "list";
  countType: PlyScalarType;
  itemType: PlyScalarType;
  name: string;
}

type MeshProperty = MeshScalarProperty | MeshListProperty;

interface MeshElement {
  name: string;
  count: number;
  properties: MeshProperty[];
}

function parsePlyMeshSchema(headerText: string): MeshElement[] {
  const elements: MeshElement[] = [];
  let current: MeshElement | undefined;
  for (const line of headerText.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "element") {
      current = { name: parts[1] ?? "", count: Number(parts[2] ?? 0), properties: [] };
      elements.push(current);
    } else if (parts[0] === "property" && current) {
      current.properties.push(parts[1] === "list"
        ? { kind: "list", countType: normalizePlyScalarType(parts[2]), itemType: normalizePlyScalarType(parts[3]), name: parts[4] ?? "" }
        : { kind: "scalar", type: normalizePlyScalarType(parts[1]), name: parts[2] ?? "" });
    }
  }
  return elements;
}

function readBinaryMeshFace(view: DataView, startOffset: number, properties: MeshProperty[]): { offset: number; indices: number[]; classification: number } {
  let offset = startOffset;
  let indices: number[] = [];
  let classification = 0;
  for (const property of properties) {
    if (property.kind === "scalar") {
      const value = readPlyScalar(view, offset, property);
      if (property.name === "classification") classification = value;
      offset += plyScalarSize(property.type);
      continue;
    }
    const countProperty: PlyScalarProperty = { type: property.countType, name: `${property.name}_count` };
    const itemProperty: PlyScalarProperty = { type: property.itemType, name: property.name };
    const count = readPlyScalar(view, offset, countProperty);
    offset += plyScalarSize(property.countType);
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      values.push(readPlyScalar(view, offset, itemProperty));
      offset += plyScalarSize(property.itemType);
    }
    if (property.name === "vertex_indices" || property.name === "vertex_index") indices = values;
  }
  return { offset, indices, classification };
}

function appendEvidenceFace(
  triangles: ObjTriangle[],
  indices: number[],
  classification: number,
  faceIndex: number,
  sampleStep: number,
  vertexCount: number,
  classificationCounts: Record<string, number>
): void {
  const group = arkitMeshClassificationName(classification);
  classificationCounts[group] = (classificationCounts[group] ?? 0) + 1;
  if (faceIndex % sampleStep !== 0 || indices.length < 3) return;
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
    throw new Error(`PLY mesh face ${faceIndex} has an invalid vertex index`);
  }
  for (let index = 1; index < indices.length - 1; index++) {
    triangles.push({ a: indices[0]!, b: indices[index]!, c: indices[index + 1]!, group, material: "capture_evidence" });
  }
}

function arkitMeshClassificationName(value: number): string {
  return ["none", "wall", "floor", "ceiling", "table", "seat", "window", "door"][Math.round(value)] ?? `class_${Math.round(value)}`;
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

function clampGaussianScaleRawValue(property: PlyScalarProperty, rawValue: string | undefined, maxLogScale: number): string | undefined {
  if (!isGaussianScaleProperty(property.name)) return rawValue;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= maxLogScale) return rawValue;
  return String(maxLogScale);
}

function countAsciiGaussianScaleClamps(lines: string[], properties: PlyScalarProperty[], maxLogScale: number): number {
  let count = 0;
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
      const property = properties[propertyIndex]!;
      if (!isGaussianScaleProperty(property.name)) continue;
      const value = Number(cols[propertyIndex]);
      if (Number.isFinite(value) && value > maxLogScale) count++;
    }
  }
  return count;
}

// sigmoid(-30) is ~1e-13, so preview-hidden splats render fully transparent without changing row layout.
const hiddenOutlierOpacityLogit = -30;

function prepareBinaryGaussianRows(
  bytes: Uint8Array,
  headerText: string,
  headerLength: number,
  options: { maxLogScale?: number; normalizeRotations?: boolean; hideOutliersBeyondRadius?: number }
): { bytes: Uint8Array; clampedScaleCount: number; normalizedRotationCount: number; droppedOutlierCount: number } {
  const { properties, vertexCount } = parseAsciiPlySchema(headerText);
  const offsets = propertyByteOffsets(properties);
  const stride = properties.reduce((sum, property) => sum + plyScalarSize(property.type), 0);
  const scaleIndexes = properties.flatMap((property, index) => isGaussianScaleProperty(property.name) ? [index] : []);
  const rotationIndexes = ["rot_0", "rot_1", "rot_2", "rot_3"]
    .map((name) => properties.findIndex((property) => property.name === name));
  const positionIndexes = ["x", "y", "z"].map((name) => properties.findIndex((property) => property.name === name));
  const opacityIndex = properties.findIndex((property) => property.name === "opacity");
  const canNormalizeRotations = Boolean(options.normalizeRotations && rotationIndexes.every((index) => index >= 0));
  const canHideOutliers = Boolean(
    options.hideOutliersBeyondRadius !== undefined &&
    positionIndexes.every((index) => index >= 0) &&
    opacityIndex >= 0
  );
  if (!scaleIndexes.length && !canNormalizeRotations && !canHideOutliers) {
    return { bytes, clampedScaleCount: 0, normalizedRotationCount: 0, droppedOutlierCount: 0 };
  }

  const output = new Uint8Array(bytes);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let clampedScaleCount = 0;
  let normalizedRotationCount = 0;
  let droppedOutlierCount = 0;
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    const rowOffset = headerLength + vertexIndex * stride;
    if (canHideOutliers) {
      const [x, y, z] = positionIndexes.map((propertyIndex) =>
        readPlyScalar(view, rowOffset + offsets[propertyIndex]!, properties[propertyIndex]!)
      );
      const distance = Math.hypot(x!, y!, z!);
      if (!Number.isFinite(distance) || distance > options.hideOutliersBeyondRadius!) {
        const property = properties[opacityIndex]!;
        if (readPlyScalar(view, rowOffset + offsets[opacityIndex]!, property) > hiddenOutlierOpacityLogit) {
          writePlyNumber(view, rowOffset + offsets[opacityIndex]!, property, hiddenOutlierOpacityLogit);
          droppedOutlierCount++;
        }
      }
    }
    if (options.maxLogScale !== undefined) {
      for (const propertyIndex of scaleIndexes) {
        const property = properties[propertyIndex]!;
        const offset = rowOffset + offsets[propertyIndex]!;
        const value = readPlyScalar(view, offset, property);
        if (!Number.isFinite(value) || value <= options.maxLogScale) continue;
        writePlyNumber(view, offset, property, options.maxLogScale);
        clampedScaleCount++;
      }
    }
    if (canNormalizeRotations) {
      const values = rotationIndexes.map((propertyIndex) => {
        const property = properties[propertyIndex]!;
        return readPlyScalar(view, rowOffset + offsets[propertyIndex]!, property);
      });
      const length = Math.hypot(...values);
      if (Number.isFinite(length) && length > 1e-12 && Math.abs(length - 1) > 1e-4) {
        for (let index = 0; index < rotationIndexes.length; index++) {
          const propertyIndex = rotationIndexes[index]!;
          const property = properties[propertyIndex]!;
          writePlyNumber(view, rowOffset + offsets[propertyIndex]!, property, values[index]! / length);
        }
        normalizedRotationCount++;
      }
    }
  }
  const changed = clampedScaleCount > 0 || normalizedRotationCount > 0 || droppedOutlierCount > 0;
  return { bytes: changed ? output : bytes, clampedScaleCount, normalizedRotationCount, droppedOutlierCount };
}

function isGaussianScaleProperty(name: string): boolean {
  return name === "scale_0" || name === "scale_1" || name === "scale_2";
}

function writePlyScalar(view: DataView, offset: number, property: PlyScalarProperty, rawValue: string | undefined): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) throw new Error(`PLY property ${property.name} is not finite`);

  writePlyNumber(view, offset, property, value);
  return offset + plyScalarSize(property.type);
}

function writePlyNumber(view: DataView, offset: number, property: PlyScalarProperty, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`PLY property ${property.name} is not finite`);
  switch (property.type) {
    case "char":
      view.setInt8(offset, value);
      return;
    case "uchar":
      view.setUint8(offset, value);
      return;
    case "short":
      view.setInt16(offset, value, true);
      return;
    case "ushort":
      view.setUint16(offset, value, true);
      return;
    case "int":
      view.setInt32(offset, value, true);
      return;
    case "uint":
      view.setUint32(offset, value, true);
      return;
    case "float":
      view.setFloat32(offset, value, true);
      return;
    case "double":
      view.setFloat64(offset, value, true);
      return;
  }
}

function propertyByteOffsets(properties: PlyScalarProperty[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const property of properties) {
    offsets.push(offset);
    offset += plyScalarSize(property.type);
  }
  return offsets;
}

function readPlyScalar(view: DataView, offset: number, property: PlyScalarProperty): number {
  switch (property.type) {
    case "char":
      return view.getInt8(offset);
    case "uchar":
      return view.getUint8(offset);
    case "short":
      return view.getInt16(offset, true);
    case "ushort":
      return view.getUint16(offset, true);
    case "int":
      return view.getInt32(offset, true);
    case "uint":
      return view.getUint32(offset, true);
    case "float":
      return view.getFloat32(offset, true);
    case "double":
      return view.getFloat64(offset, true);
  }
}

function requireProperty(propertyIndex: Map<string, number>, name: string): number {
  const index = propertyIndex.get(name);
  if (index === undefined) throw new Error(`Gaussian PLY is missing ${name}`);
  return index;
}

function readAsciiGaussianColor(cols: string[], propertyIndex: Map<string, number>): [number, number, number] {
  const red = optionalNumeric(cols, propertyIndex.get("red"));
  const green = optionalNumeric(cols, propertyIndex.get("green"));
  const blue = optionalNumeric(cols, propertyIndex.get("blue"));
  if (red !== undefined && green !== undefined && blue !== undefined) return [toByte(red), toByte(green), toByte(blue)];
  return gaussianDcToRgb(
    optionalNumeric(cols, propertyIndex.get("f_dc_0") ?? propertyIndex.get("features_dc_0")),
    optionalNumeric(cols, propertyIndex.get("f_dc_1") ?? propertyIndex.get("features_dc_1")),
    optionalNumeric(cols, propertyIndex.get("f_dc_2") ?? propertyIndex.get("features_dc_2"))
  );
}

function readAsciiPointColor(cols: string[], propertyIndex: Map<string, number>): [number, number, number] {
  return ["red", "green", "blue"].map((name) => toByte(optionalNumeric(cols, propertyIndex.get(name)) ?? 128)) as [number, number, number];
}

function readBinaryGaussianColor(
  view: DataView,
  rowOffset: number,
  offsets: number[],
  properties: PlyScalarProperty[],
  propertyIndex: Map<string, number>
): [number, number, number] {
  const redIndex = propertyIndex.get("red");
  const greenIndex = propertyIndex.get("green");
  const blueIndex = propertyIndex.get("blue");
  if (redIndex !== undefined && greenIndex !== undefined && blueIndex !== undefined) {
    return [
      toByte(readPlyScalar(view, rowOffset + offsets[redIndex]!, properties[redIndex]!)),
      toByte(readPlyScalar(view, rowOffset + offsets[greenIndex]!, properties[greenIndex]!)),
      toByte(readPlyScalar(view, rowOffset + offsets[blueIndex]!, properties[blueIndex]!))
    ];
  }
  return gaussianDcToRgb(
    readOptionalBinaryScalar(view, rowOffset, offsets, properties, propertyIndex.get("f_dc_0") ?? propertyIndex.get("features_dc_0")),
    readOptionalBinaryScalar(view, rowOffset, offsets, properties, propertyIndex.get("f_dc_1") ?? propertyIndex.get("features_dc_1")),
    readOptionalBinaryScalar(view, rowOffset, offsets, properties, propertyIndex.get("f_dc_2") ?? propertyIndex.get("features_dc_2"))
  );
}

function readBinaryPointColor(
  view: DataView,
  rowOffset: number,
  offsets: number[],
  properties: PlyScalarProperty[],
  propertyIndex: Map<string, number>
): [number, number, number] {
  return ["red", "green", "blue"].map((name) => {
    const index = propertyIndex.get(name);
    return index === undefined ? 128 : toByte(readPlyScalar(view, rowOffset + offsets[index]!, properties[index]!));
  }) as [number, number, number];
}

function transformPreviewPoint(x: number, y: number, z: number, transform?: number[][]): [number, number, number] {
  if (!transform) return [x, y, z];
  if (transform.length !== 4 || transform.some((row) => row.length !== 4 || row.some((value) => !Number.isFinite(value)))) {
    throw new Error("Point-cloud preview transform must be a finite 4x4 matrix");
  }
  return [
    transform[0]![0]! * x + transform[0]![1]! * y + transform[0]![2]! * z + transform[0]![3]!,
    transform[1]![0]! * x + transform[1]![1]! * y + transform[1]![2]! * z + transform[1]![3]!,
    transform[2]![0]! * x + transform[2]![1]! * y + transform[2]![2]! * z + transform[2]![3]!
  ];
}

function readOptionalBinaryScalar(
  view: DataView,
  rowOffset: number,
  offsets: number[],
  properties: PlyScalarProperty[],
  index: number | undefined
): number | undefined {
  if (index === undefined) return undefined;
  const value = readPlyScalar(view, rowOffset + offsets[index]!, properties[index]!);
  return Number.isFinite(value) ? value : undefined;
}

function gaussianDcToRgb(f0: number | undefined, f1: number | undefined, f2: number | undefined): [number, number, number] {
  const sh0 = 0.28209479177387814;
  return [
    toByte(((f0 ?? 0) * sh0 + 0.5) * 255),
    toByte(((f1 ?? 0) * sh0 + 0.5) * 255),
    toByte(((f2 ?? 0) * sh0 + 0.5) * 255)
  ];
}

function formatPreviewPoint(x: number, y: number, z: number, color: [number, number, number]): string {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error("PLY preview position is not finite");
  }
  return `${x} ${y} ${z} ${color[0]} ${color[1]} ${color[2]}`;
}

function toByte(value: number): number {
  if (!Number.isFinite(value)) return 128;
  return Math.max(0, Math.min(255, Math.round(value)));
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
