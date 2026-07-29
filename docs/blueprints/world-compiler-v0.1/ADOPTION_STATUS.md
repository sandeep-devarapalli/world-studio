# Adoption Status

Status values:

- `completed`: merged, exercised, and documented on `main`.
- `partial`: useful implementation exists, but the milestone outcome is incomplete.
- `planned`: design direction exists without production implementation.
- `evidence-blocked`: code may exist, but physical or cross-runtime evidence is insufficient
  for promotion.

| Area | Status | Current evidence | Remaining gate |
|---|---|---|---|
| Replay-first Capture Splat contract | completed | Canonical session/frame/ACK schemas, strict fixtures, sender replay plan, hash/path validation, duplicate and resume tests | Authenticated LAN transport remains M1 |
| Loopback World Studio receiver | completed | Explicit loopback listener, durable ledger, ACK/reconciliation, restart/resume, proposal-only Simulate panel, packaged handoff reopen | Device sender remains M1 |
| Progressive source evidence | partial | Source frames, camera evidence, trajectory, package readers, ARKit mesh and Capture Splat handoff support | Bounded live RGB-D/mesh proposals and worker lifecycle |
| Gaussian and point inspection | partial | Spark/Three rendering, ordinary/Gaussian PLY distinction, frame cameras, Orbit/Free/Walk inspection, QA sidecars | Larger-asset LoD and renderer conformance |
| Local simulation substrate | partial | Rapier pilot substrate, bodies, collision debug, deterministic Episodes | Promoted metric collision and route gates |
| Canonical World Package | planned | Existing local package and Episode contracts provide implementation lessons | Immutable world versions, transform graph, artifact registry, migration tests |
| Reversible editor | partial | Select, crop, transform, delete/undo, optimize, measurements, package publish staging | Versioned edit graph, merge workflow, representation alignment |
| Indoor navigation readiness R3 | evidence-blocked | Registered mesh and local collision preview gates exist | Physical floor/wall continuity, occupancy/free-space validation, spawn/route evidence |
| Physical Asset Calibration | planned | C0 capture evidence and local Rapier experiments exist | C1-C2 apparatus, contracts, held-out residuals, task-scoped promotion |
| Isaac and ROS alignment R4 | planned | Architecture and upstream research only | OpenUSD compiler, remote worker, capability negotiation, ROS 2 conformance |
| Rigid interaction and field calibration R5 | planned | Episode provenance and replay foundation exist | Instrumented trials, system identification, held-out real/sim validation |
| Expanded embodiments | planned | Pilot/body abstractions and sensor concepts exist | Readiness profiles for UAVs, vehicles, manipulation, and deformables |

## Historical Source Reconciliation

The preserved [`source/CODEX_PROMPT.md`](source/CODEX_PROMPT.md) asks for Phase 0 and Phase
1 replay foundations. That work is already completed and merged. It is historical, not the
next implementation prompt.

The source bundle's world and Isaac schemas are useful design inputs but are not active
contracts. The source validation report proves syntax and fixture matching only; it does
not prove runtime adoption, simulator compatibility, or physical validity.
