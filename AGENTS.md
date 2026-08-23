# AGENTS.md

## Project Rules

- World Studio is Apache 2.0. Do not copy GPL or proprietary runtime code into the shipped
  source tree.
- Spirula Studio is reference/external-process only at audited revision
  `aede0ae3b2d01a7930c71b9c7f52354dc180146b` (GPL-3.0). Do not vendor, translate,
  or copy its implementation block-by-block into World Studio.
- The design source of truth is `docs/source-materials/World Studio.zip`, especially
  `codex.md`, `design.md`, `ws-styles.css`, and the reference screenshots.
- Preserve the six modes: View, Edit, Simulate, Pilot, Sensors, Episode.
- Startup must be explicit. Do not silently auto-load local artifacts.
- Every loaded dataset must show package kind, source path, loaded-via path, primary
  artifact, point counts or bounds when available, and companion artifacts.
- Keep ordinary PLY and Gaussian/splat PLY routes separate.
- Visual/proposal/verified/external-validation states must stay explicit in the UI and data
  contracts.
- A completed 3DGS job remains a visual proposal. It must not auto-load, mutate a World,
  or acquire metric, collision, navigation, semantic, or physics authority.
- Capture Splat handoff v0.3 `training_dataset` is capture evidence only. Validate its
  canonical frame count/digest, projection flags, evidence inventory, and false authority
  claims before exposing it; accept bounded producer profile identifiers such as
  `video_3dgs_max`, and never reinterpret the block as a trainer job or run receipt.
- A Gaussian training seed is a non-negative integer only when the selected provider exposes
  and consumes it. Record `null` when unavailable; never invent deterministic seed evidence.
- Preserve arbitrary SfM/trainer gauge honestly. An unregistered Gaussian frame uses
  `length_unit: unknown` with null up/forward axes and remains visual-only; only accepted
  registration may declare metres and distinct cardinal up/forward axes.
- Treat training-storage quantization and serialized-asset encoding as separate facts. A
  mixed-precision training job may export float32 PLY (`quantization: none`); never label the
  delivery artifact compressed without inspecting its serialized properties.
- The active 3DGS lanes are NeRF Synthetic Lego for deterministic smoke, original-3DGS
  Deep Blending Playroom for the completed real-scene control, Mip-NeRF 360 Bonsai
  `images_2` for the pinned 360 quality lane, and the private Capture Splat fixture as a
  separate capture-to-world lane. Keep every other OneDrive dataset cloud-only unless a
  named gate requires it, and preserve dataset license and checksum evidence.
- Benchmarks gate claims and promotion, not candidate asset formation or the Room-01
  metric/physics path. Keep held results explicit while continuing separately authorized
  world-compilation work.
- Room-01 is the active physics-ready vertical slice: Gaussian appearance stays visual-only,
  while registered metric geometry supplies scale, collision, navigation, and Newton/OpenUSD
  inputs through separate acceptance gates.
- For an interior-only capture, clouding and floaters outside the observed camera volume are
  expected missing-ray behavior. Grade declared interior views and keep training steps distinct
  from retained Gaussian count; unsupported exterior views do not block an experimental World.
- "Both sides" of a doorway means the two spatial sides of one portal, not two physical doors.
  One-sided evidence may form an experimental proxy only when inferred surfaces are explicit
  hypotheses, unknown space is no-go, and every collision/navigation/physics authority is false.
- A deterministic kinematic controller-pose restore is not a full reset claim. Keep
  episode/world-state reset held until a bound episode-state contract is restored and
  verified.
- The first bounded indoor-UAV pilot is M6A immediately after Room-01 passes M6 conformance.
  It does not wait for M7-M9 and grants no outdoor or general UAV readiness.
- Performance and capability claims must bind exact dataset bytes, hardware, commands,
  repetitions, raw results, noise controls, quality gates, and a `promote|hold|reject`
  decision. Hold cross-vendor Vulkan, 10M SH3 in 8GB, native equirectangular, and every
  other unmeasured claim.
- Hold production Spark load claims until measured on the named hardware. Require at least
  20 GiB free before output-producing ladder, packaging, or Spark benchmark runs; do not
  delete datasets or Time Machine snapshots to force the gate. A missed floor holds that run,
  not unrelated roadmap work.
- Use the design tokens and component classes in `packages/design-system`; do not create a
  separate visual language.
- Destructive operations must be undoable and disabled when not applicable.

## Commands

```bash
pnpm install
pnpm dev
pnpm desktop:dev
pnpm test
pnpm typecheck
pnpm test:ui
```

## Upstream References

Local upstream clones live in ignored `references/upstream/`. Track source URL, license,
commit, and usage decision in `docs/upstreams.md` instead of vendoring code casually.
