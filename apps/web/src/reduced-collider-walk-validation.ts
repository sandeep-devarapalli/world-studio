import RAPIER, { type Collider, type KinematicCharacterController, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import {
  encodeReducedColliderPly,
  reducedColliderUnknownClassification,
  type ParsedReducedCollider,
} from "@world-studio/artifacts/reduced-collider";

const stepRateHz = 60;
const stepDt = 1 / stepRateHz;
const radiusMeters = 0.22;
const halfHeightMeters = 0.5;
const controllerOffsetMeters = 0.02;
const speedMetersPerSecond = 1.2;
const eyeHeightMeters = 1.6;
const maximumProbeFaces = 256;
const maximumIssues = 64;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
let rapierInit: Promise<void> | undefined;

export interface ReducedColliderWalkInput {
  mesh: ParsedReducedCollider;
  evidence: Record<"benchmark" | "reducerReport" | "probeReport" | "candidate", {
    path: string;
    size_bytes: number;
    checksum: string;
  }>;
  producerRails: {
    floor: "accepted" | "held";
    wall: "accepted" | "held";
    closedDoor: "accepted" | "held";
    reset: "accepted" | "held";
    doorway: "missing";
    noFallbackFloor: true;
  };
}

interface ProbeResult {
  status: "accepted" | "held";
  reason: string;
  source_face_index?: number;
  initial_distance_meters?: number;
  final_distance_meters?: number;
}

interface RepetitionTelemetry {
  floor_spawn: ProbeResult;
  floor_stationary: ProbeResult;
  wall_stop: ProbeResult;
  closed_door: ProbeResult;
  controller_pose_reset: ProbeResult;
  trace: WalkTraceStep[];
}

export interface WalkTraceStep {
  phase: "floor_stationary" | "controller_pose_reset_displaced" | "controller_pose_reset_restored" | "wall_positioned" | "wall_move" | "closed_door_positioned" | "closed_door_move";
  step: number;
  position: [number, number, number];
  grounded: boolean | null;
  collision_classifications: number[];
}

export interface ReducedColliderWalkValidationReceipt {
  schema: "world_studio.reduced_collider_walk_validation.v0.1";
  input: ReducedColliderWalkInput["evidence"];
  parser: {
    status: "verified";
    algorithm: "sha256_stream_1mib_stable_stat_v1";
    vertex_count: number;
    face_count: number;
    unknown_face_count: number;
    semantic_counts: Readonly<Record<string, number>>;
    metadata: "source_face_index_semantic_classification_semantic_support_preserved";
  };
  rapier: {
    backend: "@dimforge/rapier3d-compat@0.19.3";
    step_rate_hz: 60;
    repetitions: 3;
    deterministic: boolean;
    telemetry_digests: string[];
    capsule: {
      radius_meters: 0.22;
      half_height_meters: 0.5;
      controller_offset_meters: 0.02;
      speed_meters_per_second: 1.2;
      eye_height_meters: 1.6;
    };
  };
  rails: {
    checksum_binding: "accepted";
    metadata_preservation: "accepted";
    unknown_fail_closed: "accepted";
    no_fallback_floor: "accepted";
    floor_qualified_spawn: ProbeResult;
    floor_continuity: ProbeResult;
    wall_stop: ProbeResult;
    closed_door: ProbeResult;
    controller_pose_reset: ProbeResult;
    reset: ProbeResult;
    doorway: { status: "held"; reason: "doorway_probe_missing" };
  };
  issues: Array<{ code: string; message: string }>;
  decision: "promote" | "hold" | "reject";
  authority: {
    collision_authority: false;
    measurement_authority: false;
    metric_authority: false;
    navigation_authority: false;
    newton_authority: false;
    physics_authority: false;
    quality_claim: false;
    semantic_authority: false;
  };
}

export async function validateReducedColliderWalk(input: ReducedColliderWalkInput): Promise<ReducedColliderWalkValidationReceipt> {
  const snapshot = snapshotInput(input);
  validateInput(snapshot);
  const reconstructed = encodeReducedColliderPly(snapshot.mesh);
  const parsedChecksum = await sha256Bytes(reconstructed);
  if (snapshot.evidence.candidate.size_bytes !== reconstructed.byteLength || snapshot.evidence.candidate.checksum !== parsedChecksum) {
    throw new Error("Reduced collider parsed mesh changed after checksum verification");
  }
  await (rapierInit ??= RAPIER.init());
  const repetitions: RepetitionTelemetry[] = [];
  for (let index = 0; index < 3; index += 1) repetitions.push(runRepetition(snapshot.mesh));
  const serialized = repetitions.map(canonicalJson);
  const telemetryDigests = await Promise.all(repetitions.map((repetition) => hashReducedColliderWalkTrace(repetition.trace)));
  const deterministic = serialized.every((value) => value === serialized[0]);
  const observed = repetitions[0]!;
  const issues: Array<{ code: string; message: string }> = [];
  const addIssue = (code: string, message: string) => {
    if (issues.length < maximumIssues) issues.push({ code, message });
  };

  const floorSpawn = combineProducerRail(observed.floor_spawn, snapshot.producerRails.floor, "producer_floor_parity_held");
  const wallStop = combineProducerRail(observed.wall_stop, snapshot.producerRails.wall, "producer_wall_parity_held");
  const closedDoor = combineProducerRail(observed.closed_door, snapshot.producerRails.closedDoor, "producer_closed_door_parity_held");
  const controllerPoseReset = deterministic ? observed.controller_pose_reset : { status: "held" as const, reason: "telemetry_not_deterministic" };
  const reset: ProbeResult = { status: "held", reason: "episode_state_contract_missing" };
  const floorContinuity: ProbeResult = {
    status: "held",
    reason: observed.floor_stationary.status === "accepted" ? "route_evidence_missing" : observed.floor_stationary.reason,
    source_face_index: observed.floor_stationary.source_face_index,
  };
  if (!deterministic) addIssue("telemetry_not_deterministic", "Three identical-condition Rapier repetitions did not produce identical telemetry.");
  if (snapshot.producerRails.floor === "held") addIssue("producer_floor_probe_failed", "Capture Splat did not accept every checksum-bound floor parity sample.");
  if (snapshot.producerRails.wall === "held") addIssue("producer_wall_probe_failed", "Capture Splat did not accept every checksum-bound wall parity sample.");
  if (snapshot.producerRails.closedDoor === "held") addIssue("producer_closed_door_probe_failed", "Capture Splat did not accept every checksum-bound closed-door parity sample.");
  if (floorSpawn.status !== "accepted") addIssue(floorSpawn.reason, "A floor-qualified spawn was not accepted by both producer evidence and Rapier.");
  if (floorContinuity.status !== "accepted") addIssue(floorContinuity.reason, "Continuous floor support cannot be claimed without a checksum-bound route.");
  if (wallStop.status !== "accepted") addIssue(wallStop.reason, "Wall-stop parity or the reduced Rapier stop remains held.");
  if (closedDoor.status !== "accepted") addIssue(closedDoor.reason, "Closed-door parity or the reduced Rapier stop remains held.");
  if (controllerPoseReset.status !== "accepted") addIssue(controllerPoseReset.reason, "The Rapier controller did not reproduce its initial pose deterministically.");
  addIssue(reset.reason, "A controller-pose check does not prove full episode and world-state reset.");
  addIssue("source_probe_geometry_missing", "The bundle omits source mesh bytes and replayable probe vectors, so World Studio cannot independently replay source-versus-reduced parity.");
  addIssue("doorway_probe_missing", "No checksum-bound portal and route evidence is present; doorway traversal remains unavailable.");
  addIssue("physical_validation_pending", "No bound physical collision validation is present.");

  return {
    schema: "world_studio.reduced_collider_walk_validation.v0.1",
    input: snapshot.evidence,
    parser: {
      status: "verified",
      algorithm: "sha256_stream_1mib_stable_stat_v1",
      vertex_count: snapshot.mesh.vertices.length / 3,
      face_count: snapshot.mesh.indices.length / 3,
      unknown_face_count: snapshot.mesh.unknownFaceCount,
      semantic_counts: snapshot.mesh.semanticCounts,
      metadata: "source_face_index_semantic_classification_semantic_support_preserved",
    },
    rapier: {
      backend: "@dimforge/rapier3d-compat@0.19.3",
      step_rate_hz: stepRateHz,
      repetitions: 3,
      deterministic,
      telemetry_digests: telemetryDigests,
      capsule: {
        radius_meters: radiusMeters,
        half_height_meters: halfHeightMeters,
        controller_offset_meters: controllerOffsetMeters,
        speed_meters_per_second: speedMetersPerSecond,
        eye_height_meters: eyeHeightMeters,
      },
    },
    rails: {
      checksum_binding: "accepted",
      metadata_preservation: "accepted",
      unknown_fail_closed: "accepted",
      no_fallback_floor: "accepted",
      floor_qualified_spawn: floorSpawn,
      floor_continuity: floorContinuity,
      wall_stop: wallStop,
      closed_door: closedDoor,
      controller_pose_reset: controllerPoseReset,
      reset,
      doorway: { status: "held", reason: "doorway_probe_missing" },
    },
    issues,
    decision: issues.length ? "hold" : "promote",
    authority: {
      collision_authority: false,
      measurement_authority: false,
      metric_authority: false,
      navigation_authority: false,
      newton_authority: false,
      physics_authority: false,
      quality_claim: false,
      semantic_authority: false,
    },
  };
}

function snapshotInput(input: ReducedColliderWalkInput): ReducedColliderWalkInput {
  return {
    mesh: {
      vertices: Float64Array.from(input.mesh.vertices),
      indices: Uint32Array.from(input.mesh.indices),
      semanticClassifications: Uint8Array.from(input.mesh.semanticClassifications),
      semanticSupport: Uint8Array.from(input.mesh.semanticSupport),
      sourceFaceIndices: Uint32Array.from(input.mesh.sourceFaceIndices),
      semanticCounts: { ...input.mesh.semanticCounts },
      unknownFaceCount: input.mesh.unknownFaceCount,
    },
    evidence: {
      benchmark: { ...input.evidence.benchmark },
      reducerReport: { ...input.evidence.reducerReport },
      probeReport: { ...input.evidence.probeReport },
      candidate: { ...input.evidence.candidate },
    },
    producerRails: { ...input.producerRails },
  };
}

function runRepetition(mesh: ParsedReducedCollider): RepetitionTelemetry {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = stepDt;
  const colliderGroups = createSemanticColliders(world, mesh);
  world.step();
  const floor = findFloorSpawn(world, colliderGroups, mesh);
  if (!floor) {
    world.free();
    const unavailable = { status: "held", reason: "known_supported_floor_spawn_missing" } as const;
    return { floor_spawn: unavailable, floor_stationary: unavailable, wall_stop: unavailable, closed_door: unavailable, controller_pose_reset: unavailable, trace: [] };
  }
  const walker = createWalker(world, colliderGroups, floor.position);
  const trace: WalkTraceStep[] = [];
  const floorStationary = stationaryFloorProbe(walker, floor, trace);
  const controllerPoseReset = resetProbe(walker, trace);
  const wall = targetStopProbe(walker, mesh, 1, "known_supported_wall_probe_missing", "wall", trace);
  const door = targetStopProbe(walker, mesh, 7, "known_supported_closed_door_probe_missing", "closed_door", trace);
  world.removeCharacterController(walker.controller);
  world.free();
  return {
    floor_spawn: { status: "accepted", reason: "known_supported_floor_hit", source_face_index: floor.sourceFaceIndex },
    floor_stationary: floorStationary,
    wall_stop: wall,
    closed_door: door,
    controller_pose_reset: controllerPoseReset,
    trace,
  };
}

interface Walker {
  world: World;
  body: RigidBody;
  collider: Collider;
  controller: KinematicCharacterController;
  colliderGroups: ColliderGroups;
}

interface ColliderGroup {
  classification: number;
  originalFaces: number[];
}

type ColliderGroups = Map<number, ColliderGroup>;

function createSemanticColliders(world: World, mesh: ParsedReducedCollider): ColliderGroups {
  const grouped = new Map<number, number[]>();
  for (let face = 0; face < mesh.semanticClassifications.length; face += 1) {
    const classification = mesh.semanticClassifications[face]!;
    const group = classification >= 1 && classification <= 7 && mesh.semanticSupport[face] === 4
      ? classification
      : reducedColliderUnknownClassification;
    const faces = grouped.get(group) ?? [];
    faces.push(face);
    grouped.set(group, faces);
  }
  const vertices = Float32Array.from(mesh.vertices);
  const result: ColliderGroups = new Map();
  for (const [classification, originalFaces] of [...grouped].sort(([left], [right]) => left - right)) {
    const indices = new Uint32Array(originalFaces.length * 3);
    for (let localFace = 0; localFace < originalFaces.length; localFace += 1) {
      const source = originalFaces[localFace]! * 3;
      indices.set(mesh.indices.subarray(source, source + 3), localFace * 3);
    }
    const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1));
    result.set(collider.handle, { classification, originalFaces });
  }
  return result;
}

