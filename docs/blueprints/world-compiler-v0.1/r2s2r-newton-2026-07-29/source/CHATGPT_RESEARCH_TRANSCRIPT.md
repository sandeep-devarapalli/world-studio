# Saved ChatGPT Research Conversation

This public-safe transcript preserves the six user and final-assistant message bodies from the supplied saved page. Hidden analysis and tool traces, browser UI telemetry, dead generated-download controls, and private conversation links are excluded. The original page hash is recorded in the source manifest.

## Turn 1 - User

<div>

I'm building World Studio on Capture Splat for something like this below. Especially, World Studio will be used to mimic the real world, be able to modify it digitally, and then help robots train, cars move, vacuum trainers or robots move on the floor, or drones fly indoors, outdoors, etc. Give me a structured thought process plan on how I should go about building this: - How I am building this and keeping it differentiated from what is already existing - How the integration with Nvidia ISAAC simulator has to be done and why it has to be done so that other things can be possible From the below resources, please give me all these. Because you can do additional research on the web as well. Give me all of this. I will basically share it with the Codex so that it can pick it up from there. some details about world studio and Capture Splat:

    mermaid
    flowchart LR
        A["Capture Splat iPhone<br/>authoritative recording"] --> B["World Studio Receiver<br/>MacBook"]
        B --> C["Immediate ARKit/RGB-D preview"]
        B --> D["LingBot geometry worker"]
        B --> E["i3dgs research worker"]
        B --> F["Final COLMAP + 3DGS pipeline"]
        C --> G["Progressive World Studio session"]
        D --> G
        E --> G
        F --> G
        G --> H["Editor"]
        G --> I["Simulation"]

Architecture Decisions The iPhone always writes accepted frames locally first. Networking must never delay recording. World Studio’s Electron process receives completed accepted keyframes over LAN using pairing, checksums, acknowledgements, retries, and resume. Stream RGB, pose, intrinsics, quality metrics, and optional compressed depth/confidence/masks. Keep continuous HEVC, full mesh, and final capture evidence on the phone until reconciliation. MacBook runs the receiver and UI. CUDA reconstruction runs through a local Linux/NVIDIA or remote Jarvis/RunPod worker. “Immediate” has three levels:ARKit cameras, RGB-D points, mesh, and trajectory within about a second. LingBot streaming geometry and pose proposal. Progressive Gaussian renders/checkpoints, followed after capture by the existing global COLMAP and 3DGS quality ladder. Upstream Decisions i3dgs: Excellent research comparator for unordered immediate 3DGS, including retrieval, covisibility, loop closure, and hierarchy. However, the released program reads a fixed image directory rather than exposing a live phone-ingest API. More importantly, its patent-pending license is research/noncommercial only. Keep it as an isolated NVIDIA research worker unless a commercial agreement is obtained. Project, repository, license. LingBot-Map: Best first live-preview experiment. It produces streaming pose, depth, confidence, and ordinary point-cloud geometry, not Gaussians. The code is Apache-2.0, but checkpoint redistribution should remain held until clarified. Repository, model page. SuperSplat: Use as an editor UX/reference or initially as an external advanced editor. It is a complete application, not a reusable editing component. SuperSplat. splat-transform: Adopt as a pinned worker for non-destructive transform, filtering, merging, conversion, SPZ/SOG, LOD preparation, and collision proposals. Preserve canonical PLYs, hashes, sidecars, and undoable edit history. Repository. supersplat-viewer: Add later as an optional large-scene/Streamed-SOG publishing and conformance viewer. Do not replace the integrated simulation renderer with it. Viewer. Spark: Keep Spark + Three.js + Rapier in Simulate because they share cameras, overlays, semantic assets, physics, and controls. One correction: World Studio currently pins Spark 2.1.0, not 3.1, in `packages/renderer/package.json` and `apps/web/package.json`. Updated Roadmap Upstream reproduction: Pin i3dgs and LingBot commits/checkpoints. Reproduce their official datasets on A100 and record latency, VRAM, registration, loop behavior, and outputs. Live transport contract: Add capture_splat.live_session.v0.1, pairing, frame manifests, SHA-256, sequence IDs, ACK/retry/resume, strict JSON, and safe relative paths. Replay-first receiver: Replay an existing capture into World Studio with simulated delays, out-of-order frames, duplicates, disconnects, and resume. This does not require connecting the iPhone. Live evidence UI: Show incoming source frames, accepted/rejected counts, ARKit cameras, trajectory, depth points, mesh progress, thermal/network state, and finalization. LingBot adapter: Run official data, then ordered Capture Splat replay. Align its trajectory to ARKit/COLMAP with gated Sim(3) residuals and proposal-only authority. Immediate Gaussian research: Run i3dgs on chronological and shuffled datasets. Receive remote renders and immutable checkpoints, but keep the backend outside shipped products. iPhone sender: Add a bounded store-and-forward upload queue after successful local frame writes. Pair through Bonjour plus QR/short code; network failure must never change capture gates. Editor and delivery: Build a provenance-backed edit graph for multiple splats, transforms, crop/filter/merge, conversion, SPZ/SOG, and optional Streamed-SOG viewer validation. Unified simulation: World Studio owns scene/frame graphs, units, robot profiles, sensors, tasks, clocks, authority, and episode replay. Rapier remains the local preview backend; AirSim and Isaac Sim/Lab become external adapters rather than embedded dependencies. AirSim, Isaac Sim, Isaac Lab. Domain rollout: Indoor floor robots first, indoor UAVs second, autonomous cars/outdoor UAVs third, articulated task robots last. Gaussian appearance never becomes collision or measurement authority automatically. Annotation 1 The existing evidence-dependent items remain a parallel release track: controlled RoomPlan capture, physical AprilTag validation, real 360 capture, sensor-supervision GPU A/B, SPZ viewer testing, collision/measurement promotion, TestFlight, and optional VGGT/splat-to-mesh/LOD work. They should not block transport development, but their features cannot be promoted without those physical gates. now on what i am seeing and wanting to do: Simulation in robotics has always been hard. Creating it, running it, evaluating on it, all of it. That is a big part of why robotics has never had its GPT moment. Language models got theirs when the internet became training data. Robotics has no internet. It has the physical world, and until now there was no way to bring the physical world inside a computer fast enough or accurately enough to learn from it. That changes today. We are launching Dirac Robotics. 1. Shoot a video of the place your robot works. 2. Say what you want it to do there. 3. Get a physics accurate simulation, ready to train and evaluate on. 4. Then the loop closes. Every deployment feeds back in, every policy is tested against the world it will actually run in, and the simulation improves without anyone rebuilding it. https://diracrobotics.com/ When SceniX joined World Labs, we said spatial intelligence was never only about perceiving and generating virtual and physical worlds, but also interacting with them. Today, we’re sharing early results from that vision: building worlds that train robots. 🌎🤖 In our functional taxonomy of world models, we called the simulator the linchpin: the piece that turns a world into a place where agents can act, learn, and be evaluated. With the help of generative world models, our real-to-sim-to-real (R2S2R) engine turns a single physical task into thousands of controllable, reusable worlds, helping robotics teams train policy models and test changes faster, uncover failures earlier, and reduce costly experimentation on hardware. Using our proprietary technology, our model generates simulations aligned with reality that allow robots to do what has long been considered out of reach: learn complex manipulation tasks with zero real-world training data; predict and evaluate through simulation which robotic policies will succeed or fail in the real world, without extensive and expensive physical trial and error; and then operate reliably for hours on physical robots in real-world settings Our engine is policy- and embodiment-agnostic, allowing us to serve customers with different robots, sensors, policy stacks, and deployment needs. The result is faster iteration, broader coverage, and substantially lower cost. Reliable robots in warehouses, laboratories, and homes will emerge when scalable world models meet real robotic systems. That is the work ahead for World Labs. https://www.worldlabs.ai/blog/real-to-sim-to-real Web search

</div>

## Turn 2 - Assistant

# Capture Splat and World Studio roadmaps updated

I reviewed LingBot-Map, Immediate3DGS, and FastGS and prepared coordinated roadmap changes for both repositories.

Download the complete Capture Splat + World Studio roadmap bundle

Key files:

- immediate_reconstruction_program.md

- ROADMAP.md

