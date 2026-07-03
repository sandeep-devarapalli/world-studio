import type { ParsedObjMesh, ParsedPointCloud, PointRecord } from "@world-studio/artifacts";
import type { RendererDiagnostics, RenderAdapter, RenderOptions, SparkLoadState, WorldClass } from "@world-studio/world-core";
import * as THREE from "three";

export interface ThreeRendererInput {
  pointCloud: ParsedPointCloud;
  classes: WorldClass[];
  mesh?: ParsedObjMesh;
  gaussianUrl?: string;
  onDiagnosticsChange?: (diagnostics: RendererDiagnostics) => void;
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

const hiddenPoint = 1_000_000;
const plyHeaderEnd = "end_header";
const asciiPlyFormat = /^format\s+ascii\s+1\.0$/m;
const binaryLittleEndianPlyFormat = "format binary_little_endian 1.0";

type PlyScalarType = "char" | "uchar" | "short" | "ushort" | "int" | "uint" | "float" | "double";

interface PlyScalarProperty {
  type: PlyScalarType;
  name: string;
}

export class ThreeWorldRenderer implements RenderAdapter {
  private readonly points: PointRecord[];
  private readonly classColors: Map<number, THREE.Color>;
  private readonly mesh?: ParsedObjMesh;
  private readonly gaussianUrl?: string;
  private readonly onDiagnosticsChange?: (diagnostics: RendererDiagnostics) => void;
  private canvas?: HTMLCanvasElement;
  private webgl?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private pointCloud?: THREE.Points;
  private pointPositions: Float32Array;
  private pointColors: Float32Array;
  private meshGroup?: THREE.Group;
  private grid?: THREE.GridHelper;
  private frustums?: THREE.LineSegments;
  private agentGroup?: THREE.Group;
  private trajectoryLine?: THREE.Line;
  private sparkState: SparkLoadState = "idle";
  private sparkRenderer?: THREE.Object3D & { dispose?: () => void };
  private sparkMesh?: THREE.Object3D & { dispose?: () => void; getBoundingBox?: (centersOnly?: boolean) => THREE.Box3; initialized?: Promise<unknown>; isInitialized?: boolean; numSplats?: number };
  private sparkRenderable = false;
  private sparkFailureReason?: string;
  private sparkObjectUrl?: string;
  private lastCanvas?: HTMLCanvasElement;
  private lastOptions?: RenderOptions;
  private frameRequested = false;

  constructor(input: ThreeRendererInput) {
    this.points = input.pointCloud.points;
    this.mesh = input.mesh;
    this.gaussianUrl = input.gaussianUrl;
    this.onDiagnosticsChange = input.onDiagnosticsChange;
    this.pointPositions = new Float32Array(this.points.length * 3);
    this.pointColors = new Float32Array(this.points.length * 3);
    this.classColors = new Map(
      input.classes.map((entry, index) => [
        entry.label,
        new THREE.Color(entry.colorFlat ?? entry.colorShaded ?? fallbackClassColors[index % fallbackClassColors.length] ?? "#ece2d4")
      ])
    );
  }

  render(canvas: HTMLCanvasElement, options: RenderOptions): void {
    this.lastCanvas = canvas;
    this.lastOptions = options;
    this.ensureThree(canvas);
    if (!this.webgl || !this.scene || !this.camera) return;

    this.syncSize(canvas, options);
    this.syncPointCloud(options);
    this.syncMesh(options);
    this.syncSpark(options);
    this.syncAgent(options);
    this.syncTrajectory(options);
    this.syncWorldGuides(options);

    this.webgl.render(this.scene, this.camera);
  }

  collectInRadius(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number, radius: number): number[] {
    this.ensureThree(canvas);
    if (!this.camera) return [];
    this.updateCamera(canvas, options);

    const rect = canvas.getBoundingClientRect();
    const sx = ((x - rect.left) / rect.width) * 2 - 1;
    const sy = -(((y - rect.top) / rect.height) * 2 - 1);
    const normalizedRadius = (radius / Math.max(rect.width, rect.height)) * 2;
    const r2 = normalizedRadius * normalizedRadius;
    const out: number[] = [];

    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      if (!point || options.deleted.has(index)) continue;
      const projected = new THREE.Vector3(point.x, point.y, point.z).project(this.camera);
      const dx = projected.x - sx;
      const dy = projected.y - sy;
      if (projected.z <= 1 && dx * dx + dy * dy <= r2) out.push(index);
    }

