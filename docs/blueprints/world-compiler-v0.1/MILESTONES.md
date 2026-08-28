# World Compiler Milestones

Milestones may advance through bounded, dependency-complete slices. Optional live transport
and held vendor, capacity, equirectangular, timing, or unrestricted-view claims do not block a
separately validated Room-01 artifact. A hold constrains only the claim or promotion it measures.

## M0 Live Evidence Foundation

Outcome: merge and close the replay/receiver Phase 1 foundation.

Acceptance:

- Canonical Capture Splat session/frame/ACK contracts are mirrored byte-for-byte.
- Replay handles corruption, unsafe paths, duplicates, gaps, disconnect, resume, and
  receiver restart.
- World Studio displays streamed evidence as proposal-only and never replaces a loaded
  world.
- Finalized handoffs reopen through the explicit package workflow.

Status: completed.

## M1 Authenticated LAN And Progressive World

Outcome: useful progressive evidence from manual packages and replay, with optional bounded
authenticated device transport when hardware budgets permit.

Status: partial. The M1A desktop boundary keeps M0 loopback unchanged and adds explicit
selected-interface pairing seams, QR invitation state, pinned TLS identity, P-256
device-request authentication, finite grants, expiry/revocation, signed-body binding, and
durable request-counter replay defense. The progressive inspector covers checksum-verified
RGB-D, confidence, masks, cameras, quality, and trajectory without inferring unsupported
geometry. A software-only optional reconstruction-worker lifecycle now binds immutable
inputs, requested budgets, bounded logs, failures, retries, and verified proposal outputs;
no production worker is bundled. Capture Splat's bounded iPhone sender is implemented but
disabled by default and held from promotion after a live-enabled physical trial reached
serious thermal state before any upload attempt started. Progressive mesh ingestion and
reconstruction-quality evidence remain open.

Acceptance:

- Bonjour discovery and QR or short-code pairing with authenticated TLS.
- Capture remains local-first; sender queues are bounded and networking never changes frame
  acceptance.
- RGB-D, camera, mask, mesh, and quality proposals arrive with resume and reconciliation.
- Optional reconstruction workers have explicit lifecycle, provenance, resource budgets,
  and failure isolation.
- Manual-exported captures reopen with complete immutable evidence and can drive the same
  progressive inspector and worker inputs as replayed sessions.

Physical Bonjour discovery, real QR pairing, receiver restart, Wi-Fi interruption, and two
complete device cycles remain required only to promote live transport on a specific device
class. They do not block M1 completion through manual import and replay.

## M2 Canonical World, Asset And Delta Graph

Outcome: immutable backend-neutral worlds and assets with reversible edits and site deltas.

Acceptance:

- Content-addressed artifacts, transform graph, units, authority, uncertainty, and parent
  versions are explicit.
- Crop, transform, filter, merge, hide, replace, objectize, and annotate operations are
  reversible and auditable.
- Appearance, metric, collision, navigation, semantic, articulation, and physics layers
  stay aligned but retain separate authority.
- Site revisions and asset revisions form immutable deltas rather than mutating prior
  evidence.
- Package migration and round-trip tests reproduce referenced bytes.
- 3DGS training jobs bind exact dataset manifests, worker source/build identity, feature
  profile, outputs, and resource budgets without carrying executable authority; seed is an
  observed non-negative integer or explicit `null` when the provider exposes no seed control.
- Gaussian assets bind the exact job and dataset, representation/coordinate/color metadata,
  finite-value validation, sidecars, and a visual-only prohibited-use boundary. Arbitrary
  SfM/trainer gauge remains unknown-unit with null axes until metric registration is accepted;
  serialized-asset quantization remains independent of training-storage precision.
- Benchmark reports bind exact job, asset, dataset, World Studio/Spark versions, hardware,
  commands, repetitions, distributions, raw evidence, quality cameras, noise controls, and
  `promote|hold|reject`; unmeasured vendor, capacity, projection, and feature claims stay held.
- Additive Capture Splat handoff v0.3 `training_dataset` metadata is shape-validated and its
  canonical frame count/digest is rebound to `source_frames`; it remains capture evidence,
  not a trainer request, execution receipt, or authority promotion.
- Trainer execution, Spark loading, and canonical Asset publication remain explicit later
  gates rather than side effects of validating these records.

Immediate delivery slice: the packaged Electron path supervises the external provider receipt,
publishes, reopens, and visibly identifies one immutable Room-01 revision with exact artifact
bytes and separate authority roles. This does not waive the remaining general editor, migration,
or cross-platform gates.

