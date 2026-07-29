# 1. Product strategy and differentiation

## 1.1 The product category

World Studio should define itself as an **evidence-backed world compiler for robotics**.

It sits between capture/reconstruction and execution/training:

```text
Capture evidence
    -> reconstruct and understand
    -> edit and version
    -> compile for a robot/runtime/task
    -> train/evaluate
    -> deploy
    -> reconcile real outcomes
```

This framing is important. A renderer produces what a viewer sees; a simulator must expose state, geometry, physics, and dynamics that agents can compute on. World Studio should preserve that distinction in both product language and code.

## 1.2 What World Studio is not

World Studio is not:

- a replacement for NVIDIA Isaac Sim, Isaac Lab, ROS 2, CARLA, AirSim, MuJoCo, or Rapier;
- a claim that Gaussian splats alone are physics-ready;
- a generic 3D editor trying to out-feature Blender, SuperSplat, or Omniverse tools;
- an opaque “video in, perfect simulator out” promise;
- a single reconstruction model whose failure invalidates the product;
- an environment generator that loses the original evidence and cannot explain how an asset was made.

## 1.3 Competitive map and the correct position

| Category / system | Public strength | World Studio should not compete on | World Studio differentiation |
|---|---|---|---|
| Phone scanning and capture apps | Convenient acquisition and visual models | Being a slightly better scanner | Authoritative robotics evidence, progressive ingest, simulation-readiness gates, task and episode loop |
| Gaussian renderers/editors such as Spark/SuperSplat workflows | Fast photoreal visualization and splat editing | General splat rendering alone | Shared world graph containing appearance, metric geometry, colliders, semantics, uncertainty, tasks, robots, and adapters |
| NVIDIA Isaac Sim | High-fidelity physics, sensors, robot assets, ROS 2, synthetic data | Rebuilding the execution engine | Automating real-world ingestion, alignment, objectization, provenance, task authoring, and OpenUSD compilation into Isaac |
| NVIDIA Isaac Lab | Large-scale policy training and evaluation | Rebuilding RL/IL infrastructure | Generating task-ready, evidence-backed environment configurations and feeding field failures back into the world |
| Dirac Robotics | Current public site emphasizes validated physics-accurate simulation assets and physical parameters for Isaac | Competing asset by asset in the first release | Full captured environments, progressive live workflow, versioned evidence, multi-runtime output, delta recapture, task-level validation |
| World Labs R2S2R | Proprietary, vertically integrated real-to-sim-to-real system with large variation generation and policy evaluation | Claiming equivalent capability immediately | Developer-owned/local-first evidence, explicit confidence and promotion gates, open contracts, editable world history, backend-neutral adapters, incremental capture updates |

### The concise positioning sentence

> **Isaac runs the simulation. Spark shows the world. CaptureSplat records the evidence. World Studio is the compiler and operating layer that keeps all three aligned.**

## 1.4 The differentiated architecture

### A. Capture integrity as a product feature

Most demos begin from a finished model. World Studio begins with a defensible evidence chain:

- accepted frame written on-device first;
- no capture gate depends on network latency;
- immutable frame identity and checksum;
- replayable upload and reconciliation;
- explicit ARKit pose, intrinsics, depth/confidence, quality metrics, and capture conditions;
- retained HEVC/full mesh/final evidence until both sides reconcile.

This enables debugging, reprocessing, audits, and future reconstruction improvements without recapturing the site.

### B. Progressive worlds rather than a binary export

A session should become useful in stages:

1. live cameras, trajectory, RGB-D points, and ARKit mesh;
2. streaming geometry/pose proposal from LingBot-Map;
3. progressive Gaussian checkpoints/renders;
4. final COLMAP + 3DGS quality ladder;
5. validated metric/collision/navigation products;
6. semantic and interactive object graph;
7. simulator-specific compiled worlds.

The user can inspect and correct the world before the longest workers finish.

### C. Multi-representation authority

World Studio must make authority explicit:

- splat: best appearance;
- TSDF/Poisson or other metric mesh: structural geometry candidate;
- simplified/segmented collision mesh: physics collision source;
- occupancy/heightfield/navmesh: mobility source;
- object assets: dynamic and articulated source;
- semantic scene graph: object identity and relationships;
- physics parameter set: mass/contact/material behavior;
- original evidence: ultimate provenance.