    return out;
  }

  collectInRect(canvas: HTMLCanvasElement, options: RenderOptions, x0: number, y0: number, x1: number, y1: number): number[] {
    this.ensureThree(canvas);
    if (!this.camera) return [];
    this.updateCamera(canvas, options);

    const rect = canvas.getBoundingClientRect();
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const sx0 = ((left - rect.left) / rect.width) * 2 - 1;
    const sx1 = ((right - rect.left) / rect.width) * 2 - 1;
    const sy0 = -(((bottom - rect.top) / rect.height) * 2 - 1);
    const sy1 = -(((top - rect.top) / rect.height) * 2 - 1);
    const out: number[] = [];

    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      if (!point || options.deleted.has(index)) continue;
      const projected = new THREE.Vector3(point.x, point.y, point.z).project(this.camera);
      if (projected.z <= 1 && projected.x >= sx0 && projected.x <= sx1 && projected.y >= sy0 && projected.y <= sy1) {
        out.push(index);
      }
    }

    return out;
  }

  capture(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL("image/png");
  }

  getDiagnostics(): RendererDiagnostics {
    const sparkRenderable = this.sparkState === "ready" && this.sparkRenderable;
    return {
      splatRenderPath: sparkRenderable ? "spark-gaussian" : "point-fallback",
      sparkState: this.gaussianUrl ? this.sparkState : "unavailable",
      sparkRenderable,
      hasGaussianSource: Boolean(this.gaussianUrl),
      gaussianSplatCount: this.sparkMesh?.numSplats,
      sparkFailureReason: this.sparkFailureReason
    };
  }

  dispose(): void {
    this.sparkMesh?.dispose?.();
    this.sparkRenderer?.dispose?.();
    if (this.sparkObjectUrl) URL.revokeObjectURL(this.sparkObjectUrl);
    this.webgl?.dispose();
    this.canvas = undefined;
    this.webgl = undefined;
    this.scene = undefined;
    this.camera = undefined;
    this.pointCloud = undefined;
    this.meshGroup = undefined;
    this.grid = undefined;
    this.frustums = undefined;
    this.agentGroup = undefined;
    this.trajectoryLine = undefined;
    this.sparkRenderer = undefined;
    this.sparkMesh = undefined;
    this.sparkRenderable = false;
    this.sparkFailureReason = undefined;
    this.sparkObjectUrl = undefined;
    this.sparkState = "idle";
  }

  private ensureThree(canvas: HTMLCanvasElement): void {
    if (this.webgl && this.canvas === canvas) return;
    this.dispose();
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#15120e");
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 1000);
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.webgl.setClearColor("#15120e", 1);
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;

    this.grid = new THREE.GridHelper(12, 24, "#6f6254", "#2b241d");
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.34;
    this.scene.add(this.grid);

    this.frustums = createFrustums();
    this.scene.add(this.frustums);

    this.pointCloud = this.createPointCloud();
    this.scene.add(this.pointCloud);

    this.meshGroup = this.createMeshGroup();
    this.scene.add(this.meshGroup);

    this.agentGroup = createAgentGroup();
    this.scene.add(this.agentGroup);

    this.trajectoryLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: "#e0683a", transparent: true, opacity: 0.9 })
    );
    this.scene.add(this.trajectoryLine);

    void this.initializeSpark();
  }

  private syncSize(canvas: HTMLCanvasElement, options: RenderOptions): void {
    if (!this.webgl || !this.camera) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.webgl.setSize(width, height, false);
    this.updateCamera(canvas, options);
  }

  private updateCamera(canvas: HTMLCanvasElement, options: RenderOptions): void {
    if (!this.camera) return;
    const rect = canvas.getBoundingClientRect();
    const { yaw, pitch, distance, target, fov } = options.camera;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this.camera.fov = fov;
    this.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    this.camera.position.set(target[0] + distance * cp * sy, target[1] + distance * sp, target[2] + distance * cp * cy);
    this.camera.lookAt(target[0], target[1], target[2]);
    this.camera.updateProjectionMatrix();
  }

  private createPointCloud(): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pointPositions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.pointColors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.035,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      depthWrite: false
    });
    return new THREE.Points(geometry, material);
  }

  private syncPointCloud(options: RenderOptions): void {
    if (!this.pointCloud || !this.camera) return;
    const sparkActive = options.mode === "splat" && this.sparkState === "ready" && this.sparkRenderable;
    this.pointCloud.visible = options.mode !== "mesh" && !sparkActive;
    if (!this.pointCloud.visible) return;

    const material = this.pointCloud.material as THREE.PointsMaterial;
    material.size = options.mode === "splat" ? 0.062 : 0.034;
    material.opacity = options.mode === "splat" ? 0.74 : 0.96;
    material.needsUpdate = true;

    const stride = options.density >= 1 ? 1 : Math.max(1, Math.round(1 / options.density));
    const maxDistance = Math.max(1, options.camera.distance + 5);

    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      const offset = index * 3;
      const deleted = options.deleted.has(index);
      const densitySkipped = index % stride !== 0 && !options.selected.has(index);
      if (!point || densitySkipped || (deleted && !options.showDeleted)) {
        this.pointPositions[offset] = hiddenPoint;
        this.pointPositions[offset + 1] = hiddenPoint;
        this.pointPositions[offset + 2] = hiddenPoint;
        this.pointColors[offset] = 0;
        this.pointColors[offset + 1] = 0;
        this.pointColors[offset + 2] = 0;
        continue;
      }

      this.pointPositions[offset] = point.x;
      this.pointPositions[offset + 1] = point.y;
      this.pointPositions[offset + 2] = point.z;

      const color = this.colorForPoint(point, index, options, maxDistance);
      this.pointColors[offset] = color.r;
      this.pointColors[offset + 1] = color.g;
      this.pointColors[offset + 2] = color.b;
    }

    const geometry = this.pointCloud.geometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  private colorForPoint(point: PointRecord, index: number, options: RenderOptions, maxDistance: number): THREE.Color {
    if (options.deleted.has(index)) return new THREE.Color("#8e3b34").multiplyScalar(0.72);
    if (options.selected.has(index)) return new THREE.Color(options.accent);

    if (options.mode === "depth" && this.camera) {
      const distance = this.camera.position.distanceTo(new THREE.Vector3(point.x, point.y, point.z));
      return depthColor(distance / maxDistance);
    }

    if (options.mode === "semantic") {
      const semantic = this.classColors.get(point.semanticLabel ?? -1) ?? new THREE.Color("#ece2d4");
      if (options.isolatedClass !== undefined && point.semanticLabel !== options.isolatedClass) {
        return semantic.clone().lerp(new THREE.Color("#15120e"), 0.72);
      }
      return semantic.clone();
    }

    return new THREE.Color(
      clampUnit(((point.red ?? 236) / 255) * options.exposure),
      clampUnit(((point.green ?? 226) / 255) * options.exposure),
      clampUnit(((point.blue ?? 212) / 255) * options.exposure)
    );
  }

  private createMeshGroup(): THREE.Group {
    const group = new THREE.Group();
    if (!this.mesh?.triangles.length) return group;

    const positions = new Float32Array(this.mesh.triangles.length * 9);
    for (let index = 0; index < this.mesh.triangles.length; index++) {
      const triangle = this.mesh.triangles[index];
      const a = this.mesh.vertices[triangle.a];
      const b = this.mesh.vertices[triangle.b];
      const c = this.mesh.vertices[triangle.c];
      if (!a || !b || !c) continue;
      positions.set([...a, ...b, ...c], index * 9);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    const solid = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: "#d8c9b2",
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    group.add(solid);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: "#f2dfc7", transparent: true, opacity: 0.42 })
    );
    group.add(wire);
    return group;
  }

  private syncMesh(options: RenderOptions): void {
    if (!this.meshGroup) return;
    this.meshGroup.visible = options.mode === "mesh";
  }

  private syncSpark(options: RenderOptions): void {
    if (this.sparkState === "idle") void this.initializeSpark();
    const visible = options.mode === "splat" && this.sparkState === "ready" && this.sparkRenderable;
    if (this.sparkMesh) this.sparkMesh.visible = visible;
    if (this.sparkRenderer) this.sparkRenderer.visible = visible;
  }

  private async initializeSpark(): Promise<void> {
    if (!this.gaussianUrl || !this.webgl || !this.scene || this.sparkState !== "idle") return;
    this.sparkState = "loading";
    this.sparkFailureReason = undefined;
    this.notifyDiagnostics();
    try {
      const spark = await import("@sparkjsdev/spark");
      const sparkUrl = await sparkCompatiblePlyUrl(this.gaussianUrl);
      if (sparkUrl !== this.gaussianUrl) this.sparkObjectUrl = sparkUrl;
      this.sparkRenderer = new spark.SparkRenderer({
        renderer: this.webgl,
        onDirty: () => this.requestFrame(),
        minAlpha: 1 / 255,
        maxPixelRadius: 180,
        focalAdjustment: 1.5
      });
      this.scene.add(this.sparkRenderer);

      this.sparkMesh = new spark.SplatMesh({
        url: sparkUrl,
        editable: true,
        raycastable: true,
        onLoad: () => {
          this.sparkRenderable = this.hasRenderableSparkBounds();
          this.sparkState = "ready";
          this.notifyDiagnostics();
          this.requestFrame();
        }
      });
      this.sparkMesh.visible = false;
      this.scene.add(this.sparkMesh);
      this.sparkMesh.initialized?.then(() => {
        this.sparkRenderable = this.hasRenderableSparkBounds();
        this.sparkState = "ready";
        this.notifyDiagnostics();
        this.requestFrame();
      }).catch((error: unknown) => {
        this.sparkRenderable = false;
        this.sparkFailureReason = shortError(error);
        this.sparkState = "failed";
        this.notifyDiagnostics();
        this.requestFrame();
      });
    } catch (error) {
      this.sparkRenderable = false;
      this.sparkFailureReason = shortError(error);
      this.sparkState = "failed";
      this.notifyDiagnostics();
      this.requestFrame();
    }
  }

  private hasRenderableSparkBounds(): boolean {
    if (!this.sparkMesh || (this.sparkMesh.numSplats ?? 1) <= 0) return false;
    try {
      const bounds = this.sparkMesh.getBoundingBox?.(true);
      return Boolean(
        bounds &&
          Number.isFinite(bounds.min.x) &&
          Number.isFinite(bounds.min.y) &&
          Number.isFinite(bounds.min.z) &&
          Number.isFinite(bounds.max.x) &&
          Number.isFinite(bounds.max.y) &&
          Number.isFinite(bounds.max.z) &&
          !bounds.isEmpty()
      );
    } catch {
      return false;
    }
  }

  private syncAgent(options: RenderOptions): void {
    if (!this.agentGroup) return;
    this.agentGroup.visible = Boolean(options.agent);
    if (!options.agent) return;
    this.agentGroup.position.set(options.agent.x, 0.05, options.agent.z);
    this.agentGroup.rotation.y = Math.PI / 2 - options.agent.heading;
    const accent = new THREE.Color(options.accent);
    this.agentGroup.traverse((object) => {
      const material = (object as THREE.Mesh | THREE.Line).material;
      if (material && "color" in material) {
        (material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial).color.copy(accent);
      }
    });
  }

  private syncTrajectory(options: RenderOptions): void {
    if (!this.trajectoryLine) return;
    this.trajectoryLine.visible = Boolean(options.trajectory?.length);
    if (!options.trajectory?.length) return;
    const points = options.trajectory.map(([x, z]) => new THREE.Vector3(x, 0.04, z));
    this.trajectoryLine.geometry.dispose();
    this.trajectoryLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = this.trajectoryLine.material as THREE.LineBasicMaterial;
    material.color.set(options.accent);
  }

  private syncWorldGuides(options: RenderOptions): void {
    if (this.grid) this.grid.visible = options.grid;
    if (this.frustums) this.frustums.visible = options.grid;
  }

  private requestFrame(): void {
    if (this.frameRequested || !this.lastCanvas || !this.lastOptions) return;
    this.frameRequested = true;
    window.requestAnimationFrame(() => {
      this.frameRequested = false;
      if (this.lastCanvas && this.lastOptions) this.render(this.lastCanvas, this.lastOptions);
    });
  }

  private notifyDiagnostics(): void {
    this.onDiagnosticsChange?.(this.getDiagnostics());
  }
}

