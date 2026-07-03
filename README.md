# World Studio

World Studio is a browser-capable and desktop-ready world rendering, editing, and
simulation studio for Gaussian splats, point clouds, semantic world artifacts, sensor
rigs, and robotics episodes.

This repository is the Apache 2.0 implementation scaffold for the World Studio product
described in `docs/source-materials/World studio development.docx` and designed in
`docs/source-materials/World Studio.zip`.

## What Works In This Slice

- A `pnpm` monorepo with React/Vite web app and Electron shell.
- A design-faithful six-mode app shell: View, Edit, Simulate, Pilot, Sensors, Episode.
- Runtime loading for the bundled `loft_04` fixture from `apps/web/public/fixtures/loft_04`.
- Typed contracts for render modes, provenance, Budo media manifests, article figure views,
  verified semantic exports, sensors, episodes, and simulation state.
- Artifact parsing for ordinary PLY, Gaussian PLY detection, OBJ mesh groups, Budo media
  manifests, article sidecars, and verified semantic export manifests.
- A typed canvas renderer fallback that exercises the renderer contract while Spark/Three.js
  integration is developed behind the same adapter boundary.
- Apache-compatible upstream reference policy documented in `docs/upstreams.md`.

## Install

```bash
pnpm install
```

## Run Browser App

```bash
pnpm dev
```

Open the Vite URL and click `Load loft_04`. Startup is intentionally explicit: World
Studio does not silently load arbitrary local artifacts.

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

`desktop:setup` checks that Electron's native app binary is present and downloads it
on first use. `desktop:dev` also runs that check before opening the shell. The Electron
app wraps the same web app and is the path for future local filesystem loading, proof
capture, and packaged macOS/Windows/Linux builds.

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
- Budo packages: `budo.media_frames.v0.8.json`, `budo.article_figure_3d_views.v0.1.json`,
  and `verified_export/manifest.json` compatibility paths.

Visual artifacts are evidence, not metric or safety authority by default. Verified semantic
exports remain read-only and separate from external validation.

## License

World Studio is Apache 2.0. Upstream repos under `references/upstream/` are local study
copies only and are ignored by Git. Do not vendor reference code into this repo without a
license review.

GPL code, including LichtFeld Studio, is reference-only unless the project intentionally
changes licensing. Unreal/Omniverse-heavy systems are also reference-first, not default
runtime dependencies.
