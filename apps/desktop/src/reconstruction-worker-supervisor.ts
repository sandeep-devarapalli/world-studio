import type {
  ReconstructionWorkerBudget,
  ReconstructionWorkerCapabilitySummary,
  ReconstructionWorkerJobSummary,
  ReconstructionWorkerLogSummary,
  ReconstructionWorkerOutputSummary,
  ReconstructionWorkerSnapshot,
  ReconstructionWorkerState
} from "@world-studio/world-core";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { TextDecoder } from "node:util";
import {
  RECONSTRUCTION_JOB_SCHEMA,
  assertReconstructionEventCompatibleWithCapability,
  assertReconstructionEventMatchesJob,
  assertReconstructionJobCompatible,
  assertReconstructionResultCompatibleWithCapability,
  assertReconstructionResultMatchesEventSequence,
  assertReconstructionResultMatchesJob,
  type ReconstructionArtifactReference,
  type ReconstructionEvent,
  type ReconstructionJob,
  type ReconstructionResult,
  type ReconstructionWorkerCapability as ContractWorkerCapability,
  parseReconstructionJson,
  safeReconstructionRelativePath,
  stableReconstructionJson,
  validateReconstructionEvent,
  validateReconstructionEventSequence,
  validateReconstructionJob,
  validateReconstructionResult,
  validateReconstructionWorkerCapability
} from "./reconstruction-worker-contract.js";

type ReconstructionWorkerFailure = NonNullable<ReconstructionWorkerJobSummary["failure"]>;
type ReconstructionWorkerInputSummary = ReconstructionWorkerJobSummary["input"];

const storeSchema = "world_studio.reconstruction_job_store.v0.1";
const jobIdPattern = /^rwj_[A-Za-z0-9_-]{22}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const maxSnapshotLogs = 100;
const maxStoredStateBytes = 2 * 1024 * 1024;
const defaultTerminationGraceMs = 2_000;

export interface ReconstructionWorkerInputStager {
  stage(input: {
    sessionId: string;
    destinationRoot: string;
    maxBytes: number;
    maxArtifacts: number;
  }): Promise<{
    source: ReconstructionJob["source"];
    inputs: ReconstructionJob["inputs"];
    summary: ReconstructionWorkerInputSummary;
  }>;
}

export interface ReconstructionWorkerRegistration {
  capability: ContractWorkerCapability;
  label: string;
  executable: string;
  args?: readonly string[];
  environment?: Readonly<Record<string, string>>;
  jobKind: string;
  requestedOutputs: readonly string[];
  budget?: ReconstructionJob["budget"];
}

export interface ReconstructionWorkerChildProcess {
  readonly pid?: number;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type ReconstructionWorkerSpawn = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => ReconstructionWorkerChildProcess;

export interface ReconstructionWorkerSupervisorOptions {
  root: string;
  registrations?: readonly ReconstructionWorkerRegistration[];
  inputStager?: ReconstructionWorkerInputStager;
  now?: () => Date;
  randomId?: () => string;
  spawnProcess?: ReconstructionWorkerSpawn;
  processGroupMode?: "isolated" | "direct-test-only";
  terminationGraceMs?: number;
}

interface RegisteredWorker {
  registration: ReconstructionWorkerRegistration;
  capability: ContractWorkerCapability;
  capabilitySha256: string;
  summary: ReconstructionWorkerCapabilitySummary;
}

interface StoredOutput {
  summary: ReconstructionWorkerOutputSummary;
  attempt: number;
  relativePath: string;
}

interface StoredJob {
  schema: typeof storeSchema;
  authority: "proposal_only";
  loadedWorldEffect: "none";
  jobId: string;
  workerId: string;
  source: ReconstructionJob["source"];
  inputs: ReconstructionJob["inputs"];
  input: ReconstructionWorkerInputSummary;
  jobKind: string;
  requestedOutputs: string[];
  budget: ReconstructionJob["budget"];
  capabilitySha256: string;
  attempt: number;
  attemptCreatedAt: string;
  state: Exclude<ReconstructionWorkerState, "unavailable" | "idle">;
  progress: number | null;
  logs: ReconstructionWorkerLogSummary[];
  outputs: StoredOutput[];
  failure: ReconstructionWorkerFailure | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

interface ActiveAttempt {
  jobId: string;
  attempt: number;
  child: ReconstructionWorkerChildProcess;
  intent: "running" | "cancelled" | "timed_out" | "protocol_failure";
  failure: ReconstructionWorkerFailure | null;
  killTimer: ReturnType<typeof setTimeout> | null;
  processGroupId: number | null;
  signalFallback: boolean;
  done: Promise<void>;
  finishDone: () => void;
}

interface PendingAttempt {
  jobId: string;
  attempt: number;
  cancelled: boolean;
}

export class ReconstructionWorkerSupervisor {
  readonly root: string;
  private readonly workers = new Map<string, RegisteredWorker>();
  private readonly inputStager: ReconstructionWorkerInputStager;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly spawnProcess: ReconstructionWorkerSpawn;
  private readonly processGroupMode: "isolated" | "direct-test-only";
  private readonly terminationGraceMs: number;
  private readonly listeners = new Set<(snapshot: ReconstructionWorkerSnapshot) => void>();
  private readonly jobs = new Map<string, StoredJob>();
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private active: ActiveAttempt | null = null;
  private pending: PendingAttempt | null = null;
  private latestJobId: string | null = null;
  private operation: Promise<void> = Promise.resolve();
  private persistence: Promise<void> = Promise.resolve();

  constructor(options: ReconstructionWorkerSupervisorOptions) {
    if (!path.isAbsolute(options.root)) throw new Error("Reconstruction job root must be absolute.");
    this.root = path.resolve(options.root);
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => randomBytes(16).toString("base64url"));
    if (options.spawnProcess && options.processGroupMode !== "direct-test-only") {
      throw new Error("Injected reconstruction spawn requires the explicit direct-test-only process mode.");
    }
    if (!options.spawnProcess && options.processGroupMode === "direct-test-only") {
      throw new Error("Direct child process mode is allowed only with an injected test spawn.");
    }
    this.spawnProcess = options.spawnProcess ?? spawnWorker;
    this.processGroupMode = options.spawnProcess ? "direct-test-only" : "isolated";
    this.terminationGraceMs = options.terminationGraceMs ?? defaultTerminationGraceMs;
    if (!Number.isSafeInteger(this.terminationGraceMs) || this.terminationGraceMs < 1) {
      throw new Error("Worker termination grace must be a positive integer.");
    }
    this.inputStager = options.inputStager ?? {
      stage: async () => {
        throw new Error("No reconstruction input stager is configured.");
      }
    };
    for (const registration of options.registrations ?? []) this.register(registration);
  }

  async getStatus(): Promise<ReconstructionWorkerSnapshot> {
    await this.initialize();
    await this.persistence;
    return this.snapshot();
  }

