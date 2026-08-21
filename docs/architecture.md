# Architecture

World Studio is a shared web/desktop app:

- `apps/web` is the browser-capable Vite/React app.
- `apps/desktop` is the Electron shell for local filesystem, packaged desktop builds, and
  future native proof capture.
- `packages/design-system` owns the World Studio CSS tokens and reusable HUD primitives.
- `packages/world-core` owns shared types and compatibility contracts.
- `packages/artifacts` owns PLY/OBJ/JSON/Budo package ingestion and validation.
- `packages/renderer` owns the renderer adapter contract and current canvas fallback.

## Live Capture And Security Boundary

The Electron main process owns the Capture Splat transport. M0 remains a plaintext HTTP
receiver restricted to `127.0.0.1` or `::1`; environment configuration cannot widen it.
It starts only after an explicit renderer action and uses pure Node HTTP, contract, and
store modules so durability and corruption behavior can be tested without Electron.

M1 adds a separate secure local-network boundary rather than weakening the M0 bind guard.
The user must explicitly choose one enumerated interface and begin pairing. A short-lived QR
offer identifies this Mac and pins its self-signed TLS certificate. Bonjour publishes the
allowlisted `_capturesplat._tcp` registration through `/usr/bin/dns-sd`; it never browses for
or trusts discovered host data, and its TXT records contain no invitation secret.

The desktop identity is a P-256 key protected by the Electron/macOS secret-storage boundary.
Its self-signed certificate is issued through the absolute `/usr/bin/openssl` system tool.
A pairing request proves possession of both the QR invitation and the iPhone's P-256 device
key. Paired LAN requests use P-256 ES256/P1363 signatures binding the grant, method, exact
path, content metadata, body SHA-256, and an unsigned 64-bit request counter. The paired
device registry persists the highest counter and a 256-bit sliding replay bitmap per grant:
previously unseen out-of-order counters inside the window are accepted once, while
duplicates and counters older than the window fail across receiver restart. `request_id` is
correlation metadata, not replay authority. Credential expiry and explicit revocation are
checked independently.

Only the pairing exchange is reachable before pairing succeeds. Live-session routes become
available on the selected interface only through pinned TLS and successful device
authentication. The authenticated gateway delegates to the same receiver/store boundary as
loopback, so checksum, ACK, duplicate, gap, resume, and finalization semantics do not fork.

Live sessions are stored under:

```text
app.getPath("userData")/live-sessions/<session-id>
```

Tests inject temporary roots. Uploads stream into `.incoming`, are hashed and fsynced,
then become authoritative only after an atomic rename into
`frames/<eight-digit-sequence>`. Receiver-owned filenames prevent uploaded paths from
choosing storage locations. On restart, committed frame directories are recovered and
stale partial uploads are discarded.

The preload bridge exposes start, stop, status, update subscription, and bounded
on-demand preview operations. The renderer keeps a separate `LiveSessionSnapshot`; it
never mutates or replaces `WorldSession`. Camera motion is shown as gap-aware top-down
X/Z evidence rather than being overlaid onto an unrelated loaded world. A finalized
`capture-splat.world-studio.json` can be opened later only through the existing explicit
package action.

M1 security state is also separate from `WorldSession` and `LiveSessionSnapshot`. Pairing or
receiving evidence cannot replace a loaded world. All streamed evidence remains
`proposal_only`.

Capture Splat now implements the optional bounded sender outside its capture queues, but
iPhone live transfer is disabled by default and is not the production ingestion path.
World Studio accepts manually exported packages and replay without depending on a live
device session. Physical Bonjour discovery, macOS firewall/local-network permission, Wi-Fi
interruption, receiver restart, thermal behavior, and complete device cycles remain
separate live-transport promotion gates.

## Reconstruction Worker Boundary

Electron main owns the optional reconstruction-worker supervisor. Its production registry is
empty by default; the renderer can select only a registered worker ID and live-session ID and
can never supply an executable, path, argument, environment variable, URL, or working
directory. Browser builds report the boundary as unavailable without calling an absent bridge.

Each attempt snapshots committed live evidence into a private directory under:

```text
app.getPath("userData")/reconstruction-jobs/<job-id>/attempts/<attempt>
```

Input bytes are copied, bounded, and SHA-256 verified before a strict immutable job is
published. A reviewed external process runs with `shell: false`, a fixed job directory, a
minimal environment, bounded wall time/logs/outputs, and a requested memory budget. Memory is
recorded but is not yet OS-enforced; wall time, log bytes, output bytes, and output count are
enforced by the supervisor. Child-process isolation is not a hostile-code sandbox.

