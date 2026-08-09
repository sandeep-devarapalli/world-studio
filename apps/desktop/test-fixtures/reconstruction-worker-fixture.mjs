import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const options = parseOptions(process.argv.slice(2));
const job = JSON.parse(await readFile(options.job, "utf8"));
const startedAt = "2026-08-09T00:00:00.000Z";
let sequenceId = 0;

if (options.mode === "hang") {
  process.stdin.resume();
  process.stdin.on("end", () => {
    process.exit(12);
  });
}

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const event = (kind, fields = {}) => emit({
  schema: "world_studio.reconstruction_event.v0.1",
  job_id: job.job_id,
  attempt: options.attempt,
  sequence_id: ++sequenceId,
  timestamp: startedAt,
  kind,
  state: fields.state ?? "running",
  level: fields.level ?? null,
  message: fields.message ?? null,
  progress: fields.progress ?? null,
  artifact: fields.artifact ?? null,
  authority: "proposal_only"
});

event("state", { state: "running" });

if (options.mode === "hang" || options.mode === "ignore-term") {
  if (options.mode === "ignore-term") process.on("SIGTERM", () => undefined);
  setInterval(() => undefined, 1_000);
} else if (options.mode === "crash") {
  process.stderr.write("fixture crash\n");
  process.exitCode = 7;
} else if (options.mode === "crash-once" && options.attempt === 1) {
  process.stderr.write("fixture first-attempt crash\n");
  process.exitCode = 7;
} else if (options.mode === "malformed-event") {
  process.stdout.write("{not-json}\n");
} else if (options.mode === "invalid-utf8-event") {
  process.stdout.write(Buffer.from([0xff, 0x0a]));
} else if (options.mode === "out-of-order-event") {
  sequenceId += 1;
  event("log", { level: "info", message: "skipped event" });
} else if (options.mode === "oversized-log") {
  event("log", { level: "info", message: "x".repeat(4096) });
} else if (options.mode === "growing-output") {
  await mkdir(options.outputRoot, { recursive: true });
  await writeFile(path.join(options.outputRoot, "growing.bin"), Buffer.alloc(64 * 1024));
  setInterval(() => undefined, 1_000);
} else if (options.mode === "descendant-writer") {
  await mkdir(options.outputRoot, { recursive: true });
  const marker = path.join(process.cwd(), "attempts", String(options.attempt).padStart(8, "0"), "descendant.pid");
  const output = path.join(process.cwd(), options.outputRoot, "descendant.bin");
  const source = [
    'const fs = require("node:fs")',
    "fs.writeFileSync(process.argv[1], String(process.pid))",
    'process.on("SIGTERM", () => undefined)',
    'setInterval(() => fs.appendFileSync(process.argv[2], "x"), 5)'
  ].join(";");
  const descendant = spawn(process.execPath, ["-e", source, marker, output], { stdio: "ignore" });
  descendant.unref();
  setInterval(() => undefined, 1_000);
} else if (options.mode === "split-multibyte") {
  const splitEvent = Buffer.from(`${JSON.stringify({
    schema: "world_studio.reconstruction_event.v0.1",
    job_id: job.job_id,
    attempt: options.attempt,
    sequence_id: ++sequenceId,
    timestamp: startedAt,
    kind: "log",
    state: "running",
    level: "info",
    message: "café split log",
    progress: null,
    artifact: null,
    authority: "proposal_only"
  })}\n`, "utf8");
  await splitBytes(process.stdout, splitEvent, Buffer.from("é", "utf8"));
  await splitBytes(process.stderr, Buffer.from("café split stderr\n", "utf8"), Buffer.from("é", "utf8"));
  await writeResult(options.mode);
} else {
  await writeResult(options.mode);
}

