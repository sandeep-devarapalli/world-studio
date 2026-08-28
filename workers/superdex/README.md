# SuperDex Worker Probe

This one-shot adapter verifies that the pinned SuperDex runtime can initialize on the host,
report only exercised capabilities, and complete a bounded synthetic rigid-body
`spawn -> contact -> reset` smoke fixture. World Studio registers it only as a supervised
capability probe, not as a scene-execution worker.

Use Python 3.12 in an isolated environment:

```bash
python3.12 -m venv .venv-superdex
.venv-superdex/bin/pip install -r workers/superdex/requirements.txt
.venv-superdex/bin/python workers/superdex/superdex_worker.py \
  --output /tmp/world-studio-superdex-probe.json
```

A passing report has `software_capability_only` authority. It does not validate observed-room
geometry, robot assets, tactile or deformable simulation, physical prediction, or performance.
Missing or mismatched packages produce an unavailable report without advertising capabilities.

The Electron product can supervise this probe when the owner starts World Studio with an
absolute Python 3.12 environment path:

```bash
WORLD_STUDIO_SUPERDEX_PYTHON="$PWD/.venv-superdex/bin/python" pnpm desktop:dev
```

Electron fixes the bundled script path, accepts only worker/run IDs from the renderer, stores
bounded reports under its private user-data root, verifies the strict report and SHA-256 before
publication, and terminates the worker on stop, timeout, suspend, lock, or app quit. This
lifecycle does not yet load a World, compile a SuperDex scene, or run a robot episode.
