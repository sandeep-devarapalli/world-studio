import type {
  SimulationBackendCapabilityV1,
  SimulationWorkerBudget,
  SimulationWorkerEvidenceSummary,
  SimulationWorkerJobSummary,
  SimulationWorkerLogSummary,
  SimulationWorkerRunSummary,
  SimulationWorkerSnapshot,
  SimulationWorkerState,
  SimulationWorkerSummary
} from "@world-studio/world-core";
import {
  parseCanonicalGraphJson,
  stableCanonicalJson,
  validateSuperDexSceneJobReceipt,
  validateSuperDexSceneJobRequest,
  validateSuperDexWorkerProbe,
  type SuperDexSceneJobRequestV1
} from "@world-studio/world-core";
import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify, TextDecoder } from "node:util";
import {
  stageSuperDexSceneJob,
  validateSuperDexSceneJobRegistration,
  type PreparedSuperDexSceneJob,
  type SuperDexSceneJobRegistration
} from "./superdex-scene-job.js";

const storeSchema = "world_studio.simulation_worker_run_store.v0.2";
const legacyStoreSchema = "world_studio.simulation_worker_run_store.v0.1";
const runIdPattern = /^swr_[A-Za-z0-9_-]{22}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const maxStateBytes = 2 * 1024 * 1024;
const maxSnapshotLogs = 16;
const maxStoredRuns = 1_024;
const defaultTerminationGraceMs = 2_000;
const defaultBudget: SimulationWorkerBudget = {
  maxWallTimeMs: 60_000,
  maxReportBytes: 2 * 1024 * 1024,
  maxLogBytes: 64 * 1024
};
const execFileAsync = promisify(execFile);

type BackendId = SimulationWorkerSummary["backendId"];
type RunFailure = NonNullable<SimulationWorkerRunSummary["failure"]>;
type StoredState = Exclude<SimulationWorkerState, "unavailable" | "idle">;

export interface SimulationWorkerRegistration {
  workerId: string;
  backendId: BackendId;
  label: string;
  executable: string;
  scriptPath: string;
  args?: readonly string[];
  budget?: SimulationWorkerBudget;
}

export interface SimulationWorkerSupervisorOptions {
  root: string;
  registrations?: readonly SimulationWorkerRegistration[];
  sceneJobs?: readonly SuperDexSceneJobRegistration[];
  now?: () => Date;
  randomId?: () => string;
  spawnProcess?: SimulationWorkerSpawn;
  listProcesses?: SimulationWorkerProcessTable;
  processGroupMode?: "isolated" | "direct-test-only";
  terminationGraceMs?: number;
}

export interface SimulationWorkerProcessInfo {
  pid: number;
  processGroupId: number;
  command: string;
}

export type SimulationWorkerProcessTable = () => Promise<readonly SimulationWorkerProcessInfo[]>;

export type SimulationWorkerSpawn = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean }
) => ChildProcessWithoutNullStreams;

interface RegisteredWorker {
  registration: SimulationWorkerRegistration;
  summary: SimulationWorkerSummary;
}

interface StoredRun {
  schema: typeof storeSchema;
  authority: "software_capability_only";
  runId: string;
  workerId: string;
  backendId: BackendId;
  job: SimulationWorkerJobSummary;
  recoveryToken: string | null;
  processGroupId: number | null;
  attempt: number;
  state: StoredState;
  budget: SimulationWorkerBudget;
  reportSha256: string | null;
  reportSizeBytes: number | null;
  capability: SimulationBackendCapabilityV1 | null;
  evidence: SimulationWorkerEvidenceSummary | null;
  logs: SimulationWorkerLogSummary[];
  failure: RunFailure | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

interface NormalizedReport {
  status: "passed" | "unavailable" | "failed";
  capability: SimulationBackendCapabilityV1 | null;
  evidence: SimulationWorkerEvidenceSummary | null;
  failure: { code: string; message: string } | null;
}

interface SceneJobExpectation {
  request: SuperDexSceneJobRequestV1;
  requestSha256: string;
}

interface ActiveAttempt {
  runId: string;
  attempt: number;
  child: ChildProcessWithoutNullStreams;
  processGroupId: number | null;
  intent: "running" | "cancelled" | "timed_out" | "failed";
  failure: RunFailure | null;
  killTimer: ReturnType<typeof setTimeout> | null;
  done: Promise<void>;
  finishDone: () => void;
}

interface PendingAttempt {
  runId: string;
  attempt: number;
  cancelled: boolean;
  done: Promise<void>;
  finishDone: () => void;
}

class StagingHalt extends Error {
  constructor(readonly state: "cancelled" | "timed_out") {
    super(state === "cancelled" ? "Simulation worker staging was cancelled." : "Simulation worker staging exceeded its wall-time budget.");
  }
}

export class SimulationWorkerSupervisor {
  readonly root: string;
  private readonly workers = new Map<string, RegisteredWorker>();
  private readonly sceneJobs = new Map<string, SuperDexSceneJobRegistration>();
  private readonly runs = new Map<string, StoredRun>();
  private readonly listeners = new Set<(snapshot: SimulationWorkerSnapshot) => void>();
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly spawnProcess: SimulationWorkerSpawn;
  private readonly listProcesses: SimulationWorkerProcessTable;
  private readonly processGroupMode: "isolated" | "direct-test-only";
  private readonly terminationGraceMs: number;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private operation = Promise.resolve();
  private latestRunId: string | null = null;
  private pending: PendingAttempt | null = null;
  private active: ActiveAttempt | null = null;

  constructor(options: SimulationWorkerSupervisorOptions) {
    if (!path.isAbsolute(options.root)) throw new Error("Simulation worker root must be absolute.");
    this.root = path.resolve(options.root);
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => randomBytes(16).toString("base64url"));
    this.processGroupMode = options.processGroupMode ?? "isolated";
    this.terminationGraceMs = positiveInteger(
      options.terminationGraceMs ?? defaultTerminationGraceMs,
      "termination grace"
    );
    this.spawnProcess = options.spawnProcess ?? ((executable, args, spawnOptions) => spawn(executable, args, {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"]
    }));
    this.listProcesses = options.listProcesses ?? processTable;
    for (const registration of options.registrations ?? []) this.register(registration);
    for (const sceneJob of options.sceneJobs ?? []) this.registerSceneJob(sceneJob);
  }

  async getStatus(): Promise<SimulationWorkerSnapshot> {
    await this.initialize();
    return this.snapshot();
  }