function createWalker(world: World, colliderGroups: ColliderGroups, ground: [number, number, number]): Walker {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ground[0], ground[1] + radiusMeters + halfHeightMeters, ground[2]));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeightMeters, radiusMeters).setFriction(0.9), body);
  const controller = world.createCharacterController(controllerOffsetMeters);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setSlideEnabled(true);
  controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
  controller.enableAutostep(0.18, 0.12, false);
  controller.enableSnapToGround(0.12);
  world.step();
  return { world, body, collider, controller, colliderGroups };
}

function stationaryFloorProbe(walker: Walker, floor: FloorSpawn, trace: WalkTraceStep[]): ProbeResult {
  const initial = walker.body.translation();
  let grounded = false;
  let unsupportedCollision = false;
  for (let index = 0; index < 60; index += 1) {
    const collisions = stepWalker(walker, [0, 0], trace, "floor_stationary", index);
    grounded ||= walker.controller.computedGrounded();
    unsupportedCollision ||= [...collisions].some((classification) => classification !== 2);
  }
  const final = walker.body.translation();
  const stable = grounded && !unsupportedCollision && Math.abs(final.y - initial.y) <= 0.03;
  return { status: stable ? "accepted" : "held", reason: stable ? "stationary_floor_support_observed" : unsupportedCollision ? "unsupported_floor_corridor_collision" : "floor_fallthrough_observed", source_face_index: floor.sourceFaceIndex };
}

