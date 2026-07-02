# World Studio — Codex Handoff

World Studio is a **world rendering and world editing simulator** — a desktop app
(macOS-first) combining a 3D Gaussian Splat editor (SuperSplat-class), an embodied-AI
simulator (AI2-THOR / AirSim-class), and sensor-rig tooling, in one full-bleed window.

This repo contains the **design source of truth**: a working HTML/React prototype plus a
design system. Build the native app to match these files pixel-for-pixel in spirit; the
CSS classes and component structure ARE the spec.

---

## 1. File map

| File | Role |
|---|---|
| `World Studio App.html` | **Main deliverable.** Full app prototype, all 5 modes. Open in a browser. |
| `ws-styles.css` | **The design system stylesheet.** All tokens + every component class. |
| `ws-panels.jsx` | Primitive components: `WSPanel`, `WSPill`, `WSChip`, `WSKey`, `WSSliderRow`, `WSToolRail`, `WSWordmark`, `WSIcon` (icon set), `WSStatusBar`, `WSControlsBar` (per-mode input-bindings capsule; bindings map `WS_CONTROLS`), `WSCanvas` (orbitable viewport). |
| `ws-app.jsx` | App shell: `WSStage` (1920×1080 letterbox scaler), `ModeSwitcher`, `ViewMode` (read-only inspection), `PilotMode` (WASD drive), `ClassLegend`, mode routing + persistence. |
| `ws-studio.jsx` | **Edit mode** (`StudioMode`): brush selection, delete/undo/history, outlier removal, SH-degree & format size estimation, publish flow. |
| `ws-artboards-a.jsx` | `LayoutDual` (Simulate mode), `LayoutCommand` (Pilot chrome), shared fragments: `WorldTree`, `Timeline`, `RigTopology`, `ModeCard`. |
| `ws-artboards-b.jsx` | `ScreenRig` (Sensors mode), `ScreenTimeline` (Episode mode). |
| `ws-render.js` | Procedural stand-in renderer (canvas 2D). **Replace with a real 3DGS/PLY renderer** (e.g. Metal/wgpu). Its API shape documents what the viewport must support. |
| `design-system/*.html` | Static design-system cards: Colors, Type, Components, Patterns. Static markup = exact DOM reference. |
| `data/loft_04/` | **Example dataset** — the exact scene the prototype renders, exported as `gaussians.ply` (3DGS), `points.ply` (xyz+RGB+semantic label), `collision_mesh.obj/.mtl`, with `scene.json` manifest. See its README. |
| `reference/` | Screenshots of all six modes — visual ground truth (see its README for capture caveats). |
| `AGENTS.md` / `design.md` | Working conventions for coding agents / design rationale. Read alongside this file. |
| `tweaks-panel.jsx` | Prototype-only design-review tooling. **Do not port.** |

## 2. Design tokens (from `ws-styles.css`, scoped to `.ws-root`)

```css
--bg:        #15120E;                 /* viewport base; letterbox stage is #080604 */
--panel:     rgba(37,32,26,0.88);     /* floating panels + backdrop blur 18px sat 1.1 */
--panel-solid: #201C17;               /* docked variant, no blur */
--line:      rgba(255,255,255,0.07);  /* hairlines */   --line-strong: rgba(255,255,255,0.12);
--ink:       #ECE2D4;  --ink-mut: #9B8D7B;  --ink-faint: #6B5D4A;
--acc:       #E0683A;                 /* user-switchable: #4A8FD9 / #3FAE7C / #C9A93F */
                                      /* text on accent fills: #1A0F08 */
--mono: "IBM Plex Mono";  --sans: "Spline Sans";  --serif: "Source Serif 4";
--radius: 16px;  --inset: 28px;  --pad: 16px;  --row-h: 38px;
--fs: 14px;  --fs-head: 11px;
```

Variants (classes on `.ws-root`):
- `.dense` — compact density: `--pad:11px --row-h:30px --fs:12.5px --fs-head:10px --radius:13px`
- `.docked` — solid panels, no blur/shadow, `--radius:9px --inset:10px`
- Accent change = swap `--acc` only; all states derive via `color-mix`.

Semantic class palette + magma depth ramp: see `design-system/Colors.html`.

## 3. Type rules

