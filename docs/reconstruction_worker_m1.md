# Reconstruction Worker M1

This checkpoint defines World Studio's software boundary for optional reconstruction
workers. It does not ship a reconstruction engine, run a worker during app startup, or claim
that a successful process produced a useful reconstruction.

## Authority

- Capture Splat and the live-session store remain immutable source evidence.
- A worker job consumes a checksum-bound snapshot; it never receives the source directory.
- Every event, result, and output is permanently `proposal_only`.
- Worker output is not loaded into the current world, Spark, Three.js, Rapier, collision,
  navigation, semantics, measurement, or physics automatically.
- Promotion into a future World Package requires a separate explicit contract and gate.

## Process Boundary

Electron main owns an allowlisted registry. Renderer requests contain only registered worker
and live-session IDs. The executable, arguments, working directory, and minimal environment
come from trusted main-process configuration. Production registers no worker by default; the
Node worker used in tests is not packaged as a runtime.

Each attempt has fixed input, incoming-output, committed-output, job, result, and state
locations under the Electron user-data directory. Bounded events and log summaries are folded
into atomic state rather than exposed as arbitrary files. Input staging rejects links and
special files, enforces file/count/byte bounds, and hashes the exact bytes copied. The worker
is launched with `shell: false` in its private job directory and an isolated POSIX process
group. Memory, wall-time, log, output byte, and output-count budgets are recorded; memory is
advisory while the other limits are enforced by this supervisor. The process boundary is
failure isolation, not a hostile-code sandbox.

Workers write only to the attempt incoming area and emit bounded ordered events. World Studio
accepts output only after exit, strict result validation, job/attempt matching, safe relative
paths, regular-file checks, exact size checks, and SHA-256 rehashing. Publication is atomic.

## External Process Protocol

The supervisor sets the worker's current directory to the private job root and invokes the
reviewed absolute executable with fixed trailing arguments:

```text
--job attempts/<eight-digit-attempt>/job.json
--attempt <positive-integer>
--job-sha256 sha256:<64-lowercase-hex>
--output-root .incoming/<eight-digit-attempt>
```

Worker stdout is newline-delimited `world_studio.reconstruction_event.v0.1` JSON. Event 1 is
the `running` state; bounded log, progress, and artifact events keep that state; exactly one
terminal state is last. Sequence IDs are contiguous, progress is monotonic, and artifact
paths are immutable. Stderr is a bounded diagnostic channel and never a result channel.

The worker writes `result.json` under the supplied output root and exits with code zero. The
strict result status must match the terminal event and bind the exact job SHA-256, worker
capability, attempt, output paths, sizes, and hashes. A stop closes stdin, sends SIGTERM to
the complete process group, and escalates the group to SIGKILL after the grace period. Result
verification waits for that group to become quiescent, so an adapter must not orphan
subprocesses. Workers should exit promptly when stdin closes; World Studio does not trust
that behavior as its only termination mechanism.

## Recovery

- Stop sends SIGTERM and escalates to SIGKILL after a bounded grace period.
- Timeout, nonzero exit, signal exit, malformed events, missing completion, corrupt output,
  and output overflow produce durable failure evidence.
- World Studio never reattaches to a persisted PID after restart. An unfinished attempt is
  marked `interrupted`, its committed evidence is preserved, and stale incoming output is
  rejected.
- Retry creates a new attempt and keeps the prior attempt intact. The input revision and
  checksums must remain identical.
- Only one worker process is active in this initial boundary.

## UI And Browser Behavior

Simulate always shows a Reconstruction Worker panel. Browser builds show
`unavailable · packaged desktop only`; Electron with the intentionally empty production
registry shows `unavailable · no worker configured`. When a reviewed worker is registered,
the panel exposes explicit start, stop, and retry-same-input actions, requested budgets, a
bounded log tail, and verified output role/size/checksum metadata. It never loads an output
silently or replaces the current world.

## Deferred Work

i3dgs, LingBot Map, gsplat, Newton, Isaac, CUDA, remote execution, OS-enforced CPU/memory/GPU
limits, reconstruction-quality evaluation, and artifact promotion remain separate work. M5's
Newton physics worker will require its own solver-neutral contracts and parity gates; this M1
reconstruction boundary does not implement physics authority.

Before the first nonempty production registration, adapter acceptance must pin and rehash the
reviewed executable or signed worker package and add an executable/health probe. The empty-registry
checkpoint does not claim that a worker build identity or runtime availability has been verified.
