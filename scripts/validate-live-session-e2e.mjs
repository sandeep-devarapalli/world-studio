import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
let receiver = new LiveSessionReceiver({ root: storeRoot, port: 0 });

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

  const progressiveSessionId = "csl_SMOhjzjH7dE8x3yB5A0KBAo4YL6A4IzY1U570kVX_D8";
  const progressiveSession = {
    schema: "capture_splat.live_session.v0.2",
    session_id: progressiveSessionId,
    created_at: "2026-07-30T10:00:00.000Z",
    source_session_seed_b64u: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    expected_frame_count: null,
    coordinate_system: {
      id: "arkit_world",
      units: "meters",
      handedness: "right",
      world_up: "+Y",
      camera_forward: "-Z",
      matrix_layout: "row-major",
      vector_convention: "column-vector"
    },
    authority: "proposal_only"
  };
  const progressiveBase = `http://127.0.0.1:${port}/api/capture-splat/live/v0.1`;
  assert(
    (await jsonRequest(`${progressiveBase}/sessions/${progressiveSessionId}`, "PUT", progressiveSession)).status === 200,
    "progressive session seed was rejected"
  );
  assert((await receiver.status()).sourceManifestId === null, "progressive session bound a manifest before finalization");
  await putProgressiveFrame(progressiveBase, capturePath, progressiveSessionId, 2);
  await receiver.stop();
  receiver = new LiveSessionReceiver({ root: storeRoot, port: 0 });
  const restarted = await receiver.start();
  const restartedPort = restarted.listening?.port;
  assert(typeof restartedPort === "number", "restarted receiver did not expose a port");
  const restartedBase = `http://127.0.0.1:${restartedPort}/api/capture-splat/live/v0.1`;
  const resumed = await fetch(`${restartedBase}/sessions/${progressiveSessionId}`).then((response) => response.json());
  assert(resumed.expected_frame_count === null, "open progressive resume declared a final count");
  assert(resumed.missing_ranges?.[0]?.start === 1, "progressive restart lost its missing range");
  await putProgressiveFrame(restartedBase, capturePath, progressiveSessionId, 1);
  const captureManifestBytes = await readFile(path.join(capturePath, "capture.json"));
  const progressiveFinalize = {
    schema: "capture_splat.live_finalize.v0.2",
    session_id: progressiveSessionId,
    final_sequence_id: 2,
    source_manifest: {
      path: "capture.json",
      sha256: sha256(captureManifestBytes),
      size_bytes: captureManifestBytes.byteLength,
      schema: "capture_splat.v0.3"
    }
  };
  const progressiveFinalized = await jsonRequest(
    `${restartedBase}/sessions/${progressiveSessionId}/finalize`,
    "POST",
    progressiveFinalize
  ).then((response) => response.json());
  assert(
    progressiveFinalized.finalized === true && progressiveFinalized.expected_frame_count === 2,
    "progressive finalization did not publish the final count"
  );
  const duplicateProgressiveFinalize = await jsonRequest(
    `${restartedBase}/sessions/${progressiveSessionId}/finalize`,
    "POST",
    progressiveFinalize
  ).then((response) => response.json());
  assert(duplicateProgressiveFinalize.status === "finalized", "progressive finalization was not idempotent");
  const progressiveSnapshot = await receiver.status();
  assert(
    progressiveSnapshot.sourceManifestId === progressiveFinalize.source_manifest.sha256,
    "progressive snapshot lost the final manifest binding"
  );
  const progressiveRoot = receiver.store.sessionDirectory(progressiveSessionId);
  const progressiveHandoff = JSON.parse(
    await readFile(path.join(progressiveRoot, "capture-splat.world-studio.json"), "utf8")
  );
  assert(
    JSON.stringify(progressiveHandoff.source_manifest) === JSON.stringify(progressiveFinalize.source_manifest),
    "progressive handoff source manifest differs"
  );
  assert(
    progressiveHandoff.source_manifest_verification === "declared_checksum_reference_only",
    "progressive handoff overclaimed source manifest verification"
  );
  const progressiveReopened = await readLocalPackage(progressiveRoot);
  assert(progressiveReopened.packageKind === "capture-splat-local-folder", "progressive handoff did not reopen");

  console.log(JSON.stringify({
    schema: "capture_splat.world_studio_live_e2e.v0.1",
    status: "pass",
    session_id: sessionId,
    received_count: snapshot.receivedCount,
    resumed: summary.resumed,
    duplicate_sends: summary.duplicate_sends,
    reopened_package_kind: reopened.packageKind,
    reopened_frame_count: mediaFrames.frames.length,
    authority: handoff.authority,
    progressive_session_id: progressiveSessionId,
    progressive_resumed: true,
    progressive_manifest_bound: true,
    progressive_reopened_package_kind: progressiveReopened.packageKind
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

async function putProgressiveFrame(base, root, sessionId, sequenceId) {
  const bytes = await readFile(path.join(root, "rgb", `frame-${sequenceId}.png`));
  const metadata = {
    schema: "capture_splat.live_frame.v0.1",
    session_id: sessionId,
    sequence_id: sequenceId,
    timestamp: {
      value: sequenceId * 0.1,
      clock_domain: "arkit_session"
    },
    source_frame: {
      path: `rgb/frame-${sequenceId}.png`,
      sha256: sha256(bytes),
      size_bytes: bytes.byteLength,
      media_type: "image/png",
      width: 1,
      height: 1
    },
    intrinsics: {
      model: "pinhole",
      fl_x: 0.8,
      fl_y: 0.8,
      cx: 0.5,
      cy: 0.5,
      calibration_width: 1,
      calibration_height: 1,
      applies_to: "source_frame"
    },
    camera_to_world: [
      1, 0, 0, sequenceId * 0.25,
      0, 1, 0, 1,
      0, 0, 1, -sequenceId * 0.5,
      0, 0, 0, 1
    ],
    coordinate_frame: "arkit_world",
    tracking: {
      state: "normal"
    },
    quality: {
      accepted: true,
      reason: "progressive_live_e2e_fixture",
      score: 0.9
    }
  };
  const metadataResponse = await jsonRequest(
    `${base}/sessions/${sessionId}/frames/${sequenceId}`,
    "PUT",
    metadata
  );
  assert(metadataResponse.status === 202, `progressive frame ${sequenceId} metadata was rejected`);
  const assetResponse = await fetch(
    `${base}/sessions/${sessionId}/frames/${sequenceId}/assets/source`,
    { method: "PUT", body: bytes }
  );
  assert(assetResponse.status === 200, `progressive frame ${sequenceId} asset was rejected`);
}

function jsonRequest(url, method, body) {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