export const CanvasWorldRenderer = ThreeWorldRenderer;

export function createSparkRendererAdapter(input: ThreeRendererInput): ThreeWorldRenderer {
  return new ThreeWorldRenderer(input);
}

async function sparkCompatiblePlyUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load Gaussian PLY: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headerLength = findPlyHeaderLength(bytes);
  if (headerLength < 0) throw new Error("PLY header is missing end_header");

  const headerText = new TextDecoder().decode(bytes.slice(0, headerLength));
  if (!asciiPlyFormat.test(headerText)) return url;

  const { properties, vertexCount } = parseAsciiPlySchema(headerText);
  const body = new TextDecoder().decode(bytes.slice(headerLength)).trim();
  const lines = body.length ? body.split(/\r?\n/) : [];
  if (lines.length < vertexCount) {
    throw new Error(`ASCII Gaussian PLY has ${lines.length} rows for ${vertexCount} vertices`);
  }

  const binaryHeader = headerText.replace(asciiPlyFormat, binaryLittleEndianPlyFormat);
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

  return URL.createObjectURL(new Blob([output], { type: "application/octet-stream" }));
}

function findPlyHeaderLength(bytes: Uint8Array): number {
  for (let index = 0; index <= bytes.length - plyHeaderEnd.length; index++) {
    let matched = true;
    for (let needleIndex = 0; needleIndex < plyHeaderEnd.length; needleIndex++) {
      if (bytes[index + needleIndex] !== plyHeaderEnd.charCodeAt(needleIndex)) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    const after = index + plyHeaderEnd.length;
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

function createAgentGroup(): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.012, 8, 36),
    new THREE.MeshBasicMaterial({ color: "#e0683a", transparent: true, opacity: 0.95 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const mast = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.8, 0)]),
    new THREE.LineBasicMaterial({ color: "#e0683a", transparent: true, opacity: 0.86 })
  );
  group.add(mast);

  const heading = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.42, 3),
    new THREE.MeshBasicMaterial({ color: "#e0683a", transparent: true, opacity: 0.95 })
  );
  heading.rotation.x = Math.PI / 2;
  heading.position.z = 0.42;
  heading.position.y = 0.08;
  group.add(heading);
  return group;
}