  async start(input: { workerId: string }): Promise<SimulationWorkerSnapshot> {
    return this.startRun(input.workerId, { kind: "capability_probe" });
  }

  async startSceneJob(input: { workerId: string; sceneJobId: string }): Promise<SimulationWorkerSnapshot> {
    assertIdentifier(input.sceneJobId, "SuperDex scene job ID");
    const sceneJob = this.requireSceneJob(input.sceneJobId);
    return this.startRun(input.workerId, {
      kind: "scene_contact_reset",
      sceneJobId: sceneJob.sceneJobId,
      packageId: sceneJob.packageId,
      packageManifestSha256: sceneJob.packageManifestSha256,
      targetActorName: sceneJob.targetActorName,
      probeInitialPositionM: [...sceneJob.probeInitialPositionM]
    });
  }

  private async startRun(workerId: string, job: SimulationWorkerJobSummary): Promise<SimulationWorkerSnapshot> {
    return this.serialized(async () => {
      await this.initialize();
      if (this.active || this.pending) throw new Error("A simulation worker run is already active.");
      if (this.runs.size >= maxStoredRuns) throw new Error("Simulation worker run storage reached its bounded limit.");
      assertIdentifier(workerId, "Simulation worker ID");
      const worker = this.requireWorker(workerId);
      if (!worker.summary.available) throw new Error(worker.summary.unavailableReason ?? "Simulation worker is unavailable.");
      const runId = `swr_${this.randomId()}`;
      assertRunId(runId);
      const runRoot = path.join(this.root, runId);
      const publicationRoot = path.join(this.root, `.creating-${runId}`);
      const now = this.timestamp();
      const run: StoredRun = {
        schema: storeSchema,
        authority: "software_capability_only",
        runId,
        workerId: worker.summary.workerId,
        backendId: worker.summary.backendId,
        job: structuredClone(job),
        recoveryToken: randomBytes(16).toString("base64url"),
        processGroupId: null,
        attempt: 1,
        state: "queued",
        budget: { ...worker.summary.budget },
        reportSha256: null,
        reportSizeBytes: null,
        capability: null,
        evidence: null,
        logs: [],
        failure: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        updatedAt: now
      };
      await rm(publicationRoot, { recursive: true, force: true });
      await mkdir(path.join(publicationRoot, "attempts"), { recursive: true, mode: 0o700 });
      await mkdir(path.join(publicationRoot, ".incoming"), { mode: 0o700 });
      await writeAtomicJson(path.join(publicationRoot, "state.json"), run);
      await rename(publicationRoot, runRoot);
      this.runs.set(runId, run);
      this.latestRunId = runId;
      this.pending = pendingAttempt(runId, 1);
      this.emit();
      void this.runAttempt(runId, worker);
      return this.snapshot();
    });
  }

