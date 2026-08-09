import { createHash } from "node:crypto";

export const RECONSTRUCTION_WORKER_CAPABILITY_SCHEMA =
  "world_studio.reconstruction_worker_capability.v0.1" as const;
export const RECONSTRUCTION_JOB_SCHEMA = "world_studio.reconstruction_job.v0.1" as const;
export const RECONSTRUCTION_EVENT_SCHEMA = "world_studio.reconstruction_event.v0.1" as const;
export const RECONSTRUCTION_RESULT_SCHEMA = "world_studio.reconstruction_result.v0.1" as const;

export type ReconstructionWorkerState =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

export type ReconstructionWorkerResultStatus = Extract<
  ReconstructionWorkerState,
  "completed" | "failed" | "cancelled" | "timed_out" | "interrupted"
>;

export type ReconstructionEventKind = "state" | "log" | "progress" | "artifact";
export type ReconstructionLogLevel = "debug" | "info" | "warning" | "error";

export interface ReconstructionArtifactReference {
  role: string;
  path: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
}

export interface ReconstructionOutputArtifactReference extends ReconstructionArtifactReference {
  coordinate_frame: string | null;
}

export interface ReconstructionWorkerCapability {
  schema: typeof RECONSTRUCTION_WORKER_CAPABILITY_SCHEMA;
  worker_id: string;
  reported_at: string;
  protocol: {
    name: "world_studio.reconstruction_worker";
    version: "0.1";
  };
  implementation: {
    id: string;
    version: string;
    build_sha256: string | null;
  };
  operations: Array<{
    job_kind: string;
    inputs: Array<{ role: string; media_types: string[] }>;
    outputs: Array<{ role: string; media_types: string[]; progressive: boolean }>;
  }>;
  limits: {
    max_input_artifacts: number;
    max_input_bytes: number;
    max_output_artifacts: number;
    max_output_bytes: number;
    max_wall_time_ms: number;
    max_memory_bytes: number;
    max_log_bytes: number;
    max_parallel_jobs: number;
  };
  authority: "proposal_only";
}

export interface ReconstructionJob {
  schema: typeof RECONSTRUCTION_JOB_SCHEMA;
  job_id: string;
  attempt: number;
  created_at: string;
  source: {
    session_id: string;
    live_session_schema: "capture_splat.live_session.v0.1" | "capture_splat.live_session.v0.2";
    final_sequence_id: number | null;
  };
  worker: {
    worker_id: string;
    capability_sha256: string;
  };
  job_kind: string;
  inputs: ReconstructionArtifactReference[];
  requested_outputs: string[];
  budget: {
    wall_time_ms: number;
    memory_bytes: number;
    output_bytes: number;
    log_bytes: number;
    max_output_artifacts: number;
  };
  authority: "proposal_only";
  loaded_world_effect: "none";
}

export interface ReconstructionEvent {
  schema: typeof RECONSTRUCTION_EVENT_SCHEMA;
  job_id: string;
  attempt: number;
  sequence_id: number;
  timestamp: string;
  kind: ReconstructionEventKind;
  state: ReconstructionWorkerState;
  level: ReconstructionLogLevel | null;
  message: string | null;
  progress: number | null;
  artifact: ReconstructionOutputArtifactReference | null;
  authority: "proposal_only";
}

export interface ReconstructionResult {
  schema: typeof RECONSTRUCTION_RESULT_SCHEMA;
  job_id: string;
  attempt: number;
  status: ReconstructionWorkerResultStatus;
  started_at: string;
  finished_at: string;
  worker: {
    worker_id: string;
    capability_sha256: string;
  };
  job_sha256: string;
  outputs: ReconstructionOutputArtifactReference[];
  usage: {
    wall_time_ms: number;
    peak_memory_bytes: number;
    output_bytes: number;
    output_artifacts: number;
    log_bytes: number;
  };
  failure: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
  authority: "proposal_only";
  loaded_world_effect: "none";
}

export class ReconstructionContractError extends Error {
  readonly code: "bad_request" | "conflict" | "corrupt";

