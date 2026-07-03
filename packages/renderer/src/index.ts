import type { ParsedObjMesh, ParsedPointCloud, PointRecord } from "@world-studio/artifacts";
import type {
  AgentMoveResult,
  AgentState,
  Bounds3,
  PhysicsDebugInfo,
  PropContactState,
  RenderAdapter,
  RendererDebugInfo,
  RenderOptions,
  SimulatedPropPreset,
  SimulatedPropState,
  SpawnPlacementResult,
  WorldClass
} from "@world-studio/world-core";
import type * as Rapier from "@dimforge/rapier3d-compat";
import * as THREE from "three";

export interface ThreeRendererInput {
  pointCloud: ParsedPointCloud;
  classes: WorldClass[];
  mesh?: ParsedObjMesh;
  gaussianUrl?: string;
}

type SparkState = "idle" | "loading" | "ready" | "failed";
type CollisionState = "idle" | "loading" | "ready" | "failed" | "unavailable";
type TrimeshData = { vertices: Float32Array; indices: Uint32Array };
type PropDefinition = {
  id: string;
  label: string;
  preset: SimulatedPropPreset;
  halfExtents: [number, number, number];
  spawn: [number, number, number];
  color: string;
};
type DynamicProp = PropDefinition & {
  mesh: THREE.Mesh;
  footprint: THREE.Mesh;
  body?: Rapier.RigidBody;
  collider?: Rapier.Collider;
};
type DebugOverlayObjects = {
  group: THREE.Group;
  agentFootprint: THREE.Object3D;
  moveLine: THREE.Line;
  moveTarget: THREE.Object3D;
};

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

export class ThreeWorldRenderer implements RenderAdapter {
  private readonly points: PointRecord[];
  private readonly classColors: Map<number, THREE.Color>;
  private readonly bounds: Bounds3;
  private readonly mesh?: ParsedObjMesh;
  private readonly gaussianUrl?: string;
  private readonly groundY: number;
  private readonly obstacleTrimesh?: TrimeshData;
  private readonly propDefinitions: PropDefinition[];
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
  private placementGroup?: THREE.Group;
  private propGroup?: THREE.Group;
  private simulationProps: DynamicProp[] = [];
  private debugOverlay?: DebugOverlayObjects;
  private trajectoryLine?: THREE.Line;
  private sparkState: SparkState = "idle";
  private sparkRenderer?: THREE.Object3D & { dispose?: () => void };
  private sparkMesh?: THREE.Object3D & { dispose?: () => void; getBoundingBox?: (centersOnly?: boolean) => THREE.Box3; initialized?: Promise<unknown>; isInitialized?: boolean; numSplats?: number };
  private sparkRenderable = false;
  private sparkSplatCount = 0;
  private sparkFailureReason?: string;
  private rapier?: typeof Rapier;
  private collisionWorld?: Rapier.World;
  private groundCollider?: Rapier.Collider;
  private obstacleCollider?: Rapier.Collider;
  private collisionState: CollisionState = "idle";
  private collisionGeneration = 0;
  private obstacleTriangleCount = 0;
  private simulationFixedTimestep = 1 / 60;
  private simulationStepIndex = 0;
  private simulationLastStepMs = 0;
  private lastSimulationCommandId = 0;
  private lastCanvas?: HTMLCanvasElement;
  private lastOptions?: RenderOptions;
  private frameRequested = false;

