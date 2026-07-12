import type { CameraState, FirstPersonCamera, FrameCamera, WorldOrientation } from "@world-studio/world-core";

export type SimulateCameraMode = "frame" | "orbit" | "free";
export type SimulateDragKind = "rotate" | "orbit" | "pan";
export type SimulateMoveCommand = "forward" | "back" | "left" | "right" | "rise" | "descend" | "rollLeft" | "rollRight";
export type SimulateLookCommand = "lookLeft" | "lookRight" | "lookUp" | "lookDown";
export type SimulateKeyCommand = SimulateMoveCommand | SimulateLookCommand;

export const freeMoveStep = 0.16;
export const freeRiseStep = 0.12;
export const freeRollStep = 0.035;
export const freeKeyboardLookStepX = 8;
export const freeKeyboardLookStepY = 6;
export const holdRepeatStepsPerSecond = 6;
const freeLookScale = 0.006;

export interface SimulateSteps {
  move: number;
  rise: number;
  scale: number;
}

export const defaultSimulateSteps: SimulateSteps = { move: freeMoveStep, rise: freeRiseStep, scale: 1 };

export function stepsForSceneRadius(sceneRadius?: number): SimulateSteps {
  if (sceneRadius === undefined || !Number.isFinite(sceneRadius) || sceneRadius <= 0) return defaultSimulateSteps;
  const move = Math.min(1.0, Math.max(0.02, 0.04 * sceneRadius));
  return { move, rise: 0.8 * move, scale: move / freeMoveStep };
}

export function floorHeightFromWorldPoints(
  points: Array<{ x: number; y: number; z: number }>,
  center: [number, number, number],
  rotation?: [number, number, number, number]
): number | undefined {
  if (points.length < 8) return undefined;
  const stride = Math.max(1, Math.floor(points.length / 20000));
  const heights: number[] = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const y = rotation
      ? rotateVector(rotation, [point.x - center[0], point.y - center[1], point.z - center[2]])[1]
      : point.y;
    if (Number.isFinite(y)) heights.push(y);
  }
  if (heights.length < 8) return undefined;
  heights.sort((a, b) => a - b);
  const floor = heights[Math.floor(heights.length * 0.05)];
  return Number.isFinite(floor) ? floor : undefined;
}

export function radiusFromWorldPoints(points: Array<{ x: number; y: number; z: number }>, center: [number, number, number]): number | undefined {
  if (points.length < 8) return undefined;
  const stride = Math.max(1, Math.floor(points.length / 20000));
  const distances: number[] = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const distance = Math.hypot(point.x - center[0], point.y - center[1], point.z - center[2]);
    if (Number.isFinite(distance)) distances.push(distance);
  }
  if (distances.length < 8) return undefined;
  distances.sort((a, b) => a - b);
  const p95 = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))];
  return Number.isFinite(p95) && p95 > 0 ? p95 : undefined;
}

export function firstPersonCameraFromFrame(frameCamera: FrameCamera): FirstPersonCamera {
  return {
    position: [...frameCamera.translation],
    rotation: normalizeQuaternion(frameCamera.rotation),
    fov: Math.min(90, Math.max(24, (2 * Math.atan(frameCamera.height / (2 * frameCamera.fy)) * 180) / Math.PI)),
    coordinateFrame: frameCamera.coordinateFrame,
    authority: frameCamera.authority
  };
}

export function estimateWorldOrientation(frameCameras: Array<FrameCamera | undefined>, center: [number, number, number]): WorldOrientation | undefined {
  const ups: Array<[number, number, number]> = [];
  for (const frameCamera of frameCameras) {
    if (!frameCamera) continue;
    ups.push(rotateVector(frameCamera.rotation, [0, -1, 0]));
  }
  if (ups.length < 2) return undefined;
  const sourceUp = normalize3(ups.reduce<[number, number, number]>((sum, up) => add3(sum, up), [0, 0, 0]));
  if (!sourceUp) return undefined;
  const rotation = quaternionFromUnitVectors(sourceUp, [0, 1, 0]);
  return {
    rotation,
    center,
    sourceUp,
    authority: "estimated from source frame cameras"
  };
}

export function worldOrientationFromUp(sourceUp: [number, number, number] | undefined, center: [number, number, number]): WorldOrientation | undefined {
  if (!sourceUp) return undefined;
  const normalized = normalize3(sourceUp);
  if (!normalized) return undefined;
  return {
    rotation: quaternionFromUnitVectors(normalized, [0, 1, 0]),
    center,
    sourceUp: normalized,
    authority: "accepted ARKit metric registration up"
  };
}