  constructor(message: string, code: ReconstructionContractError["code"] = "bad_request") {
    super(message);
    this.name = "ReconstructionContractError";
    this.code = code;
  }
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const timestampPattern = /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const maxSafeInteger = Number.MAX_SAFE_INTEGER;

const allWorkerStates: ReconstructionWorkerState[] = [
  "queued",
  "starting",
  "running",
  "stopping",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted"
];
const terminalWorkerStates = new Set<ReconstructionWorkerState>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted"
]);

export function parseReconstructionJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReconstructionContractError("Worker payload must be complete, strict JSON.");
  }
}

export function validateReconstructionWorkerCapability(value: unknown): ReconstructionWorkerCapability {
  const capability = record(value, "capability");
  exactKeys(capability, [
    "schema",
    "worker_id",
    "reported_at",
    "protocol",
    "implementation",
    "operations",
    "limits",
    "authority"
  ], "capability");
  literal(capability.schema, RECONSTRUCTION_WORKER_CAPABILITY_SCHEMA, "capability.schema");
  literal(capability.authority, "proposal_only", "capability.authority");

  const protocol = record(capability.protocol, "capability.protocol");
  exactKeys(protocol, ["name", "version"], "capability.protocol");
  literal(protocol.name, "world_studio.reconstruction_worker", "capability.protocol.name");
  literal(protocol.version, "0.1", "capability.protocol.version");

  const implementation = record(capability.implementation, "capability.implementation");
  exactKeys(implementation, ["id", "version", "build_sha256"], "capability.implementation");
  const buildSha256 = implementation.build_sha256 === null
    ? null
    : validSha256(implementation.build_sha256, "capability.implementation.build_sha256");

  const operations = boundedArray(capability.operations, "capability.operations", 1, 64)
    .map((operationValue, operationIndex) => {
      const label = `capability.operations[${operationIndex}]`;
      const operation = record(operationValue, label);
      exactKeys(operation, ["job_kind", "inputs", "outputs"], label);
      const inputs = boundedArray(operation.inputs, `${label}.inputs`, 1, 64)
        .map((inputValue, inputIndex) => validateMediaRole(
          inputValue,
          `${label}.inputs[${inputIndex}]`,
          false
        ));
      const outputs = boundedArray(operation.outputs, `${label}.outputs`, 1, 64)
        .map((outputValue, outputIndex) => validateMediaRole(
          outputValue,
          `${label}.outputs[${outputIndex}]`,
          true
        ));
      assertUnique(inputs.map((input) => input.role), `${label}.inputs roles`);
      assertUnique(outputs.map((output) => output.role), `${label}.outputs roles`);
      return {
        job_kind: validIdentifier(operation.job_kind, `${label}.job_kind`),
        inputs: inputs.map(({ role, media_types }) => ({ role, media_types })),
        outputs: outputs.map(({ role, media_types, progressive }) => ({
          role,
          media_types,
          progressive: progressive!
        }))
      };
    });
  assertUnique(operations.map((operation) => operation.job_kind), "capability.operations job kinds");

  const limits = record(capability.limits, "capability.limits");
  exactKeys(limits, [
    "max_input_artifacts",
    "max_input_bytes",
    "max_output_artifacts",
    "max_output_bytes",
    "max_wall_time_ms",
    "max_memory_bytes",
    "max_log_bytes",
    "max_parallel_jobs"
  ], "capability.limits");

  return {
    schema: RECONSTRUCTION_WORKER_CAPABILITY_SCHEMA,
    worker_id: validIdentifier(capability.worker_id, "capability.worker_id"),
    reported_at: validTimestamp(capability.reported_at, "capability.reported_at"),
    protocol: { name: "world_studio.reconstruction_worker", version: "0.1" },
    implementation: {
      id: validIdentifier(implementation.id, "capability.implementation.id"),
      version: validString(implementation.version, "capability.implementation.version", 128),
      build_sha256: buildSha256
    },
    operations,
    limits: {
      max_input_artifacts: boundedInteger(limits.max_input_artifacts, "capability.limits.max_input_artifacts", 1, 65_536),
      max_input_bytes: positiveSafeInteger(limits.max_input_bytes, "capability.limits.max_input_bytes"),
      max_output_artifacts: boundedInteger(limits.max_output_artifacts, "capability.limits.max_output_artifacts", 1, 1_024),
      max_output_bytes: positiveSafeInteger(limits.max_output_bytes, "capability.limits.max_output_bytes"),
      max_wall_time_ms: boundedInteger(limits.max_wall_time_ms, "capability.limits.max_wall_time_ms", 1, 86_400_000),
      max_memory_bytes: positiveSafeInteger(limits.max_memory_bytes, "capability.limits.max_memory_bytes"),
      max_log_bytes: positiveSafeInteger(limits.max_log_bytes, "capability.limits.max_log_bytes"),
      max_parallel_jobs: boundedInteger(limits.max_parallel_jobs, "capability.limits.max_parallel_jobs", 1, 64)
    },
    authority: "proposal_only"
  };
}