Current evidence note (non-normative, 2026-08-21): checksum-bound Playroom and Lego PLYs have
passed candidate Spark 2.1 functional visualization gates. The Lego lane used supplied camera
poses and therefore did not validate SfM. Its result report hashes to `a16f0d23...a7323d4`, and
the r4 functional and bound manual reports hash to `598b3d74...70f06a3` and
`7b4ab201...5fe61c7`. Current-candidate Playroom preparation also returned exact unchanged
bytes in report `31b53e38...8f0181c`. The fresh provenance-bound Playroom UI replay and manual
review now pass functional visibility, orbit, and inward zoom in reports
`a6b03e82...6d0410b` and `bde803c8...60e15a`; fixed-camera quality review
`ae6ba23a...d335c5` keeps visual quality and candidate release held.

The independent iPhone HLOC-to-Spirula-to-Spark lane promoted 300/300-image registration and
functional visibility/orbit/zoom. Its SfM, Spirula, Spark, and manual evidence hash to
`1b992660...d9c7d`, `d6493854...580d0`, `ace2c758...4cbe9`, and `7e55e53a...5a3ba1`.
Package completeness, USB timing, candidate release, and quality remain held; the next gate is
same-camera capture/reconstruction quality improvement. This does not change M2 acceptance,
publish a canonical Asset, or grant metric, collision, navigation, physics, performance,
quality, or general capacity authority.

The separate 2026-08-23 Room-01 open-door lane produced a finite 1,498,066-splat SH3 PLY of
371,521,900 bytes after 7,000 Spirula steps. The source PLY hashes to
`56dc6ab645f099bef670f07516046ce9ddcd65d94c44c007e08f35374bb37bd8`. Spark 2.1
functional and bound manual reports hash to
`4e153b9c0b456a7b42a0256915ba218958a7faf20c09c269815d16d6078392c8` and
`bec934101b91d9a5f6df09fedf6ca3cf2a913a6b30bb5cf5ec2f4bda28158e76`. Exact load and
inspection are promoted; unrestricted views, named source-camera review, native-360 support,
robot/drone RGB observations, package authority, and performance remain held.
Exterior clouding and floaters are expected outside this interior-only capture's observed-ray
volume and do not downgrade the supported interior. `7,000` is the training-step count, not the
retained Gaussian count; longer rungs may improve supported-view appearance but cannot create
unobserved metric or collision geometry.

## M3 Room-01 Metric/Collision World And First Deployment Twin - R3

Outcome: publish one immutable Room-01 World with registered Spirula appearance, validated
metric geometry, separately derived collision/navigation layers, and a reproducible
reference-mobile-robot route.

Acceptance:

- Exact source, camera, depth, trajectory, mesh, registration, transform, and artifact hashes
  and provenance are bound; similarly named recovery artifacts are not silently substituted.
- Spirula output is finite, camera/transform-bound, Spark-loadable, and reviewed at fixed source
  cameras while remaining visual-only.
- The collision source is complete or proves coverage preservation. A source marked
  `truncated: true` fails closed.
- Floor, walls, ceiling/overhangs, doorway/openings, occupancy, and free space pass continuity
  and clearance gates.
- The simplified collider is finite, nondegenerate, within its declared triangle budget,
  preserves doorway clearance, uses no artificial fallback floor, and remains separate from
  Gaussian appearance.
- The packaged application publishes and reopens the exact immutable World while displaying
  revision, roles, authority, and provenance.
- A reference mobile robot reproducibly completes
  `spawn -> doorway -> no-go avoidance -> return to spawn or dock -> reset` under the frozen
  Rapier parity baseline.
- The Deployment Twin binds the exact World, site revision, robot, task, evidence, and
  freshness status.

Current evidence note (non-normative, 2026-08-23): native SfM registered 411/450 inputs,
comprising 217/246 video frames and 194/204 authoritative RGB-D frames. Accepted metric
registration reports `0.455587656 m/unit`, median/p95 residuals of
`0.029027/0.057314 m`, and a 92,906-point seed. The finite Spirula/Spark appearance candidate
above satisfies only the visual and functional part of this milestone. Its approximately
90-degree orientation defect and missing bound source-camera identity remain separate visual
contract defects.

The capture records one `door_1` crossing, but accepted RGB-D portal membership is
`side_a/through/side_b = 0/0/204`. The 136,810-vertex, 260,038-face TSDF is not a promotable
collider: its hybrid candidate has 59.1417% unknown coverage, while the 59,999-face reduction
has 91.0382% unknown coverage and fails component and replayable-probe rails. Five reducer
repetitions were byte-identical, with 7.94 s median elapsed time, 611,549,184-byte maximum RSS,
and zero swaps. Performance remains held because the observations came from one host and
external USB storage; the benchmark report hashes to
`5b5b415e151747acc2174b78861d7a4c855261507c084a953e30f1a43e2bb1d2`.

