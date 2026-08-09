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

Proposed contracts cover the canonical World Package, external simulator jobs,
robot/task/sensor profiles, physical assets, calibration experiments, Real2Sim Promises,
eval suites and reports, policy artifacts, promotion decisions, deployments, site
revisions, change proposals, and field Episodes. Runtime versions are capability data, not
schema enums.

The
[R2S2R and Newton adoption note](blueprints/world-compiler-v0.1/r2s2r-newton-2026-07-29/README.md)
also identifies future solver-neutral worker capabilities, solver profiles, jobs, ordered
state/contact/sensor records, and Episode v0.2 proposals. None is an active runtime contract
until strict schemas, examples, migrations, corruption/path tests, and round-trip fixtures
land.

## Canonical World, Asset And Delta Graph

The first active M2 contract slice lives under `contracts/world-graph/v0.1`:

```text
world_studio.world.v0.2
world_studio.asset.v0.1
world_studio.delta.v0.1
```

`world_studio.world.v0.2` intentionally does not reuse the v0.1 identifier. The preserved
source bundle and the curated blueprint contain incompatible proposal-only v0.1 shapes;
both remain historical inputs that require an explicit future migration.

The active records are closed, bounded JSON contracts. They bind content with lowercase
SHA-256, byte size, media type, and safe POSIX-relative paths; identify exact parent
manifests; use canonical SI units; define a connected, acyclic row-major transform graph;
and keep authority and uncertainty explicit for every representation. World and Asset
revisions link immutable content rather than embedding or rewriting prior versions.

AJV schema validation is necessary but not sufficient for acceptance. Readers must also
use the exported World Core semantic validator, which rejects duplicate JSON members,
non-finite values, unsafe paths, invalid graph topology and transforms, and strings beyond
their UTF-8 byte limits. JSON Schema counts Unicode characters rather than encoded bytes,
so the byte bound is intentionally enforced by the semantic layer.

Delta v0.1 records reversible `crop`, `transform`, `filter`, `merge`, `hide`, `replace`,
`objectize`, and `annotate` intents as typed before/after effects. A delta cannot promote
authority or mutate capture evidence. The standalone grammar covers all eight intents, but
the v0.1 transition validator commits only effects that the current immutable snapshots can
materialize: World or Asset artifact edits, World asset membership, and World `manual_edit`
transform edges. It fails closed for `hide`, `annotate`, evidence-owned transform edges, and
unsupported scope/intent combinations until schema-backed state carriers exist. Site
revisions and Site deltas also remain a later contract.

The pure Node canonical package store is the first consumer that persists these records.
It keeps exact manifest bytes in immutable revision directories, uses an atomic
whole-directory rename as the publication commit point, and distinguishes an identical
retry from a same-identity conflict. Recovery and explicit reopen rehash the manifest,
applied Delta, all directly referenced content, and the complete closure of every
referenced Asset before returning a revision. World publication therefore requires each
exact Asset revision to already exist in the same store.

JSON manifests and Delta records require strict, fatal UTF-8 parsing and their declared
`application/json` media type. Opaque media are not decoded or semantically certified: the
store establishes only their declared byte size and SHA-256 unless a format-specific
structural check is explicitly implemented. Passing persistence does not grant metric,
semantic, collision, navigation, physics, or safety authority.

The store root is injected and intended to become
`app.getPath("userData")/world-packages` when Electron integration lands. The current
package reader, renderer, editor, UI, preload/IPC bridge, and startup behavior do not use it.
One Electron main process is the supported writer; foreign live staging fails closed rather
than being reclaimed. Materialized reads are hard-capped at 16 MiB, while streamed
verification and recovery enforce lower-only ceilings of 100,000 stored versions, 1,000,000
aggregate references, and 262,144 content directories.
Historical v0.1 migration, `hide` and `annotate` state carriers, Site revisions, edit
execution, and authority promotion remain later M2 checkpoints.

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

Progressive recording adds two contracts under `contracts/live-session/v0.2` without
changing any v0.1 schema, fixture, route, ACK, or replay behavior:

```text
capture_splat.live_session.v0.2
capture_splat.live_finalize.v0.2
```

The v0.2 session carries a canonical unpadded 32-byte Base64URL seed. Its `csl_` session ID
is derived by hashing the fixed protocol domain, a zero delimiter, and the decoded seed.
The expected frame count is explicitly null while the session is open, so source frames may
arrive before `capture.json` exists. Finalization supplies the final sequence and the
declared `capture.json` path, schema, size, and SHA-256. World Studio persists that exact
binding atomically with the finalized handoff; after sealing, ACKs and snapshots expose the
final sequence as the expected count.

