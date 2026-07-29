# R2S2R Operations

## Closed Loop

```text
field Episode or targeted recapture
 -> classify environment, asset, sensor, robot, task, controller, or policy mismatch
 -> replay against the exact Deployment Twin
 -> propose World, Asset, calibration, Task, or Policy update
 -> rerun impacted and global safety evals
 -> shadow
 -> canary
 -> promote, hold, or roll back
 -> monitor and repeat
```

Field evidence never overwrites prior versions. Every update creates a child version with
lineage, hashes, change reason, affected gates, and revalidation status.

## Six-Mode Mapping

| Mode | R2S2R responsibility |
|---|---|
| View | World freshness, revisions, uncertainty, and change overlays |
| Edit | Objectization, parts/joints, delta review, and reversible promotion |
| Simulate | Compile, physics trials, variations, and eval jobs |
| Pilot | Matched open-loop scripts, teleoperation, and initial-state alignment |
| Sensors | Apparatus, robot/sensor, clock, and residual calibration |
| Episode | Real/sim pairs, failure regions, policy ranking, deployments, canary, and rollback |

## First Complete Demonstration

Use one furnished room, one vacuum or AMR, one upholstered chair, and one unoccupied
wheelchair:

1. Capture a baseline with Capture Splat.
2. Compile Gaussian appearance plus metric and collision layers.
3. Validate one Newton rigid profile and robot/sensor route.
4. Produce Asset Passports and a P3/P4 Real2Sim Promise.
5. Evaluate three policy/controller checkpoints with seeded variations.
6. Run a physical deployment.
7. Move the wheelchair or change one obstacle.
8. Perform a targeted Capture Splat recapture.
9. Create World v2 and mark affected Promises stale.
10. Rerun impacted evals, canary, and promote or roll back.

This demonstrates the operating loop. It does not establish universal physical accuracy.
