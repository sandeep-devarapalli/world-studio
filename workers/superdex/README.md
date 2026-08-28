# SuperDex Worker Probe

This one-shot adapter verifies that the pinned SuperDex runtime can initialize on the host,
report only exercised capabilities, and complete a bounded synthetic rigid-body
`spawn -> contact -> reset` smoke fixture. It is not registered as a World Studio product
worker yet.

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