Rapier receipt `0b8cf1b1fca7b0da50f66c7af8df4788a7a22771d05b4166abd065d4333959da`
accepts parser, checksum, metadata, no-fallback, unknown-region fail-closed, and deterministic
controller-pose restore checks. Floor, wall, doorway, full episode reset, physical behavior,
and every collision/navigation/physics authority remain held. Side A and side B are the two
spatial sides of this one portal, not two physical doors. A supplemental reverse pass remains
useful evidence, but it is not a prerequisite for forming an experimental proxy World: unknown
space must stay no-go, inferred surfaces must be marked hypotheses, and no proxy may acquire
collision, navigation, physics, or training authority until the existing M3 rails pass.

The first such experimental proxy now binds seven RoomPlan wall proposals, nine inflated
object boxes, an inferred floor, an unknown-side guard at `door_1`, and a guard over the
unvalidated `door_0` proposal. Three Newton CPU repetitions made identical physical guard
contact and exact resets. Receipt SHA-256 is
`20eb471532dbef1ab1a8aa7a52e2017c0a6b19829890fc626b9e02cbe3ba9357`.
This promotes only conservative experimental contact/reset execution; the Gaussian is unused
for collision and every Room-01 authority remains false.

## M4 Physics Asset Factory - A0-A4

Outcome: reusable objectized assets with registered visual, metric, collision, semantic,
articulation, and task-scoped physical layers.

Acceptance:

- Asset Passports preserve source hashes, units, frames, uncertainty, lineage, approved
  uses, and prohibited uses.
- Direct dimensions and mass measurements record apparatus, calibration, uncertainty, and
  source class.
- Effective colliders are compared with metric evidence and task-relevant openings and
  contact surfaces.
- Ramp, slide, drop, compression, wheel, brake, or articulation trials produce
  experiment-conditioned estimates with feasibility checks.
- Reports compare against simulator defaults without claiming universal physical accuracy.

## M5 Capability-Routed Physics Runtime And OpenUSD Foundation

Outcome: Newton becomes the default OpenUSD/general/Isaac backend and SuperDex becomes the
contact-rich specialist after task-scoped parity and Rapier removal.

Acceptance:

- React and product UI use a solver-neutral `SimulationClient`.
- Electron supervises isolated Newton and SuperDex workers with safe job roots, explicit
  capabilities, bounded logs, timeout, cancellation, restart, and fail-closed unavailable
  state.
- Local macOS CPU and remote Linux/NVIDIA jobs bind exact Newton, Warp, MuJoCo, solver,
  contact, device, timestep, seed, and source-version evidence.
- Layered OpenUSD compilation preserves frames, units, visual/collision separation, and
  provenance.
- Room-01 is the first OpenUSD/Newton fixture. The visual Gaussian is referenced separately;
  Newton consumes only the validated metric collision layer. Local macOS CPU
  load/spawn/contact/reset evidence precedes remote Linux/NVIDIA parity.
- Spawn, movement, contacts, props, sensors, reset, and deterministic Episode fixtures pass
  the declared parity thresholds.
- General tasks prefer Newton; contact-force-distribution, tactile, and supported deformable
  tasks prefer SuperDex. An explicit request never falls back to the other backend.
- Simulate, Pilot, and Episode cut over to capability-routed workers, then Rapier code and
  dependencies are removed.

Current Room-01 gate (2026-08-23): experimental Newton execution may start with synthetic or
hypothesis-tagged proxy layers whose authority is false and whose unknown space is no-go.
Newton 1.5.0 on Apple M2 Max CPU has passed a bounded synthetic floor/wall contact and exact
three-repetition reset smoke; receipt SHA-256 is
`3840bc6e01bf0fcf4b9c83362a2d8a62f29257a20457e12f4d57083000ad6988`.
The subsequent Room-01 proposal proxy also passed three identical guard-contact/reset runs;
receipt SHA-256 is
`20eb471532dbef1ab1a8aa7a52e2017c0a6b19829890fc626b9e02cbe3ba9357`, with USD import still
held because the pinned environment did not include `pxr`.
Production collision, route episodes, robot/drone training, and product cutover remain blocked
until M3 promotes registered free space and a collider that passes floor, wall, doorway,
component, physical, and replayable-probe rails.

## M5A Observed-Room Tabletop Manipulation

Outcome: a fixed Franka Panda or FR3 performs a bounded rigid pick/place/reset Episode on a
validated table inside the observed room, with Newton and SuperDex results kept distinct.

Acceptance:

- The table top, arm mount, 50 mm cube, robot model, gripper, masses, frames, and effective
  colliders have immutable hashes and task-scoped authority.
- World Studio compiles the same canonical assets into layered OpenUSD and checksum-bound
  SuperDex derivatives without using Gaussian appearance as collision geometry.
- The native Edit, Simulate, Pilot, Sensors, and Episode surfaces support placement, joint and
  IK control, gripper commands, contact inspection, replay, and reset without embedding
  SuperDex Studio or adding a seventh mode.
