# Contributing to World Studio

World Studio turns captured evidence and derived reconstruction proposals into reviewable,
versioned worlds. Contributions are welcome across capture handoff, world data, editing,
rendering, simulation, sensors, validation, and external-worker integration.

## Start With An Issue

Use the issue form that best matches the work:

- **Implementation:** a bounded code or documentation change.
- **Validation evidence:** reproducible evidence for an existing capability or gate.
- **Upstream evaluation:** assessment of an external project, library, model, or dataset.
- **Roadmap proposal:** a new outcome, milestone, or cross-cutting workstream.

Every issue must identify:

- the target milestone and affected area;
- dependencies or `None`;
- testable acceptance gates;
- the evidence needed to support any resulting claim;
- explicit non-goals and authority boundaries.

Keep pull requests focused. Separate implementation, generated evidence, dependency adoption,
and broad roadmap changes when they can be reviewed independently.

## Product And Runtime Boundaries

Preserve World Studio's six modes:

- **View:** inspect source evidence and world representations.
- **Edit:** perform reversible world and asset edits.
- **Simulate:** run local or external simulation proposals.
- **Pilot:** inspect embodiment and control workflows.
- **Sensors:** configure and compare sensor models and observations.
- **Episode:** group runs, holdouts, decisions, and immutable evidence.

Do not introduce a seventh mode for a subsystem that belongs inside these workflows.

Preserve the current and target runtime boundaries:

- **Spark** renders Gaussian splat proposals.
- **Three.js** provides scene, camera, and editor composition.
- **Rapier** currently provides local rigid-body and collision simulation. It is the
  feature-frozen parity baseline for the approved migration.
- **Newton** is the target physics runtime through a supervised worker. It is not yet an
  implemented product dependency.
- External workers such as reconstruction or simulator services remain explicit, optional
  processes with versioned inputs and outputs.

A change to these boundaries must follow the
[Newton migration gates](docs/blueprints/world-compiler-v0.1/r2s2r-newton-2026-07-29/NEWTON_MIGRATION_MILESTONES.md),
with compatibility tests and a rollback path. Do not add a silent Rapier fallback after
Newton cutover.

## Authority Language

Use wording that matches the evidence:

- Source frames and sensor records are **capture evidence**.
- Reconstructed points, meshes, splats, semantics, and inferred parameters are **proposals**
  until their declared gates pass.
- A visually plausible Gaussian splat is not automatically measurement, collision, semantic,
  navigation, or physics authority.
- A finite artifact or successful viewer load proves only that bounded check.
- Physics results should be described as **physics-calibrated within a validated task
  envelope** only when held-out real/sim evidence supports that statement.
- Use `hold` or `reject` when evidence is missing or fails; do not soften a failed gate into a
  quality claim.

Document the authority gained by a change and, just as importantly, the authority it does not
gain.

## Reproducible Validation

Validation evidence should include:

- repository commit and working-tree state;
- operating system, architecture, device, browser, and relevant GPU/runtime versions;
- exact commands and configuration;
- fixture or dataset identifier with provenance;
- expected gates and actual results;
- checksums for external artifacts;
- warnings, failures, regressions, and excluded samples;
- a final `promote`, `hold`, `reject`, or `informational only` decision.

Store generated captures, trained models, Gaussian or point-cloud outputs, simulator outputs,
episodes, videos, renders, traces, and large logs outside Git. Link them from the issue or pull
request using a durable location, content checksum, schema/version, and reproduction commands.
Do not add these generated artifacts through Git LFS as a workaround.

Small deterministic fixtures may be committed only when they are purpose-built for tests,
reviewable, license-compatible, and contain no private source data.

Run the checks relevant to the change. The full local validation set is:

```bash
pnpm typecheck
pnpm test
pnpm validate:blueprint
pnpm test:live-e2e
pnpm test:ui
pnpm desktop:package:smoke
git diff --check
```

Report any check that was not run and why.

## Upstream Evaluation

Before proposing an external dependency, model, dataset, or code reference, record:

- canonical source URL;
- exact commit, tag, model revision, or dataset version;
- license identifier and license source;
- paper or primary documentation reviewed;
- intended use: research reference, optional tool, external worker, build dependency, runtime
  dependency, model, or dataset;
- transitive license, platform, security, maintenance, and distribution implications;
- compatibility with the six modes, Spark/Three.js visual boundary, and solver-neutral
  Newton target architecture;
- adoption, defer, research-only, or reject decision with acceptance gates.

Do not copy GPL, proprietary, or license-unclear code into the Apache-2.0 runtime. Research
inspiration must remain clean-room: cite the source and explain the independently designed
behavior. Pin optional upstream tools and keep them outside the shipped source tree unless a
separate adoption review approves otherwise.

## Data, Privacy, And Repository Hygiene

- Use relative paths in public manifests and examples.
- Never commit credentials, tokens, personal captures, private machine paths, or populated
  environment files.
- Validate paths, checksums, duplicate IDs, missing data, and non-finite numeric values at
  trust boundaries.
- Preserve source provenance and make destructive edits reversible.
- Keep captures, models, caches, build products, run directories, and simulator output out of
  Git.
- Do not silently fall back to a different artifact, renderer, dataset, or authority class.

## Pull Requests

A pull request should:

1. Link its issue and milestone.
2. Explain the bounded outcome and non-goals.
3. Identify affected modes, contracts, and runtime boundaries.
4. Include acceptance-gate results and reproducible evidence links.
5. Call out compatibility, migration, security, license, and authority implications.
6. Avoid unrelated refactors or generated artifacts.

Commit messages should explain why the change is needed. Reviewers may keep work on hold until
its required physical, device, rendering, or simulation evidence is available.
