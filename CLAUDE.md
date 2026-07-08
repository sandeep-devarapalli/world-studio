# World Studio: Claude Code Handoff

You are working in `/Users/dev/Desktop/world-studio` for
`sandeep-devarapalli/world-studio`.

World Studio is a pnpm monorepo:

- `apps/web`: React/Vite browser app
- `apps/desktop`: Electron desktop shell
- `packages/design-system`: World Studio tokens and HUD primitives
- `packages/renderer`: three.js + Spark renderer boundary
- `packages/world-core`: typed contracts
- `packages/artifacts`: PLY/OBJ/manifest/package readers

The current UI still needs to become more design-faithful. Do not treat this as generic
dashboard polish. The target is a full-bleed world editor with floating instruments over a
3D world.

## Read First

Read these before planning or editing:

1. `AGENTS.md`
2. `docs/extracted-prototype/AGENTS.md`
3. `docs/extracted-prototype/codex.md`
4. `docs/extracted-prototype/design.md`
5. `docs/extracted-prototype/ws-styles.css`
6. `docs/extracted-prototype/ws-panels.jsx`
7. `docs/extracted-prototype/ws-app.jsx`
8. `docs/extracted-prototype/ws-studio.jsx`
9. `docs/extracted-prototype/ws-artboards-a.jsx`
10. `docs/extracted-prototype/ws-artboards-b.jsx`
11. `docs/extracted-prototype/reference/*.png`
12. `docs/source-materials/world-studio-development.txt`
13. `docs/source-materials/README.md`
14. `docs/source-materials/budo_studio_electron_handoff.md`
15. `docs/architecture.md`
16. `docs/data-contracts.md`

The archived originals are:

- `docs/source-materials/World Studio.zip`
- `docs/source-materials/World studio development.docx`

Use them if extracted files are unclear.

## Design Rules

- Preserve the six modes exactly: View, Edit, Simulate, Pilot, Sensors, Episode.
- Preserve explicit startup. Do not silently auto-load local artifacts.
- Every loaded dataset must show package kind, source path, loaded-via path, primary
  artifact, companion artifacts, and status/provenance.
- Keep ordinary PLY and Gaussian/splat PLY routes separate.
- Keep proposal, verified, and external-validation states explicit.
- Keep Budo-compatible package readers generic enough for World Studio and other layouts.
- Keep Apache-2.0 compatibility. Do not copy GPL or proprietary runtime code into shipped
  source.
- Use design tokens/classes from `packages/design-system`; new classes use the `ws-`
  prefix.
- Accent color is only for active, selected, recording, playhead, agent, and primary
  actions.
- Panels anchor to the slots in `design.md` section 5. Do not invent new anchor positions.
- Keep the 1920x1080 frame and uniform scaling. No reflow into a dashboard layout.
- No decoration, filler stats, emoji, entrance animations, or explanatory tutorial prose in
  the app.
- Destructive operations are undoable, history-logged, and disabled when inapplicable.

## Current Branch Stack

As of the latest local fetch, `main` is at PR #18. The following Claude branches exist and
may be stacked but not yet merged into `main`:

1. `claude/objective-satoshi-83831b`
   - Commit: `27fa60f`
   - Restores stage letterbox scaling and prototype mode chrome.
2. `claude/ws-mode-instruments`
   - Commit: `df4568d`
   - Adds per-mode instruments from the design prototype.
3. `claude/ws-ui-polish`
   - Commit: `249724b`
   - Adds resize regression coverage and tightens accent budget.
4. `claude/ws-edit-tools`
   - Commit: `bf60fa3`
   - Makes brush ring and rect select real in Edit mode.

Before starting work, verify whether these are already merged or still stacked:

```bash
git fetch --all --prune
git log --oneline --all --decorate -12
git branch -a
```

If the stack has been merged, branch from `main`. If it is still unmerged, branch from
`claude/ws-edit-tools` unless explicitly told otherwise. Do not redo work already present
on those branches.

## Current Implementation Files

Inspect the current branch you are building from. Depending on whether the Claude stack is
merged, key files may include:

- `apps/web/src/App.tsx`
- `apps/web/src/instruments.tsx`
- `apps/web/src/styles.css`
- `packages/design-system/src/primitives.tsx`
- `packages/design-system/src/world-studio.css`
- `packages/renderer/src/*`
- `packages/artifacts/src/*`
- `packages/world-core/src/*`
- `apps/web/tests/world-studio.spec.ts`