- PROGRESSIVE_RECONSTRUCTION.md

- MILESTONES.md

- CODEX_IMPLEMENTATION_PROMPT.md

- Capture Splat Git patch

- World Studio Git patch

- VALIDATION_REPORT.txt

------------------------------------------------------------------------

# 1. The most important architectural decision

Do not combine LingBot-Map, i3dgs, and FastGS into one opaque reconstruction dependency.

They solve three different problems:

    LingBot-Map
        Immediate pose, depth, confidence and point-cloud geometry

    Immediate3DGS
        Immediate Gaussian appearance, unordered images,
        loop closure and progressive hierarchy

    FastGS
        Faster final Gaussian optimization,
        controlled densification and pruning

Capture Splat and World Studio should combine their **capabilities**, but keep their implementation, licensing, authority, and lifecycle boundaries separate.

The final architecture should be:

    Capture Splat iPhone evidence
        RGB + video + ARKit pose + intrinsics
        LiDAR depth/confidence + IMU + mesh + masks
                           │
                           ▼
    Tier A — Immediate sensor preview
        ARKit cameras, RGB-D points, mesh and trajectory
                           │
                           ▼
    Tier B1 — Streaming geometry proposal
        LingBot comparator
        Production-owned sensor-fused mapper
                           │
                           ▼
    Tier B2 — Progressive Gaussian proposal
        Coarse Gaussian checkpoints
        Spatial submaps
        Loop-correction revisions
                           │
                           ▼
    Tier C — Final global reconstruction
        COLMAP/HLOC
        Metric RGB-D fusion
        Fast density-controlled 3DGS
        Final PLY/SPZ/SOG
                           │
                           ▼
    World Studio
        immutable world graph
        editing and semantics
        collision/navigation promotion
        Rapier and Isaac adapters

The existing dual-representation rule remains correct:

    Gaussian splat
        appearance and visual sensor rendering

    Point cloud
        registration, mapping, coverage and QA

    TSDF / ESDF / mesh / primitives
        collision, navigation, raycasts and measurements

    PhysX / Rapier / Isaac
        contacts, dynamics, sensors and robot evaluation

That is consistent with the earlier Capture Splat architecture: TSDF/Poisson or equivalent geometry remains the solid simulation layer, while SPZ/3DGS remains the photorealistic visual layer. [](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=ce5557db-a937-4cbe-936d-36848e1e5604&conversation_save=1)

[SPZ visual pipeline integration](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=ce5557db-a937-4cbe-936d-36848e1e5604&conversation_save=1)

Spark and Three.js continue to be the unified browser visual scene graph, while Rapier and PhysX provide actual physics. [](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=570c0ef6-78ba-403d-963b-3672b6123ba5&conversation_save=1)

Bundle v3 Physics Clarification

------------------------------------------------------------------------

# 2. LingBot-Map: what to incorporate

LingBot-Map is the best immediate experiment for the **streaming geometry layer**.

The upstream project describes a Geometric Context Transformer that combines coordinate grounding, dense geometric cues, anchor context, a pose-reference window, and trajectory memory. It reports approximately 20 FPS at 518×378 resolution and long-sequence operation beyond 10,000 frames.

GitHub

Its output structure is especially useful. The released code produces:

- camera-pose encodings;

- depth;

- depth confidence;

- world points;

- world-point confidence;

- camera extrinsics;

- camera intrinsics;

- chunk transforms and scales.

However, the released program takes a video or image folder and finishes by launching a Viser point-cloud viewer. It does not expose a Capture Splat live-ingest protocol or a typed World Studio worker API.

## How to use it initially

Build a completely isolated adapter:

    Capture Splat replay package
        ↓
    LingBot external worker
        ↓
    normalized proposal revisions:
        camera_proposal
        depth_proposal
        confidence_proposal
        point_chunk
        loop_or_drift_event
        worker_health

Every output should record:

    JSON{
      "worker": "lingbot-map",
      "repository_commit": "...",
      "checkpoint_sha256": "...",
      "source_session_id": "...",
      "source_frame_ids": ["..."],
      "coordinate_frame": "lingbot_world",
      "units": "unknown_until_aligned",
      "authority": "proposal",
      "supersedes": null
    }

Then align LingBot’s proposed trajectory to ARKit or COLMAP using shared frame IDs and a gated `Sim(3)` fit. The report should include:

- fitted scale;

- rotation and translation;

- inlier count;

- median and p95 camera-center residual;

- temporal drift;

- accepted, held, or rejected decision.

A failed alignment must leave the data in `lingbot_world`. It must not be silently stretched into the metric World frame.

## How Capture Splat can outperform it

For a LiDAR iPhone, Capture Splat has information that LingBot normally has to infer:

- metric ARKit VIO;

- gravity and IMU;

- calibrated intrinsics;

- LiDAR depth and confidence;

- ARKit mesh and planes;

- RoomPlan;

- exposure, focus, tracking and thermal events;

- accepted-frame blur, parallax, overlap and coverage;

- person and transient masks.

The production-owned mapper should therefore not start by replacing ARKit with a large RGB-only model. It should start with:

    ARKit VIO + RGB-D + confidence + IMU + mesh
        → deterministic streaming metric map

Then add learned components for:

- depth completion;

- pose correction;

- fallback pose estimation on non-LiDAR devices;

- drift prediction;

- loop descriptors;

- dynamic-region rejection;

- geometry confidence.

LingBot supports streaming and windowed operation, but its upstream documentation notes that its learned range is finite and that long sequences may require state resetting or windowed inference if pose collapse occurs.

GitHub+1 The owned system should make resets, submaps and loop corrections explicit World revisions rather than hidden model state.

## Licensing

LingBot-Map code is Apache-2.0. However, the Hugging Face model card showed incomplete structured YAML metadata when reviewed, so the exact checkpoint rights and redistribution decision should be recorded separately before packaging a checkpoint with the product.

Hugging Face

------------------------------------------------------------------------

# 3. Immediate3DGS: what to learn and what not to embed

Immediate3DGS is the right reference for the **progressive Gaussian and global-consistency layer**.

Its public description identifies four especially useful capabilities:

1.  immediate visual reconstruction feedback;

2.  unordered image ingestion;

3.  place-recognition-driven matching and loop correction;

4.  progressive Gaussian hierarchy for large scenes.
    GitHub

But the released application reads a fixed image directory. Its network viewer streams rendered images from the host; it is not a live phone-ingest API.

GitHub

## What World Studio should reproduce independently

The product-owned system should aim for equivalent observable behavior:

    Incoming accepted frame
        ↓
    image descriptor and retrieval candidates
        ↓
    recent-frame + retrieved-frame matching
        ↓
    geometric verification
        ↓
    camera/submap proposal
        ↓
    local Gaussian optimization
        ↓
    immutable progressive checkpoint
        ↓
    loop detection
        ↓
    new graph correction revision
        ↓
    selective submap re-optimization

The World graph should retain:

    checkpoint_001
    checkpoint_002 supersedes checkpoint_001
    loop_constraint_003
    transform_revision_004 supersedes transform_revision_002
    checkpoint_005 derived_from transform_revision_004

A loop closure must not rewrite earlier camera or Gaussian files in place.

## Ordered Capture Splat should come first

Unlike i3dgs, Capture Splat normally has chronological frames, timestamps, ARKit poses and optional depth. Therefore the first product implementation should be simpler and more reliable:

1.  initialize Gaussians from metric RGB-D or mesh points;

2.  derive covariance from depth uncertainty and local surface normals;

3.  attach source-frame provenance;

4.  optimize only a bounded recent window;

5.  freeze stable spatial submaps;

6.  publish coarse-to-fine checkpoints;

7.  update submap transforms when a verified loop arrives;

8.  run the final global COLMAP/3DGS pipeline after capture.

Unordered-folder support can be added later for imported videos, image sets and non-Capture Splat sources.

## Licensing and patent boundary

Immediate3DGS is patent-pending and licensed only for non-commercial research or evaluation. Its license explicitly prohibits commercial use without authorization.

GitHub

Therefore:

- keep the upstream repository in an isolated research environment;

- never vendor it into either Apache repository;

- never make it a production-selectable backend without an agreement;

- benchmark its externally observable results;

