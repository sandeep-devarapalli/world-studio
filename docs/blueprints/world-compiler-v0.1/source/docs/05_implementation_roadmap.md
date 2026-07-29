# 5. Implementation roadmap

## Guiding rule

Build one vertical slice through capture, compilation, simulation, and feedback before broadening the reconstruction model set or robot domains.

## Phase 0 — Freeze contracts and reproduce upstreams

### Deliverables

- pin tested commits/checkpoints for LingBot-Map and i3dgs research worker;
- reproduce official datasets on the target GPU and log latency, VRAM, registration, loop behavior, and outputs;
- freeze `capture_splat.live_session.v0.1`;
- freeze `world_studio.world.v0.1`;
- freeze `isaac_job.v0.1`;
- define canonical units/frame graph;
- create license inventory and enforcement flags.

### Acceptance gate

- all schemas validate;
- fixture packages round-trip without information loss;
- every dependency has commit, license, model terms, and redistribution status;
- i3dgs cannot be selected by a production build configuration.

## Phase 1 — Replay-first receiver

### Deliverables

- replay an existing capture with controllable delay;
- inject out-of-order frames, duplicates, corruption, disconnects, and resume;
- receiver session ledger;
- strict JSON and relative-path validation;
- SHA-256 and byte-length verification;
- ACK/retry/resume/reconciliation state machine;
- source/evidence UI.

### Acceptance gate

- deterministic replay produces one reconciled evidence manifest;
- network failure cannot alter which frames were accepted by capture;
- duplicate delivery does not duplicate logical evidence;
- corrupted payloads are rejected with reason codes.

## Phase 2 — Progressive world UI

### Deliverables

- ARKit camera frustums and trajectory;
- RGB-D point preview;
- ARKit/RoomPlan mesh overlay;
- accepted/rejected counts and quality metrics;
- thermal/network state;
- LingBot adapter on official data, then ordered replay;
- gated Sim(3) comparison against ARKit/COLMAP;
- immutable progressive checkpoints.

### Acceptance gate

- preview remains usable while workers fail/restart;
- all proposals are visibly labeled by source and confidence;
- a worker cannot overwrite ARKit/COLMAP authority.

## Phase 3 — Canonical World Package and editor

### Deliverables

- content-addressed artifact registry;
- frame/transform graph;
- non-destructive edit operations: transform, crop, filter, merge, hide, replace, segment;
- splat-transform worker pinned for PLY/SPZ/SOG/conversion/LOD;
- canonical PLY preservation and sidecars;
- metric geometry and collision proposal pipeline;
- semantic QA/annotation proposals;
- simulation readiness UI;
- local Spark + Three.js + Rapier inspection mode.

### Acceptance gate

- undo/redo and version checkout reproduce byte-identical referenced assets;
- visual and collision layers remain aligned after edits;
- promotion decisions are audit logged;
- package passes schema and path/hash validation.

## Phase 4 — Isaac static indoor adapter

### Deliverables

- supported remote Linux RTX worker;
- Isaac Sim 6.0.1 image/package lock;
- compile PLY to NuRec USDZ where supported, with fallback;
- import static collision GLB/USD;
- generate layered `world.usda`;
- World Studio Isaac extension/importer;
- automated transform/alignment checks;
- add one mobile robot (for example, a supported TurtleBot/Nova Carter style profile);
- spawn, gravity, collision, and reference-render smoke tests;
- WebRTC link from Mac UI.

### Acceptance gate

- one command/job compiles a promoted world and opens it in Isaac;
- no manual `-90°` correction is required;
- visual/collider alignment report passes;
- robot does not fall through or spawn intersecting geometry;
- NuRec failure falls back cleanly without invalidating collision simulation.

## Phase 5 — ROS 2 and sensor parity

### Deliverables

- ROS 2 Jazzy default, Humble compatibility test;
- `/clock`, TF, odometry, command/control;
- camera, depth, LiDAR/raycast, and IMU profiles;
- Nav2/controller integration;
- sensor noise/latency/dropout configuration;
- rosbag2/episode recording and manifest linkage;
- matched scripted route in sim and reality.

### Acceptance gate

- the same robot-facing interface can run against sim and hardware;
- frames, topic names, QoS, and timestamps pass conformance tests;
- route-level sensor and odometry residual report is produced.

## Phase 6 — Isaac Lab evaluation and variants

### Deliverables

