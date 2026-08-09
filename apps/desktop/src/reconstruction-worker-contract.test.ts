import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  RECONSTRUCTION_EVENT_SCHEMA,
  assertReconstructionEventCompatibleWithCapability,
  assertReconstructionEventMatchesJob,
  assertReconstructionJobCompatible,
  assertReconstructionResultCompatibleWithCapability,
  assertReconstructionResultMatchesEventSequence,
  assertReconstructionResultMatchesJob,
  parseReconstructionJson,
  reconstructionPayloadSha256,
  safeReconstructionRelativePath,
  stableReconstructionJson,
  validateReconstructionEvent,
  validateReconstructionEventSequence,
  validateReconstructionJob,
  validateReconstructionResult,
  validateReconstructionWorkerCapability,
  type ReconstructionEvent
} from "./reconstruction-worker-contract.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contractRoot = path.join(repoRoot, "contracts/reconstruction-worker/v0.1");

const fingerprints = {
  "fixtures/valid_capability.json": "0a053a7a0656a4dfccf1f0b6eab4ee39fd071235bf88994ffd852dccb87d88c9",
  "fixtures/valid_event.json": "ade1f62b7121d1add3f264732ef8c4fd49c6d5b4e7362ac102a5a50e37deee87",
  "fixtures/valid_job.json": "7ce467d796920bcf29939b22e44125e1d042030bff6e7ca80696421d23aa01ee",
  "fixtures/valid_result.json": "ba9eff709986e8f92630bcf886003a93a18110dffe449fa65cda7732a28a26e6",
  "schemas/world_studio.reconstruction_event.v0.1.schema.json": "f296fbc360e68a7240c04a195a0c02b569585514955f8f19475f0a62e9d5289a",
  "schemas/world_studio.reconstruction_job.v0.1.schema.json": "f783a17a539ca15ac707c33ad4b1d09ff92ece5b7a895e61fc721f235eca72fa",
  "schemas/world_studio.reconstruction_result.v0.1.schema.json": "25499a6742f9e73c17143d6652adc802a018c8e78f3bc079004d39c58509643d",
  "schemas/world_studio.reconstruction_worker_capability.v0.1.schema.json": "f0593651f6eced47c410bceef8eb94f336a081f8a3d36ef3c5cc53936bb558eb"
} as const;

