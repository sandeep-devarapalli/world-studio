# Deployment Twin

A Deployment Twin binds a physical site and robot deployment to exact World, Asset, Robot,
Sensor, Task, Policy, Promise, Eval, and calibration versions.

## Immutable Records

- deployment and site revision;
- zone-level freshness;
- field Episode and incident;
- change proposal and impact graph;
- canary, promotion, and rollback decision.

## Change Classes

Keep four causes separate:

1. transient state or movable clutter;
2. structural environment or asset change;
3. robot or sensor change;
4. task, controller, or policy change.

## Recapture

Capture Splat may create a deployment-recapture package tied to the existing site and zone.
It supplies relocalization evidence, before/after anchors, coverage, source hashes, and
changed/unchanged/unknown proposals. It never mutates the prior World.

Failed relocalization or out-of-envelope evidence remains `hold`.

## Operations

- scheduled or incident-triggered recapture;
- sentinel routes and field Episodes;
- immutable World/Asset deltas;
- impact analysis for routes, tasks, assets, Promises, and eval suites;
- shadow replay;
- bounded canary;
- explicit rollback criteria.

World freshness is evidence-backed per zone. A stale or unknown zone cannot silently retain
deployment approval.
