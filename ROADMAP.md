# Roadmap

The canonical public plan is the
[World Compiler Blueprint v0.1](docs/blueprints/world-compiler-v0.1/README.md). Its
[milestone specification](docs/blueprints/world-compiler-v0.1/MILESTONES.md) defines
outcomes and acceptance gates.

| Milestone | Outcome | Status |
|---|---|---|
| M0 Live Evidence Foundation | Replay-first Capture Splat sender, strict receiver, resume, reconciliation, and proposal-only UI | completed |
| M1 Authenticated LAN And Progressive World | Manual-import and replay-first progressive evidence, optional paired TLS transport, and isolated worker lifecycle | partial; iPhone live transport held by thermal evidence |
| M2 Canonical World, Asset And Delta Graph | Immutable versions, transform graph, content-addressed artifacts, reversible edits, site deltas, and proposal-only 3DGS job/asset/benchmark contracts | partial; Room-01 visual handoff and Spark functional candidate exist, but the new native revision's canonical publish/reopen remains open |
| M3 Room-01 Metric/Collision World And First Deployment Twin - R3 | Registered appearance and metric evidence, complete collision/free space, and a reproducible reference-robot route | active and evidence-blocked; registered metric/appearance evidence exists, portal/free-space and collider rails fail closed |
| M4 Physics Asset Factory - A0-A4 | Objectization, direct measurement, collider validation, and task-scoped physical calibration | planned |
| M5 Newton Runtime And OpenUSD Foundation | Solver-neutral client, supervised Newton worker, local/remote parity, Rapier removal; Room-01 is the first fixture | planned |
| M6 Newton/Isaac Lab/ROS Sensor Conformance - R4 | OpenUSD compiler, Newton backend parity, robot/sensor/clock conformance on Room-01 | planned |
| M6A Indoor UAV Room-01 Pilot | Bounded takeoff, hover, doorway/corridor, avoidance, landing, and reset episode | planned; starts after M6 without waiting for M7-M9 |
| M7 Real2Sim Promise And Rigid Calibration - P5/P6 | Matched open-loop trials and held-out task dynamics that improve over defaults | planned |
| M8 Predictive Eval Studio - P7 | Variations, failure regions, critical-failure recall, and useful policy ranking | planned |
| M9 Deployment Operations And Continuous R2S2R - P8 | Site revisions, impact analysis, shadow/canary, rollback, and freshness | planned |
| M10 Expanded Embodiments And Multiphysics | Expansion beyond M6A: broader indoor and outdoor UAVs, vehicles, articulated manipulation, deformables, and coupled physics | planned |

## Immediate Product Slice: Room-01

The 2026-08-23 open-door capture is now the active Room-01 checkpoint. Native SfM registered
411/450 inputs: 217/246 video frames and 194/204 authoritative RGB-D frames. Accepted metric
registration reports `0.455587656 m/unit`, with median/p95 camera residuals of
`0.029027/0.057314 m`, and produced a 92,906-point metric seed.

External Spirula training at 7,000 steps produced a finite 1,498,066-splat SH3 PLY of
371,521,900 bytes, SHA-256
`56dc6ab645f099bef670f07516046ce9ddcd65d94c44c007e08f35374bb37bd8`. Spark 2.1 exact
load, orbit, zoom, inside movement, reset, and teardown are promoted as functional and
finite/inspectable evidence only. The functional report hashes to
`4e153b9c0b456a7b42a0256915ba218958a7faf20c09c269815d16d6078392c8`; its bound manual
review hashes to `bec934101b91d9a5f6df09fedf6ca3cf2a913a6b30bb5cf5ec2f4bda28158e76`.
Unrestricted-view quality, named source-camera review, native-360 support, and robot/drone RGB
observations remain held.