  async start(input: { workerId: string; sessionId: string }): Promise<ReconstructionWorkerSnapshot> {
    return this.serialized(async () => {
      await this.initialize();
      if (this.active || this.pending) throw new Error("A reconstruction worker job is already active.");
      const worker = this.requireWorker(input.workerId);
      assertIdentifier(input.sessionId, "Live session ID");
      const jobId = `rwj_${this.randomId()}`;
      if (!jobIdPattern.test(jobId)) throw new Error("Generated reconstruction job ID is invalid.");
      const publicationRoot = path.join(this.root, `.creating-${jobId}`);
      await mkdir(publicationRoot, { mode: 0o700 });
      try {
        await mkdir(path.join(publicationRoot, "inputs"), { mode: 0o700 });
        await mkdir(path.join(publicationRoot, "attempts"), { mode: 0o700 });
        await mkdir(path.join(publicationRoot, ".incoming"), { mode: 0o700 });
        const operation = requireOperation(worker.capability, worker.registration.jobKind);
        const staged = await this.inputStager.stage({
          sessionId: input.sessionId,
          destinationRoot: publicationRoot,
          maxBytes: worker.capability.limits.max_input_bytes,
          maxArtifacts: worker.capability.limits.max_input_artifacts
        });
        if (staged.source.session_id !== input.sessionId || staged.summary.sessionId !== input.sessionId) {
          throw new Error("Staged reconstruction input belongs to a different live session.");
        }
        const inputSummary = validateInputSummary(staged.summary, staged.source.final_sequence_id);
        await verifyArtifacts(
          publicationRoot,
          staged.inputs,
          "inputs",
          worker.capability.limits.max_input_bytes,
          worker.capability.limits.max_input_artifacts
        );
        const inputDigest = digest(stableReconstructionJson(staged.inputs));
        if (inputSummary.manifestSha256 !== inputDigest) {
          throw new Error("Staged reconstruction input manifest checksum differs.");
        }
        const budget = worker.registration.budget ?? defaultBudget(worker.capability);
        assertBudgetWithinCapability(budget, worker.capability);
        const requestedOutputs = [...worker.registration.requestedOutputs];
        if (!requestedOutputs.length || requestedOutputs.some((role) => !operation.outputs.some((item) => item.role === role))) {
          throw new Error("Registered reconstruction outputs do not match worker capability.");
        }
        const now = this.timestamp();
        const stored: StoredJob = {
          schema: storeSchema,
          authority: "proposal_only",
          loadedWorldEffect: "none",
          jobId,
          workerId: worker.capability.worker_id,
          source: staged.source,
          inputs: staged.inputs,
          input: inputSummary,
          jobKind: worker.registration.jobKind,
          requestedOutputs,
          budget,
          capabilitySha256: worker.capabilitySha256,
          attempt: 1,
          attemptCreatedAt: now,
          state: "queued",
          progress: null,
          logs: [],
          outputs: [],
          failure: null,
          createdAt: now,
          startedAt: null,
          finishedAt: null,
          updatedAt: now
        };
        await writeAtomicText(
          path.join(publicationRoot, "capability.json"),
          `${stableReconstructionJson(worker.capability)}\n`
        );
        await writeAtomicJson(path.join(publicationRoot, "state.json"), stored);
        await syncDirectory(publicationRoot);
        await rename(publicationRoot, path.join(this.root, jobId));
        await syncDirectory(this.root);
        this.jobs.set(jobId, stored);
        this.latestJobId = jobId;
      } finally {
        await rm(publicationRoot, { recursive: true, force: true });
      }
      this.pending = { jobId, attempt: 1, cancelled: false };
      this.emit();
      void this.runAttempt(jobId, worker);
      return this.snapshot();
    });
  }

  async stop(input: { jobId: string }): Promise<ReconstructionWorkerSnapshot> {
    assertJobId(input.jobId);
    let done: Promise<void> | null = null;
    await this.serialized(async () => {
      await this.initialize();
      const job = this.requireJob(input.jobId);
      const active = this.active;
      const pending = this.pending;
      if (pending?.jobId === input.jobId) {
        pending.cancelled = true;
        this.pending = null;
        await this.finish(job, "cancelled", {
          code: "cancelled",
          message: "The reconstruction worker was stopped before launch.",
          retryable: true
        });
        return;
      }
      if (!active || active.jobId !== input.jobId) {
        if (["queued", "starting"].includes(job.state)) {
          await this.finish(job, "cancelled", {
            code: "cancelled",
            message: "The reconstruction worker was stopped before launch.",
            retryable: true
          });
        }
        return;
      }
      if (active.intent === "running") {
        job.state = "stopping";
        job.updatedAt = this.timestamp();
        await this.persist(job);
        this.emit();
        this.terminate(active, "cancelled", {
          code: "cancelled",
          message: "The reconstruction worker was stopped by the user.",
          retryable: true
        });
      }
      done = active.done;
    });
    if (done) await done;
    return this.getStatus();
  }

  async retry(input: { jobId: string }): Promise<ReconstructionWorkerSnapshot> {
    return this.serialized(async () => {
      await this.initialize();
      if (this.active || this.pending) throw new Error("A reconstruction worker job is already active.");
      assertJobId(input.jobId);
      const job = this.requireJob(input.jobId);
      if (!["failed", "cancelled", "timed_out", "interrupted"].includes(job.state)) {
        throw new Error("Only failed, cancelled, timed-out, or interrupted jobs can be retried.");
      }
      if (job.failure && !job.failure.retryable) throw new Error("This reconstruction failure is not retryable.");
      const worker = this.requireWorker(job.workerId);
      if (worker.capabilitySha256 !== job.capabilitySha256) {
        throw new Error("The registered worker capability changed; retry requires the original capability.");
      }
      await verifyArtifacts(
        path.join(this.root, job.jobId),
        job.inputs,
        "inputs",
        worker.capability.limits.max_input_bytes,
        worker.capability.limits.max_input_artifacts
      );
      job.attempt += 1;
      job.state = "queued";
      job.progress = null;
      job.outputs = [];
      job.failure = null;
      job.startedAt = null;
      job.finishedAt = null;
      job.updatedAt = this.timestamp();
      job.attemptCreatedAt = job.updatedAt;
      await this.persist(job);
      this.pending = { jobId: job.jobId, attempt: job.attempt, cancelled: false };
      this.latestJobId = job.jobId;
      this.emit();
      void this.runAttempt(job.jobId, worker);
      return this.snapshot();
    });
  }

  subscribe(listener: (snapshot: ReconstructionWorkerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stopAll(): Promise<void> {
    const jobId = this.active?.jobId ?? this.pending?.jobId;
    if (!jobId) return;
    await this.stop({ jobId });
  }

  private register(registration: ReconstructionWorkerRegistration): void {
    const capability = validateReconstructionWorkerCapability(registration.capability);
    if (this.workers.has(capability.worker_id)) throw new Error(`Duplicate worker ID: ${capability.worker_id}.`);
    if (!path.isAbsolute(registration.executable)) {
      throw new Error("Registered reconstruction worker executable must be absolute.");
    }
    if (!registration.label.trim() || registration.label.length > 128) {
      throw new Error("Registered reconstruction worker label is invalid.");
    }
    if ((registration.args ?? []).some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
      throw new Error("Registered reconstruction worker arguments are invalid.");
    }
    if (!identifierPattern.test(registration.jobKind)) throw new Error("Registered job kind is invalid.");
    const operation = requireOperation(capability, registration.jobKind);
    const requestedOutputs = [...registration.requestedOutputs];
    if (
      !requestedOutputs.length
      || new Set(requestedOutputs).size !== requestedOutputs.length
      || requestedOutputs.some((role) => !operation.outputs.some((output) => output.role === role))
    ) {
      throw new Error("Registered reconstruction outputs do not match worker capability.");
    }
    const budget = registration.budget ?? defaultBudget(capability);
    assertBudgetWithinCapability(budget, capability);
    const capabilityText = stableReconstructionJson(capability);
    if (Buffer.byteLength(capabilityText, "utf8") + 1 > maxStoredStateBytes) {
      throw new Error("Registered reconstruction capability exceeds its durable storage bound.");
    }
    const capabilitySha256 = digest(capabilityText);
    this.workers.set(capability.worker_id, {
      registration,
      capability,
      capabilitySha256,
      summary: {
        workerId: capability.worker_id,
        label: registration.label,
        protocolVersion: capability.protocol.version,
        available: true,
        unavailableReason: null,
        outputRoles: operation.outputs.map((output) => output.role),
        budget: snapshotBudget(budget)
      }
    });
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initialization) {
      this.initialization = this.initializeFromDisk().then(() => {
        this.initialized = true;
      });
    }
    await this.initialization;
  }

  private async initializeFromDisk(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await assertRealDirectory(this.root, "Reconstruction job root");
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(this.root, entry.name);
      if (entry.name.startsWith(".creating-")) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Invalid stale reconstruction publication.");
        await rm(entryPath, { recursive: true });
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      assertJobId(entry.name);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Reconstruction job root contains an invalid entry.");
      const stored = decodeStoredJob(
        await readBoundedJson(path.join(entryPath, "state.json")),
        entryPath,
        this.root
      );
      if (stored.jobId !== entry.name) throw new Error("Reconstruction job directory and state IDs differ.");
      await rm(path.join(entryPath, ".incoming"), { recursive: true, force: true });
      await mkdir(path.join(entryPath, ".incoming"), { mode: 0o700 });
      if (["queued", "starting", "running", "stopping"].includes(stored.state)) {
        stored.state = "interrupted";
        stored.failure = {
          code: "desktop_restart",
          message: "The desktop restarted before the reconstruction attempt finalized.",
          retryable: true
        };
        stored.finishedAt = this.timestamp();
        stored.updatedAt = stored.finishedAt;
        await this.persist(stored);
      } else if (stored.state === "completed") {
        await this.verifyCompletedJob(stored);
      }
      this.jobs.set(stored.jobId, stored);
      if (!this.latestJobId || stored.updatedAt > this.requireJob(this.latestJobId).updatedAt) {
        this.latestJobId = stored.jobId;
      }
    }
  }

