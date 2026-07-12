import RAPIER, { type Collider, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import type { ParsedObjMesh } from "@world-studio/artifacts";
import type { AgentState, FirstPersonCamera, PhysicsDiagnostics } from "@world-studio/world-core";

const stepRateHz = 60;
const stepDt = 1 / stepRateHz;
export type AgentBodyPresetId = "scout" | "locobot" | "cargo";

export interface AgentBodyPreset {
  id: AgentBodyPresetId;
  label: string;
  radius: number;
  halfHeight: number;
  speed: number;
  turnStep: number;
}

export const agentBodyPresets: AgentBodyPreset[] = [
  { id: "scout", label: "Scout", radius: 0.14, halfHeight: 0.28, speed: 8.4, turnStep: 0.18 },
  { id: "locobot", label: "LoCoBot", radius: 0.18, halfHeight: 0.34, speed: 7.2, turnStep: 0.16 },
  { id: "cargo", label: "Cargo", radius: 0.28, halfHeight: 0.44, speed: 4.8, turnStep: 0.12 }
];

let rapierInit: Promise<void> | null = null;

export interface SimulationInput {
  mesh?: ParsedObjMesh;
  agent: AgentState;
  body: AgentBodyPreset;
}

export interface DriveCommand {
  move: -1 | 0 | 1;
  turn: -1 | 0 | 1;
}

export interface SimulationStep {
  agent: AgentState;
  diagnostics: PhysicsDiagnostics;
}

export interface WalkSimulationInput {
  mesh: ParsedObjMesh;
  camera: FirstPersonCamera;
  worldUnitsPerMeter: number;
}

export interface WalkSimulationStep {
  position: [number, number, number];
  grounded: boolean;
  collisionCount: number;
}

export class RapierWalkSimulation {
  private readonly world: World;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: ReturnType<World["createCharacterController"]>;
  private readonly eyeOffset: number;
  private readonly speed: number;

  private constructor(
    world: World,
    body: RigidBody,
    collider: Collider,
    controller: ReturnType<World["createCharacterController"]>,
    eyeOffset: number,
    speed: number
  ) {
    this.world = world;
    this.body = body;
    this.collider = collider;
    this.controller = controller;
    this.eyeOffset = eyeOffset;
    this.speed = speed;
  }

  static async create(input: WalkSimulationInput): Promise<RapierWalkSimulation> {
    await initRapier();
    if (!Number.isFinite(input.worldUnitsPerMeter) || input.worldUnitsPerMeter <= 0) throw new Error("Walk requires finite metric scale");
    const { vertices, indices, bounds } = walkTrimeshBuffers(input.mesh);
    const units = input.worldUnitsPerMeter;
    const radius = 0.22 * units;
    const halfHeight = 0.5 * units;
    const eyeHeight = 1.6 * units;
    const world = new RAPIER.World({ x: 0, y: -9.81 * units, z: 0 });
    world.timestep = stepDt;
    world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1));
    world.step();

    const rayOriginY = bounds.maxY + eyeHeight * 2;
    const hit = world.castRay(
      new RAPIER.Ray({ x: input.camera.position[0], y: rayOriginY, z: input.camera.position[2] }, { x: 0, y: -1, z: 0 }),
      Math.max(eyeHeight * 8, rayOriginY - bounds.minY + eyeHeight),
      true
    );
    if (!hit) {
      world.free();
      throw new Error("Walk spawn has no registered floor support");
    }
    const groundY = rayOriginY - hit.timeOfImpact;
    const centerOffset = radius + halfHeight;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(input.camera.position[0], groundY + centerOffset, input.camera.position[2])
    );
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0.9), body);
    const controller = world.createCharacterController(0.02 * units);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    controller.enableAutostep(0.18 * units, 0.12 * units, false);
    controller.enableSnapToGround(0.12 * units);
    world.step();
    return new RapierWalkSimulation(world, body, collider, controller, eyeHeight - centerOffset, 1.2 * units);
  }

  step(direction: [number, number], dt: number): WalkSimulationStep {
    const length = Math.hypot(direction[0], direction[1]);
    const scale = length > 1 ? 1 / length : 1;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    this.controller.computeColliderMovement(this.collider, {
      x: direction[0] * scale * this.speed * safeDt,
      y: -0.5 * this.speed * safeDt,
      z: direction[1] * scale * this.speed * safeDt
    });
    const movement = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({ x: current.x + movement.x, y: current.y + movement.y, z: current.z + movement.z });
    this.world.step();
    return this.snapshot();
  }

  snapshot(): WalkSimulationStep {
    const position = this.body.translation();
    return {
      position: [position.x, position.y + this.eyeOffset, position.z],
      grounded: this.controller.computedGrounded(),
      collisionCount: this.controller.numComputedCollisions()
    };
  }

  diagnostics(): PhysicsDiagnostics {
    const snapshot = this.snapshot();
    return {
      backend: "rapier3d-compat",
      stepRateHz,
      bodyCount: this.world.bodies.len(),
      colliderCount: this.world.colliders.len(),
      contactCount: snapshot.collisionCount,
      grounded: snapshot.grounded
    };
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.free();
  }
}

