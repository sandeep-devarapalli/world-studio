# SuperDex Worker Adapter

This one-shot adapter has two explicit supervised modes:

- the existing synthetic capability probe; and
- a registered compiled-scene job that revalidates a checksum-bound World-to-SuperDex package,
  loads its `.mochi_scene`, contacts a named static actor with a 50 mm probe, and restores the
  full scene state three times.

Scene jobs are owner-registered by ID in Electron. Renderer input never supplies a filesystem
path, and a scene request never falls back to the synthetic probe.

Use Python 3.12 in an isolated environment:

```bash
python3.12 -m venv .venv-superdex
.venv-superdex/bin/pip install -r workers/superdex/requirements.txt
.venv-superdex/bin/python workers/superdex/superdex_worker.py \
  --output /tmp/world-studio-superdex-probe.json
```

A passing synthetic report has `software_capability_only` authority. A passing scene receipt has
`compiled_scene_execution_only` authority and binds the job request, package manifest, native
scene, actor inventory, runtime, contact evidence, reset residuals, and receipt bytes by SHA-256.
Neither validates observed-room geometry, collision fidelity, robot assets, navigation, tactile
or deformable simulation, physical prediction, robot training, or performance. Missing or
mismatched packages produce no capability claim. The checksum boundary assumes World Studio's
app-controlled local staging area; it is not a security boundary against another hostile process
running as the same macOS user.

The Electron product can supervise this probe when the owner starts World Studio with an
absolute Python 3.12 environment path:

```bash
WORLD_STUDIO_SUPERDEX_PYTHON="$PWD/.venv-superdex/bin/python" pnpm desktop:dev
```

Electron fixes the bundled script path, accepts only identifiers from the renderer, stages each
registered scene package into a private attempt, verifies strict JSON and every declared file,
stores bounded receipts under its private user-data root, and terminates the worker on stop,
timeout, suspend, lock, app quit, or token-matched desktop restart recovery. Room-01 PLY
ingestion, robot Asset compilation, Franka manipulation, and product UI integration remain
separate later gates.

An active legacy run or retained process group that cannot be matched to its recovery token fails
closed and blocks restart reconciliation; World Studio does not guess at process ownership.