Output files remain in the attempt's private incoming area until the process exits and the
strict result, safe relative paths, regular-file identity, sizes, and hashes all validate.
Only then are proposal outputs committed atomically. On desktop restart, an unfinished
attempt becomes `interrupted`; World Studio never reattaches to a persisted PID. Retry creates
a new attempt over the same immutable input digest. Stop and timeout terminate the isolated
worker process group, escalating from SIGTERM to SIGKILL without affecting the receiver or
source evidence.

Worker state uses a separate `ReconstructionWorkerSnapshot`. It cannot replace
`LiveSessionSnapshot` or `WorldSession`, and worker output never enters Spark, Three.js,
Rapier, collision, navigation, semantics, measurement, or physics automatically. See
[Reconstruction Worker M1](reconstruction_worker_m1.md).

## World Compiler Boundary

The [World Compiler Blueprint](blueprints/world-compiler-v0.1/README.md) defines the target
ownership model:

- Capture Splat owns immutable source evidence and capture decisions.
- World Studio owns world versions, coordinate frames, units, provenance, uncertainty,
  edits, readiness, robot/task profiles, adapters, and Episodes.
- Spark + Three.js provides visual composition and Gaussian rendering.
- Rapier is the active, feature-frozen migration baseline for local preview execution.
- Newton is the target physics runtime through a supervised Python worker.
- Isaac Lab Newton, Isaac RTX, Isaac Sim, ROS 2, reconstruction, and other adapters run
  through external, capability-reporting workers.

The first canonical-graph contract slice is active under `contracts/world-graph/v0.1`.
It defines immutable World v0.2 and Asset v0.1 revisions plus reversible Delta v0.1
records with content hashes, transforms, units, uncertainty, provenance, and separate
authority lanes. These records are deliberately separate from the mutable `WorldSession`.
Existing local package and Episode contracts remain the active loading paths.

The pure Node `CanonicalWorldPackageStore` is the first persistence boundary for canonical
revisions. Its constructor accepts an absolute root so tests use temporary directories;
desktop wiring will supply `app.getPath("userData")/world-packages` later. A publication is
staged under `.incoming`, then the complete immutable revision directory is atomically
renamed into a deterministic World or Asset version slot. The store retains the exact raw
manifest bytes and writes store-owned metadata separately. Identical republication is a
duplicate; the same identity or version slot with different bytes is a conflict.

```text
<root>/.incoming/<publication-id>/
<root>/worlds/<world-id>/versions/<10-digit-version>/{record,content}/
<root>/assets/<asset-id>/versions/<10-digit-version>/{record,content}/
```

Recovery and every explicit reopen validate the committed directory instead of trusting
cached state. They strictly parse JSON records, rehash the manifest, Delta, direct content,
and the complete transitive Asset closure, then rerun lineage and transition validation.
World revisions therefore bind exact Asset revisions that already exist in the same store.
Malformed committed entries fail closed. Recovery removes only stale real directories from
`.incoming`; committed revision directories remain authoritative and immutable.

The supported writer is one Electron main process. Store instances in that process
serialize by root; live foreign staging fails closed, while independent publishers reconcile
only at the deterministic final rename. This is not a hostile multi-process lock. Full-file
verification streams bytes, while materialized reads have a non-raiseable 16 MiB cap.
Recovery also has lower-only hard ceilings of 100,000 stored versions, 1,000,000 aggregate
content references, and 262,144 content directories so immutable history cannot become an
unbounded memory path.

This module has no Electron main, preload, IPC, UI, current package-reader, autoload, or
editor integration. It does not migrate either historical World v0.1 shape, materialize
`hide` or `annotate`, add Site revisions, deduplicate global blobs, or promote authority.
It also changes no reconstruction worker, renderer, simulation, physics, Capture Splat, or
iPhone behavior.

Delta v0.1 is a forward grammar, not an editor executor. Commit-time transition validation
currently materializes artifact edits, World asset membership, and World `manual_edit`
transforms only. Intents without a snapshot-backed state carrier, evidence-owned transforms,
unsupported scope/intent combinations, and future Site revisions fail closed.

The target R2S2R and runtime boundaries are documented in the
[R2S2R and Newton adoption note](blueprints/world-compiler-v0.1/r2s2r-newton-2026-07-29/README.md).

## Gaussian Pipeline Contract Boundary

`contracts/gaussian-pipeline/v0.1` defines strict training-job, Gaussian-asset, and
benchmark-report records. A job binds a dataset manifest, external worker source/build,
feature profile, an observed seed or explicit unavailable `null`, requested outputs, and
budgets. An asset binds that exact job and
dataset plus format, splat representation, coordinate/color metadata, sidecars, and finite
validation. A report binds the exact job/asset/dataset and records hardware, command argv,
cold/warm repetitions, raw results, distributions, fixed-camera quality, noise controls,
claims, limitations, and a `promote|hold|reject` decision.