describe("reconstruction worker contracts", () => {
  it("pins schemas and fixtures and validates every fixture with AJV", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const schemas = await Promise.all([
      schema("world_studio.reconstruction_worker_capability.v0.1.schema.json"),
      schema("world_studio.reconstruction_job.v0.1.schema.json"),
      schema("world_studio.reconstruction_event.v0.1.schema.json"),
      schema("world_studio.reconstruction_result.v0.1.schema.json")
    ]);
    for (const value of schemas) {
      assertStrictObjects(value, "schema");
      ajv.addSchema(value);
    }
    const fixturePairs = [
      ["valid_capability.json", "world_studio.reconstruction_worker_capability.v0.1"],
      ["valid_job.json", "world_studio.reconstruction_job.v0.1"],
      ["valid_event.json", "world_studio.reconstruction_event.v0.1"],
      ["valid_result.json", "world_studio.reconstruction_result.v0.1"]
    ] as const;
    for (const [name, schemaName] of fixturePairs) {
      const value = await fixture(name);
      const validate = ajv.getSchema(`urn:world-studio:schema:${schemaName}`);
      expect(validate, schemaName).toBeTypeOf("function");
      expect(validate!(value), JSON.stringify(validate!.errors)).toBe(true);
    }
    for (const [relativePath, expected] of Object.entries(fingerprints)) {
      const bytes = await readFile(path.join(contractRoot, relativePath));
      expect(createHash("sha256").update(bytes).digest("hex"), relativePath).toBe(expected);
    }
  });

  it("accepts all canonical fixtures through semantic runtime validators", async () => {
    expect(validateReconstructionWorkerCapability(await fixture("valid_capability.json")).authority)
      .toBe("proposal_only");
    expect(validateReconstructionJob(await fixture("valid_job.json"))).toMatchObject({
      attempt: 1,
      loaded_world_effect: "none"
    });
    expect(validateReconstructionEvent(await fixture("valid_event.json"))).toMatchObject({
      schema: RECONSTRUCTION_EVENT_SCHEMA,
      kind: "artifact",
      state: "running"
    });
    expect(validateReconstructionResult(await fixture("valid_result.json"))).toMatchObject({
      status: "completed",
      authority: "proposal_only",
      loaded_world_effect: "none"
    });
  });

  it("keeps schema-level lifecycle variants and numeric bounds fail-closed", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const [eventSchema, jobSchema, resultSchema] = await Promise.all([
      schema("world_studio.reconstruction_event.v0.1.schema.json"),
      schema("world_studio.reconstruction_job.v0.1.schema.json"),
      schema("world_studio.reconstruction_result.v0.1.schema.json")
    ]);
    const validateEvent = ajv.compile(eventSchema);
    const validateJob = ajv.compile(jobSchema);
    const validateResult = ajv.compile(resultSchema);
    const event = await fixture("valid_event.json") as Record<string, unknown>;
    const job = await fixture("valid_job.json") as Record<string, unknown>;
    const result = await fixture("valid_result.json") as Record<string, unknown>;
    expect(validateEvent({ ...event, level: "info" })).toBe(false);
    expect(validateJob({ ...job, attempt: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(validateResult({ ...result, status: "failed" })).toBe(false);
  });

  it("rejects malformed JSON, extra fields, and non-finite values", async () => {
    expect(() => parseReconstructionJson('{"schema":')).toThrow(/complete, strict JSON/);
    expect(() => parseReconstructionJson('{"value":NaN}')).toThrow(/complete, strict JSON/);
    const job = await fixture("valid_job.json") as Record<string, unknown>;
    expect(() => validateReconstructionJob({ ...job, executable: "/tmp/worker" }))
      .toThrow(/contain exactly/);
    expect(() => validateReconstructionJob({ ...job, attempt: Number.NaN })).toThrow(/integer/);
    expect(() => validateReconstructionJob({ ...job, attempt: Number.POSITIVE_INFINITY })).toThrow(/integer/);
    expect(() => stableReconstructionJson({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => stableReconstructionJson({ value: Number.NEGATIVE_INFINITY })).toThrow(/non-finite/);
  });

  it.each([
    "/absolute/input.json",
    "file:///input.json",
    "C:/input.json",
    "inputs\\input.json",
    "../input.json",
    "inputs/../input.json",
    "./input.json",
    "inputs//input.json",
    "inputs/",
    "inputs/\0input.json"
  ])("rejects unsafe relative path %s", (value) => {
    expect(() => safeReconstructionRelativePath(value)).toThrow(/safe POSIX-relative path/);
  });

  it("rejects unsafe input and output paths, bad hashes, and duplicate paths", async () => {
    const job = await fixture("valid_job.json") as Record<string, unknown>;
    const inputs = job.inputs as Array<Record<string, unknown>>;
    expect(() => validateReconstructionJob({
      ...job,
      inputs: [{ ...inputs[0], path: "../capture.json" }]
    })).toThrow(/safe POSIX-relative path/);
    expect(() => validateReconstructionJob({
      ...job,
      inputs: [{ ...inputs[0], sha256: `sha256:${"A".repeat(64)}` }]
    })).toThrow(/lowercase hex/);
    expect(() => validateReconstructionJob({
      ...job,
      inputs: [inputs[0], { ...inputs[0] }]
    })).toThrow(/paths must not contain duplicates/);

    const result = await fixture("valid_result.json") as Record<string, unknown>;
    const outputs = result.outputs as Array<Record<string, unknown>>;
    expect(() => validateReconstructionResult({
      ...result,
      outputs: [{ ...outputs[0], path: "https://example.com/output.json" }]
    })).toThrow(/safe POSIX-relative path/);
  });

  it("checks worker capability, media roles, and every immutable resource budget", async () => {
    const capability = validateReconstructionWorkerCapability(await fixture("valid_capability.json"));
    const job = validateReconstructionJob(await fixture("valid_job.json"));
    expect(() => assertReconstructionJobCompatible(job, capability)).not.toThrow();
    expect(job.worker.capability_sha256).toBe(reconstructionPayloadSha256(capability));
    expect(() => assertReconstructionJobCompatible({
      ...job,
      worker: { ...job.worker, capability_sha256: `sha256:${"f".repeat(64)}` }
    }, capability)).toThrow(/capability checksum differs/);
    expect(() => assertReconstructionJobCompatible({
      ...job,
      inputs: [{ ...job.inputs[0], media_type: "application/octet-stream" }]
    }, capability)).toThrow(/does not support input/);
    expect(() => assertReconstructionJobCompatible({
      ...job,
      requested_outputs: ["metric-collision"]
    }, capability)).toThrow(/unsupported output/);
    expect(() => assertReconstructionJobCompatible({
      ...job,
      budget: { ...job.budget, wall_time_ms: capability.limits.max_wall_time_ms + 1 }
    }, capability)).toThrow(/budget exceeds/);
  });

  it("binds event and result output media types to the selected capability", async () => {
    const capability = validateReconstructionWorkerCapability(await fixture("valid_capability.json"));
    const job = validateReconstructionJob(await fixture("valid_job.json"));
    const event = validateReconstructionEvent(await fixture("valid_event.json"));
    const result = validateReconstructionResult(await fixture("valid_result.json"));
    expect(() => assertReconstructionEventCompatibleWithCapability(event, job, capability)).not.toThrow();
    expect(() => assertReconstructionResultCompatibleWithCapability(result, job, capability)).not.toThrow();
    expect(() => assertReconstructionEventCompatibleWithCapability({
      ...event,
      artifact: { ...event.artifact!, media_type: "application/octet-stream" }
    }, job, capability)).toThrow(/not declared by the selected capability/);
    expect(() => assertReconstructionResultCompatibleWithCapability({
      ...result,
      outputs: [{ ...result.outputs[0], media_type: "application/octet-stream" }]
    }, job, capability)).toThrow(/not declared by the selected capability/);
  });

  it("enforces the external worker stream boundary and terminal result binding", async () => {
    const job = validateReconstructionJob(await fixture("valid_job.json"));
    const result = validateReconstructionResult(await fixture("valid_result.json"));
    const artifact = (await fixture("valid_event.json") as ReconstructionEvent).artifact;
    const event = (sequenceId: number, kind: ReconstructionEvent["kind"], state: ReconstructionEvent["state"], extras: Partial<ReconstructionEvent> = {}) => ({
      schema: RECONSTRUCTION_EVENT_SCHEMA,
      job_id: job.job_id,
      attempt: job.attempt,
      sequence_id: sequenceId,
      timestamp: `2026-08-09T10:01:${String(sequenceId).padStart(2, "0")}.000Z`,
      kind,
      state,
      level: null,
      message: null,
      progress: null,
      artifact: null,
      authority: "proposal_only",
      ...extras
    });
    const events = [
      event(1, "state", "running"),
      event(2, "log", "running", { level: "info", message: "worker started" }),
      event(3, "progress", "running", { progress: 0.25 }),
      event(4, "artifact", "running", { artifact }),
      event(5, "progress", "running", { progress: 1 }),
      event(6, "state", "completed")
    ];
    expect(validateReconstructionEventSequence(events)).toHaveLength(6);
    expect(() => assertReconstructionResultMatchesEventSequence(result, events)).not.toThrow();
    expect(() => validateReconstructionEvent({
      ...events[2],
      kind: "log",
      level: null,
      message: "missing level"
    })).toThrow(/Log events require/);
    expect(() => validateReconstructionEventSequence([
      events[0],
      event(2, "progress", "running", { progress: 0.25 }),
      event(3, "progress", "running", { progress: 0.1 }),
      event(4, "state", "failed")
    ])).toThrow(/cannot move backwards/);
    expect(() => validateReconstructionEventSequence([
      events[0],
      event(3, "state", "completed")
    ])).toThrow(/contiguous sequence/);
    expect(() => validateReconstructionEventSequence([
      event(1, "state", "queued"),
      event(2, "state", "completed")
    ])).toThrow(/begin with running/);
    expect(() => validateReconstructionEventSequence([
      events[0],
      event(2, "progress", "running", { progress: 0.5 })
    ])).toThrow(/end with exactly one terminal/);
    expect(() => validateReconstructionEventSequence([
      events[0],
      event(2, "state", "failed"),
      event(3, "state", "completed")
    ])).toThrow(/between boundaries/);
    expect(() => validateReconstructionEventSequence([
      events[0],
      event(2, "artifact", "running", { artifact }),
      event(3, "artifact", "running", { artifact }),
      event(4, "state", "completed")
    ])).toThrow(/cannot be reused/);
    for (const state of ["completed", "failed", "cancelled", "timed_out", "interrupted"] as const) {
      expect(validateReconstructionEventSequence([
        events[0],
        event(2, "state", state)
      ]).at(-1)?.state).toBe(state);
    }
    expect(() => assertReconstructionResultMatchesEventSequence(result, [
      events[0],
      event(2, "state", "failed")
    ])).toThrow(/status differs/);
    expect(() => assertReconstructionEventMatchesJob({
      ...validateReconstructionEvent(events[0]),
      attempt: job.attempt + 1
    }, job)).toThrow(/attempt differs/);
  });

  it("requires exact completed results and rejects attempt, checksum, and budget conflicts", async () => {
    const job = validateReconstructionJob(await fixture("valid_job.json"));
    const result = validateReconstructionResult(await fixture("valid_result.json"));
    const jobSha256 = reconstructionPayloadSha256(job);
    expect(result.job_sha256).toBe(jobSha256);
    expect(() => assertReconstructionResultMatchesJob(
      result,
      job,
      jobSha256
    )).not.toThrow();
    expect(() => assertReconstructionResultMatchesJob({
      ...result,
      attempt: 2
    }, job, result.job_sha256)).toThrow(/identity or input binding/);
    expect(() => assertReconstructionResultMatchesJob({
      ...result,
      job_sha256: `sha256:${"6".repeat(64)}`
    }, job, jobSha256)).toThrow(/identity or input binding/);
    expect(() => assertReconstructionResultMatchesJob(
      result,
      job,
      `sha256:${"5".repeat(64)}`
    )).toThrow(/identity or input binding/);
    expect(() => assertReconstructionResultMatchesJob({
      ...result,
      usage: { ...result.usage, wall_time_ms: job.budget.wall_time_ms + 1 }
    }, job, result.job_sha256)).toThrow(/exceeds the immutable job budget/);
    expect(() => validateReconstructionResult({
      ...result,
      status: "failed",
      failure: null
    })).toThrow(/Non-completed results require failure/);
    expect(() => validateReconstructionResult({
      ...result,
      usage: { ...result.usage, output_bytes: result.usage.output_bytes + 1 }
    })).toThrow(/must equal committed output bytes/);
    const missingRoleJob = {
      ...job,
      requested_outputs: [...job.requested_outputs, "mesh-proposal"]
    };
    const missingRoleSha256 = reconstructionPayloadSha256(missingRoleJob);
    expect(() => assertReconstructionResultMatchesJob({
      ...result,
      job_sha256: missingRoleSha256
    }, missingRoleJob, missingRoleSha256)).toThrow(/missing a requested output role/);
  });
});

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(contractRoot, "fixtures", name), "utf8")) as unknown;
}

async function schema(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(contractRoot, "schemas", name), "utf8")) as Record<string, unknown>;
}

function assertStrictObjects(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertStrictObjects(child, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (object.type === "object") expect(object.additionalProperties, label).toBe(false);
  for (const [key, child] of Object.entries(object)) assertStrictObjects(child, `${label}.${key}`);
}