The representation selected depends on the task, not on which model is newest.

### D. Task-aligned compilation

A vacuum does not require cable deformation. A drone does not need floor-wheel contact. A car needs lane/drivable-surface semantics and dynamics that a room scan does not.

World Studio should compile different products from the same evidence:

```text
World + robot profile + task profile + simulator target
    -> required representations
    -> validation plan
    -> adapter output
```

This prevents “physics accurate” from becoming an undefined universal claim.

### E. Versioned delta capture

The long-term moat is not the first reconstruction; it is the world’s history:

- capture v1;
- user edits and promotions;
- robot deployment episodes;
- changed furniture or construction;
- delta recapture;
- calibrated v2;
- failure regions and policy results tied to each version.

The asset becomes reusable infrastructure instead of a one-off scene.

## 1.5 Simulation Readiness Levels

Expose readiness in the UI and API. A world should never be simply “ready/not ready.”

| Level | Meaning | Minimum evidence/gate |
|---|---|---|
| **R0 Evidence** | Reprocessable capture package exists | reconciled frames, calibration, hashes, provenance |
| **R1 Visual** | Human can inspect the scene | aligned cameras/trajectory and visual splat/mesh |
| **R2 Metric** | Measurements are usable within declared tolerance | validated scale, axes, geometry residuals, coverage |
| **R3 Navigable** | Static mobile robot/drone navigation can be evaluated | collision/free-space product, spawn clearance, route tests |
| **R4 Sensor-aligned** | Simulated observations approximate the target sensor stack | calibrated cameras/depth/LiDAR/IMU model and comparison report |
| **R5 Rigid-interactive** | Selected rigid objects can move and contact | objectization, mass/contact ranges, matched interaction tests |
| **R6 Articulated** | Doors, drawers, joints, robot interaction work | joint topology, limits, drives, collision pairs, open-loop validation |
| **R7 Deformable/contact-rich** | Cables, cloth, soft materials are task-relevant | specialized representation and matched dynamics evidence |
| **R8 Predictive R2S2R** | Simulation supports deployment decisions | policy ranking/failure-region correlation with real trials |

The first commercial milestone should be reliable **R3–R4 for indoor mobile robots**, not a premature R8 claim.

## 1.6 First users and jobs to be done

Target users:

- robotics teams deploying AMRs, service robots, and vacuums in customer sites;
- robot developers who have Isaac/ROS expertise but lack fast site digitization;
- simulation engineers who spend days cleaning, aligning, and authoring environments;
- policy teams that need repeatable evaluation worlds rather than only synthetic generic scenes.

Primary jobs:

- “Turn this real site into a navigable simulation without manual CAD reconstruction.”
- “Show me where the generated world is trustworthy and where it is inferred.”
- “Move a wall, add a hazard, replace an object, or define a task without destroying provenance.”
- “Run the same world with multiple robots/sensor stacks.”
- “Find which policy checkpoint should go to hardware.”
- “Update the world after the site changes rather than rebuilding it.”

## 1.7 Product moats that compound

1. **Evidence corpus:** capture quality signals, reconstruction residuals, and task outcomes.
2. **World-to-task compiler:** rules mapping robot/task needs to representations and gates.
3. **Calibration data:** real/sim residuals for sensors, contacts, mobility, and failures.
4. **Version graph:** site changes and reusable worlds over time.
5. **Adapter conformance:** reliable exports into multiple simulation runtimes.
6. **Human corrections:** edits and promotion decisions that improve future automation.
7. **Evaluation correlation:** proof that simulated comparisons predict hardware decisions.

## 1.8 Anti-goals for the initial release

- fully automatic general object articulation;
- deformable cable or cloth simulation;
- autonomous driving public-road fidelity;
- outdoor city-scale streaming and weather realism;
- guaranteed mass/friction inference from video alone;
- replacing a customer’s policy stack;
- embedding/redistributing Isaac Sim inside the product without a licensing plan;
- treating research-only i3dgs code as a shipped dependency.
