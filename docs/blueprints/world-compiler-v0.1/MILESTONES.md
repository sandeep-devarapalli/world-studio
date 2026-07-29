# World Compiler Milestones

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

Outcome: bounded iPhone-to-Mac transfer with useful immediate evidence.

Status: partial. The M1A desktop boundary keeps M0 loopback unchanged and adds explicit
selected-interface pairing seams, QR invitation state, pinned TLS identity, P-256
device-request authentication, finite grants, expiry/revocation, signed-body binding, and
durable request-counter replay defense. The iPhone sender, progressive mesh/worker path, and
physical acceptance remain open.

Acceptance:

- Bonjour discovery and QR or short-code pairing with authenticated TLS.
- Capture remains local-first; sender queues are bounded and networking never changes frame
  acceptance.
- RGB-D, camera, mask, mesh, and quality proposals arrive with resume and reconciliation.
- Optional reconstruction workers have explicit lifecycle, provenance, resource budgets,
  and failure isolation.
- Two physical-device cycles preserve throughput, thermal behavior, and finalization.

The desktop implementation and software tests do not by themselves satisfy the first or
last acceptance items. Packaged macOS local-network permission/firewall behavior, physical
Bonjour discovery, real QR pairing, receiver restart, Wi-Fi interruption, and two complete
iPhone cycles must still be recorded.

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

## M3 Indoor Navigation And First Deployment Twin - R3

Outcome: one validated indoor mobile robot or vacuum world tied to a physical site revision.

Acceptance:

- Metric floor, walls, openings, occupancy, free space, spawn, and route gates pass.
- Collision is derived from validated metric geometry, not Gaussian appearance.
- The same frame, units, robot, sensor, route, and task definitions drive local and
  robot-facing runs.
- A vacuum demonstration completes zones, avoids a no-go area, returns to dock, and records
  reproducible real/sim route evidence.
- The Deployment Twin binds the exact World, site revision, robot, task, evidence, and
  freshness status.

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

## M5 Newton Runtime And OpenUSD Foundation

Outcome: Newton becomes the sole product physics backend after gated parity and Rapier
removal.

Acceptance:

- React and product UI use a solver-neutral `SimulationClient`.
- Electron supervises an isolated Python worker with safe job roots, capabilities, bounded
  logs, timeout, cancellation, restart, and fail-closed unavailable state.
- Local macOS CPU and remote Linux/NVIDIA jobs bind exact Newton, Warp, MuJoCo, solver,
  contact, device, timestep, seed, and source-version evidence.
- Layered OpenUSD compilation preserves frames, units, visual/collision separation, and
  provenance.
- Spawn, movement, contacts, props, sensors, reset, and deterministic Episode fixtures pass
  the declared parity thresholds.
- Simulate, Pilot, and Episode cut over to Newton, then Rapier code and dependencies are
  removed with no silent fallback.

## M6 Newton/Isaac Lab/ROS Sensor Conformance - R4

Outcome: one promoted World/Asset/Robot/Task set behaves consistently across standalone
Newton and external robot-learning adapters.

Acceptance:

- Isaac Lab Newton reports capabilities and consumes the same immutable versions.
- Isaac RTX and Isaac Sim remain separate rendering/sensor adapters rather than hidden
  physics authorities.
- ROS 2 clock, TF, odometry, controls, cameras, depth, LiDAR, and IMU pass frame, timing,
  noise, and route conformance.
- CPU/CUDA and standalone/adapter residual reports include unsupported features and
  prohibited uses.
- A scripted route produces comparable state, contact, sensor, and pose evidence.

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

1. Indoor UAV.
2. Outdoor UAV.
3. Vehicles and autonomous driving.
4. Rigid and articulated manipulation.
5. Deformable, contact-rich, and coupled multiphysics tasks.

Each embodiment requires its own sensors, collision/contact model, task profile, safety
envelope, physical evidence, solver capability report, and real/sim validation.