  private async runAttempt(jobId: string, worker: RegisteredWorker): Promise<void> {
    const job = this.requireJob(jobId);
    const jobRoot = path.join(this.root, job.jobId);
    const attemptName = String(job.attempt).padStart(8, "0");
    const attemptRoot = path.join(jobRoot, "attempts", attemptName);
    const outputRelative = `.incoming/${attemptName}`;
    const outputRoot = path.join(jobRoot, outputRelative);
    const cleanupOutput = () => removeIncomingAttempt(jobRoot, attemptName);
    let attemptActive: ActiveAttempt | null = null;
    let outputMonitor: ReturnType<typeof setInterval> | null = null;
    let outputInspection = Promise.resolve();
    try {
      if (!this.pendingMatches(job) || job.state !== "queued") return;
      await assertRealDirectory(jobRoot, "Reconstruction job directory");
      await assertRealDirectory(path.join(jobRoot, "attempts"), "Reconstruction attempts directory");
      await assertRealDirectory(path.join(jobRoot, ".incoming"), "Reconstruction incoming directory");
      await mkdir(attemptRoot, { mode: 0o700 });
      await mkdir(outputRoot, { mode: 0o700 });
      await assertAttemptDirectoryChain(jobRoot, attemptRoot, outputRoot);
      if (!this.pendingMatches(job) || job.state !== "queued") return;
      const contractJob = validateReconstructionJob({
        schema: RECONSTRUCTION_JOB_SCHEMA,
        job_id: job.jobId,
        attempt: job.attempt,
        created_at: job.attemptCreatedAt,
        source: job.source,
        worker: { worker_id: job.workerId, capability_sha256: job.capabilitySha256 },
        job_kind: job.jobKind,
        inputs: job.inputs,
        requested_outputs: job.requestedOutputs,
        budget: job.budget,
        authority: "proposal_only",
        loaded_world_effect: "none"
      });
      assertReconstructionJobCompatible(contractJob, worker.capability);
      const jobText = stableReconstructionJson(contractJob);
      const jobSha256 = digest(jobText);
      const jobRelative = `attempts/${attemptName}/job.json`;
      await writeAtomicText(path.join(jobRoot, jobRelative), `${jobText}\n`);
      if (!this.pendingMatches(job) || job.state !== "queued") return;
      job.state = "starting";
      job.startedAt = this.timestamp();
      job.updatedAt = job.startedAt;
      await this.persist(job);
      this.emit();
      if (!this.pendingMatches(job) || job.state !== "starting") return;

      await assertRegisteredExecutable(worker.registration.executable);
      if (!this.pendingMatches(job) || job.state !== "starting") return;

      const args = [
        ...(worker.registration.args ?? []),
        "--job", jobRelative,
        "--attempt", String(job.attempt),
        "--job-sha256", jobSha256,
        "--output-root", outputRelative
      ];
      const child = this.spawnProcess(worker.registration.executable, args, {
        cwd: jobRoot,
        env: minimalEnvironment(worker.registration.environment)
      });
      if (!child.stdout || !child.stderr || !child.stdin) {
        child.kill("SIGKILL");
        throw new Error("Reconstruction worker streams are unavailable.");
      }
      const processGroupId = this.processGroupMode === "isolated" ? child.pid ?? null : null;
      if (this.processGroupMode === "isolated" && (!processGroupId || processGroupId <= 1)) {
        child.kill("SIGKILL");
        throw new Error("Reconstruction worker did not expose its isolated process-group ID.");
      }
      let resolveDone = (): void => undefined;
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });
      const active: ActiveAttempt = {
        jobId: job.jobId,
        attempt: job.attempt,
        child,
        intent: "running",
        failure: null,
        killTimer: null,
        processGroupId,
        signalFallback: false,
        done,
        finishDone: resolveDone
      };
      attemptActive = active;
      this.active = active;
      this.pending = null;
      job.state = "running";
      job.updatedAt = this.timestamp();
      await this.persist(job);
      this.emit();

