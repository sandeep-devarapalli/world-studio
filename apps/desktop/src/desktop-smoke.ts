import path from "node:path";

export interface DesktopSmokeEnvironment {
  WORLD_STUDIO_DESKTOP_SMOKE?: string;
  WORLD_STUDIO_DESKTOP_SMOKE_ARTIFACTS?: string;
  WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA?: string;
}

export function desktopSmokeUserDataPath(env: DesktopSmokeEnvironment): string | null {
  if (env.WORLD_STUDIO_DESKTOP_SMOKE !== "1") return null;
  const artifactDir = env.WORLD_STUDIO_DESKTOP_SMOKE_ARTIFACTS;
  const userDataDir = env.WORLD_STUDIO_DESKTOP_SMOKE_USER_DATA;
  if (!artifactDir || !userDataDir || !path.isAbsolute(artifactDir) || !path.isAbsolute(userDataDir)) {
    throw new Error("Desktop smoke requires absolute artifact and user-data paths.");
  }
  const relativePath = path.relative(artifactDir, userDataDir);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("Desktop smoke user data must be contained by its artifact directory.");
  }
  return userDataDir;
}
