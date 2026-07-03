import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("desktop package smoke currently builds macOS .app bundles only.");
}

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const rootPackageJson = require(path.join(repoRoot, "package.json"));
const electronPackageJsonPath = require.resolve("electron/package.json");
const electronRoot = path.dirname(electronPackageJsonPath);
const electronApp = path.join(electronRoot, "dist", "Electron.app");
const releaseDir = path.join(repoRoot, "release", `mac-${process.arch}`);
const outputApp = path.join(releaseDir, "World Studio.app");

run("pnpm", ["run", "setup"], desktopDir);

const stagingRoot = await mkdtemp(path.join(tmpdir(), "world-studio-desktop-"));
const stagingApp = path.join(stagingRoot, "World Studio.app");
const payloadDir = path.join(stagingApp, "Contents", "Resources", "app");

try {
  await rm(outputApp, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  run("ditto", ["--norsrc", "--noextattr", electronApp, stagingApp], repoRoot);

  await mkdir(path.join(payloadDir, "apps", "desktop"), { recursive: true });
  await mkdir(path.join(payloadDir, "apps", "web"), { recursive: true });
  await cp(path.join(desktopDir, "dist"), path.join(payloadDir, "apps", "desktop", "dist"), { recursive: true });
  await cp(path.join(repoRoot, "apps", "web", "dist"), path.join(payloadDir, "apps", "web", "dist"), { recursive: true });
  await writeFile(
    path.join(payloadDir, "package.json"),
    `${JSON.stringify({
      name: "world-studio-desktop-bundle",
      version: rootPackageJson.version,
      private: true,
      type: "module",
      main: "apps/desktop/dist/main.js"
    }, null, 2)}\n`
  );
  await rm(path.join(stagingApp, "Contents", "Resources", "default_app.asar"), { force: true });

  const infoPlist = path.join(stagingApp, "Contents", "Info.plist");
  removePlistValue(infoPlist, "ElectronAsarIntegrity");
  setPlistValue(infoPlist, "CFBundleDisplayName", "World Studio");
  setPlistValue(infoPlist, "CFBundleName", "World Studio");
  setPlistValue(infoPlist, "CFBundleIdentifier", "dev.worldstudio.desktop");
  setPlistValue(infoPlist, "CFBundleShortVersionString", rootPackageJson.version);
  setPlistValue(infoPlist, "CFBundleVersion", rootPackageJson.version);
  setPlistValue(infoPlist, "LSApplicationCategoryType", "public.app-category.graphics-design");

  await stripMacMetadata(stagingApp);
  run("codesign", ["--force", "--deep", "--sign", "-", stagingApp], repoRoot);
  run("ditto", ["--norsrc", "--noextattr", stagingApp, outputApp], repoRoot);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

console.log(`[desktop:package] Built ${outputApp}`);

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function setPlistValue(file, key, value) {
  run("plutil", ["-replace", key, "-string", value, file], repoRoot);
}

function removePlistValue(file, key) {
  try {
    run("plutil", ["-remove", key, file], repoRoot);
  } catch {
    // Older Electron bundles or already-repacked bundles may not include this key.
  }
}

async function stripMacMetadata(target) {
  run("xattr", ["-cr", target], repoRoot);
  await removeXattr(target, "com.apple.FinderInfo");
}

async function removeXattr(target, attribute) {
  tryRunQuiet("xattr", ["-d", attribute, target], repoRoot);

  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => removeXattr(path.join(target, entry.name), attribute))
  );
}

function tryRunQuiet(command, args, cwd) {
  try {
    execFileSync(command, args, { cwd, stdio: "ignore" });
  } catch {
    // Most files do not carry optional macOS metadata.
  }
}