      const inspectOutput = (): void => {
        outputInspection = outputInspection.then(async () => {
          if (active.intent !== "running") return;
          await assertOutputStagingBudget(jobRoot, outputRoot, job.budget.output_bytes, job.budget.max_output_artifacts);
        }).catch(() => {
          this.terminate(active, "protocol_failure", failure(
            "output_budget",
            "Worker output staging exceeded its bounded file, byte, or path budget."
          ));
        });
      };
      inspectOutput();
      outputMonitor = setInterval(inspectOutput, 50);

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let protocolBytes = 0;
      let eventSequence = 0;
      const events: ReconstructionEvent[] = [];
      let spawnError: Error | null = null;
      let publishPending = false;
      let eventPersistence = Promise.resolve();
      const logLimit = job.budget.log_bytes;
      child.stdout.on("data", (chunk: Buffer | string) => {
        if (active.intent !== "running") return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
        protocolBytes += bytes.byteLength;
        stdout = Buffer.concat([stdout, bytes]);
        if (protocolBytes > logLimit) {
          this.terminate(active, "protocol_failure", failure("log_budget", "Worker protocol output exceeded its byte budget."));
          return;
        }
        let newline = stdout.indexOf(0x0a);
        while (newline >= 0) {
          const lineBytes = stdout.subarray(0, newline);
          stdout = stdout.subarray(newline + 1);
          newline = stdout.indexOf(0x0a);
          if (!lineBytes.byteLength) continue;
          try {
            const line = decodeUtf8(lineBytes, "Worker event");
            const event = validateReconstructionEvent(parseReconstructionJson(line));
            assertReconstructionEventMatchesJob(event, contractJob);
            assertReconstructionEventCompatibleWithCapability(event, contractJob, worker.capability);
            if (event.job_id !== job.jobId || event.attempt !== job.attempt || event.sequence_id !== eventSequence + 1) {
              throw new Error("Worker event identity or sequence is invalid.");
            }
            if (event.sequence_id > 4_096) throw new Error("Worker emitted too many protocol events.");
            eventSequence = event.sequence_id;
            events.push(event);
            if (event.progress !== null) job.progress = event.progress;
            if (event.kind === "log" && event.level && event.message) {
              appendLog(job, {
                sequenceId: event.sequence_id,
                timestamp: event.timestamp,
                level: event.level,
                code: "worker_log",
                message: sanitizeLog(event.message, jobRoot)
              }, logLimit);
            }
            if (!publishPending) {
              publishPending = true;
              eventPersistence = eventPersistence.then(async () => {
                publishPending = false;
                await this.persist(job);
                this.emit();
              });
            }
          } catch (error) {
            this.terminate(active, "protocol_failure", failure(
              "invalid_event",
              error instanceof Error ? error.message : "Worker emitted an invalid event."
            ));
            break;
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        if (active.intent !== "running") return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
        protocolBytes += bytes.byteLength;
        if (protocolBytes > logLimit) {
          this.terminate(active, "protocol_failure", failure("log_budget", "Worker output exceeded its byte budget."));
          return;
        }
        stderr = Buffer.concat([stderr, bytes]);
      });
      child.once("error", (error) => { spawnError = error; });
      const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      const timeout = setTimeout(() => {
        this.terminate(active, "timed_out", failure("timeout", "The reconstruction worker exceeded its wall-time budget."));
      }, job.budget.wall_time_ms);
      let closeFallback: ReturnType<typeof setTimeout> | null = null;
      const closed = await Promise.race([
        close.then((value) => ({ ...value, observed: true as const })),
        new Promise<{ code: null; signal: null; observed: false }>((resolve) => {
          closeFallback = setTimeout(
            () => resolve({ code: null, signal: null, observed: false }),
            job.budget.wall_time_ms + this.terminationGraceMs * 3
          );
        })
      ]);
      if (outputMonitor) clearInterval(outputMonitor);
      outputMonitor = null;
      await outputInspection;
      clearTimeout(timeout);
      if (closeFallback) clearTimeout(closeFallback);
      if (active.killTimer) clearTimeout(active.killTimer);
      child.stdin.end();
      await eventPersistence;
      const hadDescendants = await quiesceProcessGroup(active, this.terminationGraceMs);
      if (hadDescendants && active.intent === "running") {
        active.intent = "protocol_failure";
        active.failure = failure(
          "orphaned_descendants",
          "The reconstruction worker exited while descendant processes remained active."
        );
      }
      let stderrText = "";
      if (stderr.byteLength && active.intent === "running") {
        try {
          stderrText = decodeUtf8(stderr, "Worker stderr");
        } catch (error) {
          active.intent = "protocol_failure";
          active.failure = failure("invalid_utf8", error instanceof Error ? error.message : "Worker stderr is not valid UTF-8.");
        }
      }
      if (stderrText.trim()) {
        appendLog(job, {
          sequenceId: eventSequence + 1,
          timestamp: this.timestamp(),
          level: "error",
          code: "worker_stderr",
          message: sanitizeLog(stderrText, jobRoot)
        }, logLimit);
      }
      if (stdout.byteLength && active.intent === "running") {
        try {
          decodeUtf8(stdout, "Worker event");
          active.intent = "protocol_failure";
          active.failure = failure("truncated_event", "Worker protocol output ended with a truncated event.");
        } catch (error) {
          active.intent = "protocol_failure";
          active.failure = failure("invalid_utf8", error instanceof Error ? error.message : "Worker event is not valid UTF-8.");
        }
      }
      this.active = this.active === active ? null : this.active;

      if (active.intent !== "running") {
        await cleanupOutput();
        const state: StoredJob["state"] = active.intent === "cancelled"
          ? "cancelled"
          : active.intent === "timed_out"
            ? "timed_out"
            : "failed";
        await this.finish(job, state, active.failure ?? failure("worker_stopped", "The worker stopped before completion."));
      } else if (!closed.observed) {
        await cleanupOutput();
        await this.finish(job, "interrupted", failure("unconfirmed_exit", "The worker did not confirm termination."));
      } else if (spawnError || closed.code !== 0) {
        await cleanupOutput();
        await this.finish(job, "failed", failure(
          "worker_crash",
          spawnError ? "The reconstruction worker could not be started." : `The reconstruction worker exited with code ${closed.code ?? "signal"}.`
        ));
      } else {
        validateReconstructionEventSequence(events);
        await this.completeAttempt(job, worker, contractJob, jobSha256, attemptRoot, outputRoot, events);
      }
    } catch (error) {
      const failedActive = this.active?.jobId === job.jobId && this.active.attempt === job.attempt
        ? this.active
        : null;
      if (failedActive) this.active = null;
      await cleanupOutput();
      await this.finish(job, "failed", failure(
        "supervisor_error",
        error instanceof Error
          ? sanitizeSupervisorError(error.message, jobRoot, this.root)
          : "The reconstruction supervisor failed."
      ));
    } finally {
      if (outputMonitor) clearInterval(outputMonitor);
      await outputInspection;
      if (this.pending?.jobId === job.jobId && this.pending.attempt === job.attempt) this.pending = null;
      if (!attemptActive) await cleanupOutput();
      attemptActive?.finishDone();
    }
  }

  private pendingMatches(job: StoredJob): boolean {
    return Boolean(
      this.pending
      && !this.pending.cancelled
      && this.pending.jobId === job.jobId
      && this.pending.attempt === job.attempt
    );
  }

  private async completeAttempt(
    job: StoredJob,
    worker: RegisteredWorker,
    contractJob: ReconstructionJob,
    jobSha256: string,
    attemptRoot: string,
    outputRoot: string,
    events: ReconstructionEvent[]
  ): Promise<void> {
    const jobRoot = path.join(this.root, job.jobId);
    const attemptName = String(job.attempt).padStart(8, "0");
    await assertAttemptDirectoryChain(jobRoot, attemptRoot, outputRoot);
    const resultPath = path.join(outputRoot, "result.json");
    const result = validateReconstructionResult(await readBoundedJson(resultPath));
    assertReconstructionResultMatchesJob(result, contractJob, jobSha256);
    assertReconstructionResultCompatibleWithCapability(result, contractJob, worker.capability);
    assertReconstructionResultMatchesEventSequence(result, events);
    assertResultBinding(result, job, worker, jobSha256);
    await assertExactOutputInventory(outputRoot, result.outputs.map((output) => output.path));
    if (result.status !== "completed" || result.failure !== null) {
      await removeIncomingAttempt(jobRoot, attemptName);
      const state = result.status === "timed_out" ? "timed_out" : result.status;
      await this.finish(
        job,
        state,
        result.failure
          ? normalizeWorkerFailure(result.failure, jobRoot, this.root)
          : failure("worker_failed", "The worker did not complete.")
      );
      return;
    }
    if (
      result.outputs.length > job.budget.max_output_artifacts
      || result.usage.output_artifacts !== result.outputs.length
      || result.usage.output_bytes > job.budget.output_bytes
      || result.usage.log_bytes > job.budget.log_bytes
      || result.usage.wall_time_ms > job.budget.wall_time_ms
    ) {
      throw new Error("Reconstruction result exceeds its declared resource budget.");
    }
    const total = await verifyArtifacts(
      outputRoot,
      result.outputs,
      "",
      job.budget.output_bytes,
      job.budget.max_output_artifacts,
      new Set(["result.json"])
    );
    if (total !== result.usage.output_bytes) throw new Error("Result output byte accounting differs from verified outputs.");
    await verifyArtifacts(
      jobRoot,
      job.inputs,
      "inputs",
      worker.capability.limits.max_input_bytes,
      worker.capability.limits.max_input_artifacts
    );
    await assertAttemptDirectoryChain(jobRoot, attemptRoot, outputRoot);
    await rm(resultPath);
    const committedRoot = path.join(attemptRoot, "outputs");
    await rename(outputRoot, committedRoot);
    await assertCommittedDirectoryChain(jobRoot, attemptRoot, committedRoot);
    await syncDirectory(attemptRoot);
    await writeAtomicJson(path.join(attemptRoot, "result.json"), result);
    await assertCommittedDirectoryChain(jobRoot, attemptRoot, committedRoot);
    await assertExactOutputInventory(committedRoot, result.outputs.map((output) => output.path), false);
    await verifyArtifacts(
      committedRoot,
      result.outputs,
      "",
      job.budget.output_bytes,
      job.budget.max_output_artifacts
    );
    const outputs = result.outputs.map((output, index) => ({
      attempt: job.attempt,
      relativePath: output.path,
      summary: outputSummary(output, job.attempt, index)
    }));
    await this.finish(job, "completed", null, { outputs, progress: 1 });
  }

  private async finish(
    job: StoredJob,
    state: StoredJob["state"],
    failureValue: ReconstructionWorkerFailure | null,
    updates: Pick<Partial<StoredJob>, "outputs" | "progress"> = {}
  ): Promise<void> {
    const finishedAt = this.timestamp();
    const durable: StoredJob = {
      ...job,
      ...updates,
      state,
      failure: failureValue,
      finishedAt,
      updatedAt: finishedAt
    };
    await this.persist(durable);
    Object.assign(job, durable);
    this.emit();
  }