function resetProbe(walker: Walker, trace: WalkTraceStep[]): ProbeResult {
  const initial = walker.body.translation();
  const center: [number, number, number] = [initial.x, initial.y, initial.z];
  walker.body.setNextKinematicTranslation({ x: center[0] + 0.125, y: center[1] + 0.25, z: center[2] - 0.125 });
  walker.world.step();
  recordTraceStep(trace, "controller_pose_reset_displaced", 0, walker, null, []);
  walker.body.setNextKinematicTranslation({ x: center[0], y: center[1], z: center[2] });
  walker.world.step();
  recordTraceStep(trace, "controller_pose_reset_restored", 0, walker, null, []);
  const reset = walker.body.translation();
  const exact = reset.x === center[0] && reset.y === center[1] && reset.z === center[2];
  return { status: exact ? "accepted" : "held", reason: exact ? "exact_controller_pose_reset_reproduced" : "controller_pose_reset_mismatch" };
}

function targetStopProbe(
  walker: Walker,
  mesh: ParsedReducedCollider,
  classification: number,
  missingReason: string,
  phase: "wall" | "closed_door",
  trace: WalkTraceStep[],
): ProbeResult {
  const candidates = candidateFaces(mesh, classification);
  for (const faceIndex of candidates) {
    const geometry = faceGeometry(mesh, faceIndex);
    if (Math.abs(geometry.normal[1]) > 0.3) continue;
    const horizontalLength = Math.hypot(geometry.normal[0], geometry.normal[2]);
    if (horizontalLength <= 1e-9) continue;
    for (const side of [-1, 1] as const) {
      const direction: [number, number] = [geometry.normal[0] / horizontalLength * side, geometry.normal[2] / horizontalLength * side];
      const startX = geometry.center[0] - direction[0] * 0.65;
      const startZ = geometry.center[2] - direction[1] * 0.65;
      const floorHit = supportedHit(walker.world, walker.colliderGroups, mesh, [startX, geometry.center[1] + 1.5, startZ], [0, -1, 0], 4, 2);
      if (!floorHit) continue;
      const centerY = floorHit.point[1] + radiusMeters + halfHeightMeters;
      if (geometry.center[1] < floorHit.point[1] + 0.15 || geometry.center[1] > floorHit.point[1] + 1.35) continue;
      const targetHit = supportedHit(walker.world, walker.colliderGroups, mesh, [startX, centerY, startZ], [direction[0], 0, direction[1]], 1, classification);
      if (!targetHit || Math.abs(targetHit.timeOfImpact - 0.65) > 0.08) continue;
      walker.body.setNextKinematicTranslation({ x: startX, y: centerY, z: startZ });
      walker.world.step();
      recordTraceStep(trace, `${phase}_positioned`, 0, walker, null, []);
      let collisionObserved = false;
      let unsupportedCollision = false;
      for (let step = 0; step < 90; step += 1) {
        const collisions = stepWalker(walker, direction, trace, `${phase}_move`, step);
        collisionObserved ||= collisions.has(classification);
        unsupportedCollision ||= [...collisions].some((value) => value !== 2 && value !== classification);
      }
      const final = walker.body.translation();
      const remaining = (geometry.center[0] - final.x) * direction[0] + (geometry.center[2] - final.z) * direction[1];
      const accepted = collisionObserved && !unsupportedCollision && Math.abs(remaining - (radiusMeters + controllerOffsetMeters)) <= 0.03;
      return {
        status: accepted ? "accepted" : "held",
        reason: accepted ? "reduced_capsule_stop_within_0_03m" : unsupportedCollision ? "unsupported_probe_corridor_collision" : "reduced_capsule_stop_outside_0_03m",
        source_face_index: mesh.sourceFaceIndices[targetHit.faceIndex],
        initial_distance_meters: 0.65,
        final_distance_meters: rounded(remaining),
      };
    }
  }
  return { status: "held", reason: missingReason };
}

