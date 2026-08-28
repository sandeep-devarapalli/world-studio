import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  SimulationWorkerSupervisor,
  type SimulationWorkerRegistration
} from "./simulation-worker-supervisor.js";

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
});

async function harness(mode: string, budgetOverride: Partial<SimulationWorkerRegistration["budget"]> = {}) {
  const root = await tempRoot(mode);
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
    randomId: () => (++ids).toString(36).padStart(22, "0"),
    terminationGraceMs: 30
  };
  return {
    root,
    supervisor: new SimulationWorkerSupervisor(options),
    clone: () => new SimulationWorkerSupervisor(options)
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
      return await readFile(filePath, "utf8");
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