  private terminate(
    active: ActiveAttempt,
    intent: ActiveAttempt["intent"],
    failureValue: ReconstructionWorkerFailure
  ): void {
    if (active.intent !== "running") return;
    active.intent = intent;
    active.failure = failureValue;
    active.child.stdin?.end();
    if (signalAttempt(active, "SIGTERM") === "fallback") {
      active.signalFallback = true;
    }
    active.killTimer = setTimeout(() => {
      if (signalAttempt(active, "SIGKILL") === "fallback") {
        active.signalFallback = true;
      }
    }, this.terminationGraceMs);
  }

  private async verifyCompletedJob(job: StoredJob): Promise<void> {
    const jobRoot = path.join(this.root, job.jobId);
    const attemptName = String(job.attempt).padStart(8, "0");
    const attemptRoot = path.join(jobRoot, "attempts", attemptName);
    const committedRoot = path.join(attemptRoot, "outputs");
    await assertCommittedDirectoryChain(jobRoot, attemptRoot, committedRoot);

    const capability = validateReconstructionWorkerCapability(
      await readBoundedJson(path.join(jobRoot, "capability.json"))
    );
    const capabilitySha256 = digest(stableReconstructionJson(capability));
    if (capabilitySha256 !== job.capabilitySha256 || capability.worker_id !== job.workerId) {
      throw new Error("Stored reconstruction capability differs from completed job state.");
    }

    const expectedJob = validateReconstructionJob({
      schema: RECONSTRUCTION_JOB_SCHEMA,
      job_id: job.jobId,
      attempt: job.attempt,
      created_at: job.attemptCreatedAt,
      source: job.source,
      worker: { worker_id: job.workerId, capability_sha256: job.capabilitySha256 },
      job_kind: job.jobKind,
      inputs: job.inputs,
      requested_outputs: job.requestedOutputs,
      budget: job.budget,
      authority: "proposal_only",
      loaded_world_effect: "none"
    });
    const actualJob = validateReconstructionJob(
      await readBoundedJson(path.join(attemptRoot, "job.json"))
    );
    if (stableReconstructionJson(actualJob) !== stableReconstructionJson(expectedJob)) {
      throw new Error("Stored attempt manifest differs from completed job state.");
    }
    assertReconstructionJobCompatible(actualJob, capability);
    const jobSha256 = digest(stableReconstructionJson(actualJob));

    const result = validateReconstructionResult(
      await readBoundedJson(path.join(attemptRoot, "result.json"))
    );
    assertReconstructionResultMatchesJob(result, actualJob, jobSha256);
    assertReconstructionResultCompatibleWithCapability(result, actualJob, capability);
    if (result.status !== "completed" || result.failure !== null || job.progress !== 1) {
      throw new Error("Stored completed reconstruction status is inconsistent.");
    }
    const total = await verifyArtifacts(
      committedRoot,
      result.outputs,
      "",
      actualJob.budget.output_bytes,
      actualJob.budget.max_output_artifacts
    );
    if (total !== result.usage.output_bytes) {
      throw new Error("Stored result byte accounting differs from verified outputs.");
    }
    await assertExactOutputInventory(committedRoot, result.outputs.map((output) => output.path), false);
    await verifyArtifacts(
      jobRoot,
      actualJob.inputs,
      "inputs",
      capability.limits.max_input_bytes,
      capability.limits.max_input_artifacts
    );
    const expectedOutputs: StoredOutput[] = result.outputs.map((output, index) => ({
      attempt: job.attempt,
      relativePath: output.path,
      summary: outputSummary(output, job.attempt, index)
    }));
    if (stableReconstructionJson(expectedOutputs) !== stableReconstructionJson(job.outputs)) {
      throw new Error("Stored output summaries differ from the checksum-bound result.");
    }
  }

  private async persist(job: StoredJob): Promise<void> {
    const durable = structuredClone(job);
    const write = this.persistence.then(() => writeAtomicJson(path.join(this.root, job.jobId, "state.json"), durable));
    this.persistence = write;
    await write;
  }

  private requireWorker(workerId: string): RegisteredWorker {
    assertIdentifier(workerId, "Worker ID");
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error("The requested reconstruction worker is not registered.");
    return worker;
  }

  private requireJob(jobId: string): StoredJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("The reconstruction job was not found.");
    return job;
  }

  private snapshot(): ReconstructionWorkerSnapshot {
    const capabilities = [...this.workers.values()].map((worker) => ({
      ...worker.summary,
      outputRoles: [...worker.summary.outputRoles],
      budget: { ...worker.summary.budget }
    }));
    const job = this.latestJobId ? this.jobs.get(this.latestJobId) ?? null : null;
    const state: ReconstructionWorkerState = job?.state ?? (capabilities.length ? "idle" : "unavailable");
    return {
      state,
      capabilities,
      job: job ? jobSnapshot(job) : null,
      authority: "proposal_only",
      updatedAt: job?.updatedAt ?? null
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(snapshot));
      } catch {
        // A renderer lifecycle race must not alter worker evidence or state.
      }
    }
  }

  private timestamp(): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Reconstruction clock is invalid.");
    return value.toISOString();
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.operation;
    let release = (): void => undefined;
    this.operation = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function jobSnapshot(job: StoredJob): ReconstructionWorkerJobSummary {
  return {
    jobId: job.jobId,
    workerId: job.workerId,
    attempt: job.attempt,
    state: job.state,
    input: { ...job.input },
    progress: job.progress,
    budget: snapshotBudget(job.budget),
    logs: job.logs.map((log) => ({ ...log })),
    outputs: job.outputs.map((output) => ({ ...output.summary })),
    failure: job.failure ? { ...job.failure } : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    authority: "proposal_only"
  };
}

function snapshotBudget(value: ReconstructionJob["budget"]): ReconstructionWorkerBudget {
  return {
    maxWallTimeMs: value.wall_time_ms,
    maxMemoryBytes: value.memory_bytes,
    maxOutputBytes: value.output_bytes,
    maxLogBytes: value.log_bytes,
    maxOutputArtifacts: value.max_output_artifacts
  };
}

function defaultBudget(capability: ContractWorkerCapability): ReconstructionJob["budget"] {
  return {
    wall_time_ms: capability.limits.max_wall_time_ms,
    memory_bytes: capability.limits.max_memory_bytes,
    output_bytes: capability.limits.max_output_bytes,
    log_bytes: capability.limits.max_log_bytes,
    max_output_artifacts: capability.limits.max_output_artifacts
  };
}

function assertBudgetWithinCapability(
  budget: ReconstructionJob["budget"],
  capability: ContractWorkerCapability
): void {
  if (
    !Number.isSafeInteger(budget.wall_time_ms)
    || !Number.isSafeInteger(budget.memory_bytes)
    || !Number.isSafeInteger(budget.output_bytes)
    || !Number.isSafeInteger(budget.log_bytes)
    || !Number.isSafeInteger(budget.max_output_artifacts)
    || budget.wall_time_ms < 1
    || budget.memory_bytes < 1
    || budget.output_bytes < 1
    || budget.log_bytes < 1
    || budget.max_output_artifacts < 1
  ) {
    throw new Error("Reconstruction budget must contain positive safe integers.");
  }
  if (
    budget.wall_time_ms > capability.limits.max_wall_time_ms
    || budget.memory_bytes > capability.limits.max_memory_bytes
    || budget.output_bytes > capability.limits.max_output_bytes
    || budget.log_bytes > capability.limits.max_log_bytes
    || budget.max_output_artifacts > capability.limits.max_output_artifacts
  ) {
    throw new Error("Reconstruction budget exceeds the registered worker capability.");
  }
}

function requireOperation(capability: ContractWorkerCapability, jobKind: string) {
  const operation = capability.operations.find((candidate) => candidate.job_kind === jobKind);
  if (!operation) throw new Error("Registered job kind is not supported by the worker capability.");
  return operation;
}

