# Roadmap

The canonical public plan is the
[World Compiler Blueprint v0.1](docs/blueprints/world-compiler-v0.1/README.md). Its
[milestone specification](docs/blueprints/world-compiler-v0.1/MILESTONES.md) defines
outcomes and acceptance gates.

| Milestone | Outcome | Status |
|---|---|---|
| M0 Live Evidence Foundation | Replay-first Capture Splat sender, strict receiver, resume, reconciliation, and proposal-only UI | completed |
| M1 Authenticated LAN And Progressive World | Manual-import and replay-first progressive evidence, optional paired TLS transport, and isolated worker lifecycle | partial; iPhone live transport held by thermal evidence |
| M2 Canonical World, Asset And Delta Graph | Immutable versions, transform graph, content-addressed artifacts, reversible edits, site deltas, and proposal-only 3DGS job/asset/benchmark contracts | partial |
| M3 Indoor Navigation And First Deployment Twin - R3 | Validated metric floor, collision/free space, spawn/route gates, vacuum demonstration | evidence-blocked |
| M4 Physics Asset Factory - A0-A4 | Objectization, direct measurement, collider validation, and task-scoped physical calibration | planned |
| M5 Newton Runtime And OpenUSD Foundation | Solver-neutral client, supervised Newton worker, local/remote parity, Rapier removal | planned |
| M6 Newton/Isaac Lab/ROS Sensor Conformance - R4 | OpenUSD compiler, Newton backend parity, robot/sensor/clock conformance | planned |
| M7 Real2Sim Promise And Rigid Calibration - P5/P6 | Matched open-loop trials and held-out task dynamics that improve over defaults | planned |
| M8 Predictive Eval Studio - P7 | Variations, failure regions, critical-failure recall, and useful policy ranking | planned |
| M9 Deployment Operations And Continuous R2S2R - P8 | Site revisions, impact analysis, shadow/canary, rollback, and freshness | planned |
| M10 Expanded Embodiments And Multiphysics | Indoor/outdoor UAVs, vehicles, articulated manipulation, then deformables and coupled physics | planned |

## Current Implementation Tracks

### Live Evidence

- M0 evidence is recorded in `docs/live_session_phase1.md`.
- The M1 desktop boundary now keeps M0 loopback unchanged while adding explicit
  selected-interface pairing, pinned TLS, P-256 device identity, signed requests,
  expiry/revocation, and durable request-counter replay defense.
- The additive progressive-session contract now creates an immutable derived session
  identity before `capture.json` exists and binds the declared final manifest identity only
  during fail-closed sealing. M0 replay remains compatible.
- Simulate now inspects checksum-verified RGB-D, confidence, masks, camera, trajectory, and
  quality evidence through bounded on-demand previews. Point derivation is withheld because
  live v0.1 binds no depth units/scale, and it does not transport point-cloud or mesh bytes.
- Capture Splat implements the bounded sender, pairing, durable journal, recovery, and
  nonblocking post-write bridge. It is disabled by default and remains experimental on
  iPhone after a live-enabled physical trial reached serious thermal state before any
  upload attempt started. Networking cannot change keyframe acceptance.
- Live reconstruction workers remain isolated proposals and cannot mutate Capture Splat
  evidence or a loaded World.
- The M1 software worker boundary now defines strict capabilities, immutable checksum-bound
  inputs, requested budgets, explicit start/stop/retry, bounded logs, durable restart
  reconciliation, and verified proposal outputs. No reconstruction runtime is bundled, and
  these jobs do not implement or claim the M5 Newton physics runtime.
- Local Capture Splat finalization plus Manual Export is the production ingestion path.
  Physical Bonjour, firewall, interruption, restart, and multi-cycle evidence are optional
  live-transport promotion gates and do not block M1 progressive-world work.

### World And Editor

- Keep View, Edit, Simulate, Pilot, Sensors, and Episode as the six product modes.
- The first active M2 contract slice keeps canonical World, Asset, and Delta records
  separate from `WorldSession`, binds parent manifests and referenced content by SHA-256,
  and records transforms, uncertainty, provenance, authority, and reversible before/after
  edit effects without executing them.
- The pure Node canonical package store publishes immutable World and Asset revision
  directories atomically, preserves exact manifest bytes, rejects conflicting duplicates,
  and rehashes every direct and transitive Asset reference during recovery and reopen. Its
  root is injectable for tests and reserved for desktop `userData` integration; no current
  package reader, UI, IPC, or editor path uses it yet.
- Evolve current packages, reversible tools, and Episodes into the M2 immutable World
  Package and edit graph.
- Preserve ordinary PLY, Gaussian PLY, mesh, collision, navigation, semantic, and physics
  roles separately.
- The first 3DGS contract slice defines strict, checksum-bound training-job, Gaussian-asset,
  and benchmark-report records under `contracts/gaussian-pipeline/v0.1`. It does not register
  a trainer, load an output, publish a canonical Asset, or change physics. Training jobs use
  an explicit `null` seed when a provider exposes no deterministic seed control. Gaussian
  assets preserve unregistered trainer gauge as unknown units with null axes until a separate
  metric registration is accepted. Job quantization describes training storage; asset
  quantization independently describes serialized delivery encoding.
