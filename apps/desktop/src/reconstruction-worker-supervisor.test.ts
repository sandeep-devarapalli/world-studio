import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stableReconstructionJson } from "./reconstruction-worker-contract.js";
import {
  ReconstructionWorkerSupervisor,
  type ReconstructionWorkerChildProcess,
  type ReconstructionWorkerRegistration,
  type ReconstructionWorkerSpawn
} from "./reconstruction-worker-supervisor.js";

const fixture = fileURLToPath(new URL("../test-fixtures/reconstruction-worker-fixture.mjs", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ReconstructionWorkerSupervisor", () => {
  it("is unavailable with the production-empty registry", async () => {
    const supervisor = new ReconstructionWorkerSupervisor({ root: await tempRoot("empty") });
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      state: "unavailable",
      capabilities: [],
      job: null,
      authority: "proposal_only"
    });
    await expect(supervisor.start({ workerId: "missing", sessionId: "session-1" }))
      .rejects.toThrow(/not registered/);
  });

  it("stages immutable input and commits only checksum-verified proposal output", async () => {
    const { supervisor, root } = await harness("success");
    const started = await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    expect(started.job?.state).toBe("queued");
    const completed = await waitForState(supervisor, "completed");
    expect(completed).toMatchObject({
      authority: "proposal_only",
      job: {
        attempt: 1,
        progress: 1,
        authority: "proposal_only",
        outputs: [{
          role: "point_cloud",
          coordinateFrame: "arkit_world",
          previewAvailable: false,
          status: "completed"
        }]
      }
    });
    const jobId = completed.job!.jobId;
    expect(await readFile(path.join(root, jobId, "attempts/00000001/outputs/proposal.bin"), "utf8"))
      .toBe("deterministic reconstruction proposal\n");
    expect(await readdir(path.join(root, jobId, ".incoming"))).toEqual([]);
    expect(JSON.stringify(JSON.parse(await readFile(path.join(root, jobId, "state.json"), "utf8"))))
      .not.toContain(root);
  });

  it("publishes bounded log and progress updates before completion", async () => {
    const { supervisor } = await harness("slow-success");
    const updates: Array<{ state: string; progress: number | null; logs: number }> = [];
    const unsubscribe = supervisor.subscribe((snapshot) => {
      updates.push({ state: snapshot.state, progress: snapshot.job?.progress ?? null, logs: snapshot.job?.logs.length ?? 0 });
    });
    await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await waitForState(supervisor, "completed");
    unsubscribe();
    expect(updates.some((update) => update.state === "running" && update.progress === 0.5 && update.logs > 0)).toBe(true);
  });

  it("decodes UTF-8 protocol and stderr code points split across raw stream chunks", async () => {
    const { supervisor } = await harness("split-multibyte");
    await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const completed = await waitForState(supervisor, "completed");
    expect(completed.job?.logs.map((entry) => entry.message)).toEqual(expect.arrayContaining([
      "café split log",
      "café split stderr"
    ]));
    expect(completed.job?.logs.some((entry) => entry.message.includes("�"))).toBe(false);
  });

  it("accepts an orderly worker-declared failure and preserves its retryability", async () => {
    const { supervisor } = await harness("declared-failure");
    await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await expect(waitForState(supervisor, "failed")).resolves.toMatchObject({
      job: { failure: { code: "fixture_failure", retryable: true }, outputs: [] }
    });
  });

  it("sanitizes worker-declared failure diagnostics before persistence and restart", async () => {
    const current = await harness("declared-failure-unsafe");
    await current.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const failed = await waitForState(current.supervisor, "failed");
    expect(failed.job?.failure).toMatchObject({ code: "fixture_failure", retryable: true });
    expect(failed.job?.failure?.message).not.toContain(current.root);
    expect(failed.job?.failure?.message).not.toContain("\n");
    expect(failed.job?.failure?.message.length).toBeLessThanOrEqual(512);
    await expect(current.clone().getStatus()).resolves.toMatchObject({
      state: "failed",
      job: { failure: failed.job?.failure }
    });
  });

  it.each([
    ["bad-checksum", /checksum/i],
    ["size-mismatch", /size|bytes/i],
    ["traversal", /path/i],
    ["symlink-output", /symbolic link|bounded/i],
    ["hardlink-output", /linked file|bounded/i],
    ["extra-output", /undeclared/i],
    ["no-terminal", /terminal/i],
    ["terminal-mismatch", /terminal/i],
    ["media-mismatch", /not declared|support/i],
    ["out-of-order-event", /sequence/i],
    ["invalid-utf8-event", /UTF-8/i],
    ["invalid-utf8-result", /UTF-8/i]
  ])("fails closed for %s", async (mode, message) => {
    const { supervisor } = await harness(mode);
    await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const failed = await waitForState(supervisor, "failed");
    expect(failed.job?.failure?.message).toMatch(message);
    expect(failed.job?.outputs).toEqual([]);
  });

  it("enforces the cumulative protocol byte budget", async () => {
    const { supervisor } = await harness("oversized-log", { log_bytes: 512 });
    await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await expect(waitForState(supervisor, "failed")).resolves.toMatchObject({
      job: { failure: { code: "log_budget" } }
    });
  });

  it("terminates a running worker when staged output exceeds its byte budget", async () => {
    const { supervisor } = await harness("growing-output", { output_bytes: 1024 });
    await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await expect(waitForState(supervisor, "failed")).resolves.toMatchObject({
      job: { failure: { code: "output_budget" }, outputs: [] }
    });
  });

  it.each(["output-root-symlink", "incoming-parent-symlink"])(
    "rejects a worker-replaced %s without deleting through it",
    async (mode) => {
      const current = await harness(mode);
      const started = await current.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
      const failed = await waitForState(current.supervisor, "failed");
      expect(failed.job?.outputs).toEqual([]);
      const jobRoot = path.join(current.root, started.job!.jobId);
      const target = path.join(
        jobRoot,
        mode === "output-root-symlink" ? "fixture-output-root-1" : "fixture-incoming-root-1"
      );
      expect(await readFile(path.join(target, "sentinel.txt"), "utf8")).toBe("preserve");
      const incoming = await lstat(path.join(jobRoot, ".incoming")).catch((error: unknown) => {
        if (mode === "incoming-parent-symlink"
          && error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      });
      if (mode === "incoming-parent-symlink") {
        expect(incoming === null || incoming.isSymbolicLink()).toBe(true);
      } else {
        expect(incoming?.isDirectory()).toBe(true);
      }
    }
  );

  it("rejects a duplicate start while the first launch is reserved", async () => {
    const { supervisor } = await harness("slow-success");
    await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await expect(supervisor.start({ workerId: "fixture-worker", sessionId: "session-2" }))
      .rejects.toThrow(/already active/);
    await waitForState(supervisor, "completed");
  });

  it("bounds timeout and cancellation, including cancellation before launch", async () => {
    const timed = await harness("hang", { wall_time_ms: 75 }, 25);
    await timed.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await expect(waitForState(timed.supervisor, "timed_out")).resolves.toMatchObject({
      job: { failure: { code: "timeout" } }
    });

    const cancelled = await harness("ignore-term", { wall_time_ms: 2_000 }, 25);
    const started = await cancelled.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const stopped = await cancelled.supervisor.stop({ jobId: started.job!.jobId });
    expect(stopped.job?.state).toBe("cancelled");
    expect(await readdir(path.join(cancelled.root, started.job!.jobId, ".incoming"))).toEqual([]);
  });

  it.each(["timeout", "stop"] as const)(
    "%s terminates the isolated worker process group and discards descendant output",
    async (action) => {
      const current = await harness("descendant-writer", { wall_time_ms: 300 }, 30);
      const started = await current.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
      const jobRoot = path.join(current.root, started.job!.jobId);
      const marker = path.join(jobRoot, "attempts/00000001/descendant.pid");
      await waitForFile(marker);
      const descendantPid = Number(await readFile(marker, "utf8"));
      if (action === "stop") await current.supervisor.stop({ jobId: started.job!.jobId });
      const terminal = await waitForState(current.supervisor, action === "stop" ? "cancelled" : "timed_out");
      expect(terminal.job?.outputs).toEqual([]);
      await waitForProcessExit(descendantPid);
      await expect(lstat(path.join(jobRoot, "attempts/00000001/outputs"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(path.join(jobRoot, ".incoming"))).toEqual([]);
    }
  );

  it("retries the same immutable job inputs after a crash", async () => {
    const { supervisor, root } = await harness("crash-once");
    const started = await supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await waitForState(supervisor, "failed");
    const retried = await supervisor.retry({ jobId: started.job!.jobId });
    expect(retried.job?.attempt).toBe(2);
    const completed = await waitForState(supervisor, "completed");
    expect(completed.job?.attempt).toBe(2);
    const first = JSON.parse(await readFile(path.join(root, completed.job!.jobId, "attempts/00000001/job.json"), "utf8"));
    const second = JSON.parse(await readFile(path.join(root, completed.job!.jobId, "attempts/00000002/job.json"), "utf8"));
    expect(second.inputs).toEqual(first.inputs);
    expect(second.attempt).toBe(2);
  });

  it("fails recovery for corrupt state and rehashes committed outputs", async () => {
    const first = await harness("success");
    await first.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const completed = await waitForState(first.supervisor, "completed");
    const statePath = path.join(first.root, completed.job!.jobId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.logs = [{ sequenceId: 1, timestamp: state.createdAt, level: "info", code: "worker_log", message: first.root }];
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    await expect(first.clone().getStatus()).rejects.toThrow(/unsafe content/);

    const second = await harness("success");
    await second.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const secondCompleted = await waitForState(second.supervisor, "completed");
    await writeFile(path.join(second.root, secondCompleted.job!.jobId, "attempts/00000001/outputs/proposal.bin"), "tampered");
    await expect(second.clone().getStatus()).rejects.toThrow(/size|checksum/i);

    const oversized = await harness("success");
    await oversized.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const oversizedCompleted = await waitForState(oversized.supervisor, "completed");
    await writeFile(
      path.join(oversized.root, oversizedCompleted.job!.jobId, "state.json"),
      Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)
    );
    await expect(oversized.clone().getStatus()).rejects.toThrow(/oversized/);
  });

  it.each([
    ["missing attempt job", async (jobRoot: string) => rm(path.join(jobRoot, "attempts/00000001/job.json"))],
    ["corrupt attempt job", async (jobRoot: string) => writeFile(path.join(jobRoot, "attempts/00000001/job.json"), "{}\n")],
    ["missing result", async (jobRoot: string) => rm(path.join(jobRoot, "attempts/00000001/result.json"))],
    ["corrupt result", async (jobRoot: string) => writeFile(path.join(jobRoot, "attempts/00000001/result.json"), "{}\n")],
    ["invalid UTF-8 result", async (jobRoot: string) => writeFile(
      path.join(jobRoot, "attempts/00000001/result.json"), Buffer.from([0xff, 0xfe])
    )],
    ["missing immutable input", async (jobRoot: string) => rm(path.join(jobRoot, "inputs/handoff.json"))],
    ["corrupt immutable input", async (jobRoot: string) => writeFile(path.join(jobRoot, "inputs/handoff.json"), "tampered")],
    ["missing capability", async (jobRoot: string) => rm(path.join(jobRoot, "capability.json"))],
    ["invalid UTF-8 state", async (jobRoot: string) => writeFile(path.join(jobRoot, "state.json"), Buffer.from([0xff]))]
  ])("fails completed recovery for %s", async (_label, mutate) => {
    const current = await harness("success");
    await current.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const completed = await waitForState(current.supervisor, "completed");
    const jobRoot = path.join(current.root, completed.job!.jobId);
    await mutate(jobRoot);
    await expect(current.clone().getStatus()).rejects.toThrow();
  });

  it("rejects completed state summaries that differ from the canonical result", async () => {
    const current = await harness("success");
    await current.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const completed = await waitForState(current.supervisor, "completed");
    const statePath = path.join(current.root, completed.job!.jobId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.outputs[0].summary.sha256 = `sha256:${"0".repeat(64)}`;
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    await expect(current.clone().getStatus()).rejects.toThrow(/summaries differ/);
  });

  it.each(["queued", "running", "stopping"] as const)(
    "reconciles persisted %s state to interrupted and clears stale incoming output",
    async (state) => {
      const current = await harness("success");
      await current.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
      const completed = await waitForState(current.supervisor, "completed");
      const jobRoot = path.join(current.root, completed.job!.jobId);
      const statePath = path.join(jobRoot, "state.json");
      const stored = JSON.parse(await readFile(statePath, "utf8"));
      stored.state = state;
      stored.progress = state === "queued" ? null : 0.25;
      stored.outputs = [];
      stored.failure = null;
      stored.startedAt = state === "queued" ? null : stored.createdAt;
      stored.finishedAt = null;
      stored.updatedAt = stored.createdAt;
      await writeFile(statePath, `${JSON.stringify(stored)}\n`);
      await mkdir(path.join(jobRoot, ".incoming/stale"), { recursive: true });
      await writeFile(path.join(jobRoot, ".incoming/stale/partial.bin"), "partial");
      const recovered = await current.clone().getStatus();
      expect(recovered.job).toMatchObject({ state: "interrupted", failure: { code: "desktop_restart" } });
      expect(await readdir(path.join(jobRoot, ".incoming"))).toEqual([]);
    }
  );

  it("rejects invalid custom budgets and unusable requested output registrations", async () => {
    const root = await tempRoot("invalid-registration");
    const base: ReconstructionWorkerRegistration = {
      capability: capability(),
      label: "Invalid fixture",
      executable: process.execPath,
      args: [fixture, "--mode", "success"],
      jobKind: "fixture-proposal",
      requestedOutputs: ["point_cloud"]
    };
    for (const wallTime of [Number.NaN, -1, 1.5]) {
      expect(() => new ReconstructionWorkerSupervisor({
        root,
        registrations: [{
          ...base,
          budget: {
            wall_time_ms: wallTime,
            memory_bytes: 1024,
            output_bytes: 1024,
            log_bytes: 1024,
            max_output_artifacts: 1
          }
        }]
      })).toThrow(/positive safe integers/);
    }
    expect(() => new ReconstructionWorkerSupervisor({
      root,
      registrations: [{ ...base, requestedOutputs: ["point_cloud", "point_cloud"] }]
    })).toThrow(/do not match/);
    expect(() => new ReconstructionWorkerSupervisor({
      root,
      registrations: [{ ...base, requestedOutputs: ["mesh"] }]
    })).toThrow(/do not match/);
  });

  it("sanitizes supervisor errors and rejects non-executable registrations", async () => {
    const throwingSpawn: ReconstructionWorkerSpawn = (_executable, _args, options) => {
      throw new Error(`spawn failed at ${options.cwd}\nforged row`);
    };
    const failureHarness = await harness("success", undefined, 25, throwingSpawn);
    await failureHarness.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    const failed = await waitForState(failureHarness.supervisor, "failed");
    expect(failed.job?.failure?.message).not.toContain(failureHarness.root);
    expect(failed.job?.failure?.message).not.toContain("\n");

    const nonExecutable = await tempRoot("non-executable");
    const executable = path.join(nonExecutable, "worker");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o600);
    const invalid = await harness("success", undefined, 25, undefined, executable);
    await invalid.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await expect(waitForState(invalid.supervisor, "failed")).resolves.toMatchObject({
      job: { failure: { code: "supervisor_error" } }
    });
  });

  it("fails closed without an unhandled rejection when an injected test child cannot be signalled", async () => {
    const signalFailureSpawn: ReconstructionWorkerSpawn = () => {
      const emitter = new EventEmitter();
      const child = Object.assign(emitter, {
        pid: 999_999,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => { throw new Error("injected signal failure"); }
      }) as ReconstructionWorkerChildProcess;
      setTimeout(() => emitter.emit("close", 0, null), 80);
      return child;
    };
    const current = await harness("success", { wall_time_ms: 30 }, 10, signalFailureSpawn);
    await current.supervisor.start({ workerId: "fixture-worker", sessionId: "session-1" });
    await expect(waitForState(current.supervisor, "timed_out")).resolves.toMatchObject({
      job: { failure: { code: "timeout" }, outputs: [] }
    });
  });
});

async function harness(
  mode: string,
  budgetOverride: Partial<ReconstructionWorkerRegistration["budget"]> = {},
  terminationGraceMs = 50,
  spawnProcess?: ReconstructionWorkerSpawn,
  executable = process.execPath
) {
  const root = await tempRoot(mode);
  const budget = {
    wall_time_ms: 2_000,
    memory_bytes: 64 * 1024 * 1024,
    output_bytes: 1024 * 1024,
    log_bytes: 32 * 1024,
    max_output_artifacts: 4,
    ...budgetOverride
  };
  const registration: ReconstructionWorkerRegistration = {
    capability: capability(),
    label: "Deterministic fixture",
    executable,
    args: [fixture, "--mode", mode],
    jobKind: "fixture-proposal",
    requestedOutputs: ["point_cloud"],
    budget
  };
  let ids = 0;
  const options = {
    root,
    registrations: [registration],
    inputStager: stager(),
    randomId: () => (++ids).toString(36).padStart(22, "0"),
    terminationGraceMs,
    ...(spawnProcess ? { spawnProcess, processGroupMode: "direct-test-only" as const } : {})
  };
  return {
    root,
    supervisor: new ReconstructionWorkerSupervisor(options),
    clone: () => new ReconstructionWorkerSupervisor(options)
  };
}

function capability(): ReconstructionWorkerRegistration["capability"] {
  return {
    schema: "world_studio.reconstruction_worker_capability.v0.1",
    worker_id: "fixture-worker",
    reported_at: "2026-08-09T00:00:00.000Z",
    protocol: { name: "world_studio.reconstruction_worker", version: "0.1" },
    implementation: { id: "fixture", version: "0.1.0", build_sha256: null },
    operations: [{
      job_kind: "fixture-proposal",
      inputs: [{ role: "capture_handoff", media_types: ["application/json"] }],
      outputs: [{ role: "point_cloud", media_types: ["application/octet-stream"], progressive: true }]
    }],
    limits: {
      max_input_artifacts: 8,
      max_input_bytes: 1024 * 1024,
      max_output_artifacts: 8,
      max_output_bytes: 2 * 1024 * 1024,
      max_wall_time_ms: 5_000,
      max_memory_bytes: 128 * 1024 * 1024,
      max_log_bytes: 64 * 1024,
      max_parallel_jobs: 1
    },
    authority: "proposal_only"
  };
}

function stager() {
  return {
    async stage(input: { sessionId: string; destinationRoot: string }) {
      const bytes = Buffer.from('{"capture":"fixture"}\n', "utf8");
      await writeFile(path.join(input.destinationRoot, "inputs/handoff.json"), bytes);
      const inputs = [{
        role: "capture_handoff",
        path: "inputs/handoff.json",
        sha256: hash(bytes),
        size_bytes: bytes.byteLength,
        media_type: "application/json"
      }];
      return {
        source: {
          session_id: input.sessionId,
          live_session_schema: "capture_splat.live_session.v0.1" as const,
          final_sequence_id: 1
        },
        inputs,
        summary: {
          sessionId: input.sessionId,
          throughSequenceId: 1,
          frameCount: 1,
          manifestSha256: hash(stableReconstructionJson(inputs))
        }
      };
    }
  };
}

async function waitForState(supervisor: ReconstructionWorkerSupervisor, state: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = await supervisor.getStatus();
    if (snapshot.state === state) return snapshot;
    if (["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(snapshot.state)) {
      throw new Error(`Expected ${state}, reached ${snapshot.state}: ${snapshot.job?.failure?.message ?? "no failure"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${state}.`);
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await lstat(filePath);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for descendant marker.");
}

async function waitForProcessExit(pid: number): Promise<void> {
  expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Descendant process ${pid} remained alive.`);
}

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-worker-${label}-`));
  roots.push(root);
  return root;
}

function hash(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