function stepWalker(
  walker: Walker,
  direction: [number, number],
  trace: WalkTraceStep[],
  phase: "floor_stationary" | "wall_move" | "closed_door_move",
  step: number,
): Set<number> {
  walker.controller.computeColliderMovement(walker.collider, {
    x: direction[0] * speedMetersPerSecond * stepDt,
    y: -0.5 * speedMetersPerSecond * stepDt,
    z: direction[1] * speedMetersPerSecond * stepDt,
  });
  const movement = walker.controller.computedMovement();
  const collisions = new Set<number>();
  for (let index = 0; index < walker.controller.numComputedCollisions(); index += 1) {
    const collider = walker.controller.computedCollision(index)?.collider;
    const classification = collider ? walker.colliderGroups.get(collider.handle)?.classification : undefined;
    if (classification !== undefined) collisions.add(classification);
  }
  const current = walker.body.translation();
  walker.body.setNextKinematicTranslation({ x: current.x + movement.x, y: current.y + movement.y, z: current.z + movement.z });
  walker.world.step();
  recordTraceStep(trace, phase, step, walker, walker.controller.computedGrounded(), [...collisions].sort((left, right) => left - right));
  return collisions;
}

function recordTraceStep(
  trace: WalkTraceStep[],
  phase: WalkTraceStep["phase"],
  step: number,
  walker: Walker,
  grounded: boolean | null,
  collisionClassifications: number[],
): void {
  const position = walker.body.translation();
  trace.push({
    phase,
    step,
    position: [position.x, position.y, position.z],
    grounded,
    collision_classifications: collisionClassifications,
  });
}

