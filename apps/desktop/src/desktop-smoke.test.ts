import { describe, expect, it } from "vitest";
import { desktopSmokeUserDataPath } from "./desktop-smoke.js";

describe("desktop smoke user-data isolation", () => {
  it("preserves normal Electron user-data behavior outside smoke mode", () => {
    expect(desktopSmokeUserDataPath({})).toBeNull();
    expect(desktopSmokeUserDataPath({
      WORLD_STUDIO_DESKTOP_SMOKE: "0",
      WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA: "/tmp/ignored"
    })).toBeNull();
  });

  it("accepts an absolute user-data child of the smoke artifact directory", () => {
    expect(desktopSmokeUserDataPath({
      WORLD_STUDIO_DESKTOP_SMOKE: "1",
      WORLD_STUDIO_DESKTOP_SMOKE_ARTIFACTS: "/tmp/world-studio-smoke",
      WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA: "/tmp/world-studio-smoke/user-data"
    })).toBe("/tmp/world-studio-smoke/user-data");
  });

  it.each([
    {
      WORLD_STUDIO_DESKTOP_SMOKE: "1",
      WORLD_STUDIO_DESKTOP_SMOKE_ARTIFACTS: "relative/artifacts",
      WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA: "/tmp/world-studio-smoke/user-data"
    },
    {
      WORLD_STUDIO_DESKTOP_SMOKE: "1",
      WORLD_STUDIO_DESKTOP_SMOKE_ARTIFACTS: "/tmp/world-studio-smoke",
      WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA: "/tmp/other/user-data"
    },
    {
      WORLD_STUDIO_DESKTOP_SMOKE: "1",
      WORLD_STUDIO_DESKTOP_SMOKE_ARTIFACTS: "/tmp/world-studio-smoke",
      WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA: "/tmp/world-studio-smoke"
    }
  ])("rejects missing, relative, or escaping smoke paths", (env) => {
    expect(() => desktopSmokeUserDataPath(env)).toThrow(/absolute|contained/);
  });
});
