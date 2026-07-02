# AGENTS.md

## Project Rules

- World Studio is Apache 2.0. Do not copy GPL or proprietary runtime code into the shipped
  source tree.
- The design source of truth is `docs/source-materials/World Studio.zip`, especially
  `codex.md`, `design.md`, `ws-styles.css`, and the reference screenshots.
- Preserve the six modes: View, Edit, Simulate, Pilot, Sensors, Episode.
- Startup must be explicit. Do not silently auto-load local artifacts.
- Every loaded dataset must show package kind, source path, loaded-via path, primary
  artifact, point counts or bounds when available, and companion artifacts.
- Keep ordinary PLY and Gaussian/splat PLY routes separate.
- Visual/proposal/verified/external-validation states must stay explicit in the UI and data
  contracts.
- Use the design tokens and component classes in `packages/design-system`; do not create a
  separate visual language.
- Destructive operations must be undoable and disabled when not applicable.

## Commands

```bash
pnpm install
pnpm dev
pnpm desktop:dev
pnpm test
pnpm typecheck
pnpm test:ui
```

## Upstream References

Local upstream clones live in ignored `references/upstream/`. Track source URL, license,
commit, and usage decision in `docs/upstreams.md` instead of vendoring code casually.