- **Source Serif 4 600** — identity only: wordmark (20px), mode title (22px). Max twice per screen.
- **Spline Sans 400/500** — row names, body (14px / 12.5px dense).
- **IBM Plex Mono 400–600** — every label, value, chip, key, status item. Micro-labels
  (`.ws-head`): 11px, 500, uppercase, tracking 0.18em. Live-updating numerals are always mono.

## 4. Component inventory (CSS class = component name)

Primitives: `.ws-panel` (+`-head/-body`, `.ws-tree-foot`) · `.ws-head` · `.ws-chip[.acc]` ·
`.ws-key[.on]` · `.ws-pill[.on,.sm]` · `.ws-btn[.acc,:disabled]` · `.ws-node[.on,.click]` ·
`.ws-dot[.pulse]` · `.ws-switch[.on]` · `.ws-track/.ws-fill/.ws-thumb` (slider) ·
`.ws-progress` · `.ws-search` · `.ws-ramp` · `.ws-kv` · `.ws-mono-val` · `.ws-rec`

Rows: `.ws-layer-row` · `.ws-class-row` · `.ws-sensor-row` · `.ws-frame-row` ·
`.ws-hist-row` — all support `.active` (accent 13% fill / 55% border) and `.dim` (45% opacity).

Composites: `.ws-wordmark` · `.ws-rail/.ws-rail-btn` · `.ws-mode-switch` · `.ws-timeline` ·
`.ws-tracks-panel` (lanes: `.ws-act/.ws-evt/.ws-cap` + `.ws-playhead`) · `.ws-strip/.ws-strip-cell` ·
`.ws-view-tag` · `.ws-pip` · `.ws-statusbar` · `.ws-ctrlbar` (`.ws-ctrl` + `.ws-ctrl-label`, mouse
glyphs as `.ws-key.ws-key-mouse`) · `.ws-rig` · `.ws-spawn-grid` · `.ws-pad` ·
`.ws-mode-card` · `.ws-brush-ring`

Placement anchors (floating): `.ws-top-left` `.ws-top-center` `.ws-top-right` `.ws-left`
`.ws-right-col` `.ws-bottom-left` `.ws-bottom-center` `.ws-bottom-right` `.ws-bottom-full`.
When timeline and controls bar share bottom-center, wrap both in `.ws-bottom-stack`
(column, 12px gap, controls bar nearest the bottom edge).
Design frame is **1920×1080**, uniformly scaled to fit the window (`WSStage`).

Icons: stroke-based 20×20 SVGs, stroke-width 1.5, round caps/joins — full set in
`ws-panels.jsx` (`WSIcons`): select, move, spawn, agent, camera, ruler, layers, play,
pause, eye, chev, chevD, rec, lidar, imu, skip, brush, orbit, rect, crop, undo, upload,
mouseL, mouseR, wheel (mouse-button glyphs for the controls bar).

## 5. Modes (information architecture)

Top-center capsule switches 6 modes; selection persists across launches. Each mode is one
job-to-be-done; panels and tools change per mode — the world and the visual language never do.

### Purpose of the six modes

| Mode | Purpose | Mental model |
|---|---|---|
| **View** | Look without touching. Inspect a captured world in any representation (gaussians, points, mesh, semantic, depth), isolate semantic classes, scrub capture playback. Zero risk — nothing here mutates the world. | “Open the scan and study it.” |
| **Edit** | Make the world clean and shippable. Select/delete splats, remove outliers, tune SH degree & brightness, watch size estimates, publish/export. The SuperSplat-class workbench. | “Photoshop for splats.” |
| **Simulate** | Validate the digital twin against reality. Side-by-side sensor feed vs. metric reconstruction, frame alignment, session/agent/cloud-job status. Where sim-to-real correspondence is proven. | “Does the twin match the truth?” |
| **Pilot** | Act inside the world. Drive an agent (WASD / discrete actions), spawn physics props, watch its eye in PiP and all sensor channels live. Interactive control & teleoperation. | “Be the robot.” |
| **Sensors** | Define what the robot perceives. Configure rigs: place cameras/lidar/IMU (frustum gizmos), set intrinsics & noise, toggle channels, preview each channel’s output. | “Build the perception stack.” |
| **Episode** | Record, replay, export behavior. Deterministic episode timelines — action blocks, object events, capture ticks — scrubbed and replayed for datasets and debugging. | “The flight recorder.” |

They compose into a lifecycle: **capture → View (inspect) → Edit (clean/publish) → Sensors
(rig) → Pilot (act) → Episode (record/export) → Simulate (validate)** — then loop.
When adding a 7th mode later, give it one job, one sentence, one mental model first; if you
can’t, it belongs inside an existing mode as a panel or tool.