function createFrustums(): THREE.LineSegments {
  const positions: number[] = [];
  const placements = [
    [-2.4, 1.7, -1.8, 0.45],
    [0.2, 2.1, 2.1, -2.35],
    [2.4, 1.5, -1.5, 2.62]
  ] as const;

  for (const [x, y, z, yaw] of placements) {
    const apex = new THREE.Vector3(x, y, z);
    const corners = [
      new THREE.Vector3(-0.36, -0.22, 0.72),
      new THREE.Vector3(0.36, -0.22, 0.72),
      new THREE.Vector3(0.36, 0.22, 0.72),
      new THREE.Vector3(-0.36, 0.22, 0.72)
    ].map((corner) => corner.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(apex));
    for (const corner of corners) pushLine(positions, apex, corner);
    pushLine(positions, corners[0], corners[1]);
    pushLine(positions, corners[1], corners[2]);
    pushLine(positions, corners[2], corners[3]);
    pushLine(positions, corners[3], corners[0]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: "#c7b69f", transparent: true, opacity: 0.24 })
  );
}

function pushLine(out: number[], a: THREE.Vector3, b: THREE.Vector3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function depthColor(t: number): THREE.Color {
  const stops = [
    new THREE.Color("#fce09d"),
    new THREE.Color("#f08e56"),
    new THREE.Color("#c44e52"),
    new THREE.Color("#782963"),
    new THREE.Color("#30124c"),
    new THREE.Color("#080619")
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const f = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(f));
  const u = f - index;
  return stops[index]?.clone().lerp(stops[index + 1] ?? stops[index], u) ?? new THREE.Color("#fce09d");
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 72);
}