  async stop(input: { runId: string }): Promise<SimulationWorkerSnapshot> {
    assertRunId(input.runId);
    let done: Promise<void> | null = null;
    await this.serialized(async () => {
      await this.initialize();
      const run = this.requireRun(input.runId);
      if (this.pending?.runId === input.runId) {
        this.pending.cancelled = true;
        done = this.pending.done;
        await this.finish(run, "cancelled", failure("cancelled", "The simulation worker was stopped before launch.", true));
        return;
      }
      if (!this.active || this.active.runId !== input.runId) {
        if (["queued", "starting"].includes(run.state)) {
          await this.finish(run, "cancelled", failure("cancelled", "The simulation worker was stopped before launch.", true));
        }
        return;
      }
      if (this.active.intent === "running") {
        run.state = "stopping";
        run.updatedAt = this.timestamp();
        await this.persist(run);
        this.emit();
        this.terminate(this.active, "cancelled", failure("cancelled", "The simulation worker was stopped by the user.", true));
      }
      done = this.active.done;
    });
    if (done) await done;
    return this.serialized(async () => {
      const run = this.requireRun(input.runId);
      if (["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(run.state)) {
        await this.persist(run);
      }
      return this.snapshot();
    });
  }

  async retry(input: { runId: string }): Promise<SimulationWorkerSnapshot> {
    return this.serialized(async () => {
      await this.initialize();
      if (this.active || this.pending) throw new Error("A simulation worker run is already active.");
      assertRunId(input.runId);
      const run = this.requireRun(input.runId);
      if (!["failed", "cancelled", "timed_out", "interrupted"].includes(run.state)) {
        throw new Error("Only failed, cancelled, timed-out, or interrupted simulation runs can be retried.");
      }
      if (run.failure && !run.failure.retryable) throw new Error("This simulation worker failure is not retryable.");
      const worker = this.requireWorker(run.workerId);
      if (!worker.summary.available) throw new Error(worker.summary.unavailableReason ?? "Simulation worker is unavailable.");
      if (run.job.kind === "scene_contact_reset") this.requireMatchingSceneJob(run.job);
      run.attempt += 1;
      run.recoveryToken = randomBytes(16).toString("base64url");
      run.processGroupId = null;
      run.state = "queued";
      run.reportSha256 = null;
      run.reportSizeBytes = null;
      run.capability = null;
      run.evidence = null;
      run.logs = [];
      run.failure = null;
      run.startedAt = null;
      run.finishedAt = null;
      run.updatedAt = this.timestamp();
      await this.persist(run);
      this.pending = pendingAttempt(run.runId, run.attempt);
      this.latestRunId = run.runId;
      this.emit();
      void this.runAttempt(run.runId, worker);
      return this.snapshot();
    });
  }

  subscribe(listener: (snapshot: SimulationWorkerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stopAll(): Promise<void> {
    const runId = this.active?.runId ?? this.pending?.runId;
    if (runId) await this.stop({ runId });
  }

  private register(registration: SimulationWorkerRegistration): void {
    assertIdentifier(registration.workerId, "Registered simulation worker ID");
    if (this.workers.has(registration.workerId)) throw new Error(`Duplicate simulation worker ID: ${registration.workerId}.`);
    if (registration.backendId !== "superdex") throw new Error("Only the SuperDex worker adapter is registered in v0.1.");
    if (!registration.label.trim() || registration.label.length > 128) throw new Error("Simulation worker label is invalid.");
    if (!path.isAbsolute(registration.executable) || !path.isAbsolute(registration.scriptPath)) {
      throw new Error("Simulation worker executable and script paths must be absolute.");
    }
    if ((registration.args ?? []).some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
      throw new Error("Simulation worker arguments are invalid.");
    }
    const budget = validateBudget(registration.budget ?? defaultBudget);
    const summary: SimulationWorkerSummary = {
      workerId: registration.workerId,
      backendId: registration.backendId,
      label: registration.label,
      available: true,
      unavailableReason: null,
      budget
    };
    this.workers.set(registration.workerId, { registration: { ...registration, budget }, summary });
  }

  private registerSceneJob(value: SuperDexSceneJobRegistration): void {
    const registration = validateSuperDexSceneJobRegistration(value);
    if (this.sceneJobs.has(registration.sceneJobId)) {
      throw new Error(`Duplicate SuperDex scene job ID: ${registration.sceneJobId}.`);
    }
    this.sceneJobs.set(registration.sceneJobId, registration);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initialization) this.initialization = this.initializeFromDisk().then(() => { this.initialized = true; });
    await this.initialization;
  }

  private async initializeFromDisk(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await assertRealDirectory(this.root, "Simulation worker root");
    const entries = await readdir(this.root, { withFileTypes: true });
    if (entries.filter((entry) => !entry.name.startsWith(".")).length > maxStoredRuns) {
      throw new Error("Simulation worker run storage exceeds its bounded limit.");
    }
    for (const entry of entries) {
      const entryPath = path.join(this.root, entry.name);
      if (entry.name.startsWith(".creating-")) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Invalid stale simulation publication.");
        await rm(entryPath, { recursive: true });
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      assertRunId(entry.name);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Simulation worker root contains an invalid entry.");
      const run = decodeStoredRun(await readBoundedJson(path.join(entryPath, "state.json"), maxStateBytes));
      if (run.runId !== entry.name) throw new Error("Simulation run directory and state IDs differ.");
      await rm(path.join(entryPath, ".incoming"), { recursive: true, force: true });
      await mkdir(path.join(entryPath, ".incoming"), { mode: 0o700 });
      const interrupted = ["queued", "starting", "running", "stopping"].includes(run.state);
      const retainedProcessGroup = run.processGroupId !== null;
      if (interrupted || retainedProcessGroup) {
        await this.recoverInterruptedProcess(run);
        run.processGroupId = null;
      }
      if (interrupted) {
        run.state = "interrupted";
        run.failure = failure("desktop_restart", "The desktop restarted before the simulation probe finalized.", true);
        run.finishedAt = this.timestamp();
        run.updatedAt = run.finishedAt;
        await this.persist(run);
      } else {
        if (retainedProcessGroup) await this.persist(run);
        if (run.reportSha256) await this.verifyCommittedReport(run);
      }
      this.runs.set(run.runId, run);
      if (!this.latestRunId || run.updatedAt > this.requireRun(this.latestRunId).updatedAt) this.latestRunId = run.runId;
      if (run.failure?.code === "worker_unavailable") this.markUnavailable(run.workerId, run.failure.message);
    }
  }

  private async runAttempt(runId: string, worker: RegisteredWorker): Promise<void> {
    const run = this.requireRun(runId);
    const pending = this.pending?.runId === runId && this.pending.attempt === run.attempt ? this.pending : null;
    const runRoot = path.join(this.root, runId);
    const attemptName = String(run.attempt).padStart(8, "0");
    const attemptRoot = path.join(runRoot, "attempts", attemptName);
    const incomingRoot = path.join(runRoot, ".incoming", attemptName);
    const wallDeadlineMs = Date.now() + run.budget.maxWallTimeMs;
    let active: ActiveAttempt | null = null;
    let preparedSceneJob: PreparedSuperDexSceneJob | null = null;
    try {
      if (!this.pendingMatches(run)) return;
      await mkdir(attemptRoot, { mode: 0o700 });
      await mkdir(incomingRoot, { mode: 0o700 });
      if (!this.pendingMatches(run)) return;
      run.state = "starting";
      run.startedAt = this.timestamp();
      run.updatedAt = run.startedAt;
      await this.persist(run);
      this.emit();
      if (!this.pendingMatches(run)) return;
      await assertExecutable(worker.registration.executable);
      await assertRegisteredScript(worker.registration.scriptPath);
      if (!this.pendingMatches(run)) return;
      if (!run.recoveryToken) throw new Error("Simulation worker run lacks a recovery token.");
      const workerArgs = [
        worker.registration.scriptPath,
        ...(worker.registration.args ?? []),
        "--supervisor-token",
        run.recoveryToken
      ];
      if (run.job.kind === "scene_contact_reset") {
        preparedSceneJob = await stageSuperDexSceneJob(
          this.requireMatchingSceneJob(run.job),
          attemptRoot,
          () => {
            if (!this.pendingMatches(run)) throw new StagingHalt("cancelled");
            if (Date.now() >= wallDeadlineMs) throw new StagingHalt("timed_out");
          }
        );
        workerArgs.push(
          "--job-file", privateRelativePath(runRoot, preparedSceneJob.requestPath),
          "--package-root", privateRelativePath(runRoot, preparedSceneJob.stagedPackageRoot)
        );
      }
      if (!this.pendingMatches(run)) return;
      const reportRelativePath = `.incoming/${attemptName}/report.json`;
      const child = this.spawnProcess(
        worker.registration.executable,
        [...workerArgs, "--output", reportRelativePath],
        { cwd: runRoot, env: minimalEnvironment(), detached: this.processGroupMode === "isolated" }
      );
      const processGroupId = this.processGroupMode === "isolated" ? child.pid ?? null : null;
      if (this.processGroupMode === "isolated" && (!processGroupId || processGroupId <= 1)) {
        child.kill("SIGKILL");
        throw new Error("Simulation worker did not expose its isolated process-group ID.");
      }
      let finishDone = (): void => undefined;
      const done = new Promise<void>((resolve) => { finishDone = resolve; });
      active = {
        runId,
        attempt: run.attempt,
        child,
        processGroupId,
        intent: "running",
        failure: null,
        killTimer: null,
        done,
        finishDone
      };
      this.active = active;
      this.pending = null;
      run.processGroupId = processGroupId;
      run.state = "running";
      run.updatedAt = this.timestamp();
      await this.persist(run);
      this.emit();

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let spawnError: Error | null = null;
      const append = (stream: "stdout" | "stderr", chunk: Buffer | string): void => {
        if (active?.intent !== "running") return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
        if (stdout.byteLength + stderr.byteLength + bytes.byteLength > run.budget.maxLogBytes) {
          this.terminate(active, "failed", failure("log_budget", "Simulation worker logs exceeded their byte budget.", true));
          return;
        }
        if (stream === "stdout") stdout = Buffer.concat([stdout, bytes]);
        else stderr = Buffer.concat([stderr, bytes]);
      };
      child.stdout.on("data", (chunk: Buffer | string) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer | string) => append("stderr", chunk));
      child.once("error", (error) => { spawnError = error; });
      const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      const workerWallTimeMs = Math.max(1, wallDeadlineMs - Date.now());
      const timeout = setTimeout(() => {
        if (active) this.terminate(active, "timed_out", failure("timeout", "The simulation worker exceeded its wall-time budget.", true));
      }, workerWallTimeMs);
      let closeFallback: ReturnType<typeof setTimeout> | null = null;
      const closed = await Promise.race([
        close.then((value) => ({ ...value, observed: true as const })),
        new Promise<{ code: null; signal: null; observed: false }>((resolve) => {
          closeFallback = setTimeout(
            () => resolve({ code: null, signal: null, observed: false }),
            workerWallTimeMs + this.terminationGraceMs * 3
          );
        })
      ]);
      clearTimeout(timeout);
      if (closeFallback) clearTimeout(closeFallback);
      child.stdin.end();
      const hadDescendants = await this.quiesce(active);
      run.processGroupId = null;
      if (hadDescendants && active.intent === "running") {
        active.intent = "failed";
        active.failure = failure("orphaned_descendants", "The simulation worker left descendant processes running.", true);
      }
      if (!closed.observed && active.intent === "running") {
        active.intent = "failed";
        active.failure = failure("unconfirmed_exit", "The simulation worker did not confirm termination.", true);
      }
      if (active.killTimer) clearTimeout(active.killTimer);
      run.logs = boundedLogs(stdout, stderr, runRoot);
      this.active = this.active === active ? null : this.active;

      if (active.intent !== "running") {
        await rm(incomingRoot, { recursive: true, force: true });
        const state = active.intent === "cancelled" ? "cancelled" : active.intent === "timed_out" ? "timed_out" : "failed";
        await this.finish(run, state, active.failure ?? failure("worker_stopped", "The simulation worker stopped before completion.", true));
        return;
      }
      if (spawnError) throw spawnError;
      const reportPath = path.join(incomingRoot, "report.json");
      const reportFile = await readBoundedFile(reportPath, run.budget.maxReportBytes);
      const report = normalizeReport(
        worker.summary.backendId,
        parseWorkerReport(reportFile.bytes, "Simulation worker report"),
        run.job,
        preparedSceneJob
      );
      if (preparedSceneJob) await rm(preparedSceneJob.stagedPackageRoot, { recursive: true, force: true });
      run.reportSha256 = hash(reportFile.bytes);
      run.reportSizeBytes = reportFile.bytes.byteLength;
      run.capability = report.capability;
      run.evidence = report.evidence;
      await assertOnlyReport(incomingRoot);
      await rename(reportPath, path.join(attemptRoot, "report.json"));
      await rm(incomingRoot, { recursive: true, force: true });
      if (report.status === "passed") {
        if (closed.code !== 0 || closed.signal !== null || !report.capability || !report.evidence) {
          throw new Error("Passing simulation report differs from the worker exit status.");
        }
        await this.finish(run, "completed", null);
      } else {
        const unavailable = report.status === "unavailable";
        const workerFailure = failure(
          unavailable ? "worker_unavailable" : report.failure?.code ?? "runtime_failure",
          report.failure?.message ?? "The simulation worker probe failed.",
          !unavailable
        );
        if (unavailable) this.markUnavailable(run.workerId, workerFailure.message);
        await this.finish(run, "failed", workerFailure);
      }
    } catch (error) {
      let finalError: unknown = error;
      if (active && this.active === active) {
        this.active = null;
        if (active.intent === "running") this.signal(active, "SIGKILL");
        try {
          await this.quiesce(active);
          run.processGroupId = null;
        } catch (cleanupError) {
          finalError = cleanupError;
          this.markUnavailable(run.workerId, "The simulation worker process group could not be terminated safely.");
        }
      }
      await rm(incomingRoot, { recursive: true, force: true });
      if (preparedSceneJob) await rm(preparedSceneJob.stagedPackageRoot, { recursive: true, force: true });
      await rm(path.join(attemptRoot, "report.json"), { force: true });
      run.reportSha256 = null;
      run.reportSizeBytes = null;
      run.capability = null;
      run.evidence = null;
      if (error instanceof StagingHalt) {
        if (error.state === "timed_out" && run.state !== "cancelled") {
          await this.finish(run, "timed_out", failure("timeout", error.message, true));
        }
        return;
      }
      await this.finish(run, "failed", failure(
        "supervisor_error",
        sanitizeDiagnostic(finalError instanceof Error ? finalError.message : "The simulation worker supervisor failed.", runRoot, this.root),
        run.processGroupId === null
      ));
    } finally {
      if (preparedSceneJob) await rm(preparedSceneJob.stagedPackageRoot, { recursive: true, force: true });
      if (this.pending?.runId === runId && this.pending.attempt === run.attempt) this.pending = null;
      pending?.finishDone();
      active?.finishDone();
    }
  }

  private terminate(active: ActiveAttempt, intent: ActiveAttempt["intent"], runFailure: RunFailure): void {
    if (active.intent !== "running") return;
    active.intent = intent;
    active.failure = runFailure;
    this.signal(active, "SIGTERM");
    active.killTimer = setTimeout(() => this.signal(active, "SIGKILL"), this.terminationGraceMs);
  }

  private signal(active: ActiveAttempt, signal: NodeJS.Signals): void {
    try {
      if (active.processGroupId !== null) process.kill(-active.processGroupId, signal);
      else active.child.kill(signal);
    } catch (error) {
      if (!isRecord(error) || error.code !== "ESRCH") active.child.kill(signal);
    }
  }

  private async quiesce(active: ActiveAttempt): Promise<boolean> {
    if (active.processGroupId === null || !processGroupExists(active.processGroupId)) return false;
    this.signal(active, "SIGTERM");
    if (await waitForProcessGroupExit(active.processGroupId, this.terminationGraceMs)) return true;
    this.signal(active, "SIGKILL");
    if (await waitForProcessGroupExit(active.processGroupId, this.terminationGraceMs)) return true;
    throw new Error("Simulation worker process group did not terminate after escalation.");
  }

  private pendingMatches(run: StoredRun): boolean {
    return Boolean(this.pending && !this.pending.cancelled && this.pending.runId === run.runId && this.pending.attempt === run.attempt);
  }

  private async finish(run: StoredRun, state: StoredState, runFailure: RunFailure | null): Promise<void> {
    const finishedAt = this.timestamp();
    const terminal: StoredRun = {
      ...run,
      state,
      failure: runFailure,
      finishedAt,
      updatedAt: finishedAt
    };
    await this.persist(terminal);
    Object.assign(run, terminal);
    this.emit();
  }

  private async verifyCommittedReport(run: StoredRun): Promise<void> {
    const attemptRoot = path.join(this.root, run.runId, "attempts", String(run.attempt).padStart(8, "0"));
    const reportPath = path.join(attemptRoot, "report.json");
    const file = await readBoundedFile(reportPath, run.budget.maxReportBytes);
    if (hash(file.bytes) !== run.reportSha256 || file.bytes.byteLength !== run.reportSizeBytes) {
      throw new Error("Committed simulation report checksum or size differs.");
    }
    const expectation = run.job.kind === "scene_contact_reset"
      ? await readSceneJobExpectation(path.join(attemptRoot, "input", "job.json"))
      : null;
    const report = normalizeReport(
      run.backendId,
      parseWorkerReport(file.bytes, "Committed simulation report"),
      run.job,
      expectation
    );
    if (JSON.stringify(report.capability) !== JSON.stringify(run.capability)
      || JSON.stringify(report.evidence) !== JSON.stringify(run.evidence)) {
      throw new Error("Committed simulation report summary differs from durable state.");
    }
    if (run.state === "completed" && report.status !== "passed") {
      throw new Error("Committed simulation report status differs from completed state.");
    }
    if (run.state !== "completed" && report.status === "passed") {
      throw new Error("Committed passing simulation report is attached to a failed state.");
    }
    if (run.state !== "completed" && report.failure && run.failure) {
      const expectedCode = report.status === "unavailable" ? "worker_unavailable" : report.failure.code;
      if (run.failure.code !== expectedCode || run.failure.message !== report.failure.message) {
        throw new Error("Committed simulation report failure differs from durable state.");
      }
    }
  }

  private async recoverInterruptedProcess(run: StoredRun): Promise<void> {
    if (this.processGroupMode !== "isolated") return;
    const recoveryToken = run.recoveryToken;
    if (!recoveryToken) {
      throw new Error("A legacy active simulation run cannot be recovered safely; no new worker was started.");
    }
    const worker = this.requireWorker(run.workerId);
    const processes = await this.listProcesses();
    const matches = processes.filter((entry) => entry.command.includes(recoveryToken)
      && entry.command.includes(worker.registration.scriptPath));
    const occupied = run.processGroupId === null
      ? []
      : processes.filter((entry) => entry.processGroupId === run.processGroupId);
    if (run.processGroupId !== null && occupied.length > 0
      && !matches.some((entry) => entry.processGroupId === run.processGroupId)) {
      throw new Error("Interrupted simulation process group could not be matched to its recovery token.");
    }
    const groups = new Set(matches.map((entry) => entry.processGroupId));
    if (run.processGroupId !== null && groups.size > 0 && !groups.has(run.processGroupId)) {
      throw new Error("Interrupted simulation process group differs from its durable identity.");
    }
    if (groups.size > 1) throw new Error("Interrupted simulation recovery token matched multiple process groups.");
    const processGroupId = run.processGroupId ?? [...groups][0] ?? null;
    if (processGroupId === null || !processGroupExists(processGroupId)) return;
    signalProcessGroup(processGroupId, "SIGTERM");
    if (await waitForProcessGroupExit(processGroupId, this.terminationGraceMs)) return;
    signalProcessGroup(processGroupId, "SIGKILL");
    if (!await waitForProcessGroupExit(processGroupId, this.terminationGraceMs)) {
      throw new Error("Interrupted simulation process group could not be terminated safely.");
    }
  }

  private async persist(run: StoredRun): Promise<void> {
    await writeAtomicJson(path.join(this.root, run.runId, "state.json"), run);
  }

  private snapshot(): SimulationWorkerSnapshot {
    const run = this.latestRunId ? this.requireRun(this.latestRunId) : null;
    const workers = [...this.workers.values()].map(({ summary }) => ({
      ...summary,
      budget: { ...summary.budget }
    }));
    return {
      state: run?.state ?? (workers.some((worker) => worker.available) ? "idle" : "unavailable"),
      workers,
      run: run ? snapshotRun(run) : null,
      authority: "software_capability_only",
      updatedAt: run?.updatedAt ?? null
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private requireWorker(workerId: string): RegisteredWorker {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Simulation worker ${workerId} is not registered.`);
    return worker;
  }

  private requireSceneJob(sceneJobId: string): SuperDexSceneJobRegistration {
    const sceneJob = this.sceneJobs.get(sceneJobId);
    if (!sceneJob) throw new Error(`SuperDex scene job ${sceneJobId} is not registered.`);
    return sceneJob;
  }

  private requireMatchingSceneJob(
    job: Extract<SimulationWorkerJobSummary, { kind: "scene_contact_reset" }>
  ): SuperDexSceneJobRegistration {
    const registration = this.requireSceneJob(job.sceneJobId);
    if (registration.packageId !== job.packageId
      || registration.packageManifestSha256 !== job.packageManifestSha256
      || registration.targetActorName !== job.targetActorName
      || registration.probeInitialPositionM.some((value, index) => value !== job.probeInitialPositionM[index])) {
      throw new Error("Registered SuperDex scene job differs from the durable run identity.");
    }
    return registration;
  }

  private requireRun(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Simulation run ${runId} does not exist.`);
    return run;
  }

  private markUnavailable(workerId: string, reason: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    worker.summary.available = false;
    worker.summary.unavailableReason = reason;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }
}

function normalizeReport(
  backendId: BackendId,
  value: unknown,
  job: SimulationWorkerJobSummary,
  sceneExpectation: SceneJobExpectation | null = null
): NormalizedReport {
  if (backendId !== "superdex") throw new Error("Unsupported simulation worker backend.");
  if (job.kind === "scene_contact_reset") {
    const receipt = validateSuperDexSceneJobReceipt(value);
    if (receipt.request.scene_job_id !== job.sceneJobId
      || receipt.request.package_id !== job.packageId
      || receipt.request.package_manifest_sha256 !== job.packageManifestSha256) {
      throw new Error("SuperDex scene receipt differs from the durable job identity.");
    }
    if (sceneExpectation
      && (receipt.job_sha256 !== sceneExpectation.requestSha256
        || stableCanonicalJson(receipt.request) !== stableCanonicalJson(sceneExpectation.request))) {
      throw new Error("SuperDex scene receipt differs from its staged job request.");
    }
    if (receipt.status !== "passed") {
      return { status: receipt.status, capability: null, evidence: null, failure: receipt.failure };
    }
    if (!receipt.execution || !receipt.capability) throw new Error("Passing SuperDex scene receipt lacks execution evidence.");
    const execution = receipt.execution;
    const runs = execution.runs;
    return {
      status: "passed",
      capability: receipt.capability,
      evidence: {
        jobKind: "scene_contact_reset",
        fixtureId: execution.fixture_id,
        repetitions: execution.repetitions,
        framesPerRepetition: execution.frames_per_repetition,
        firstContactFrame: Math.min(...runs.map((run) => run.first_contact_frame)),
        maxContactPoints: Math.max(...runs.map((run) => run.max_contact_points)),
        maxResetResidual: maxResetResidual(runs),
        packageId: receipt.request.package_id,
        packageManifestSha256: receipt.request.package_manifest_sha256,
        sceneJobSha256: receipt.job_sha256
      },
      failure: null
    };
  }
  const probe = validateSuperDexWorkerProbe(value);
  if (probe.status !== "passed") {
    return { status: probe.status, capability: null, evidence: null, failure: probe.failure };
  }
  if (!probe.smoke || !probe.capability) throw new Error("Passing SuperDex probe lacks capability evidence.");
  const smoke = probe.smoke;
  const runs = smoke.runs;
  return {
    status: "passed",
    capability: probe.capability,
    evidence: {
      jobKind: "capability_probe",
      fixtureId: smoke.fixture_id,
      repetitions: smoke.repetitions,
      framesPerRepetition: smoke.frames_per_repetition,
      firstContactFrame: Math.min(...runs.map((run) => run.first_contact_frame)),
      maxContactPoints: Math.max(...runs.map((run) => run.max_contact_points)),
      maxResetResidual: maxResetResidual(runs),
      packageId: null,
      packageManifestSha256: null,
      sceneJobSha256: null
    },
    failure: null
  };
}

function maxResetResidual(runs: Array<{
  reset_position_error_m: number;
  reset_rotation_component_error: number;
  reset_linear_velocity_m_s: number;
  reset_angular_velocity_rad_s: number;
}>): number {
  return Math.max(...runs.flatMap((run) => [
    run.reset_position_error_m,
    run.reset_rotation_component_error,
    run.reset_linear_velocity_m_s,
    run.reset_angular_velocity_rad_s
  ]));
}

function pendingAttempt(runId: string, attempt: number): PendingAttempt {
  let finishDone = (): void => undefined;
  const done = new Promise<void>((resolve) => { finishDone = resolve; });
  return { runId, attempt, cancelled: false, done, finishDone };
}

function snapshotRun(run: StoredRun): SimulationWorkerRunSummary {
  return {
    runId: run.runId,
    workerId: run.workerId,
    backendId: run.backendId,
    job: structuredClone(run.job),
    attempt: run.attempt,
    state: run.state,
    budget: { ...run.budget },
    reportSha256: run.reportSha256,
    reportSizeBytes: run.reportSizeBytes,
    capability: run.capability ? structuredClone(run.capability) : null,
    evidence: run.evidence ? { ...run.evidence } : null,
    logs: run.logs.map((entry) => ({ ...entry })),
    failure: run.failure ? { ...run.failure } : null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
    authority: "software_capability_only"
  };
}

function decodeStoredRun(value: unknown): StoredRun {
  if (!isRecord(value)) throw new Error("Stored simulation worker state is invalid.");
  const legacy = value.schema === legacyStoreSchema;
  exactKeys(value, [
    "schema", "authority", "runId", "workerId", "backendId",
    ...(legacy ? [] : ["job", "recoveryToken", "processGroupId"]), "attempt", "state", "budget",
    "reportSha256", "reportSizeBytes", "capability", "evidence", "logs", "failure", "createdAt",
    "startedAt", "finishedAt", "updatedAt"
  ]);
  if ((!legacy && value.schema !== storeSchema) || value.authority !== "software_capability_only") {
    throw new Error("Stored simulation authority is invalid.");
  }
  if (typeof value.runId !== "string") throw new Error("Stored simulation run ID is invalid.");
  assertRunId(value.runId);
  if (typeof value.workerId !== "string") throw new Error("Stored simulation worker ID is invalid.");
  assertIdentifier(value.workerId, "Stored simulation worker ID");
  if (value.backendId !== "superdex" && value.backendId !== "newton") throw new Error("Stored simulation backend is invalid.");
  if (!Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1) throw new Error("Stored simulation attempt is invalid.");
  const states: StoredState[] = ["queued", "starting", "running", "stopping", "completed", "failed", "cancelled", "timed_out", "interrupted"];
  if (typeof value.state !== "string" || !states.includes(value.state as StoredState)) throw new Error("Stored simulation state is invalid.");
  const budget = validateBudget(value.budget);
  const reportSha256 = value.reportSha256;
  const reportSizeBytes = value.reportSizeBytes;
  if (reportSha256 !== null && (typeof reportSha256 !== "string" || !sha256Pattern.test(reportSha256))) throw new Error("Stored report checksum is invalid.");
  if (reportSizeBytes !== null && (!Number.isSafeInteger(reportSizeBytes) || Number(reportSizeBytes) < 1 || Number(reportSizeBytes) > budget.maxReportBytes)) {
    throw new Error("Stored report size is invalid.");
  }
  if ((reportSha256 === null) !== (reportSizeBytes === null)) throw new Error("Stored report identity is incomplete.");
  const timestamps = {
    createdAt: timestamp(value.createdAt, "createdAt"),
    startedAt: value.startedAt === null ? null : timestamp(value.startedAt, "startedAt"),
    finishedAt: value.finishedAt === null ? null : timestamp(value.finishedAt, "finishedAt"),
    updatedAt: timestamp(value.updatedAt, "updatedAt")
  };
  const terminal = ["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(value.state as string);
  if (terminal !== (timestamps.finishedAt !== null)) throw new Error("Stored simulation terminal timestamp is inconsistent.");
  const logs = decodeLogs(value.logs, budget.maxLogBytes);
  const runFailure = decodeFailure(value.failure);
  const job = legacy ? { kind: "capability_probe" } as const : decodeJob(value.job);
  const recoveryToken = legacy ? null : identifierValue(value.recoveryToken, "Stored simulation recovery token");
  const processGroupId = legacy || value.processGroupId === null
    ? null
    : positiveInteger(value.processGroupId, "process group ID");
  const evidence = decodeEvidence(value.evidence, job, legacy);
  if (value.state === "completed" && (runFailure || !reportSha256 || !value.capability || !value.evidence)) {
    throw new Error("Stored completed simulation run is incomplete.");
  }
  if (terminal && value.state !== "completed" && !runFailure) throw new Error("Stored failed simulation run lacks a failure.");
  return {
    schema: storeSchema,
    authority: "software_capability_only",
    runId: value.runId,
    workerId: value.workerId,
    backendId: value.backendId,
    job,
    recoveryToken,
    processGroupId,
    attempt: Number(value.attempt),
    state: value.state as StoredState,
    budget,
    reportSha256: reportSha256 as string | null,
    reportSizeBytes: reportSizeBytes as number | null,
    capability: value.capability as SimulationBackendCapabilityV1 | null,
    evidence,
    logs,
    failure: runFailure,
    ...timestamps
  };
}

function decodeJob(value: unknown): SimulationWorkerJobSummary {
  const job = isRecord(value) ? value : null;
  if (!job || typeof job.kind !== "string") throw new Error("Stored simulation job is invalid.");
  if (job.kind === "capability_probe") {
    exactKeys(job, ["kind"]);
    return { kind: "capability_probe" };
  }
  exactKeys(job, [
    "kind", "sceneJobId", "packageId", "packageManifestSha256",
    "targetActorName", "probeInitialPositionM"
  ]);
  if (job.kind !== "scene_contact_reset"
    || typeof job.sceneJobId !== "string"
    || typeof job.packageId !== "string"
    || typeof job.packageManifestSha256 !== "string"
    || typeof job.targetActorName !== "string") {
    throw new Error("Stored SuperDex scene job is invalid.");
  }
  assertIdentifier(job.sceneJobId, "Stored SuperDex scene job ID");
  assertIdentifier(job.packageId, "Stored SuperDex package ID");
  assertIdentifier(job.targetActorName, "Stored SuperDex target actor");
  if (!sha256Pattern.test(job.packageManifestSha256)) throw new Error("Stored SuperDex package checksum is invalid.");
  return {
    kind: "scene_contact_reset",
    sceneJobId: job.sceneJobId,
    packageId: job.packageId,
    packageManifestSha256: job.packageManifestSha256,
    targetActorName: job.targetActorName,
    probeInitialPositionM: finiteTriplet(job.probeInitialPositionM, "Stored SuperDex probe position")
  };
}

function decodeEvidence(
  value: unknown,
  job: SimulationWorkerJobSummary,
  legacy: boolean
): SimulationWorkerEvidenceSummary | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Stored simulation evidence is invalid.");
  if (legacy) {
    exactKeys(value, [
      "fixtureId", "repetitions", "framesPerRepetition", "firstContactFrame",
      "maxContactPoints", "maxResetResidual"
    ]);
  } else {
    exactKeys(value, [
      "jobKind", "fixtureId", "repetitions", "framesPerRepetition", "firstContactFrame",
      "maxContactPoints", "maxResetResidual", "packageId", "packageManifestSha256", "sceneJobSha256"
    ]);
  }
  const jobKind: SimulationWorkerJobSummary["kind"] = legacy
    ? "capability_probe"
    : value.jobKind === "capability_probe" || value.jobKind === "scene_contact_reset"
      ? value.jobKind
      : (() => { throw new Error("Stored simulation evidence job kind is invalid."); })();
  if (jobKind !== job.kind) throw new Error("Stored simulation evidence job kind differs from its run.");
  if (typeof value.fixtureId !== "string" || !value.fixtureId || value.fixtureId.length > 128) {
    throw new Error("Stored simulation evidence fixture is invalid.");
  }
  for (const field of ["repetitions", "framesPerRepetition", "firstContactFrame", "maxContactPoints"] as const) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 1) {
      throw new Error("Stored simulation evidence count is invalid.");
    }
  }
  if (typeof value.maxResetResidual !== "number" || !Number.isFinite(value.maxResetResidual) || value.maxResetResidual < 0) {
    throw new Error("Stored simulation evidence reset residual is invalid.");
  }
  const packageId = legacy ? null : value.packageId;
  const packageManifestSha256 = legacy ? null : value.packageManifestSha256;
  const sceneJobSha256 = legacy ? null : value.sceneJobSha256;
  if (job.kind === "capability_probe") {
    if (packageId !== null || packageManifestSha256 !== null || sceneJobSha256 !== null) {
      throw new Error("Stored capability evidence must not bind a scene package.");
    }
  } else if (packageId !== job.packageId
    || packageManifestSha256 !== job.packageManifestSha256
    || typeof sceneJobSha256 !== "string"
    || !sha256Pattern.test(sceneJobSha256)) {
    throw new Error("Stored scene evidence differs from its durable package identity.");
  }
  return {
    jobKind,
    fixtureId: value.fixtureId,
    repetitions: Number(value.repetitions),
    framesPerRepetition: Number(value.framesPerRepetition),
    firstContactFrame: Number(value.firstContactFrame),
    maxContactPoints: Number(value.maxContactPoints),
    maxResetResidual: value.maxResetResidual,
    packageId: packageId as string | null,
    packageManifestSha256: packageManifestSha256 as string | null,
    sceneJobSha256: sceneJobSha256 as string | null
  };
}

