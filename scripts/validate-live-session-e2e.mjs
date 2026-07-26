import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const captureRoot = path.resolve(process.env.CAPTURE_SPLAT_REPO ?? path.join(repoRoot, "..", "capture-splat"));
const python = existsSync(path.join(captureRoot, ".venv", "bin", "python"))
  ? path.join(captureRoot, ".venv", "bin", "python")
  : "python3";
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "world-studio-live-e2e-"));
const storeRoot = path.join(temporaryRoot, "store");
const capturePath = path.join(temporaryRoot, "capture");
const sessionId = "phase1-e2e";
const { LiveSessionReceiver } = await import("../apps/desktop/dist/live-session-receiver.js");
const { readLocalPackage } = await import("../apps/desktop/dist/package-reader.js");
const receiver = new LiveSessionReceiver({ root: storeRoot, port: 0 });

try {
  await writeCapture(capturePath);
  const listening = await receiver.start();
  const port = listening.listening?.port;
  assert(typeof port === "number", "receiver did not expose an ephemeral port");
  const { stdout, stderr } = await run(
    python,
    [
      "-m",
      "capture_splat.cli",
      "replay-live-session",
      "--capture",
      capturePath,
      "--receiver",
      `http://127.0.0.1:${port}`,
      "--session-id",
      sessionId,
      "--delay-ms",
      "1",
      "--shuffle",
      "--seed",
      "17",
      "--duplicate-every",
      "1",
      "--disconnect-after",
      "1",
      "--resume"
    ],
    {
      cwd: captureRoot,
      env: { ...process.env, PYTHONPATH: path.join(captureRoot, "python") },
      maxBuffer: 4 * 1024 * 1024
    }
  );
  assert(!stderr.trim(), `Capture replay wrote stderr: ${stderr.trim()}`);
  const summary = JSON.parse(stdout);
  assert(summary.schema === "capture_splat.live_replay_summary.v0.1", "unexpected replay summary schema");
  assert(summary.status === "finalized" && summary.finalized === true, "replay did not finalize");
  assert(summary.received_count === 2, "receiver did not commit both source frames");
  assert(summary.simulated_disconnects === 1 && summary.resumed === true, "disconnect/resume simulation did not run");
  assert(summary.duplicate_sends === 2, "duplicate simulation did not resend both frames");

  const snapshot = await receiver.status();
  assert(snapshot.state === "finalized", "receiver did not retain finalized state");
  assert(snapshot.receivedCount === 2 && snapshot.missingCount === 0, "receiver finalized with incorrect counts");

  const sessionRoot = receiver.store.sessionDirectory(sessionId);
  const handoff = JSON.parse(await readFile(path.join(sessionRoot, "capture-splat.world-studio.json"), "utf8"));
  assert(handoff.authority === "proposal_only", "handoff authority changed");
  assert(handoff.source_frames?.length === 2, "handoff does not contain both source frames");

  const reopened = await readLocalPackage(sessionRoot);
  assert(reopened.packageKind === "capture-splat-local-folder", "finalized handoff did not reopen as Capture Splat");
  const mediaFrames = JSON.parse(reopened.budoMediaFrames?.text ?? "{}");
  assert(mediaFrames.frames?.length === 2, "reopened handoff lost source-frame previews");
  assert(mediaFrames.frames.every((frame) => frame.frame_camera?.authority?.includes("proposal only")), "display cameras lost proposal-only authority");

  console.log(JSON.stringify({
    schema: "capture_splat.world_studio_live_e2e.v0.1",
    status: "pass",
    session_id: sessionId,
    received_count: snapshot.receivedCount,
    resumed: summary.resumed,
    duplicate_sends: summary.duplicate_sends,
    reopened_package_kind: reopened.packageKind,
    reopened_frame_count: mediaFrames.frames.length,
    authority: handoff.authority
  }, null, 2));
} finally {
  await receiver.stop();
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function writeCapture(root) {
  const rgbRoot = path.join(root, "rgb");
  await mkdir(rgbRoot, { recursive: true });
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcunXrfwAJpwP6J7EkXwAAAABJRU5ErkJggg==",
    "base64"
  );
  await writeFile(path.join(rgbRoot, "frame-1.png"), pixel);
  await writeFile(path.join(rgbRoot, "frame-2.png"), pixel);
  await writeFile(path.join(root, "capture.json"), `${JSON.stringify({
    schema: "capture_splat.v0.3",
    session_config: {
      scale_authority: "arkit_vio_metric",
      up_axis: [0, 1, 0]
    },
    intrinsics: {
      fl_x: 0.8,
      fl_y: 0.8,
      cx: 0.5,
      cy: 0.5,
      w: 1,
      h: 1
    },
    frames: [1, 2].map((sequenceId) => ({
      rgb: `rgb/frame-${sequenceId}.png`,
      timestamp: sequenceId * 0.1,
      transform_matrix: [
        [1, 0, 0, sequenceId * 0.25],
        [0, 1, 0, 1],
        [0, 0, 1, -sequenceId * 0.5],
        [0, 0, 0, 1]
      ],
      capture_quality: {
        accepted: true,
        reason: "live_e2e_fixture",
        score: 0.9
      }
    }))
  }, null, 2)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
