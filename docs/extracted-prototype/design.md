# World Studio — Design Language

Why World Studio looks and behaves the way it does. `codex.md` says *what* to build;
this file says *why*, so future changes stay coherent. Tokens and exact values live in
`ws-styles.css` and `design-system/`.

---

## 1. Concept: instruments over a world

The world is the protagonist. The entire window is one continuous 3D viewport;
**everything else is an instrument floating above it** — translucent, blurred, shadowed,
like a HUD over terrain. There is no chrome: no title bar, no sidebar walls, no docked
trays carving up the screen (docked exists only as a user preference, and even then panels
stay islands).

Consequences:
- Panels never tile or touch. They anchor to fixed slots (corners, edges, center capsules)
  with 28px insets and generous negative space between them.
- The viewport is never letterboxed inside the app — panels overlap the world, the world
  doesn't shrink to make room.
- Anything that is not actionable or live data does not get drawn. No decoration.

## 2. Mood: field instrument, not consumer app

Warm charcoal (#15120E) instead of neutral gray-black: the world is lit like embers, the
UI feels like a physical instrument used in a workshop. One ember-orange accent (#E0683A)
is the only loud color, and it is **reserved for what is live or chosen**: the active mode
pill, the recording dot, the playhead, the agent, the selection. If everything glows,
nothing is live — so accent budget per screen is deliberately small.

The aesthetic relatives are flight HUDs, surveying equipment, and map-room interfaces —
not dashboards or SaaS.

## 3. Three typographic voices

| Voice | Face | Role |
|---|---|---|
| Identity | Source Serif 4 (600) | The wordmark and one mode title per screen. A human, almost-literary counterpoint to the instrumentation. Max twice per screen. |
| Interface | Spline Sans (400/500) | Names of things: rows, props, copy. Quiet, legible. |
| Data | IBM Plex Mono (400–600) | Everything measured: labels, values, counts, keys, status. Uppercase micro-labels at 11px / 0.18em tracking are the system's signature. |

Rule of thumb: if a value can change while you watch it, it is mono.

## 4. Shape & material

- **Capsules for transient controls** (mode switcher, timeline, wordmark, view tags):
  fully rounded, they read as floating instruments.
- **16px-radius cards for stateful panels** (trees, inspectors): rounded enough to float,
  square enough to hold lists.
- Material: `rgba(37,32,26,.88)` + 18px backdrop blur + deep shadow + 1px top inner
  highlight. Hairlines at 7% white. Inputs recess (darker fill, inset look); actions raise.
- Docked variant strips the glass (solid #201C17, no blur/shadow, 9px radius) for
  performance or preference — structure is identical.

## 5. Layout grammar

Design frame is fixed **1920×1080**, uniformly scaled to the window (never reflowed).
Anchor slots, by information role:

- **Top-left** — identity & context (wordmark: where am I, what scene) + tool rail (verbs).
- **Top-center** — navigation capsules: mode switcher; render pills row beneath (top: 96).
- **Left panel (396px)** — "what exists": trees, lists, palettes. The nouns.
- **Right column (408px)** — "properties of the chosen thing": inspectors, config. The adjectives.
- **Bottom-center** — time & hands: playback capsule or tracks panel, with the input-bindings
  capsule (`.ws-ctrlbar`) stacked beneath — the quiet legend for how to move the camera.
- **Bottom-right** — alternate eye: PiP feed or render-mode card.
- **Bottom edge** — status bar: 3–4 mono facts, rightmost accent item = the live stat.

This grammar is constant across modes; modes only change which instruments are present.
That constancy is what makes six modes feel like one app.

## 6. Motion & feedback

- Motion is functional only: switch knobs slide (150ms), twist chevrons rotate, the REC
  dot pulses (1.6s), playheads glide. No entrance animations, no parallax, no easter eggs.
- Direct manipulation everywhere the data is spatial: orbit by dragging the world, select
  by brushing it, drive with WASD. Panels are for numbers; the viewport is for hands.
- Every destructive op is undoable and logged in a visible history; Delete is disabled
  until a selection exists. Deleted geometry ghosts red at 10% rather than vanishing.
- Keyboard affordances are advertised in-place with key caps (`.ws-key`), not hidden in menus.
  Each mode also summarizes its camera/input bindings in the bottom controls capsule
  (`.ws-ctrlbar`) — keycaps for keys, mouse glyphs for buttons, never prose.

## 7. Copy voice

Terse, lowercase-technical, measured. `loft_04 · v3 · gaussian field`, `aligned · 47,173 pts`,
`polling…`. Middots join facts; sentences are for documentation, not panels. Numbers carry
the meaning; words just label them. No exclamation points, no marketing adjectives, no emoji.

## 8. Extending the system

Adding a panel: pick the anchor slot by information role (§5), use `.ws-panel` anatomy
(head/body/foot), mono micro-label title, and at most one accent element. Adding a mode:
one job, one mental model (see codex.md §5) — reuse existing instruments before inventing
new ones. New colors must be derived from existing tokens via `color-mix`; new component
classes follow the `ws-*` prefix and get a card in `design-system/`.
