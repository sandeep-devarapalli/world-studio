# World Studio

[Website](https://sandeep-devarapalli.github.io/world-studio/landing/)

World Studio is a world simulator: the piece that turns a world into a place where
agents can act, learn, and be evaluated. With the help of generative world models, our
real-to-sim-to-real (R2S2R) engine turns a single physical task into thousands of
controllable, reusable worlds, helping robotics teams train policy models and test
changes faster, uncover failures earlier, and reduce costly experimentation on hardware.

The broader World Studio product vision includes proprietary model technology that
generates simulations aligned with reality, so robots can learn complex manipulation
tasks with zero real-world training data, predict through simulation which policies will
succeed or fail in the real world, and operate reliably for hours in real-world settings.
This Apache-2.0 repository is the open implementation surface for that direction:
a browser-capable and desktop-ready world rendering, editing, and simulation studio for
Gaussian splats, point clouds, semantic world artifacts, sensor rigs, and robotics
episodes.

Its long-term product role is an evidence-backed world compiler between Capture Splat and
task-scoped simulation. The public
[World Compiler Blueprint](docs/blueprints/world-compiler-v0.1/README.md) reconciles that
direction with the implementation already on `main`, including milestone gates and the
Physical Asset Calibration subsystem. The
[R2S2R and Newton adoption note](docs/blueprints/world-compiler-v0.1/r2s2r-newton-2026-07-29/README.md)
defines Newton as the target physics runtime and preserves Rapier as the current,
removal-bound migration baseline until parity gates pass.

This repository is the Apache 2.0 implementation of the World Studio product described
in `docs/source-materials/World studio development.docx` and designed in
`docs/source-materials/World Studio.zip`. The current app is intentionally explicit
about what it has loaded, where data came from, and which artifacts are proposals,
verified exports, or local desktop files.

## Open Source Boundary

The open-source repository is usable today as a local web and desktop world studio. It
includes the app shell, local loading, rendering, proposal/verified artifact boundaries,
simulation substrate, Episode workflows, Capture Splat receiver contracts, and GitHub
Pages landing site.

The broader product vision includes model-generated R2S2R worlds, policy prediction,
large-scale variation generation, and long-horizon robot reliability. Those capabilities
are product direction unless a feature is implemented, tested, and documented in this
repository.

People can self-deploy the current app from source. There is no hosted SaaS or cloud
access flow in this repo today.

## Current State

- A `pnpm` monorepo with React/Vite web app and Electron shell.
- A six-mode app shell: View, Edit, Simulate, Pilot, Sensors, Episode.
- Runtime loading for the bundled `loft_04` fixture from `apps/web/public/fixtures/loft_04`.
- Three.js renderer foundation with Spark Gaussian PLY path diagnostics, point-cloud and mesh
  fallbacks, semantic/depth modes, class isolation, camera overlays, agent markers, trajectory
  breadcrumbs, and screenshot smoke coverage.
- Rapier-backed simulation substrate for deterministic Pilot movement, spawn placement,
  prop spawning, collision/debug overlays, selected-prop inspection, and Episode recording.
- A documented Newton migration boundary. Newton is not implemented yet; the target is an
  Electron-supervised Python worker with explicit solver profiles, capability reports, and
  local CPU or remote NVIDIA execution.
- Browser and Electron package loading for World Studio packages, generic JSON packages,
  Budo-compatible manifests, article figure views, and verified export folders.
- An explicit loopback-only Capture Splat live-session receiver for replaying source-frame
  and camera evidence into Simulate without replacing the loaded world.
- An additive progressive-session path that accepts an immutable v0.2 session identity
  before `capture.json` exists, then checksum-binds the declared final manifest identity
  while sealing the same proposal-only evidence ledger.
- An M1 desktop security boundary for explicit selected-interface pairing, pinned TLS,
  P-256 device identity, signed requests, credential expiry/revocation, and durable replay
  defense. It does not yet include the iPhone sender or physical-device acceptance.
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

In Simulate, `Start Listening` starts the Phase 1 receiver on
`127.0.0.1:43127`. Listening is always an explicit desktop action. Live sessions are
recoverably stored under the Electron user-data directory, remain proposal-only, and do
not replace or modify the currently loaded world. The browser build keeps working without
the Electron bridge. `WORLD_STUDIO_LIVE_PORT` changes the port;
`WORLD_STUDIO_LIVE_HOST` is accepted only as `127.0.0.1` or `::1`, so environment
configuration cannot widen the Phase 1 listener beyond loopback.

M1 does not widen that M0 listener. Its separate secure path begins only after an explicit
pairing action and an exact local-network interface selection. The QR offer pins the Mac's
TLS identity; paired devices authenticate requests with a P-256 identity and signed request
metadata. Expired or revoked grants fail closed, and durable request counters reject replay
after restart. Bonjour advertises only the allowlisted `_capturesplat._tcp` service metadata
and never an invitation secret. See [Live Security M1](docs/live_security_m1.md).

This checkpoint does not modify Capture Splat's iPhone capture loop, connect its dormant
bounded sender foundation to capture writes, or start reconstruction workers. Local-network
permission, firewall, Bonjour, and two-cycle iPhone evidence remain physical acceptance gates.

## Package Desktop App

On macOS:

```bash
pnpm desktop:package
open "release/mac-$(uname -m)/World Studio.app"
```

This creates an ad-hoc signed local smoke bundle from Electron's native app shell plus the
built `apps/web/dist` and `apps/desktop/dist` outputs. It is for local validation, not
notarized distribution. The current macOS smoke build is expected at
`release/mac-arm64/World Studio.app` on Apple Silicon. The bundle declares its local-network
purpose and only the `_capturesplat._tcp` Bonjour service used by explicit pairing. The
packaged smoke extracts the final `Info.plist` and fails unless both declarations match
exactly.

## Test

```bash
pnpm test
pnpm typecheck
pnpm validate:blueprint
pnpm test:ui
pnpm test:live-e2e
```

The Capture Splat repository owns the canonical
`capture_splat.live_session.v0.1`, `capture_splat.live_frame.v0.1`, and
`capture_splat.live_ack.v0.1` schemas and fixtures. World Studio carries
byte-identical mirrors and verifies their fingerprints.
`test:live-e2e` builds the pure desktop receiver, creates a temporary two-frame
capture, runs the sibling Capture Splat replay CLI through duplicate/disconnect/resume
simulation, finalizes it, then exercises progressive v0.2 receipt across receiver restart
before binding the final manifest identity. Both emitted handoffs reopen through the package
reader.
M1 security tests exercise the desktop identity, pairing/authentication boundary, expiry,
revocation, signed-body binding, and replay rejection without claiming physical iPhone or
Bonjour acceptance.

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

See `ROADMAP.md` for the public M0-M10 sequence. Detailed outcomes, dependencies, and
acceptance gates live in
`docs/blueprints/world-compiler-v0.1/MILESTONES.md`.

## Contributing

See `CONTRIBUTING.md` before opening an implementation or validation PR. Contributions must
keep source evidence, visual proposals, metric geometry, collision, semantics, navigation,
and physics authority explicit. Generated captures, models, and simulator outputs do not
belong in Git.

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
