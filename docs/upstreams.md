# Upstream References

Local clones belong in ignored `references/upstream/`. This manifest records why each repo
is relevant and whether it can be used as a dependency in an Apache 2.0 project.

| Repo | License | World Studio Role | Apache Repo Status |
|---|---:|---|---|
| `sparkjsdev/spark` | MIT | Primary Three.js Gaussian splat renderer candidate. | Safe dependency after API review. |
| `dimforge/rapier` | Apache-2.0 | Current browser/Electron physics implementation and migration parity baseline. | Active but removal-bound after solver-neutral worker cutover; freeze new backend-specific product work. |
| `newton-physics/newton` | Apache-2.0 | Default OpenUSD/general physics runtime through a supervised Python worker. | Planned runtime dependency after pinned local/remote parity, collision, and Episode gates. |
| `facebookresearch/project_superdex` at `1d7150946fa3f3d3fb09c2bff07eaa138cbfdee6` | Apache-2.0 first-party code; CC-BY-4.0 docs/assets; component-specific third-party terms | Contact-rich physics/robotics worker and native Studio behavior reference. | Use pinned `superdex-physics` and `superdex-robotics` packages only after capability gates. Never bundle the GPLv3 `superdex_mesh_cli` or assume bundled asset rights; audit every redistributed asset. |
| `NVIDIA/warp` | Apache-2.0 | Newton compute/runtime foundation and device capability boundary. | Transitive target dependency; pin and report exact version/device capabilities. |
| `playcanvas/splat-transform` | MIT | Splat conversion, filtering, LoD, voxel/collision preprocessing reference/tool. | Safe dependency after CLI/runtime review. |
| `playcanvas/supersplat` | MIT | Browser 3DGS editor UX reference. | Reference or dependency after review. |
| `playcanvas/supersplat-viewer` | MIT | Viewer, LoD, URL parameter, collision asset reference. | Reference or dependency after review. |
| `playcanvas/engine` | MIT | WebGL/WebGPU engine and ammo.js integration reference. | Reference; not default runtime. |
| `playcanvas/pcui` | MIT | Web tool UI patterns; design system remains custom. | Reference; optional dependency. |
| `manycoretech/aholo-viewer` | MIT | Chunked LoD and high-scale 3DGS streaming reference. | Reference or optional dependency after review. |
| `bulletphysics/bullet3` | zlib core; extras require audit | Physics/collision reference and possible native backend reference. | Compatible if core-only; not the target product backend. |
| `google-deepmind/mujoco` | Apache-2.0 | Newton `SolverMuJoCo` CPU and model semantics reference. | Target solver dependency through Newton; effective mesh collision requires explicit validation. |
| `Genesis-Embodied-AI/genesis-world` | Apache-2.0 | Embodied simulation architecture reference. | Reference; Python/runtime-heavy. |
| `allenai/ai2thor` | Apache-2.0 | Embodied AI mode/dataset/sensor inspiration. | Reference only; Unity-bound. |
| `microsoft/AirSim` | MIT | Drone/car API and sensor inspiration. | Reference only; Unreal/Unity-bound. |
| `iamaisim/ProjectAirSim` | MIT | Modern AirSim-style simulation architecture reference. | Reference only; Unreal-bound. |
| `carla-simulator/carla` | MIT code, CC-BY assets, Unreal dependencies | Autonomous driving simulator reference. | Compatible for client/API study; keep simulator runtime external. |
| `isaac-sim/IsaacLab` | BSD-3/Apache-2.0 mix, backend-dependent runtime terms | First external Newton training/evaluation and conformance adapter. | External adapter; Newton backend is beta and requires capability-specific acceptance. |
| `isaac-sim/IsaacSim` | Apache-2.0 source plus NVIDIA component terms | High-fidelity robotics simulation reference. | Reference/external unless NVIDIA runtime terms are accepted. |
| `graphdeco-inria/i3dgs` | Inria research/evaluation license | Immediate unordered 3DGS and global consistency research worker. | Isolated research only; not production-selectable or vendored. |
| `Robbyant/lingbot-map` | Apache-2.0 code; model/data terms require review | Streaming feed-forward reconstruction and progressive world proposal reference. | Optional isolated worker after pinned reproduction and model-term audit. |
| `nepfaff/scalable-real2sim` | MIT top-level code; submodules, weights, BundleSDF, and MOSEK require separate review | Physical Asset Calibration reference for visual/collision separation, instrumented trials, system identification, and validation. | Research reference; do not vendor the full dependency stack. |
| Dirac Robotics public site | No source dependency | Product reference for validated physical asset values and stated confidence. | Competitive/research reference only. |
| World Labs Real-to-Sim-to-Real | No source dependency | Task-level real/sim observation, outcome, failure-region, and policy-ranking reference. | Product/research reference only. |
| `dimforge/salva` | Apache-2.0 | Fluid simulation future reference. | Optional future dependency. |
| `harry7557558/vksplat` | Apache-2.0 | Vulkan 3DGS training reference. | Optional future reference/dependency after build review. |
| `harry7557558/spirula-studio` at `aede0ae3b2d01a7930c71b9c7f52354dc180146b` | GPL-3.0 | Audited reference for Vulkan training, combined optimization, quantization, native projection, correction, preprocessing, and derived-output contracts. | External user-installed process/reference only. Do not vendor, link, translate, or copy implementation code into the Apache source tree. This pin exposes no fixed-seed CLI flag, so jobs record seed `null` and benchmark stochastic runs through repetitions/raw evidence. |
| `MrNeRF/LichtFeld-Studio` | GPL-3.0 | Native 3DGS studio UX reference. | Reference-only unless relicensing is intended. |

## M1 Local Security Utilities

These are narrow host/tool boundaries, not reconstruction or simulation dependencies:

| Component | License/source | World Studio role | Status |
|---|---|---|---|
| macOS `/usr/bin/openssl` | Apple-provided system LibreSSL tool | Issues the local self-signed certificate for the protected P-256 desktop identity. Invoked by absolute path without a shell. | Active macOS system boundary; no source or binary vendored. |
| macOS `/usr/bin/dns-sd` | Apple-provided Bonjour system tool | Publishes `_capturesplat._tcp` only after explicit interface selection and pairing/secure-listen action. It does not browse for or trust hosts. | Active macOS system boundary; no source or binary vendored. |
| `soldair/node-qrcode` (`qrcode` 1.5.4; `@types/qrcode` 1.5.6) | MIT | Browser-bundled QR image generation for the short-lived pairing invitation. | Adopted in the web package; Vite bundles it, so it is not a desktop runtime dependency. |

The Bonjour TXT allowlist contains public protocol mode, desktop identity, TLS fingerprint,
transport, and authentication-algorithm metadata only. Pairing secrets, verification codes,
device grants, private keys, and request counters must never be advertised.
