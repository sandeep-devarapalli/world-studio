# Roadmap

## Completed Foundation

- Published Apache 2.0 repo with `pnpm` workspace, React/Vite browser app, Electron shell,
  package structure, source-material archive, and upstream reference policy.
- Preserved the six-mode World Studio shape: View, Edit, Simulate, Pilot, Sensors, Episode.
- Preserved explicit dataset/package loading, provenance labels, and ordinary PLY versus
  Gaussian PLY routing.
- Loaded `loft_04` as the smoke fixture across renderer, package, simulation, and UI tests.
- Added compatibility readers for Budo media manifests, article figure sidecars, verified
  export manifests, generic JSON packages, and World Studio package manifests.
- Added desktop local package loading, package validation diagnostics, compatibility fixtures,
  and inspector drilldowns.

## P0: UI Quality And Design Fidelity

- Rework the visible app against the archived World Studio design source of truth:
  `docs/source-materials/World Studio.zip`, `docs/extracted-prototype/design.md`, and
  `docs/extracted-prototype/reference/`.
- Keep the original prototype grammar: warm charcoal, floating HUD panels, dense mono data
  labels, mode switcher, controls bar, status bar, docked variants, and 1920x1080 scaling.
- Improve visual hierarchy, spacing, typography, and responsive behavior without weakening
  the existing renderer/package/Episode contracts.
- Keep View/Edit/Simulate/Pilot/Sensors/Episode as production surfaces, not a marketing page.

## P1: Renderer And Editing Depth

- Harden the Spark + Three.js Gaussian path for larger real-world Gaussian PLYs.
- Keep the canvas fallback for tests and degraded browser paths.
- Add worker-backed PLY/OBJ parsing for larger files.
- Expand renderer screenshots and Playwright canvas smoke checks.
- Add first-class renderer selection, deletion masks, restore history, SH-degree controls,
  exposure/brightness controls, outlier filtering, and exportable operation logs.
- Integrate `splat-transform` workflows for export, LoD, and collision sidecars after license
  and runtime review.

## P2: Simulation, Sensors, And Episodes

- Expand Rapier simulation beyond the current deterministic agent/prop substrate.
- Add drone, car, indoor robot, and custom embodiment profiles with calibrated units.
- Add richer RGB/depth/segmentation/lidar/IMU sensor rig previews and recorded outputs.
- Extend Episode bundles with richer replay validation, metrics, screenshots, and renderer
  state capture.
- Keep Episode artifacts truthful: source relink, companion asset validation, embedded
  asset manifests, and per-asset integrity details remain required checks.

## P3: Package And Compatibility Coverage

- Add more representative sample worlds and package fixtures.
- Support larger local packages with streaming or chunked loading where needed.
- Expand Budo-compatible readers while keeping new World Studio contracts generic first.
- Add importer/exporter validation for package round trips and browser versus Electron parity.
- Maintain clear proposal, verified, and external-validation status boundaries.

## P4: Packaging, Release, And Integrations

- Keep macOS Electron packaging green and move from local ad-hoc smoke builds toward signed
  and notarized releases.
- Add Windows/Linux packaging after the renderer and app shell stabilize.
- Add web deployment, release artifacts, contributor docs, and release automation.
- Keep CARLA, Isaac Sim/Lab, AirSim, Project AirSim, MuJoCo, Bullet, Genesis World, AI2-THOR,
  VkSplat, LichtFeld Studio, and related systems as documented references unless a specific
  integration passes license, runtime, and maintenance review.