export function validateReconstructionJob(value: unknown): ReconstructionJob {
  const job = record(value, "job");
  exactKeys(job, [
    "schema",
    "job_id",
    "attempt",
    "created_at",
    "source",
    "worker",
    "job_kind",
    "inputs",
    "requested_outputs",
    "budget",
    "authority",
    "loaded_world_effect"
  ], "job");
  literal(job.schema, RECONSTRUCTION_JOB_SCHEMA, "job.schema");
  literal(job.authority, "proposal_only", "job.authority");
  literal(job.loaded_world_effect, "none", "job.loaded_world_effect");

  const source = record(job.source, "job.source");
  exactKeys(source, ["session_id", "live_session_schema", "final_sequence_id"], "job.source");
  literalOneOf(
    source.live_session_schema,
    ["capture_splat.live_session.v0.1", "capture_splat.live_session.v0.2"],
    "job.source.live_session_schema"
  );
  const finalSequenceId = source.final_sequence_id === null
    ? null
    : positiveSafeInteger(source.final_sequence_id, "job.source.final_sequence_id");

  const worker = record(job.worker, "job.worker");
  exactKeys(worker, ["worker_id", "capability_sha256"], "job.worker");

  const inputs = boundedArray(job.inputs, "job.inputs", 1, 65_536)
    .map((input, index) => validateArtifactReference(input, `job.inputs[${index}]`, false));
  assertUnique(inputs.map((input) => input.path), "job.inputs paths");

  const requestedOutputs = boundedArray(job.requested_outputs, "job.requested_outputs", 1, 64)
    .map((output, index) => validIdentifier(output, `job.requested_outputs[${index}]`));
  assertUnique(requestedOutputs, "job.requested_outputs");

  const budget = record(job.budget, "job.budget");
  exactKeys(budget, [
    "wall_time_ms",
    "memory_bytes",
    "output_bytes",
    "log_bytes",
    "max_output_artifacts"
  ], "job.budget");

  return {
    schema: RECONSTRUCTION_JOB_SCHEMA,
    job_id: validIdentifier(job.job_id, "job.job_id"),
    attempt: positiveSafeInteger(job.attempt, "job.attempt"),
    created_at: validTimestamp(job.created_at, "job.created_at"),
    source: {
      session_id: validIdentifier(source.session_id, "job.source.session_id"),
      live_session_schema: source.live_session_schema as ReconstructionJob["source"]["live_session_schema"],
      final_sequence_id: finalSequenceId
    },
    worker: {
      worker_id: validIdentifier(worker.worker_id, "job.worker.worker_id"),
      capability_sha256: validSha256(worker.capability_sha256, "job.worker.capability_sha256")
    },
    job_kind: validIdentifier(job.job_kind, "job.job_kind"),
    inputs,
    requested_outputs: requestedOutputs,
    budget: {
      wall_time_ms: boundedInteger(budget.wall_time_ms, "job.budget.wall_time_ms", 1, 86_400_000),
      memory_bytes: positiveSafeInteger(budget.memory_bytes, "job.budget.memory_bytes"),
      output_bytes: positiveSafeInteger(budget.output_bytes, "job.budget.output_bytes"),
      log_bytes: positiveSafeInteger(budget.log_bytes, "job.budget.log_bytes"),
      max_output_artifacts: boundedInteger(budget.max_output_artifacts, "job.budget.max_output_artifacts", 1, 1_024)
    },
    authority: "proposal_only",
    loaded_world_effect: "none"
  };
}

