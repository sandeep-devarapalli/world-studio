import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const upstreams = [
  { name: "spark", url: "https://github.com/sparkjsdev/spark.git" },
  { name: "bullet3", url: "https://github.com/bulletphysics/bullet3.git" },
  { name: "mujoco", url: "https://github.com/google-deepmind/mujoco.git" },
  { name: "carla", url: "https://github.com/carla-simulator/carla.git", checkout: false },
  { name: "salva", url: "https://github.com/dimforge/salva.git" },
  { name: "rapier", url: "https://github.com/dimforge/rapier.git" },
  { name: "IsaacLab", url: "https://github.com/isaac-sim/IsaacLab.git", checkout: false },
  { name: "IsaacSim", url: "https://github.com/isaac-sim/IsaacSim.git", checkout: false },
  { name: "pcui", url: "https://github.com/playcanvas/pcui.git" },
  { name: "splat-transform", url: "https://github.com/playcanvas/splat-transform.git" },
  { name: "supersplat-viewer", url: "https://github.com/playcanvas/supersplat-viewer.git" },
  { name: "supersplat", url: "https://github.com/playcanvas/supersplat.git" },
  { name: "playcanvas-engine", url: "https://github.com/playcanvas/engine.git" },
  { name: "ai2thor", url: "https://github.com/allenai/ai2thor.git", checkout: false },
  { name: "ProjectAirSim", url: "https://github.com/iamaisim/ProjectAirSim.git", checkout: false },
  { name: "AirSim", url: "https://github.com/microsoft/AirSim.git", checkout: false },
  { name: "aholo-viewer", url: "https://github.com/manycoretech/aholo-viewer.git" },
  { name: "genesis-world", url: "https://github.com/Genesis-Embodied-AI/genesis-world.git", checkout: false },
  { name: "vksplat", url: "https://github.com/harry7557558/vksplat.git" },
  { name: "LichtFeld-Studio", url: "https://github.com/MrNeRF/LichtFeld-Studio.git" }
];

const root = path.resolve("references/upstream");
mkdirSync(root, { recursive: true });

function git(args, cwd = process.cwd()) {
  return spawnSync("git", args, { cwd, stdio: "inherit" });
}

function isCompleteClone(target, checkout) {
  if (!existsSync(target)) return false;
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: target, stdio: "ignore" });
  if (head.status !== 0) return false;
  if (!checkout) return true;
  const diff = spawnSync("git", ["diff", "--quiet"], { cwd: target, stdio: "ignore" });
  return diff.status === 0;
}

for (const entry of upstreams) {
  const { name, url, checkout = true } = entry;
  const target = path.join(root, name);
  if (isCompleteClone(target, checkout)) {
    console.log(`skip ${name}: already exists`);
    continue;
  }
  if (existsSync(target)) {
    console.error(`incomplete ${name}: move or remove ${target} before retrying`);
    process.exit(1);
  }
  console.log(`clone ${name}${checkout ? "" : " (no checkout)"}`);
  const args = ["clone", "--depth=1", "--filter=blob:none", "--single-branch"];
  if (!checkout) args.push("--no-checkout");
  args.push(url, target);
  const result = git(args);
  if (result.status !== 0) {
    console.error(`failed ${name}`);
    process.exit(result.status ?? 1);
  }
}
