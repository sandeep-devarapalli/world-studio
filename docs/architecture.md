# Architecture

World Studio is a shared web/desktop app:

- `apps/web` is the browser-capable Vite/React app.
- `apps/desktop` is the Electron shell for local filesystem, packaged desktop builds, and
  future native proof capture.
- `packages/design-system` owns the World Studio CSS tokens and reusable HUD primitives.
- `packages/world-core` owns shared types and compatibility contracts.
- `packages/artifacts` owns PLY/OBJ/JSON/Budo package ingestion and validation.
- `packages/renderer` owns the renderer adapter contract and current canvas fallback.

## Live Capture And Security Boundary

The Electron main process owns the Capture Splat transport. M0 remains a plaintext HTTP
receiver restricted to `127.0.0.1` or `::1`; environment configuration cannot widen it.
It starts only after an explicit renderer action and uses pure Node HTTP, contract, and
store modules so durability and corruption behavior can be tested without Electron.

M1 adds a separate secure local-network boundary rather than weakening the M0 bind guard.
The user must explicitly choose one enumerated interface and begin pairing. A short-lived QR
offer identifies this Mac and pins its self-signed TLS certificate. Bonjour publishes the
allowlisted `_capturesplat._tcp` registration through `/usr/bin/dns-sd`; it never browses for
or trusts discovered host data, and its TXT records contain no invitation secret.

The desktop identity is a P-256 key protected by the Electron/macOS secret-storage boundary.
Its self-signed certificate is issued through the absolute `/usr/bin/openssl` system tool.
A pairing request proves possession of both the QR invitation and the iPhone's P-256 device
key. Paired LAN requests use P-256 ES256/P1363 signatures binding the grant, method, exact
path, content metadata, body SHA-256, and an unsigned 64-bit request counter. The paired
device registry persists the highest counter and a 256-bit sliding replay bitmap per grant:
previously unseen out-of-order counters inside the window are accepted once, while
duplicates and counters older than the window fail across receiver restart. `request_id` is
correlation metadata, not replay authority. Credential expiry and explicit revocation are
checked independently.

Only the pairing exchange is reachable before pairing succeeds. Live-session routes become
available on the selected interface only through pinned TLS and successful device
authentication. The authenticated gateway delegates to the same receiver/store boundary as
loopback, so checksum, ACK, duplicate, gap, resume, and finalization semantics do not fork.

Live sessions are stored under:

```text
app.getPath("userData")/live-sessions/<session-id>
```

Tests inject temporary roots. Uploads stream into `.incoming`, are hashed and fsynced,
then become authoritative only after an atomic rename into
`frames/<eight-digit-sequence>`. Receiver-owned filenames prevent uploaded paths from
choosing storage locations. On restart, committed frame directories are recovered and
stale partial uploads are discarded.

The preload bridge exposes start, stop, status, update subscription, and bounded
on-demand preview operations. The renderer keeps a separate `LiveSessionSnapshot`; it
never mutates or replaces `WorldSession`. Camera motion is shown as gap-aware top-down
X/Z evidence rather than being overlaid onto an unrelated loaded world. A finalized
`capture-splat.world-studio.json` can be opened later only through the existing explicit
package action.

M1 security state is also separate from `WorldSession` and `LiveSessionSnapshot`. Pairing or
receiving evidence cannot replace a loaded world. All streamed evidence remains
`proposal_only`.

This checkpoint does not modify the Capture Splat iPhone capture loop, implement the bounded
iPhone store-and-forward sender, or run live 3D Gaussian Splatting. Reconstruction workers
remain optional external processes. Physical Bonjour discovery, macOS firewall/local-network
permission, Wi-Fi interruption, receiver restart, and two complete iPhone capture cycles are
deferred acceptance gates.

## World Compiler Boundary

The [World Compiler Blueprint](blueprints/world-compiler-v0.1/README.md) defines the target
ownership model:

- Capture Splat owns immutable source evidence and capture decisions.
- World Studio owns world versions, coordinate frames, units, provenance, uncertainty,
  edits, readiness, robot/task profiles, adapters, and Episodes.
- Spark + Three.js + Rapier provides local visual composition and preview execution.
- Isaac, ROS 2, reconstruction, and future simulator backends run through external,
  capability-reporting workers.

The canonical World Package is still a proposal. Existing local package and Episode
contracts remain active until a runtime migration and round-trip path is implemented.

## Physical Asset Calibration Boundary

[Physical Asset Calibration](blueprints/world-compiler-v0.1/PHYSICAL_ASSET_CALIBRATION.md)
spans Edit, Sensors, Simulate, and Episode. Passive Capture Splat evidence can create C0
visual and geometry proposals. Physical parameters require calibrated apparatus,
instrumented experiments, uncertainty, held-out real/sim validation, and task-scoped
promotion.

Visual, metric, collision, semantic, and physics representations may share transforms, but
one role never gains another role's authority automatically.

## Renderer Boundary

The renderer contract intentionally matches the prototype's `ws-render.js` behavior while
making it typed:

- render modes: `splat`, `points`, `mesh`, `semantic`, `depth`
- selection/deletion masks
- semantic class isolation
- exposure and density controls
- ground grid, camera frustums, agent marker, trajectory breadcrumbs
- screen-space radius picking
- screenshot capture

Spark + Three.js should replace the canvas fallback behind this boundary. Rapier should
enter through a simulation service, not by coupling physics directly to React components.

## Loading Boundary

Startup remains blank. A load action creates a `WorldSession` with provenance:

- source kind
- loaded-via path
- primary artifact
- companion artifacts
- point counts and bounds where known
- proposal/verified status where applicable

No loader may promote a rendered visual to metric or safety authority by default.
