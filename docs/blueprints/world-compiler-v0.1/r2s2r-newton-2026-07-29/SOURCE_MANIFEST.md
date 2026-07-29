# Source Manifest

This manifest records the supplied inputs, the public Markdown files derived from them,
and the publication boundary. Hashes use SHA-256.

## Supplied Inputs

| Supplied artifact | SHA-256 | Publication treatment |
|---|---|---|
| `dirac-real2sim-r2s2r-roadmap-codex-bundle.zip` | `acebb62e51d2e6b06447abcf5cfa311b5c52c435499d5b535f350d094ad53243` | Binary ZIP omitted; both Markdown members published byte-identically |
| Saved research conversation HTML | `1f8289678caec919a4c5cdc783f9caa96807819b7e65802129c04b5d8b4ad510` | Raw page omitted because it contains private conversation links, local paths, repeated generated text, and UI telemetry |
| R2S2R operating-system pasted brief | `50de329d58782b06e183e83663e39b11a5d6b66f01b4c0764add6a76636b4160` | Published with three dead research-sandbox links replaced by plain source-attachment notes |
| Newton target-backend pasted brief | `4fa3830a47ea7a086c0554372c932cf911813c3dd2f1ff27a320829ca7157999` | Published with dead links to an unavailable Newton bundle replaced by plain source-attachment notes |

## Published Markdown

| File | SHA-256 | Relationship |
|---|---|---|
| [`source/DIRAC_REAL2SIM_R2S2R_ROADMAP_PLAN.md`](source/DIRAC_REAL2SIM_R2S2R_ROADMAP_PLAN.md) | `31047466546784264bf79f150bde491e44bb550cdb8fcdce525c07fad3eda977` | Byte-identical ZIP member |
| [`source/CODEX_UPDATE_CAPTURE_SPLAT_WORLD_STUDIO_R2S2R.md`](source/CODEX_UPDATE_CAPTURE_SPLAT_WORLD_STUDIO_R2S2R.md) | `2df0df501f42e0689cae5827fc905e5355db45a80abe8a2db9e677a3da4fffa0` | Byte-identical ZIP member |
| [`source/CAPTURE_SPLAT_WORLD_STUDIO_R2S2R_OPERATING_SYSTEM.md`](source/CAPTURE_SPLAT_WORLD_STUDIO_R2S2R_OPERATING_SYSTEM.md) | `1bdf3a579fdcebd089638080b27f23dd23a7687088d0168826affb618a5be31c` | Public-safe pasted brief |
| [`source/NEWTON_TARGET_PHYSICS_BACKEND.md`](source/NEWTON_TARGET_PHYSICS_BACKEND.md) | `763bf57376886f1e954c236a7a418c6b2b503d823326a6060f7c34b0b5458af5` | Public-safe pasted brief |
| [`source/CHATGPT_RESEARCH_NOTES.md`](source/CHATGPT_RESEARCH_NOTES.md) | `13e3522e3f16a6964ffedcdf8e64d22de913f06b6cf054155ce06f8aff147b4d` | Curated, non-verbatim research digest |

The hashes above pin this initial publication. A future edit to a source-derived file must
update this manifest and explain why the provenance copy changed.

## Saved-Page Support Directory

The 47 browser support files were not copied into Git. They are CSS, JavaScript, favicon,
image, and saved-frame resources needed to reopen the private saved page, not independent
roadmap sources. [`HTML_AUXILIARY_MANIFEST.md`](HTML_AUXILIARY_MANIFEST.md) records every
filename and hash.

## Authority

Source material is not an active contract or implementation claim. Canonical decisions are
the curated documents in this folder, the root roadmap, and the active runtime contracts.