### Mode implementations

1. **View** (`ViewMode`) — read-only inspection. Render pills (Gaussians/Points/Mesh/Semantic/Depth),
   world tree, class legend with isolation on Semantic/Mesh, render-mode card, playback capsule.
   No editing tools — safe browsing of a loaded world.
2. **Edit** (`StudioMode`) — inspect/edit/optimize/publish splats.
   Tool rail: orbit, brush, rect, crop, transform, measure (brush + orbit working in proto).
   Left: Selection panel (Invert/Clear/Delete/Undo, brush radius, ghost-deleted toggle) +
   History (op stack, undo pops). Right: Optimize (live splat count, SH degree 0–3,
   brightness, remove outliers) + Publish (.ply/.splat/.sogs, size estimate, publish →
   progress → live URL). Render pills: Gaussians/Points/Mesh/Semantic/Depth.
   Selected splats tint accent; deleted ghost red @10% when "ghost deleted" is on.
3. **Simulate** (`LayoutDual`) — sensor feed | metric view split (50/50, 1px divider),
   frames list left, Session/Agent/Cloud-job cards bottom-center, timeline capsule.
4. **Pilot** (`LayoutCommand` + WASD) — full-bleed world, top sensor strip (RGB/DEPTH/SEG/LIDAR),
   spawn-props panel, agent WASD pad (keys light on press), accent PiP agent-eye bottom-right,
   trajectory breadcrumbs, step counter.
5. **Sensors** (`ScreenRig`) — frustum gizmos in points view, rig channel list with toggles,
   intrinsics panel, RGB/DEPTH preview cards bottom-left.
6. **Episode** (`ScreenTimeline`) — trajectory replay; tracks panel with Agent action blocks,
   Object events, Capture ticks, playhead; play animates agent along trajectory.

## 6. Interaction patterns

- Orbit: drag on viewport (yaw ∝ dx·0.006, pitch ∝ dy·0.004, pitch clamped 0.05–1.2 rad).
- Brush select: crosshair cursor + accent ring (`.ws-brush-ring`) sized to radius; paint on drag;
  one history op per stroke. Undo is a strict LIFO stack of ops (delete / select-on / select-off / invert).
- All toggles are instant; destructive actions (Delete) need a selection — disabled otherwise.
- Keyboard: WASD agent driving (Pilot), `/` focus filter, `I` isolate class, `G` grab/place sensor.
- Status bar: always present, 3–4 mono items, rightmost item accent = the "live" stat.
- Controls bar: every mode advertises its camera/input bindings in a bottom-center capsule
  (`WSControlsBar` + `WS_CONTROLS[mode]`); when a timeline is also present they stack via
  `.ws-bottom-stack` with the controls bar nearest the bottom edge. Episode instead puts
  transport keys (Space / ← →) in-place in the tracks head. Visibility is a user
  preference (`showControls`). Mouse bindings use the mouseL/mouseR/wheel glyphs, never text.
- Accent usage rule: active states, recording, playheads, agent overlays, primary buttons ONLY.

## 7. Renderer contract (replace `ws-render.js`)

The viewport component must support: render modes `splat | points | mesh | semantic | depth`;
per-splat selection + deletion masks; class isolation (non-isolated at 18% alpha); exposure;
camera frustum gizmos with labels; agent marker (ring + post + heading dash); trajectory
breadcrumbs; ground grid. Edit ops needed: screen-space radius picking (`collectInRadius`),
delete/restore by index list, outlier detection, SH-degree truncation, export to .ply/.splat/.sogs.
Use `data/loft_04/` as the loading test fixture — rendering those three files with the
semantic palette from `scene.json` must reproduce the prototype's five render modes.

## 8. Desktop build notes

- Window: borderless full-bleed (the prototype's full-viewport stage = the window).
  If macOS traffic lights are required, inset them over the viewport top-left, no title bar.
- Panels: floating is the default presentation; docked is a user preference. Backdrop blur =
  NSVisualEffectView / vibrancy over the GPU viewport, or pre-blurred panel fills.
- Fonts are Google Fonts (OFL): bundle IBM Plex Mono, Spline Sans, Source Serif 4.
- Persistence: mode, render mode, accent, density, panel style, panel visibility.
- The 1920×1080 design frame scales uniformly; panels keep px sizes relative to the frame.
