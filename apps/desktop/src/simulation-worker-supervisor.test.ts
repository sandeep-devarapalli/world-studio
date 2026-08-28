import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  SimulationWorkerSupervisor,
  type SimulationWorkerRegistration,
  type SimulationWorkerSupervisorOptions
} from "./simulation-worker-supervisor.js";
import { writeSuperDexScenePackageFixture } from "../test-fixtures/superdex-scene-package-fixture.js";

const fixture = fileURLToPath(new URL("../test-fixtures/simulation-worker-fixture.mjs", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SimulationWorkerSupervisor", () => {
  it("is unavailable until an owner-configured worker is registered", async () => {
    const supervisor = new SimulationWorkerSupervisor({ root: await tempRoot("empty") });
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      state: "unavailable",
      workers: [],
      run: null,
      authority: "software_capability_only"
    });
    await expect(supervisor.start({ workerId: "missing" })).rejects.toThrow(/not registered/);
  });

  it("commits only a strict checksum-bound capability and contact/reset report", async () => {
    const current = await harness("success");
    const started = await current.supervisor.start({ workerId: "superdex-local" });
    expect(started.state).toBe("queued");
    const completed = await waitForState(current.supervisor, "completed");
    expect(completed.run).toMatchObject({
      workerId: "superdex-local",
      backendId: "superdex",
      attempt: 1,
      capability: { backend_id: "superdex", backend_version: "1.0.0" },
      evidence: {
        fixtureId: "synthetic-rigid-contact-reset-v1",
        repetitions: 3,
        framesPerRepetition: 180,
        firstContactFrame: 20,
        maxContactPoints: 6,
        maxResetResidual: 0
      },
      authority: "software_capability_only"
    });
    const report = await readFile(path.join(
      current.root,
      completed.run!.runId,
      "attempts/00000001/report.json"
    ));
    expect(completed.run?.reportSha256).toBe(hash(report));
    expect(completed.run?.reportSizeBytes).toBe(report.byteLength);
    expect(await readdir(path.join(current.root, completed.run!.runId, ".incoming"))).toEqual([]);
    await expect(current.clone().getStatus()).resolves.toMatchObject({ state: "completed" });
  });

  it("captures bounded sanitized logs without exposing the private run root", async () => {
    const current = await harness("logs");
    await current.supervisor.start({ workerId: "superdex-local" });
    const completed = await waitForState(current.supervisor, "completed");
    expect(completed.run?.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ stream: "stdout", message: "fixture stdout" }),
      expect.objectContaining({ stream: "stderr", message: "fixture stderr" })
    ]));
    expect(JSON.stringify(completed.run?.logs)).not.toContain(current.root);
  });

  it.each([
    ["malformed", /unexpected fields|schema/i],
    ["extra-output", /undeclared output/i],
    ["nonzero-pass", /exit status/i]
  ])("fails closed for %s", async (mode, message) => {
    const current = await harness(mode);
    await current.supervisor.start({ workerId: "superdex-local" });
    const failed = await waitForState(current.supervisor, "failed");
    expect(failed.run?.failure?.message).toMatch(message);
    expect(failed.run?.capability).toBeNull();
  });

  it("marks a runtime unavailable from its strict report and prevents blind retry", async () => {
    const current = await harness("unavailable");
    await current.supervisor.start({ workerId: "superdex-local" });
    const failed = await waitForState(current.supervisor, "failed");
    expect(failed.run?.failure).toMatchObject({ code: "worker_unavailable", retryable: false });
    expect(failed.workers[0]).toMatchObject({ available: false, unavailableReason: "Pinned SuperDex packages are unavailable." });
    await expect(current.supervisor.retry({ runId: failed.run!.runId })).rejects.toThrow(/not retryable/);
    const statePath = path.join(current.root, failed.run!.runId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.failure.message = "forged failure";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await expect(current.clone().getStatus()).rejects.toThrow(/failure differs/);
  });

  it("bounds timeout, cancellation, and log output", async () => {
    const timed = await harness("hang", { maxWallTimeMs: 60 });
    await timed.supervisor.start({ workerId: "superdex-local" });
    await expect(waitForState(timed.supervisor, "timed_out")).resolves.toMatchObject({
      run: { failure: { code: "timeout" } }
    });

    const cancelled = await harness("hang", { maxWallTimeMs: 2_000 });
    const started = await cancelled.supervisor.start({ workerId: "superdex-local" });
    await expect(cancelled.supervisor.stop({ runId: started.run!.runId })).resolves.toMatchObject({ state: "cancelled" });

    const noisy = await harness("oversized-log", { maxLogBytes: 1_024 });
    await noisy.supervisor.start({ workerId: "superdex-local" });
    await expect(waitForState(noisy.supervisor, "failed")).resolves.toMatchObject({
      run: { failure: { code: "log_budget" } }
    });
  });

  it("kills an uncooperative descendant in the isolated worker process group", async () => {
    const current = await harness("descendant-hang", { maxWallTimeMs: 200 });
    const started = await current.supervisor.start({ workerId: "superdex-local" });
    const marker = path.join(current.root, started.run!.runId, "descendant.pid");
    const descendantPid = Number(await waitForFile(marker));
    await expect(waitForState(current.supervisor, "timed_out")).resolves.toMatchObject({
      run: { failure: { code: "timeout" } }
    });
    await expectProcessExit(descendantPid);
  });

  it("retries the same durable run as a new attempt", async () => {
    const current = await harness("fail-once");
    const started = await current.supervisor.start({ workerId: "superdex-local" });
    const failed = await waitForState(current.supervisor, "failed");
    expect(failed.run?.attempt).toBe(1);
    const retried = await current.supervisor.retry({ runId: started.run!.runId });
    expect(retried.run?.attempt).toBe(2);
    const completed = await waitForState(current.supervisor, "completed");
    expect(completed.run?.attempt).toBe(2);
    expect(await readFile(path.join(current.root, completed.run!.runId, "attempts/00000002/report.json"), "utf8"))
      .toContain("world_studio.superdex_worker_probe.v0.1");
  });

  it("reconciles active durable state to interrupted after desktop restart", async () => {
    const current = await harness("success");
    await current.supervisor.start({ workerId: "superdex-local" });
    const completed = await waitForState(current.supervisor, "completed");
    const statePath = path.join(current.root, completed.run!.runId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.state = "running";
    state.reportSha256 = null;
    state.reportSizeBytes = null;
    state.capability = null;
    state.evidence = null;
    state.failure = null;
    state.finishedAt = null;
    state.updatedAt = state.startedAt;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await expect(current.clone().getStatus()).resolves.toMatchObject({
      state: "interrupted",
      run: { failure: { code: "desktop_restart", retryable: true } }
    });
  });

  it("terminates a token-matched live worker process group before restart reconciliation", async () => {
    const current = await harness("success");
    await current.supervisor.start({ workerId: "superdex-local" });
    const completed = await waitForState(current.supervisor, "completed");
    const runRoot = path.join(current.root, completed.run!.runId);
    const statePath = path.join(runRoot, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const child = spawn(process.execPath, [
      fixture,
      "--mode", "hang",
      "--output", path.join(runRoot, ".incoming/recovered-report.json"),
      "--supervisor-token", state.recoveryToken,
    ], { cwd: runRoot, detached: true, stdio: "ignore" });
    if (!child.pid) throw new Error("Recovery fixture did not expose a process-group ID.");
    state.state = "running";
    state.processGroupId = child.pid;
    state.reportSha256 = null;
    state.reportSizeBytes = null;
    state.capability = null;
    state.evidence = null;
    state.failure = null;
    state.finishedAt = null;
    state.updatedAt = state.startedAt;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const command = `${process.execPath} ${fixture} --supervisor-token ${state.recoveryToken}`;
    try {
      await expect(current.clone({
        listProcesses: async () => [{ pid: child.pid!, processGroupId: child.pid!, command }],
      }).getStatus()).resolves.toMatchObject({
        state: "interrupted",
        run: { failure: { code: "desktop_restart", retryable: true } },
      });
      await expectProcessExit(child.pid);
    } finally {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
  });

  it("fails closed when restart state cannot identify a retained descendant process group", async () => {
    const current = await harness("success");
    await current.supervisor.start({ workerId: "superdex-local" });
    const completed = await waitForState(current.supervisor, "completed");
    const statePath = path.join(current.root, completed.run!.runId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.state = "running";
    state.processGroupId = 424_242;
    state.reportSha256 = null;
    state.reportSizeBytes = null;
    state.capability = null;
    state.evidence = null;
    state.failure = null;
    state.finishedAt = null;
    state.updatedAt = state.startedAt;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await expect(current.clone({
      listProcesses: async () => [{ pid: 424_243, processGroupId: 424_242, command: "surviving-descendant" }],
    }).getStatus()).rejects.toThrow(/could not be matched to its recovery token/);
  });

  it("fails closed instead of retrying an active legacy run without recovery identity", async () => {
    const current = await harness("success");
    await current.supervisor.start({ workerId: "superdex-local" });
    const completed = await waitForState(current.supervisor, "completed");
    const statePath = path.join(current.root, completed.run!.runId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.schema = "world_studio.simulation_worker_run_store.v0.1";
    delete state.job;
    delete state.recoveryToken;
    delete state.processGroupId;
    state.state = "running";
    state.reportSha256 = null;
    state.reportSizeBytes = null;
    state.capability = null;
    state.evidence = null;
    state.failure = null;
    state.finishedAt = null;
    state.updatedAt = state.startedAt;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await expect(current.clone().getStatus()).rejects.toThrow(/legacy active simulation run cannot be recovered safely/);
  });

  it("loads a registered compiled scene and commits a checksum-bound contact/reset receipt", async () => {
    const current = await harness("success", {}, true);
    const started = await current.supervisor.startSceneJob({
      workerId: "superdex-local",
      sceneJobId: "table-contact-v1"
    });
    expect(started.run?.job).toMatchObject({
      kind: "scene_contact_reset",
      sceneJobId: "table-contact-v1",
      packageId: "superdex-package-v1"
    });
    const completed = await waitForState(current.supervisor, "completed");
    expect(completed.run).toMatchObject({
      evidence: {
        jobKind: "scene_contact_reset",
        fixtureId: "compiled-scene-contact-reset-v1",
        packageId: "superdex-package-v1",
        repetitions: 3,
        firstContactFrame: 20,
        maxResetResidual: 0
      },
      authority: "software_capability_only"
    });
    const attemptRoot = path.join(current.root, completed.run!.runId, "attempts/00000001");
    expect(JSON.parse(await readFile(path.join(attemptRoot, "report.json"), "utf8"))).toMatchObject({
      schema: "world_studio.superdex_scene_job_receipt.v0.1",
      authority: "compiled_scene_execution_only"
    });
    expect(await readdir(path.join(attemptRoot, "input"))).toEqual(["job.json"]);
    await expect(current.clone().getStatus()).resolves.toMatchObject({
      state: "completed",
      run: { job: { kind: "scene_contact_reset", sceneJobId: "table-contact-v1" } }
    });
  });

  it("bounds compiled-scene timeout and cancellation without falling back to the probe", async () => {
    const timed = await harness("hang", { maxWallTimeMs: 60 }, true);
    await timed.supervisor.startSceneJob({ workerId: "superdex-local", sceneJobId: "table-contact-v1" });
    await expect(waitForState(timed.supervisor, "timed_out")).resolves.toMatchObject({
      run: {
        job: { kind: "scene_contact_reset" },
        failure: { code: "timeout" },
        evidence: null
      }
    });

    const cancelled = await harness("hang", { maxWallTimeMs: 2_000 }, true);
    const started = await cancelled.supervisor.startSceneJob({
      workerId: "superdex-local",
      sceneJobId: "table-contact-v1"
    });
    await expect(cancelled.supervisor.stop({ runId: started.run!.runId })).resolves.toMatchObject({
      state: "cancelled",
      run: { job: { kind: "scene_contact_reset" }, evidence: null }
    });
  });

  it("retries and restart-reconciles the same durable compiled-scene job identity", async () => {
    const retrying = await harness("scene-fail-once", {}, true);
    const started = await retrying.supervisor.startSceneJob({
      workerId: "superdex-local",
      sceneJobId: "table-contact-v1"
    });
    const failed = await waitForState(retrying.supervisor, "failed");
    expect(failed.run?.failure).toMatchObject({ code: "runtime_failure", retryable: true });
    await expect(retrying.clone({
      sceneJobs: [{
        ...retrying.sceneJob!,
        probeInitialPositionM: [0, 2, 0],
      }],
    }).retry({ runId: started.run!.runId })).rejects.toThrow(/durable run identity/);
    await retrying.supervisor.retry({ runId: started.run!.runId });
    await expect(waitForState(retrying.supervisor, "completed")).resolves.toMatchObject({
      run: { attempt: 2, job: { sceneJobId: "table-contact-v1" } }
    });

    const restarting = await harness("success", {}, true);
    await restarting.supervisor.startSceneJob({ workerId: "superdex-local", sceneJobId: "table-contact-v1" });
    const completed = await waitForState(restarting.supervisor, "completed");
    const statePath = path.join(restarting.root, completed.run!.runId, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.state = "running";
    state.reportSha256 = null;
    state.reportSizeBytes = null;
    state.capability = null;
    state.evidence = null;
    state.failure = null;
    state.finishedAt = null;
    state.updatedAt = state.startedAt;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await expect(restarting.clone().getStatus()).resolves.toMatchObject({
      state: "interrupted",
      run: {
        job: { kind: "scene_contact_reset", sceneJobId: "table-contact-v1" },
        failure: { code: "desktop_restart", retryable: true }
      }
    });
  });
});

async function harness(
  mode: string,
  budgetOverride: Partial<SimulationWorkerRegistration["budget"]> = {},
  includeSceneJob = false
) {
  const root = await tempRoot(mode);
  const scene = includeSceneJob
    ? await writeSuperDexScenePackageFixture(await tempRoot(`${mode}-scene-package`))
    : null;
  const registration: SimulationWorkerRegistration = {
    workerId: "superdex-local",
    backendId: "superdex",
    label: "SuperDex 1.0.0 local",
    executable: process.execPath,
    scriptPath: fixture,
    args: ["--mode", mode],
    budget: {
      maxWallTimeMs: 2_000,
      maxReportBytes: 1024 * 1024,
      maxLogBytes: 32 * 1024,
      ...budgetOverride
    }
  };
  let ids = 0;
  const options = {
    root,
    registrations: [registration],
    sceneJobs: scene ? [scene.registration] : [],
    randomId: () => (++ids).toString(36).padStart(22, "0"),
    listProcesses: async () => [],
    terminationGraceMs: 30
  };
  return {
    root,
    sceneJob: scene?.registration ?? null,
    supervisor: new SimulationWorkerSupervisor(options),
    clone: (overrides: Pick<SimulationWorkerSupervisorOptions, "sceneJobs" | "listProcesses"> = {}) => (
      new SimulationWorkerSupervisor({ ...options, ...overrides })
    )
  };
}

async function waitForState(supervisor: SimulationWorkerSupervisor, state: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = await supervisor.getStatus();
    if (snapshot.state === state) return snapshot;
    if (["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(snapshot.state)) {
      throw new Error(`Expected ${state}, reached ${snapshot.state}: ${snapshot.run?.failure?.message ?? "no failure"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${state}.`);
}

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-simulation-worker-${label}-`));
  roots.push(root);
  return root;
}

async function waitForFile(filePath: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const value = await readFile(filePath, "utf8");
      if (value.trim()) return value;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for descendant marker.");
}

async function expectProcessExit(pid: number): Promise<void> {
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

function hash(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
