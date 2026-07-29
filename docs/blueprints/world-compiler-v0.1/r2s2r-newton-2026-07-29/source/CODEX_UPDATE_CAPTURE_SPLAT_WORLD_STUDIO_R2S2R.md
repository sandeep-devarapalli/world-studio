# Codex Task: Update Capture Splat and World Studio roadmaps for Real2Sim, Asset Factory, Evals, Deployments and R2S2R

You are working in these repositories:

- `sandeep-devarapalli/capture-splat`
- `sandeep-devarapalli/world-studio`

Read the current `ROADMAP.md`, contribution guide, contracts, World Compiler Blueprint, `PHYSICAL_ASSET_CALIBRATION.md`, progressive reconstruction plans and current tests before editing.

## Objective

Update both public roadmaps so the product is an evidence-backed Real-to-Sim-to-Real operating system with four explicit capabilities:

1. Real2Sim Compiler and a task-scoped **Real2Sim Promise**;
2. Physics Asset Factory and Registry, including upholstered-chair and unoccupied-wheelchair reference assets;
3. Predictive Eval Studio for failure regions, sensitivity, policy ranking and hardware screening;
4. Deployment Twin and continuous R2S2R operations for site changes, field episodes, canary and rollback.

Do not claim these capabilities are implemented. Distinguish `completed`, `partial`, `planned` and `evidence-blocked` accurately.

## Non-negotiable architecture

- Capture Splat owns authoritative, local-first evidence.
- World Studio owns immutable worlds, assets, tasks, evals, deployments and promotion.
- Gaussian splats are appearance and visual-sensor assets, not collision or universal physics authority.
- Metric points/fusion, collision, navigation, semantics and physics remain separate roles.
- Rapier remains the local preview backend.
- Isaac Sim/Lab remains an external worker/adapter.
- Preserve World Studio's six modes: View, Edit, Simulate, Pilot, Sensors and Episode.
- Never overwrite source evidence, a prior World version or a promoted asset.
- All physical parameters require units, provenance, uncertainty, simulator/contact-model scope and `approved_for`/`not_approved_for`.
- Public claims use “physics-calibrated within a validated task envelope,” not “universally physics accurate.”

## Capture Splat roadmap changes

Preserve the completed Live Session Foundation and current Authenticated Sender work. Add milestones:

### CS-R2S1 Task, Robot and Site Brief

- deployment/site/zone identity;
- robot and sensor profile references;
- natural-language goal plus strict TaskSpec draft;
- work, excluded and safety-critical regions;
- required promise level;
- unresolved grounding returns `hold`.

### CS-R2S2 Asset Capture and Calibration Trial Modes

Document new capture intents:

- Physics Asset Orbit;
- dimensions/scale;
- slide/ramp;
- push/tip;
- drop/restitution;
- compression/recovery;
- pendulum/inertia;
- roll/coast-down/brake;
- articulation range.

Capture apparatus identity, calibration, uncertainty, synchronization, fit/holdout grouping and raw evidence. Never promote physics on the phone.

### CS-R2S3 Matched Open-Loop and Task Demonstration Capture

Capture robot actions/commands, sensor/robot logs or rosbag references, initial-state alignment, interventions, outcomes, clock mapping and sample-drop reports.

### CS-R2S4 Deployment Recapture and Change Evidence

Select an existing deployment/World/zone, relocalize into its frame, capture a targeted delta, link field episodes/incidents and emit immutable `site_delta_evidence` proposals. Failed relocalization remains `hold`.

### CS-R2S5 Physical Device Acceptance

Add release gates for thermal, storage, writer drops, networking, finalization, clock sync, calibration apparatus and deployment privacy/PII controls.

Add a detailed document:

- `docs/real2sim_capture_program.md`

Propose, but do not activate without implementation and tests, schemas for:

- `capture_splat.task_brief.v0.1`
- `capture_splat.asset_capture.v0.1`
- `capture_splat.calibration_trial.v0.1`
- `capture_splat.task_demonstration.v0.1`
- `capture_splat.deployment_recapture.v0.1`
- `capture_splat.site_delta_evidence.v0.1`
- `capture_splat.field_episode_reference.v0.1`

## World Studio roadmap changes

Revise the public milestone sequence:

- M0 Live Evidence Foundation — retain completed.
- M1 Authenticated LAN and Progressive World — retain; generic isolated worker lifecycle.
- M2 Canonical World, Asset and Delta Graph — immutable worlds, asset instances, site deltas, transforms and reversible edits.
- M3 Indoor Navigation and First Deployment Twin - P3 — vacuum/AMR baseline plus recapture/change workflow.
- M4 Physics Asset Factory and Registry - A0-A4 — chair and unoccupied-wheelchair reference assets, passports and private registry.
- M5 Isaac/ROS Sensor and Asset Conformance - P4 — layered OpenUSD, asset variants, remote Isaac and sensor parity.
- M6 Real2Sim Promise and Matched Calibration - P5/P6 — open-loop validation, held-out system identification and promise certificates.
- M7 Predictive Eval Studio - P7 — policy ranking, failure regions, sensitivity, regression and hardware screening.
- M8 Deployment Operations and Continuous R2S2R - P8 — fleet/site registry, freshness, field episodes, delta worlds, canary and rollback.
- M9 Expanded Embodiments — UAVs, vehicles, manipulation and deformables with separate readiness gates.

Update:

- `ROADMAP.md`
- `docs/blueprints/world-compiler-v0.1/MILESTONES.md`
- `docs/blueprints/world-compiler-v0.1/ADOPTION_STATUS.md`
- `docs/blueprints/world-compiler-v0.1/PHYSICAL_ASSET_CALIBRATION.md`
- `docs/blueprints/world-compiler-v0.1/NEXT_IMPLEMENTATION_PROMPT.md`
- `docs/upstreams.md`

