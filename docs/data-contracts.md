# Data Contracts

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