function assertResultBinding(
  result: ReconstructionResult,
  job: StoredJob,
  worker: RegisteredWorker,
  jobSha256: string
): void {
  if (
    result.job_id !== job.jobId
    || result.attempt !== job.attempt
    || result.job_sha256 !== jobSha256
    || result.worker.worker_id !== job.workerId
    || result.worker.capability_sha256 !== worker.capabilitySha256
    || result.authority !== "proposal_only"
    || result.loaded_world_effect !== "none"
  ) {
    throw new Error("Reconstruction result does not bind the active job and worker.");
  }
}

async function verifyArtifacts(
  root: string,
  artifacts: readonly ReconstructionArtifactReference[],
  requiredPrefix: string,
  maxBytes: number,
  maxArtifacts: number,
  prohibitedNames = new Set<string>()
): Promise<number> {
  if (!artifacts.length || artifacts.length > maxArtifacts) throw new Error("Artifact count exceeds its limit.");
  let total = 0;
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    const relativePath = safeReconstructionRelativePath(artifact.path, "artifact path");
    if (requiredPrefix && !relativePath.startsWith(`${requiredPrefix}/`)) {
      throw new Error(`Artifact path must be rooted under ${requiredPrefix}.`);
    }
    if (prohibitedNames.has(relativePath) || paths.has(relativePath)) throw new Error("Artifact path is duplicated or reserved.");
    paths.add(relativePath);
    await verifyArtifact(root, relativePath, artifact.size_bytes, artifact.sha256);
    total += artifact.size_bytes;
    if (!Number.isSafeInteger(total) || total > maxBytes) throw new Error("Artifact bytes exceed their limit.");
  }
  return total;
}

async function verifyArtifact(
  root: string,
  relativePath: string,
  expectedBytes: number,
  expectedSha256: string
): Promise<void> {
  await assertRealParentChain(root, relativePath);
  const filePath = confinedPath(root, relativePath);
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new Error("Artifact must be one regular non-linked file.");
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== expectedBytes) throw new Error("Artifact size or type differs.");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.byteLength, before.size - offset), offset);
      if (!bytesRead) throw new Error("Artifact ended before its declared size.");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await file.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) {
      throw new Error("Artifact changed during verification.");
    }
    if (`sha256:${hash.digest("hex")}` !== expectedSha256) throw new Error("Artifact checksum differs.");
  } finally {
    await file.close();
  }
}

function outputSummary(
  output: ReconstructionResult["outputs"][number],
  attempt: number,
  index: number
): ReconstructionWorkerOutputSummary {
  return {
    outputId: `output-${String(attempt).padStart(8, "0")}-${String(index + 1).padStart(4, "0")}`,
    role: output.role,
    mediaType: output.media_type,
    sizeBytes: output.size_bytes,
    sha256: output.sha256,
    coordinateFrame: output.coordinate_frame,
    status: "completed",
    previewAvailable: false
  };
}

async function assertExactOutputInventory(
  root: string,
  declaredPaths: readonly string[],
  includeResult = true
): Promise<void> {
  await assertRealDirectory(root, "Reconstruction output directory");
  const expectedFiles = new Set([
    ...(includeResult ? ["result.json"] : []),
    ...declaredPaths.map((value) => safeReconstructionRelativePath(value))
  ]);
  const expectedDirectories = new Set<string>();
  for (const filePath of expectedFiles) {
    const parts = filePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join("/"));
    }
  }
  const foundFiles = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeReconstructionRelativePath(relativePath, "worker output path");
      if (entry.isSymbolicLink()) throw new Error("Worker output inventory contains a symbolic link.");
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(relativePath)) throw new Error("Worker output inventory contains an undeclared directory.");
        await visit(path.join(directory, entry.name), relativePath);
      } else if (entry.isFile()) {
        if (!expectedFiles.has(relativePath)) throw new Error("Worker output inventory contains an undeclared file.");
        foundFiles.add(relativePath);
      } else {
        throw new Error("Worker output inventory contains a special file.");
      }
    }
  };
  await visit(root, "");
  if (foundFiles.size !== expectedFiles.size || [...expectedFiles].some((entry) => !foundFiles.has(entry))) {
    throw new Error("Worker output inventory is missing a declared file.");
  }
}

async function assertOutputStagingBudget(
  jobRoot: string,
  root: string,
  maxBytes: number,
  maxArtifacts: number
): Promise<void> {
  await assertRealDirectory(jobRoot, "Reconstruction job directory");
  await assertRealDirectory(path.join(jobRoot, ".incoming"), "Reconstruction incoming directory");
  await assertRealDirectory(root, "Reconstruction attempt output directory");
  let artifactBytes = 0;
  let artifacts = 0;
  let directories = 0;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeReconstructionRelativePath(relativePath, "worker staging path");
      let info;
      try {
        info = await lstat(path.join(directory, entry.name));
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") continue;
        throw error;
      }
      if (info.isSymbolicLink()) throw new Error("Worker staging contains a symbolic link.");
      if (info.isDirectory()) {
        directories += 1;
        if (directories > Math.max(16, maxArtifacts * 4)) throw new Error("Worker staging contains too many directories.");
        await visit(path.join(directory, entry.name), relativePath);
      } else if (info.isFile()) {
        if (info.nlink !== 1) throw new Error("Worker staging contains a linked file.");
        if (relativePath === "result.json") {
          if (info.size > maxStoredStateBytes) throw new Error("Worker result metadata is oversized.");
        } else {
          artifacts += 1;
          artifactBytes += info.size;
          if (
            artifacts > maxArtifacts + 1
            || !Number.isSafeInteger(artifactBytes)
            || artifactBytes > maxBytes
          ) throw new Error("Worker output staging exceeds its artifact budget.");
        }
      } else {
        throw new Error("Worker staging contains a special file.");
      }
    }
  };
  await visit(root, "");
}

async function assertAttemptDirectoryChain(jobRoot: string, attemptRoot: string, outputRoot: string): Promise<void> {
  await assertRealDirectory(jobRoot, "Reconstruction job directory");
  await assertRealDirectory(path.join(jobRoot, "attempts"), "Reconstruction attempts directory");
  await assertRealDirectory(attemptRoot, "Reconstruction attempt directory");
  await assertRealDirectory(path.join(jobRoot, ".incoming"), "Reconstruction incoming directory");
  await assertRealDirectory(outputRoot, "Reconstruction attempt output directory");
}

async function assertCommittedDirectoryChain(
  jobRoot: string,
  attemptRoot: string,
  committedRoot: string
): Promise<void> {
  await assertRealDirectory(jobRoot, "Reconstruction job directory");
  await assertRealDirectory(path.join(jobRoot, "attempts"), "Reconstruction attempts directory");
  await assertRealDirectory(attemptRoot, "Reconstruction attempt directory");
  await assertRealDirectory(path.join(jobRoot, ".incoming"), "Reconstruction incoming directory");
  await assertRealDirectory(committedRoot, "Committed reconstruction output directory");
}

async function assertRealParentChain(root: string, relativePath: string): Promise<void> {
  const safe = safeReconstructionRelativePath(relativePath, "artifact path");
  await assertRealDirectory(root, "Artifact root directory");
  const parts = safe.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    await assertRealDirectory(current, "Artifact parent directory");
  }
}

async function removeIncomingAttempt(jobRoot: string, attemptName: string): Promise<void> {
  const incomingRoot = path.join(jobRoot, ".incoming");
  try {
    await assertRealDirectory(jobRoot, "Reconstruction job directory");
    await assertRealDirectory(incomingRoot, "Reconstruction incoming directory");
  } catch {
    return;
  }
  const outputRoot = path.join(incomingRoot, attemptName);
  let info;
  try {
    info = await lstat(outputRoot);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink()) {
    await rm(outputRoot, { force: true });
    return;
  }
  if (!info.isDirectory()) throw new Error("Reconstruction attempt output path is not a directory.");
  await rm(outputRoot, { recursive: true, force: true });
}