function decodeLogs(value: unknown, maxBytes: number): SimulationWorkerLogSummary[] {
  if (!Array.isArray(value) || value.length > maxSnapshotLogs || Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    throw new Error("Stored simulation logs exceed their bounds.");
  }
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("Stored simulation log is invalid.");
    exactKeys(entry, ["timestamp", "stream", "message"]);
    if (entry.stream !== "stdout" && entry.stream !== "stderr") throw new Error("Stored simulation log stream is invalid.");
    if (typeof entry.message !== "string" || !entry.message || entry.message.length > 512 || entry.message.includes("\n")) {
      throw new Error("Stored simulation log message is invalid.");
    }
    return { timestamp: timestamp(entry.timestamp, "log timestamp"), stream: entry.stream, message: entry.message };
  });
}

function decodeFailure(value: unknown): RunFailure | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Stored simulation failure is invalid.");
  exactKeys(value, ["code", "message", "retryable"]);
  if (typeof value.code !== "string") throw new Error("Stored simulation failure code is invalid.");
  assertIdentifier(value.code, "Stored simulation failure code");
  if (typeof value.message !== "string" || !value.message || value.message.length > 512 || value.message.includes("\n")) {
    throw new Error("Stored simulation failure message is invalid.");
  }
  if (typeof value.retryable !== "boolean") throw new Error("Stored simulation retryability is invalid.");
  return { code: value.code, message: value.message, retryable: value.retryable };
}

