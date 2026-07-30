# Capture Splat Live Session Phase 1

This ledger tracks the replay-first path from Capture Splat to World Studio. It is
separate from the metric-handoff phases in `3dgs_walkthrough_measurement_plan.md`.

## Scope

- Loopback HTTP only, bound to `127.0.0.1`.
- Explicit listen/stop controls in the Electron app.
- Source RGB, calibration, camera pose, tracking, quality, and optional depth,
  confidence, and mask evidence.
- Durable out-of-order receipt, duplicate detection, restart recovery, resume, and
  checksum-bound finalization.
- Proposal-only source previews and a gap-aware top-down camera trajectory in Simulate.
- A finalized static handoff that is never loaded automatically.

Phase 1 does not modify the Capture Splat iPhone capture loop, expose a LAN listener,
train or render a live Gaussian model, replace Spark/Three.js/Rapier, or promote live
evidence to metric or safety authority.

The default port is `43127`. `WORLD_STUDIO_LIVE_PORT` may override it.
`WORLD_STUDIO_LIVE_HOST` remains restricted to `127.0.0.1` or `::1`.
Capture Splat independently accepts `--receiver` or
`CAPTURE_SPLAT_LIVE_RECEIVER`, also restricted to loopback HTTP.

## Acceptance Gates

- [x] Canonical schemas and fixtures mirrored byte-for-byte with pinned fingerprints.
- [x] Traversal, URI, backslash, symlink, non-finite, malformed, and truncated inputs fail.
- [x] Size/checksum corruption and conflicting duplicates fail without replacing evidence.
- [x] Identical duplicates, out-of-order delivery, restart, lost ACK replay, and resume pass.
- [x] Missing-frame finalization fails; complete finalization rehashes and seals atomically.
- [x] Replay order, delay, shuffle, duplicate, disconnect, resume, and summary are deterministic.
- [x] Browser operation remains available without the desktop bridge.
- [x] UI subscription cleanup, bounded previews, counts, state transitions, authority copy,
      and trajectory gaps pass.
- [x] An end-to-end replay finalizes in an ephemeral store and the handoff reopens explicitly.
- [x] Capture Splat and World Studio full repository gates pass with no generated sessions.
- [x] Packaged Electron smoke passes with targeted World Studio window evidence.

## Future Network Boundary

Moving beyond loopback requires an authenticated, paired, TLS-protected LAN transport.
The iOS sender design remains documentation-only in this phase.

## Additive Progressive Session Binding

M1B adds `capture_splat.live_session.v0.2` and
`capture_splat.live_finalize.v0.2` while preserving every v0.1 replay byte and behavior.
The derived v0.2 session identity is immutable before the first frame, the expected count
stays null while recording, and finalization atomically binds the sender-declared
`capture.json` identity together with the final sequence. Receiver restart, missing frames,
conflicting bindings, corrupt publications, and lost final ACKs fail closed or resume
idempotently.

The binding records path, schema, size, and SHA-256 metadata. It is not proof that World
Studio received or rehashed the `capture.json` bytes. The finalized handoff records this as
`source_manifest_verification = "declared_checksum_reference_only"`. This checkpoint does
not connect the sender to the iPhone capture loop or close physical-device acceptance.