Add:

- `docs/blueprints/world-compiler-v0.1/REAL2SIM_PROMISE.md`
- `docs/blueprints/world-compiler-v0.1/ASSET_FACTORY_AND_REGISTRY.md`
- `docs/blueprints/world-compiler-v0.1/EVAL_STUDIO.md`
- `docs/blueprints/world-compiler-v0.1/DEPLOYMENT_TWIN.md`
- `docs/blueprints/world-compiler-v0.1/R2S2R_OPERATIONS.md`

## Real2Sim Promise requirements

Define a machine-readable and human-readable certificate bound to exact World, Asset, Robot, Sensor, Task, Simulator and Eval versions.

It must include:

- validated operating envelope;
- evidence and metric gates;
- known unknowns;
- `approved_for` and `not_approved_for`;
- freshness, expiry and revalidation triggers;
- decision: `promote|hold|reject`.

Define levels P0-P8 from evidence reconciliation through maintained deployment predictivity.

## Physics Asset Factory requirements

Define maturity levels:

- A0 Visual;
- A1 Metric;
- A2 Collision;
- A3 Rigid Physics;
- A4 Articulated/Compliant;
- A5 Task Validated;
- A6 Deployment Validated.

Every asset record includes visual, metric, collision, semantic, part/articulation, physics, validation, simulator-build and lineage layers.

Document two reference assets:

1. Upholstered chair: mass/dimensions, floor friction, push/tip, cushion stiffness/damping and held-out validation.
2. Unoccupied wheelchair: frame, rear wheels, caster forks/wheels, brakes, footrests, armrests and cushions; measure geometry, mass/COM/inertia, rolling resistance, caster response, brake force, threshold behavior and load-fixture variants.

Explicitly exclude medical certification, occupant biomechanics and human-safety claims from the initial wheelchair scope.

Use modular OpenUSD structure with preserved source data, geometries, instances, materials, physics, PhysX/MuJoCo variants, semantics, validation and asset passport.

## Eval Studio requirements

Propose contracts:

- `world_studio.eval_suite.v0.1`
- `world_studio.eval_case.v0.1`
- `world_studio.eval_run.v0.1`
- `world_studio.eval_report.v0.1`
- `world_studio.policy_artifact.v0.1`
- `world_studio.embodiment_adapter.v0.1`
- `world_studio.promotion_decision.v0.1`

Every run records exact artifacts, runtime, policy/checkpoint hash, seed and sampled variations.

Variation dimensions include initial state, objects, clutter, lighting, viewpoint, sensors, latency, physics uncertainty, robot calibration, environment revision, task difficulty and embodiment where compatible.

Metrics include task success/reason, contacts/safety, trajectory and observation residuals, policy rank correlation, improvement-direction agreement, failure-region overlap, critical failure recall, false-safe rate and regression detection.

Decision states: `reject`, `shadow`, `canary`, `promote`, `rollback`.

## Deployment Twin requirements

Propose contracts:

- `world_studio.deployment.v0.1`
- `world_studio.site_revision.v0.1`
- `world_studio.change_proposal.v0.1`
- `world_studio.field_episode.v0.1`

Separate state, structural environment, robot/sensor and task/policy changes. Create immutable World deltas and an impact graph showing affected tasks, routes, assets, promises and eval suites.

Add world freshness per site zone, scheduled sentinel routes, shadow replay, canary cohorts, rollback criteria and fail-closed handling when a deployment leaves its validated envelope.

## R2S2R loop

Document:

```text
field episode or recapture
 -> classify environment/asset/sensor/robot/task/controller/policy mismatch
 -> replay in exact twin
 -> propose world/asset/calibration/task/policy update
 -> rerun impacted + global safety evals
 -> shadow/canary
 -> promote/hold/rollback
 -> monitor and repeat
```

## UI mapping

Do not add a seventh top-level mode:

- View: world freshness and change overlays.
- Edit: objectization, parts/joints and delta review.
- Simulate: compile, physics trials, variations and eval jobs.
- Pilot: matched scripts and teleoperation.
- Sensors: apparatus, robot/sensor and clock calibration.
- Episode: real/sim pairs, eval reports, policy rankings, deployment decisions and rollback.

## Vertical-slice milestone

Document a sixteen-week reference demonstration:

- one furnished room;
- one vacuum/AMR;
- upholstered chair plus unoccupied wheelchair;
- Capture Splat baseline and recapture;
- Gaussian appearance + metric/collision world;
- Isaac/ROS compile;
- three policy/controller checkpoints;
- variations and predictive eval;
- real deployment;
- move the wheelchair/change one obstacle;
- create World v2 delta;
- rerun impacted evals;
- canary and promote or roll back.

## Write safety and evidence rules

- Do not mark planned features completed.
- Do not create runtime schemas unless code, migrations, fixtures and round-trip tests adopt them; keep design schemas in proposals.
- Do not vendor third-party models, datasets, generated captures or simulator binaries.
- Preserve all existing implemented contracts and compatibility tests.
- Do not weaken local-first capture or proposal-only live-worker authority.
- Cite public sources and distinguish observed capabilities from product proposals.
- Add validation commands and report exactly what was run.

## Deliverable

Open two small, reviewable draft PRs, one per repository. Each PR should contain roadmap/documentation/proposal-schema changes only unless a tiny test or validator is required for documentation consistency. Include a migration note and a checklist of implementation issues that should follow.