function boundedLogs(stdout: Buffer, stderr: Buffer, runRoot: string): SimulationWorkerLogSummary[] {
  const createdAt = new Date().toISOString();
  const logs: SimulationWorkerLogSummary[] = [];
  for (const [stream, bytes] of [["stdout", stdout], ["stderr", stderr]] as const) {
    if (!bytes.byteLength) continue;
    const message = sanitizeDiagnostic(decodeUtf8(bytes, `Simulation worker ${stream}`), runRoot);
    if (message) logs.push({ timestamp: createdAt, stream, message });
  }
  return logs;
}

function failure(code: string, message: string, retryable: boolean): RunFailure {
  assertIdentifier(code, "Simulation worker failure code");
  return { code, message: sanitizeDiagnostic(message), retryable };
}

function sanitizeDiagnostic(value: string, ...paths: string[]): string {
  let sanitized = value.replace(/[\r\n\t\0]+/g, " ");
  for (const item of paths) sanitized = sanitized.replaceAll(item, "<private-path>");
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  return (sanitized || "Simulation worker failed.").slice(0, 512);
}

function validateBudget(value: unknown): SimulationWorkerBudget {
  if (!isRecord(value)) throw new Error("Simulation worker budget is invalid.");
  exactKeys(value, ["maxWallTimeMs", "maxReportBytes", "maxLogBytes"]);
  return {
    maxWallTimeMs: positiveInteger(value.maxWallTimeMs, "wall-time budget"),
    maxReportBytes: positiveInteger(value.maxReportBytes, "report budget"),
    maxLogBytes: positiveInteger(value.maxLogBytes, "log budget")
  };
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`Simulation worker ${label} must be a positive safe integer.`);
  return Number(value);
}