export function refineWorldOrientationWithFloorNormal(
  points: Array<{ x: number; y: number; z: number }>,
  orientation: WorldOrientation | undefined,
  maxCorrectionDeg = 30
): WorldOrientation | undefined {
  if (!orientation || points.length < 200) return orientation;
  const stride = Math.max(1, Math.floor(points.length / 20000));
  const leveled: Array<[number, number, number]> = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const rotated = rotateVector(orientation.rotation, [
      point.x - orientation.center[0],
      point.y - orientation.center[1],
      point.z - orientation.center[2]
    ]);
    if (rotated.every(Number.isFinite)) leveled.push(rotated);
  }
  if (leveled.length < 100) return orientation;
  const heights = leveled.map((point) => point[1]).sort((a, b) => a - b);
  const low = heights[Math.floor(heights.length * 0.02)];
  const high = heights[Math.floor(heights.length * 0.12)];
  const band = leveled.filter((point) => point[1] >= low && point[1] <= high);
  if (band.length < 50) return orientation;
  const mean: [number, number, number] = [0, 0, 0];
  for (const point of band) {
    mean[0] += point[0];
    mean[1] += point[1];
    mean[2] += point[2];
  }
  mean[0] /= band.length;
  mean[1] /= band.length;
  mean[2] /= band.length;
  const covariance = [0, 0, 0, 0, 0, 0];
  for (const point of band) {
    const dx = point[0] - mean[0];
    const dy = point[1] - mean[1];
    const dz = point[2] - mean[2];
    covariance[0] += dx * dx;
    covariance[1] += dx * dy;
    covariance[2] += dx * dz;
    covariance[3] += dy * dy;
    covariance[4] += dy * dz;
    covariance[5] += dz * dz;
  }
  const normal = smallestEigenvector3([
    [covariance[0], covariance[1], covariance[2]],
    [covariance[1], covariance[3], covariance[4]],
    [covariance[2], covariance[4], covariance[5]]
  ]);
  if (!normal) return orientation;
  const up: [number, number, number] = normal[1] < 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
  const tilt = Math.acos(clamp(up[1], -1, 1));
  if (tilt > (maxCorrectionDeg * Math.PI) / 180 || tilt < 1e-4) return orientation;
  const correction = quaternionFromUnitVectors(up, [0, 1, 0]);
  return {
    ...orientation,
    rotation: normalizeQuaternion(multiplyQuaternion(correction, orientation.rotation)),
    authority: `${orientation.authority} · floor-normal refined`
  };
}

export function applyWorldOrientationToFrameCamera(frameCamera: FrameCamera, orientation: WorldOrientation | undefined): FrameCamera {
  if (!orientation) return frameCamera;
  return {
    ...frameCamera,
    translation: rotateVector(orientation.rotation, subtract3(frameCamera.translation, orientation.center)),
    rotation: normalizeQuaternion(multiplyQuaternion(orientation.rotation, frameCamera.rotation)),
    coordinateFrame: `${frameCamera.coordinateFrame ?? "source_world"}_leveled`,
    authority: frameCamera.authority
  };
}

export function applyWorldOrientationToFirstPersonCamera(camera: FirstPersonCamera, orientation: WorldOrientation | undefined): FirstPersonCamera {
  if (!orientation) return camera;
  return {
    ...camera,
    position: rotateVector(orientation.rotation, subtract3(camera.position, orientation.center)),
    rotation: normalizeQuaternion(multiplyQuaternion(orientation.rotation, camera.rotation)),
    coordinateFrame: `${camera.coordinateFrame ?? "source_world"}_leveled`
  };
}

export function moveFirstPersonCamera(camera: FirstPersonCamera, command: SimulateKeyCommand, steps: SimulateSteps = defaultSimulateSteps, fraction = 1): FirstPersonCamera {
  if (command === "lookLeft") return rotateFirstPersonCamera(camera, -freeKeyboardLookStepX * fraction, 0);
  if (command === "lookRight") return rotateFirstPersonCamera(camera, freeKeyboardLookStepX * fraction, 0);
  if (command === "lookUp") return rotateFirstPersonCamera(camera, 0, -freeKeyboardLookStepY * fraction);
  if (command === "lookDown") return rotateFirstPersonCamera(camera, 0, freeKeyboardLookStepY * fraction);
  if (command === "rollLeft") return rollFirstPersonCamera(camera, -freeRollStep * fraction);
  if (command === "rollRight") return rollFirstPersonCamera(camera, freeRollStep * fraction);

  const forward = rotateVector(camera.rotation, [0, 0, 1]);
  const right = rotateVector(camera.rotation, [1, 0, 0]);
  const moveStep = steps.move * fraction;
  const riseStep = steps.rise * fraction;
  let delta: [number, number, number] = [0, 0, 0];
  if (command === "forward") delta = scale3(forward, moveStep);
  if (command === "back") delta = scale3(forward, -moveStep);
  if (command === "left") delta = scale3(right, -moveStep);
  if (command === "right") delta = scale3(right, moveStep);
  if (command === "rise") delta = [0, riseStep, 0];
  if (command === "descend") delta = [0, -riseStep, 0];
  return { ...camera, position: add3(camera.position, delta) };
}