  constructor(input: ThreeRendererInput) {
    this.points = input.pointCloud.points;
    this.bounds = input.pointCloud.bounds;
    this.mesh = input.mesh;
    this.gaussianUrl = input.gaussianUrl;
    this.groundY = inferGroundY(input.pointCloud.bounds);
    this.obstacleTrimesh = input.mesh ? buildObstacleTrimesh(input.mesh, this.groundY) : undefined;
    this.obstacleTriangleCount = this.obstacleTrimesh ? this.obstacleTrimesh.indices.length / 3 : 0;
    this.propDefinitions = createDefaultProps(this.bounds, this.groundY);
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
    this.syncSimulation(options);
    this.syncAgent(options);
    this.syncSpawnPlacement(options);
    this.syncTrajectory(options);
    this.syncPhysicsDebug(options);
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

  querySpawnPlacement(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number, footprintRadius: number): SpawnPlacementResult {
    this.ensureThree(canvas);
    if (!this.camera) return spawnPlacement("unavailable", footprintRadius, "camera unavailable");
    this.updateCamera(canvas, options);

    const groundHit = this.pointerToGround(canvas, x, y);
    if (!groundHit) return spawnPlacement("miss", footprintRadius, "no ground intersection");

    const point = {
      x: groundHit.point.x,
      y: groundHit.point.y,
      z: groundHit.point.z
    };

    if (!this.isInsidePlacementBounds(groundHit.point, footprintRadius)) {
      return spawnPlacement("miss", footprintRadius, "outside world bounds", point);
    }

    if (!this.mesh?.triangles.length) {
      return spawnPlacement("unavailable", footprintRadius, "no collision mesh loaded", point);
    }

    if (this.collisionState === "idle") void this.initializeRapierCollisionWorld();
    if (this.collisionState === "loading") {
      return spawnPlacement("pending", footprintRadius, "collision world warming", point);
    }
    if (this.collisionState === "failed" || this.collisionState === "unavailable") {
      return spawnPlacement("unavailable", footprintRadius, "collision world unavailable", point);
    }

    if (!this.rapier || !this.collisionWorld) {
      return spawnPlacement("unavailable", footprintRadius, "collision world unavailable", point);
    }

    if (this.obstacleCollider) {
      const ray = new this.rapier.Ray(vectorFromThree(groundHit.origin), vectorFromThree(groundHit.direction));
      const occludingHit = this.collisionWorld.castRay(ray, Math.max(0, groundHit.distance - 0.015), true);
      if (occludingHit) {
        return spawnPlacement("blocked", footprintRadius, "blocked by collision mesh", point);
      }

      if (this.intersectsAgentFootprint(groundHit.point, footprintRadius)) {
        return spawnPlacement("blocked", footprintRadius, "agent footprint intersects mesh", point);
      }
    }

    return spawnPlacement("valid", footprintRadius, "grounded and clear", point);
  }

  queryAgentMove(from: AgentState, target: AgentState, footprintRadius: number): AgentMoveResult {
    const point = new THREE.Vector3(target.x, this.groundY, target.z);
    if (!this.isInsidePlacementBounds(point, footprintRadius)) {
      return agentMove("outside_bounds", from, target, from, footprintRadius, "outside world bounds");
    }

    if (!this.mesh?.triangles.length) {
      return agentMove("unavailable", from, target, from, footprintRadius, "no collision mesh loaded");
    }

    if (this.collisionState === "idle") void this.initializeRapierCollisionWorld();
    if (this.collisionState === "loading") {
      return agentMove("pending", from, target, from, footprintRadius, "collision world warming");
    }
    if (this.collisionState === "failed" || this.collisionState === "unavailable" || !this.rapier || !this.collisionWorld) {
      return agentMove("unavailable", from, target, from, footprintRadius, "collision world unavailable");
    }

    if (this.obstacleCollider && this.intersectsAgentFootprint(point, footprintRadius)) {
      return agentMove("blocked", from, target, from, footprintRadius, "movement blocked by mesh");
    }

    return agentMove("clear", from, target, target, footprintRadius, "movement clear");
  }

  queryPropAt(canvas: HTMLCanvasElement, options: RenderOptions, x: number, y: number): SimulatedPropState | null {
    this.ensureThree(canvas);
    if (!this.camera || !options.simulationVisible || !this.simulationProps.length) return null;
    this.updateCamera(canvas, options);

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pointer = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObjects(this.simulationProps.map((prop) => prop.mesh), false);
    const propId = hits[0]?.object.userData.propId;
    if (typeof propId !== "string") return null;
    return this.getSimulatedPropStates().find((prop) => prop.id === propId) ?? null;
  }

  getPhysicsDebugInfo(): PhysicsDebugInfo {
    return {
      status: this.collisionState,
      obstacleTriangles: this.obstacleTriangleCount,
      colliders: this.colliderCount(),
      dynamicBodies: this.simulationProps.filter((prop) => prop.body).length,
      fixedTimestep: this.simulationFixedTimestep,
      simulationStep: this.simulationStepIndex,
      lastStepMs: this.simulationLastStepMs,
      props: this.getSimulatedPropStates(),
      source: this.collisionState === "ready" ? "rapier-collision-world" : "renderer"
    };
  }

  getRendererDebugInfo(): RendererDebugInfo {
    const sparkStatus = this.gaussianUrl ? this.sparkState : "unavailable";
    const hasSpark = this.canRenderSpark();
    const activeSplatBackend = hasSpark ? "spark" : this.gaussianUrl ? "points-fallback" : "unavailable";
    const message = hasSpark
      ? "Spark SplatMesh active"
      : this.gaussianUrl
        ? this.sparkFailureReason ?? (this.sparkState === "loading" ? "Spark loading" : "ordinary PLY fallback")
        : "no Gaussian PLY";

    return {
      activeSplatBackend,
      sparkStatus,
      sparkRenderable: hasSpark,
      sparkSplatCount: this.sparkSplatCount,
      pointCount: this.points.length,
      gaussianUrl: this.gaussianUrl,
      message
    };
  }

  capture(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL("image/png");
  }

  dispose(): void {
    this.collisionGeneration++;
    this.collisionWorld?.free();
    this.sparkMesh?.dispose?.();
    this.sparkRenderer?.dispose?.();
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
    this.placementGroup = undefined;
    this.propGroup = undefined;
    this.simulationProps = [];
    this.debugOverlay = undefined;
    this.trajectoryLine = undefined;
    this.sparkRenderer = undefined;
    this.sparkMesh = undefined;
    this.sparkRenderable = false;
    this.sparkSplatCount = 0;
    this.sparkFailureReason = undefined;
    this.sparkState = "idle";
    this.rapier = undefined;
    this.collisionWorld = undefined;
    this.groundCollider = undefined;
    this.obstacleCollider = undefined;
    this.collisionState = "idle";
    this.simulationStepIndex = 0;
    this.simulationLastStepMs = 0;
    this.lastSimulationCommandId = 0;
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

    this.placementGroup = createPlacementGroup();
    this.scene.add(this.placementGroup);

    this.propGroup = this.createPropGroup();
    this.scene.add(this.propGroup);

    this.debugOverlay = createPhysicsDebugOverlay(this.obstacleTrimesh);
    this.scene.add(this.debugOverlay.group);

    this.trajectoryLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: "#e0683a", transparent: true, opacity: 0.9 })
    );
    this.scene.add(this.trajectoryLine);

    void this.initializeSpark();
    void this.initializeRapierCollisionWorld();
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
    const splatFallback = options.mode === "splat" && !this.canRenderSpark();
    this.pointCloud.visible = options.mode === "points" || options.mode === "semantic" || options.mode === "depth" || splatFallback;
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
    const visible = options.mode === "splat" && this.canRenderSpark();
    if (this.sparkMesh) this.sparkMesh.visible = visible;
    if (this.sparkRenderer) this.sparkRenderer.visible = visible;
  }

  private async initializeSpark(): Promise<void> {
    if (!this.gaussianUrl || !this.webgl || !this.scene || this.sparkState !== "idle") return;
    this.sparkState = "loading";
    this.sparkFailureReason = undefined;
    try {
      const spark = await import("@sparkjsdev/spark");
      const fileBytes = await this.loadSparkFileBytes();
      this.sparkRenderer = new spark.SparkRenderer({
        renderer: this.webgl,
        onDirty: () => this.requestFrame(),
        minAlpha: 1 / 255,
        maxPixelRadius: 180,
        focalAdjustment: 1.5
      });
      this.scene.add(this.sparkRenderer);

      this.sparkMesh = new spark.SplatMesh({
        fileBytes,
        fileName: fileNameFromUrl(this.gaussianUrl),
        editable: true,
        raycastable: true,
        onLoad: () => {
          this.sparkRenderable = this.hasRenderableSparkBounds();
          this.sparkState = "ready";
          this.sparkFailureReason = this.sparkRenderable ? undefined : "Spark loaded without renderable bounds";
          this.requestFrame();
        }
      });
      this.sparkMesh.visible = false;
      this.scene.add(this.sparkMesh);
      this.sparkMesh.initialized?.then(() => {
        this.sparkRenderable = this.hasRenderableSparkBounds();
        this.sparkState = "ready";
        this.sparkFailureReason = this.sparkRenderable ? undefined : "Spark initialized without renderable bounds";
        this.requestFrame();
      }).catch((error: unknown) => {
        this.sparkRenderable = false;
        this.sparkState = "failed";
        this.sparkFailureReason = errorMessage(error, "Spark SplatMesh failed to initialize");
        this.requestFrame();
      });
    } catch (error) {
      this.sparkRenderable = false;
      this.sparkState = "failed";
      this.sparkFailureReason = errorMessage(error, "Spark renderer failed to load");
      this.requestFrame();
    }
  }

  private async loadSparkFileBytes(): Promise<Uint8Array> {
    if (!this.gaussianUrl) throw new Error("No Gaussian PLY URL");
    const response = await fetch(this.gaussianUrl);
    if (!response.ok) throw new Error(`Failed to fetch Gaussian PLY: ${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return convertAsciiPlyToBinaryLittleEndian(bytes);
  }

  private hasRenderableSparkBounds(): boolean {
    if (!this.sparkMesh) return false;
    this.sparkSplatCount = this.sparkMesh.numSplats ?? 0;
    if (this.sparkSplatCount <= 0) return false;
    try {
      const bounds = this.sparkMesh.getBoundingBox?.(true);
      if (!bounds) return true;
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
      return true;
    }
  }

  private canRenderSpark(): boolean {
    return this.sparkState === "ready" && this.sparkRenderable;
  }

  private createPropGroup(): THREE.Group {
    const group = new THREE.Group();
    this.simulationProps = this.propDefinitions.map((definition) => {
      const prop = this.createDynamicProp(definition);
      group.add(prop.mesh, prop.footprint);
      return prop;
    });
    group.visible = false;
    return group;
  }

  private syncSimulation(options: RenderOptions): void {
    if (this.propGroup) this.propGroup.visible = Boolean(options.simulationVisible);
    if (this.collisionState === "idle") void this.initializeRapierCollisionWorld();

    const command = options.simulationCommand;
    if (command && command.id !== this.lastSimulationCommandId) {
      this.lastSimulationCommandId = command.id;
      if (command.action === "reset") this.resetSimulationProps();
      if (command.action === "step") this.stepSimulationProps(command.steps ?? 1);
      if (command.action === "spawn-prop") this.spawnSimulationProp(command);
      if (command.action === "delete-prop") this.deleteSimulationProp(command.targetPropId);
      if (command.action === "duplicate-prop") this.duplicateSimulationProp(command);
      if (command.action === "reset-prop") this.resetSimulationProp(command.targetPropId);
      if (command.action === "nudge-prop") this.nudgeSimulationProp(command);
      if (command.action === "move-prop") this.moveSimulationProp(command);
    }

    this.syncSimulationPropMeshes();
  }

  private ensureSimulationBodies(): boolean {
    if (!this.rapier || !this.collisionWorld || this.collisionState !== "ready") return false;
    for (const prop of this.simulationProps) {
      if (prop.body && prop.collider) continue;
      this.attachPropBody(prop);
    }
    return true;
  }

  private attachPropBody(prop: DynamicProp): boolean {
    if (!this.rapier || !this.collisionWorld || prop.body || prop.collider) return false;
    const body = this.collisionWorld.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(prop.spawn[0], prop.spawn[1], prop.spawn[2])
        .setLinearDamping(0.18)
        .setAngularDamping(0.42)
        .setCanSleep(true)
    );
    const collider = this.collisionWorld.createCollider(
      this.rapier.ColliderDesc.cuboid(prop.halfExtents[0], prop.halfExtents[1], prop.halfExtents[2]).setFriction(0.82).setRestitution(0.05),
      body
    );
    prop.body = body;
    prop.collider = collider;
    return true;
  }

  private spawnSimulationProp(command: NonNullable<RenderOptions["simulationCommand"]>): void {
    const preset = command.preset ?? "crate";
    const position = command.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;

    const spec = propPresetSpec(preset);
    const definition: PropDefinition = {
      id: `pilot-${command.id}`,
      label: `${preset}_${command.id}`,
      preset,
      halfExtents: spec.halfExtents,
      spawn: [position.x, position.y + spec.halfExtents[1] + 0.04, position.z],
      color: spec.color
    };
    const prop = this.createDynamicProp(definition);
    this.simulationProps.push(prop);
    this.propGroup?.add(prop.mesh, prop.footprint);
    this.attachPropBody(prop);
    this.syncSimulationPropMeshes();
    this.requestFrame();
  }

  private createDynamicProp(definition: PropDefinition): DynamicProp {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(definition.halfExtents[0] * 2, definition.halfExtents[1] * 2, definition.halfExtents[2] * 2),
      new THREE.MeshBasicMaterial({ color: definition.color, transparent: true, opacity: 0.86, wireframe: true })
    );
    mesh.userData.propId = definition.id;
    mesh.position.set(...definition.spawn);

    const footprint = createPropFootprint();
    footprint.position.set(definition.spawn[0], this.groundY + 0.055, definition.spawn[2]);
    footprint.scale.setScalar(propPresetSpec(definition.preset).footprintRadius);

    return { ...definition, mesh, footprint };
  }

  private deleteSimulationProp(propId: string | undefined): void {
    const index = this.simulationProps.findIndex((prop) => prop.id === propId);
    if (index < 0) return;
    const [prop] = this.simulationProps.splice(index, 1);
    if (!prop) return;

    this.propGroup?.remove(prop.mesh, prop.footprint);
    if (prop.body) {
      this.collisionWorld?.removeRigidBody(prop.body);
    } else if (prop.collider) {
      this.collisionWorld?.removeCollider(prop.collider, true);
    }
    prop.mesh.geometry.dispose();
    (prop.mesh.material as THREE.Material).dispose();
    prop.footprint.geometry.dispose();
    (prop.footprint.material as THREE.Material).dispose();
    this.requestFrame();
  }

  private duplicateSimulationProp(command: NonNullable<RenderOptions["simulationCommand"]>): void {
    const source = this.findSimulationProp(command.targetPropId);
    if (!source) return;
    const translation = this.getPropTranslation(source);
    const radius = this.getPropFootprintRadius(source);
    const point = new THREE.Vector3(translation.x + radius + 0.32, this.groundY, translation.z + radius * 0.35);
    if (!this.isInsidePlacementBounds(point, radius)) return;

    const definition: PropDefinition = {
      id: `pilot-${command.id}`,
      label: `${source.preset}_${command.id}`,
      preset: source.preset,
      halfExtents: source.halfExtents.slice() as [number, number, number],
      spawn: [point.x, translation.y, point.z],
      color: source.color
    };
    const prop = this.createDynamicProp(definition);
    this.simulationProps.push(prop);
    this.propGroup?.add(prop.mesh, prop.footprint);
    this.attachPropBody(prop);
    this.syncSimulationPropMeshes();
    this.requestFrame();
  }

  private resetSimulationProp(propId: string | undefined): void {
    const prop = this.findSimulationProp(propId);
    if (!prop || !this.ensureSimulationBodies()) return;
    this.resetPropBody(prop);
    this.syncSimulationPropMeshes();
    this.requestFrame();
  }

  private nudgeSimulationProp(command: NonNullable<RenderOptions["simulationCommand"]>): void {
    const prop = this.findSimulationProp(command.targetPropId);
    if (!prop || !command.delta || !this.ensureSimulationBodies()) return;
    const translation = this.getPropTranslation(prop);
    const next = {
      x: translation.x + command.delta.x,
      y: translation.y + (command.delta.y ?? 0),
      z: translation.z + command.delta.z
    };
    if (!this.isInsidePlacementBounds(new THREE.Vector3(next.x, this.groundY, next.z), this.getPropFootprintRadius(prop))) return;

    prop.body?.setTranslation(vector(next.x, next.y, next.z), true);
    prop.body?.setLinvel(vector(0, 0, 0), true);
    prop.body?.setAngvel(vector(0, 0, 0), true);
    this.syncSimulationPropMeshes();
    this.requestFrame();
  }

  private moveSimulationProp(command: NonNullable<RenderOptions["simulationCommand"]>): void {
    const prop = this.findSimulationProp(command.targetPropId);
    const position = command.position;
    if (!prop || !position || !this.ensureSimulationBodies()) return;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
    if (!this.isInsidePlacementBounds(new THREE.Vector3(position.x, this.groundY, position.z), this.getPropFootprintRadius(prop))) return;

    prop.body?.setTranslation(vector(position.x, position.y + prop.halfExtents[1] + 0.04, position.z), true);
    prop.body?.setLinvel(vector(0, 0, 0), true);
    prop.body?.setAngvel(vector(0, 0, 0), true);
    this.syncSimulationPropMeshes();
    this.requestFrame();
  }

  private resetSimulationProps(): void {
    if (!this.ensureSimulationBodies()) return;
    for (const prop of this.simulationProps) {
      this.resetPropBody(prop);
    }
    this.simulationStepIndex = 0;
    this.simulationLastStepMs = 0;
    this.syncSimulationPropMeshes();
    this.requestFrame();
  }

  private stepSimulationProps(steps: number): void {
    if (!this.ensureSimulationBodies() || !this.collisionWorld) return;
    const count = Math.max(1, Math.min(240, Math.floor(steps)));
    const start = performance.now();
    this.collisionWorld.timestep = this.simulationFixedTimestep;
    for (let index = 0; index < count; index++) {
      this.collisionWorld.step();
    }
    this.simulationStepIndex += count;
    this.simulationLastStepMs = performance.now() - start;
    this.syncSimulationPropMeshes();
    this.requestFrame();
  }

  private syncSimulationPropMeshes(): void {
    const selectedPropId = this.lastOptions?.selectedPropId;
    for (const prop of this.simulationProps) {
      const translation = prop.body?.translation() ?? vector(prop.spawn[0], prop.spawn[1], prop.spawn[2]);
      const rotation = prop.body?.rotation() ?? { x: 0, y: 0, z: 0, w: 1 };
      const contactState = this.getPropContactState(prop, translation);
      prop.mesh.position.set(translation.x, translation.y, translation.z);
      prop.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      prop.footprint.position.set(translation.x, this.groundY + 0.055, translation.z);
      prop.footprint.scale.setScalar(this.getPropFootprintRadius(prop));
      this.syncPropAppearance(prop, contactState, prop.id === selectedPropId);
    }
  }

  private getSimulatedPropStates(): SimulatedPropState[] {
    return this.simulationProps.map((prop) => {
      const translation = prop.body?.translation() ?? vector(prop.spawn[0], prop.spawn[1], prop.spawn[2]);
      const contactState = this.getPropContactState(prop, translation);
      return {
        id: prop.id,
        label: prop.label,
        shape: "box",
        preset: prop.preset,
        contactState,
        footprintRadius: this.getPropFootprintRadius(prop),
        height: prop.halfExtents[1] * 2,
        x: translation.x,
        y: translation.y,
        z: translation.z,
        sleeping: prop.body?.isSleeping() ?? false
      };
    });
  }

  private findSimulationProp(propId: string | undefined): DynamicProp | undefined {
    return propId ? this.simulationProps.find((prop) => prop.id === propId) : undefined;
  }

  private getPropTranslation(prop: DynamicProp): Rapier.Vector {
    return prop.body?.translation() ?? vector(prop.spawn[0], prop.spawn[1], prop.spawn[2]);
  }

  private resetPropBody(prop: DynamicProp): void {
    prop.body?.setTranslation(vector(prop.spawn[0], prop.spawn[1], prop.spawn[2]), true);
    prop.body?.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    prop.body?.setLinvel(vector(0, 0, 0), true);
    prop.body?.setAngvel(vector(0, 0, 0), true);
  }

  private getPropContactState(prop: DynamicProp, translation: Rapier.Vector): PropContactState {
    if (prop.body?.isSleeping()) return "sleeping";
    const groundedY = this.groundY + prop.halfExtents[1];
    return translation.y <= groundedY + 0.08 ? "grounded" : "airborne";
  }

  private getPropFootprintRadius(prop: DynamicProp): number {
    return propPresetSpec(prop.preset).footprintRadius;
  }

  private syncPropAppearance(prop: DynamicProp, contactState: PropContactState, selected: boolean): void {
    const meshMaterial = prop.mesh.material as THREE.MeshBasicMaterial;
    meshMaterial.color.set(selected ? "#ece2d4" : prop.color);
    meshMaterial.opacity = selected ? 1 : 0.82;

    const footprintMaterial = prop.footprint.material as THREE.MeshBasicMaterial;
    footprintMaterial.color.set(propContactColor(contactState));
    footprintMaterial.opacity = selected ? 0.96 : contactState === "airborne" ? 0.7 : 0.86;
  }

  private colliderCount(): number {
    return (
      (this.groundCollider ? 1 : 0) +
      (this.obstacleCollider ? 1 : 0) +
      this.simulationProps.filter((prop) => prop.collider).length
    );
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

  private syncSpawnPlacement(options: RenderOptions): void {
    if (!this.placementGroup) return;
    const placement = options.spawnPlacement;
    const hasPoint = placement?.x !== undefined && placement.y !== undefined && placement.z !== undefined;
    this.placementGroup.visible = Boolean(hasPoint && placement?.status !== "miss");
    if (!placement || !hasPoint) return;

    this.placementGroup.position.set(placement.x ?? 0, (placement.y ?? this.groundY) + 0.035, placement.z ?? 0);
    this.placementGroup.scale.setScalar(Math.max(0.12, placement.footprintRadius));

    const color = placementColor(placement.status);
    const opacity = placement.status === "valid" ? 0.92 : placement.status === "blocked" ? 0.95 : 0.68;
    this.placementGroup.traverse((object) => {
      const material = (object as THREE.Mesh | THREE.Line).material;
      if (!material || !("color" in material)) return;
      (material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial).color.set(color);
      if ("opacity" in material) {
        (material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial).opacity = opacity;
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

  private syncPhysicsDebug(options: RenderOptions): void {
    if (!this.debugOverlay) return;
    this.debugOverlay.group.visible = Boolean(options.physicsDebug);
    if (!options.physicsDebug) return;

    const radius = options.agentMove?.footprintRadius ?? options.spawnPlacement?.footprintRadius ?? 0.36;
    this.debugOverlay.agentFootprint.visible = Boolean(options.agent);
    if (options.agent) {
      this.debugOverlay.agentFootprint.position.set(options.agent.x, this.groundY + 0.075, options.agent.z);
      this.debugOverlay.agentFootprint.scale.setScalar(radius);
    }

    const move = options.agentMove;
    this.debugOverlay.moveLine.visible = Boolean(move);
    this.debugOverlay.moveTarget.visible = Boolean(move);
    if (!move) return;

    const color = moveStatusColor(move.status);
    const points = [
      new THREE.Vector3(move.from.x, this.groundY + 0.12, move.from.z),
      new THREE.Vector3(move.target.x, this.groundY + 0.12, move.target.z)
    ];
    this.debugOverlay.moveLine.geometry.dispose();
    this.debugOverlay.moveLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    (this.debugOverlay.moveLine.material as THREE.LineBasicMaterial).color.set(color);

    this.debugOverlay.moveTarget.position.set(move.target.x, this.groundY + 0.09, move.target.z);
    this.debugOverlay.moveTarget.scale.setScalar(move.footprintRadius);
    this.debugOverlay.moveTarget.traverse((object) => {
      const material = (object as THREE.Mesh | THREE.Line).material;
      if (material && "color" in material) {
        (material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial).color.set(color);
      }
    });
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

  private async initializeRapierCollisionWorld(): Promise<void> {
    if (this.collisionState !== "idle") return;
    if (!this.mesh?.triangles.length) {
      this.collisionState = "unavailable";
      return;
    }

    const generation = this.collisionGeneration;
    this.collisionState = "loading";
    try {
      const rapier = await import("@dimforge/rapier3d-compat");
      await rapier.init();
      if (generation !== this.collisionGeneration) return;

      const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
      this.rapier = rapier;
      this.collisionWorld = world;
      this.groundCollider = world.createCollider(createGroundColliderDesc(rapier, this.bounds, this.groundY));
      if (this.obstacleTrimesh?.indices.length) {
        this.obstacleCollider = world.createCollider(rapier.ColliderDesc.trimesh(this.obstacleTrimesh.vertices, this.obstacleTrimesh.indices));
      }
      this.collisionState = "ready";
      this.resetSimulationProps();
      this.requestFrame();
    } catch {
      if (generation !== this.collisionGeneration) return;
      this.rapier = undefined;
      this.collisionWorld = undefined;
      this.groundCollider = undefined;
      this.obstacleCollider = undefined;
      this.collisionState = "failed";
      this.requestFrame();
    }
  }

  private pointerToGround(canvas: HTMLCanvasElement, x: number, y: number): { origin: THREE.Vector3; direction: THREE.Vector3; point: THREE.Vector3; distance: number } | null {
    if (!this.camera) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    const origin = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(this.camera);
    const far = new THREE.Vector3(ndc.x, ndc.y, 1).unproject(this.camera);
    const direction = far.sub(origin).normalize();
    if (Math.abs(direction.y) < 0.00001) return null;

    const distance = (this.groundY - origin.y) / direction.y;
    if (!Number.isFinite(distance) || distance <= 0) return null;

    const point = origin.clone().addScaledVector(direction, distance);
    point.y = this.groundY;
    return { origin, direction, point, distance };
  }

  private isInsidePlacementBounds(point: THREE.Vector3, footprintRadius: number): boolean {
    const margin = Math.max(footprintRadius, 0.2);
    const [minX, , minZ] = this.bounds.min;
    const [maxX, , maxZ] = this.bounds.max;
    if (![minX, minZ, maxX, maxZ].every(Number.isFinite)) return true;
    return point.x >= minX + margin && point.x <= maxX - margin && point.z >= minZ + margin && point.z <= maxZ - margin;
  }

  private intersectsAgentFootprint(point: THREE.Vector3, footprintRadius: number): boolean {
    if (!this.rapier || !this.collisionWorld || !this.obstacleCollider) return false;
    let blocked = false;
    const shape = this.rapier.ColliderDesc.cylinder(0.86, footprintRadius).shape;
    this.collisionWorld.intersectionsWithShape(
      { x: point.x, y: point.y + 0.86, z: point.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        blocked = true;
        return false;
      }
    );
    return blocked;
  }
}

export const CanvasWorldRenderer = ThreeWorldRenderer;

export function createSparkRendererAdapter(input: ThreeRendererInput): ThreeWorldRenderer {
  return new ThreeWorldRenderer(input);
}

type PlyScalarType = "char" | "uchar" | "short" | "ushort" | "int" | "uint" | "float" | "double";

interface PlyElementLayout {
  name: string;
  count: number;
  properties: Array<{ name: string; type: PlyScalarType }>;
}

function convertAsciiPlyToBinaryLittleEndian(bytes: Uint8Array): Uint8Array {
  const headerLength = findPlyHeaderLength(bytes);
  const header = new TextDecoder().decode(bytes.slice(0, headerLength));
  const layout = parsePlyLayout(header);
  if (layout.format !== "ascii") return bytes;

  const binaryHeader = header.replace(/^format\s+ascii\s+1\.0\s*$/m, "format binary_little_endian 1.0");
  const headerBytes = new TextEncoder().encode(binaryHeader);
  const binaryLength = layout.elements.reduce(
    (total, element) => total + element.count * element.properties.reduce((sum, property) => sum + plyScalarSize(property.type), 0),
    0
  );
  const out = new Uint8Array(headerBytes.length + binaryLength);
  out.set(headerBytes);

  const body = new TextDecoder().decode(bytes.slice(headerLength)).trim();
  const rows = body ? body.split(/\r?\n/) : [];
  const view = new DataView(out.buffer, headerBytes.length);
  let rowIndex = 0;
  let offset = 0;

  for (const element of layout.elements) {
    for (let elementIndex = 0; elementIndex < element.count; elementIndex++) {
      const cols = rows[rowIndex]?.trim().split(/\s+/) ?? [];
      rowIndex++;
      if (cols.length < element.properties.length) {
        throw new Error(`ASCII PLY row ${rowIndex} is missing scalar properties`);
      }
      for (let propertyIndex = 0; propertyIndex < element.properties.length; propertyIndex++) {
        const property = element.properties[propertyIndex];
        const value = Number(cols[propertyIndex]);
        if (!property || !Number.isFinite(value)) throw new Error(`ASCII PLY row ${rowIndex} has a non-finite scalar`);
        writePlyScalar(view, offset, property.type, value);
        offset += plyScalarSize(property.type);
      }
    }
  }

  return out;
}

function parsePlyLayout(header: string): { format: string; elements: PlyElementLayout[] } {
  const elements: PlyElementLayout[] = [];
  let current: PlyElementLayout | undefined;
  let format = "unknown";

  for (const line of header.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "format") {
      format = parts[1] ?? "unknown";
      continue;
    }
    if (parts[0] === "element") {
      current = { name: parts[1] ?? "unknown", count: Number(parts[2] ?? 0), properties: [] };
      if (!Number.isInteger(current.count) || current.count < 0) throw new Error(`Invalid PLY element count: ${line}`);
      elements.push(current);
      continue;
    }
    if (parts[0] === "property" && current) {
      if (parts[1] === "list") throw new Error("ASCII PLY list properties are not supported for Spark conversion");
      const type = normalizePlyScalarType(parts[1]);
      current.properties.push({ type, name: parts[2] ?? "property" });
    }
  }

  return { format, elements };
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
      throw new Error(`Unsupported PLY scalar type: ${type ?? "unknown"}`);
  }
}

function findPlyHeaderLength(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode("end_header");
  for (let index = 0; index <= bytes.length - marker.length; index++) {
    let matches = true;
    for (let markerIndex = 0; markerIndex < marker.length; markerIndex++) {
      if (bytes[index + markerIndex] !== marker[markerIndex]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    let end = index + marker.length;
    if (bytes[end] === 13) end++;
    if (bytes[end] === 10) end++;
    return end;
  }
  throw new Error("PLY header is missing end_header");
}

function plyScalarSize(type: PlyScalarType): number {
  if (type === "char" || type === "uchar") return 1;
  if (type === "short" || type === "ushort") return 2;
  if (type === "double") return 8;
  return 4;
}

function writePlyScalar(view: DataView, offset: number, type: PlyScalarType, value: number): void {
  if (type === "char") view.setInt8(offset, value);
  else if (type === "uchar") view.setUint8(offset, value);
  else if (type === "short") view.setInt16(offset, value, true);
  else if (type === "ushort") view.setUint16(offset, value, true);
  else if (type === "int") view.setInt32(offset, value, true);
  else if (type === "uint") view.setUint32(offset, value, true);
  else if (type === "float") view.setFloat32(offset, value, true);
  else view.setFloat64(offset, value, true);
}

function fileNameFromUrl(url: string | undefined): string {
  const path = url?.split(/[?#]/)[0] ?? "";
  return path.split("/").filter(Boolean).pop() ?? "gaussians.ply";
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

function createPlacementGroup(): THREE.Group {
  const group = new THREE.Group();
  group.visible = false;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.035, 8, 52),
    new THREE.MeshBasicMaterial({ color: "#67c06f", transparent: true, opacity: 0.92, depthWrite: false })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const cross = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.72, 0.03, 0),
      new THREE.Vector3(0.72, 0.03, 0),
      new THREE.Vector3(0, 0.03, -0.72),
      new THREE.Vector3(0, 0.03, 0.72)
    ]),
    new THREE.LineBasicMaterial({ color: "#67c06f", transparent: true, opacity: 0.72, depthWrite: false })
  );
  group.add(cross);

  const mast = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.72, 0)]),
    new THREE.LineBasicMaterial({ color: "#67c06f", transparent: true, opacity: 0.44, depthWrite: false })
  );
  group.add(mast);

  return group;
}

function createPhysicsDebugOverlay(obstacleTrimesh?: TrimeshData): DebugOverlayObjects {
  const group = new THREE.Group();
  group.visible = false;

  if (obstacleTrimesh?.indices.length) {
    const obstacleGeometry = new THREE.BufferGeometry();
    obstacleGeometry.setAttribute("position", new THREE.BufferAttribute(obstacleTrimesh.vertices, 3));
    obstacleGeometry.setIndex(new THREE.BufferAttribute(obstacleTrimesh.indices, 1));
    const obstacleWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(obstacleGeometry),
      new THREE.LineBasicMaterial({ color: "#d9764a", transparent: true, opacity: 0.72, depthWrite: false })
    );
    group.add(obstacleWire);
  }

  const agentFootprint = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.025, 8, 48),
    new THREE.MeshBasicMaterial({ color: "#67c06f", transparent: true, opacity: 0.9, depthWrite: false })
  );
  agentFootprint.rotation.x = Math.PI / 2;
  agentFootprint.visible = false;
  group.add(agentFootprint);

  const moveLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: "#67c06f", transparent: true, opacity: 0.92, depthWrite: false })
  );
  moveLine.visible = false;
  group.add(moveLine);

  const moveTarget = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.022, 8, 42),
    new THREE.MeshBasicMaterial({ color: "#67c06f", transparent: true, opacity: 0.74, depthWrite: false })
  );
  moveTarget.rotation.x = Math.PI / 2;
  moveTarget.visible = false;
  group.add(moveTarget);

  return { group, agentFootprint, moveLine, moveTarget };
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

function spawnPlacement(
  status: SpawnPlacementResult["status"],
  footprintRadius: number,
  message: string,
  point?: Pick<SpawnPlacementResult, "x" | "y" | "z">
): SpawnPlacementResult {
  return {
    status,
    footprintRadius,
    message,
    source: status === "valid" || status === "blocked" ? "rapier-collision-world" : "renderer",
    ...point
  };
}

function agentMove(
  status: AgentMoveResult["status"],
  from: AgentState,
  target: AgentState,
  resolved: AgentState,
  footprintRadius: number,
  message: string
): AgentMoveResult {
  return {
    status,
    from,
    target,
    resolved,
    footprintRadius,
    message,
    source: status === "clear" || status === "blocked" ? "rapier-collision-world" : "renderer"
  };
}

function vectorFromThree(value: THREE.Vector3): Rapier.Vector {
  return { x: value.x, y: value.y, z: value.z };
}

function vector(x: number, y: number, z: number): Rapier.Vector {
  return { x, y, z };
}

function createGroundColliderDesc(rapier: typeof Rapier, bounds: Bounds3, groundY: number): Rapier.ColliderDesc {
  const [minX, , minZ] = bounds.min;
  const [maxX, , maxZ] = bounds.max;
  const finite = [minX, minZ, maxX, maxZ].every(Number.isFinite);
  const centerX = finite ? (minX + maxX) / 2 : 0;
  const centerZ = finite ? (minZ + maxZ) / 2 : 0;
  const halfX = finite ? Math.max(3, (maxX - minX) / 2 + 1.5) : 6;
  const halfZ = finite ? Math.max(3, (maxZ - minZ) / 2 + 1.5) : 6;
  return rapier.ColliderDesc.cuboid(halfX, 0.04, halfZ).setTranslation(centerX, groundY - 0.05, centerZ).setFriction(0.95);
}

function createDefaultProps(bounds: Bounds3, groundY: number): PropDefinition[] {
  const [minX, , minZ] = bounds.min;
  const [maxX, , maxZ] = bounds.max;
  const finite = [minX, minZ, maxX, maxZ].every(Number.isFinite);
  const centerX = finite ? (minX + maxX) / 2 : 0;
  const centerZ = finite ? (minZ + maxZ) / 2 : 0;
  const spanX = finite ? Math.max(1, maxX - minX) : 4;
  const crate = propPresetSpec("crate");
  const tallCrate = propPresetSpec("tall-crate");
  return [
    {
      id: "crate-a",
      label: "crate_a",
      preset: "crate",
      halfExtents: crate.halfExtents,
      spawn: [centerX - Math.min(0.75, spanX * 0.18), groundY + 1.16, centerZ + 0.28],
      color: crate.color
    },
    {
      id: "crate-b",
      label: "crate_b",
      preset: "tall-crate",
      halfExtents: tallCrate.halfExtents,
      spawn: [centerX + Math.min(0.62, spanX * 0.15), groundY + 1.58, centerZ - 0.32],
      color: tallCrate.color
    }
  ];
}

function propPresetSpec(preset: SimulatedPropPreset): { halfExtents: [number, number, number]; color: string; footprintRadius: number } {
  if (preset === "tall-crate") {
    return { halfExtents: [0.14, 0.22, 0.14], color: "#67c06f", footprintRadius: 0.26 };
  }
  return { halfExtents: [0.18, 0.18, 0.18], color: "#e0683a", footprintRadius: 0.3 };
}

function createPropFootprint(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.86, 1, 48);
  const material = new THREE.MeshBasicMaterial({ color: "#67c06f", side: THREE.DoubleSide, transparent: true, opacity: 0.86 });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

function propContactColor(status: PropContactState): string {
  if (status === "grounded") return "#67c06f";
  if (status === "sleeping") return "#8d8172";
  return "#c9a93f";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function inferGroundY(bounds: Bounds3): number {
  const minY = bounds.min[1];
  if (!Number.isFinite(minY)) return 0;
  return Math.abs(minY) < 0.05 ? 0 : minY;
}

function placementColor(status: SpawnPlacementResult["status"]): string {
  if (status === "valid") return "#67c06f";
  if (status === "blocked") return "#d9764a";
  if (status === "pending") return "#c9a93f";
  return "#8d8172";
}

function moveStatusColor(status: AgentMoveResult["status"]): string {
  if (status === "clear") return "#67c06f";
  if (status === "blocked" || status === "outside_bounds") return "#d9764a";
  if (status === "pending") return "#c9a93f";
  return "#8d8172";
}

function buildObstacleTrimesh(mesh: ParsedObjMesh, groundY: number): { vertices: Float32Array; indices: Uint32Array } {
  const vertices = new Float32Array(mesh.vertices.length * 3);
  for (let index = 0; index < mesh.vertices.length; index++) {
    const vertex = mesh.vertices[index];
    if (!vertex) continue;
    vertices.set(vertex, index * 3);
  }

  const indices: number[] = [];
  for (const triangle of mesh.triangles) {
    const a = mesh.vertices[triangle.a];
    const b = mesh.vertices[triangle.b];
    const c = mesh.vertices[triangle.c];
    if (!a || !b || !c) continue;
    if (isDegenerateTriangle(a, b, c)) continue;
    if (isWalkableTriangle(a, b, c, triangle.group, triangle.material, groundY)) continue;
    indices.push(triangle.a, triangle.b, triangle.c);
  }

  return { vertices, indices: new Uint32Array(indices) };
}

function isDegenerateTriangle(a: [number, number, number], b: [number, number, number], c: [number, number, number]): boolean {
  const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  return new THREE.Vector3().crossVectors(ab, ac).lengthSq() < 0.000000001;
}

function isWalkableTriangle(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  group: string,
  material: string | undefined,
  groundY: number
): boolean {
  const label = `${group} ${material ?? ""}`.toLowerCase();
  if (/\b(floor|ground|terrain|walkable|rug)\b/.test(label)) return true;

  const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const normal = new THREE.Vector3().crossVectors(ab, ac).normalize();
  const maxY = Math.max(a[1], b[1], c[1]);
  return Math.abs(normal.y) > 0.88 && maxY <= groundY + 0.08;
}
