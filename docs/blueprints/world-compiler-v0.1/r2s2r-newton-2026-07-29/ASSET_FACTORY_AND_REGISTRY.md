# Physics Asset Factory And Registry

The Physics Asset Factory converts object evidence into versioned assets whose visual,
metric, collision, semantic, articulation, and physical layers remain separate.

## Asset Maturity

| Level | Evidence and permitted use |
|---|---|
| A0 Visual | Appearance proposal only |
| A1 Metric | Direct dimensions and registered scale |
| A2 Collision | Effective collider validated against metric evidence |
| A3 Rigid Physics | Task-scoped mass, center of mass, inertia, and contact estimates |
| A4 Articulated Or Compliant | Joint, brake, wheel, stiffness, or damping evidence |
| A5 Task Validated | Held-out real/sim trials improve over defaults |
| A6 Deployment Validated | Field Episodes remain inside a monitored envelope |

## Physics Asset Passport

Each version records:

- source evidence and hashes;
- visual, metric, collision, semantic, and part/articulation layers;
- units, frames, bounds, uncertainty, and lineage;
- parameter values, ranges, source class, apparatus, solver, and contact-model scope;
- Newton/OpenUSD variants and importer capability reports;
- train/holdout split, residuals, baseline comparison, and decision;
- approved and prohibited tasks;
- freshness and revalidation triggers.

## Reference Assets

### Upholstered Chair

Measure and validate dimensions, mass, floor friction, center of mass, push/tip response,
seat stiffness/damping, collision fit, and held-out behavior.

### Unoccupied Wheelchair

Objectize frame, rear wheels, caster forks/wheels, brakes, footrests, armrests, and
cushions. Measure geometry, mass distribution, rolling resistance, caster response, brake
force, threshold behavior, and controlled load-fixture variants.

The initial scope explicitly excludes occupant biomechanics, medical certification, and
human-safety claims.

## Registry

Maintain immutable source, private calibrated, and promoted deployment registries. Public
assets may contain only evidence and licensing approved for redistribution.