interface FloorSpawn {
  position: [number, number, number];
  sourceFaceIndex: number;
}

function findFloorSpawn(world: World, colliderGroups: ColliderGroups, mesh: ParsedReducedCollider): FloorSpawn | undefined {
  for (const faceIndex of candidateFaces(mesh, 2)) {
    const geometry = faceGeometry(mesh, faceIndex);
    if (Math.abs(geometry.normal[1]) < 0.8) continue;
    const hit = supportedHit(world, colliderGroups, mesh, [geometry.center[0], geometry.center[1] + 0.1, geometry.center[2]], [0, -1, 0], 0.25, 2);
    if (hit) return { position: hit.point, sourceFaceIndex: mesh.sourceFaceIndices[hit.faceIndex]! };
  }
  return undefined;
}

function supportedHit(
  world: World,
  colliderGroups: ColliderGroups,
  mesh: ParsedReducedCollider,
  origin: [number, number, number],
  direction: [number, number, number],
  maxToi: number,
  classification: number,
): { point: [number, number, number]; timeOfImpact: number; faceIndex: number } | undefined {
  const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x: origin[0], y: origin[1], z: origin[2] }, { x: direction[0], y: direction[1], z: direction[2] }), maxToi, true);
  if (!hit) return undefined;
  const face = hit.featureId;
  const group = colliderGroups.get(hit.collider.handle);
  const originalFace = face === undefined ? undefined : group?.originalFaces[face];
  if (originalFace === undefined || group?.classification !== classification || classification === reducedColliderUnknownClassification) return undefined;
  if (mesh.semanticClassifications[originalFace] !== classification || mesh.semanticSupport[originalFace] !== 4) return undefined;
  return {
    point: [origin[0] + direction[0] * hit.timeOfImpact, origin[1] + direction[1] * hit.timeOfImpact, origin[2] + direction[2] * hit.timeOfImpact],
    timeOfImpact: hit.timeOfImpact,
    faceIndex: originalFace,
  };
}

