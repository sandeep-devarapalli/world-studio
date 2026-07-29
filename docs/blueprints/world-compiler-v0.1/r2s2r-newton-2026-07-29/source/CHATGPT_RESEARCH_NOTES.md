# Saved Research Conversation Notes

These notes distill the product and technical decisions relevant to Capture Splat and
World Studio from the supplied saved research conversation. The corresponding
message-level preservation copy is
[`CHATGPT_RESEARCH_TRANSCRIPT.md`](CHATGPT_RESEARCH_TRANSCRIPT.md).

The raw saved page is not published. It contains private conversation links, a local
filesystem path, hidden tool traces, repeated generated text, and application telemetry.
The public transcript keeps all six visible user/final-assistant messages while excluding
those non-conversation elements. The raw page SHA-256 and support-directory file manifest
are recorded in
[`../SOURCE_MANIFEST.md`](../SOURCE_MANIFEST.md) and
[`../HTML_AUXILIARY_MANIFEST.md`](../HTML_AUXILIARY_MANIFEST.md).

## Adopted Direction

- Capture Splat writes accepted evidence locally before attempting any network transfer.
- A bounded, authenticated, resumable sender may stream accepted frames and sidecars to
  World Studio without changing capture acceptance or finalization.
- World Studio treats incoming frames, depth, poses, mesh, and progressive reconstruction
  as proposal evidence until explicit import and validation.
- Immediate feedback has three distinct levels:
  1. ARKit cameras, depth points, mesh, and trajectory;
  2. optional feed-forward geometry and pose proposals;
  3. progressive Gaussian checkpoints followed by the existing global reconstruction and
     fixed-camera quality ladder.
- Gaussian appearance remains separate from metric geometry, collision, semantics,
  navigation, and physics authority.
- Spark and Three.js remain the visual composition layer.
- Newton becomes the target physics runtime through a supervised worker and gated
  migration. Rapier remains transitional only until parity evidence permits removal.

## Upstream Roles

- `graphdeco-inria/i3dgs` is an isolated research comparator for unordered immediate
  reconstruction. Its noncommercial research boundary prevents production adoption
  without separate permission.
- `Robbyant/lingbot-map` is a candidate feed-forward preview worker. Its outputs remain
  geometry and pose proposals, not canonical reconstruction or metric authority.
- SuperSplat is an editor workflow reference; it is not treated as an embeddable editor
  component by default.
- `playcanvas/splat-transform` is a candidate pinned worker for reversible transforms,
  filtering, merging, and distribution-format preparation.
- `supersplat-viewer` is a future publishing and viewer-conformance option, not a
  replacement for the integrated simulation renderer.
- Isaac Lab, Isaac RTX, Isaac Sim, ROS 2, and other simulators remain external adapters
  with explicit capabilities and conformance reports.

## R2S2R Lessons

- A useful simulation need not reproduce every detail. It must reproduce the observations,
  state transitions, contacts, outcomes, failure regions, and policy rankings relevant to
  one declared task.
- Visual plausibility, a finite asset, successful import, or a completed simulation run
  does not establish predictive validity.
- Real and simulated trials need matched initial state, task script, robot and sensor
  versions, clocks, metrics, and immutable evidence.
- Deployment recaptures create new site revisions and impact reports. They never overwrite
  the prior World.
- Promotion requires explicit `approved_for` and `not_approved_for` uses, uncertainty,
  held-out evidence, and rollback criteria.

## Material Not Adopted As Fact

- Proprietary product claims from public marketing pages are not reproducible methods.
- Numerical pilot targets and delivery schedules in generated planning material are
  hypotheses, not commitments.
- A simulator or asset is not universally “physics accurate.” Public wording remains
  “physics-calibrated within a validated task envelope.”
- The missing Newton bundle referenced by the conversation was not available for direct
  validation. Canonical adoption documents were rebuilt from the supplied brief and
  current primary sources.
