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
- [`r2s2r-newton-2026-07-29/`](r2s2r-newton-2026-07-29/) preserves the original Newton
  adoption research and defines its place in the gated capability-routed architecture.
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

The two historical `world_studio.world.v0.1` drafts remain proposal/provenance material.
The first active canonical graph uses `world_studio.world.v0.2` together with Asset v0.1
and Delta v0.1 under [`/contracts/world-graph/v0.1`](../../../contracts/world-graph/v0.1).
Its pure Node store atomically persists immutable revisions and rehashes their complete
referenced Asset closure on recovery and reopen. Electron/package-reader integration,
historical-package migration, and edit execution remain incomplete. `isaac_job.v0.1` and
the Physical Asset Calibration contracts remain under
[`proposals/contracts/`](proposals/contracts/) until runtime adoption, migration, and
round-trip tests exist. Isaac runtime versions belong in job capability data, not schema
enums.

## Runtime Boundary

Spark + Three.js remains the visual browser/Electron runtime. Rapier remains active only
while solver-neutral worker parity gates are built. Newton is the default OpenUSD/general
runtime; SuperDex is the contact-rich specialist. Both run through separate supervised
workers selected by explicit capabilities. Isaac Lab Newton, Isaac RTX, Isaac Sim, and ROS 2
remain external, capability-tested adapters.

The migration ends by removing Rapier after parity and cutover. An explicit backend request
never falls back to another engine, and each result retains its backend/task authority. This
blueprint preserves the six World Studio modes: View, Edit, Simulate, Pilot, Sensors, and
Episode.