function candidateFaces(mesh: ParsedReducedCollider, classification: number): number[] {
  const faces: number[] = [];
  for (let index = 0; index < mesh.semanticClassifications.length; index += 1) {
    if (mesh.semanticClassifications[index] === classification && mesh.semanticSupport[index] === 4) faces.push(index);
  }
  return faces.sort((left, right) => {
    const areaDelta = faceGeometry(mesh, right).area - faceGeometry(mesh, left).area;
    return areaDelta || mesh.sourceFaceIndices[left]! - mesh.sourceFaceIndices[right]! || left - right;
  }).slice(0, maximumProbeFaces);
}

function faceGeometry(mesh: ParsedReducedCollider, face: number): { center: [number, number, number]; normal: [number, number, number]; area: number } {
  const base = face * 3;
  const ai = mesh.indices[base]! * 3;
  const bi = mesh.indices[base + 1]! * 3;
  const ci = mesh.indices[base + 2]! * 3;
  const ax = mesh.vertices[ai]!; const ay = mesh.vertices[ai + 1]!; const az = mesh.vertices[ai + 2]!;
  const bx = mesh.vertices[bi]!; const by = mesh.vertices[bi + 1]!; const bz = mesh.vertices[bi + 2]!;
  const cx = mesh.vertices[ci]!; const cy = mesh.vertices[ci + 1]!; const cz = mesh.vertices[ci + 2]!;
  const abx = bx - ax; const aby = by - ay; const abz = bz - az;
  const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const length = Math.hypot(nx, ny, nz);
  return {
    center: [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3],
    normal: [nx / length, ny / length, nz / length],
    area: length * 0.5,
  };
}

function combineProducerRail(observed: ProbeResult, producer: "accepted" | "held", heldReason: string): ProbeResult {
  return observed.status === "accepted" && producer === "accepted" ? observed : { ...observed, status: "held", reason: observed.status === "accepted" ? heldReason : observed.reason };
}

function validateInput(input: ReducedColliderWalkInput): void {
  if (!input.mesh.vertices.length || input.mesh.vertices.length % 3 || !input.mesh.indices.length || input.mesh.indices.length % 3) throw new Error("Reduced collider Walk input is empty or malformed");
  if (input.mesh.semanticClassifications.length !== input.mesh.indices.length / 3 || input.mesh.semanticSupport.length !== input.mesh.indices.length / 3 || input.mesh.sourceFaceIndices.length !== input.mesh.indices.length / 3) {
    throw new Error("Reduced collider Walk metadata is not face-aligned");
  }
  for (const value of input.mesh.vertices) if (!Number.isFinite(value)) throw new Error("Reduced collider Walk vertices must be finite");
  for (const evidence of Object.values(input.evidence)) {
    if (!evidence.path || !Number.isSafeInteger(evidence.size_bytes) || evidence.size_bytes <= 0 || !sha256Pattern.test(evidence.checksum)) throw new Error("Reduced collider Walk evidence is invalid");
  }
  if (!input.producerRails.noFallbackFloor || input.producerRails.doorway !== "missing") throw new Error("Reduced collider Walk producer rails grant unsupported geometry or doorway evidence");
  let unknownFaceCount = 0;
  const semanticCounts: Record<string, number> = {};
  for (const classification of input.mesh.semanticClassifications) {
    const name = ["none", "wall", "floor", "ceiling", "table", "seat", "window", "door"][classification] ?? "unknown";
    semanticCounts[name] = (semanticCounts[name] ?? 0) + 1;
    if (classification === reducedColliderUnknownClassification) unknownFaceCount += 1;
  }
  if (unknownFaceCount !== input.mesh.unknownFaceCount || canonicalJson(semanticCounts) !== canonicalJson(input.mesh.semanticCounts)) {
    throw new Error("Reduced collider Walk semantic summaries are inconsistent with face metadata");
  }
}

function rounded(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function sha256Utf8(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

export async function hashReducedColliderWalkTrace(trace: readonly WalkTraceStep[]): Promise<string> {
  return sha256Utf8(canonicalJson(trace));
}

async function sha256Bytes(value: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