export function rotateFirstPersonCamera(camera: FirstPersonCamera, dx: number, dy: number): FirstPersonCamera {
  const yaw = quaternionFromAxisAngle([0, 1, 0], -dx * freeLookScale);
  const right = rotateVector(camera.rotation, [1, 0, 0]);
  const pitch = quaternionFromAxisAngle(right, -dy * freeLookScale);
  return { ...camera, rotation: normalizeQuaternion(multiplyQuaternion(yaw, multiplyQuaternion(pitch, camera.rotation))) };
}

export function interpolateFrameCameras(a: FrameCamera, b: FrameCamera, t: number): FrameCamera {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    ...a,
    translation: [
      a.translation[0] + (b.translation[0] - a.translation[0]) * clamped,
      a.translation[1] + (b.translation[1] - a.translation[1]) * clamped,
      a.translation[2] + (b.translation[2] - a.translation[2]) * clamped
    ],
    rotation: slerpQuaternion(normalizeQuaternion(a.rotation), normalizeQuaternion(b.rotation), clamped),
    fx: a.fx + (b.fx - a.fx) * clamped,
    fy: a.fy + (b.fy - a.fy) * clamped
  };
}

export function insideLookCameraFromFrames(
  frameCameras: Array<FrameCamera | undefined>,
  orientation: WorldOrientation | undefined,
  fov = 60
): FirstPersonCamera | null {
  const leveled = frameCameras
    .filter((camera): camera is FrameCamera => Boolean(camera))
    .map((camera) => applyWorldOrientationToFrameCamera(camera, orientation));
  if (!leveled.length) return null;
  const component = (index: number) => {
    const values = leveled.map((camera) => camera.translation[index]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const position: [number, number, number] = [component(0), component(1), component(2)];
  const target: [number, number, number] = [0, position[1], 0];
  const forward = normalize3([target[0] - position[0], target[1] - position[1], target[2] - position[2]]);
  const rotation = forward
    ? multiplyQuaternion(
        multiplyQuaternion(
          quaternionFromAxisAngle([0, 1, 0], Math.atan2(forward[0], forward[2])),
          quaternionFromAxisAngle([1, 0, 0], -Math.asin(Math.max(-1, Math.min(1, forward[1]))))
        ),
        quaternionFromAxisAngle([0, 0, 1], Math.PI)
      )
    : normalizeQuaternion(leveled[0].rotation);
  return {
    position,
    rotation,
    fov,
    coordinateFrame: leveled[0].coordinateFrame,
    authority: "inside preset · median frame camera position"
  };
}

export const centerSpinRadiansPerSecond = 0.4;

export function centerSpinCameraFromFrames(
  frameCameras: Array<FrameCamera | undefined>,
  orientation: WorldOrientation | undefined,
  fov = 70
): FirstPersonCamera | null {
  const inside = insideLookCameraFromFrames(frameCameras, orientation, fov);
  if (!inside) return null;
  const outward = normalize3([inside.position[0], 0, inside.position[2]]);
  const forward = outward ?? horizontalForward(inside.rotation) ?? [0, 0, 1];
  const yaw = Math.atan2(forward[0], forward[2]);
  return {
    ...inside,
    rotation: multiplyQuaternion(
      quaternionFromAxisAngle([0, 1, 0], yaw),
      quaternionFromAxisAngle([0, 0, 1], Math.PI)
    ),
    fov,
    authority: "center 360 preset · leveled yaw-only"
  };
}

export function spinFirstPersonCamera(camera: FirstPersonCamera, yawRadians: number): FirstPersonCamera {
  return {
    ...camera,
    rotation: normalizeQuaternion(multiplyQuaternion(quaternionFromAxisAngle([0, 1, 0], yawRadians), camera.rotation))
  };
}

function horizontalForward(rotation: [number, number, number, number]): [number, number, number] | undefined {
  const forward = rotateVector(rotation, [0, 0, 1]);
  return normalize3([forward[0], 0, forward[2]]);
}

function smallestEigenvector3(matrix: number[][]): [number, number, number] | undefined {
  let a = matrix.map((row) => [...row]);
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  for (let sweep = 0; sweep < 24; sweep += 1) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      off += a[p][q] * a[p][q];
      if (Math.abs(a[p][q]) < 1e-12) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      const rotate = (m: number[][]) => {
        for (let k = 0; k < 3; k += 1) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
      };
      const rotateRows = (m: number[][]) => {
        for (let k = 0; k < 3; k += 1) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
      };
      rotateRows(a);
      rotate(a);
      rotate(v);
    }
    if (off < 1e-18) break;
  }
  const eigenvalues = [a[0][0], a[1][1], a[2][2]];
  const smallest = eigenvalues.indexOf(Math.min(...eigenvalues));
  return normalize3([v[0][smallest], v[1][smallest], v[2][smallest]]);
}

