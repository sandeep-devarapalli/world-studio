# Newton Migration Milestones

Newton migration proceeds beside M1-M4 and becomes the M5 product gate. Rapier removal is
the end of the migration, not its first step.

## N0 Decision And Fixtures

- Freeze new Rapier-specific product work.
- Capture accepted fixtures for spawn, walk, fly, prop bodies, contacts, collision debug,
  reset, deterministic Episode replay, and unavailable-state UI.
- Define capability, solver-profile, job, state, contact, sensor, and failure proposals.
- Record the current Rapier behavior without promoting it as physical truth.

Exit: fixtures and proposal contracts are reviewable and checksum-bound.

## N1 Solver-Neutral Client

- Introduce a TypeScript `SimulationClient` boundary.
- Move React components away from direct Rapier access.
- Keep the current Rapier implementation behind a temporary adapter.
- Preserve deterministic Episode ordering and current visual behavior.

Exit: existing tests pass through the neutral client.

## N2 Worker Supervisor

- Add an Electron-owned Python worker supervisor.
- Implement capability negotiation, safe job roots, health, startup timeout, bounded logs,
  ordered state, cancellation, retry, and crash recovery.
- Keep browser-only builds functional with an explicit unavailable state.

Exit: a fixture worker passes protocol, corruption, traversal, timeout, and restart tests.

## N3 Local Newton CPU Parity

- Pin Newton 1.4.0 and dependencies in an isolated worker environment.
- Compile a small fixture World into Newton.
- Reproduce spawn, movement, collision, reset, props, sensors, and Episode replay on macOS
  CPU.
- Compare state trajectories and task outcomes, not just screenshots.

Exit: local parity gates pass or remain documented `hold`.

## N4 Remote Newton CUDA Conformance

- Run the same jobs on a pinned Linux/NVIDIA worker.
- Compare CPU and CUDA state, contacts, sensors, timing, and determinism.
- Validate effective colliders for the indoor navigation reference world.
- Benchmark bounded parallel evals without changing task semantics.

Exit: one promoted rigid profile has reproducible local and remote evidence.

## N5 Product Cutover

- Switch Simulate, Pilot, and Episode physics state to Newton.
- Make unavailable-worker behavior fail closed.
- Remove Rapier package dependencies, runtime classes, tests, labels, and bundle chunks.
- Retain historical fixtures only as migration evidence.

Exit: no product path selects or silently falls back to Rapier.

## N6 Isaac Lab Newton And ROS Conformance

- Compile the same World/Asset/Robot/Task versions into Isaac Lab Newton.
- Compare state, contacts, sensor timing, frames, and task outcomes with standalone Newton.
- Add Isaac RTX, Isaac Sim, and ROS 2 only as separately capability-tested adapters.

Exit: each adapter has a conformance report and prohibited-use list.

## N7 Calibrated R2S2R

- Bind Newton profile and exact versions into Asset Passports, Real2Sim Promises, Eval
  reports, Deployments, and field Episodes.
- Require held-out physical trials and improvement over defaults.
- Trigger revalidation when worlds, assets, robots, sensors, tasks, policies, Newton, Warp,
  solver profiles, or collision pipelines change.

Exit: one deployment is physics-calibrated within a validated task envelope.