async function splitBytes(stream, bytes, marker) {
  const index = bytes.indexOf(marker);
  if (index < 0) throw new Error("split marker missing");
  stream.write(bytes.subarray(0, index + 1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  stream.write(bytes.subarray(index + 1));
}

async function writeResult(mode) {
  if (mode === "output-root-symlink") {
    const target = path.join(process.cwd(), `fixture-output-root-${options.attempt}`);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "sentinel.txt"), "preserve");
    await rm(options.outputRoot, { recursive: true, force: true });
    await symlink(target, options.outputRoot, "dir");
  } else if (mode === "incoming-parent-symlink") {
    const incomingRoot = path.dirname(options.outputRoot);
    const target = path.join(process.cwd(), `fixture-incoming-root-${options.attempt}`);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "sentinel.txt"), "preserve");
    await rm(incomingRoot, { recursive: true, force: true });
    await symlink(target, incomingRoot, "dir");
  }
  await mkdir(options.outputRoot, { recursive: true });
  if (mode === "declared-failure" || mode === "declared-failure-unsafe") {
    event("log", { level: "error", message: "fixture declared failure" });
    event("state", { state: "failed" });
    await writeFile(path.join(options.outputRoot, "result.json"), `${JSON.stringify(result({
      status: "failed",
      outputs: [],
      outputBytes: 0,
      failure: {
        code: "fixture_failure",
        message: mode === "declared-failure-unsafe"
          ? `${process.cwd()}\n${"unsafe diagnostic ".repeat(100)}`
          : "Fixture declared failure.",
        retryable: true
      }
    }))}\n`, "utf8");
    return;
  }
  const outputName = "proposal.bin";
  const outputBytes = Buffer.from("deterministic reconstruction proposal\n", "utf8");
  const outputPath = path.join(options.outputRoot, outputName);
  if (mode === "symlink-output") {
    const target = path.join(process.cwd(), `fixture-target-${options.attempt}.bin`);
    await writeFile(target, outputBytes);
    await symlink(target, outputPath);
  } else {
    await writeFile(outputPath, outputBytes);
  }
  if (mode === "hardlink-output") {
    await link(outputPath, path.join(process.cwd(), `fixture-hardlink-${options.attempt}.bin`));
  }
  if (mode === "extra-output") await writeFile(path.join(options.outputRoot, "undeclared.bin"), "extra");
  const actualSha256 = digest(outputBytes);
  const declaredSha256 = mode === "bad-checksum" ? `sha256:${"0".repeat(64)}` : actualSha256;
  const declaredPath = mode === "traversal" ? "../proposal.bin" : outputName;
  const output = {
    role: "point_cloud",
    path: declaredPath,
    sha256: declaredSha256,
    size_bytes: mode === "size-mismatch" ? outputBytes.byteLength + 1 : outputBytes.byteLength,
    media_type: mode === "media-mismatch" ? "application/json" : "application/octet-stream",
    coordinate_frame: "arkit_world"
  };
  event("log", { level: "info", message: mode === "multiline-log" ? "fixture\nforged row" : "fixture output ready" });
  if (mode === "slow-success") {
    event("progress", { progress: 0.5 });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  event("artifact", { artifact: output });
  if (mode !== "no-terminal") event("state", { state: mode === "terminal-mismatch" ? "failed" : "completed" });
  if (mode === "invalid-utf8-result") {
    await writeFile(path.join(options.outputRoot, "result.json"), Buffer.from([0xff, 0xfe]));
    return;
  }
  await writeFile(path.join(options.outputRoot, "result.json"), `${JSON.stringify(result({
    status: "completed",
    outputs: [output],
    outputBytes: outputBytes.byteLength,
    failure: null
  }))}\n`, "utf8");
}

function result({ status, outputs, outputBytes, failure }) {
  return {
    schema: "world_studio.reconstruction_result.v0.1",
    job_id: job.job_id,
    attempt: options.attempt,
    status,
    started_at: startedAt,
    finished_at: "2026-08-09T00:00:01.000Z",
    worker: {
      worker_id: job.worker.worker_id,
      capability_sha256: job.worker.capability_sha256
    },
    job_sha256: options.jobSha256,
    outputs,
    usage: {
      wall_time_ms: 1000,
      peak_memory_bytes: 1024,
      output_bytes: outputBytes,
      output_artifacts: outputs.length,
      log_bytes: 20
    },
    failure,
    authority: "proposal_only",
    loaded_world_effect: "none"
  };
}

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1]);
  const attempt = Number(values.get("--attempt"));
  const job = values.get("--job");
  const jobSha256 = values.get("--job-sha256");
  const outputRoot = values.get("--output-root");
  const mode = values.get("--mode") ?? "success";
  if (!job || !jobSha256 || !outputRoot || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error("fixture arguments are invalid");
  }
  return { attempt, job, jobSha256, outputRoot, mode };
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