function appendLog(job: StoredJob, entry: ReconstructionWorkerLogSummary, maxBytes: number): void {
  job.logs.push(entry);
  if (job.logs.length > maxSnapshotLogs) job.logs.splice(0, job.logs.length - maxSnapshotLogs);
  while (Buffer.byteLength(JSON.stringify(job.logs), "utf8") > maxBytes && job.logs.length > 1) job.logs.shift();
}

function sanitizeLog(value: string, jobRoot: string): string {
  return value
    .replaceAll(jobRoot, "<job-root>")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512) || "Worker emitted an empty diagnostic.";
}

function sanitizeSupervisorError(value: string, jobRoot: string, workerRoot: string): string {
  return sanitizeLog(value.replaceAll(workerRoot, "<worker-root>"), jobRoot);
}

function failure(code: string, message: string): ReconstructionWorkerFailure {
  return { code, message: message.slice(0, 512), retryable: true };
}

function normalizeWorkerFailure(
  value: NonNullable<ReconstructionResult["failure"]>,
  jobRoot: string,
  workerRoot: string
): ReconstructionWorkerFailure {
  return {
    code: value.code,
    message: sanitizeSupervisorError(value.message, jobRoot, workerRoot),
    retryable: value.retryable
  };
}

function signalAttempt(active: ActiveAttempt, signal: NodeJS.Signals): "sent" | "missing" | "fallback" {
  if (active.processGroupId === null) {
    try {
      return active.child.kill(signal) ? "sent" : "missing";
    } catch {
      return "fallback";
    }
  }
  try {
    process.kill(-active.processGroupId, signal);
    return "sent";
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") return "missing";
    try {
      active.child.kill(signal);
    } catch {
      // Quiescence still verifies that no descendant can publish output.
    }
    return "fallback";
  }
}

async function quiesceProcessGroup(active: ActiveAttempt, graceMs: number): Promise<boolean> {
  if (active.processGroupId === null || !processGroupExists(active.processGroupId)) return false;
  signalAttempt(active, "SIGTERM");
  if (await waitForProcessGroupExit(active.processGroupId, graceMs)) return true;
  signalAttempt(active, "SIGKILL");
  if (await waitForProcessGroupExit(active.processGroupId, graceMs)) return true;
  throw new Error(active.signalFallback
    ? "Reconstruction worker process group could not be signalled or proven terminated."
    : "Reconstruction worker process group did not terminate after escalation.");
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
    await new Promise((resolve) => setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now()))));
  }
  return true;
}

function decodeStoredJob(value: unknown, jobRoot: string, workerRoot: string): StoredJob {
  if (!isRecord(value)) throw new Error("Stored reconstruction job state is invalid.");
  exactStoredKeys(value, [
    "schema", "authority", "loadedWorldEffect", "jobId", "workerId", "source", "inputs", "input",
    "jobKind", "requestedOutputs", "budget", "capabilitySha256", "attempt", "state", "progress",
    "attemptCreatedAt", "logs", "outputs", "failure", "createdAt", "startedAt", "finishedAt", "updatedAt"
  ]);
  if (value.schema !== storeSchema || value.authority !== "proposal_only" || value.loadedWorldEffect !== "none") {
    throw new Error("Stored reconstruction authority boundary is invalid.");
  }
  if (typeof value.jobId !== "string" || !jobIdPattern.test(value.jobId)) {
    throw new Error("Stored reconstruction job ID is invalid.");
  }
  if (typeof value.workerId !== "string") throw new Error("Stored reconstruction worker ID is invalid.");
  assertIdentifier(value.workerId, "Stored worker ID");
  if (!Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1) {
    throw new Error("Stored reconstruction attempt is invalid.");
  }
  if (typeof value.capabilitySha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.capabilitySha256)) {
    throw new Error("Stored reconstruction capability checksum is invalid.");
  }
  const createdAt = storedTimestamp(value.createdAt, "createdAt");
  const attemptCreatedAt = storedTimestamp(value.attemptCreatedAt, "attemptCreatedAt");
  const updatedAt = storedTimestamp(value.updatedAt, "updatedAt");
  const contractJob = validateReconstructionJob({
    schema: RECONSTRUCTION_JOB_SCHEMA,
    job_id: value.jobId,
    attempt: value.attempt,
    created_at: attemptCreatedAt,
    source: value.source,
    worker: { worker_id: value.workerId, capability_sha256: value.capabilitySha256 },
    job_kind: value.jobKind,
    inputs: value.inputs,
    requested_outputs: value.requestedOutputs,
    budget: value.budget,
    authority: "proposal_only",
    loaded_world_effect: "none"
  });
  const input = validateInputSummary(value.input as ReconstructionWorkerInputSummary, contractJob.source.final_sequence_id);
  if (input.sessionId !== contractJob.source.session_id || input.manifestSha256 !== digest(stableReconstructionJson(contractJob.inputs))) {
    throw new Error("Stored reconstruction input summary differs from its immutable manifest.");
  }
  const state = value.state;
  if (typeof state !== "string" || ![
    "queued", "starting", "running", "stopping", "completed", "failed", "cancelled", "timed_out", "interrupted"
  ].includes(state)) throw new Error("Stored reconstruction state is invalid.");
  const progress = value.progress;
  if (progress !== null && (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1)) {
    throw new Error("Stored reconstruction progress is invalid.");
  }
  const startedAt = value.startedAt === null ? null : storedTimestamp(value.startedAt, "startedAt");
  const finishedAt = value.finishedAt === null ? null : storedTimestamp(value.finishedAt, "finishedAt");
  if (
    Date.parse(attemptCreatedAt) < Date.parse(createdAt)
    || Date.parse(updatedAt) < Date.parse(attemptCreatedAt)
    || (startedAt && Date.parse(startedAt) < Date.parse(attemptCreatedAt))
  ) {
    throw new Error("Stored reconstruction timestamps are inconsistent.");
  }
  if (["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(state) !== (finishedAt !== null)) {
    throw new Error("Stored reconstruction terminal timestamp is inconsistent.");
  }
  const logs = decodeStoredLogs(value.logs, contractJob.budget.log_bytes, jobRoot, workerRoot);
  const outputs = decodeStoredOutputs(value.outputs, contractJob, Number(value.attempt));
  const failureValue = decodeStoredFailure(value.failure, jobRoot, workerRoot);
  if (state === "completed") {
    if (failureValue !== null || !outputs.length) throw new Error("Stored completed reconstruction result is incomplete.");
  } else if (["failed", "cancelled", "timed_out", "interrupted"].includes(state)) {
    if (failureValue === null || outputs.length) throw new Error("Stored failed reconstruction state is inconsistent.");
  } else if (failureValue !== null || outputs.length) {
    throw new Error("Stored active reconstruction state contains terminal evidence.");
  }
  return {
    schema: storeSchema,
    authority: "proposal_only",
    loadedWorldEffect: "none",
    jobId: contractJob.job_id,
    workerId: contractJob.worker.worker_id,
    source: contractJob.source,
    inputs: contractJob.inputs,
    input,
    jobKind: contractJob.job_kind,
    requestedOutputs: contractJob.requested_outputs,
    budget: contractJob.budget,
    capabilitySha256: contractJob.worker.capability_sha256,
    attempt: contractJob.attempt,
    attemptCreatedAt,
    state: state as StoredJob["state"],
    progress: progress as number | null,
    logs,
    outputs,
    failure: failureValue,
    createdAt,
    startedAt,
    finishedAt,
    updatedAt
  };
}

function decodeStoredLogs(
  value: unknown,
  maxBytes: number,
  jobRoot: string,
  workerRoot: string
): ReconstructionWorkerLogSummary[] {
  if (!Array.isArray(value) || value.length > maxSnapshotLogs || Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    throw new Error("Stored reconstruction logs exceed their bounds.");
  }
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Stored reconstruction log is invalid.");
    exactStoredKeys(item, ["sequenceId", "timestamp", "level", "code", "message"]);
    if (!Number.isSafeInteger(item.sequenceId) || Number(item.sequenceId) < 1) throw new Error("Stored log sequence is invalid.");
    const level = item.level;
    if (typeof level !== "string" || !["debug", "info", "warning", "error"].includes(level)) {
      throw new Error("Stored log level is invalid.");
    }
    if (typeof item.code !== "string") throw new Error("Stored log code is invalid.");
    assertIdentifier(item.code, "Stored log code");
    const message = storedDiagnostic(item.message, jobRoot, workerRoot);
    return {
      sequenceId: Number(item.sequenceId),
      timestamp: storedTimestamp(item.timestamp, "log timestamp"),
      level: level as ReconstructionWorkerLogSummary["level"],
      code: item.code,
      message
    };
  });
}