export class RapierSimulation {
  private heading: number;
  private readonly world: World;
  private readonly agentBody: RigidBody;
  private readonly agentCollider: Collider;
  private readonly body: AgentBodyPreset;

  private constructor(world: World, agentBody: RigidBody, agentCollider: Collider, agent: AgentState, body: AgentBodyPreset) {
    this.world = world;
    this.agentBody = agentBody;
    this.agentCollider = agentCollider;
    this.heading = agent.heading;
    this.body = body;
  }

  static async create(input: SimulationInput): Promise<RapierSimulation> {
    await initRapier();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = stepDt;

    createStaticColliders(world, input.mesh);
    const agentBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(input.agent.x, bodyGroundOffset(input.body), input.agent.z)
        .lockRotations()
        .setLinearDamping(8)
        .setAngularDamping(8)
        .setCcdEnabled(true)
        .setCanSleep(false)
    );
    const agentCollider = world.createCollider(RAPIER.ColliderDesc.capsule(input.body.halfHeight, input.body.radius).setFriction(0.9), agentBody);
    const simulation = new RapierSimulation(world, agentBody, agentCollider, input.agent, input.body);
    simulation.step({ move: 0, turn: 0 });
    return simulation;
  }

  reset(agent: AgentState): SimulationStep {
    this.heading = agent.heading;
    this.agentBody.setTranslation({ x: agent.x, y: bodyGroundOffset(this.body), z: agent.z }, true);
    this.agentBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.agentBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.world.step();
    return this.snapshot();
  }

  step(command: DriveCommand): SimulationStep {
    this.heading += command.turn * this.body.turnStep;
    const velocity = {
      x: Math.cos(this.heading) * this.body.speed * command.move,
      y: this.agentBody.linvel().y,
      z: Math.sin(this.heading) * this.body.speed * command.move
    };

    this.agentBody.setLinvel(velocity, true);
    this.world.step();
    this.agentBody.setLinvel({ x: 0, y: this.agentBody.linvel().y, z: 0 }, true);
    return this.snapshot();
  }

  diagnostics(): PhysicsDiagnostics {
    return {
      backend: "rapier3d-compat",
      stepRateHz,
      bodyCount: this.world.bodies.len(),
      colliderCount: this.world.colliders.len(),
      contactCount: this.contactCount(),
      grounded: this.grounded()
    };
  }

  dispose() {
    this.world.free();
  }

  private snapshot(): SimulationStep {
    const position = this.agentBody.translation();
    return {
      agent: { x: position.x, z: position.z, heading: this.heading },
      diagnostics: this.diagnostics()
    };
  }

  private contactCount(): number {
    let count = 0;
    this.world.contactPairsWith(this.agentCollider, () => {
      count++;
    });
    return count;
  }

  private grounded(): boolean {
    if (this.agentBody.translation().y <= bodyGroundOffset(this.body) + 0.04) return true;
    return this.contactCount() > 0;
  }
}