export function validateReconstructionEvent(value: unknown): ReconstructionEvent {
  const event = record(value, "event");
  exactKeys(event, [
    "schema",
    "job_id",
    "attempt",
    "sequence_id",
    "timestamp",
    "kind",
    "state",
    "level",
    "message",
    "progress",
    "artifact",
    "authority"
  ], "event");
  literal(event.schema, RECONSTRUCTION_EVENT_SCHEMA, "event.schema");
  literal(event.authority, "proposal_only", "event.authority");
  literalOneOf(event.kind, ["state", "log", "progress", "artifact"], "event.kind");
  literalOneOf(event.state, allWorkerStates, "event.state");
  const level = event.level === null
    ? null
    : literalOneOf(event.level, ["debug", "info", "warning", "error"], "event.level") as ReconstructionLogLevel;
  const message = event.message === null
    ? null
    : validString(event.message, "event.message", 4_096, true);
  const progress = event.progress === null
    ? null
    : boundedFinite(event.progress, "event.progress", 0, 1);
  const artifact = event.artifact === null
    ? null
    : validateArtifactReference(event.artifact, "event.artifact", true);
  const kind = event.kind as ReconstructionEventKind;
  const state = event.state as ReconstructionWorkerState;

  if (kind === "state" && (level !== null || progress !== null || artifact !== null)) {
    throw new ReconstructionContractError("State events cannot carry level, progress, or artifact fields.");
  }
  if (kind === "log" && (level === null || message === null || progress !== null || artifact !== null)) {
    throw new ReconstructionContractError("Log events require level and message only.");
  }
  if (kind === "progress" && (state !== "running" || level !== null || progress === null || artifact !== null)) {
    throw new ReconstructionContractError("Progress events require running state and a finite progress value only.");
  }
  if (kind === "artifact" && (state !== "running" || level !== null || progress !== null || artifact === null)) {
    throw new ReconstructionContractError("Artifact events require running state and one checksum-bound artifact only.");
  }

  return {
    schema: RECONSTRUCTION_EVENT_SCHEMA,
    job_id: validIdentifier(event.job_id, "event.job_id"),
    attempt: positiveSafeInteger(event.attempt, "event.attempt"),
    sequence_id: positiveSafeInteger(event.sequence_id, "event.sequence_id"),
    timestamp: validTimestamp(event.timestamp, "event.timestamp"),
    kind,
    state,
    level,
    message,
    progress,
    artifact,
    authority: "proposal_only"
  };
}