Physics readiness remains blocked. The capture records one `door_1` crossing, but accepted
RGB-D portal membership is `side_a/through/side_b = 0/0/204`, so it does not prove a
registered route through the opening. The TSDF has 136,810 vertices and 260,038 faces. Its
hybrid candidate is 59.1417% unknown; the 59,999-face reduction is 91.0382% unknown and
fails the component and replayable-probe rails. Five reducer repetitions were byte-identical
with 7.94 s median elapsed time, 611,549,184-byte maximum RSS, and zero swaps, but performance
is held because this is one host on external USB storage. The benchmark report hashes to
`5b5b415e151747acc2174b78861d7a4c855261507c084a953e30f1a43e2bb1d2`.

The Rapier receipt, SHA-256
`0b8cf1b1fca7b0da50f66c7af8df4788a7a22771d05b4166abd065d4333959da`, accepts parsing,
checksums, metadata, no-fallback behavior, unknown-region fail-closed behavior, and
controller-pose restore. It holds floor, wall, doorway, full episode reset, physical behavior,
and every collision/navigation/physics authority. Newton therefore remains blocked. The next
exact gate is a short supplemental reverse doorway RGB-D pass covering side A, threshold, and
side B, followed by a complete registered portal/free-space route.

Room-01 crosses the roadmap in one bounded sequence:

1. Freeze the exact source manifest and run external Spirula appearance work in parallel with
   complete or proven coverage-preserving metric-mesh export.
2. M2 publishes and reopens one immutable World whose appearance, metric, collision,
   navigation, semantic, and physics roles remain separate.
3. M3 derives a bounded collider, validates floor/wall/ceiling/opening continuity and doorway
   clearance, and runs a reproducible reference-mobile-robot route.
4. M5 compiles the same World into layered OpenUSD and executes it in Newton.
5. M6 proves standalone Newton, Isaac Lab, and ROS frame, sensor, and route conformance.
6. M6A runs the bounded indoor-UAV episode in the promoted Room-01 World.

Standard-dataset, equirectangular, capacity, timing, and cross-vendor benchmarks continue as
parallel claim-validation rails. A hold there does not stop Room-01 unless the exact Room-01
artifact fails its finite-value, coordinate, visual-observation, metric, collision, storage,
or runtime gate.

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
- The immediate M2 delivery slice supervises one external Room-01 trainer receipt, publishes
  its visual-only Gaussian Asset beside separately registered metric layers, and reopens the
  exact immutable World through the packaged desktop path. General editor breadth continues
  in parallel and does not block this bounded slice.
- The package reader validates additive Capture Splat handoff v0.3 `training_dataset`
  metadata and rebinds its canonical digest to `source_frames`; the result remains capture
  evidence and cannot create or execute a training job.

### Rendering And Large Assets

- Continue `docs/3dgs_walkthrough_measurement_plan.md`.
- Harden Spark + Three.js viewing, worker-backed parsing, fixed-camera parity, and LoD.
- Keep Gaussian appearance out of measurement and collision authority.
- Spark remains pinned at 2.1.0. The standard matrix is NeRF Synthetic Lego for deterministic
  smoke, original-3DGS Deep Blending Playroom as the completed real-scene control, and complete
  Mip-NeRF 360 Bonsai `images_2` as the active 360 quality lane. Capture Splat and Room-01 stay
  separate iPhone capture-to-world lanes. Dataset rights, hashes, and source completeness remain
  explicit; all unrelated OneDrive assets remain cloud-only.
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
  that regression hashes to `31b53e38...8f0181c`. A fresh provenance-bound standard-dataset UI
  replay now passes exact native Spark 2.1 load, orbit, inward zoom, diagnostics, source
  immutability, teardown, and manual inspection; functional and manual reports hash to
  `a6b03e82...6d0410b` and `bde803c8...60e15a`. Functional visualization is promoted. Visible
  blur, smearing, and peripheral floaters keep release and visual quality held; performance,
  metric, collision, navigation, and physics also remain held.
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
- Room-01 is the frozen first parity fixture. M6A begins after its M6 conformance set passes;
  M7-M9 are not prerequisites for that bounded indoor-UAV pilot.
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

Each item holds only its associated claim or promotion. It does not impose a global stop on
unrelated candidate formation or separately gated Room-01 work.

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