function slerpQuaternion(a: [number, number, number, number], b: [number, number, number, number], t: number): [number, number, number, number] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let end: [number, number, number, number] = b;
  if (dot < 0) {
    dot = -dot;
    end = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (dot > 0.9995) {
    return normalizeQuaternion([
      a[0] + (end[0] - a[0]) * t,
      a[1] + (end[1] - a[1]) * t,
      a[2] + (end[2] - a[2]) * t,
      a[3] + (end[3] - a[3]) * t
    ]);
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return normalizeQuaternion([
    a[0] * wa + end[0] * wb,
    a[1] * wa + end[1] * wb,
    a[2] * wa + end[2] * wb,
    a[3] * wa + end[3] * wb
  ]);
}

export const maxFirstPersonPitchDeg = 70;

export function rotateFirstPersonCameraClamped(camera: FirstPersonCamera, dx: number, dy: number, maxPitchDeg = maxFirstPersonPitchDeg): FirstPersonCamera {
  const yawed = dx !== 0 ? rotateFirstPersonCamera(camera, dx, 0) : camera;
  if (dy === 0) return yawed;
  const maxPitch = (maxPitchDeg * Math.PI) / 180;
  const pitchOf = (value: FirstPersonCamera) => {
    const forward = rotateVector(value.rotation, [0, 0, 1]);
    return Math.asin(Math.max(-1, Math.min(1, forward[1])));
  };
  const current = pitchOf(yawed);
  const candidate = rotateFirstPersonCamera(yawed, 0, dy);
  const next = pitchOf(candidate);
  if (Math.abs(next) <= maxPitch) return candidate;
  const delta = next - current;
  if (Math.abs(delta) < 1e-9) return yawed;
  const allowedFraction = (Math.sign(next) * maxPitch - current) / delta;
  if (allowedFraction <= 0) return yawed;
  return rotateFirstPersonCamera(yawed, 0, dy * allowedFraction);
}

export function rollFirstPersonCamera(camera: FirstPersonCamera, delta: number): FirstPersonCamera {
  const forward = rotateVector(camera.rotation, [0, 0, 1]);
  return { ...camera, rotation: normalizeQuaternion(multiplyQuaternion(quaternionFromAxisAngle(forward, delta), camera.rotation)) };
}

export function dollyFirstPersonCamera(camera: FirstPersonCamera, deltaY: number, scale = 1): FirstPersonCamera {
  const forward = rotateVector(camera.rotation, [0, 0, 1]);
  return { ...camera, position: add3(camera.position, scale3(forward, -deltaY * 0.004 * scale)) };
}

export function panFirstPersonCamera(camera: FirstPersonCamera, dx: number, dy: number, scale = 1): FirstPersonCamera {
  const right = rotateVector(camera.rotation, [1, 0, 0]);
  const up = rotateVector(camera.rotation, [0, 1, 0]);
  return {
    ...camera,
    position: add3(add3(camera.position, scale3(right, -dx * 0.006 * scale)), scale3(up, dy * 0.006 * scale))
  };
}

export function moveFreeCamera(camera: CameraState, command: SimulateKeyCommand, steps: SimulateSteps = defaultSimulateSteps, fraction = 1): CameraState {
  if (command === "lookLeft") return rotateCamera(camera, -freeKeyboardLookStepX * fraction, 0);
  if (command === "lookRight") return rotateCamera(camera, freeKeyboardLookStepX * fraction, 0);
  if (command === "lookUp") return rotateCamera(camera, 0, -freeKeyboardLookStepY * fraction);
  if (command === "lookDown") return rotateCamera(camera, 0, freeKeyboardLookStepY * fraction);
  if (command === "rollLeft") return rollCamera(camera, -freeRollStep * fraction);
  if (command === "rollRight") return rollCamera(camera, freeRollStep * fraction);

  const forward: [number, number, number] = [Math.sin(camera.yaw), 0, Math.cos(camera.yaw)];
  const right: [number, number, number] = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)];
  const moveStep = steps.move * fraction;
  const riseStep = steps.rise * fraction;
  let delta: [number, number, number] = [0, 0, 0];
  if (command === "forward") delta = scale3(forward, -moveStep);
  if (command === "back") delta = scale3(forward, moveStep);
  if (command === "left") delta = scale3(right, -moveStep);
  if (command === "right") delta = scale3(right, moveStep);
  if (command === "rise") delta = [0, riseStep, 0];
  if (command === "descend") delta = [0, -riseStep, 0];
  return { ...camera, target: add3(camera.target, delta) };
}