- define independent product requirements and acceptance tests;

- have legal review before implementing potentially patent-relevant behavior.

A clean-room implementation can address source-code copyright contamination, but it does **not** by itself resolve patent exposure.

------------------------------------------------------------------------

# 4. FastGS: how to use it properly

FastGS is relevant to the **final optimization speed and Gaussian-count problem**.

Its central method uses multi-view consistency to decide where Gaussian density is needed and where Gaussians are redundant. The paper reports approximately 100-second training and 2–7× acceleration across the evaluated task families while maintaining comparable quality.

CVPR Open Access+1

Its product relevance is not simply “run FastGS after every capture.” The useful ideas are:

    Multi-view residual accumulation
        ↓
    identify consistently under-reconstructed regions
        ↓
    densify only supported regions

    Multi-view contribution analysis
        ↓
    identify unsupported or redundant Gaussians
        ↓
    prune them early

    Tighter Gaussian support
        ↓
    reduce unnecessary raster work

## Capture Splat can extend this with sensor evidence

A production-owned strategy should combine visual residuals with:

- iPhone depth residual;

- normal residual;

- depth confidence;

- ARKit surface class;

- source-view diversity;

- transient/person masks;

- reflective/glass warnings;

- spatial coverage;

- Gaussian provenance;

- weak-frame quality;

- local duplication and outlier statistics.

For example:

    Densify only when:
        persistent visual residual
        + multiple trustworthy views
        + valid geometry support
        + static-region probability
        + sufficient source coverage

    Prune when:
        low multi-view contribution
        OR unsupported by valid observations
        OR transient/dynamic
        OR duplicated
        OR low-confidence depth region
        OR harmful to held-out views

This gives Capture Splat a plausible route to outperform a visual-only acceleration method on iPhone rooms, especially in metric alignment and weak-region control. It remains a hypothesis until benchmarked.

## Do not copy the published “100 seconds” as a product promise

FastGS is CUDA-oriented and its repository recommends a 24 GB GPU for paper-quality results. Its inputs are calibrated COLMAP or synthetic datasets. The 100-second figure is therefore a benchmark result, not a general guarantee for every room, phone capture, GPU or quality setting.

## Licensing

FastGS has an MIT top-level license.

GitHub But the repository also preserves the original 3DGS non-commercial license, which restricts commercial use, and its README instructs users to respect licenses of incorporated projects.

The safe roadmap is:

    FastGS itself
        isolated comparator pending file/submodule audit

    Production implementation
        independently designed strategy
        built against an approved backend such as gsplat
        with file-level provenance and legal review

------------------------------------------------------------------------

# 5. Updated Capture Splat milestones

The Capture Splat roadmap now adds an `IR0–IR6` program without discarding its current capture, replay and final reconstruction work. The existing repository already treats live transport as proposal-only and retains COLMAP/VkSplat/gsplat as the final reconstruction ladder.

<div>

<div>

| Milestone | Deliverable | Acceptance gate |
|----|----|----|
| **IR0: Reproducible baselines** | Pin LingBot, i3dgs, FastGS, VkSplat and gsplat commits, checkpoints, environments and datasets | No quoted parity until a run is locally reproduced or explicitly marked as an upstream claim |
| **IR1: Generic worker envelope** | Job, capability, event, immutable revision and benchmark contracts | Worker crash/restart cannot affect capture evidence or the loaded World |
| **IR2: LingBot adapter** | Pose, depth, confidence and point chunks plus ARKit/COLMAP alignment | Deterministic replay and proposal-only output |
| **IR3: Owned streaming map** | Sensor-fused deterministic map, then learned pose/depth correction | Meets a predeclared parity vector on one product domain |
| **IR4: Progressive Gaussians** | Sensor-backed Gaussian seed, local optimization, submaps and loop revisions | First checkpoint is reproducible and final COLMAP/3DGS still supersedes it |
| **IR5: Fast density control** | Multi-view residual, visibility, depth/confidence and mask-aware densification/pruning | Retains held-out quality and does not regress weak-frame tails |
| **IR6: Product selection** | Backend policy by device, hardware, license and capture type | Fail-closed fallback, rollback and scoped public claims |

<div>

<div>

</div>

</div>

</div>

</div>

The Capture Splat patch changes three files:

    ROADMAP.md
    THIRD_PARTY.md
    docs/immediate_reconstruction_program.md

------------------------------------------------------------------------

# 6. Updated World Studio milestones

