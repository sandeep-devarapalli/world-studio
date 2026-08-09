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
| Progressive source evidence | partial | Checksum-verified RGB-D, confidence, masks, camera, trajectory, quality, package readers, and proposal-only worker lifecycle | Mesh transport, a reviewed worker adapter, reconstruction-quality gates, and physical acceptance |
| Gaussian and point inspection | partial | Spark/Three rendering, ordinary/Gaussian PLY distinction, frame cameras, Orbit/Free/Walk inspection, QA sidecars | Larger-asset LoD and renderer conformance |
| Current simulation substrate | partial | Rapier pilot substrate, bodies, collision debug, deterministic Episodes | Preserve parity fixtures; freeze backend-specific growth |
| Newton target runtime | planned | Target worker architecture and gated migration sequence | Solver-neutral client, worker supervisor, local/remote parity, cutover, and Rapier removal |
| Canonical World Package | partial | Strict World v0.2 and Asset v0.1 snapshots plus the Delta v0.1 before/after grammar bind immutable parents, content hashes, transforms, uncertainty, provenance, and separate authority lanes; snapshot-backed transitions fail closed outside supported combinations | Confined package store, remaining state carriers, current-package migration, edit execution, and referenced-byte round trips |
| Reversible editor | partial | Select, crop, transform, delete/undo, optimize, measurements, package publish staging | Versioned edit graph, merge workflow, representation alignment |
| Indoor navigation readiness R3 | evidence-blocked | Registered mesh and local collision preview gates exist | Physical floor/wall continuity, occupancy/free-space validation, spawn/route evidence |
| Physics Asset Factory A0-A4 | planned | C0 capture evidence and reversible editor lessons exist | Registry, apparatus, collider validation, system identification, and Asset Passports |
| Newton/Isaac Lab/ROS alignment R4 | planned | Architecture and upstream research only | OpenUSD compiler, Newton worker, capability negotiation, sensor/clock conformance |
| Real2Sim Promise P5/P6 | planned | Episode provenance and replay foundation exist | Matched open-loop trials, system identification, held-out task validation |
| Predictive Eval Studio P7 | planned | Deterministic Episodes and task concepts exist | Variations, policy artifacts, failure regions, ranking, and false-safe evidence |
| Deployment Twin and continuous R2S2R P8 | planned | Capture handoff and versioning direction exist | Site revisions, impact graph, field Episodes, shadow/canary/rollback |
| Expanded embodiments and multiphysics | planned | Pilot/body abstractions and sensor concepts exist | Readiness profiles for UAVs, vehicles, manipulation, deformables, and coupled solvers |

## Historical Source Reconciliation

The preserved [`source/CODEX_PROMPT.md`](source/CODEX_PROMPT.md) asks for Phase 0 and Phase
1 replay foundations. That work is already completed and merged. It is historical, not the
next implementation prompt.

The source bundle's world and Isaac schemas are useful design inputs but are not active
contracts. The source validation report proves syntax and fixture matching only; it does
not prove runtime adoption, simulator compatibility, or physical validity.

The later
[R2S2R and Newton adoption note](r2s2r-newton-2026-07-29/README.md) supersedes the source
bundle's permanent-Rapier assumption. Rapier remains the current implementation until the
documented Newton parity and cutover gates pass.
