import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("electron/package.json");
const electronRoot = path.dirname(packageJsonPath);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = String(packageJson.version);
const platform = process.env.ELECTRON_INSTALL_PLATFORM ?? process.env.npm_config_platform ?? process.platform;
const arch = process.env.ELECTRON_INSTALL_ARCH ?? process.env.npm_config_arch ?? process.arch;
const platformPath = getPlatformPath(platform);
const binaryPath = process.env.ELECTRON_OVERRIDE_DIST_PATH
  ? path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, platformPath)
  : path.join(electronRoot, "dist", platformPath);

if (isInstalled()) {
  console.log(`[desktop:setup] Electron ${version} is ready at ${binaryPath}`);
  process.exit(0);
}

console.log(`[desktop:setup] Electron ${version} binary is missing for ${platform}/${arch}.`);
console.log(`[desktop:setup] Expected executable: ${binaryPath}`);
console.log("[desktop:setup] Downloading Electron now. First setup is about 100-150 MB on macOS.");

try {
  await runInstaller();
  if (!isInstalled()) {
    throw new Error(`Electron installer finished, but no executable was found at ${binaryPath}`);
  }
  console.log(`[desktop:setup] Electron ${version} is ready at ${binaryPath}`);
} catch (error) {
  console.error(`[desktop:setup] ${error instanceof Error ? error.message : String(error)}`);
  console.error("[desktop:setup] Check network access to https://github.com/electron/electron/releases or set ELECTRON_MIRROR.");
  process.exit(1);
}

function isInstalled() {
  try {
    const installedVersion = readFileSync(path.join(electronRoot, "dist", "version"), "utf8").replace(/^v/, "").trim();
    const installedPath = readFileSync(path.join(electronRoot, "path.txt"), "utf8").trim();
    return installedVersion === version && installedPath === platformPath && existsSync(binaryPath);
  } catch {
    return false;
  }
}

function runInstaller() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(electronRoot, "install.js")], {
      env: process.env,
      stdio: "inherit"
    });
    let seconds = 0;
    const heartbeat = setInterval(() => {
      seconds += 15;
      console.log(`[desktop:setup] Still downloading Electron... ${seconds}s elapsed`);
    }, 15_000);

    child.on("error", (error) => {
      clearInterval(heartbeat);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearInterval(heartbeat);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Electron installer exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

function getPlatformPath(targetPlatform) {
  switch (targetPlatform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${targetPlatform} (${os.platform()})`);
  }
}