This binds sender-declared manifest identity but does not upload or independently rehash
the `capture.json` bytes. V0.2 handoffs therefore carry
`source_manifest_verification = "declared_checksum_reference_only"`; an authentication
receipt separately proves paired transport ownership when present. Frame and sidecar assets
retain their existing streamed byte/hash verification. The finalized marker remains the
publication commit point, identical retries are idempotent, conflicting bindings fail, and
restart revalidates the binding, handoff, frames, assets, and transport ownership.

## Capture Splat Live Security

M1 security is additive. It does not change the byte-identical M0 session, frame, or ACK
schemas and does not create a second evidence ledger.

The pairing boundary carries:

- a short-lived QR invitation scoped to one desktop identity and one exact TLS endpoint;
- a persistent P-256 desktop identity and pinned self-signed certificate fingerprint;
- a P-256 device identity proved during pairing;
- a finite grant with explicit issuance, expiry, scopes, pairing epoch, and revocation;
- signed request metadata binding credential, method, exact path, content type and length,
  body SHA-256, timestamp, and an unsigned 64-bit request counter.

The implemented persistent security records are
`capture_splat.desktop_identity.v0.1` and `capture_splat.pairing_registry.v0.1`. Capture
Splat owns the canonical M1 wire schemas and fixtures under `contracts/live-auth/v0.1`;
World Studio mirrors those bytes and asserts their fingerprints. The mirrored set covers
the invitation, request, signed grant, authenticated request metadata, authentication
receipt, strict authentication error, and deterministic signing vectors.

The schemas close the wire shape and canonical encodings. Runtime semantic validators also
enforce identity hashes, curve points, permission order, validity intervals, canonical
payload bytes, and signatures that JSON Schema alone cannot prove.

Private keys are never placed in renderer snapshots, Bonjour TXT records, logs, or evidence
packages. The short-lived `pairingInvitationUri` intentionally carries its ephemeral invitation secret
through the trusted Electron IPC boundary so the bundled renderer can draw the QR. It is
cleared when pairing is submitted, cancelled, consumed, or expired and is never advertised,
logged, or persisted with capture evidence.

An authenticated session persists `auth-receipt.json` beside the receiver-owned session
state. Finalized handoffs reference that receipt as `live_auth_receipt`; the receipt records
the paired desktop, device, grant, pairing epoch, permissions, certificate fingerprint,
authentication time, grant expiry, and permanent `proposal_only` authority. Loopback and
paired-LAN sessions cannot claim or resume one another's session IDs.

An authenticated request is authorized before it can reach the M0 session router. JSON
bodies are rehash-checked against the signed digest, while asset uploads additionally
require the signed digest to equal the frame-declared digest before the existing streamed
byte/hash verification can ACK them.

The registry persists the highest accepted counter and a 256-bit sliding replay bitmap per
grant. A previously unseen out-of-order counter inside the window may be accepted once;
duplicates and counters older than the window are rejected after restart. `request_id` is
correlation metadata only. A lost ACK is retried as the same idempotent evidence operation
under a new signed request counter; M0 duplicate handling then returns the existing logical
result.

`LiveSecuritySnapshot` is a bounded UI/IPC contract separate from both `WorldSession` and
`LiveSessionSnapshot`. It reports state, selected interface, TLS endpoint/fingerprint,
pairing expiry, pending device metadata, grants, expiry/revocation, and last authentication.
Its only sensitive field is the short-lived invitation URI described above. It grants no
reconstruction, metric, collision, semantic, navigation, physics, or safety authority.

The iPhone sender and its durable queue/resume records are not implemented in this
checkpoint. Physical Bonjour, firewall, local-network permission, and device-cycle evidence
are also not contract acceptance proof.

## Reconstruction Worker

World Studio owns four active software-worker contracts under
`contracts/reconstruction-worker/v0.1`:

```text
world_studio.reconstruction_worker_capability.v0.1
world_studio.reconstruction_job.v0.1
world_studio.reconstruction_event.v0.1
world_studio.reconstruction_result.v0.1
```

They are closed contracts with finite numeric bounds, safe POSIX-relative paths, lowercase
SHA-256 identities, immutable job/attempt binding, explicit requested resource budgets, and
permanent `proposal_only` authority. Runtime validators additionally enforce canonical IDs,
ordered event sequences, exact job/attempt identity, bounded logs/files/bytes, and file-system
properties that JSON Schema cannot prove.

The result contract describes output proposals; it is not a World Package promotion record.
An output hash proves only the bytes accepted from the configured worker attempt. It grants no
measurement, collision, semantic, navigation, reconstruction-quality, physics, or safety
authority. The production registry is empty in this checkpoint, and the deterministic Node
worker is a test fixture only. This contract does not adopt the blueprint's proposed
`isaac_job.v0.1`, implement Newton, or define physics authority.

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

Keep `world_studio.physical_asset.v0.1` as the proposal identity. Do not introduce a
conflicting `world_studio.physics_asset.v0.1`.
