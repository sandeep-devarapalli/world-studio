# Codex implementation prompt

You are working on the existing **CaptureSplat + World Studio** repository. Implement the first backend-neutral contracts and the replay-first foundation described in this bundle. Read all files in this bundle before changing code.

## Product doctrine

- CaptureSplat iPhone is the authoritative recorder.
- An accepted frame must be durably written on the phone before any upload is attempted.
- Network state must never affect capture acceptance or timing.
- World Studio owns the progressive world, provenance, version graph, task/robot profiles, validation, and simulator adapters.
- Gaussian splats are visual authority only.
- Collision, measurement, semantics, affordances, and physics require separate artifacts and promotion gates.
- Spark is currently pinned at **2.1.0**; preserve the pin unless an explicit migration is part of the task.
- i3dgs remains an isolated research-only worker and must not be reachable from production configuration.
- Isaac Sim/Lab is an external adapter/worker, not an embedded canonical dependency.

## First implementation scope

Implement **Phase 0 and Phase 1** only, with scaffolds for later adapters:

1. Add versioned JSON Schemas:
   - `capture_splat.live_session.v0.1`
   - `world_studio.world.v0.1`
   - `isaac_job.v0.1`
2. Add typed models generated from or validated against these schemas.
3. Add a receiver session ledger with:
   - session and frame identity;
   - monotonic sequence handling;
   - byte length and SHA-256 validation;
   - idempotent duplicate handling;
   - ACK status;
   - retry/resume state;
   - final reconciliation.
4. Add strict safe-relative-path validation. Reject absolute paths, traversal, separators outside the agreed canonical form, NULs, and path collisions.
5. Build a replay CLI/test harness that can inject:
   - delays;
   - out-of-order delivery;
   - duplicate manifests and payloads;
   - payload corruption;
   - disconnect/reconnect;
   - partial transfer;
   - receiver restart and resume.
6. Produce an immutable reconciled evidence manifest and checksum list.
7. Add structured reason codes and machine-readable error responses.
8. Add an adapter interface with no Isaac dependency yet:
   - `compile(world_package, target, options)`
   - `validate(world_package, target, options)`
   - `run(job)`
   - `capabilities()`
9. Add fixture examples based on the schemas in this bundle.
10. Add documentation explaining source-of-truth and authority boundaries.

## Implementation constraints

- Inspect the repository and reuse existing package boundaries where sensible; do not create a parallel architecture without need.
- Preserve backwards compatibility unless a migration is documented and tested.
- Prefer deterministic pure functions for hash/path/manifest validation.
- Do not trust MIME type, file name, frame sequence, byte length, or hash sent by the client without validation.
- Write files through temporary paths and atomic rename after full verification.
- Never let an untrusted relative path escape the configured session root.
- Store protocol timestamps in RFC 3339 UTC and sensor capture times in explicit monotonic/device-clock fields.
- Use explicit coordinate-frame names; do not add unnamed transform matrices.
- Do not add ROS 2 to the phone transport.
- Do not import Isaac, CUDA, LingBot, i3dgs, or reconstruction dependencies into the receiver core.
- All optional workers communicate through a job interface.

## Tests required

- schema validation positive/negative cases;
- hash mismatch;
- byte-length mismatch;
- path traversal and collision;
- duplicate frame id with same payload is idempotent;
- duplicate frame id with different payload is a hard conflict;
- out-of-order frames reconcile correctly;
- disconnect and resume does not lose accepted frames;
- restart rebuilds state from ledger;
- final manifest identifies missing/unacknowledged artifacts;
- all fixture packages produce deterministic hashes;
- adapter interface can be exercised by a fake target.

## Deliverables

- implementation and tests;
- migration notes;
- architecture note;
- CLI usage examples;
- one generated replay report showing all injected fault classes;
- a concise list of repository areas prepared for Phase 2.

Do not implement a placeholder “perfect simulation” claim. Make correctness, provenance, and replayability visible in the code and UI.