- The Episode executes `home -> pre-grasp -> approach -> close -> lift -> translate -> place
  -> retreat -> home -> reset` for ten deterministic repetitions per eligible backend.
- Reports preserve backend-specific object pose, slip, penetration, contacts, forces, joint
  effort, timing, memory, reset residuals, unsupported features, and prohibited uses.
- A successful simulated pick/place is software evidence only until a measured real tabletop
  trial supports the declared physical-prediction envelope.

## M6 Newton/Isaac Lab/ROS Sensor Conformance - R4

Outcome: the promoted Room-01 World and M3 reference robot behave consistently across
standalone Newton and external robot-learning adapters.

Acceptance:

- Isaac Lab Newton reports capabilities and consumes the same immutable versions.
- Isaac RTX and Isaac Sim remain separate rendering/sensor adapters rather than hidden
  physics authorities.
- ROS 2 clock, TF, odometry, controls, cameras, depth, LiDAR, and IMU pass frame, timing,
  noise, and route conformance.
- CPU/CUDA and standalone/adapter residual reports include unsupported features and
  prohibited uses.
- A scripted route produces comparable state, contact, sensor, and pose evidence.
- Passing this Room-01 conformance set unlocks M6A. M7-M9 are not prerequisites for the
  bounded indoor-UAV pilot.

## M6A Indoor UAV Room-01 Pilot

Outcome: one bounded indoor-UAV training/evaluation episode uses the promoted Room-01 World
immediately after M6.

Acceptance:

- An immutable UAV profile declares its body and rotor-clearance envelope, mass, inertia,
  actuator limits, frames, units, and source authority.
- Camera, depth or LiDAR, and IMU definitions are versioned and pass the M6 frame, timing, and
  noise contracts.
- Metric corridor, doorway, ceiling/overhang, and obstacle clearance are validated against the
  collision layer.
- A deterministic `spawn -> takeoff -> hover -> doorway or corridor -> avoid -> land -> reset`
  episode records poses, controls, contacts, sensors, seed, and outcome.
- Standalone Newton and the selected Isaac Lab/ROS adapters consume the same immutable World,
  Asset, Robot, Sensor, and Task versions.
- The result grants no live-flight, outdoor, wind, deployment, or general UAV readiness claim.

## M7 Real2Sim Promise And Rigid Calibration - P5/P6

Outcome: task-scoped rigid or articulated dynamics are validated on matched and held-out
physical trials.

Acceptance:

- A versioned Real2Sim Promise binds exact World, Asset, Robot, Sensor, Task, solver
  profile, collision representation, and evidence.
- Instrumented C3-C4 experiments estimate identifiable mass, center of mass, inertia,
  contact, wheel, or joint parameters with uncertainty.
- Fitting and held-out trials are immutable and separated.
- Matched open-loop observations, states, contacts, and outcomes are compared.
- Held-out task residuals improve over simulator defaults without unacceptable safety or
  behavior regression.

## M8 Predictive Eval Studio - P7

Outcome: simulated evaluation supports useful policy and engineering decisions.

Acceptance:

- Eval suites bind immutable variations, policies, worlds, assets, robots, sensors, tasks,
  solver profiles, and seeds.
- Reports measure policy rank correlation, improvement-direction agreement, failure-region
  overlap, critical-failure recall, false-safe rate, and task outcomes.
- Regressions and known unknowns are visible by variation and operating envelope.
- Promotion decisions are explicit `reject|shadow|canary|promote|rollback` records.

## M9 Deployment Operations And Continuous R2S2R - P8

Outcome: field evidence continuously updates a versioned Deployment Twin without
overwriting history.

Acceptance:

- Targeted Capture Splat recaptures produce site revisions and
  changed/unchanged/unknown proposals.
- Impact analysis marks affected assets, routes, tasks, Promises, eval suites, and
  deployments stale.
- Shadow replay, bounded canary, promotion, and rollback use immutable evidence and
  declared criteria.
- Zone-level freshness and field Episodes are monitored.
- A full capture, compile, evaluate, deploy, recapture, revise, and revalidate loop passes.

## M10 Expanded Embodiments And Multiphysics

Outcome: readiness expands by embodiment and physics domain, not by reusing one generic
score.

Order:

1. Indoor UAV expansion beyond the bounded Room-01 M6A pilot.
2. Outdoor UAV.
3. Vehicles and autonomous driving.
4. Rigid and articulated manipulation.
5. Deformable, contact-rich, and coupled multiphysics tasks.

Each embodiment requires its own sensors, collision/contact model, task profile, safety
envelope, physical evidence, solver capability report, and real/sim validation. M6A evidence
does not transfer outside its Room-01 task envelope.
