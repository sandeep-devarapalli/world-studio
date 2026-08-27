# Physical Asset Calibration

Physical Asset Calibration is a World Studio subsystem for turning object evidence and
instrumented trials into task-scoped simulator parameters. It is not passive material
guessing and does not add a seventh application mode.

## Mode Responsibilities

- **Edit:** objectization, visual/metric/collision geometry, priors, parameter review, and
  asset versions.
- **Sensors:** apparatus, scale, camera, clock, force/torque, and robot calibration.
- **Simulate:** current Rapier fixtures, capability-routed Newton/SuperDex experiments,
  external adapter replay,
  sampled parameters, and residual overlays.
- **Episode:** immutable real/sim trial groups, holdouts, decisions, and promoted versions.

View and Pilot consume calibrated assets but do not create calibration authority.

## Calibration Tiers

| Tier | Required evidence | Permitted result |
|---|---|---|
| C0 | Capture Splat evidence only | Visual and geometry proposal |
| C1 | Scale, calipers, or known dimensions | Direct dimension and mass measurements |
| C2 | Ramp, slide, drop, or compression trials | Experiment-conditioned contact estimates |
| C3 | Robot torque or force sensing | Mass, center-of-mass, and inertia estimates |
| C4 | Held-out matched real/sim trials | Task-scoped validated dynamics |
| C5 | Closed-loop field correlation | Deployment-decision evidence |

Skipping a tier requires equivalent or stronger evidence and an explicit review decision.

## Parameters And Provenance

Draft contracts cover:

- mass;
- center of mass;
- inertia tensor;
- material-pair static and dynamic friction;
- restitution;
- stiffness and damping;
- rolling resistance;
- articulation limits, damping, stiffness, and drive parameters.

Every value carries units, source class, range or uncertainty, experiment and solver
provenance, simulator and contact-model scope, and `approved_for`/`not_approved_for`.
Source classes distinguish direct measurement, indirect measurement, catalog data,
estimation, and simulator defaults.

Physically infeasible parameters, missing units, uncalibrated sensors, non-finite data, and
unidentifiable estimates are rejected or held. Inertia must be symmetric, positive, and
consistent with mass and geometry bounds.

## Capture Splat Boundary

Capture Splat may supply RGB-D, poses, intrinsics, gravity, scale evidence, masks, mesh,
RoomPlan proposals, continuous video, and synchronized experiment imagery.

Passive capture must not claim mass, inertia, friction, restitution, stiffness, force,
torque, or physics authority. It can record apparatus observations and timing evidence for
later calibration.

## Promotion

Promotion requires:

1. Calibrated apparatus and synchronized raw evidence.
2. Separate fitting and held-out trials.
3. Physically feasible parameters and uncertainty bounds.
4. Reproducible solver, simulator, contact model, seeds, and versions.
5. Improvement over simulator defaults for declared task metrics.
6. No unacceptable regression on held-out safety or behavior metrics.
7. A human-readable `approved_for` and `not_approved_for` decision.

The public claim is "physics-calibrated within a validated task envelope." No asset is
universally physics accurate.

Calibration tiers (`C0-C5`), asset maturity (`A0-A6`), Real2Sim Promise levels (`P0-P8`),
and world/robot readiness (`R0-R5`) are separate namespaces. Advancement in one does not
automatically advance another.

Capability-routed workers become product simulator scope only after the
[migration gates](r2s2r-newton-2026-07-29/NEWTON_MIGRATION_MILESTONES.md) pass. Existing
Rapier experiments remain historical or parity evidence and cannot silently substitute for
a declared Newton or SuperDex profile.

## Technical References

- [Dirac Robotics](https://www.diracrobotics.com/) publicly describes Real2Sim physical
  values, validation against real objects, and confidence. Its public material is a product
  reference, not enough methodology to reproduce the pipeline.
- [Scalable Real2Sim](https://scalable-real2sim.github.io/) and its
  [repository](https://github.com/nepfaff/scalable-real2sim) provide the stronger technical
  reference: separate visual/collision geometry, instrumented interaction, system
  identification, and real/sim validation.
- [World Labs Real-to-Sim-to-Real](https://www.worldlabs.ai/blog/real-to-sim-to-real)
  motivates observation, outcome, failure-region, and policy-ranking validation.
- [NVIDIA on visual and collider separation](https://developer.nvidia.com/blog/simulate-robotic-environments-faster-with-nvidia-isaac-sim-and-world-labs-marble/)
  reinforces the need for distinct appearance and physics assets.
