# Roadmap

The canonical public plan is the
[World Compiler Blueprint v0.1](docs/blueprints/world-compiler-v0.1/README.md). Its
[milestone specification](docs/blueprints/world-compiler-v0.1/MILESTONES.md) defines
outcomes and acceptance gates.

| Milestone | Outcome | Status |
|---|---|---|
| M0 Live Evidence Foundation | Replay-first Capture Splat sender, strict receiver, resume, reconciliation, and proposal-only UI | completed |
| M1 Authenticated LAN And Progressive World | Paired TLS sender, bounded queues, live RGB-D/mesh proposals, isolated worker lifecycle | next |
| M2 Canonical World Package And Editor | Immutable versions, transform graph, content-addressed artifacts, reversible edits | partial/planned |
| M3 Indoor Navigation Ready - R3 | Validated metric floor, collision/free space, spawn/route gates, vacuum demonstration | evidence-blocked |
| M4 Physical Asset Calibration Foundation | Objectization, direct measurements, geometry/collision validation, C0-C2 recipes | planned |
| M5 Isaac/ROS Sensor Alignment - R4 | OpenUSD compiler, remote Isaac worker, ROS 2 and sensor parity | planned |
| M6 Rigid Interaction And Field Calibration - R5 | Instrumented system identification and held-out real/sim validation | planned |
| M7 Expanded Embodiments | Indoor/outdoor UAVs, vehicles, articulated manipulation, then deformables | planned |

## Current Implementation Tracks

### Live Evidence

- M0 evidence is recorded in `docs/live_session_phase1.md`.
- M1 starts with authenticated local-network pairing and a bounded iPhone sender.
- Live reconstruction workers remain isolated proposals and cannot mutate Capture Splat
  evidence or a loaded World.

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

### Simulation And Calibration

- Rapier remains the local runtime.
- Physical Asset Calibration spans Edit, Sensors, Simulate, and Episode; it is not a new
  top-level mode.
- Isaac Sim/Lab and ROS 2 remain external adapters until M5 capability and conformance
  gates pass.

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
- robot, UAV, and vehicle real/sim acceptance;
- deployment/TestFlight evidence.

Status details live in
`docs/blueprints/world-compiler-v0.1/ADOPTION_STATUS.md`.
