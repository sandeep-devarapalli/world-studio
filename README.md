# World Studio

World Studio is a browser-capable and desktop-ready world rendering, editing, and
simulation studio for Gaussian splats, point clouds, semantic world artifacts, sensor
rigs, and robotics episodes.

This repository is the Apache 2.0 implementation of the World Studio product described
in `docs/source-materials/World studio development.docx` and designed in
`docs/source-materials/World Studio.zip`. The current app is intentionally explicit
about what it has loaded, where data came from, and which artifacts are proposals,
verified exports, or local desktop files.

## Current State

- A `pnpm` monorepo with React/Vite web app and Electron shell.
- A six-mode app shell: View, Edit, Simulate, Pilot, Sensors, Episode.
- Runtime loading for the bundled `loft_04` fixture from `apps/web/public/fixtures/loft_04`.
- Three.js renderer foundation with Spark Gaussian PLY path diagnostics, point-cloud and mesh
  fallbacks, semantic/depth modes, class isolation, camera overlays, agent markers, trajectory
  breadcrumbs, and screenshot smoke coverage.
- Rapier-backed simulation substrate for deterministic Pilot movement, spawn placement,
  prop spawning, collision/debug overlays, selected-prop inspection, and Episode recording.
- Browser and Electron package loading for World Studio packages, generic JSON packages,
  Budo-compatible manifests, article figure views, and verified export folders.
- Episode recording, playback, export, browser import, Electron import, package bundle export,
  source relink, companion asset validation, embedded asset manifests, and per-asset integrity
  drilldowns.
- Typed contracts for render modes, provenance, Budo media manifests, article figure views,
  verified semantic exports, sensors, episodes, and simulation state.
- Artifact parsing for ordinary PLY, Gaussian PLY detection, OBJ mesh groups, Budo media
  manifests, article sidecars, and verified semantic export manifests.
- A typed renderer adapter contract with canvas fallback for degraded paths and tests.
- Apache-compatible upstream reference policy documented in `docs/upstreams.md`.

## Install

```bash
pnpm install
```

## Run Browser App

```bash
pnpm dev
```

Open the Vite URL and click `Load loft_04`, or use the test bridge fixture selectors in
the app to exercise compatibility layouts. Startup is intentionally explicit: World Studio
does not silently load arbitrary local artifacts.

## Run Desktop App

In one terminal:

```bash
pnpm dev
```

In another:

```bash
pnpm desktop:setup
pnpm desktop:dev
```

`desktop:setup` checks that Electron's native app binary is present and downloads it on
first use. `desktop:dev` also runs that check before opening the shell. The Electron app
wraps the same web app and adds local filesystem package loading, Episode open/save flows,
and desktop provenance.

## Package Desktop App

On macOS:

```bash
pnpm desktop:package
open "release/mac-$(uname -m)/World Studio.app"
```

This creates an ad-hoc signed local smoke bundle from Electron's native app shell plus the
built `apps/web/dist` and `apps/desktop/dist` outputs. It is for local validation, not
notarized distribution. The current macOS smoke build is expected at
`release/mac-arm64/World Studio.app` on Apple Silicon.

## Test

```bash
pnpm test
pnpm typecheck
pnpm test:ui
```

## Data Formats

World Studio distinguishes asset types instead of guessing by extension alone:

- Ordinary point-cloud PLY: XYZ with optional RGB, semantic, confidence, provenance, and
  scalar inspection fields.
- Gaussian/splat PLY: trained 3DGS-style PLY with opacity, scale, rotation, and feature
  fields.
- OBJ meshes: collision or solid sidecars.
- World Studio packages: `world-studio.package.v0.1` and `world-studio.episode.v0.1`
  manifests with companion artifacts and provenance.
- Budo-compatible packages: `budo.media_frames.v0.8.json`,
  `budo.article_figure_3d_views.v0.1.json`, and `verified_export/manifest.json`
  compatibility paths.

Visual artifacts are evidence, not metric or safety authority by default. Verified semantic
exports remain read-only and separate from external validation.

## Episode Workflows

Episode mode records real Pilot actions into a deterministic timeline. Episodes can be
played back, exported as JSON, imported through the browser or Electron, saved as package
bundles, relinked to local source packages, and validated against companion asset manifests.
The provenance panel shows compact status first, then expands into a per-asset integrity
table with expected and actual size/checksum values.

## Compatibility Boundary

World Studio preserves useful Budo Studio contracts without becoming Budo-specific. The app
keeps explicit loading, source provenance, proposal/verified/external-validation labels,
ordinary PLY versus Gaussian PLY separation, Budo media manifests, article figure views, and
verified export boundaries. New package readers should stay generic first, with compatibility
adapters layered on top.

## Roadmap

See `ROADMAP.md` for the current completed foundation and remaining UI, renderer, simulation,
package, release, and integration work.

## Upstream References

See `docs/upstreams.md` for local reference repos, license notes, and usage status. Reference
copies under `references/upstream/` are intentionally ignored by Git.

## License

World Studio is Apache 2.0. Upstream repos under `references/upstream/` are local study
copies only and are ignored by Git. Do not vendor reference code into this repo without a
license review.

GPL code, including LichtFeld Studio, is reference-only unless the project intentionally
changes licensing. Unreal/Omniverse-heavy systems are also reference-first, not default
runtime dependencies.
