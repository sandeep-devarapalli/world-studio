# Upstream References

Local clones belong in ignored `references/upstream/`. This manifest records why each repo
is relevant and whether it can be used as a dependency in an Apache 2.0 project.

| Repo | License | World Studio Role | Apache Repo Status |
|---|---:|---|---|
| `sparkjsdev/spark` | MIT | Primary Three.js Gaussian splat renderer candidate. | Safe dependency after API review. |
| `dimforge/rapier` | Apache-2.0 | Primary browser/Electron physics engine. | Safe dependency. |
| `playcanvas/splat-transform` | MIT | Splat conversion, filtering, LoD, voxel/collision preprocessing reference/tool. | Safe dependency after CLI/runtime review. |
| `playcanvas/supersplat` | MIT | Browser 3DGS editor UX reference. | Reference or dependency after review. |
| `playcanvas/supersplat-viewer` | MIT | Viewer, LoD, URL parameter, collision asset reference. | Reference or dependency after review. |
| `playcanvas/engine` | MIT | WebGL/WebGPU engine and ammo.js integration reference. | Reference; not default runtime. |
| `playcanvas/pcui` | MIT | Web tool UI patterns; design system remains custom. | Reference; optional dependency. |
| `manycoretech/aholo-viewer` | MIT | Chunked LoD and high-scale 3DGS streaming reference. | Reference or optional dependency after review. |
| `bulletphysics/bullet3` | zlib core; extras require audit | Physics/collision reference and possible native backend reference. | Compatible if core-only; Rapier is default. |
| `google-deepmind/mujoco` | Apache-2.0 | Articulated robotics physics reference. | Reference; native runtime is not default. |
| `Genesis-Embodied-AI/genesis-world` | Apache-2.0 | Embodied simulation architecture reference. | Reference; Python/runtime-heavy. |
| `allenai/ai2thor` | Apache-2.0 | Embodied AI mode/dataset/sensor inspiration. | Reference only; Unity-bound. |
| `microsoft/AirSim` | MIT | Drone/car API and sensor inspiration. | Reference only; Unreal/Unity-bound. |
| `iamaisim/ProjectAirSim` | MIT | Modern AirSim-style simulation architecture reference. | Reference only; Unreal-bound. |
| `carla-simulator/carla` | MIT code, CC-BY assets, Unreal dependencies | Autonomous driving simulator reference. | Compatible for client/API study; keep simulator runtime external. |
| `isaac-sim/IsaacLab` | BSD-3/Apache-2.0 mix, Isaac Sim dependency | Robot learning/sensor sim reference. | Compatible source reference; runtime depends on Isaac Sim. |
| `isaac-sim/IsaacSim` | Apache-2.0 source plus NVIDIA component terms | High-fidelity robotics simulation reference. | Reference/external unless NVIDIA runtime terms are accepted. |
| `dimforge/salva` | Apache-2.0 | Fluid simulation future reference. | Optional future dependency. |
| `harry7557558/vksplat` | Apache-2.0 | Vulkan 3DGS training reference. | Optional future reference/dependency after build review. |
| `MrNeRF/LichtFeld-Studio` | GPL-3.0 | Native 3DGS studio UX reference. | Reference-only unless relicensing is intended. |
