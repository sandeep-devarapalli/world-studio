# Eval Studio

Eval Studio determines whether a simulated World supports the same engineering decisions
as physical trials. Exact aggregate success rates need not match, but ranking, failure
regions, improvement direction, and critical safety outcomes must be useful.

## Proposed Records

- eval suite and case;
- eval run and report;
- policy artifact and embodiment adapter;
- variation set;
- promotion decision.

These remain design proposals until runtime schemas and migrations exist.

## Reproducibility

Every run binds exact World, Asset, Robot, Sensor, Task, Policy, Newton, solver profile,
device, seed, variation, and evidence hashes.

## Variation Dimensions

- initial state and object layout;
- clutter, lighting, viewpoint, and sensor noise;
- latency, calibration, and robot state;
- physical-parameter uncertainty;
- environment revision and task difficulty;
- compatible embodiments.

## Metrics

**Task:** success reason, completion, collisions, contacts, no-go violations, recovery,
energy, and duration.

**Real/sim alignment:** observation, trajectory, pose, state, contact, force, and outcome
residuals.

**Predictivity:** policy rank correlation, improvement-direction agreement, failure-region
overlap, critical-failure recall, false-safe rate, and regression detection.

## Decisions

`reject`, `shadow`, `canary`, `promote`, and `rollback` are operational decisions. Each
decision includes evidence, uncertainty, threshold version, approver, and prohibited use.
