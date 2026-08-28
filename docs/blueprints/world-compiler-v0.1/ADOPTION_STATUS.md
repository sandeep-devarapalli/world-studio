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
| Progressive source evidence | partial | Checksum-verified RGB-D, confidence, masks, camera, trajectory, quality, package readers, and proposal-only worker lifecycle | Mesh transport, a reviewed worker adapter, reconstruction-quality gates, and physical acceptance |
| Gaussian and point inspection | partial | Spark/Three rendering, ordinary/Gaussian PLY distinction, frame cameras, Orbit/Free/Walk inspection, QA sidecars | Larger-asset LoD and renderer conformance |
| Current simulation substrate | partial | Rapier pilot substrate, bodies, collision debug, deterministic Episodes | Preserve parity fixtures; freeze backend-specific growth |
| Capability-routed physics runtime | partial | Layered OpenUSD synthetic smoke compiler, additive backend requirements, Newton 1.5.0 Apple CPU synthetic and Room-01 proposal receipts, supervised SuperDex 1.0.0 lifecycle, and a deterministic checksum-bound canonical World-to-SuperDex static scene compiler; all Room-01 authority remains false | Solver-neutral state client, supervised per-World SuperDex execution receipts, promoted-collider and local/remote parity, cutover, and Rapier removal |
| SuperDex contact-rich profile | partial | Pinned Physics/Robotics packages, package/license boundary, routing policy, supervised bounded worker lifecycle, three-repeat synthetic rigid contact/point-force/reset execution, and native loading of a generated static OBJ `.mochi_scene` fixture on Apple ARM CPU; authority is software-only | Robot Asset compiler, per-World contact/reset receipts, tactile/deformable probes, Franka tabletop A/B, and measured external reference |
| Canonical World Package | partial | Strict World v0.2, Asset v0.1, and Delta v0.1 records plus a pure Node confined store preserve exact manifests, atomically publish immutable revisions, reject conflicts, and rehash direct and transitive Asset bytes during recovery and reopen | Electron/package-reader integration, remaining state carriers, current-package migration, edit execution, and UI round trips |
| Reversible editor | partial | Select, crop, transform, delete/undo, optimize, measurements, package publish staging | Versioned edit graph, merge workflow, representation alignment |
| Room-01 hybrid canonical World R3 | evidence-blocked | Native SfM registered 411/450 inputs and metric registration accepted 194/204 RGB-D cameras at `0.455587656 m/unit` with `0.029027/0.057314 m` median/p95 residuals; the 92,906-point seed and finite 1,498,066-splat Spirula/Spark candidate are inspectable, but accepted portal membership is `side_a/through/side_b = 0/0/204`, the reduced collider is 91.0382% unknown and fails component/probe rails, and Rapier grants no authority | Form a hypothesis-tagged experimental proxy with unknown space no-go; separately promote floor/wall/doorway/free-space/component/probe, physical-clearance, and full-reset rails before production collision or robot/drone training; supplemental reverse capture is useful but not mandatory for proxy formation |
| Physics Asset Factory A0-A4 | planned | C0 capture evidence and reversible editor lessons exist | Registry, apparatus, collider validation, system identification, and Asset Passports |
| Newton/Isaac Lab/ROS alignment R4 | planned | Architecture and upstream research only | OpenUSD compiler, Newton worker, capability negotiation, sensor/clock conformance |
| Indoor UAV Room-01 pilot M6A | planned | Bounded post-M6 task and authority envelope are defined | Promoted Room-01, Newton/adapter conformance, UAV profile, clearance validation, and deterministic episode |
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
