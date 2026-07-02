# Architecture

World Studio is a shared web/desktop app:

- `apps/web` is the browser-capable Vite/React app.
- `apps/desktop` is the Electron shell for local filesystem, packaged desktop builds, and
  future native proof capture.
- `packages/design-system` owns the World Studio CSS tokens and reusable HUD primitives.
- `packages/world-core` owns shared types and compatibility contracts.
- `packages/artifacts` owns PLY/OBJ/JSON/Budo package ingestion and validation.
- `packages/renderer` owns the renderer adapter contract and current canvas fallback.

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