export const unavailablePhysicsDiagnostics = (): PhysicsDiagnostics => ({
  backend: "unavailable",
  stepRateHz,
  bodyCount: 0,
  colliderCount: 0,
  contactCount: 0,
  grounded: false
});

function initRapier(): Promise<void> {
  rapierInit ??= RAPIER.init();
  return rapierInit;
}

function bodyGroundOffset(body: AgentBodyPreset): number {
  return body.halfHeight + body.radius;
}

function createStaticColliders(world: World, mesh?: ParsedObjMesh): number {
  const boxes = mesh ? meshBoundsByGroup(mesh) : [];
  if (!boxes.length) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(8, 0.05, 8).setTranslation(0, -0.05, 0).setFriction(1));
    return 1;
  }

  for (const box of boxes) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(box.hx, 0.05), Math.max(box.hy, 0.05), Math.max(box.hz, 0.05))
        .setTranslation(box.cx, box.cy, box.cz)
        .setFriction(1)
    );
  }

  return boxes.length;
}

function walkTrimeshBuffers(mesh: ParsedObjMesh): { vertices: Float32Array; indices: Uint32Array; bounds: { minY: number; maxY: number } } {
  if (!mesh.triangles.length || mesh.triangles.length > 60_000) throw new Error("Walk collision mesh is empty or over budget");
  const vertices = new Float32Array(mesh.vertices.length * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  mesh.vertices.forEach((vertex, index) => {
    if (!vertex.every(Number.isFinite)) throw new Error(`Walk collision vertex ${index} is non-finite`);
    vertices.set(vertex, index * 3);
    minY = Math.min(minY, vertex[1]);
    maxY = Math.max(maxY, vertex[1]);
  });
  const indices = new Uint32Array(mesh.triangles.length * 3);
  mesh.triangles.forEach((triangle, index) => {
    for (const vertex of [triangle.a, triangle.b, triangle.c]) {
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= mesh.vertices.length) throw new Error(`Walk collision triangle ${index} has an invalid index`);
    }
    indices.set([triangle.a, triangle.b, triangle.c], index * 3);
  });
  return { vertices, indices, bounds: { minY, maxY } };
}

function meshBoundsByGroup(mesh: ParsedObjMesh) {
  const groups = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();

  for (const triangle of mesh.triangles) {
    const key = triangle.group || "default";
    const bounds =
      groups.get(key) ??
      {
        min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] as [number, number, number],
        max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] as [number, number, number]
      };

    for (const vertexIndex of [triangle.a, triangle.b, triangle.c]) {
      const vertex = mesh.vertices[vertexIndex];
      if (!vertex) continue;
      bounds.min = [Math.min(bounds.min[0], vertex[0]), Math.min(bounds.min[1], vertex[1]), Math.min(bounds.min[2], vertex[2])];
      bounds.max = [Math.max(bounds.max[0], vertex[0]), Math.max(bounds.max[1], vertex[1]), Math.max(bounds.max[2], vertex[2])];
    }

    groups.set(key, bounds);
  }

  return [...groups.values()]
    .filter((bounds) => bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite))
    .map((bounds) => {
      const hx = (bounds.max[0] - bounds.min[0]) / 2;
      const hy = (bounds.max[1] - bounds.min[1]) / 2;
      const hz = (bounds.max[2] - bounds.min[2]) / 2;
      return {
        cx: bounds.min[0] + hx,
        cy: bounds.min[1] + hy,
        cz: bounds.min[2] + hz,
        hx,
        hy,
        hz
      };
    });
}
