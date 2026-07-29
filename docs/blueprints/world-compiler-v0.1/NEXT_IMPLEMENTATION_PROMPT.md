# Next Implementation Prompt

You are working in the public World Studio and Capture Splat repositories. Read this
blueprint, the active live-session contracts, both repository contribution guides, and the
current roadmap before editing.

Implement **M1 Authenticated LAN And Progressive World** in small reviewable PRs. Do not
redo M0.

## Required Sequence

1. Specify authenticated discovery and pairing:
   - Bonjour discovery on the local network;
   - QR or short-code pairing;
   - authenticated TLS with explicit device and desktop identities;
   - revocation and session expiry;
   - no public or wildcard listener by default.
2. Add a bounded Capture Splat sender:
   - durable phone write before enqueue;
   - queue and byte budgets;
   - backpressure that never changes capture acceptance;
   - ACK, resume, retry, and final reconciliation using the active three-schema contract;
   - thermal, queue, and transfer events in capture metadata.
3. Extend World Studio progressive evidence:
   - source RGB, camera, quality, optional depth/confidence/masks, and bounded mesh proposals;
   - explicit source, checksum, coordinate frame, and proposal authority;
   - no mutation of the loaded world.
4. Add an isolated worker lifecycle:
   - capabilities, start/stop/retry, resource budget, input/output hashes, and logs;
   - no i3dgs, LingBot, Isaac, CUDA, or reconstruction dependency in receiver core;
   - workers cannot overwrite Capture Splat or promoted metric authority.
5. Validate two physical-device cycles:
   - disconnect/reconnect and receiver restart;
   - bounded memory and storage;
   - no capture throughput regression beyond the accepted threshold;
   - thermal downgrade and successful finalization;
   - deterministic reconciled manifests.

## Constraints

- Capture Splat remains local-first and authoritative for accepted evidence.
- Use the active contracts under `/contracts/live-session/v0.1`; never import the archived
  single-schema draft from this blueprint.
- Preserve World Studio's six modes and Spark + Three.js + Rapier local runtime.
- Streamed output remains proposal-only. It is not reconstruction, collision, measurement,
  semantic, navigation, or physics authority.
- Keep generated captures, models, logs, and worker outputs outside Git.
- Do not vendor external reconstruction or simulator repositories.

## Required Evidence

- Positive and negative protocol tests for authentication, expiry, replay, corruption,
  traversal, duplicate conflict, resume, and finalization.
- iPhone queue, thermal, writer-drop, and finalization reports.
- Desktop receiver persistence and restart tests.
- Browser/Electron UI tests showing proposal labels and no loaded-world replacement.
- Byte-identical mirrored contracts.
- A concise migration note and reproducible validation report.