async function readBoundedJson(filePath: string, maxBytes: number): Promise<unknown> {
  const file = await readBoundedFile(filePath, maxBytes);
  return JSON.parse(decodeUtf8(file.bytes, "Simulation worker state"));
}

function parseWorkerReport(bytes: Buffer, label: string): unknown {
  try {
    return parseCanonicalGraphJson(decodeUtf8(bytes, label));
  } catch {
    throw new Error(`${label} must be complete strict JSON.`);
  }
}

async function readSceneJobExpectation(filePath: string): Promise<SceneJobExpectation> {
  const file = await readBoundedFile(filePath, maxStateBytes);
  return {
    request: validateSuperDexSceneJobRequest(parseWorkerReport(file.bytes, "Committed SuperDex scene job request")),
    requestSha256: hash(file.bytes)
  };
}

function privateRelativePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Simulation worker private input escaped its run root.");
  }
  return relative.split(path.sep).join("/");
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<{ bytes: Buffer }> {
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maxBytes) {
      throw new Error("Simulation worker file is invalid or oversized.");
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await file.read(bytes, offset, bytes.byteLength - offset, offset);
      if (!bytesRead) throw new Error("Simulation worker file ended unexpectedly.");
      offset += bytesRead;
    }
    const after = await file.stat();
    if (after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("Simulation worker file changed during verification.");
    }
    return { bytes };
  } finally {
    await file.close();
  }
}