export function validateReconstructionResult(value: unknown): ReconstructionResult {
  const result = record(value, "result");
  exactKeys(result, [
    "schema",
    "job_id",
    "attempt",
    "status",
    "started_at",
    "finished_at",
    "worker",
    "job_sha256",
    "outputs",
    "usage",
    "failure",
    "authority",
    "loaded_world_effect"
  ], "result");
  literal(result.schema, RECONSTRUCTION_RESULT_SCHEMA, "result.schema");
  literal(result.authority, "proposal_only", "result.authority");
  literal(result.loaded_world_effect, "none", "result.loaded_world_effect");
  literalOneOf(
    result.status,
    ["completed", "failed", "cancelled", "timed_out", "interrupted"],
    "result.status"
  );
  const startedAt = validTimestamp(result.started_at, "result.started_at");
  const finishedAt = validTimestamp(result.finished_at, "result.finished_at");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new ReconstructionContractError("result.finished_at cannot precede result.started_at.");
  }

  const worker = record(result.worker, "result.worker");
  exactKeys(worker, ["worker_id", "capability_sha256"], "result.worker");
  const outputs = boundedArray(result.outputs, "result.outputs", 0, 1_024)
    .map((output, index) => validateArtifactReference(output, `result.outputs[${index}]`, true));
  assertUnique(outputs.map((output) => output.path), "result.outputs paths");

  const usage = record(result.usage, "result.usage");
  exactKeys(usage, [
    "wall_time_ms",
    "peak_memory_bytes",
    "output_bytes",
    "output_artifacts",
    "log_bytes"
  ], "result.usage");
  const outputBytes = nonNegativeSafeInteger(usage.output_bytes, "result.usage.output_bytes");
  const outputArtifacts = boundedInteger(usage.output_artifacts, "result.usage.output_artifacts", 0, 1_024);
  if (outputBytes !== safeSum(outputs.map((output) => output.size_bytes), "result.outputs sizes")) {
    throw new ReconstructionContractError("result.usage.output_bytes must equal committed output bytes.");
  }
  if (outputArtifacts !== outputs.length) {
    throw new ReconstructionContractError("result.usage.output_artifacts must equal committed output count.");
  }

  let failure: ReconstructionResult["failure"] = null;
  if (result.failure !== null) {
    const failureValue = record(result.failure, "result.failure");
    exactKeys(failureValue, ["code", "message", "retryable"], "result.failure");
    if (typeof failureValue.retryable !== "boolean") {
      throw new ReconstructionContractError("result.failure.retryable must be boolean.");
    }
    failure = {
      code: validIdentifier(failureValue.code, "result.failure.code"),
      message: validString(failureValue.message, "result.failure.message", 4_096, true),
      retryable: failureValue.retryable
    };
  }
  const status = result.status as ReconstructionWorkerResultStatus;
  if (status === "completed" && (failure !== null || outputs.length === 0)) {
    throw new ReconstructionContractError("Completed results require outputs and cannot carry failure metadata.");
  }
  if (status !== "completed" && (failure === null || outputs.length !== 0)) {
    throw new ReconstructionContractError("Non-completed results require failure metadata and cannot publish outputs.");
  }

  return {
    schema: RECONSTRUCTION_RESULT_SCHEMA,
    job_id: validIdentifier(result.job_id, "result.job_id"),
    attempt: positiveSafeInteger(result.attempt, "result.attempt"),
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    worker: {
      worker_id: validIdentifier(worker.worker_id, "result.worker.worker_id"),
      capability_sha256: validSha256(worker.capability_sha256, "result.worker.capability_sha256")
    },
    job_sha256: validSha256(result.job_sha256, "result.job_sha256"),
    outputs,
    usage: {
      wall_time_ms: nonNegativeSafeInteger(usage.wall_time_ms, "result.usage.wall_time_ms"),
      peak_memory_bytes: nonNegativeSafeInteger(usage.peak_memory_bytes, "result.usage.peak_memory_bytes"),
      output_bytes: outputBytes,
      output_artifacts: outputArtifacts,
      log_bytes: nonNegativeSafeInteger(usage.log_bytes, "result.usage.log_bytes")
    },
    failure,
    authority: "proposal_only",
    loaded_world_effect: "none"
  };
}

export function assertReconstructionJobCompatible(
  job: ReconstructionJob,
  capability: ReconstructionWorkerCapability
): void {
  if (job.worker.worker_id !== capability.worker_id) {
    throw new ReconstructionContractError("Job worker_id differs from the capability report.", "conflict");
  }
  if (job.worker.capability_sha256 !== reconstructionPayloadSha256(capability)) {
    throw new ReconstructionContractError("Job capability checksum differs from the canonical capability report.", "conflict");
  }
  const operation = capability.operations.find((candidate) => candidate.job_kind === job.job_kind);
  if (!operation) {
    throw new ReconstructionContractError("Job kind is not supported by the worker.", "conflict");
  }
  if (job.inputs.length > capability.limits.max_input_artifacts) {
    throw new ReconstructionContractError("Job input artifact count exceeds worker capability.", "conflict");
  }
  if (safeSum(job.inputs.map((input) => input.size_bytes), "job input sizes") > capability.limits.max_input_bytes) {
    throw new ReconstructionContractError("Job input bytes exceed worker capability.", "conflict");
  }
  for (const input of job.inputs) {
    const supported = operation.inputs.find((candidate) => candidate.role === input.role);
    if (!supported || !supported.media_types.includes(input.media_type)) {
      throw new ReconstructionContractError(`Worker does not support input ${input.role} as ${input.media_type}.`, "conflict");
    }
  }
  const outputRoles = new Set(operation.outputs.map((output) => output.role));
  if (job.requested_outputs.some((role) => !outputRoles.has(role))) {
    throw new ReconstructionContractError("Job requests an unsupported output role.", "conflict");
  }
  if (
    job.budget.wall_time_ms > capability.limits.max_wall_time_ms
    || job.budget.memory_bytes > capability.limits.max_memory_bytes
    || job.budget.output_bytes > capability.limits.max_output_bytes
    || job.budget.log_bytes > capability.limits.max_log_bytes
    || job.budget.max_output_artifacts > capability.limits.max_output_artifacts
  ) {
    throw new ReconstructionContractError("Job resource budget exceeds worker capability.", "conflict");
  }
}