- adapter generation for selected Isaac Lab version;
- environment cloning and deterministic seeds;
- ID/OOD variant matrices;
- appearance, clutter, sensor, and calibrated physics randomization;
- policy/checkpoint runner;
- failure-region and ranking analysis;
- CI smoke rollouts and regression reports.

### Acceptance gate

- every rollout is reproducible from world version, job, seed, policy hash, and sampled parameters;
- two or more policy/checkpoint candidates can be ranked in sim and compared with a real test set;
- results identify where the world is not yet predictive.

## Phase 7 — Close the field loop

### Deliverables

- real episode package and importer;
- clock/pose alignment;
- real-vs-sim replay comparison;
- residual classification;
- parameter calibration proposals;
- delta capture and changed-region detection;
- new world version and automatic regression run.

### Acceptance gate

- one physical deployment produces a traceable new world version;
- old world and episode remain reproducible;
- promoted corrections improve at least one predefined alignment metric without unacceptable regression elsewhere.

## Phase 8 — Expand by domain

Order:

1. multi-room indoor AMR/vacuum;
2. indoor UAV;
3. outdoor UAV;
4. private-site vehicle/car;
5. rigid and articulated manipulation;
6. deformable/contact-rich tasks.

Each domain gets its own robot/task requirements, representations, and readiness gates. Do not reuse the mobile-navigation readiness score unchanged.

## Parallel evidence-dependent track

Continue without blocking transport work:

- controlled RoomPlan capture;
- physical AprilTag/known-distance validation;
- real 360-degree capture;
- sensor-supervision GPU A/B;
- SPZ/SOG viewer conformance;
- collision/measurement promotion experiments;
- TestFlight workflow;
- optional VGGT/splat-to-mesh/LOD;
- NOVA3R amodal geometry prior experiments;
- VLM semantic QA.

Features remain labelled experimental until their physical gates pass.

## First end-to-end demonstration

### Scenario

A robot vacuum must start at a charging dock, clean two user-drawn zones, avoid a fragile floor area and a moved chair, then return to dock.

### Demo flow

1. Record the room on iPhone while the Mac receives accepted keyframes.
2. Disconnect Wi-Fi briefly; capture continues; upload resumes.
3. Show trajectory, RGB-D points, mesh, and progressive splat.
4. Finish capture; global reconstruction improves the scene.
5. Editor displays coverage, uncertain geometry, collider, and free space separately.
6. User draws clean zones/no-go zone and selects robot profile.
7. World Studio compiles the world into Isaac.
8. Isaac runs a reference route through ROS 2/Nav2 and streams to the Mac.
9. Run variations in clutter, light, sensor noise, floor friction, and initial pose.
10. Deploy the same task interface to the real robot.
11. Ingest the real episode; show residuals and proposed world v2.

### Demo success criteria

- no capture loss caused by network interruption;
- visual and collider alignment is explicit and measured;
- task can be edited without destroying source evidence;
- same robot interface works in sim and real;
- one real failure maps to a visible simulated failure gap or world correction;
- world v1 and v2 remain reproducible.

## Engineering workstreams

### Core contracts

- JSON Schema and version negotiation;
- artifact and hash model;
- transform graph;
- world version graph;
- reason-code taxonomy.

### Capture transport

- Bonjour/QR/short-code pairing;
- bounded store-and-forward;
- TLS/authentication;
- resume/reconciliation;
- replay/fault injection.

### Reconstruction

- worker protocol;
- LingBot/i3dgs/final pipeline adapters;
- checkpointing and resource scheduling;
- provenance and comparison metrics.

### Editor/runtime

- scene graph and edit graph;
- Spark 2.1.0 integration retained until deliberately upgraded;
- Three.js meshes/overlays;
- Rapier proxy physics;
- validation/uncertainty visualization.

### World compiler

- package builder;
- representation promotion;
- semantic/objectization workflow;
- robot/task requirements resolver;
- adapter interfaces.

### Isaac

- worker image and capability endpoint;
- OpenUSD layer compiler;
- extension/importer;
- ROS 2 graph builder;
- task/episode runner;
- Isaac Lab generator;
- WebRTC integration.

### Validation and CI

- golden capture fixtures;
- transform round-trips;
- source-camera render comparisons;
- collision and clearance tests;
- ROS 2 conformance;
- fixed-seed episode regressions;
- real/sim metric dashboards.
