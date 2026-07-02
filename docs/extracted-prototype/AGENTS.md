# AGENTS.md — Working in the World Studio design repo

Instructions for AI coding agents (Codex, Claude Code, etc.) and humans contributing to
this repository or building the desktop app from it.

## What this repo is

The **design source of truth** for World Studio, a desktop world rendering & editing
simulator (3DGS editor + embodied-AI simulator + sensor tooling). It is a working
HTML/React prototype, not the production app. Read in this order:

1. `codex.md` — build spec: file map, tokens, component inventory, the six modes, renderer contract.
2. `design.md` — design rationale: why it looks/behaves this way; rules for extending it.
3. `design-system/*.html` — visual reference cards (Colors, Type, Components, Patterns) with exact markup.
4. `World Studio App.html` + `ws-*.jsx/js/css` — the running prototype.

## Run / verify

- No build step. Open `World Studio App.html` in a browser (files must be served or opened
  together — JSX is transpiled in-browser via Babel standalone; React 18.3.1 UMD pinned).
- Verify a change by loading the app and switching all six modes: View, Edit, Simulate,
  Pilot, Sensors, Episode. Check the browser console for errors — it must stay clean.
- Test interactions: orbit-drag any viewport; in Edit, brush-select → Delete → Undo;
  in Pilot, WASD; in Episode, play; in Sensors, toggle channels.

## Repository conventions

- **`ws-styles.css` is the single source of truth for style.** Never inline-style what a
  token or class covers. New classes use the `ws-` prefix; tokens are CSS custom
  properties on `.ws-root`. Derive state colors with `color-mix(in oklab, var(--acc) N%, …)`
  — never hardcode accent-derived hexes.
- Component structure lives in `ws-panels.jsx` (primitives), `ws-artboards-a/b.jsx`
  (mode layouts), `ws-studio.jsx` (Edit mode), `ws-app.jsx` (shell/routing).
  Each `<script type="text/babel">` file has isolated scope — export shared symbols via
  `Object.assign(window, {...})` at the end of the file.
- Never name a shared style object `styles` — collision risk; use a per-component name.
- `ws-render.js` is plain JS (no JSX) — a procedural stand-in renderer. Its API
  (`render`, `renderFeed`, `collectInRadius`, mode strings, overlay options) is the
  contract the real renderer must satisfy. Keep the API stable; swap the internals.
- `tweaks-panel.jsx` is design-review tooling for the prototype only. Never port it to
  production; never remove it from the prototype.
- Persisted keys (localStorage): `ws-app-mode`, `ws-app-vmode`, tweaks state. Don't
  clear or rename without migration.

## Design guardrails (enforced in review)

- Accent (--acc) only for: active/selected, recording, playhead, agent overlays, primary
  actions. One serif mode-title max per screen. Live numbers in IBM Plex Mono.
- Panels float at the anchor slots defined in `design.md` §5; don't invent new anchor
  positions or let panels touch. 1920×1080 frame, uniform scale, no reflow.
- Every destructive action: undoable, history-logged, disabled when inapplicable.
- No decoration, no filler stats, no emoji, no entrance animations.
- New UI = add a card (or extend one) in `design-system/` in the same change.

## Updating docs with code

When you change modes, components, or tokens, update **codex.md** (spec), **design.md**
(if rationale changed), and the relevant `design-system/` card in the same commit.
Docs that lag the prototype are bugs.

## Building the desktop app

Target: macOS-first native (Metal renderer recommended; wgpu acceptable for cross-platform).
Replace `ws-render.js` per the renderer contract (codex.md §7). Bundle the three Google
Fonts (OFL licensed). Borderless window; panels as vibrancy surfaces over the GPU viewport.
Keep the six-mode IA; mode/render/accent/density/panel preferences persist across launches.