export function assertReconstructionEventMatchesJob(
  event: ReconstructionEvent,
  job: ReconstructionJob
): void {
  if (event.job_id !== job.job_id) {
    throw new ReconstructionContractError("Event job_id differs from the job.", "conflict");
  }
  if (event.attempt !== job.attempt) {
    throw new ReconstructionContractError("Event attempt differs from the job.", "conflict");
  }
  if (event.artifact && !job.requested_outputs.includes(event.artifact.role)) {
    throw new ReconstructionContractError("Event publishes an unrequested output role.", "conflict");
  }
}

export function assertReconstructionEventCompatibleWithCapability(
  event: ReconstructionEvent,
  job: ReconstructionJob,
  capability: ReconstructionWorkerCapability
): void {
  assertReconstructionEventMatchesJob(event, job);
  if (event.artifact) assertOutputArtifactsSupported([event.artifact], job, capability);
}

export function validateReconstructionEventSequence(values: unknown[]): ReconstructionEvent[] {
  if (!Array.isArray(values) || values.length < 2 || values.length > 100_000) {
    throw new ReconstructionContractError("Worker event sequence must contain 2 to 100000 events.");
  }
  const events = values.map(validateReconstructionEvent);
  const first = events[0];
  if (first.sequence_id !== 1 || first.kind !== "state" || first.state !== "running") {
    throw new ReconstructionContractError("External worker event sequence must begin with running state event 1.");
  }
  const jobId = first.job_id;
  const attempt = first.attempt;
  let progress = 0;
  const artifactPaths = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (event.job_id !== jobId || event.attempt !== attempt || event.sequence_id !== index + 1) {
      throw new ReconstructionContractError("Worker events must keep one job/attempt and contiguous sequence IDs.");
    }
    if (index === 0) continue;
    const isLast = index === events.length - 1;
    if (isLast) {
      if (event.kind !== "state" || !isTerminalReconstructionWorkerState(event.state)) {
        throw new ReconstructionContractError("External worker event sequence must end with exactly one terminal state event.");
      }
      continue;
    }
    if (event.kind === "state" || event.state !== "running") {
      throw new ReconstructionContractError("External worker events between boundaries must be running log, progress, or artifact events.");
    }
    if (event.kind === "progress") {
      if (event.progress! < progress) {
        throw new ReconstructionContractError("Worker progress cannot move backwards.");
      }
      progress = event.progress!;
    }
    if (event.artifact) {
      if (artifactPaths.has(event.artifact.path)) {
        throw new ReconstructionContractError("Worker artifact paths are immutable and cannot be reused.");
      }
      artifactPaths.add(event.artifact.path);
    }
  }
  return events;
}

export function assertReconstructionResultMatchesEventSequence(
  result: ReconstructionResult,
  values: unknown[]
): void {
  const events = validateReconstructionEventSequence(values);
  const first = events[0];
  const terminal = events[events.length - 1];
  if (
    result.job_id !== first.job_id
    || result.attempt !== first.attempt
    || result.status !== terminal.state
  ) {
    throw new ReconstructionContractError("Result identity or status differs from the terminal worker event.", "conflict");
  }
}

