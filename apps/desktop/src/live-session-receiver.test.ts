import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_FRAME_SCHEMA,
  LIVE_SESSION_SCHEMA,
  type LiveFrame,
  type LiveSession
} from "./live-session-contract.js";
import { LiveSessionReceiver } from "./live-session-receiver.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LiveSessionReceiver", () => {
  it("serves the loopback replay protocol through resume and finalization", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-receiver-"));
    roots.push(root);
    const receiver = new LiveSessionReceiver({ root, port: 0 });
    const updates: string[] = [];
    const unsubscribe = receiver.subscribe((snapshot) => updates.push(snapshot.state));
    const listening = await receiver.start();
    const base = `http://127.0.0.1:${listening.listening?.port}/api/capture-splat/live/v0.1`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, receiver: { state: "listening" } });
    const unsupportedMethod = await fetch(`${base}/sessions/test-session`, { method: "DELETE" });
    expect(unsupportedMethod.status).toBe(405);
    expect(await unsupportedMethod.json()).toMatchObject({ error: "method_not_allowed" });

    const malformed = await fetch(`${base}/sessions/test-session`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    expect(malformed.status).toBe(400);

    const sessionResponse = await jsonRequest(`${base}/sessions/test-session`, "PUT", session());
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({ operation: "session", status: "accepted" });

    const bytes = Buffer.from("receiver-frame");
    const frameResponse = await jsonRequest(`${base}/sessions/test-session/frames/1`, "PUT", frame(bytes));
    expect(frameResponse.status).toBe(202);
    expect(await frameResponse.json()).toMatchObject({ operation: "frame", status: "incomplete" });

    const assetResponse = await fetch(`${base}/sessions/test-session/frames/1/assets/source`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg", "content-length": String(bytes.byteLength) },
      body: bytes
    });
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.json()).toMatchObject({
      operation: "asset",
      status: "accepted",
      received_count: 1,
      contiguous_count: 1
    });
    const unknownResume = await fetch(`${base}/sessions/unknown-session`);
    expect(unknownResume.status).toBe(404);
    expect(await receiver.status()).toMatchObject({ state: "receiving", sessionId: "test-session" });

    const resumeResponse = await fetch(`${base}/sessions/test-session`);
    expect(resumeResponse.status).toBe(200);
    expect(await resumeResponse.json()).toMatchObject({ operation: "resume", received_count: 1 });

    const finalizeResponse = await jsonRequest(`${base}/sessions/test-session/finalize`, "POST", {
      schema: "capture_splat.live_finalize.v0.1",
      session_id: "test-session",
      final_sequence_id: 1
    });
    expect(finalizeResponse.status).toBe(200);
    expect(await finalizeResponse.json()).toMatchObject({ operation: "finalize", finalized: true });
    expect(await receiver.status()).toMatchObject({ state: "finalized", receivedCount: 1, missingCount: 0 });

    const preview = await receiver.readFramePreview("test-session", 1);
    expect(preview?.bytes).toEqual(bytes);
    expect(preview).toMatchObject({ mediaType: "image/jpeg", width: 20, height: 10 });
    expect(updates).toContain("receiving");
    expect(updates).toContain("finalized");

    unsubscribe();
    expect((await receiver.stop()).state).toBe("stopped");

    const restarted = new LiveSessionReceiver({ root, port: 0 });
    const restartedStatus = await restarted.start();
    const restartedBase = `http://127.0.0.1:${restartedStatus.listening?.port}/api/capture-splat/live/v0.1`;
    const duplicateSession = await jsonRequest(`${restartedBase}/sessions/test-session`, "PUT", session());
    expect(await duplicateSession.json()).toMatchObject({ status: "duplicate", finalized: true });
    expect((await restarted.status()).state).toBe("finalized");
    const finalizedResume = await fetch(`${restartedBase}/sessions/test-session`);
    expect(await finalizedResume.json()).toMatchObject({ operation: "resume", finalized: true });
    expect((await restarted.status()).state).toBe("finalized");
    await restarted.stop();
  });

  it("rejects non-loopback bindings", () => {
    expect(() => new LiveSessionReceiver({ root: "/tmp/not-used", host: "0.0.0.0" })).toThrow(/only on loopback/);
  });

  it("fails closed when an HTTP body is truncated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-receiver-truncated-"));
    roots.push(root);
    const receiver = new LiveSessionReceiver({ root, port: 0 });
    const listening = await receiver.start();
    const port = listening.listening?.port;
    expect(port).toBeTypeOf("number");

    const response = await truncatedJsonRequest(port!);
    expect(response).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
    expect(await receiver.status()).toMatchObject({ state: "listening", sessionId: null });
    await receiver.stop();
  });

  it("recovers committed frames in a new receiver process and resumes from durable status", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-receiver-restart-"));
    roots.push(root);
    const bytes = Buffer.from("durable-frame");
    const first = new LiveSessionReceiver({ root, port: 0 });
    const firstStatus = await first.start();
    const firstBase = `http://127.0.0.1:${firstStatus.listening?.port}/api/capture-splat/live/v0.1`;
    await jsonRequest(`${firstBase}/sessions/test-session`, "PUT", session());
    await jsonRequest(`${firstBase}/sessions/test-session/frames/1`, "PUT", frame(bytes));
    await fetch(`${firstBase}/sessions/test-session/frames/1/assets/source`, { method: "PUT", body: bytes });
    await first.stop();

    const recovered = new LiveSessionReceiver({ root, port: 0 });
    const recoveredStatus = await recovered.start();
    const recoveredBase = `http://127.0.0.1:${recoveredStatus.listening?.port}/api/capture-splat/live/v0.1`;
    const duplicateSession = await jsonRequest(`${recoveredBase}/sessions/test-session`, "PUT", session());
    expect(await duplicateSession.json()).toMatchObject({ status: "duplicate", received_count: 1 });
    expect((await recovered.status()).state).toBe("resuming");
    const resume = await fetch(`${recoveredBase}/sessions/test-session`);
    expect(await resume.json()).toMatchObject({
      operation: "resume",
      received_count: 1,
      contiguous_count: 1,
      missing_ranges: []
    });
    expect(await recovered.status()).toMatchObject({ state: "resuming", receivedCount: 1 });
    const duplicateFrame = await jsonRequest(`${recoveredBase}/sessions/test-session/frames/1`, "PUT", frame(bytes));
    expect(await duplicateFrame.json()).toMatchObject({ status: "duplicate", received_count: 1 });
    expect((await recovered.status()).state).toBe("receiving");
    await recovered.stop();
  });
});