World Studio already defines itself as the evidence-backed compiler between Capture Splat and task-scoped simulation and already separates Gaussian, point, mesh and simulation roles. [](https://github.com/sandeep-devarapalli/capture-splat)

[sandeep-devarapalli/capture-spl…](https://github.com/sandeep-devarapalli/capture-splat)

Its current M0–M7 roadmap remains intact.

The update adds a cross-cutting `P0–P5` program:

<div>

<div>

| Track | World Studio responsibility |
|----|----|
| **P0: Comparator lab** | Store normalized, reproducible results and license decisions |
| **P1: Worker and proposal graph** | Generic worker supervisor, immutable revisions, `supersedes` relationships and failure isolation |
| **P2: Streaming geometry** | LingBot adapter plus owned sensor-fused mapper |
| **P3: Progressive Gaussian world** | Point chunks, Gaussian chunks, loop-correction revisions and Spark rendering |
| **P4: Fast final reconstruction** | Consume accelerated final outputs and compare them against controlled baselines |
| **P5: Parity and product selection** | Select backends using quality, latency, memory, provenance, license and simulation readiness |

<div>

<div>

</div>

</div>

</div>

</div>

## New worker contract

The roadmap proposes:

    world_studio.worker_capabilities.v0.1
    world_studio.reconstruction_job.v0.1
    world_studio.reconstruction_revision.v0.1
    world_studio.reconstruction_event.v0.1
    world_studio.reconstruction_benchmark.v0.1

Supported immutable revision types include:

    camera_proposal
    depth_proposal
    confidence_proposal
    point_chunk
    loop_candidate
    loop_correction
    transform_revision
    gaussian_checkpoint
    compaction_checkpoint
    final_candidate

## New proposal graph

    CaptureSession
        ├── SourceFrame
        ├── SensorObservation
        ├── WorkerJob
        │     ├── CameraProposal
        │     ├── DepthProposal
        │     ├── PointChunkProposal
        │     ├── LoopConstraintProposal
        │     └── GaussianCheckpointProposal
        ├── FinalReconstructionCandidate
        ├── MetricGeometry
        ├── CollisionArtifact
        ├── NavigationArtifact
        └── PhysicsArtifact

Only explicit promotion can turn a candidate into a metric, collision, navigation or physics artifact.

The World Studio patch changes six files:

    ROADMAP.md
    docs/upstreams.md
    docs/blueprints/world-compiler-v0.1/MILESTONES.md
    docs/blueprints/world-compiler-v0.1/ADOPTION_STATUS.md
    docs/blueprints/world-compiler-v0.1/NEXT_IMPLEMENTATION_PROMPT.md
    docs/blueprints/world-compiler-v0.1/PROGRESSIVE_RECONSTRUCTION.md

------------------------------------------------------------------------

# 7. What “on par or better” must mean

Do not compare the systems using one screenshot.

## Streaming geometry metrics

<div>

<div>

| Category | Metrics |
|----|----|
| Responsiveness | Time to first camera, depth and point chunk; p50/p95 latency; FPS |
| Resources | GPU, VRAM, RAM, cache growth and disk |
| Pose | ATE, RPE, scale drift and post-loop residual |
| Depth | AbsRel, RMSE and confidence calibration |
| Geometry | Accuracy, completeness, F-score or Chamfer distance |
| Long sequences | Loop precision/recall, correction latency, reset behavior and recovery |
| Reliability | Duplicate, dropped, out-of-order, disconnect, restart and deterministic revision tests |

<div>

<div>

</div>

</div>

</div>

</div>

## Progressive/final Gaussian metrics

<div>

<div>

| Category | Metrics |
|----|----|
| Responsiveness | Time to first checkpoint and each quality rung |
| Quality | Held-out PSNR, SSIM, LPIPS, edge/detail preservation |
| Weak-tail quality | Worst frames, floaters, fog, blur and unsupported regions |
| Efficiency | Wall time, peak VRAM, Gaussian-count curve and raster work |
| Delivery | PLY/SPZ size, round-trip error and Spark conformance |
| Consistency | Before/after loop correction and source-camera alignment |

<div>

<div>

</div>

</div>

</div>

</div>

## Simulation metrics

<div>

<div>

| Category | Metrics |
|----|----|
| Registration | Gaussian/point/mesh/collision alignment residual |
| Structure | Floor, walls, openings, free space and unknown-space rate |
| Sensors | Camera, depth, LiDAR and IMU alignment |
| Task relevance | Route, contact and outcome residuals |
| Real-to-sim value | Policy ranking and matching failure regions |

<div>

<div>

</div>

</div>

</div>

</div>

World Labs’ more meaningful success criterion is not perfect equality in average success rate; it is whether simulation supports the same decisions as reality—finding failures, ranking policies and predicting whether improvements transfer. Pasted text

That should also be World Studio’s ultimate standard.

------------------------------------------------------------------------

# 8. Other existing research remains correctly positioned

NOVA3R should continue to be treated as an amodal geometry prior rather than a direct collider generator. [](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=7270a03d-f73a-44b7-a0c7-2bb730ed9e98&conversation_save=1)

[Created note and bundle](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=7270a03d-f73a-44b7-a0c7-2bb730ed9e98&conversation_save=1)

MLX-VLM should continue to operate as the semantic grounding, annotation and reconstruction-QA layer rather than replacing depth fusion or collision generation. [](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a2062ec-2b40-8322-b393-1d26c4da1155?messageId=d07773e1-29eb-484c-b30f-1a08dd64d649&conversation_save=1)

[Add mlx vlm semantic layer](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a2062ec-2b40-8322-b393-1d26c4da1155?messageId=d07773e1-29eb-484c-b30f-1a08dd64d649&conversation_save=1)

This produces the complete stack:

    Immediate geometry
        ARKit + RGB-D + LingBot-like owned mapper

    Immediate appearance
        progressive Gaussian checkpoints

    Final reconstruction
        COLMAP + fast controlled 3DGS + metric fusion

    Amodal completion
        NOVA3R-like proposal

    Semantic understanding
        MLX-VLM grounding and QA

    Visual runtime
        Spark + Three.js

    Local physics
        Rapier

    High-fidelity simulation
        Isaac Sim / Isaac Lab

    Real-world validation
        matched robot episodes and policy evaluation

------------------------------------------------------------------------

# GitHub publication status

I found and read both repositories and prepared the changes against these observed `main` commits:

    capture-splat
    1c3da3abdcd8f26992c54858e3a9878196f236cc

    world-studio
    91adb7674f6d0c1439140c3696a1134e1ab7068a

I attempted to create `agent/progressive-reconstruction-roadmap` in both repositories. GitHub rejected both branch-creation calls with:

    403 Resource not accessible by integration

Therefore, no repository, branch or pull request was modified. Both patches passed `git diff --check` and `git apply --check` against the fetched baseline snapshots. Full repository test suites were not run because the complete repositories could not be cloned into the execution container.

The patches are ready to apply as two draft pull requests once the GitHub integration has repository contents write access.

## Turn 3 - User

<div>

https://diracrobotics.com/real2sim https://diracrobotics.com/evals https://diracrobotics.com/deployments https://diracrobotics.com/asset-pack#purple-chair Web search Check all the above sections of this website carefully, understand it, and let me know how we are going to bring this into our capture splat and world studio. We did already have some thought process on this, but specifically on all of these things, give me a very clear plan so that I can ask Codex to update our roadmap on GitHub. See, I also want to basically have assets like this pop wheelchair and other things to be built. I also want to actually help companies be able to do proper deployments and continuously make them succeed, even if the environment in which the robots are deployed keeps changing and getting modified. Also need to support with evals , you also need this Real2Sim Promise, we've already tried to incorporate, I think from world lab, we're trying to basically do real-to-sim-to-real (R2S2R) engine.

</div>

## Turn 4 - Assistant

# Capture Splat + World Studio should become a complete R2S2R operating system

The Dirac-inspired opportunity is larger than improving reconstruction. The product should cover the entire lifecycle:

    Capture the real site and task
            ↓
    Build and validate the simulation
            ↓
    Create reusable physics-calibrated assets
            ↓
    Evaluate many policies and failure conditions
            ↓
    Deploy the selected policy
            ↓
    Observe changes and failures in the real site
            ↓
    Update only the affected parts of the world
            ↓
    Re-evaluate, canary, promote or roll back

That gives you four connected products:

1.  **Real2Sim Compiler**

2.  **Physics Asset Factory and Registry**

3.  **Eval Studio**

4.  **Deployment Twin and R2S2R Operations**

One research limitation: Dirac’s homepage and shipped-asset summaries were readable, but the `/real2sim`, `/evals`, and `/deployments` routes returned client-rendered shells or cache misses to the crawler. I have therefore not invented undocumented copy or implementation details from those pages. The plan below combines the product surfaces identified by those routes, the workflow you supplied, the directly verifiable Dirac asset program, World Labs’ R2S2R description, and primary robotics research.

Dirac Robotics+3Invalid URL+3+3

## Codex-ready deliverables

Download the complete roadmap and Codex bundle

dirac-real2sim-r2s2r-roadmap-plan.md

CODEX_UPDATE_CAPTURE_SPLAT_WORLD_STUDIO_R2S2R.md

These are documentation and implementation plans; I have not modified either GitHub repository in this turn.

------------------------------------------------------------------------

# 1. What Dirac’s public product direction tells us

Dirac’s currently visible asset program is not merely a 3D model library. It describes requested assets being built for Isaac Sim and shipped with physical values that were generated by its Real2Sim pipeline and validated against the corresponding real object, with confidence information. Its current examples expose fields such as mass, bounds, seat stiffness, friction, center of mass, geometric fit and simulation penetration error.

Dirac Robotics

The important lesson is:

> A simulation asset is not finished when it looks correct. It is finished when its relevant geometry, collision, physical behavior, uncertainty and validation are documented for a declared task.

That aligns with physics-aware Real2Sim research. Scalable Real2Sim uses an external camera plus robot torque sensing to derive visual geometry, collision geometry and inertial properties. The robot changes grasps to expose occluded regions and executes trajectories designed to make physical parameters identifiable.

Scalable Real2Sim

Your product should adopt that philosophy, but expand it from individual assets into:

- complete customer sites;

- exact robot and sensor configurations;

- tasks and policies;

- ongoing deployments;

- environmental changes;

- policy evaluation and promotion.

------------------------------------------------------------------------

# 2. The product ownership split

## Capture Splat becomes the field evidence application

Capture Splat should own authoritative evidence capture:

- RGB and continuous video;

- accepted RGB-D keyframes;

- ARKit poses, intrinsics, gravity and IMU;

- LiDAR depth and confidence;

- ARKit mesh, planes and RoomPlan;

- masks and quality measurements;

- robot and sensor identity;

- task brief and work regions;

- object/asset captures;

- physical calibration trials;

- robot demonstrations and matched action sequences;

- deployment recaptures;

- references to ROS bags and robot logs;

- clocks, checksums, apparatus identity and uncertainty.

Capture Splat must continue writing accepted data locally before networking. It should never infer or promote mass, friction, stiffness or other physics authority on the phone.

The current repository is already well positioned: it records quality-gated RGB-D keyframes, indexed HEVC video, ARKit camera evidence, masks and mesh evidence; it can build metric seeds and controlled Gaussian reconstructions; and its live-session system is explicitly proposal-only.

## World Studio becomes the operational world compiler

World Studio should own:

- immutable World versions;

- visual, metric, collision, navigation, semantic and physics layers;

- object and part graphs;

- asset classes and exact physical instances;

- physical parameter fitting;

- Real2Sim Promise certificates;

- task compilation;

- Rapier and Isaac adapters;

- evaluation suites;

- policies and checkpoints;

- deployment records;

- field episodes;

- site changes and world deltas;

- release gates, canaries and rollback;

- R2S2R residual analysis.

World Studio’s current roadmap already has the correct foundations: canonical packages, indoor navigation, physical asset calibration, Isaac/ROS integration, held-out real/sim calibration and embodiment expansion. The major change is to productize those foundations into explicit **Assets, Evals and Deployments** programs.

## Keep the hybrid representation

World Studio should remain **Gaussian-rendered and multi-representation**, not Gaussian-only:

    Gaussian PLY/SPZ/SOG/RAD
        photoreal appearance and visual sensor rendering

    Metric point cloud
        registration, coverage, change detection and geometry evidence

    TSDF/ESDF/SDF
        fused surfaces, occupancy, free space and clearance

    Mesh/primitives/heightfields
        collisions, navigation, raycasts and contacts

    Semantic/part graph
        object identity, states, affordances and articulation

    Rapier / PhysX / Isaac
        dynamics, sensors, contacts and evaluation

This preserves your existing architecture: splats are the visual layer, while validated mesh/SDF geometry remains the physical layer. [](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=ce5557db-a937-4cbe-936d-36848e1e5604&conversation_save=1)

[SPZ visual pipeline integration](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=ce5557db-a937-4cbe-936d-36848e1e5604&conversation_save=1)

------------------------------------------------------------------------

# 3. Introduce the **Real2Sim Promise**

“Physics accurate” should not be an unqualified badge. It should become a scoped, versioned contract.

## Proposed contract

    world_studio.real2sim_promise.v0.1

A Promise binds exact versions of:

    JSON{
      "world": "warehouse_a@v12",
      "assets": [
        "wheelchair_07@v4",
        "chair_03@v2"
      ],
      "robot": "vacuum_robot@v5",
      "sensors": "vacuum_sensor_rig@v3",
      "task": "clean_zone_and_return@v4",
      "policy": "policy_checkpoint_84000",
      "simulators": [
        "rapier_build_...",
        "isaac_build_..."
      ],
      "validated_envelope": {},
      "metrics": [],
      "known_unknowns": [],
      "approved_for": [],
      "not_approved_for": [],
      "freshness": {},
      "decision": "promote"
    }

## Promise gates

A Real2Sim Promise should require:

1.  **Evidence integrity:** all inputs, clocks and checksums reconcile.

2.  **Metric alignment:** scale, axes, gravity and coordinate transforms pass.

3.  **Visual alignment:** held-out camera views and sensor-domain appearance pass.

4.  **Structural alignment:** floors, walls, openings, object states and free space pass.

5.  **Sensor alignment:** camera, depth, LiDAR, IMU, odometry and timing pass where relevant.

6.  **Matched open-loop validation:** the same command sequence is executed in simulation and reality.

7.  **Held-out physical validation:** fitted parameters improve trials that were not used for fitting.

8.  **Eval predictivity:** simulation identifies materially similar failures and policy rankings.

9.  **Freshness:** no unresolved real-world modification invalidates the Promise.

10. **Explicit scope:** approved and prohibited uses are human-readable.

This builds directly on the existing World Studio calibration tiers, which already distinguish passive capture, direct measurements, interaction trials, robot-force evidence, held-out validation and deployment-level correlation. The repository also already takes the correct position that the public claim should be “physics-calibrated within a validated task envelope,” not universally physics accurate.

## Suggested Promise levels

<div>

<div>

| Level | Meaning                                               |
|-------|-------------------------------------------------------|
| P0    | Source evidence reconciled                            |
| P1    | Visual views aligned                                  |
| P2    | Metric structure aligned                              |
| P3    | Indoor navigation and static collision validated      |
| P4    | Target robot sensors aligned                          |
| P5    | Selected rigid or rolling assets calibrated           |
| P6    | Articulated assets calibrated                         |
| P7    | Evals predict failure regions and policy ranking      |
| P8    | Deployment is continuously maintained and revalidated |

<div>

<div>

</div>

</div>

</div>

</div>

Your first commercial target should be **P3–P5 for indoor mobile robots**, not general deformable manipulation.

------------------------------------------------------------------------

# 4. Build a Physics Asset Factory like Dirac’s Asset Pack

## Every asset should have a Physics Asset Passport

Proposed contract:

    world_studio.physics_asset.v0.1

Each asset should contain:

<div>

<div>

| Layer | Contents |
|----|----|
| Identity | Asset class, exact physical instance, manufacturer/catalog data |
| Evidence | Source captures, measurements, apparatus and hashes |
| Appearance | Gaussian PLY, SPZ/SOG/RAD and optional PBR mesh |
| Metric geometry | Point cloud, surface geometry and uncertainty |
| Collision | Triangle mesh, convex decomposition, primitives and LoDs |
| Semantics | Parts, labels, relationships and affordances |
| Articulation | Links, joints, axes, limits, brakes and drives |
| Physics | Mass, COM, inertia, friction, restitution, stiffness, damping, rolling resistance |
| Validation | Calibration trials, held-out trials and residuals |
| Builds | OpenUSD/Isaac, Rapier and optional MJCF variants |
| Scope | Approved and prohibited tasks, expiry and revalidation triggers |
| Lineage | Parent version and modifications |

<div>

<div>

</div>

</div>

</div>

</div>

## Asset maturity ladder

<div>

<div>

| Level                    | Meaning                                          |
|--------------------------|--------------------------------------------------|
| A0 Visual                | Looks like the object                            |
| A1 Metric                | Correct scale, dimensions and frame              |
| A2 Collision             | Task-appropriate collider validated              |
| A3 Rigid physics         | Mass, inertia and contact parameters validated   |
| A4 Articulated/compliant | Joints, brakes, drives or stiffness validated    |
| A5 Task validated        | Held-out real/sim interaction passes             |
| A6 Deployment validated  | Asset supports deployment decisions in the field |

<div>

<div>

</div>

</div>

</div>

</div>

## Purple-chair-style reference asset

An upholstered chair should be built through:

    Object Orbit RGB-D capture
            ↓
    Known dimensions and mass
            ↓
    Frame / legs / seat / back objectization
            ↓
    Gaussian appearance and metric mesh
            ↓
    Rigid-frame collision + separate cushion representation
            ↓
    Floor-friction, push/tip and compression trials
            ↓
    Held-out pushes, floor patches and load conditions
            ↓
    Asset Passport and simulator builds

Useful measurements include:

- total mass;

- dimensions and seat height;

- center of mass;

- floor/material friction;

- tipping behavior;

- cushion stiffness;

- cushion damping and recovery;

- collision penetration and resting stability.

## Wheelchair as the strategic reference asset

A wheelchair is more useful than a simple chair for proving the system because it introduces:

- multiple rolling bodies;

- freely swiveling casters;

- brakes;

- articulation;

- changing load;

- rolling and pivot friction;

- compliant seating;

- threshold and floor interactions.

### Part graph

    wheelchair_root
    ├── frame
    ├── rear_wheel_left
    ├── rear_wheel_right
    ├── front_caster_fork_left
    │   └── front_caster_wheel_left
    ├── front_caster_fork_right
    │   └── front_caster_wheel_right
    ├── brake_left
    ├── brake_right
    ├── footrests
    ├── armrests
    ├── seat_cushion
    └── back_cushion

### Calibration tests

Capture Splat should guide the operator through:

- dimensions, wheel radii, axle spacing and caster trail;

- total mass;

- unloaded center of mass and inertia estimate;

- straight push and coast-down;

- pivot and yaw response;

- caster swivel and settling;

- brake activation and holding;

- rolling resistance on multiple floor materials;

- declared threshold-height crossings;

- cushion compression and recovery when relevant;

- instrumented ballast-load variants.

Start with an **unoccupied wheelchair used as a rolling obstacle or robot-interaction asset**. Human occupancy, medical-device certification, occupant biomechanics and human-safety claims must remain outside the first product scope.

## OpenUSD output

NVIDIA’s current asset guidance explicitly separates geometry, instances, materials, neutral physics and simulator-specific PhysX/MuJoCo layers, while preserving source assets and using payloads and variants for modularity.

Isaac Sim Documentation

Use:

    wheelchair/
    ├── asset.usd
    ├── source/
    ├── payloads/
    │   ├── base.usda
    │   ├── geometries.usd
    │   ├── instances.usda
    │   ├── materials.usda
    │   └── appearance.spz
    ├── features/
    │   ├── physics.usda
    │   ├── physx.usda
    │   ├── mujoco.usda
    │   ├── semantics.usda
    │   ├── ros.usda
    │   └── sensors.usda
    ├── validation/
    └── asset-passport.json

------------------------------------------------------------------------

# 5. Build **Eval Studio**

World Labs’ central R2S2R insight is that a useful simulator does not necessarily need to reproduce the exact aggregate real-world success rate. It must support the same engineering decisions: identify failure conditions, rank policies and predict whether a policy improvement will transfer to hardware. Pasted text

The SceniX/Columbia Real-to-Sim policy-evaluation work demonstrates this direction using Gaussian-rendered environments and soft-body digital twins. It performs color alignment, physics optimization using the same robot trajectory in simulation and reality, closed-loop rollouts and correlation between simulated and real policy performance.

Real-to-Sim

## Eval contracts

    world_studio.eval_suite.v0.1
    world_studio.eval_case.v0.1
    world_studio.eval_run.v0.1
    world_studio.eval_report.v0.1
    world_studio.policy_artifact.v0.1
    world_studio.embodiment_adapter.v0.1
    world_studio.promotion_decision.v0.1

Every run must bind:

    World hash
    Asset hashes
    Robot and sensor profiles
    Task version
    Policy/checkpoint hash
    Simulator/runtime version
    Random seed
    Every sampled variation
    All observations, actions, events and outcomes

## Variations

The evaluation system should vary:

- initial robot pose and state;

- object states and configurations;

- clutter and temporary obstacles;

- lighting, exposure and viewpoint;

- camera-mount perturbations;

- sensor noise, dropout, latency and clock offsets;

- friction, rolling resistance and asset uncertainty;

- robot wheel radius, wheelbase and actuator response;

- task difficulty;

- environment version;

- embodiment and sensor stack where compatible.

NVIDIA’s current Isaac Lab Arena guidance makes the same point: a single success rate does not explain why a policy fails. Controlled variations should be tied to individual episode outcomes through sensitivity analysis.

Isaac Sim Arena also supports changing object, lighting and embodiment variations from one environment definition without duplicating task logic.

Isaac Sim

## Metrics

### Task performance

- success and failure reason;

- time, coverage and throughput;

- energy use;

- forbidden-region violations;

- contacts and force limits;

- interventions and recoveries;

- near misses.

### Real/sim alignment

- RGB/perceptual observation residual;

- depth/LiDAR projection residual;

- trajectory ATE/RPE;

- stopping and turning residual;

- object pose and contact residual;

- outcome agreement;

- near-boundary behavior agreement.

### Predictivity

- Spearman or Kendall policy-rank correlation;

- checkpoint improvement-direction agreement;

- failure-region overlap;

- critical failure recall;

- false-safe rate;

- regression detection recall;

- calibration between simulated confidence and real outcome.

## Release decisions

Every candidate policy should end in one of:

    reject
    shadow
    canary
    promote
    rollback

Simulation should screen large numbers of checkpoints. Physical evaluation should be reserved for finalists, held-out boundary cases and ongoing promise validation.

------------------------------------------------------------------------

# 6. Build **Deployment Twin and R2S2R Operations**

The central deployment problem is that the real environment will not remain identical to the scan:

- chairs and wheelchairs move;

- racks and tables are relocated;

- clutter accumulates;

- floor surfaces are changed;

- camera mounts drift;

- wheels wear;

- robot firmware changes;

- tasks and policies change.

The answer is not to rebuild the entire simulation manually each time. It is to maintain an immutable site lineage.

## Deployment record

    world_studio.deployment.v0.1

Each deployment binds:

    Customer / site / zone
    World version
    Asset instance versions
    Robot and sensor profile
    TaskSpec
    Policy/controller version
    Real2Sim Promise
    Eval gate
    Release channel: shadow / canary / production

## Separate four kinds of change

1.  **State changes:** known movable assets changed pose.

2.  **Structural changes:** walls, shelves, floors or fixtures changed.

3.  **Robot/sensor changes:** calibration, wheel wear, camera mount, firmware or payload changed.

4.  **Task/policy changes:** goal, constraints or model changed.

A moved wheelchair should usually update asset state and affected routes—not trigger a full room reconstruction.

## Capture Splat Deployment Recapture

Add a new capture intent:

    Deployment Recapture

The user should:

1.  select the customer deployment and site zone;

2.  relocalize into the existing World frame;

3.  capture only the changed zone;

4.  record before/after anchors;

5.  attach relevant robot episode or incident;

6.  upload immutable delta evidence.

Capture Splat can suggest:

    changed
    unchanged
    unknown

But these remain proposals.

## World Studio change processing

World Studio should compare:

- images;

- depth;

- point clouds;

- meshes;

- semantics;

- object identities and poses;

- free space and collision;

- sensor-domain observations.

It should then create:

    World v12
      └── Site delta proposal
            └── World v13

Never overwrite World v12.

## Change impact graph

For each accepted delta, determine:

- which routes intersect it;

- which tasks use those routes or assets;

- which asset instances are affected;

- which sensor views changed;

- which Promise certificates became stale;

- which eval suites must rerun;

- whether the fix is local geometry, object pose, asset replacement, sensor calibration or full reconstruction.

## Field episodes

Every real deployment episode should preserve:

- exact world, asset, robot, task and policy versions;

- commands and actions;

- TF, odometry and joints;

- sensor observations;

- contacts, events and interventions;

- outcome and failure reason;

- environment snapshot or recapture reference;

- clocks and checksums.

## The operational loop

    Field anomaly or scheduled recapture
            ↓
    Classify:
    environment / asset / sensor / robot / task / controller / policy
            ↓
    Replay in the exact deployment twin
            ↓
    Propose World, Asset, Sensor, Task or Policy update
            ↓
    Run impacted evals plus global safety suite
            ↓
    Shadow deployment
            ↓
    Canary deployment
            ↓
    Promote, hold or roll back
            ↓
    Continue monitoring

Isaac Lab’s current deployment documentation explicitly supports training policies in Isaac Lab and deploying them to both simulation and real robots.

Isaac Sim World Studio should provide the missing control plane around that transfer: provenance, eval gates, field evidence, change management and rollback.

------------------------------------------------------------------------

# 7. Revised Capture Splat roadmap

Keep the current completed live-session foundation and authenticated-sender work. Add:

<div>

<div>

| Milestone | Outcome |
|----|----|
| **CS-R2S1 Task, Robot and Site Brief** | Every scan is tied to a site, robot, sensors, task and required Promise level |
| **CS-R2S2 Asset Capture and Calibration Trials** | Object Orbit plus slide, push, compression, roll, brake, pendulum and articulation evidence |
| **CS-R2S3 Matched Open-Loop and Demonstration Capture** | Robot commands, observations, initial-state alignment and outcomes recorded for real/sim comparison |
| **CS-R2S4 Deployment Recapture and Change Evidence** | Existing World relocalization and immutable site-delta packages |
| **CS-R2S5 Physical Device Acceptance** | Thermal, storage, clock, networking, finalization, privacy and apparatus acceptance |

<div>

<div>

</div>

</div>

</div>

</div>

### New capture intents

    Physics Asset Orbit
    Dimensions and Scale
    Slide / Ramp
    Push / Tip
    Drop / Restitution
    Compression / Recovery
    Pendulum / Inertia
    Roll / Coast-down / Brake
    Articulation Range
    Task Demonstration
    Matched Open-Loop Trial
    Deployment Recapture

### Proposed Capture Splat schemas

Keep them as proposals until code, migrations and round-trip tests exist:

    capture_splat.task_brief.v0.1
    capture_splat.asset_capture.v0.1
    capture_splat.calibration_trial.v0.1
    capture_splat.task_demonstration.v0.1
    capture_splat.deployment_recapture.v0.1
    capture_splat.site_delta_evidence.v0.1
    capture_splat.field_episode_reference.v0.1

------------------------------------------------------------------------

# 8. Revised World Studio roadmap

I recommend extending the current milestone sequence to:

<div>

<div>

| Milestone | Revised outcome |
|----|----|
| **M0** | Live Evidence Foundation — retain completed |
| **M1** | Authenticated LAN and Progressive World |
| **M2** | Canonical World, Asset and Delta Graph |
| **M3** | Indoor Navigation and First Deployment Twin — P3 |
| **M4** | Physics Asset Factory and Registry — A0–A4 |
| **M5** | Isaac/ROS Sensor and Asset Conformance — P4 |
| **M6** | Real2Sim Promise and Matched Calibration — P5/P6 |
| **M7** | Predictive Eval Studio — P7 |
| **M8** | Deployment Operations and Continuous R2S2R — P8 |
| **M9** | Expanded Embodiments: UAVs, vehicles, manipulation and deformables |

<div>

<div>

</div>

</div>

</div>

</div>

The existing M3–M6 acceptance gates already contain the correct technical seeds: validated collision/free space, objectized assets, direct measurements, ramp/slide/drop/compression trials, layered OpenUSD, ROS sensor parity, held-out system identification and World lineage.

## Files Codex should update

### Capture Splat

    ROADMAP.md
    docs/real2sim_capture_program.md

Plus proposed contracts and fixtures.

### World Studio

    ROADMAP.md
    docs/blueprints/world-compiler-v0.1/MILESTONES.md
    docs/blueprints/world-compiler-v0.1/ADOPTION_STATUS.md
    docs/blueprints/world-compiler-v0.1/PHYSICAL_ASSET_CALIBRATION.md
    docs/blueprints/world-compiler-v0.1/NEXT_IMPLEMENTATION_PROMPT.md
    docs/upstreams.md

Add:

    REAL2SIM_PROMISE.md
    ASSET_FACTORY_AND_REGISTRY.md
    EVAL_STUDIO.md
    DEPLOYMENT_TWIN.md
    R2S2R_OPERATIONS.md

Do not add a seventh top-level World Studio mode. Map the capabilities into the current six:

<div>

<div>

| Mode | Responsibility |
|----|----|
| View | World freshness, versions and change overlays |
| Edit | Objectization, parts, joints and delta review |
| Simulate | Compilation, physics trials, variants and eval jobs |
| Pilot | Matched scripts and teleoperation |
| Sensors | Apparatus, clock and sensor calibration |
| Episode | Eval results, real/sim pairs, deployments, promotion and rollback |

<div>

<div>

</div>

</div>

</div>

</div>

------------------------------------------------------------------------

# 9. The first complete demonstration

Use:

- one furnished indoor room;

- one vacuum or small AMR;

- one upholstered chair;

- one unoccupied wheelchair;

- three controller/policy checkpoints.

The demonstration should be:

1.  Capture the room with Capture Splat.

2.  State the task: clean selected zones, avoid a rug and stair region, return to dock.

3.  Build the hybrid visual/metric/collision World.

4.  Capture and calibrate the chair and wheelchair.

5.  Compile the World and assets into Isaac.

6.  Evaluate three policies across start poses, clutter, lighting, sensor noise, floor uncertainty and chair/wheelchair positions.

7.  Select one policy through the Eval gate.

8.  Deploy it on the real robot.

9.  Move the wheelchair and add a route obstacle.

10. Perform a targeted Capture Splat recapture.

11. Show that the old Real2Sim Promise is now partially stale.

12. Produce World v2 as a delta.

13. Identify affected routes and eval cases.

14. Rerun only impacted suites plus the global safety suite.

15. Canary the update.

16. Promote or roll back with the complete audit trail.

That single demonstration proves all four product surfaces:

    Real2Sim
    Asset Factory
    Evals
    Deployments

It also demonstrates the real goal of R2S2R:

> The simulation is not a finished 3D file. It is maintained infrastructure that evolves with the site, the robot, the task and the policy.

------------------------------------------------------------------------

# 10. The differentiated position

The strongest positioning is not merely:

> Shoot a video and get a simulation.

It is:

> **Capture Splat records reality. World Studio turns it into a validated, versioned world; tests every policy against the world it will face; and keeps that world current after deployment.**

Your differentiation should be:

- iPhone-first and local-first evidence;

- immediate progressive feedback plus final reconstruction;

- Gaussian appearance with separate metric and physics authority;

- task-scoped Real2Sim Promise;

- reusable asset classes plus exact calibrated instances;

- open, machine-readable validation contracts;

- policy- and embodiment-neutral evaluation;

- failure-region and policy-ranking predictivity;

- site-delta recapture instead of manual rebuilding;

- world freshness, canary and rollback;

- external Isaac integration without making Isaac the canonical source of truth;

- complete real-to-sim-to-real provenance.

That is the roadmap Codex should now publish into both repositories.

## Turn 5 - User

Also, world studio must start using Newton [newton-physics/newton](https://github.com/newton-physics/newton)instead of rapier now, make necessary changes and share the whole thing or any specific thing that you want to share in addition to the above that I need to share with Codex.

## Turn 6 - Assistant

# Newton is now the target physics backend

I updated the complete Capture Splat + World Studio R2S2R plan so that **Newton replaces Rapier as World Studio’s only intended product physics backend**.

Download the complete Newton + R2S2R update bundle

The most important files are:

- CODEX_NEWTON_MIGRATION_AND_ROADMAP_PROMPT.md

- FULL_R2S2R_ROADMAP_WITH_NEWTON.md

- NEWTON_RUNTIME_ARCHITECTURE.md

- NEWTON_MIGRATION_MILESTONES.md

- NEWTON_SOLVER_PROFILES.md

- CAPTURE_SPLAT_NEWTON_HANDOFF.md

- ISAAC_LAB_NEWTON_INTEGRATION.md

- NEWTON_R2S2R_PROMISE_EVAL_DEPLOYMENT.md

- CURRENT_REPO_CHANGE_MAP.md

- VALIDATION_REPORT.txt

------------------------------------------------------------------------

## The critical architectural correction

This cannot be implemented as:

    Remove @dimforge/rapier
    Install Newton in the React app

Newton’s current implementation is a Python runtime built on NVIDIA Warp, with MuJoCo Warp as its primary backend. Its supported platforms include macOS in CPU-only mode and Linux/Windows with NVIDIA GPU acceleration. The practical architecture is therefore an **out-of-process Newton worker**, not a browser dependency. Newton 1.4.0, released July 16, 2026, is the baseline pinned in the bundle.

    Mermaid

### Runtime ownership

<div>

<div>

| Component | Responsibility |
|----|----|
| Capture Splat | Source evidence, metric frames, geometry proposals, calibration trials and deployment recaptures |
| World Studio | World versions, assets, tasks, Promises, evals, deployments and authority |
| Newton | Dynamics, contacts, joints, physical state, physics sensors and episodes |
| Spark + Three.js | Gaussian/mesh rendering, editing, overlays, interaction and replay |
| Isaac Lab Newton | Parallel policy training and evaluation |
| Isaac RTX / ROS 2 | Separately validated high-fidelity sensor and robot-interface adapter |

<div>

<div>

</div>

</div>

</div>

</div>

This maintains the established project rule: Gaussian splats remain the visual layer, while separately validated mesh, SDF, heightfield, convex or primitive geometry supplies collision. [](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=ce5557db-a937-4cbe-936d-36848e1e5604&conversation_save=1)

[SPZ visual pipeline integration](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=ce5557db-a937-4cbe-936d-36848e1e5604&conversation_save=1)

Spark and Three.js remain the visual composition layer rather than becoming the physics engine. [](https://chatgpt.com/g/g-p-6a15260f84e08191bdb75a1c9105e29f/c/6a202913-87fc-8321-b2d0-57fc37db0955?messageId=570c0ef6-78ba-403d-963b-3672b6123ba5&conversation_save=1)

Bundle v3 Physics Clarification

------------------------------------------------------------------------

# What changes in the current World Studio implementation

The repository currently has a direct browser-side Rapier implementation:

- `apps/web/package.json` depends on `@dimforge/rapier3d-compat`.

- `apps/web/src/simulation.ts` directly imports Rapier and implements `RapierWalkSimulation` and `RapierSimulation`.

- The shared diagnostics contract only recognizes `rapier3d-compat` or `unavailable`.

Codex should replace that architecture as follows:

<div>

<div>

| Current | Target |
|----|----|
| Rapier executes inside the browser renderer | Newton executes in a supervised Python worker |
| `RapierSimulation` | Solver-neutral `SimulationClient` |
| Browser creates worlds and colliders | Worker loads compiled World/OpenUSD artifacts |
| Direct JavaScript state access | Ordered, typed simulation-state messages |
| Rapier-specific diagnostics | Newton/Warp/solver/device/version diagnostics |
| Browser fallback movement | Fail-closed `Newton worker unavailable` state |
| One local WebAssembly engine | Local CPU worker plus authenticated remote CUDA worker |
| Rapier Episode state | Newton state/contact/sensor Episode v0.2 |

<div>

<div>

</div>

</div>

</div>

</div>

The Electron main process already owns filesystem and local service IPC responsibilities, making it the correct place to supervise the Newton process rather than allowing the sandboxed renderer to spawn it.

------------------------------------------------------------------------

# Rapier removal policy

The architecture changes **now**, but removing working code should occur through a controlled cutover:

1.  Freeze all Rapier feature work.

2.  Capture temporary parity fixtures for spawn, movement, collisions, props and Episodes.

3.  Introduce a solver-neutral TypeScript interface.

4.  Add the Electron worker supervisor.

5.  Add the Newton worker.

6.  reproduce existing behavior in Newton;

7.  switch the active Simulate and Pilot paths to Newton;

8.  make browser-only physics fail closed;

9.  remove Rapier package, classes, tests, UI text and bundle chunks.

Rapier will not remain a user-selectable backend, a silent fallback or a second physics authority. It survives only temporarily on the migration branch until Newton parity and Episode migration pass.

------------------------------------------------------------------------

# Local Mac versus remote GPU

Newton can run on macOS, but it is CPU-only there. The following Newton features currently require an NVIDIA GPU and should be blocked on the Mac capability profile:

- SDF collision;

- SDF mesh-to-mesh contact;

- hydroelastic contacts;

- tiled camera rendering;

- Implicit MPM;

- tile-based VBD.
  Newton Physics+1

Therefore:

    MacBook / Apple Silicon
        static indoor world validation
        spawn and route preview
        bounded rigid bodies
        CPU MuJoCo
        contact, IMU and raycast probes
        editor interaction
        deterministic small episodes

    Linux / NVIDIA
        GPU MuJoCo Warp
        thousands of parallel evals
        policy training
        CUDA graphs where supported
        SDF/hydroelastic experiments
        high-volume sensors
        deformables and multiphysics research

Newton’s `SolverMuJoCo` explicitly supports both MuJoCo CPU and MuJoCo Warp modes through `use_mujoco_cpu`, and supports selecting either MuJoCo contacts or Newton’s own contact pipeline.

Newton Physics+1

------------------------------------------------------------------------

# Default World Studio solver profile

The first production profile should be:

    newton-mujoco-rigid-v1

    Newton: 1.4.0
    Solver: SolverMuJoCo
    Mac: use_mujoco_cpu=true
    Linux/NVIDIA: MuJoCo Warp
    deterministic=true
    fixed physics timestep
    fixed substeps
    explicit contact pipeline
    primitive/convex/heightfield collision preferred
    task-preserving static mesh only after validation

Newton includes multiple solvers, but they do not have identical capabilities or parameter meanings. MuJoCo is appropriate for the first rigid and articulated robot profile; Kamino and VBD should remain experimental, while MPM and coupled multiphysics should remain research tracks.

Newton Physics+1

## Important collision warning

MuJoCo’s native path supports only convex mesh collision. A non-convex captured room mesh can be convex-hulled, potentially closing doorways or creating false obstacles. World Studio must either:

- generate task-preserving convex decomposition;

- use primitives or heightfields;

- use a validated Newton collision pipeline;

- or reject the artifact.

It must compare the **effective collider** against Capture Splat’s metric geometry before promoting navigation or collision authority.

Newton Physics

------------------------------------------------------------------------

# Isaac changes after Newton adoption

Isaac Lab 3.0’s multi-backend architecture now supports Newton as a selectable physics backend, with MuJoCo Warp as its primary validated Newton path. It also supports kit-less Newton operation without requiring Isaac Sim. However, the Newton integration is currently beta, with incomplete and still-maturing task coverage.

Isaac Sim+2

Isaac Sim+2

The new relationship should be:

    Standalone Newton
        canonical local/remote World Studio physics

    Isaac Lab Newton
        policy training and parallel evaluation adapter

    Isaac RTX
        optional high-fidelity rendering/sensor adapter

    Isaac Sim / ROS 2
        optional robot-interface and system-conformance adapter

Isaac Lab separates physics, renderer and visualizer selection, and its `SceneDataProvider` can expose authoritative Newton state to renderer/visualizer consumers. Nevertheless, each Newton + renderer + sensor + ROS combination must pass a task-specific conformance suite rather than being assumed to work.

Isaac Sim+2

Isaac Sim+2

------------------------------------------------------------------------

# R2S2R remains the core product

Newton does not replace the Real2Sim Promise, Asset Factory, Eval Studio or Deployment Twin. It becomes their execution substrate.

The Real2Sim Promise will now bind:

    JSON{
      "physics_engine": "newton",
      "physics_version": "1.4.0",
      "solver_profile": "newton-mujoco-rigid-v1",
      "contact_pipeline": "mujoco",
      "device": "cuda:0",
      "deterministic": true,
      "physics_dt_s": 0.004166666667,
      "substeps": 4,
      "world_hash": "sha256:...",
      "adapter_conformance": {
        "isaac_lab_newton": "promote",
        "isaac_rtx_ros": "hold"
      }
    }

Every Eval, Asset Passport and Deployment must preserve the exact Newton, Warp, MuJoCo, solver-profile, device, timestep, substep, seed and world-version information.

This continues to follow the World Labs R2S2R requirement: validate matched real and simulated open-loop interactions, reproduce task-relevant observations and dynamics, actively search failure conditions, preserve policy rankings and use field outcomes to improve the next world and policy. Pasted text

------------------------------------------------------------------------

# Capture Splat does **not** install Newton

Capture Splat remains simulator-independent. It should add a Newton-ready handoff document and manifest fields for:

- canonical meter units and gravity;

- coordinate frame and transform graph;

- visual Gaussian;

- metric points;

- collision representation type;

- finite vertices and indices;

- triangle winding;

- convex decomposition or simplification provenance;

- floor, wall, opening and unknown regions;

- object-local visual and collision frames;

- direct measurement and calibration evidence;

- uncertainty;

- source hashes;

- approved and prohibited use.

World Studio then validates whether the artifacts actually import and behave correctly in the chosen Newton profile.

CAPTURE_SPLAT_NEWTON_HANDOFF.md

------------------------------------------------------------------------

# Proposed updated World Studio milestones

<div>

<div>

| Milestone | Outcome                                          |
|-----------|--------------------------------------------------|
| M0        | Live Evidence Foundation                         |
| M1        | Authenticated LAN and Progressive World          |
| M2        | Canonical World, Asset and Delta Graph           |
| M3        | Indoor Navigation and First Deployment Twin — P3 |
| M4        | Physics Asset Factory — A0–A4                    |
| **M5**    | **Newton Runtime and OpenUSD Foundation**        |
| **M6**    | **Newton/Isaac Lab/ROS Sensor Conformance — P4** |
| M7        | Real2Sim Promise and Rigid Calibration — P5/P6   |
| M8        | Predictive Eval Studio — P7                      |
| M9        | Deployment Operations and Continuous R2S2R — P8  |
| M10       | Expanded Embodiments and Multiphysics            |

<div>

<div>

</div>

</div>

</div>

</div>

The bundle includes the precise PR sequence from contracts and worker supervision through Newton cutover, Rapier deletion, remote CUDA evaluation, Isaac Lab integration and deployment operations.

------------------------------------------------------------------------

# Validation and publication status

The bundle contains four proposal schemas:

- Newton capabilities;

- solver profile;

- Newton job;

- simulation state.

All four positive examples validated successfully, and the negative unsafe-path fixture was rejected.

I was not able to run the complete World Studio or Capture Splat test suites because the repositories could not be cloned into the execution container. No GitHub branch, commit or pull request was created in this turn. Physical accuracy, Newton import compatibility, GPU execution and Isaac conformance remain evidence-dependent rather than established by the roadmap alone.

The file to give Codex first is:

CODEX_NEWTON_MIGRATION_AND_ROADMAP_PROMPT.md