## Next Work Priority

Do the quick diagnostic win first.

### 1. Verify/Fix Spark Gaussian Path

This is worth doing before larger UI/physics work because it may be a small fix with high
visual payoff.

Goal:

- Confirm that `packages/renderer` actually renders `loft_04/gaussians.ply` through Spark
  in `splat` mode.
- Confirm it is not silently falling back to ordinary point-cloud rendering while the UI says
  `three.js · spark path`.
- Preserve ordinary PLY vs Gaussian PLY routing.
- If broken, fix loading, visibility, material scale, camera framing, or route selection.

Expected outcome:

- `splat` mode visibly uses the Gaussian path for `loft_04/gaussians.ply`.
- `points` mode still uses `points.ply`.
- The UI/status label is truthful.
- Add or update a focused test/smoke check if practical.

### 2. Split Physics Work Into Two PRs

Do not attempt the whole spawn-props feature in one large PR.

#### 2A. Physics Step In Renderer/Core First

Goal:

- Integrate `@dimforge/rapier3d-compat` behind an adapter/service boundary.
- Add a deterministic physics step for simple primitives.
- Add renderer support for prop meshes/markers independent of Pilot spawn UI.
- Prefer a simple ground/collision approximation first if OBJ collision-mesh integration is
  too large for one PR.
- Keep React components decoupled from Rapier internals.

Expected outcome:

- A small internal fixture/test can step physics and produce stable prop transforms.
- Renderer can display prop transforms if provided.
- No dead UI panel is introduced.

#### 2B. Pilot Spawn UI Second

Goal:

- Add the prototype spawn-props panel in Pilot using `.ws-spawn-grid` from
  `docs/extracted-prototype/ws-artboards-a.jsx`.
- Clicking or dragging a prop spawns a simple primitive in front of the agent.
- Spawned props appear in the world and in the Episode object lane as events.
- Spawn/delete operations are undoable and disabled when inapplicable.

Expected outcome:

- The UI actually spawns props. Do not ship a decorative/dead panel.

### 3. Remaining Edit Tools

Add these as separate small slices:

- Crop box: screen-space or world AABB crop that hides points outside, undoable.
- Transform: move selection.
- Measure: two-click distance in meters with mono readout.

Follow the existing tool-rail pattern in `App.tsx`. Extend `RenderAdapter` with optional
methods when needed, as was done for rect selection.

### 4. Edit Optimize/Publish Parity

Implement only where real data supports it:

- SH degree 0-3 control
- outlier removal
- size estimate
- publish-flow stub with progress

No filler stats.

## Validation For Every PR

Run:

```bash
pnpm typecheck
pnpm test
pnpm test:ui
pnpm desktop:package
```

Visually compare touched modes against:

- `docs/extracted-prototype/reference/01-view.png`
- `docs/extracted-prototype/reference/02-edit.png`
- `docs/extracted-prototype/reference/03-simulate.png`
- `docs/extracted-prototype/reference/04-pilot.png`
- `docs/extracted-prototype/reference/05-sensors.png`
- `docs/extracted-prototype/reference/06-episode.png`

Keep Playwright assertions meaningful. Do not weaken tests to hide regressions.

## Paste-Ready Prompt

```text
We need to continue World Studio UI/feature work in /Users/dev/Desktop/world-studio. Please read CLAUDE.md first, then verify the branch stack. The current priority is not the large spawn-props feature. Do the quick diagnostic win first: verify/fix whether splat mode actually renders loft_04/gaussians.ply through Spark instead of falling back to ordinary point-cloud rendering while the UI claims "three.js · spark path".

Preserve the six modes, explicit startup, provenance display, ordinary PLY vs Gaussian PLY separation, design-system tokens, 1920x1080 stage scaling, and browser/Electron support. Validate with pnpm typecheck, pnpm test, pnpm test:ui, pnpm desktop:package, and visual comparison against docs/extracted-prototype/reference/*.png.

After that, split physics/spawn work into two PRs: first a renderer/core Rapier physics step with prop transforms and no dead UI; second the Pilot spawn-props UI using .ws-spawn-grid, with real spawning, Episode object-lane events, and undoable operations.
```
