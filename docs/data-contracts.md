# Data Contracts

## Active And Proposed Contracts

Runtime contracts live under the root `contracts/` tree and are backed by implementation
tests. Design drafts live under
`docs/blueprints/world-compiler-v0.1/proposals/contracts/` and must not be imported by
runtime code until migration and round-trip tests exist.

The preserved source blueprint contains an older single
`capture_splat.live_session.v0.1` draft. It is incompatible with the active three-schema
session/frame/ACK protocol and remains provenance-only under
`docs/blueprints/world-compiler-v0.1/source/`.

Proposed contracts cover the canonical World Package, external Isaac jobs, robot/task
profiles, physical assets, calibration experiments, and calibration reports. Isaac runtime
versions are capability data, not schema enums.

## Capture Splat Live Session

World Studio mirrors the Capture Splat-owned schemas and fixtures byte-for-byte:

```text
capture_splat.live_session.v0.1
capture_splat.live_frame.v0.1
capture_splat.live_ack.v0.1
```

The schemas are closed with `additionalProperties: false`. They require finite numeric
values, one-based frame sequence IDs, lowercase `sha256:<64 hex>` digests, POSIX-relative
paths, explicit coordinate-system metadata, and `proposal_only` authority.

Session metadata binds a source `capture.json` identity to optional expected frame count,
units, handedness, +Y up, -Z camera-forward, row-major `camera_to_world`, and the clock
and coordinate domains used by frames. Each frame declares source-image dimensions and
checksum, independently dimensioned pinhole intrinsics, a 4×4 pose, tracking/quality
evidence, and optional depth, confidence, and typed person/valid/object mask references.
Calibration dimensions remain distinct from RGB dimensions; display-camera scaling is a
World Studio presentation step and never rewrites source calibration.

The loopback HTTP protocol provides health, idempotent session creation, strict frame
metadata and raw-asset uploads, durable status/resume, and fail-closed finalization.
Acknowledgements are emitted only after declared sizes and SHA-256 hashes pass. Identical
retries are duplicates; a sequence reused with different metadata or bytes is a conflict.
Valid out-of-order frames are durable immediately, but contiguous progress and trajectory
segments stop at gaps. Finalization rehashes every asset and requires every sequence
through the declared final sequence before atomically sealing the session.

Live source frames, poses, and quality fields are proposal evidence. They are not
reconstruction, collision, semantic, measurement, navigation, or safety authority.

## Render Modes

```ts
type RenderMode = "splat" | "points" | "mesh" | "semantic" | "depth";
```

## Budo Media Frames

World Studio keeps compatibility with:

```text
budo.media_frames.v0.8.json
```

Important fields:

- `frames[].display_name`
- `frames[].rgb_path`
- `frames[].width`
- `frames[].height`
- source/package metadata used to select source-pane behavior

## Capture Splat Handoff

World Studio recognizes:

```text
capture-splat.world-studio.json
```

Supported fields:

- `schema = "capture_splat.world_studio_handoff.v0.1"` or additive `v0.2`
- `status`, usually `visual_evidence_with_3dgs_proposal`
- `source_frames[]` or `frames[]` entries as relative RGB/source image paths
- `assets.points` for an ordinary PLY point cloud
- `assets.gaussian` or `assets.gaussian_ply` for a Gaussian PLY
- `assets.splat` or `assets.spz` as optional future compact splat references
- `assets.capture_manifest` for `capture.json`
- `assets.transforms`, `assets.poses`, or `assets.camera_poses` for camera/pose metadata
- `assets.navigation_mesh` for an ARKit metric mesh capture sidecar
- `assets.mesh_report` for mesh counts, classifications, and finite-data status
- `assets.room_semantics` for unregistered RoomPlan semantic proposals
- `assets.camera_trajectory` for the continuous ARKit frame-index trajectory
- `assets.measurement_points` for optional metric point evidence
- `assets.render_source_qa` for a strict
  `capture_splat.render_source_qa.v0.1` review summary
- `assets.ply_stats` for `capture_splat.ply_stats.v0.1` statistics bound to the
  exact Gaussian PLY path
- `metric_registration` for the ARKit-to-COLMAP-to-trainer transform chain,
  scale conversion, matched cameras, and residual gates
- `scene_transform.trainer` for truthful renderer-profile labeling such as
  `vksplat` or `gsplat`; package kind alone does not identify the trainer
- `walk_eligibility.status = eligible|held|missing`
- `artifacts[]` entries with `kind` and `path` for equivalent references

World Studio treats source frames as visual evidence. Trained Gaussian/splat
outputs are review proposals, not metric, collision, semantic, or navigation
authority unless separately validated.

World Studio displays attached QA as `promote`, `hold`, or `reject` evidence
only after validating its schema and counts. It accepts finite PLY evidence only
when the sidecar's path matches the loaded Gaussian and `finite` agrees with the
non-finite count. These checks do not establish a high-quality reconstruction.

Simulate `Inside` and `360` presets seed from an observed source-frame camera,
preferring the selected frame. World Studio must not synthesize an unobserved
position by combining independent camera-coordinate medians.

An `eligible` Walk status means a metric mesh is present and its camera-center
registration passed the declared residual gate. It does not promote the mesh to
externally validated collision, semantic, or navigation authority. RoomPlan
semantics remain unregistered proposals unless a separate RoomPlan-to-ARKit
registration is supplied and validated.

World Studio may derive a bounded `local collision preview` from a registered
navigation mesh. This path is fail-closed: complete source counts, finite
vertices, valid faces, non-truncated coverage, floor/wall continuity, and the
triangle budget must pass before the Walk control is enabled. Larger meshes
require an offline topology-preserving simplifier. A local preview drives only the interactive Rapier character
controller; it does not change the handoff's collision or navigation authority.
Truncated capture meshes remain available for visual evidence but cannot create
Walk colliders or synthetic fallback floors.

## Article / 3D Sidecar Views

World Studio keeps compatibility with:

```text
budo.article_figure_3d_views.v0.1.json
```

Expected content:

- figure identity or display name
- point-cloud sidecar path
- optional mesh sidecar paths
- provenance notes

## Verified Semantic Export

World Studio keeps read-only compatibility with:

```text
verified_export/manifest.json
```

Expected fields include:

- `schema = "budo.semantic_labels.verified_export.v0.1"`
- `status = "human_verified_semantic_labels"`
- `component_count`
- `files.verified_labels`
- `files.verified_point_cloud`
- `files.frame14_proof`
- `human_signoff`
- `hashes`
- `boundary`

Verified labels are semantic review artifacts. They are not occupancy, collision,
navigation, or robot-command authority without separate metric validation.

## Physical Calibration Contracts

The proposal schemas separate:

- `world_studio.physical_asset.v0.1`: versioned geometry roles and physical parameter
  proposals;
- `world_studio.calibration_experiment.v0.1`: apparatus, sensors, actions, conditions,
  repetitions, exclusions, safety limits, and raw evidence;
- `world_studio.calibration_report.v0.1`: solver provenance, fit/holdout splits, estimates,
  residuals, baseline comparison, and promote/hold/reject decisions.

Every physical value requires units, source class, uncertainty or range, provenance,
simulator/contact-model scope, and approved/prohibited uses. Capture evidence alone cannot
promote mass, inertia, friction, restitution, stiffness, force, or torque.
