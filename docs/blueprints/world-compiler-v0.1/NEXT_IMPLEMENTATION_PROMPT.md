# Next Implementation Prompt

You are working in the public World Studio and Capture Splat repositories. Read this
blueprint, the active live-session contracts, both repository contribution guides, and the
current roadmap before editing.

Continue **M1 Authenticated LAN And Progressive World** in small reviewable PRs. Do not
redo M0 or replace the M1 desktop security boundary.

## Current Checkpoint

M0 is complete and unchanged. World Studio now has the desktop-side seams for:

- explicit selected-interface pairing rather than a wildcard listener;
- QR invitation state and pinned self-signed TLS identity;
- P-256 desktop/device identities and signed request metadata;
- finite grants with expiry, revocation, and scopes;
- durable unsigned 64-bit request-counter replay defense with a 256-bit sliding window;
- authenticated body-digest binding before delegation to the existing durable M0 store;
- byte-identical Capture Splat-owned live-auth schemas, fixtures, and fingerprints;
- authenticated session receipts linked from finalized handoffs;
- secret-free `_capturesplat._tcp` Bonjour publication through `/usr/bin/dns-sd`.

This is a partial M1 checkpoint. Capture Splat's bounded sender is implemented, but iPhone
live transfer is disabled by default and held as an optional experiment after serious
thermal evidence. The production ingestion path is local Capture Splat finalization,
Manual Export, and explicit World Studio package opening. The progressive evidence
inspector and software-only reconstruction-worker lifecycle are present, but no production
reconstruction runtime is bundled or selected by default.

## Required Sequence

1. Preserve the production manual-export path:
   - reopen finalized Capture Splat packages without a live-session dependency;
   - keep source hashes, cameras, RGB-D, masks, mesh, quality, and provenance intact;
   - make replay and manual import converge on the same proposal-only evidence model.
2. Keep live transport optional and isolated:
   - preserve the implemented durable write-before-enqueue, bounded queues, ACK/resume,
     retry, and reconciliation behavior;
   - never enable it by default on iPhone or make it an M1 dependency;
   - require a separate device-class thermal gate before future promotion.
3. Close the remaining progressive evidence gates:
   - keep the implemented RGB, camera, quality, optional depth/confidence/mask inspector;
   - add mesh or other geometry only through an explicit checksum-bound contract;
   - validate a reviewed external reconstruction worker through the implemented lifecycle;
   - keep every output proposal-only and separate from the loaded world.
4. Preserve the isolated worker lifecycle:
   - keep capabilities, start/stop/retry, requested budgets, input/output hashes, and logs;
   - do not vendor i3dgs, LingBot, Isaac, CUDA, or reconstruction dependencies into the receiver;
   - require separate quality and promotion gates before any output gains additional authority.
5. Validate production package continuity:
   - two manually exported captures reopen deterministically after app restart;
   - bounded memory and storage;
   - successful local finalization and strict manifests;
   - deterministic worker inputs and proposal outputs.

## Constraints

- Capture Splat remains local-first and authoritative for accepted evidence.
- Use the active contracts under `/contracts/live-session/v0.1`; never import the archived
  single-schema draft from this blueprint.
- Preserve World Studio's six modes and current Spark + Three.js + Rapier behavior while
  M1 is active. Do not begin the Newton cutover inside a sender or pairing PR.
- Streamed output remains proposal-only. It is not reconstruction, collision, measurement,
  semantic, navigation, or physics authority.
- Keep generated captures, models, logs, and worker outputs outside Git.
- Do not vendor external reconstruction or simulator repositories.

## Required Evidence

- Positive and negative protocol tests for authentication, expiry, replay, corruption,
  traversal, duplicate conflict, resume, and finalization.
- Strict manual-export and replay evidence that resolve to the same immutable frame,
  camera, quality, and sidecar records.
- iPhone thermal, writer-drop, and finalization reports with live transfer disabled.
- QR, Bonjour, TLS, interruption, and queue evidence only when proposing live transport
  promotion for a specific device class.
- Desktop receiver persistence and restart tests.
- Browser/Electron UI tests showing proposal labels and no loaded-world replacement.
- Byte-identical mirrored contracts.
- A concise migration note and reproducible validation report.

## After M1

The next physics work is the
[gated Newton migration](r2s2r-newton-2026-07-29/NEWTON_MIGRATION_MILESTONES.md): freeze
Rapier-specific growth, preserve parity fixtures, introduce a solver-neutral client, add
the supervised worker, validate local CPU and remote NVIDIA runs, cut over, and remove
Rapier. Keep that work in separate, reviewable PRs.
