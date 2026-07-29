# Roadmap

The canonical public plan is the
[World Compiler Blueprint v0.1](docs/blueprints/world-compiler-v0.1/README.md). Its
[milestone specification](docs/blueprints/world-compiler-v0.1/MILESTONES.md) defines
outcomes and acceptance gates.

| Milestone | Outcome | Status |
|---|---|---|
| M0 Live Evidence Foundation | Replay-first Capture Splat sender, strict receiver, resume, reconciliation, and proposal-only UI | completed |
| M1 Authenticated LAN And Progressive World | Paired TLS sender, bounded queues, live RGB-D/mesh proposals, isolated worker lifecycle | partial |
| M2 Canonical World, Asset And Delta Graph | Immutable versions, transform graph, content-addressed artifacts, reversible edits, site deltas | partial/planned |
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
- The bounded iPhone sender remains the next implementation slice. It must enqueue only
  after durable local writes and cannot change keyframe acceptance.
- Live reconstruction workers remain isolated proposals and cannot mutate Capture Splat
  evidence or a loaded World.
- Physical Bonjour, firewall, Wi-Fi interruption, receiver-restart, and two-cycle iPhone
  evidence remain acceptance gates; software-only tests do not close them.

### World And Editor

- Keep View, Edit, Simulate, Pilot, Sensors, and Episode as the six product modes.
- Evolve current packages, reversible tools, and Episodes into the M2 immutable World
  Package and edit graph.
- Preserve ordinary PLY, Gaussian PLY, mesh, collision, navigation, semantic, and physics
  roles separately.

### Rendering And Large Assets

- Continue `docs/3dgs_walkthrough_measurement_plan.md`.
- Harden Spark + Three.js viewing, worker-backed parsing, fixed-camera parity, and LoD.
- Keep Gaussian appearance out of measurement and collision authority.

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
- physical calibration apparatus and held-out trials;
- Newton local/remote parity and effective-collider conformance;
- matched open-loop real/sim observation and outcome residuals;
- useful policy ranking, failure-region overlap, and false-safe controls;
- deployment recapture, impact analysis, canary, and rollback evidence;
- robot, UAV, and vehicle real/sim acceptance;
- deployment/TestFlight evidence.

Status details live in
`docs/blueprints/world-compiler-v0.1/ADOPTION_STATUS.md`.