export function rotateCamera(camera: CameraState, dx: number, dy: number): CameraState {
  return {
    ...camera,
    yaw: camera.yaw + dx * 0.006,
    pitch: clamp(camera.pitch + dy * 0.004, 0.05, 1.2)
  };
}

export function panCamera(camera: CameraState, dx: number, dy: number): CameraState {
  const scale = Math.max(0.004, camera.distance * 0.0018);
  const right: [number, number, number] = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)];
  const lateral = scale3(right, -dx * scale);
  const vertical: [number, number, number] = [0, dy * scale, 0];
  return { ...camera, target: add3(add3(camera.target, lateral), vertical) };
}

export function dollyCamera(camera: CameraState, deltaY: number): CameraState {
  return { ...camera, distance: clamp(camera.distance + deltaY * 0.004, 1.2, 28) };
}

export function rollCamera(camera: CameraState, delta: number): CameraState {
  return { ...camera, roll: clamp((camera.roll ?? 0) + delta, -Math.PI, Math.PI) };
}

export function classifySimulateDrag(input: { altKey: boolean; shiftKey: boolean; button: number; buttons: number }): SimulateDragKind {
  if (input.altKey) return "orbit";
  if (input.shiftKey || input.button === 2 || (input.buttons & 2) === 2) return "pan";
  return "rotate";
}

export function commandForKey(key: string, shiftKey = false): SimulateKeyCommand | undefined {
  const normalized = key.toLowerCase();
  if (normalized === "w") return "forward";
  if (normalized === "s") return "back";
  if (normalized === "a") return "left";
  if (normalized === "d") return "right";
  if (key === "ArrowUp") return shiftKey ? "forward" : "lookUp";
  if (key === "ArrowDown") return shiftKey ? "back" : "lookDown";
  if (key === "ArrowLeft") return shiftKey ? "left" : "lookLeft";
  if (key === "ArrowRight") return shiftKey ? "right" : "lookRight";
  if (normalized === "q") return "rise";
  if (normalized === "e") return "descend";
  if (normalized === "r") return "rollLeft";
  if (normalized === "f") return "rollRight";
  return undefined;
}

function add3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(v: [number, number, number], scale: number): [number, number, number] {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function normalize3(v: [number, number, number]): [number, number, number] | undefined {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length <= 1e-12) return undefined;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function rotateVector(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [w, x, y, z] = normalizeQuaternion(q);
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
}

function quaternionFromAxisAngle(axis: [number, number, number], angle: number): [number, number, number, number] {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (!Number.isFinite(length) || length <= 1e-12) return [1, 0, 0, 0];
  const half = angle / 2;
  const scale = Math.sin(half) / length;
  return normalizeQuaternion([Math.cos(half), axis[0] * scale, axis[1] * scale, axis[2] * scale]);
}

function quaternionFromUnitVectors(from: [number, number, number], to: [number, number, number]): [number, number, number, number] {
  const clampedDot = clamp(dot3(from, to), -1, 1);
  if (clampedDot > 0.999999) return [1, 0, 0, 0];
  if (clampedDot < -0.999999) {
    const fallbackAxis = Math.abs(from[0]) < 0.9 ? [1, 0, 0] as [number, number, number] : [0, 0, 1] as [number, number, number];
    const axis = normalize3(cross3(from, fallbackAxis)) ?? [0, 0, 1];
    return quaternionFromAxisAngle(axis, Math.PI);
  }
  const axis = cross3(from, to);
  return normalizeQuaternion([1 + clampedDot, axis[0], axis[1], axis[2]]);
}

function multiplyQuaternion(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw
  ];
}

function normalizeQuaternion(q: [number, number, number, number]): [number, number, number, number] {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(length) || length <= 1e-12) return [1, 0, 0, 0];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
