# R2S2R And Newton Adoption Note

This folder reconciles the supplied Dirac-inspired Real2Sim material, the World Labs
real-to-sim-to-real (R2S2R) direction, and the request to make Newton the target World
Studio physics runtime.

It is a planning and provenance package. It does not establish that Newton integration,
physics calibration, policy predictivity, or deployment operations are implemented.

## Adopted Decisions

- Capture Splat remains the local-first evidence recorder. Networking, reconstruction, and
  simulation may not weaken its durable capture path.
- World Studio owns immutable World, Asset, Robot, Sensor, Task, Eval, Policy, and
  Deployment versions plus promotion decisions.
- Spark and Three.js remain World Studio's visual composition and Gaussian rendering
  layer.
- Newton is the only intended long-term product physics backend. It runs in a supervised
  Python worker rather than in the React bundle.
- Rapier remains a temporary implementation dependency until Newton reproduces the
  accepted local movement, collision, and Episode fixtures. It is not a silent fallback or
  a second physics authority after cutover.
- Isaac Lab Newton is the first parallel training and evaluation adapter. Isaac RTX,
  Isaac Sim, and ROS 2 remain separately capability-tested adapters.
- The six World Studio modes remain View, Edit, Simulate, Pilot, Sensors, and Episode.
- Public physical claims remain task-scoped: "physics-calibrated within a validated task
  envelope."

## Product Programs

The World Compiler roadmap now names four connected programs:

1. **Real2Sim Promise:** a versioned certificate describing what a World is and is not
   validated to reproduce.
2. **Physics Asset Factory:** evidence-backed visual, metric, collision, semantic, and
   physical asset layers with immutable passports.
3. **Eval Studio:** matched real/sim trials, variations, failure regions, policy ranking,
   and promotion decisions.
4. **Deployment Twin:** site revisions, field evidence, freshness, canary, rollback, and
   continuous R2S2R operations.

## Canonical Adoption Documents

- [Newton Runtime Architecture](NEWTON_RUNTIME_ARCHITECTURE.md)
- [Newton Migration Milestones](NEWTON_MIGRATION_MILESTONES.md)
- [Capture Splat To Newton Handoff](CAPTURE_SPLAT_NEWTON_HANDOFF.md)
- [Real2Sim Promise](REAL2SIM_PROMISE.md)
- [Asset Factory And Registry](ASSET_FACTORY_AND_REGISTRY.md)
- [Eval Studio](EVAL_STUDIO.md)
- [Deployment Twin](DEPLOYMENT_TWIN.md)
- [R2S2R Operations](R2S2R_OPERATIONS.md)
- [Primary Sources](SOURCES.md)

The public milestone sequence remains canonical in
[`../MILESTONES.md`](../MILESTONES.md). These documents explain the expanded outcomes and
migration gates.

## Source Material

[`source/`](source/) contains Markdown snapshots of the supplied material:

- the two files extracted from `dirac-real2sim-r2s2r-roadmap-codex-bundle.zip`;
- the R2S2R operating-system brief;
- the Newton target-backend brief;
- a public-safe transcript of all six visible user and final-assistant messages from the
  supplied saved research conversation;
- curated notes from the supplied saved research conversation.

The private saved web page, hidden analysis/tool traces, browser telemetry, and browser
support files are not published. Their checksums and transformation boundary are recorded in
[`SOURCE_MANIFEST.md`](SOURCE_MANIFEST.md) and
[`HTML_AUXILIARY_MANIFEST.md`](HTML_AUXILIARY_MANIFEST.md).

The Newton-specific ZIP referenced inside the supplied conversation was not itself
provided. This adoption package therefore uses the accessible brief and current primary
sources instead of claiming to reproduce missing files.

Source snapshots are research provenance, not active contracts. Dead research-sandbox
links were neutralized in the two pasted briefs; the ZIP documents are byte-identical.
[`SOURCE_MANIFEST.md`](SOURCE_MANIFEST.md) records the transformation boundary.

## Verified Corrections

As of 2026-07-29:

- Newton 1.4.0 is the latest release and was published on 2026-07-16.
- Newton is a Python runtime built on NVIDIA Warp. macOS is CPU-only; Linux and Windows
  can use NVIDIA GPU acceleration.
- `SolverMuJoCo` can use MuJoCo CPU or MuJoCo Warp and can select MuJoCo contacts or
  Newton's collision pipeline.
- MuJoCo's native mesh collision convex-hulls non-convex meshes. Newton's own collision
  pipeline can support non-convex/SDF workflows, but each captured environment still
  requires an effective-collider comparison before collision or navigation promotion.
- Isaac Lab 3.0 beta supports PhysX and Newton through a multi-backend architecture.
  Newton support is still beta and PhysX remains the documented default.

These facts justify the target architecture. They do not prove World Studio parity,
performance, or physical validity.
