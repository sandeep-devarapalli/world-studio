# Research sources

Research checked on **29 July 2026**. Primary/current sources were preferred.

## World Labs

1. **Building Worlds That Train Robots**  
   https://www.worldlabs.ai/blog/real-to-sim-to-real  
   Supports: R2S2R framing; one real task expanded into variations; task-aligned observations/dynamics; matched open-loop validation; policy ranking and failure-region evaluation.

2. **A Functional Taxonomy of World Models**  
   https://www.worldlabs.ai/blog/taxonomy-of-world-models  
   Supports: distinction between renderers, simulators, and planners; simulator as structural linchpin.

## Dirac Robotics

3. **Dirac Robotics public site**  
   https://www.diracrobotics.com/  
   Supports: current public emphasis on physics-accurate simulation assets; Real2Sim-generated physical values validated against real objects with stated confidence.

## NVIDIA Isaac Sim

4. **Simulate Robotic Environments Faster with NVIDIA Isaac Sim and World Labs Marble**  
   https://developer.nvidia.com/blog/simulate-robotic-environments-faster-with-nvidia-isaac-sim-and-world-labs-marble/  
   Supports: official dual-artifact workflow—Gaussian PLY/visual USDZ plus GLB collider; alignment and collider activation.

5. **Isaac Sim 6.0.1 download page**  
   https://docs.isaacsim.omniverse.nvidia.com/6.0.1/installation/download.html  
   Supports: 6.0.1 release in June 2026; full Linux/Windows downloads; macOS WebRTC client.

6. **Isaac Sim 6.0.1 requirements**  
   https://docs.isaacsim.omniverse.nvidia.com/6.0.1/installation/requirements.html  
   Supports: x86_64 RTX workstation requirements; Linux-only container; aarch64 currently supported only on DGX Spark.

7. **Isaac Sim setup tips**  
   https://docs.isaacsim.omniverse.nvidia.com/6.0.1/installation/install_faq.html  
   Supports: headless full streaming app on an RTX workstation and WebRTC access from macOS/web.

8. **Isaac Sim reference architecture**  
   https://docs.isaacsim.omniverse.nvidia.com/6.0.1/introduction/reference_architecture.html  
   Supports: geometry authoring, asset import, scene setup, interaction, sensors, extensions, Replicator, and larger-solution framing.

9. **NuRec Rendering Utilities**  
   https://docs.isaacsim.omniverse.nvidia.com/6.0.1/assets/nurec_utils.html  
   Supports: NuRec validation/regression tooling and explicit experimental/future-compatibility warning.

10. **ROS 2 in Isaac Sim**  
    https://docs.isaacsim.omniverse.nvidia.com/6.0.0/ros2_tutorials/ros2_landing_page.html  
    Supports: ROS 2 bridge and recommended Humble/Jazzy distros.

11. **Isaac Sim license FAQ**  
    https://docs.isaacsim.omniverse.nvidia.com/6.0.1/common/license-faq.html  
    Supports: internal R&D, output/custom USD and code cases, redistribution/turnkey service implications.

## Isaac Lab

12. **NVIDIA Isaac Lab**  
    https://developer.nvidia.com/isaac/lab  
    Supports: GPU-accelerated policy training, RL/IL, physics/render/learning flexibility, workstation-to-data-center scale.

13. **Isaac Lab GitHub**  
    https://github.com/isaac-sim/IsaacLab  
    Supports: current release branches and Isaac Sim compatibility matrix; sensor/tooling overview.

14. **Isaac Lab-Arena GitHub**  
    https://github.com/isaac-sim/IsaacLab-Arena  
    Supports: composable scene/task construction and scalable policy evaluation direction. Treat current maturity carefully.

## OpenUSD

15. **OpenUSD introduction**  
    https://openusd.org/release/intro.html  
    Supports: sublayers, references, payloads, variants, sparse non-destructive overrides.

16. **OpenUSD terms and concepts**  
    https://openusd.org/release/glossary.html  
    Supports: composition arcs and list-editable non-destructive scene composition.

17. **OpenUSD performance guidance**  
    https://openusd.org/24.08/maxperf.html  
    Supports: payloads/deferred loading and structuring large scenes.

## Project-provided source material

The blueprint also incorporates the user-provided CaptureSplat/World Studio architecture decisions, the supplied World Labs article text, the prior dual-artifact asset-ingestion note, the NOVA3R amodal-prior note, the MLX-VLM semantic-QA note, and the Spark/Three.js visual-versus-physics clarification.