function decodeStoredOutputs(
  value: unknown,
  job: ReconstructionJob,
  attempt: number
): StoredOutput[] {
  if (!Array.isArray(value) || value.length > job.budget.max_output_artifacts) {
    throw new Error("Stored reconstruction outputs exceed their count bound.");
  }
  let total = 0;
  const outputIds = new Set<string>();
  const relativePaths = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Stored reconstruction output is invalid.");
    exactStoredKeys(item, ["summary", "attempt", "relativePath"]);
    if (item.attempt !== attempt || !isRecord(item.summary)) throw new Error("Stored output attempt is invalid.");
    exactStoredKeys(item.summary, [
      "outputId", "role", "mediaType", "sizeBytes", "sha256", "coordinateFrame", "status", "previewAvailable"
    ]);
    const summary = item.summary;
    if (typeof summary.outputId !== "string" || !/^output-[0-9]{8}-[0-9]{4}$/.test(summary.outputId) || outputIds.has(summary.outputId)) {
      throw new Error("Stored output ID is invalid or duplicated.");
    }
    outputIds.add(summary.outputId);
    if (typeof summary.role !== "string" || !job.requested_outputs.includes(summary.role)) throw new Error("Stored output role is invalid.");
    if (typeof summary.mediaType !== "string" || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(summary.mediaType)) {
      throw new Error("Stored output media type is invalid.");
    }
    if (!Number.isSafeInteger(summary.sizeBytes) || Number(summary.sizeBytes) < 1) throw new Error("Stored output size is invalid.");
    if (typeof summary.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(summary.sha256)) throw new Error("Stored output checksum is invalid.");
    if (summary.coordinateFrame !== null && (typeof summary.coordinateFrame !== "string" || !identifierPattern.test(summary.coordinateFrame))) {
      throw new Error("Stored output coordinate frame is invalid.");
    }
    if (summary.status !== "completed" || summary.previewAvailable !== false) throw new Error("Stored output inspection state is invalid.");
    if (typeof item.relativePath !== "string") throw new Error("Stored output path is invalid.");
    const relativePath = safeReconstructionRelativePath(item.relativePath, "stored output path");
    if (relativePaths.has(relativePath)) throw new Error("Stored output path is duplicated.");
    relativePaths.add(relativePath);
    total += Number(summary.sizeBytes);
    if (!Number.isSafeInteger(total) || total > job.budget.output_bytes) throw new Error("Stored outputs exceed their byte budget.");
    return {
      attempt,
      relativePath,
      summary: {
        outputId: summary.outputId,
        role: summary.role,
        mediaType: summary.mediaType,
        sizeBytes: Number(summary.sizeBytes),
        sha256: summary.sha256,
        coordinateFrame: summary.coordinateFrame,
        status: "completed",
        previewAvailable: false
      }
    };
  });
}

function decodeStoredFailure(
  value: unknown,
  jobRoot: string,
  workerRoot: string
): ReconstructionWorkerFailure | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Stored reconstruction failure is invalid.");
  exactStoredKeys(value, ["code", "message", "retryable"]);
  if (typeof value.code !== "string") throw new Error("Stored failure code is invalid.");
  assertIdentifier(value.code, "Stored failure code");
  if (typeof value.retryable !== "boolean") throw new Error("Stored failure retryability is invalid.");
  return {
    code: value.code,
    message: storedDiagnostic(value.message, jobRoot, workerRoot),
    retryable: value.retryable
  };
}

function storedDiagnostic(value: unknown, jobRoot: string, workerRoot: string): string {
  if (typeof value !== "string" || !value || value.length > 512 || value !== value.trim()) {
    throw new Error("Stored reconstruction diagnostic is invalid.");
  }
  if (value.includes(jobRoot) || value.includes(workerRoot) || sanitizeLog(value, jobRoot) !== value) {
    throw new Error("Stored reconstruction diagnostic contains unsafe content.");
  }
  return value;
}

function storedTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(value)) {
    throw new Error(`Stored reconstruction ${label} is invalid.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(`Stored reconstruction ${label} is invalid.`);
  return value;
}

function exactStoredKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error("Stored reconstruction state has unexpected fields.");
  }
}

async function readBoundedJson(filePath: string): Promise<unknown> {
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maxStoredStateBytes) {
      throw new Error("Reconstruction JSON file is invalid or oversized.");
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await file.read(bytes, offset, bytes.byteLength - offset, offset);
      if (!bytesRead) throw new Error("Reconstruction JSON file ended unexpectedly.");
      offset += bytesRead;
    }
    const after = await file.stat();
    if (after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("Reconstruction JSON file changed during verification.");
    }
    return parseReconstructionJson(decodeUtf8(bytes, "Reconstruction JSON file"));
  } finally {
    await file.close();
  }
}

async function writeAtomicJson(filePath: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > maxStoredStateBytes) {
    throw new Error("Reconstruction state exceeds its durable storage bound.");
  }
  await writeAtomicText(filePath, text);
}

async function writeAtomicText(filePath: string, value: string): Promise<void> {
  const directory = path.dirname(filePath);
  await assertRealDirectory(directory, "Reconstruction state parent");
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    const file = await open(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await file.writeFile(value, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tempPath, filePath);
    await chmod(filePath, 0o600);
    await syncDirectory(directory);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function assertRealDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory.`);
}

async function assertRegisteredExecutable(executable: string): Promise<void> {
  const info = await lstat(executable);
  if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o111) === 0) {
    throw new Error("Registered reconstruction worker executable must be a real executable file.");
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function confinedPath(root: string, relativePath: string): string {
  const safe = safeReconstructionRelativePath(relativePath, "artifact path");
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, safe);
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Artifact path escapes its job root.");
  return candidate;
}

function minimalEnvironment(additions: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" };
  for (const [key, value] of Object.entries(additions ?? {})) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || value.includes("\0")) throw new Error("Registered worker environment is invalid.");
    if (["NODE_OPTIONS", "PYTHONPATH", "PYTHONHOME"].includes(key) || key.startsWith("DYLD_")) {
      throw new Error("Registered worker environment contains a prohibited loader override.");
    }
    env[key] = value;
  }
  return env;
}

function assertJobId(value: string): void {
  if (!jobIdPattern.test(value)) throw new Error("Reconstruction job ID is invalid.");
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`);
}

function validateInputSummary(
  value: ReconstructionWorkerInputSummary,
  finalSequenceId: number | null
): ReconstructionWorkerInputSummary {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "frameCount,manifestSha256,sessionId,throughSequenceId") {
    throw new Error("Staged reconstruction input summary is invalid.");
  }
  assertIdentifier(value.sessionId, "Staged session ID");
  if (
    !Number.isSafeInteger(value.throughSequenceId)
    || value.throughSequenceId < 1
    || !Number.isSafeInteger(value.frameCount)
    || value.frameCount < 1
    || value.frameCount > value.throughSequenceId
    || (finalSequenceId !== null && value.throughSequenceId > finalSequenceId)
    || !/^sha256:[0-9a-f]{64}$/.test(value.manifestSha256)
  ) {
    throw new Error("Staged reconstruction input summary is invalid.");
  }
  return {
    sessionId: value.sessionId,
    throughSequenceId: value.throughSequenceId,
    frameCount: value.frameCount,
    manifestSha256: value.manifestSha256
  };
}

function digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function decodeUtf8(value: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const spawnWorker: ReconstructionWorkerSpawn = (executable, args, options) => spawn(
  executable,
  [...args],
  {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  }
) as ReconstructionWorkerChildProcess;