function session(): LiveSession {
  return {
    schema: LIVE_SESSION_SCHEMA,
    session_id: "test-session",
    created_at: "2026-01-02T03:04:05Z",
    source_manifest: {
      path: "capture.json",
      sha256: sha(Buffer.from("manifest")),
      size_bytes: 8,
      schema: "capture_splat.v0.3"
    },
    expected_frame_count: 1,
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
}

function frame(bytes: Buffer): LiveFrame {
  return {
    schema: LIVE_FRAME_SCHEMA,
    session_id: "test-session",
    sequence_id: 1,
    timestamp: { value: 0, clock_domain: "arkit_session" },
    source_frame: {
      path: "rgb/source.jpg",
      sha256: sha(bytes),
      size_bytes: bytes.byteLength,
      media_type: "image/jpeg",
      width: 20,
      height: 10
    },
    intrinsics: {
      model: "pinhole",
      fl_x: 5,
      fl_y: 5,
      cx: 5,
      cy: 2.5,
      calibration_width: 10,
      calibration_height: 5,
      applies_to: "source_frame"
    },
    camera_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    coordinate_frame: "arkit_world",
    tracking: { state: "normal" },
    quality: { accepted: true }
  };
}

function sha(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonRequest(url: string, method: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function truncatedJsonRequest(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.end([
        "PUT /api/capture-splat/live/v0.1/sessions/test-session HTTP/1.1",
        "Host: 127.0.0.1",
        "Content-Type: application/json",
        "Content-Length: 64",
        "Connection: close",
        "",
        "{"
      ].join("\r\n"));
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}