- The package reader validates additive Capture Splat handoff v0.3 `training_dataset`
  metadata and rebinds its canonical digest to `source_frames`; the result remains capture
  evidence and cannot create or execute a training job.

### Rendering And Large Assets

- Continue `docs/3dgs_walkthrough_measurement_plan.md`.
- Harden Spark + Three.js viewing, worker-backed parsing, fixed-camera parity, and LoD.
- Keep Gaussian appearance out of measurement and collision authority.
- Spark remains pinned at 2.1.0. The initial benchmark allowlist is NeRF Synthetic Lego,
  original-3DGS Deep Blending Playroom, and one local 122-frame iPhone capture. Lego and
  Playroom are available only for private local technical validation while dataset-byte rights
  remain under review; all other OneDrive assets remain cloud-only.
- Pinned Spirula Playroom outputs retain arbitrary COLMAP/SfM gauge and are visual-only;
  they cannot support measurement, collision, navigation, or physics until registered to
  separately validated metric geometry. Its mixed training storage does not imply compressed
  output: the observed exported PLY properties are dequantized float32.
- Apple M2 Max is the first target, not evidence for other devices. Cross-vendor Vulkan,
  native equirectangular, and 10M SH3 in 8GB claims remain held until exact-device reports
  satisfy the versioned benchmark contract without a fixed-camera quality regression.
- The corrected Playroom CPU-cache ladder passed seven eight-view/finite-output runs. Its
  checksum-bound 100,000-splat PLY subsequently passed candidate Spark load, centered framing,
  orbit, and zoom at revision `3ea4107`. Revision `cb0a93d` also returned the exact source bytes
  through the packaged preparation path with no conversion, clamps, normalization, or drops;
  that regression hashes to `31b53e38...8f0181c`. Fresh `cb0a93d` UI replay remains held because
  no honest generic Playroom harness is available. Performance, quality, metric, collision,
  navigation, and physics remain held.
- The checksum-bound Lego known-pose adapter, external Spirula 7,000-step result, and finite
  99,996-splat SH3 PLY passed candidate Spark 2.1 load, orbit, and inward zoom at revision
  `cb0a93d`. The run result hashes to `a16f0d23...a7323d4`, the r4 functional report to
  `598b3d74...70f06a3`, and the manual review to `7b4ab201...5fe61c7`. Supplied poses bypass
  SfM, external-USB timings are non-production, candidate release remains held, and this gate
  makes no general quality or capacity claim.
- The independent iPhone lane completed NetVLAD/ALIKED/LightGlue reconstruction, external
  Spirula training, finite SH3 export, and Spark 2.1 functional visibility/orbit/zoom. The SfM
  validator registered 300/300 images, while the selected 99,979-splat result remained visibly
  blurry with floaters. SfM, Spirula, and Spark/manual evidence hash to
  `1b992660...d9c7d`, `d6493854...580d0`, and `ace2c758...4cbe9` / `7e55e53a...5a3ba1`.
  Registration and functional visualization are promoted; package completeness, timing,
  release, render quality, metric, collision, navigation, and physics are held. The next gate
  is capture/reconstruction quality improvement with same-camera comparison, not first pipeline
  execution.

### Simulation, Calibration And R2S2R

- Rapier remains the active implementation while Newton parity fixtures are built. New
  product physics work targets the solver-neutral client and Newton worker instead of
  deepening Rapier-specific coupling.
- Newton is the only intended long-term product physics backend. It must pass local CPU,
  remote NVIDIA, collision, Episode, and task-outcome gates before cutover. Rapier is then
  removed rather than retained as a silent fallback.
- Physical Asset Calibration spans Edit, Sensors, Simulate, and Episode; it is not a new
  top-level mode.
- Real2Sim Promise, Physics Asset Factory, Eval Studio, and Deployment Twin are connected
  programs, not claims that current assets are predictive.
- Isaac Lab Newton is the first external training/evaluation adapter. Isaac RTX, Isaac
  Sim, and ROS 2 remain separately capability-tested adapters.
- Detailed adoption and migration gates live in the
  [R2S2R and Newton adoption note](docs/blueprints/world-compiler-v0.1/r2s2r-newton-2026-07-29/README.md).

### Packaging And Collaboration

- Keep browser tests and macOS packaged smoke green.
- Progress toward signed/notarized macOS, then Windows/Linux packaging.
- Use milestone issues, reproducible evidence, and explicit upstream/license decisions.

## Evidence-Dependent Work

The following work cannot be promoted by code or visual inspection alone:

- physical floor/wall and collision continuity;
- point-to-point measurement promotion;
- sensor-supervision and reconstruction A/B results;
- SPZ/LoD round-trip orientation and color;
- 3DGS training time, peak process/device memory, first-visible latency, frame-time
  distributions, and fixed-camera quality on each claimed hardware class;
- cross-vendor Vulkan, native equirectangular, and 10M SH3 in 8GB claims;
- physical calibration apparatus and held-out trials;
- Newton local/remote parity and effective-collider conformance;
- matched open-loop real/sim observation and outcome residuals;
- useful policy ranking, failure-region overlap, and false-safe controls;
- deployment recapture, impact analysis, canary, and rollback evidence;
- robot, UAV, and vehicle real/sim acceptance;
- deployment/TestFlight evidence.

Status details live in
`docs/blueprints/world-compiler-v0.1/ADOPTION_STATUS.md`.
