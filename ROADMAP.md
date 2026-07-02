# Roadmap

## P0: Scaffold And Compatibility

- Keep the six-mode World Studio shell design-faithful to the prototype.
- Preserve explicit dataset loading and provenance.
- Load `loft_04` as the smoke fixture across all render modes.
- Preserve Budo media, article-sidecar, and verified-export contracts.
- Keep ordinary point clouds and Gaussian/splat PLYs separate.

## P1: Real Renderer Integration

- Integrate Spark + Three.js as the primary Gaussian renderer.
- Keep the canvas fallback for tests and degraded browser paths.
- Add worker-backed PLY/OBJ parsing for larger files.
- Add renderer screenshots and Playwright canvas smoke checks.
- Add first-class class isolation, selection/deletion masks, and screenshot proof capture.

## P2: Editing And Export

- Implement brush and rectangle selection against the real renderer.
- Add delete/restore history, ghost-deleted rendering, and operation logs.
- Add SH-degree, brightness/exposure, outlier filtering, and size estimates.
- Integrate `splat-transform` workflows for export, LoD, and collision sidecars after
  license and runtime review.

## P3: Simulation, Sensors, And Episodes

- Integrate Rapier for deterministic rigid-body simulation.
- Add drone, car, and indoor robot agent profiles.
- Add RGB/depth/segmentation/lidar/IMU sensor rig previews.
- Add deterministic Episode recording, replay, export, and validation metrics.

## P4: Packaging And Publishing

- Package macOS first through Electron.
- Add Windows/Linux packaging after the web app and renderer path stabilize.
- Add sample worlds, contributor docs, and release automation.
- Create the public GitHub remote after owner/org and release posture are confirmed.

