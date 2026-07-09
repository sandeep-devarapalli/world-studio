import { describe, expect, it } from "vitest";
import type { CameraState } from "@world-studio/world-core";
import { applyWorldOrientationToFrameCamera, centerSpinCameraFromFrames, classifySimulateDrag, commandForKey, defaultSimulateSteps, dollyCamera, dollyFirstPersonCamera, estimateWorldOrientation, firstPersonCameraFromFrame, floorHeightFromWorldPoints, freeKeyboardLookStepX, freeMoveStep, insideLookCameraFromFrames, interpolateFrameCameras, moveFirstPersonCamera, moveFreeCamera, panFirstPersonCamera, radiusFromWorldPoints, refineWorldOrientationWithFloorNormal, rotateFirstPersonCamera, rotateFirstPersonCameraClamped, panCamera, rotateCamera, spinFirstPersonCamera, stepsForSceneRadius } from "./simulate-camera";

const camera: CameraState = {
  yaw: 0,
  pitch: 0.4,
  distance: 7.2,
  target: [0, 0.7, -0.2],
  fov: 50
};

describe("simulate camera controls", () => {
  it("maps AHOLO-style keys to free camera movement commands", () => {
    expect(commandForKey("w")).toBe("forward");
    expect(commandForKey("A")).toBe("left");
    expect(commandForKey("ArrowUp")).toBe("lookUp");
    expect(commandForKey("ArrowUp", true)).toBe("forward");
    expect(commandForKey("ArrowLeft")).toBe("lookLeft");
    expect(commandForKey("ArrowRight", true)).toBe("right");
    expect(commandForKey("q")).toBe("rise");
    expect(commandForKey("E")).toBe("descend");
    expect(commandForKey("r")).toBe("rollLeft");
    expect(commandForKey("f")).toBe("rollRight");
  });

  it("moves and rolls the free camera without changing frame evidence state", () => {
    expect(moveFreeCamera(camera, "forward").target[2]).toBeCloseTo(camera.target[2] - freeMoveStep);
    expect(moveFreeCamera(camera, "back").target[2]).toBeGreaterThan(camera.target[2]);
    expect(moveFreeCamera(camera, "rise").target[1]).toBeGreaterThan(camera.target[1]);
    expect(moveFreeCamera(camera, "rollRight").roll).toBeGreaterThan(0);
  });

  it("keeps keyboard look increments small enough for inspection", () => {
    const looked = moveFreeCamera(camera, "lookRight");
    expect(looked.yaw - camera.yaw).toBeGreaterThan(0);
    expect(looked.yaw - camera.yaw).toBeLessThan(0.06);
  });

  it("rotates, pans, and clamps dolly distance", () => {
    expect(rotateCamera(camera, 10, 10).yaw).toBeGreaterThan(camera.yaw);
    expect(panCamera(camera, 20, 10).target).not.toEqual(camera.target);
    expect(dollyCamera(camera, -10_000).distance).toBe(1.2);
    expect(dollyCamera(camera, 10_000).distance).toBe(28);
  });

  it("classifies mouse gestures for rotate, orbit, and pan", () => {
    expect(classifySimulateDrag({ altKey: false, shiftKey: false, button: 0, buttons: 1 })).toBe("rotate");
    expect(classifySimulateDrag({ altKey: true, shiftKey: false, button: 0, buttons: 1 })).toBe("orbit");
    expect(classifySimulateDrag({ altKey: false, shiftKey: true, button: 0, buttons: 1 })).toBe("pan");
    expect(classifySimulateDrag({ altKey: false, shiftKey: false, button: 2, buttons: 2 })).toBe("pan");
  });

  it("seeds an inside first-person camera from a source frame camera", () => {
    const inside = firstPersonCameraFromFrame({
      width: 1920,
      height: 1440,
      fx: 1340,
      fy: 1340,
      cx: 960,
      cy: 720,
      translation: [1, 2, 3],
      rotation: [2, 0, 0, 0],
      coordinateFrame: "colmap_world",
      authority: "COLMAP sparse reconstruction"
    });

    expect(inside.position).toEqual([1, 2, 3]);
    expect(inside.rotation).toEqual([1, 0, 0, 0]);
    expect(inside.coordinateFrame).toBe("colmap_world");
    expect(inside.fov).toBeGreaterThan(40);
  });

  it("moves and rotates an inside first-person camera", () => {
    const inside = firstPersonCameraFromFrame({
      width: 10,
      height: 10,
      fx: 10,
      fy: 10,
      cx: 5,
      cy: 5,
      translation: [0, 0, 0],
      rotation: [1, 0, 0, 0]
    });

    expect(moveFirstPersonCamera(inside, "forward").position[2]).toBeGreaterThan(inside.position[2]);
    expect(moveFirstPersonCamera(inside, "right").position[0]).toBeGreaterThan(inside.position[0]);
    expect(moveFirstPersonCamera(inside, "lookLeft").rotation).not.toEqual(inside.rotation);
    expect(rotateFirstPersonCamera(inside, 20, 0).rotation).not.toEqual(inside.rotation);
  });

  it("levels frame cameras from the source camera up vector", () => {
    const frame = {
      width: 10,
      height: 10,
      fx: 10,
      fy: 10,
      cx: 5,
      cy: 5,
      translation: [1, 1, 3] as [number, number, number],
      rotation: [1, 0, 0, 0] as [number, number, number, number],
      coordinateFrame: "colmap_world"
    };
    const orientation = estimateWorldOrientation([frame, frame], [1, 2, 3]);
    expect(orientation).toBeDefined();
    const leveled = applyWorldOrientationToFrameCamera(frame, orientation);
    expect(leveled.translation[1]).toBeCloseTo(1);
    expect(leveled.coordinateFrame).toBe("colmap_world_leveled");
  });

  it("derives movement steps from the scene radius with clamped bounds", () => {
    expect(stepsForSceneRadius(undefined)).toEqual(defaultSimulateSteps);
    expect(stepsForSceneRadius(-3)).toEqual(defaultSimulateSteps);
    const room = stepsForSceneRadius(10);
    expect(room.move).toBeCloseTo(0.4);
    expect(room.rise).toBeCloseTo(0.32);
    expect(room.scale).toBeCloseTo(0.4 / freeMoveStep);
    expect(stepsForSceneRadius(0.1).move).toBeCloseTo(0.02);
    expect(stepsForSceneRadius(500).move).toBeCloseTo(1.0);
  });

  it("estimates the floor height from world points", () => {
    const points = [
      ...Array.from({ length: 90 }, (_, index) => ({ x: (index % 10) - 5, y: 0.02 * (index % 3), z: Math.floor(index / 10) - 4 })),
      ...Array.from({ length: 30 }, (_, index) => ({ x: (index % 6) - 3, y: 2.4, z: (index % 5) - 2 }))
    ];
    const floor = floorHeightFromWorldPoints(points, [0, 0, 0]);
    expect(floor).toBeDefined();
    expect(floor!).toBeLessThan(0.1);
    expect(floor!).toBeGreaterThanOrEqual(0);
    expect(floorHeightFromWorldPoints(points.slice(0, 3), [0, 0, 0])).toBeUndefined();
  });

  it("estimates a robust scene radius from world points", () => {
    const points = Array.from({ length: 100 }, (_, index) => ({ x: Math.cos(index) * 5, y: 0, z: Math.sin(index) * 5 }));
    const radius = radiusFromWorldPoints(points, [0, 0, 0]);
    expect(radius).toBeDefined();
    expect(radius!).toBeGreaterThan(4.5);
    expect(radius!).toBeLessThanOrEqual(5.01);
    expect(radiusFromWorldPoints(points.slice(0, 3), [0, 0, 0])).toBeUndefined();
  });

  it("scales keyboard movement by scene-derived steps and per-frame fractions", () => {
    const steps = stepsForSceneRadius(10);
    const moved = moveFreeCamera(camera, "back", steps);
    expect(moved.target[2] - camera.target[2]).toBeCloseTo(steps.move);
    const partial = moveFreeCamera(camera, "back", steps, 0.25);
    expect(partial.target[2] - camera.target[2]).toBeCloseTo(steps.move * 0.25);
    const looked = moveFreeCamera(camera, "lookRight", steps, 0.5);
    expect(looked.yaw - camera.yaw).toBeCloseTo(freeKeyboardLookStepX * 0.5 * 0.006);
  });

  it("clamps first-person pitch during pointer-lock look", () => {
    let inside = firstPersonCameraFromFrame({
      width: 10,
      height: 10,
      fx: 10,
      fy: 10,
      cx: 5,
      cy: 5,
      translation: [0, 0, 0],
      rotation: [1, 0, 0, 0]
    });
    for (let index = 0; index < 200; index += 1) {
      inside = rotateFirstPersonCameraClamped(inside, 0, 40);
    }
    const elevation = Math.asin(Math.max(-1, Math.min(1, quaternionForwardY(inside.rotation))));
    expect(Math.abs(elevation)).toBeLessThanOrEqual((70 * Math.PI) / 180 + 1e-6);
    expect(Math.abs(elevation)).toBeGreaterThan((69 * Math.PI) / 180);
  });

  it("interpolates frame cameras with lerp position and slerp rotation", () => {
    const base = {
      width: 10,
      height: 10,
      fx: 10,
      fy: 10,
      cx: 5,
      cy: 5,
      translation: [0, 0, 0] as [number, number, number],
      rotation: [1, 0, 0, 0] as [number, number, number, number]
    };
    const quarterTurn: [number, number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
    const mid = interpolateFrameCameras(base, { ...base, translation: [2, 0, 4], rotation: quarterTurn }, 0.5);

    expect(mid.translation).toEqual([1, 0, 2]);
    const eighth = Math.PI / 8;
    expect(mid.rotation[0]).toBeCloseTo(Math.cos(eighth));
    expect(mid.rotation[2]).toBeCloseTo(Math.sin(eighth));
    expect(interpolateFrameCameras(base, { ...base, translation: [2, 0, 4] }, 0).translation).toEqual([0, 0, 0]);
  });

  it("builds the inside preset at the median frame position looking at the center", () => {
    const frame = (x: number, z: number) => ({
      width: 10,
      height: 10,
      fx: 10,
      fy: 10,
      cx: 5,
      cy: 5,
      translation: [x, 1, z] as [number, number, number],
      rotation: [1, 0, 0, 0] as [number, number, number, number]
    });
    const inside = insideLookCameraFromFrames([frame(2, 0), frame(2.2, 0.1), frame(1.8, -0.1)], undefined);

    expect(inside).not.toBeNull();
    expect(inside!.position[0]).toBeCloseTo(2);
    expect(inside!.position[1]).toBeCloseTo(1);
    const forwardX = 2 * (inside!.rotation[0] * inside!.rotation[2] + inside!.rotation[1] * inside!.rotation[3]);
    expect(forwardX).toBeLessThan(-0.9);
    expect(insideLookCameraFromFrames([undefined], undefined)).toBeNull();
  });

  it("center 360 preset faces outward with zero pitch and roll, and spinning never rolls", () => {
    const frame = (x: number, z: number) => ({
      width: 10,
      height: 10,
      fx: 10,
      fy: 10,
      cx: 5,
      cy: 5,
      translation: [x, 1, z] as [number, number, number],
      rotation: [1, 0, 0, 0] as [number, number, number, number]
    });
    const center = centerSpinCameraFromFrames([frame(2, 0), frame(2.2, 0.1), frame(1.8, -0.1)], undefined);

    expect(center).not.toBeNull();
    const forwardOf = (q: [number, number, number, number]): [number, number, number] => [
      2 * (q[1] * q[3] + q[0] * q[2]),
      2 * (q[2] * q[3] - q[0] * q[1]),
      1 - 2 * (q[1] * q[1] + q[2] * q[2])
    ];
    const upOf = (q: [number, number, number, number]): [number, number, number] => [
      2 * (q[1] * q[2] - q[0] * q[3]),
      1 - 2 * (q[1] * q[1] + q[3] * q[3]),
      2 * (q[2] * q[3] + q[0] * q[1])
    ];
    const forward = forwardOf(center!.rotation);
    expect(forward[0]).toBeGreaterThan(0.9);
    expect(Math.abs(forward[1])).toBeLessThan(1e-6);
    expect(upOf(center!.rotation)[1]).toBeCloseTo(1);

    let spun = center!;
    for (let step = 0; step < 8; step += 1) {
      spun = spinFirstPersonCamera(spun, Math.PI / 4);
      expect(Math.abs(forwardOf(spun.rotation)[1])).toBeLessThan(1e-6);
      expect(upOf(spun.rotation)[1]).toBeCloseTo(1);
    }
    const roundTrip = forwardOf(spun.rotation);
    expect(roundTrip[0]).toBeCloseTo(forward[0]);
    expect(roundTrip[2]).toBeCloseTo(forward[2]);
  });

  it("refines world orientation so a tilted floor becomes level", () => {
    const tilt = (12 * Math.PI) / 180;
    const points: Array<{ x: number; y: number; z: number }> = [];
    for (let index = 0; index < 900; index += 1) {
      const x = ((index % 30) - 15) / 5;
      const z = (Math.floor(index / 30) - 15) / 5;
      const y = 0;
      points.push({
        x,
        y: y * Math.cos(tilt) - z * Math.sin(tilt),
        z: y * Math.sin(tilt) + z * Math.cos(tilt)
      });
    }
    for (let index = 0; index < 300; index += 1) {
      points.push({ x: ((index % 20) - 10) / 5, y: 0.5 + (index % 7) * 0.3, z: 2.5 });
    }
    const orientation = refineWorldOrientationWithFloorNormal(points, {
      rotation: [1, 0, 0, 0],
      center: [0, 0, 0],
      sourceUp: [0, 1, 0],
      authority: "test"
    });

    expect(orientation).toBeDefined();
    expect(orientation!.authority).toContain("floor-normal refined");
    const q = orientation!.rotation;
    const floorNormalWorld: [number, number, number] = [0, Math.cos(tilt), Math.sin(tilt)];
    const rotated = [
      floorNormalWorld[0] * (1 - 2 * (q[2] * q[2] + q[3] * q[3])) + floorNormalWorld[1] * 2 * (q[1] * q[2] - q[0] * q[3]) + floorNormalWorld[2] * 2 * (q[1] * q[3] + q[0] * q[2]),
      floorNormalWorld[0] * 2 * (q[1] * q[2] + q[0] * q[3]) + floorNormalWorld[1] * (1 - 2 * (q[1] * q[1] + q[3] * q[3])) + floorNormalWorld[2] * 2 * (q[2] * q[3] - q[0] * q[1]),
      floorNormalWorld[0] * 2 * (q[1] * q[3] - q[0] * q[2]) + floorNormalWorld[1] * 2 * (q[2] * q[3] + q[0] * q[1]) + floorNormalWorld[2] * (1 - 2 * (q[1] * q[1] + q[2] * q[2]))
    ];
    expect(rotated[1]).toBeGreaterThan(0.999);
  });

  it("leaves orientation unchanged when no floor band exists", () => {
    const sparse = Array.from({ length: 150 }, (_, index) => ({ x: index * 0.01, y: index * 0.01, z: 0 }));
    const original = { rotation: [1, 0, 0, 0] as [number, number, number, number], center: [0, 0, 0] as [number, number, number], sourceUp: [0, 1, 0] as [number, number, number], authority: "test" };
    expect(refineWorldOrientationWithFloorNormal(sparse, original)).toBe(original);
  });

  it("scales first-person dolly and pan by the scene scale", () => {
    const inside = firstPersonCameraFromFrame({
      width: 10,
      height: 10,
      fx: 10,
      fy: 10,
      cx: 5,
      cy: 5,
      translation: [0, 0, 0],
      rotation: [1, 0, 0, 0]
    });
    const baseline = dollyFirstPersonCamera(inside, -100);
    const scaled = dollyFirstPersonCamera(inside, -100, 2);
    expect(scaled.position[2]).toBeCloseTo(baseline.position[2] * 2);
    const panned = panFirstPersonCamera(inside, 10, 0, 2);
    const pannedBaseline = panFirstPersonCamera(inside, 10, 0);
    expect(panned.position[0]).toBeCloseTo(pannedBaseline.position[0] * 2);
  });
});

function quaternionForwardY([w, x, y, z]: [number, number, number, number]): number {
  return 2 * (y * z - w * x);
}
