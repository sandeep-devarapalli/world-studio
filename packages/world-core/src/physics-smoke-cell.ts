import {
  SIMULATION_BACKEND_REQUIREMENTS_SCHEMA,
  type SimulationBackendRequirementsV1
} from "./simulation-backend-contract.js";

export const PHYSICS_SMOKE_JOB_SCHEMA = "world_studio.physics_smoke_job.v0.1" as const;

export interface PhysicsSmokeJobV1 {
  schema: typeof PHYSICS_SMOKE_JOB_SCHEMA;
  job_id: "synthetic-bounded-cpu-smoke-cell-v1";
  world_layer: "world.usda";
  device_class: "cpu";
  frame_timestep_seconds: number;
  substeps: number;
  frames_per_repetition: number;
  repetitions: number;
  seed: number;
  reset_between_repetitions: true;
  acceptance: {
    required_contact_prims: string[];
    maximum_absolute_position_m: [number, number, number];
    reset_position_tolerance_m: number;
    reset_orientation_tolerance_rad: number;
    reset_linear_velocity_tolerance_m_s: number;
    reset_angular_velocity_tolerance_rad_s: number;
  };
}

export interface PhysicsSmokeCellBundleV1 {
  job: PhysicsSmokeJobV1;
  backendRequirements: SimulationBackendRequirementsV1;
  files: Record<
    | "world.usda"
    | "10_smoke_collision.usda"
    | "20_room01_collision_held.usda"
    | "physics-smoke-job.json"
    | "physics-smoke-backend-requirements.json",
    string
  >;
}

const cube = (name: string, scale: [number, number, number], translate: [number, number, number]) => `
        def Cube "${name}" (
            prepend apiSchemas = ["PhysicsCollisionAPI"]
        )
        {
            double size = 1
            bool physics:collisionEnabled = true
            double3 xformOp:scale = (${scale.join(", ")})
            double3 xformOp:translate = (${translate.join(", ")})
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
        }
`;

export function compilePhysicsSmokeCell(): PhysicsSmokeCellBundleV1 {
  const job: PhysicsSmokeJobV1 = {
    schema: PHYSICS_SMOKE_JOB_SCHEMA,
    job_id: "synthetic-bounded-cpu-smoke-cell-v1",
    world_layer: "world.usda",
    device_class: "cpu",
    frame_timestep_seconds: 1 / 60,
    substeps: 4,
    frames_per_repetition: 180,
    repetitions: 3,
    seed: 0,
    reset_between_repetitions: true,
    acceptance: {
      required_contact_prims: ["/World/SmokeCell/Floor", "/World/SmokeCell/EastWall"],
      maximum_absolute_position_m: [1.7, 2, 1.7],
      reset_position_tolerance_m: 1e-6,
      reset_orientation_tolerance_rad: 1e-6,
      reset_linear_velocity_tolerance_m_s: 1e-6,
      reset_angular_velocity_tolerance_rad_s: 1e-6
    }
  };
  const backendRequirements: SimulationBackendRequirementsV1 = {
    schema: SIMULATION_BACKEND_REQUIREMENTS_SCHEMA,
    device_class: "cpu",
    scene_format: "openusd",
    coordinate_frame: "right_y_up",
    required_capabilities: [
      "rigid_body",
      "primitive_contact",
      "contact_points",
      "deterministic_reset"
    ]
  };

  const root = `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    subLayers = [
        @10_smoke_collision.usda@,
        @20_room01_collision_held.usda@
    ]
    upAxis = "Y"
)

def Xform "World"
{
}
`;
  const collision = `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "World"
{
    def PhysicsScene "PhysicsScene"
    {
        vector3f physics:gravityDirection = (0, -1, 0)
        float physics:gravityMagnitude = 9.81
    }

    def Xform "SmokeCell" (
        customData = {
            string authority = "synthetic_fixture_only"
            string purpose = "bounded_newton_cpu_smoke"
        }
    )
    {${cube("Floor", [4, 0.1, 4], [0, -0.05, 0])}${cube("NorthWall", [4, 2.5, 0.1], [0, 1.25, -1.95])}${cube("SouthWall", [4, 2.5, 0.1], [0, 1.25, 1.95])}${cube("EastWall", [0.1, 2.5, 3.8], [1.95, 1.25, 0])}${cube("WestWall", [0.1, 2.5, 3.8], [-1.95, 1.25, 0])}
        def Capsule "Probe" (
            prepend apiSchemas = ["PhysicsCollisionAPI", "PhysicsRigidBodyAPI", "PhysicsMassAPI"]
            customData = {
                double initialLinearVelocityXMetersPerSecond = 1.5
                string role = "solver_neutral_dynamic_probe"
            }
        )
        {
            uniform token axis = "Y"
            double height = 1
            double radius = 0.25
            bool physics:collisionEnabled = true
            double physics:mass = 1
            bool physics:rigidBodyEnabled = true
            vector3f physics:velocity = (1.5, 0, 0)
            double3 xformOp:translate = (0, 0.75, 0)
            uniform token[] xformOpOrder = ["xformOp:translate"]
        }
    }
}
`;
  const heldRoom = `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "World"
{
    def Scope "Room01Collision" (
        customData = {
            string authority = "held"
            string[] approvedFor = []
            string[] notApprovedFor = ["collision", "navigation", "physics"]
            string reason = "Room-01 collider is incomplete and intentionally omitted"
        }
    )
    {
    }
}
`;

  return {
    job,
    backendRequirements,
    files: {
      "world.usda": root,
      "10_smoke_collision.usda": collision,
      "20_room01_collision_held.usda": heldRoom,
      "physics-smoke-job.json": `${JSON.stringify(job, null, 2)}\n`,
      "physics-smoke-backend-requirements.json": `${JSON.stringify(
        backendRequirements,
        null,
        2
      )}\n`
    }
  };
}
