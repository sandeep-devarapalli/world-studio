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
| Loopback World Studio receiver | completed | Explicit loopback listener, durable ledger, ACK/reconciliation, restart/resume, proposal-only Simulate panel, packaged handoff reopen | Manual package import is the production iPhone handoff; live-device promotion is optional and evidence-blocked |
| Progressive source evidence | partial | Checksum-verified RGB-D, confidence, masks, camera, trajectory, quality, and package readers; real iPhone r3 SfM registered 300/300 images; complete-v2 verifies all 852 references; self-contained v0.3 handoff preserves the selected proposal and companions | Live mesh transport, a production worker adapter, visual/reconstruction-quality promotion, and physical acceptance |
| Gaussian and point inspection | partial | Spark/Three rendering, ordinary/Gaussian PLY distinction, frame cameras, Orbit/Free/Walk inspection, QA sidecars, and bounded Playroom and iPhone Spark gates; iPhone r6 displayed `spark gaussian · capture-splat-generic · 99979 splats` and promoted functional visibility/orbit/inward zoom from seven screenshots and distinct camera-response hashes | Render fidelity and candidate release remain held for visible smearing/blur/floaters, 11,452 clamped scales, and 9 hidden outliers; larger-asset LoD and renderer conformance also remain open |
| External 3DGS provider lane | partial | Pinned Spirula v5 ran a four-rung Apple M2 Max ladder and three fresh 7,000-step repetitions; selected validation v0.2 and the 99,979-splat PLY are hash-bound with `quality_claim=false`; r6 automated/manual reports are immutable and native render evidence is authoritative | Production trainer registration, canonical Asset publication, training/render-quality promotion, equivalent-condition timing/performance/render-time/memory/energy/capacity, and cross-vendor evidence; metric, collision, navigation, and Newton authority remain false |
| Benchmark host and storage hygiene | partial | Dedicated APFS scratch/project volumes, no configured Time Machine destination, hash-verified relocation and symlink cutovers, and an application audit that distinguished sparse logical size from allocated blocks | Encrypted independent backup for externally relocated data, mounted-volume dependency, and production-storage performance evidence |
| Current simulation substrate | partial | Rapier pilot substrate, bodies, collision debug, deterministic Episodes | Preserve parity fixtures; freeze backend-specific growth |
| Newton target runtime | planned | Target worker architecture and gated migration sequence | Solver-neutral client, worker supervisor, local/remote parity, cutover, and Rapier removal |
| Canonical World Package | partial | Strict World v0.2, Asset v0.1, and Delta v0.1 records plus a pure Node confined store preserve exact manifests, atomically publish immutable revisions, reject conflicts, and rehash direct and transitive Asset bytes during recovery and reopen | Electron/package-reader integration, remaining state carriers, current-package migration, edit execution, and UI round trips |
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
