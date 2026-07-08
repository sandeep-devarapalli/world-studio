import { describe, expect, it } from "vitest";
import type { CameraState } from "@world-studio/world-core";
import { applyWorldOrientationToFrameCamera, classifySimulateDrag, commandForKey, dollyCamera, estimateWorldOrientation, firstPersonCameraFromFrame, freeMoveStep, moveFirstPersonCamera, moveFreeCamera, rotateFirstPersonCamera, panCamera, rotateCamera } from "./simulate-camera";

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
});
