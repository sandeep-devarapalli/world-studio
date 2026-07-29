# World Compiler Milestones

## M0 Live Evidence Foundation

Outcome: merge and close the replay/receiver Phase 1 foundation.

Acceptance:

- Canonical Capture Splat session/frame/ACK contracts are mirrored byte-for-byte.
- Replay handles corruption, unsafe paths, duplicates, gaps, disconnect, resume, and
  receiver restart.
- World Studio displays streamed evidence as proposal-only and never replaces a loaded
  world.
- Finalized handoffs reopen through the explicit package workflow.

Status: completed.

## M1 Authenticated LAN And Progressive World

Outcome: bounded iPhone-to-Mac transfer with useful immediate evidence.

Status: partial. The M1A desktop boundary keeps M0 loopback unchanged and adds explicit
selected-interface pairing seams, QR invitation state, pinned TLS identity, P-256
device-request authentication, finite grants, expiry/revocation, signed-body binding, and
durable request-counter replay defense. The iPhone sender, progressive mesh/worker path, and
physical acceptance remain open.

Acceptance:

- Bonjour discovery and QR or short-code pairing with authenticated TLS.
- Capture remains local-first; sender queues are bounded and networking never changes frame
  acceptance.
- RGB-D, camera, mask, mesh, and quality proposals arrive with resume and reconciliation.
- Optional reconstruction workers have explicit lifecycle, provenance, resource budgets,
  and failure isolation.
- Two physical-device cycles preserve throughput, thermal behavior, and finalization.

The desktop implementation and software tests do not by themselves satisfy the first or
last acceptance items. Packaged macOS local-network permission/firewall behavior, physical
Bonjour discovery, real QR pairing, receiver restart, Wi-Fi interruption, and two complete
iPhone cycles must still be recorded.

## M2 Canonical World Package And Editor

Outcome: immutable backend-neutral worlds with reversible editing.

Acceptance:

- Content-addressed artifacts, transform graph, units, authority, uncertainty, and parent
  versions are explicit.
- Crop, transform, filter, merge, hide, replace, objectize, and annotate operations are
  reversible and auditable.
- Appearance, metric, collision, navigation, semantic, and physics layers stay aligned but
  retain separate authority.
- Package migration and round-trip tests reproduce referenced bytes.

## M3 Indoor Navigation Ready - R3

Outcome: one validated indoor mobile robot or vacuum world.

Acceptance:

- Metric floor, walls, openings, occupancy, free space, spawn, and route gates pass.
- Collision is derived from validated metric geometry, not Gaussian appearance.
- Local Rapier and external robot-facing runs use the same explicit frame and units.
- A vacuum demonstration completes zones, avoids a no-go area, and returns to dock with
  reproducible route evidence.

## M4 Physical Asset Calibration Foundation

Outcome: objectized assets and C0-C2 calibration recipes.

Acceptance:

- Visual, metric, collision, and semantic geometry are separate and registered.
- Direct dimensions and mass measurements record units, apparatus, uncertainty, and source.
- Ramp, slide, drop, or compression trials produce experiment-conditioned contact
  estimates with feasibility checks.
- Reports compare against simulator defaults and declare approved and prohibited tasks.

## M5 Isaac/ROS Sensor Alignment - R4

Outcome: compile a promoted world into a remote Isaac/ROS environment.

Acceptance:

- Layered OpenUSD compiler preserves frame, units, visual/collision separation, and
  provenance.
- Isaac worker reports runtime capabilities instead of relying on schema-pinned versions.
- ROS 2 clock, TF, odometry, controls, cameras, depth, LiDAR, and IMU pass conformance.
- A scripted route produces sensor and pose residual reports across local, Isaac, and real
  runs.

## M6 Rigid Interaction And Field Calibration - R5

Outcome: task-scoped rigid-body dynamics validated on held-out real trials.

Acceptance:

- Instrumented C3-C4 experiments estimate identifiable mass, center of mass, inertia, and
  contact parameters.
- Train and held-out trials are immutable and separated.
- Real/sim residuals improve over simulator defaults without unacceptable regression.
- Asset and World v2 retain ancestry, solver, simulator, contact-model, and episode
  provenance.

## M7 Expanded Embodiments

Outcome: readiness gates expand by embodiment, not by reusing one generic score.

Order:

1. Indoor UAV.
2. Outdoor UAV.
3. Vehicles and autonomous driving.
4. Rigid and articulated manipulation.
5. Deformable and contact-rich tasks.

Each embodiment requires its own sensors, collision model, task profile, safety envelope,
physical evidence, and real/sim validation.
