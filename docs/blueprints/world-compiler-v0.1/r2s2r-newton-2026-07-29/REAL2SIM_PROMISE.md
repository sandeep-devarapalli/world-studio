# Real2Sim Promise

A Real2Sim Promise is a versioned certificate describing the task-relevant observations
and dynamics a World has demonstrated, plus what remains unknown.

It is not a general claim that the simulation is physically accurate.

## Bound Versions

Every Promise binds exact:

- World, Asset, Robot, Sensor, Task, Policy, and Eval versions;
- evidence and calibration reports;
- Newton, Warp, MuJoCo, solver-profile, contact-pipeline, device, timestep, substeps, seed,
  and capability report;
- coordinate frames, units, effective collider, and source hashes;
- train, calibration, and held-out trials.

## Required Fields

- operating envelope and task metrics;
- observed evidence, exclusions, and known unknowns;
- observation, trajectory, contact, state, and outcome residuals;
- uncertainty and confidence intervals;
- failure regions and false-safe cases;
- `approved_for` and `not_approved_for`;
- freshness, expiry, and revalidation triggers;
- `promote|hold|reject`.

## Promise Levels

| Level | Permitted claim |
|---|---|
| P0 | Evidence reconciled; no metric or physics claim |
| P1 | Metric frame and direct dimensions validated |
| P2 | Visual, metric, and effective collision geometry aligned |
| P3 | Indoor navigation/task geometry validated |
| P4 | Robot and sensor conformance demonstrated |
| P5 | Matched open-loop observations and state transitions demonstrated |
| P6 | Held-out task dynamics improve over simulator defaults |
| P7 | Simulated eval preserves useful policy ranking and failure regions |
| P8 | Deployment predictivity is monitored and refreshed from field evidence |

A higher level inherits the lower-level evidence but remains scoped to the named task and
operating envelope.

## Revalidation

Invalidate or hold a Promise when any bound world, asset, robot, sensor, task, policy,
solver profile, collision representation, calibration, or runtime version changes, or when
field evidence leaves the validated envelope.
