# Architecture

World Studio is a shared web/desktop app:

- `apps/web` is the browser-capable Vite/React app.
- `apps/desktop` is the Electron shell for local filesystem, packaged desktop builds, and
  future native proof capture.
- `packages/design-system` owns the World Studio CSS tokens and reusable HUD primitives.
- `packages/world-core` owns shared types and compatibility contracts.
- `packages/artifacts` owns PLY/OBJ/JSON/Budo package ingestion and validation.
- `packages/renderer` owns the renderer adapter contract and current canvas fallback.

## Live Capture Boundary

The Electron main process owns the Phase 1 Capture Splat receiver. It listens on
`127.0.0.1` only after an explicit renderer action and uses pure Node HTTP, contract,
and store modules so durability and corruption behavior can be tested without Electron.

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

Phase 1 transports source evidence. It does not run or claim live 3D Gaussian Splatting.

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
