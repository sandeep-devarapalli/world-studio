# loft_04 · v3 — example dataset

The same indoor scene rendered by every mode of the World Studio prototype, exported in
standard formats. Generated deterministically by `ws-render.js buildScene(seed=1337)` —
these files and the in-app renders are the SAME data.

| File | Render mode it drives | Format |
|---|---|---|
| `gaussians.ply` | Gaussians | INRIA 3DGS PLY (ASCII, SH degree 0: pos, normal, f_dc, opacity, scale, rot) |
| `points.ply` | Points / Semantic / Depth | PLY (ASCII): xyz + shaded RGB + uchar semantic label (0–8) |
| `collision_mesh.obj` + `.mtl` | Mesh | Wavefront OBJ, one object per box primitive, materials = flat semantic palette |
| `scene.json` | — | Manifest: class table, counts, room bounds, agent spawn |

Y-up, meters. The prototype's "splat" counts (10,05,385) are display fiction at ~59
display-splats per data point; these files contain the true 16060 points / 13 boxes.