async function writeAtomicJson(filePath: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) > maxStateBytes) throw new Error("Simulation worker state exceeds its durable bound.");
  const directory = path.dirname(filePath);
  await assertRealDirectory(directory, "Simulation worker state parent");
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    const file = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tempPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function assertExecutable(executable: string): Promise<void> {
  const link = await lstat(executable);
  if (!link.isFile() && !link.isSymbolicLink()) throw new Error("Registered simulation executable is not a file.");
  const target = link.isSymbolicLink() ? await lstat(await realpath(executable)) : link;
  if (!target.isFile() || (target.mode & 0o111) === 0) throw new Error("Registered simulation executable is not executable.");
}

async function assertRegisteredScript(scriptPath: string): Promise<void> {
  const info = await lstat(scriptPath);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new Error("Registered simulation worker script must be one regular file.");
}

async function assertOnlyReport(directory: string): Promise<void> {
  await assertRealDirectory(directory, "Simulation report directory");
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== 1 || entries[0]?.name !== "report.json" || !entries[0].isFile() || entries[0].isSymbolicLink()) {
    throw new Error("Simulation worker emitted undeclared output.");
  }
}

async function assertRealDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory.`);
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  return { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" };
}

async function processTable(): Promise<SimulationWorkerProcessInfo[]> {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("Interrupted simulation process recovery is unsupported on this platform.");
  }
  const { stdout } = await execFileAsync(
    "/bin/ps",
    ["-ww", "-axo", "pid=,pgid=,command="],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  return String(stdout).split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const pid = Number(match[1]);
    const processGroupId = Number(match[2]);
    return Number.isSafeInteger(pid) && pid > 1 && Number.isSafeInteger(processGroupId) && processGroupId > 1
      ? [{ pid, processGroupId, command: match[3]! }]
      : [];
  });
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (!isRecord(error) || error.code !== "ESRCH") throw error;
  }
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") return false;
    if (isRecord(error) && error.code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function hash(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Stored simulation ${label} is invalid.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(`Stored simulation ${label} is invalid.`);
  return value;
}

function identifierValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  assertIdentifier(value, label);
  return value;
}

function finiteTriplet(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry < -10_000 || entry > 10_000)) {
    throw new Error(`${label} is invalid.`);
  }
  return [...value] as [number, number, number];
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) throw new Error(`${label} is invalid.`);
}

function assertRunId(value: string): void {
  if (!runIdPattern.test(value)) throw new Error("Simulation run ID is invalid.");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error("Simulation worker data has unexpected fields.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
