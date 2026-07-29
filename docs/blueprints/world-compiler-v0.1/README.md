# World Compiler Blueprint v0.1

World Studio is the compiler between captured reality and task-scoped simulation. Capture
Splat records evidence; World Studio preserves provenance, coordinates, versions, edits,
readiness decisions, and simulator adapters.

This publication reconciles a supplied planning bundle with the implementation on `main`.
It is not a claim that every proposed subsystem exists.

## Authority Boundary

- Capture Splat RGB-D, poses, intrinsics, masks, video, mesh, and RoomPlan outputs are
  evidence.
- Gaussian splats are appearance proposals.
- Metric geometry, collision, navigation, semantics, and physical parameters require
  separate artifacts and promotion gates.
- A finite asset, successful load, or visually plausible replay is necessary evidence, not
  proof of reconstruction quality or simulation validity.
- Public physical claims use "physics-calibrated within a validated task envelope."

## Publication Layers

- [`ADOPTION_STATUS.md`](ADOPTION_STATUS.md) records what is completed, partial, planned, or
  evidence-blocked.
- [`MILESTONES.md`](MILESTONES.md) defines the public delivery sequence.
- [`PHYSICAL_ASSET_CALIBRATION.md`](PHYSICAL_ASSET_CALIBRATION.md) defines C0-C5 evidence
  tiers and promotion rules.
- [`NEXT_IMPLEMENTATION_PROMPT.md`](NEXT_IMPLEMENTATION_PROMPT.md) is the current actionable
  handoff.
- [`r2s2r-newton-2026-07-29/`](r2s2r-newton-2026-07-29/) reconciles the supplied R2S2R
  research and defines the gated Newton target architecture.
- [`SOURCE_BRIEF.md`](SOURCE_BRIEF.md) is the repository-linked version of the supplied
  proposal.
- [`source/`](source/) preserves every extracted source file unchanged.
- [`SOURCE_MANIFEST.sha256`](SOURCE_MANIFEST.sha256) pins the preserved source bytes.
- [`proposals/`](proposals/) contains design-draft schemas and examples that are not runtime
  contracts.

## Contract Status

The active Capture Splat transport contract is the three-schema session/frame/ACK contract
under [`/contracts/live-session/v0.1`](../../../contracts/live-session/v0.1). Capture Splat
owns the canonical copy; World Studio mirrors it byte-for-byte.

The single supplied `capture_splat.live_session.v0.1` schema is incompatible with that
implemented contract. It remains only in
[`source/contracts/`](source/contracts/) as provenance and must not be imported by runtime
code.

`world_studio.world.v0.1`, `isaac_job.v0.1`, and the Physical Asset Calibration contracts
remain under [`proposals/contracts/`](proposals/contracts/) until runtime adoption,
migration, and round-trip tests exist. Isaac runtime versions belong in job capability
data, not schema enums.

## Runtime Boundary

Spark + Three.js remains the visual browser/Electron runtime. Rapier remains the active
simulation implementation only while solver-neutral and Newton parity gates are built.
Newton is the target physics runtime through a supervised Python worker; it is not yet an
implemented dependency. Isaac Lab Newton, Isaac RTX, Isaac Sim, and ROS 2 remain external,
capability-tested adapters.

The migration ends by removing Rapier after parity and cutover. It does not retain a silent
fallback or two competing physics authorities. This blueprint preserves the six World
Studio modes: View, Edit, Simulate, Pilot, Sensors, and Episode.