export function assertReconstructionResultMatchesJob(
  result: ReconstructionResult,
  job: ReconstructionJob,
  jobSha256: string
): void {
  const expectedJobSha256 = validSha256(jobSha256, "jobSha256");
  const canonicalJobSha256 = reconstructionPayloadSha256(job);
  if (
    expectedJobSha256 !== canonicalJobSha256
    || result.job_id !== job.job_id
    || result.attempt !== job.attempt
    || result.worker.worker_id !== job.worker.worker_id
    || result.worker.capability_sha256 !== job.worker.capability_sha256
    || result.job_sha256 !== expectedJobSha256
  ) {
    throw new ReconstructionContractError("Result identity or input binding differs from the job.", "conflict");
  }
  if (result.outputs.some((output) => !job.requested_outputs.includes(output.role))) {
    throw new ReconstructionContractError("Result publishes an unrequested output role.", "conflict");
  }
  const publishedRoles = new Set(result.outputs.map((output) => output.role));
  if (result.status === "completed" && job.requested_outputs.some((role) => !publishedRoles.has(role))) {
    throw new ReconstructionContractError("Completed result is missing a requested output role.", "conflict");
  }
  if (
    result.usage.wall_time_ms > job.budget.wall_time_ms
    || result.usage.peak_memory_bytes > job.budget.memory_bytes
    || result.usage.output_bytes > job.budget.output_bytes
    || result.usage.output_artifacts > job.budget.max_output_artifacts
    || result.usage.log_bytes > job.budget.log_bytes
  ) {
    throw new ReconstructionContractError("Result exceeds the immutable job budget.", "conflict");
  }
}

export function assertReconstructionResultCompatibleWithCapability(
  result: ReconstructionResult,
  job: ReconstructionJob,
  capability: ReconstructionWorkerCapability
): void {
  assertOutputArtifactsSupported(result.outputs, job, capability);
}

export function isTerminalReconstructionWorkerState(state: ReconstructionWorkerState): boolean {
  return terminalWorkerStates.has(state);
}

export function safeReconstructionRelativePath(value: unknown, label = "path"): string {
  if (typeof value === "string" && value.includes("\0")) {
    throw new ReconstructionContractError(`${label} must be a safe POSIX-relative path.`);
  }
  const text = validString(value, label, 1_024);
  if (
    text.startsWith("/")
    || text.includes("\\")
    || text.includes("\0")
    || text.includes("//")
    || text.endsWith("/")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)
  ) {
    throw new ReconstructionContractError(`${label} must be a safe POSIX-relative path.`);
  }
  const parts = text.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ReconstructionContractError(`${label} must be a safe POSIX-relative path.`);
  }
  return text;
}