Coordinate frames distinguish accepted metric registration from arbitrary trainer gauge.
Registered frames declare metres and distinct cardinal up/forward axes. Unregistered frames
declare unknown units and null axes. In particular, pinned Spirula Playroom output preserves
the source COLMAP/SfM gauge and remains visual-only until a separate metric registration is
accepted.

Job-profile quantization describes training and optimizer storage precision. Asset
quantization describes the serialized Gaussian properties independently. Spirula qlevel 1
uses mixed training storage but its checkpoint export dequantizes PLY properties to float32,
so that binding is `job.profile.quantization = mixed` and
`asset.representation.quantization = none`; it is not a compressed-output claim.

These are data contracts only. They do not generalize the live-session-specific
`ReconstructionWorkerSupervisor`, register or execute Spirula, load PLY/SPZ/RAD into Spark,
publish a canonical Asset, or alter Rapier/Newton behavior. Every output remains a visual
proposal with no loaded-World effect. GPL-3.0 Spirula Studio is pinned only as an external
process/reference at `aede0ae3b2d01a7930c71b9c7f52354dc180146b`; no upstream code enters
the Apache tree.

The desktop package reader recognizes additive Capture Splat handoff v0.3 and strictly
validates its `capture_splat.training_dataset.v0.1` block. It recomputes the declared
canonical digest from the handoff's relative path, size, and SHA-256 frame identities before
exposing the typed evidence inventory. Capture profiles use the producer's bounded identifier
grammar, including `video_3dgs_max`, instead of a closed World Studio enum. The reader does
not rehash every frame byte, construct a training job, or execute a worker.

The current benchmark fixture allowlist is exactly NeRF Synthetic Lego, original-3DGS Deep
Blending Playroom, and `/Users/dev/Downloads/capture_splat_2026-08-09T060230Z` (122 frames).
Lego remains metadata-first until manifest/reference completeness is revalidated. Playroom is
locally hydrated and binds all 229 archive members through dataset manifest SHA-256
`494b7f8f069292f6b08497cbd8d820112c69677046ce39fd3c7e6268d4d8dc36`, but no explicit
dataset-byte license was located; redistribution, public demos, product use, and commercial
use remain held for rights review. Every other OneDrive dataset stays cloud-only. Reports
must hold every claim that lacks exact measured evidence; Apple M2 Max results cannot stand
in for NVIDIA, AMD, Intel, other Apple devices, native equirectangular input, or a literal
10M SH3/8GB result.

## Physical Asset Calibration Boundary

[Physical Asset Calibration](blueprints/world-compiler-v0.1/PHYSICAL_ASSET_CALIBRATION.md)
spans Edit, Sensors, Simulate, and Episode. Passive Capture Splat evidence can create C0
visual and geometry proposals. Physical parameters require calibrated apparatus,
instrumented experiments, uncertainty, held-out real/sim validation, and task-scoped
promotion.

Visual, metric, collision, semantic, and physics representations may share transforms, but
one role never gains another role's authority automatically.

## Physics Runtime Migration Boundary

Newton is not imported into the React bundle. Electron supervises an isolated Python worker
and exposes a solver-neutral `SimulationClient` to the renderer.

The worker owns physics state, contacts, joints, physics sensors, stepping, and failure
evidence. Every session binds exact World, Asset, Robot, Sensor, Task, solver profile,
Newton, Warp, MuJoCo, contact-pipeline, platform, device, timestep, substep, seed, and
capability data. Spark and Three.js display interpolated state but never become the
authoritative physics clock.

Migration is gated:

1. preserve current Rapier behavior as fixtures;
2. move UI code behind the solver-neutral client;
3. add worker lifecycle, corruption, traversal, timeout, restart, and unavailable-state
   tests;
4. reproduce accepted fixtures on local Newton CPU and remote Newton CUDA;
5. validate effective colliders and task outcomes;
6. switch Simulate, Pilot, and Episode to Newton;
7. remove Rapier dependencies and runtime paths.

Browser-only builds report `worker unavailable` after cutover. They do not silently select
a JavaScript physics backend.

## Renderer Boundary

The renderer contract intentionally matches the prototype's `ws-render.js` behavior while
making it typed:

- render modes: `splat`, `points`, `mesh`, `semantic`, `depth`
- selection/deletion masks
- semantic class isolation
- exposure and density controls
- ground grid, camera frustums, agent marker, trajectory breadcrumbs
- screen-space radius picking
- screenshot capture

Spark + Three.js should replace the canvas fallback behind this boundary. Physics should
enter only through the solver-neutral simulation service, not by coupling a backend
directly to React components.

## Loading Boundary

Startup remains blank. A load action creates a `WorldSession` with provenance:

- source kind
- loaded-via path
- primary artifact
- companion artifacts
- point counts and bounds where known
- proposal/verified status where applicable

No loader may promote a rendered visual to metric or safety authority by default.
