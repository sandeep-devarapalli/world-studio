import type {
  CanonicalAuthorityV1,
  CanonicalContentReferenceV1,
  CanonicalReadinessLaneV1,
  CanonicalUncertaintyV1,
  CanonicalVersionReferenceV1,
} from "./world-graph-contract.js";

export const SUPERDEX_SCENE_PACKAGE_SCHEMA = "world_studio.superdex_scene_package.v0.1" as const;
export const SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA = "world_studio.superdex_scene_compile_report.v0.1" as const;
export const SUPERDEX_SCENE_COMPILER_ID = "world-studio-superdex-scene-compiler" as const;
export const SUPERDEX_SCENE_COMPILER_VERSION = "0.1.0" as const;

export interface SuperDexActorTransformV1 {
  translation_m: [number, number, number];
  rotation_xyzw: [number, number, number, number];
  uniform_scale: number;
}

export interface SuperDexCompiledColliderV1 {
  actor_name: string;
  source_artifact_id: string;
  source_world_content: CanonicalContentReferenceV1;
  compiled_mesh: CanonicalContentReferenceV1;
  frame_id: string;
  transform_ids: string[];
  world_from_local_row_major: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
  ];
  actor_transform: SuperDexActorTransformV1;
  vertex_count: number;
  triangle_count: number;
  authority: CanonicalAuthorityV1;
  uncertainty: CanonicalUncertaintyV1;
}

export interface SuperDexScenePackageV1 {
  schema: typeof SUPERDEX_SCENE_PACKAGE_SCHEMA;
  package_id: string;
  source_world: CanonicalVersionReferenceV1 & { kind: "world" };
  source_world_manifest: CanonicalContentReferenceV1;
  compiler: {
    id: typeof SUPERDEX_SCENE_COMPILER_ID;
    version: typeof SUPERDEX_SCENE_COMPILER_VERSION;
  };
  target: {
    backend_id: "superdex";
    backend_version: "1.0.0";
    adapter_version: "0.1.0";
    scene_format: "superdex_mochi_scene";
    coordinate_frame: "right_y_up";
    actor_kind: "static_rigid";
    collider_type: "Mesh";
  };
  authority_effect: "preserved_without_promotion";
  source_collision_readiness: CanonicalReadinessLaneV1;
  scene: CanonicalContentReferenceV1;
  colliders: SuperDexCompiledColliderV1[];
  report: CanonicalContentReferenceV1;
  limitations: string[];
}

export interface SuperDexSceneCompileReportV1 {
  schema: typeof SUPERDEX_SCENE_COMPILE_REPORT_SCHEMA;
  package_id: string;
  source_world: CanonicalVersionReferenceV1 & { kind: "world" };
  selected_collision_artifact_ids: string[];
  excluded_artifacts: Array<{
    artifact_id: string;
    role: string;
    reason: "not_collision_lane_evidence" | "not_collision_mesh";
  }>;
  excluded_asset_dependencies: CanonicalVersionReferenceV1[];
  checks: {
    canonical_world_store: "passed";
    source_manifest_hash: "passed";
    source_content_hashes: "passed";
    obj_geometry: "passed";
    transform_decomposition: "passed";
    native_superdex_load: "not_run";
  };
  authority_effect: "preserved_without_promotion";
  limitations: string[];
}

export interface SuperDexSceneCompileResultV1 {
  output_root: string;
  manifest: SuperDexScenePackageV1;
  manifest_reference: CanonicalContentReferenceV1;
}