export function stableReconstructionJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function reconstructionPayloadSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableReconstructionJson(value), "utf8").digest("hex")}`;
}

function validateMediaRole(
  value: unknown,
  label: string,
  output: boolean
): { role: string; media_types: string[]; progressive?: boolean } {
  const mediaRole = record(value, label);
  exactKeys(mediaRole, output ? ["role", "media_types", "progressive"] : ["role", "media_types"], label);
  const mediaTypes = boundedArray(mediaRole.media_types, `${label}.media_types`, 1, 32)
    .map((mediaType, index) => validMediaType(mediaType, `${label}.media_types[${index}]`));
  assertUnique(mediaTypes, `${label}.media_types`);
  if (output && typeof mediaRole.progressive !== "boolean") {
    throw new ReconstructionContractError(`${label}.progressive must be boolean.`);
  }
  return {
    role: validIdentifier(mediaRole.role, `${label}.role`),
    media_types: mediaTypes,
    ...(output ? { progressive: mediaRole.progressive as boolean } : {})
  };
}

function validateArtifactReference(
  value: unknown,
  label: string,
  output: false
): ReconstructionArtifactReference;
function validateArtifactReference(
  value: unknown,
  label: string,
  output: true
): ReconstructionOutputArtifactReference;
function validateArtifactReference(
  value: unknown,
  label: string,
  output: boolean
): ReconstructionArtifactReference | ReconstructionOutputArtifactReference {
  const artifact = record(value, label);
  exactKeys(
    artifact,
    output
      ? ["role", "path", "sha256", "size_bytes", "media_type", "coordinate_frame"]
      : ["role", "path", "sha256", "size_bytes", "media_type"],
    label
  );
  const base: ReconstructionArtifactReference = {
    role: validIdentifier(artifact.role, `${label}.role`),
    path: safeReconstructionRelativePath(artifact.path, `${label}.path`),
    sha256: validSha256(artifact.sha256, `${label}.sha256`),
    size_bytes: positiveSafeInteger(artifact.size_bytes, `${label}.size_bytes`),
    media_type: validMediaType(artifact.media_type, `${label}.media_type`)
  };
  if (!output) return base;
  return {
    ...base,
    coordinate_frame: artifact.coordinate_frame === null
      ? null
      : validIdentifier(artifact.coordinate_frame, `${label}.coordinate_frame`)
  };
}

function assertOutputArtifactsSupported(
  artifacts: readonly ReconstructionOutputArtifactReference[],
  job: ReconstructionJob,
  capability: ReconstructionWorkerCapability
): void {
  if (job.worker.worker_id !== capability.worker_id) {
    throw new ReconstructionContractError("Job worker_id differs from the capability report.", "conflict");
  }
  const operation = capability.operations.find((candidate) => candidate.job_kind === job.job_kind);
  if (!operation) {
    throw new ReconstructionContractError("Job kind is not supported by the worker.", "conflict");
  }
  for (const artifact of artifacts) {
    const output = operation.outputs.find((candidate) => candidate.role === artifact.role);
    if (
      !job.requested_outputs.includes(artifact.role)
      || !output
      || !output.media_types.includes(artifact.media_type)
    ) {
      throw new ReconstructionContractError(
        `Worker output ${artifact.role} as ${artifact.media_type} is not declared by the selected capability.`,
        "conflict"
      );
    }
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReconstructionContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new ReconstructionContractError(`${label} must contain exactly: ${keys.join(", ")}.`);
  }
}

function boundedArray(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ReconstructionContractError(`${label} must contain ${minimum} to ${maximum} items.`);
  }
  return value;
}

function validIdentifier(value: unknown, label: string): string {
  const text = validString(value, label, 128);
  if (!identifierPattern.test(text)) throw new ReconstructionContractError(`${label} has an invalid identifier.`);
  return text;
}

function validMediaType(value: unknown, label: string): string {
  const text = validString(value, label, 128);
  if (!mediaTypePattern.test(text)) throw new ReconstructionContractError(`${label} is not a canonical media type.`);
  return text;
}

function validSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new ReconstructionContractError(`${label} must be sha256:<64 lowercase hex>.`);
  }
  return value;
}

function validTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !timestampPattern.test(value)) {
    throw new ReconstructionContractError(`${label} must be a canonical UTC timestamp.`);
  }
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== normalized) {
    throw new ReconstructionContractError(`${label} must be a real canonical UTC timestamp.`);
  }
  return value;
}

function validString(value: unknown, label: string, maxBytes: number, allowNewlines = false): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ReconstructionContractError(`${label} must be a non-empty string within ${maxBytes} UTF-8 bytes.`);
  }
  if (value.includes("\0") || (!allowNewlines && /[\r\n]/.test(value)) || hasUnpairedSurrogate(value)) {
    throw new ReconstructionContractError(`${label} contains unsupported characters.`);
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function literal(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new ReconstructionContractError(`${label} must equal ${expected}.`);
}

function literalOneOf(value: unknown, expected: readonly string[], label: string): string {
  if (typeof value !== "string" || !expected.includes(value)) {
    throw new ReconstructionContractError(`${label} must be one of ${expected.join(", ")}.`);
  }
  return value;
}

function boundedFinite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ReconstructionContractError(`${label} must be finite and between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ReconstructionContractError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  return boundedInteger(value, label, 1, maxSafeInteger);
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  return boundedInteger(value, label, 0, maxSafeInteger);
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ReconstructionContractError(`${label} must not contain duplicates.`);
  }
}

function safeSum(values: number[], label: string): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw new ReconstructionContractError(`${label} exceed safe integer bounds.`);
  }
  return total;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ReconstructionContractError("Canonical worker JSON cannot contain non-finite numbers.");
  }
  return value;
}
