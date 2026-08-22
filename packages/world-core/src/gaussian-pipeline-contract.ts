import {
  parseCanonicalGraphJson,
  safeCanonicalRelativePath,
  stableCanonicalJson,
  validateCanonicalSha256,
  validateCanonicalTimestamp,
} from "./world-graph-contract.js";

export const GAUSSIAN_TRAINING_JOB_SCHEMA = "world_studio.gaussian_training_job.v0.1" as const;
export const GAUSSIAN_ASSET_SCHEMA = "world_studio.gaussian_asset.v0.1" as const;
export const GAUSSIAN_BENCHMARK_REPORT_SCHEMA = "world_studio.gaussian_benchmark_report.v0.1" as const;
export const CAPTURE_SPLAT_TRAINING_DATASET_SCHEMA = "capture_splat.training_dataset.v0.1" as const;

export type GaussianFixtureKind = "standard" | "local_capture";
export type GaussianFixtureState = "metadata_only" | "hydrated";
export type GaussianCameraModel = "pinhole" | "fisheye" | "equirectangular";
export type GaussianFormat = "ply" | "spz" | "rad";
export type GaussianTrainingStorageQuantization = "none" | "fp16" | "int8" | "mixed";
export type GaussianSerializedAssetQuantization = "none" | "fp16" | "int8" | "mixed";
export type GaussianDecision = "promote" | "hold" | "reject";
export type CaptureSplatProjectionMode =
  | "perspective"
  | "projected_pinhole_from_equirectangular"
  | "native_equirectangular"
  | "unresolved_equirectangular_source"
  | "unresolved_360_source";
export type GaussianClaimId =
  | "cross_vendor_vulkan"
  | "ten_million_sh3_in_8gb"
  | "native_equirectangular"
  | "quantized_training"
  | "combined_quality_strategy"
  | "exposure_white_balance"
  | "built_in_preprocessing"
  | "depth_normal_mesh_skybox";

type CaptureSplatRegisteredRgbdOverlapV1 =
  | {
      available: true;
      matching: "unique_case_sensitive_rgb_basename_with_same_root_rgb_and_depth_v1";
      depth_bearing_capture_frame_count: number;
      matched_count: number;
      matched_name_digest: string;
      ambiguous_basename_count: number;
      unmatched_registered_image_count: number;
    }
  | {
      available: false;
      reason:
        | "colmap_images_unavailable"
        | "colmap_images_parse_incomplete"
        | "capture_manifest_unavailable"
        | "capture_frames_invalid";
      matching: "unique_case_sensitive_rgb_basename_with_same_root_rgb_and_depth_v1";
      depth_bearing_capture_frame_count: number;
      matched_count: number;
      ambiguous_basename_count: number;
      unmatched_registered_image_count: number;
    };

interface CaptureSplatSfmEvidenceV1 {
  available: boolean;
  camera_count: number;
  camera_models: string[];
  registered_images_available: boolean;
  sparse_points_available: boolean;
  asset: "colmap_sparse" | null;
}

interface CaptureSplatMeasuredSfmEvidenceV1 extends CaptureSplatSfmEvidenceV1 {
  registered_image_count: number;
  registered_image_parse_status: "complete" | "partial" | "unavailable";
  registered_image_invalid_record_count: number;
  registered_image_name_digest: string | null;
  registered_rgbd_overlap_count: number | null;
  registered_rgbd_overlap: CaptureSplatRegisteredRgbdOverlapV1;
}

export interface CaptureSplatTrainingDatasetV1 {
  schema: typeof CAPTURE_SPLAT_TRAINING_DATASET_SCHEMA;
  capture_profile: string;
  source_frame_set: {
    count: number;
    digest: string;
    canonicalization: "utf8_relative_path_nul_size_nul_sha256_lf_v1";
  };
  projection: {
    mode: CaptureSplatProjectionMode;
    source_is_equirectangular: boolean | null;
    training_images_are_projected_pinhole: boolean;
    native_equirectangular: boolean;
    rig_evidence:
      | { available: false }
      | {
          available: true;
          schema: "capture_splat.equirectangular_rig.v0.1";
          checksum: string;
        };
  };
  evidence: {
    capture_manifest: { available: boolean; asset: "capture_manifest" | null };
    sfm: CaptureSplatSfmEvidenceV1 | CaptureSplatMeasuredSfmEvidenceV1;
    depth: { referenced_frame_count: number; available_frame_count: number };
    confidence: { referenced_frame_count: number; available_frame_count: number };
    masks: { referenced_frame_count: number; available_frame_count: number };
    mesh: {
      available: boolean;
      asset: "navigation_mesh" | null;
      report_available: boolean;
      report_asset: "mesh_report" | null;
    };
  };
  authority: {
    capture_evidence_only: true;
    trainer_consumption_claim: false;
    training_execution_authority: false;
    quality_claim: false;
    metric_authority: false;
    collision_authority: false;
  };
}

export interface GaussianContentReferenceV1 {
  path: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
}

export interface GaussianDatasetReferenceV1 {
  fixture_id: string;
  kind: GaussianFixtureKind;
  storage_state: GaussianFixtureState;
  manifest: GaussianContentReferenceV1;
}

export interface GaussianTrainingJobV1 {
  schema: typeof GAUSSIAN_TRAINING_JOB_SCHEMA;
  job_id: string;
  created_at: string;
  dataset: GaussianDatasetReferenceV1;
  worker: {
    integration: "external_process";
    implementation_id: string;
    version: string;
    source_url: string;
    source_revision: string;
    license_id: string;
    build_sha256: string | null;
  };
  inputs: Array<{
    role: "images" | "cameras" | "capture_manifest" | "video" | "frame_index" | "masks" | "depth" | "normals" | "mesh";
    content: GaussianContentReferenceV1;
  }>;
  profile: {
    camera_model: GaussianCameraModel;
    native_projection: boolean;
    optimization_components: Array<"mcmc" | "igs_plus" | "mrnf">;
    iterations: number;
    seed: number | null;
    sh_degree: 0 | 1 | 2 | 3;
    max_gaussians: number;
    quantization: GaussianTrainingStorageQuantization;
    color_space: "linear" | "srgb";
    exposure_correction: "none" | "bilateral_grid" | "ppisp" | "bilateral_grid_ppisp";
    white_balance_correction: "none" | "bilateral_grid" | "ppisp" | "bilateral_grid_ppisp";
    preprocessing: {
      frame_extraction: "none" | "provided" | "built_in";
      sfm: "none" | "provided" | "built_in";
      masking: "none" | "provided" | "built_in_ai";
      depth: "none" | "provided" | "estimated";
      normals: "none" | "provided" | "estimated";
    };
    outputs: {
      gaussian_formats: GaussianFormat[];
      depth: boolean;
      normals: boolean;
      mesh: boolean;
      skybox: boolean;
    };
  };
  budget: {
    wall_time_ms: number;
    memory_bytes: number;
    output_bytes: number;
  };
  authority: "proposal_only";
  loaded_world_effect: "none";
}

export interface GaussianAssetV1 {
  schema: typeof GAUSSIAN_ASSET_SCHEMA;
  asset_id: string;
  created_at: string;
  training_job: { job_id: string; manifest_sha256: string };
  dataset: { fixture_id: string; manifest_sha256: string };
  primary: GaussianContentReferenceV1 & { format: GaussianFormat };
  representation: {
    source_splat_count: number;
    splat_count: number;
    sh_degree: 0 | 1 | 2 | 3;
    quantization: GaussianSerializedAssetQuantization;
    color_space: "linear" | "srgb";
    coordinate_frame: GaussianCoordinateFrameV1;
    camera_models: GaussianCameraModel[];
  };
  sidecars: Array<{
    role: "cameras" | "depth" | "normals" | "mesh" | "skybox" | "exposure" | "white_balance";
    content: GaussianContentReferenceV1;
  }>;
  validation: {
    status: "passed" | "failed" | "not_run";
    nonfinite_value_count: number;
    removed_splat_count: number;
    report: GaussianContentReferenceV1;
  };
  authority: "visual_proposal";
  loaded_world_effect: "none";
  prohibited_uses: ["metric_measurement", "collision", "navigation", "physics"];
}

export type GaussianAxisV1 = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";

export type GaussianCoordinateFrameV1 =
  | {
      frame_id: string;
      length_unit: "m";
      handedness: "right" | "left";
      up_axis: GaussianAxisV1;
      forward_axis: GaussianAxisV1;
    }
  | {
      frame_id: string;
      length_unit: "unknown";
      handedness: "right" | "left";
      up_axis: null;
      forward_axis: null;
    };

export interface GaussianDistributionV1 {
  samples: number;
  minimum: number;
  median: number;
  p95: number;
  maximum: number;
}

export interface GaussianBenchmarkReportV1 {
  schema: typeof GAUSSIAN_BENCHMARK_REPORT_SCHEMA;
  report_id: string;
  created_at: string;
  subject: {
    job_id: string;
    job_manifest_sha256: string;
    asset_id: string;
    asset_manifest_sha256: string;
    dataset_fixture_id: string;
    dataset_manifest_sha256: string;
  };
  environment: {
    hardware_id: string;
    os: string;
    architecture: string;
    cpu: string;
    gpu: string;
    gpu_api: "vulkan" | "metal" | "cuda" | "webgpu" | "cpu";
    memory_bytes: number;
    power_mode: string;
    thermal_state: string;
    world_studio_revision: string;
    spark_version: "2.1.0";
  };
  execution: {
    fixture_state: GaussianFixtureState;
    build_mode: "release" | "production";
    command_argv: string[];
    cold_runs: number;
    warmup_runs: number;
    measured_runs: number;
    concurrency: number;
    noise_controls: string[];
  };
  raw_results: GaussianContentReferenceV1 | null;
  quality_camera_set: GaussianContentReferenceV1 | null;
  baseline_report: GaussianContentReferenceV1 | null;
  metrics: {
    training_wall_time_ms: GaussianDistributionV1 | null;
    peak_memory_bytes: GaussianDistributionV1 | null;
    peak_device_memory_bytes: GaussianDistributionV1 | null;
    first_visible_ms: GaussianDistributionV1 | null;
    frame_time_ms: GaussianDistributionV1 | null;
    psnr_db: GaussianDistributionV1 | null;
    ssim: GaussianDistributionV1 | null;
    mae: GaussianDistributionV1 | null;
  };
  claims: Array<{
    claim_id: GaussianClaimId;
    decision: GaussianDecision;
    evidence: GaussianContentReferenceV1[];
    limitation: string;
  }>;
  decision: GaussianDecision;
  limitations: string[];
  authority: "evidence_only";
}

export class GaussianPipelineContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GaussianPipelineContractError";
  }
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const gitRevisionPattern = /^[0-9a-f]{40}$/;
const allClaimIds: GaussianClaimId[] = [
  "cross_vendor_vulkan",
  "ten_million_sh3_in_8gb",
  "native_equirectangular",
  "quantized_training",
  "combined_quality_strategy",
  "exposure_white_balance",
  "built_in_preprocessing",
  "depth_normal_mesh_skybox",
];

export function parseGaussianPipelineJson(text: string): unknown {
  try {
    return parseCanonicalGraphJson(text);
  } catch (error) {
    throw new GaussianPipelineContractError(error instanceof Error ? error.message : "Invalid JSON.");
  }
}

export function stableGaussianPipelineJson(value: unknown): string {
  try {
    return stableCanonicalJson(value);
  } catch (error) {
    throw new GaussianPipelineContractError(error instanceof Error ? error.message : "Invalid JSON value.");
  }
}

export function validateCaptureSplatTrainingDataset(value: unknown): CaptureSplatTrainingDatasetV1 {
  const dataset = record(value, "Capture Splat training_dataset");
  exactKeys(dataset, ["schema", "capture_profile", "source_frame_set", "projection", "evidence", "authority"], "Capture Splat training_dataset");
  literal(dataset.schema, CAPTURE_SPLAT_TRAINING_DATASET_SCHEMA, "Capture Splat training_dataset schema");

  const frameSet = record(dataset.source_frame_set, "Capture Splat source_frame_set");
  exactKeys(frameSet, ["count", "digest", "canonicalization"], "Capture Splat source_frame_set");
  literal(frameSet.canonicalization, "utf8_relative_path_nul_size_nul_sha256_lf_v1", "Capture Splat source_frame_set canonicalization");
  const sourceFrameCount = integer(frameSet.count, "Capture Splat source frame count", 1);

  const projection = record(dataset.projection, "Capture Splat projection");
  exactKeys(projection, ["mode", "source_is_equirectangular", "training_images_are_projected_pinhole", "native_equirectangular", "rig_evidence"], "Capture Splat projection");
  const mode = oneOf(projection.mode, ["perspective", "projected_pinhole_from_equirectangular", "native_equirectangular", "unresolved_equirectangular_source", "unresolved_360_source"] as const, "Capture Splat projection mode");
  const sourceIsEquirectangular = nullableBoolean(projection.source_is_equirectangular, "Capture Splat source_is_equirectangular");
  const projectedPinhole = boolean(projection.training_images_are_projected_pinhole, "Capture Splat training_images_are_projected_pinhole");
  const nativeEquirectangular = boolean(projection.native_equirectangular, "Capture Splat native_equirectangular");
  const expectedProjection: Record<CaptureSplatProjectionMode, [boolean | null, boolean, boolean]> = {
    perspective: [false, false, false],
    projected_pinhole_from_equirectangular: [true, true, false],
    native_equirectangular: [true, false, true],
    unresolved_equirectangular_source: [true, false, false],
    unresolved_360_source: [null, false, false],
  };
  if (stableGaussianPipelineJson([sourceIsEquirectangular, projectedPinhole, nativeEquirectangular]) !== stableGaussianPipelineJson(expectedProjection[mode])) {
    fail("Capture Splat projection flags do not match projection mode.");
  }
  const rig = record(projection.rig_evidence, "Capture Splat rig_evidence");
  const rigAvailable = boolean(rig.available, "Capture Splat rig_evidence available");
  exactKeys(rig, rigAvailable ? ["available", "schema", "checksum"] : ["available"], "Capture Splat rig_evidence");
  if (rigAvailable) {
    literal(rig.schema, "capture_splat.equirectangular_rig.v0.1", "Capture Splat rig_evidence schema");
    sha256(rig.checksum, "Capture Splat rig_evidence checksum");
  }
  if ((mode === "perspective" || mode === "unresolved_360_source") === rigAvailable) {
    fail("Capture Splat rig_evidence availability does not match projection mode.");
  }

  const evidence = record(dataset.evidence, "Capture Splat evidence");
  exactKeys(evidence, ["capture_manifest", "sfm", "depth", "confidence", "masks", "mesh"], "Capture Splat evidence");
  const captureManifest = record(evidence.capture_manifest, "Capture Splat capture_manifest evidence");
  exactKeys(captureManifest, ["available", "asset"], "Capture Splat capture_manifest evidence");
  const captureManifestAvailable = boolean(captureManifest.available, "Capture Splat capture_manifest available");
  const captureManifestAsset = nullableLiteral(captureManifest.asset, "capture_manifest", "Capture Splat capture_manifest asset");
  if (captureManifestAvailable !== (captureManifestAsset !== null)) fail("Capture Splat capture_manifest availability and asset must agree.");

  const sfm = validateCaptureSplatSfmEvidence(evidence.sfm);
  if ("registered_image_count" in sfm && sfm.registered_image_count > sourceFrameCount) {
    fail("Capture Splat registered_image_count cannot exceed the source frame count.");
  }

  const mesh = record(evidence.mesh, "Capture Splat mesh evidence");
  exactKeys(mesh, ["available", "asset", "report_available", "report_asset"], "Capture Splat mesh evidence");
  const meshAvailable = boolean(mesh.available, "Capture Splat mesh available");
  const meshAsset = nullableLiteral(mesh.asset, "navigation_mesh", "Capture Splat mesh asset");
  const meshReportAvailable = boolean(mesh.report_available, "Capture Splat mesh report_available");
  const meshReportAsset = nullableLiteral(mesh.report_asset, "mesh_report", "Capture Splat mesh report_asset");
  if (meshAvailable !== (meshAsset !== null) || meshReportAvailable !== (meshReportAsset !== null)) {
    fail("Capture Splat mesh availability and asset fields must agree.");
  }

  const authority = record(dataset.authority, "Capture Splat training_dataset authority");
  exactKeys(authority, ["capture_evidence_only", "trainer_consumption_claim", "training_execution_authority", "quality_claim", "metric_authority", "collision_authority"], "Capture Splat training_dataset authority");
  requiredBoolean(authority.capture_evidence_only, true, "Capture Splat capture_evidence_only");
  requiredBoolean(authority.trainer_consumption_claim, false, "Capture Splat trainer_consumption_claim");
  requiredBoolean(authority.training_execution_authority, false, "Capture Splat training_execution_authority");
  requiredBoolean(authority.quality_claim, false, "Capture Splat quality_claim");
  requiredBoolean(authority.metric_authority, false, "Capture Splat metric_authority");
  requiredBoolean(authority.collision_authority, false, "Capture Splat collision_authority");

  return {
    schema: CAPTURE_SPLAT_TRAINING_DATASET_SCHEMA,
    capture_profile: identifier(dataset.capture_profile, "Capture Splat capture_profile"),
    source_frame_set: {
      count: sourceFrameCount,
      digest: sha256(frameSet.digest, "Capture Splat source frame digest"),
      canonicalization: "utf8_relative_path_nul_size_nul_sha256_lf_v1",
    },
    projection: {
      mode,
      source_is_equirectangular: sourceIsEquirectangular,
      training_images_are_projected_pinhole: projectedPinhole,
      native_equirectangular: nativeEquirectangular,
      rig_evidence: rigAvailable
        ? {
            available: true,
            schema: "capture_splat.equirectangular_rig.v0.1",
            checksum: sha256(rig.checksum, "Capture Splat rig_evidence checksum"),
          }
        : { available: false },
    },
    evidence: {
      capture_manifest: { available: captureManifestAvailable, asset: captureManifestAsset },
      sfm,
      depth: validateFrameEvidence(evidence.depth, "Capture Splat depth evidence"),
      confidence: validateFrameEvidence(evidence.confidence, "Capture Splat confidence evidence"),
      masks: validateFrameEvidence(evidence.masks, "Capture Splat masks evidence"),
      mesh: {
        available: meshAvailable,
        asset: meshAsset,
        report_available: meshReportAvailable,
        report_asset: meshReportAsset,
      },
    },
    authority: {
      capture_evidence_only: true,
      trainer_consumption_claim: false,
      training_execution_authority: false,
      quality_claim: false,
      metric_authority: false,
      collision_authority: false,
    },
  };
}

export function validateGaussianTrainingJob(value: unknown): GaussianTrainingJobV1 {
  const job = record(value, "training job");
  exactKeys(job, ["schema", "job_id", "created_at", "dataset", "worker", "inputs", "profile", "budget", "authority", "loaded_world_effect"], "training job");
  literal(job.schema, GAUSSIAN_TRAINING_JOB_SCHEMA, "training job schema");
  literal(job.authority, "proposal_only", "training job authority");
  literal(job.loaded_world_effect, "none", "training job loaded_world_effect");

  const dataset = validateDataset(job.dataset, "training job dataset");
  const worker = record(job.worker, "training job worker");
  exactKeys(worker, ["integration", "implementation_id", "version", "source_url", "source_revision", "license_id", "build_sha256"], "training job worker");
  literal(worker.integration, "external_process", "training job worker integration");
  const sourceUrl = string(worker.source_url, "training job worker source_url", 2_048);
  if (!sourceUrl.startsWith("https://")) fail("training job worker source_url must use https.");
  const sourceRevision = string(worker.source_revision, "training job worker source_revision", 40);
  if (!gitRevisionPattern.test(sourceRevision)) fail("training job worker source_revision must be a full lowercase Git SHA.");

  const inputs = array(job.inputs, "training job inputs", 1, 32).map((item, index) => {
    const input = record(item, `training job inputs[${index}]`);
    exactKeys(input, ["role", "content"], `training job inputs[${index}]`);
    return {
      role: oneOf(input.role, ["images", "cameras", "capture_manifest", "video", "frame_index", "masks", "depth", "normals", "mesh"] as const, `training job inputs[${index}] role`),
      content: validateContent(input.content, `training job inputs[${index}] content`),
    };
  });
  unique(inputs.map((input) => input.role), "training job input roles");
  const roles = new Set(inputs.map((input) => input.role));
  if (dataset.kind === "standard" && (!roles.has("images") || !roles.has("cameras"))) {
    fail("Standard training fixtures require images and cameras inputs.");
  }
  if (dataset.kind === "local_capture" && (!roles.has("capture_manifest") || (!roles.has("images") && !roles.has("video")))) {
    fail("Local capture training fixtures require capture_manifest and images or video inputs.");
  }

  const profile = validateProfile(job.profile);
  const budget = record(job.budget, "training job budget");
  exactKeys(budget, ["wall_time_ms", "memory_bytes", "output_bytes"], "training job budget");

  return {
    schema: GAUSSIAN_TRAINING_JOB_SCHEMA,
    job_id: identifier(job.job_id, "training job job_id"),
    created_at: timestamp(job.created_at, "training job created_at"),
    dataset,
    worker: {
      integration: "external_process",
      implementation_id: identifier(worker.implementation_id, "training job worker implementation_id"),
      version: string(worker.version, "training job worker version", 128),
      source_url: sourceUrl,
      source_revision: sourceRevision,
      license_id: string(worker.license_id, "training job worker license_id", 128),
      build_sha256: worker.build_sha256 === null ? null : sha256(worker.build_sha256, "training job worker build_sha256"),
    },
    inputs,
    profile,
    budget: {
      wall_time_ms: integer(budget.wall_time_ms, "training job budget wall_time_ms", 1, 604_800_000),
      memory_bytes: integer(budget.memory_bytes, "training job budget memory_bytes", 1),
      output_bytes: integer(budget.output_bytes, "training job budget output_bytes", 1),
    },
    authority: "proposal_only",
    loaded_world_effect: "none",
  };
}

export function validateGaussianAsset(value: unknown): GaussianAssetV1 {
  const asset = record(value, "Gaussian asset");
  exactKeys(asset, ["schema", "asset_id", "created_at", "training_job", "dataset", "primary", "representation", "sidecars", "validation", "authority", "loaded_world_effect", "prohibited_uses"], "Gaussian asset");
  literal(asset.schema, GAUSSIAN_ASSET_SCHEMA, "Gaussian asset schema");
  literal(asset.authority, "visual_proposal", "Gaussian asset authority");
  literal(asset.loaded_world_effect, "none", "Gaussian asset loaded_world_effect");
  const prohibited = array(asset.prohibited_uses, "Gaussian asset prohibited_uses", 4, 4).map((item, index) => string(item, `Gaussian asset prohibited_uses[${index}]`, 64));
  if (stableGaussianPipelineJson(prohibited) !== stableGaussianPipelineJson(["metric_measurement", "collision", "navigation", "physics"])) {
    fail("Gaussian asset prohibited_uses must preserve the visual-only authority boundary.");
  }

  const trainingJob = referenceIdentity(asset.training_job, "Gaussian asset training_job", "job_id");
  const dataset = referenceIdentity(asset.dataset, "Gaussian asset dataset", "fixture_id");
  const primaryValue = record(asset.primary, "Gaussian asset primary");
  exactKeys(primaryValue, ["path", "sha256", "size_bytes", "media_type", "format"], "Gaussian asset primary");
  const primary = {
    ...validateContent({
      path: primaryValue.path,
      sha256: primaryValue.sha256,
      size_bytes: primaryValue.size_bytes,
      media_type: primaryValue.media_type,
    }, "Gaussian asset primary"),
    format: oneOf(primaryValue.format, ["ply", "spz", "rad"] as const, "Gaussian asset primary format"),
  };
  if (!primary.path.toLowerCase().endsWith(`.${primary.format}`)) fail("Gaussian asset primary path extension must match its format.");

  const representation = record(asset.representation, "Gaussian asset representation");
  exactKeys(representation, ["source_splat_count", "splat_count", "sh_degree", "quantization", "color_space", "coordinate_frame", "camera_models"], "Gaussian asset representation");
  const sourceSplatCount = integer(representation.source_splat_count, "Gaussian asset source_splat_count", 1);
  const splatCount = integer(representation.splat_count, "Gaussian asset splat_count", 1);
  if (splatCount > sourceSplatCount) fail("Gaussian asset splat_count cannot exceed source_splat_count.");
  const coordinate = record(representation.coordinate_frame, "Gaussian asset coordinate_frame");
  exactKeys(coordinate, ["frame_id", "length_unit", "handedness", "up_axis", "forward_axis"], "Gaussian asset coordinate_frame");
  const frameId = identifier(coordinate.frame_id, "Gaussian asset frame_id");
  const handedness = oneOf(coordinate.handedness, ["right", "left"] as const, "Gaussian asset handedness");
  const coordinateFrame: GaussianCoordinateFrameV1 = coordinate.length_unit === "unknown"
    ? validateUnregisteredGaussianCoordinateFrame(coordinate, frameId, handedness)
    : validateRegisteredGaussianCoordinateFrame(coordinate, frameId, handedness);
  const cameraModels = array(representation.camera_models, "Gaussian asset camera_models", 1, 3)
    .map((item, index) => oneOf(item, ["pinhole", "fisheye", "equirectangular"] as const, `Gaussian asset camera_models[${index}]`));
  unique(cameraModels, "Gaussian asset camera_models");

  const sidecars = array(asset.sidecars, "Gaussian asset sidecars", 0, 32).map((item, index) => {
    const sidecar = record(item, `Gaussian asset sidecars[${index}]`);
    exactKeys(sidecar, ["role", "content"], `Gaussian asset sidecars[${index}]`);
    return {
      role: oneOf(sidecar.role, ["cameras", "depth", "normals", "mesh", "skybox", "exposure", "white_balance"] as const, `Gaussian asset sidecars[${index}] role`),
      content: validateContent(sidecar.content, `Gaussian asset sidecars[${index}] content`),
    };
  });
  unique(sidecars.map((sidecar) => sidecar.role), "Gaussian asset sidecar roles");

  const validation = record(asset.validation, "Gaussian asset validation");
  exactKeys(validation, ["status", "nonfinite_value_count", "removed_splat_count", "report"], "Gaussian asset validation");
  const validationStatus = oneOf(validation.status, ["passed", "failed", "not_run"] as const, "Gaussian asset validation status");
  const nonfiniteValueCount = integer(validation.nonfinite_value_count, "Gaussian asset nonfinite_value_count", 0);
  const removedSplatCount = integer(validation.removed_splat_count, "Gaussian asset removed_splat_count", 0);
  if (sourceSplatCount - splatCount !== removedSplatCount) fail("Gaussian asset removed_splat_count must reconcile source and retained splats.");
  if (validationStatus === "passed" && nonfiniteValueCount !== 0) fail("A passed Gaussian asset cannot contain non-finite values.");

  return {
    schema: GAUSSIAN_ASSET_SCHEMA,
    asset_id: identifier(asset.asset_id, "Gaussian asset asset_id"),
    created_at: timestamp(asset.created_at, "Gaussian asset created_at"),
    training_job: { job_id: trainingJob.id, manifest_sha256: trainingJob.manifest_sha256 },
    dataset: { fixture_id: dataset.id, manifest_sha256: dataset.manifest_sha256 },
    primary,
    representation: {
      source_splat_count: sourceSplatCount,
      splat_count: splatCount,
      sh_degree: oneOf(representation.sh_degree, [0, 1, 2, 3] as const, "Gaussian asset sh_degree"),
      quantization: oneOf(representation.quantization, ["none", "fp16", "int8", "mixed"] as const, "Gaussian asset serialized quantization"),
      color_space: oneOf(representation.color_space, ["linear", "srgb"] as const, "Gaussian asset color_space"),
      coordinate_frame: coordinateFrame,
      camera_models: cameraModels,
    },
    sidecars,
    validation: {
      status: validationStatus,
      nonfinite_value_count: nonfiniteValueCount,
      removed_splat_count: removedSplatCount,
      report: validateContent(validation.report, "Gaussian asset validation report"),
    },
    authority: "visual_proposal",
    loaded_world_effect: "none",
    prohibited_uses: ["metric_measurement", "collision", "navigation", "physics"],
  };
}

function validateRegisteredGaussianCoordinateFrame(
  coordinate: Record<string, unknown>,
  frameId: string,
  handedness: "right" | "left",
): GaussianCoordinateFrameV1 {
  literal(coordinate.length_unit, "m", "Gaussian asset registered length_unit");
  const upAxis = oneOf(coordinate.up_axis, ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const, "Gaussian asset registered up_axis");
  const forwardAxis = oneOf(coordinate.forward_axis, ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const, "Gaussian asset registered forward_axis");
  if (upAxis.slice(1) === forwardAxis.slice(1)) fail("Gaussian asset registered up and forward axes must be distinct cardinal axes.");
  return { frame_id: frameId, length_unit: "m", handedness, up_axis: upAxis, forward_axis: forwardAxis };
}

function validateUnregisteredGaussianCoordinateFrame(
  coordinate: Record<string, unknown>,
  frameId: string,
  handedness: "right" | "left",
): GaussianCoordinateFrameV1 {
  if (coordinate.up_axis !== null || coordinate.forward_axis !== null) {
    fail("Gaussian asset unregistered gauge requires null up_axis and forward_axis.");
  }
  return { frame_id: frameId, length_unit: "unknown", handedness, up_axis: null, forward_axis: null };
}

export function validateGaussianBenchmarkReport(value: unknown): GaussianBenchmarkReportV1 {
  const report = record(value, "Gaussian benchmark report");
  exactKeys(report, ["schema", "report_id", "created_at", "subject", "environment", "execution", "raw_results", "quality_camera_set", "baseline_report", "metrics", "claims", "decision", "limitations", "authority"], "Gaussian benchmark report");
  literal(report.schema, GAUSSIAN_BENCHMARK_REPORT_SCHEMA, "Gaussian benchmark report schema");
  literal(report.authority, "evidence_only", "Gaussian benchmark report authority");

  const subject = record(report.subject, "Gaussian benchmark subject");
  exactKeys(subject, ["job_id", "job_manifest_sha256", "asset_id", "asset_manifest_sha256", "dataset_fixture_id", "dataset_manifest_sha256"], "Gaussian benchmark subject");
  const environment = record(report.environment, "Gaussian benchmark environment");
  exactKeys(environment, ["hardware_id", "os", "architecture", "cpu", "gpu", "gpu_api", "memory_bytes", "power_mode", "thermal_state", "world_studio_revision", "spark_version"], "Gaussian benchmark environment");
  literal(environment.spark_version, "2.1.0", "Gaussian benchmark Spark version");
  const worldStudioRevision = string(environment.world_studio_revision, "Gaussian benchmark World Studio revision", 40);
  if (!gitRevisionPattern.test(worldStudioRevision)) fail("Gaussian benchmark World Studio revision must be a full lowercase Git SHA.");

  const execution = record(report.execution, "Gaussian benchmark execution");
  exactKeys(execution, ["fixture_state", "build_mode", "command_argv", "cold_runs", "warmup_runs", "measured_runs", "concurrency", "noise_controls"], "Gaussian benchmark execution");
  const commandArgv = array(execution.command_argv, "Gaussian benchmark command_argv", 1, 256)
    .map((item, index) => string(item, `Gaussian benchmark command_argv[${index}]`, 4_096));
  const noiseControls = array(execution.noise_controls, "Gaussian benchmark noise_controls", 1, 64)
    .map((item, index) => string(item, `Gaussian benchmark noise_controls[${index}]`, 1_024));
  unique(noiseControls, "Gaussian benchmark noise_controls");
  const coldRuns = integer(execution.cold_runs, "Gaussian benchmark cold_runs", 0, 1_000);
  const measuredRuns = integer(execution.measured_runs, "Gaussian benchmark measured_runs", 0, 1_000);

  const metricsValue = record(report.metrics, "Gaussian benchmark metrics");
  const metricKeys = ["training_wall_time_ms", "peak_memory_bytes", "peak_device_memory_bytes", "first_visible_ms", "frame_time_ms", "psnr_db", "ssim", "mae"] as const;
  exactKeys(metricsValue, [...metricKeys], "Gaussian benchmark metrics");
  const metrics = Object.fromEntries(metricKeys.map((key) => [key, metricsValue[key] === null ? null : validateDistribution(metricsValue[key], `Gaussian benchmark ${key}`)])) as unknown as GaussianBenchmarkReportV1["metrics"];
  for (const key of ["training_wall_time_ms", "peak_memory_bytes", "peak_device_memory_bytes", "frame_time_ms", "psnr_db", "ssim", "mae"] as const) {
    if (metrics[key] && metrics[key]!.samples !== measuredRuns) fail(`Gaussian benchmark ${key} samples must equal measured_runs.`);
  }
  if (metrics.first_visible_ms && metrics.first_visible_ms.samples !== coldRuns) fail("Gaussian benchmark first_visible_ms samples must equal cold_runs.");
  const hasMeasurements = Object.values(metrics).some((metric) => metric !== null);
  const fixtureState = oneOf(execution.fixture_state, ["metadata_only", "hydrated"] as const, "Gaussian benchmark fixture_state");
  if (hasMeasurements && fixtureState !== "hydrated") fail("Measured benchmark reports require a hydrated fixture.");

  const claims = array(report.claims, "Gaussian benchmark claims", allClaimIds.length, allClaimIds.length).map((item, index) => {
    const claim = record(item, `Gaussian benchmark claims[${index}]`);
    exactKeys(claim, ["claim_id", "decision", "evidence", "limitation"], `Gaussian benchmark claims[${index}]`);
    const decision = oneOf(claim.decision, ["promote", "hold", "reject"] as const, `Gaussian benchmark claims[${index}] decision`);
    const evidence = array(claim.evidence, `Gaussian benchmark claims[${index}] evidence`, 0, 64)
      .map((entry, evidenceIndex) => validateContent(entry, `Gaussian benchmark claims[${index}] evidence[${evidenceIndex}]`));
    const limitation = string(claim.limitation, `Gaussian benchmark claims[${index}] limitation`, 4_096, true);
    if (decision === "hold" && limitation.length === 0) fail("Held Gaussian benchmark claims require a limitation.");
    if (decision !== "hold" && evidence.length === 0) fail("Promoted or rejected Gaussian benchmark claims require evidence.");
    return {
      claim_id: oneOf(claim.claim_id, allClaimIds, `Gaussian benchmark claims[${index}] claim_id`),
      decision,
      evidence,
      limitation,
    };
  });
  unique(claims.map((claim) => claim.claim_id), "Gaussian benchmark claim IDs");
  if (!allClaimIds.every((claimId) => claims.some((claim) => claim.claim_id === claimId))) fail("Gaussian benchmark reports must decide every declared 3DGS claim.");
  if (!hasMeasurements && claims.some((claim) => claim.decision !== "hold")) fail("Unmeasured Gaussian benchmark claims must be held.");

  const decision = oneOf(report.decision, ["promote", "hold", "reject"] as const, "Gaussian benchmark decision");
  const rawResults = nullableContent(report.raw_results, "Gaussian benchmark raw_results");
  const qualityCameraSet = nullableContent(report.quality_camera_set, "Gaussian benchmark quality_camera_set");
  const baselineReport = nullableContent(report.baseline_report, "Gaussian benchmark baseline_report");
  const limitations = array(report.limitations, "Gaussian benchmark limitations", 0, 64)
    .map((item, index) => string(item, `Gaussian benchmark limitations[${index}]`, 4_096));
  unique(limitations, "Gaussian benchmark limitations");
  if (hasMeasurements && rawResults === null) fail("Measured benchmark reports require raw_results.");
  if (claims.some((claim) => claim.decision === "promote") && (fixtureState !== "hydrated" || measuredRuns < 3 || rawResults === null)) {
    fail("Promoted Gaussian benchmark claims require hydrated inputs, at least three measured runs, and raw results.");
  }
  if ((metrics.psnr_db || metrics.ssim || metrics.mae) && qualityCameraSet === null) fail("Quality metrics require a fixed quality_camera_set.");
  if (decision === "promote") {
    if (fixtureState !== "hydrated" || measuredRuns < 3 || coldRuns < 3 || rawResults === null || qualityCameraSet === null || baselineReport === null) {
      fail("Promoted benchmarks require hydrated inputs, at least three measured and cold runs, raw results, fixed cameras, and a baseline.");
    }
    for (const key of ["training_wall_time_ms", "peak_memory_bytes", "first_visible_ms", "frame_time_ms", "psnr_db", "ssim", "mae"] as const) {
      if (metrics[key] === null) fail(`Promoted benchmarks require ${key}.`);
    }
  }
  if (!hasMeasurements && decision !== "hold") fail("Unmeasured benchmark reports must be held.");

  return {
    schema: GAUSSIAN_BENCHMARK_REPORT_SCHEMA,
    report_id: identifier(report.report_id, "Gaussian benchmark report_id"),
    created_at: timestamp(report.created_at, "Gaussian benchmark created_at"),
    subject: {
      job_id: identifier(subject.job_id, "Gaussian benchmark job_id"),
      job_manifest_sha256: sha256(subject.job_manifest_sha256, "Gaussian benchmark job_manifest_sha256"),
      asset_id: identifier(subject.asset_id, "Gaussian benchmark asset_id"),
      asset_manifest_sha256: sha256(subject.asset_manifest_sha256, "Gaussian benchmark asset_manifest_sha256"),
      dataset_fixture_id: identifier(subject.dataset_fixture_id, "Gaussian benchmark dataset_fixture_id"),
      dataset_manifest_sha256: sha256(subject.dataset_manifest_sha256, "Gaussian benchmark dataset_manifest_sha256"),
    },
    environment: {
      hardware_id: identifier(environment.hardware_id, "Gaussian benchmark hardware_id"),
      os: string(environment.os, "Gaussian benchmark os", 256),
      architecture: string(environment.architecture, "Gaussian benchmark architecture", 128),
      cpu: string(environment.cpu, "Gaussian benchmark cpu", 256),
      gpu: string(environment.gpu, "Gaussian benchmark gpu", 256),
      gpu_api: oneOf(environment.gpu_api, ["vulkan", "metal", "cuda", "webgpu", "cpu"] as const, "Gaussian benchmark gpu_api"),
      memory_bytes: integer(environment.memory_bytes, "Gaussian benchmark memory_bytes", 1),
      power_mode: string(environment.power_mode, "Gaussian benchmark power_mode", 128),
      thermal_state: string(environment.thermal_state, "Gaussian benchmark thermal_state", 128),
      world_studio_revision: worldStudioRevision,
      spark_version: "2.1.0",
    },
    execution: {
      fixture_state: fixtureState,
      build_mode: oneOf(execution.build_mode, ["release", "production"] as const, "Gaussian benchmark build_mode"),
      command_argv: commandArgv,
      cold_runs: coldRuns,
      warmup_runs: integer(execution.warmup_runs, "Gaussian benchmark warmup_runs", 0, 1_000),
      measured_runs: measuredRuns,
      concurrency: integer(execution.concurrency, "Gaussian benchmark concurrency", 1, 1_024),
      noise_controls: noiseControls,
    },
    raw_results: rawResults,
    quality_camera_set: qualityCameraSet,
    baseline_report: baselineReport,
    metrics,
    claims,
    decision,
    limitations,
    authority: "evidence_only",
  };
}

export function validateGaussianPipelineBinding(
  trainingJobValue: unknown,
  assetValue: unknown,
  benchmarkValue: unknown,
  hashes: { training_job_sha256: string; asset_manifest_sha256: string },
): { trainingJob: GaussianTrainingJobV1; asset: GaussianAssetV1; benchmark: GaussianBenchmarkReportV1 } {
  const trainingJob = validateGaussianTrainingJob(trainingJobValue);
  const asset = validateGaussianAsset(assetValue);
  const benchmark = validateGaussianBenchmarkReport(benchmarkValue);
  const trainingJobSha256 = sha256(hashes.training_job_sha256, "training job binding hash");
  const assetManifestSha256 = sha256(hashes.asset_manifest_sha256, "asset binding hash");
  if (asset.training_job.job_id !== trainingJob.job_id || asset.training_job.manifest_sha256 !== trainingJobSha256) fail("Gaussian asset does not bind the exact training job.");
  if (asset.dataset.fixture_id !== trainingJob.dataset.fixture_id || asset.dataset.manifest_sha256 !== trainingJob.dataset.manifest.sha256) fail("Gaussian asset does not bind the exact training dataset.");
  if (benchmark.subject.job_id !== trainingJob.job_id || benchmark.subject.job_manifest_sha256 !== trainingJobSha256) fail("Gaussian benchmark does not bind the exact training job.");
  if (benchmark.subject.asset_id !== asset.asset_id || benchmark.subject.asset_manifest_sha256 !== assetManifestSha256) fail("Gaussian benchmark does not bind the exact Gaussian asset.");
  if (benchmark.subject.dataset_fixture_id !== trainingJob.dataset.fixture_id || benchmark.subject.dataset_manifest_sha256 !== trainingJob.dataset.manifest.sha256) fail("Gaussian benchmark does not bind the exact training dataset.");
  if (asset.representation.sh_degree !== trainingJob.profile.sh_degree) fail("Gaussian asset SH degree differs from the training profile.");
  if (!trainingJob.profile.outputs.gaussian_formats.includes(asset.primary.format)) fail("Gaussian asset format was not requested by the training profile.");
  if (!asset.representation.camera_models.includes(trainingJob.profile.camera_model)) fail("Gaussian asset omits the training camera model.");
  validatePromotedClaims(trainingJob, asset, benchmark);
  return { trainingJob, asset, benchmark };
}

function validatePromotedClaims(job: GaussianTrainingJobV1, asset: GaussianAssetV1, report: GaussianBenchmarkReportV1): void {
  const sidecarRoles = new Set(asset.sidecars.map((sidecar) => sidecar.role));
  for (const claim of report.claims.filter((candidate) => candidate.decision === "promote")) {
    switch (claim.claim_id) {
      case "cross_vendor_vulkan":
        if (claim.evidence.length < 4) fail("Cross-vendor Vulkan promotion requires at least four vendor evidence reports.");
        break;
      case "ten_million_sh3_in_8gb":
        if (asset.representation.splat_count < 10_000_000 || asset.representation.sh_degree !== 3 || !report.metrics.peak_device_memory_bytes || report.metrics.peak_device_memory_bytes.maximum > 8 * 1024 ** 3) {
          fail("10M SH3 in 8GB promotion requires measured retained splats, SH3, and peak device memory at or below 8 GiB.");
        }
        break;
      case "native_equirectangular":
        if (job.profile.camera_model !== "equirectangular" || !job.profile.native_projection) fail("Native equirectangular promotion requires a native equirectangular job.");
        break;
      case "quantized_training":
        if (job.profile.quantization === "none") fail("Quantized-training promotion requires a quantized job.");
        break;
      case "combined_quality_strategy":
        if (!["mcmc", "igs_plus", "mrnf"].every((component) => job.profile.optimization_components.includes(component as "mcmc" | "igs_plus" | "mrnf"))) fail("Combined-strategy promotion requires MCMC, IGS+, and MRNF components.");
        if (!report.quality_camera_set || !report.baseline_report || !report.metrics.psnr_db || !report.metrics.ssim || !report.metrics.mae) fail("Combined-strategy promotion requires fixed cameras, a baseline, and PSNR/SSIM/MAE evidence.");
        break;
      case "exposure_white_balance":
        if (job.profile.exposure_correction === "none" || job.profile.white_balance_correction === "none") fail("Exposure/white-balance promotion requires both corrections.");
        if (!sidecarRoles.has("exposure") || !sidecarRoles.has("white_balance") || !report.quality_camera_set || !report.baseline_report) fail("Exposure/white-balance promotion requires both sidecars, fixed cameras, and a baseline.");
        break;
      case "built_in_preprocessing":
        if (job.profile.preprocessing.frame_extraction !== "built_in" || job.profile.preprocessing.sfm !== "built_in" || job.profile.preprocessing.masking !== "built_in_ai") fail("Built-in preprocessing promotion requires frame extraction, SfM, and AI masking.");
        break;
      case "depth_normal_mesh_skybox":
        if (!job.profile.outputs.depth || !job.profile.outputs.normals || !job.profile.outputs.mesh || !job.profile.outputs.skybox) fail("Depth/normal/mesh/skybox promotion requires every declared output.");
        if (!["depth", "normals", "mesh", "skybox"].every((role) => sidecarRoles.has(role as "depth" | "normals" | "mesh" | "skybox"))) fail("Depth/normal/mesh/skybox promotion requires every output sidecar.");
        break;
    }
  }
}

function validateDataset(value: unknown, label: string): GaussianDatasetReferenceV1 {
  const dataset = record(value, label);
  exactKeys(dataset, ["fixture_id", "kind", "storage_state", "manifest"], label);
  return {
    fixture_id: identifier(dataset.fixture_id, `${label} fixture_id`),
    kind: oneOf(dataset.kind, ["standard", "local_capture"] as const, `${label} kind`),
    storage_state: oneOf(dataset.storage_state, ["metadata_only", "hydrated"] as const, `${label} storage_state`),
    manifest: validateContent(dataset.manifest, `${label} manifest`),
  };
}

function validateProfile(value: unknown): GaussianTrainingJobV1["profile"] {
  const profile = record(value, "training job profile");
  exactKeys(profile, ["camera_model", "native_projection", "optimization_components", "iterations", "seed", "sh_degree", "max_gaussians", "quantization", "color_space", "exposure_correction", "white_balance_correction", "preprocessing", "outputs"], "training job profile");
  const cameraModel = oneOf(profile.camera_model, ["pinhole", "fisheye", "equirectangular"] as const, "training job camera_model");
  const nativeProjection = boolean(profile.native_projection, "training job native_projection");
  if (cameraModel === "equirectangular" && !nativeProjection) fail("Equirectangular jobs must preserve the native projection.");
  const components = array(profile.optimization_components, "training job optimization_components", 1, 3)
    .map((item, index) => oneOf(item, ["mcmc", "igs_plus", "mrnf"] as const, `training job optimization_components[${index}]`));
  unique(components, "training job optimization_components");
  const preprocessing = record(profile.preprocessing, "training job preprocessing");
  exactKeys(preprocessing, ["frame_extraction", "sfm", "masking", "depth", "normals"], "training job preprocessing");
  const outputs = record(profile.outputs, "training job outputs");
  exactKeys(outputs, ["gaussian_formats", "depth", "normals", "mesh", "skybox"], "training job outputs");
  const formats = array(outputs.gaussian_formats, "training job gaussian_formats", 1, 3)
    .map((item, index) => oneOf(item, ["ply", "spz", "rad"] as const, `training job gaussian_formats[${index}]`));
  unique(formats, "training job gaussian_formats");
  return {
    camera_model: cameraModel,
    native_projection: nativeProjection,
    optimization_components: components,
    iterations: integer(profile.iterations, "training job iterations", 1, 10_000_000),
    seed: profile.seed === null ? null : integer(profile.seed, "training job seed", 0),
    sh_degree: oneOf(profile.sh_degree, [0, 1, 2, 3] as const, "training job sh_degree"),
    max_gaussians: integer(profile.max_gaussians, "training job max_gaussians", 1),
    quantization: oneOf(profile.quantization, ["none", "fp16", "int8", "mixed"] as const, "training job storage quantization"),
    color_space: oneOf(profile.color_space, ["linear", "srgb"] as const, "training job color_space"),
    exposure_correction: oneOf(profile.exposure_correction, ["none", "bilateral_grid", "ppisp", "bilateral_grid_ppisp"] as const, "training job exposure_correction"),
    white_balance_correction: oneOf(profile.white_balance_correction, ["none", "bilateral_grid", "ppisp", "bilateral_grid_ppisp"] as const, "training job white_balance_correction"),
    preprocessing: {
      frame_extraction: oneOf(preprocessing.frame_extraction, ["none", "provided", "built_in"] as const, "training job frame_extraction"),
      sfm: oneOf(preprocessing.sfm, ["none", "provided", "built_in"] as const, "training job sfm"),
      masking: oneOf(preprocessing.masking, ["none", "provided", "built_in_ai"] as const, "training job masking"),
      depth: oneOf(preprocessing.depth, ["none", "provided", "estimated"] as const, "training job depth"),
      normals: oneOf(preprocessing.normals, ["none", "provided", "estimated"] as const, "training job normals"),
    },
    outputs: {
      gaussian_formats: formats,
      depth: boolean(outputs.depth, "training job depth output"),
      normals: boolean(outputs.normals, "training job normals output"),
      mesh: boolean(outputs.mesh, "training job mesh output"),
      skybox: boolean(outputs.skybox, "training job skybox output"),
    },
  };
}

function validateContent(value: unknown, label: string): GaussianContentReferenceV1 {
  const content = record(value, label);
  exactKeys(content, ["path", "sha256", "size_bytes", "media_type"], label);
  const mediaType = string(content.media_type, `${label} media_type`, 256);
  if (!mediaTypePattern.test(mediaType)) fail(`${label} media_type is invalid.`);
  return {
    path: safePath(content.path, `${label} path`),
    sha256: sha256(content.sha256, `${label} sha256`),
    size_bytes: integer(content.size_bytes, `${label} size_bytes`, 1),
    media_type: mediaType,
  };
}

function nullableContent(value: unknown, label: string): GaussianContentReferenceV1 | null {
  return value === null ? null : validateContent(value, label);
}

function validateDistribution(value: unknown, label: string): GaussianDistributionV1 {
  const distribution = record(value, label);
  exactKeys(distribution, ["samples", "minimum", "median", "p95", "maximum"], label);
  const result = {
    samples: integer(distribution.samples, `${label} samples`, 1, 1_000_000),
    minimum: finite(distribution.minimum, `${label} minimum`, 0),
    median: finite(distribution.median, `${label} median`, 0),
    p95: finite(distribution.p95, `${label} p95`, 0),
    maximum: finite(distribution.maximum, `${label} maximum`, 0),
  };
  if (!(result.minimum <= result.median && result.median <= result.p95 && result.p95 <= result.maximum)) fail(`${label} must satisfy minimum <= median <= p95 <= maximum.`);
  return result;
}

function validateFrameEvidence(value: unknown, label: string): { referenced_frame_count: number; available_frame_count: number } {
  const evidence = record(value, label);
  exactKeys(evidence, ["referenced_frame_count", "available_frame_count"], label);
  const referencedFrameCount = integer(evidence.referenced_frame_count, `${label} referenced_frame_count`, 0);
  const availableFrameCount = integer(evidence.available_frame_count, `${label} available_frame_count`, 0);
  if (availableFrameCount > referencedFrameCount) fail(`${label} available_frame_count cannot exceed referenced_frame_count.`);
  return { referenced_frame_count: referencedFrameCount, available_frame_count: availableFrameCount };
}

function validateCaptureSplatSfmEvidence(value: unknown): CaptureSplatSfmEvidenceV1 | CaptureSplatMeasuredSfmEvidenceV1 {
  const label = "Capture Splat SfM evidence";
  const sfm = record(value, label);
  const baseKeys = ["available", "camera_count", "camera_models", "registered_images_available", "sparse_points_available", "asset"] as const;
  const measuredKeys = [
    "registered_image_count",
    "registered_image_parse_status",
    "registered_image_invalid_record_count",
    "registered_image_name_digest",
    "registered_rgbd_overlap_count",
    "registered_rgbd_overlap",
  ] as const;
  const measured = measuredKeys.some((key) => Object.prototype.hasOwnProperty.call(sfm, key));
  exactKeys(sfm, measured ? [...baseKeys, ...measuredKeys] : baseKeys, label);

  const cameraModels = array(sfm.camera_models, "Capture Splat camera_models", 0, 64).map((item, index) => {
    const model = string(item, `Capture Splat camera_models[${index}]`, 64);
    if (!/^[A-Z0-9_]+$/.test(model)) fail(`Capture Splat camera_models[${index}] is invalid.`);
    return model;
  });
  unique(cameraModels, "Capture Splat camera_models");
  const result: CaptureSplatSfmEvidenceV1 = {
    available: boolean(sfm.available, "Capture Splat SfM available"),
    camera_count: integer(sfm.camera_count, "Capture Splat SfM camera_count", 0),
    camera_models: cameraModels,
    registered_images_available: boolean(sfm.registered_images_available, "Capture Splat registered_images_available"),
    sparse_points_available: boolean(sfm.sparse_points_available, "Capture Splat sparse_points_available"),
    asset: nullableLiteral(sfm.asset, "colmap_sparse", "Capture Splat SfM asset"),
  };
  if (!measured) return result;

  const registeredImageCount = integer(sfm.registered_image_count, "Capture Splat registered_image_count", 0);
  const parseStatus = oneOf(
    sfm.registered_image_parse_status,
    ["complete", "partial", "unavailable"] as const,
    "Capture Splat registered_image_parse_status",
  );
  const invalidRecordCount = integer(
    sfm.registered_image_invalid_record_count,
    "Capture Splat registered_image_invalid_record_count",
    0,
  );
  const imageNameDigest = sfm.registered_image_name_digest === null
    ? null
    : sha256(sfm.registered_image_name_digest, "Capture Splat registered_image_name_digest");
  if (result.registered_images_available) {
    if (parseStatus === "unavailable" || imageNameDigest === null) {
      fail("Capture Splat available registered images require a parse result and name digest.");
    }
  } else if (parseStatus !== "unavailable" || registeredImageCount !== 0 || invalidRecordCount !== 0 || imageNameDigest !== null) {
    fail("Capture Splat unavailable registered images require unavailable zero-count evidence.");
  }
  if ((parseStatus === "complete" && invalidRecordCount !== 0) || (parseStatus === "partial" && invalidRecordCount === 0)) {
    fail("Capture Splat registered image parse status must agree with invalid_record_count.");
  }

  const overlap = validateCaptureSplatRegisteredRgbdOverlap(
    sfm.registered_rgbd_overlap,
    registeredImageCount,
    parseStatus,
    result.registered_images_available,
  );
  const overlapCount = sfm.registered_rgbd_overlap_count === null
    ? null
    : integer(sfm.registered_rgbd_overlap_count, "Capture Splat registered_rgbd_overlap_count", 0);
  if ((overlap.available && overlapCount !== overlap.matched_count) || (!overlap.available && overlapCount !== null)) {
    fail("Capture Splat registered_rgbd_overlap_count must agree with overlap evidence.");
  }

  return {
    ...result,
    registered_image_count: registeredImageCount,
    registered_image_parse_status: parseStatus,
    registered_image_invalid_record_count: invalidRecordCount,
    registered_image_name_digest: imageNameDigest,
    registered_rgbd_overlap_count: overlapCount,
    registered_rgbd_overlap: overlap,
  };
}

function validateCaptureSplatRegisteredRgbdOverlap(
  value: unknown,
  registeredImageCount: number,
  parseStatus: "complete" | "partial" | "unavailable",
  registeredImagesAvailable: boolean,
): CaptureSplatRegisteredRgbdOverlapV1 {
  const label = "Capture Splat registered_rgbd_overlap";
  const overlap = record(value, label);
  const available = boolean(overlap.available, `${label} available`);
  exactKeys(
    overlap,
    available
      ? ["available", "matching", "depth_bearing_capture_frame_count", "matched_count", "matched_name_digest", "ambiguous_basename_count", "unmatched_registered_image_count"]
      : ["available", "reason", "matching", "depth_bearing_capture_frame_count", "matched_count", "ambiguous_basename_count", "unmatched_registered_image_count"],
    label,
  );
  literal(
    overlap.matching,
    "unique_case_sensitive_rgb_basename_with_same_root_rgb_and_depth_v1",
    `${label} matching`,
  );
  const depthBearingCount = integer(overlap.depth_bearing_capture_frame_count, `${label} depth_bearing_capture_frame_count`, 0);
  const matchedCount = integer(overlap.matched_count, `${label} matched_count`, 0);
  const ambiguousCount = integer(overlap.ambiguous_basename_count, `${label} ambiguous_basename_count`, 0);
  const unmatchedCount = integer(overlap.unmatched_registered_image_count, `${label} unmatched_registered_image_count`, 0);
  if (matchedCount + unmatchedCount !== registeredImageCount) {
    fail("Capture Splat RGB-D matched and unmatched counts must reconcile registered_image_count.");
  }

  if (available) {
    if (parseStatus !== "complete" || !registeredImagesAvailable) {
      fail("Capture Splat RGB-D overlap is available only for completely parsed registered images.");
    }
    if (matchedCount > depthBearingCount) {
      fail("Capture Splat RGB-D matched_count cannot exceed depth-bearing capture frames.");
    }
    return {
      available: true,
      matching: "unique_case_sensitive_rgb_basename_with_same_root_rgb_and_depth_v1",
      depth_bearing_capture_frame_count: depthBearingCount,
      matched_count: matchedCount,
      matched_name_digest: sha256(overlap.matched_name_digest, `${label} matched_name_digest`),
      ambiguous_basename_count: ambiguousCount,
      unmatched_registered_image_count: unmatchedCount,
    };
  }

  const reason = oneOf(
    overlap.reason,
    ["colmap_images_unavailable", "colmap_images_parse_incomplete", "capture_manifest_unavailable", "capture_frames_invalid"] as const,
    `${label} reason`,
  );
  if (depthBearingCount !== 0 || matchedCount !== 0 || ambiguousCount !== 0) {
    fail("Unavailable Capture Splat RGB-D overlap must have zero capture and match counts.");
  }
  const reasonMatchesEvidence =
    (reason === "colmap_images_unavailable" && !registeredImagesAvailable && parseStatus === "unavailable")
    || (reason === "colmap_images_parse_incomplete" && parseStatus !== "complete")
    || ((reason === "capture_manifest_unavailable" || reason === "capture_frames_invalid")
      && registeredImagesAvailable && parseStatus === "complete");
  if (!reasonMatchesEvidence) {
    fail("Capture Splat RGB-D overlap reason must agree with registered image evidence.");
  }
  return {
    available: false,
    reason,
    matching: "unique_case_sensitive_rgb_basename_with_same_root_rgb_and_depth_v1",
    depth_bearing_capture_frame_count: depthBearingCount,
    matched_count: matchedCount,
    ambiguous_basename_count: ambiguousCount,
    unmatched_registered_image_count: unmatchedCount,
  };
}

function referenceIdentity(value: unknown, label: string, idKey: "job_id" | "fixture_id"): { id: string; manifest_sha256: string } {
  const reference = record(value, label);
  exactKeys(reference, [idKey, "manifest_sha256"], label);
  return { id: identifier(reference[idKey], `${label} ${idKey}`), manifest_sha256: sha256(reference.manifest_sha256, `${label} manifest_sha256`) };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} must contain exactly: ${expected.join(", ")}.`);
}

function array(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label} must contain ${minimum} to ${maximum} items.`);
  return value;
}

function string(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must be a bounded printable string.`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const result = string(value, label, 128);
  if (!identifierPattern.test(result)) fail(`${label} must be an identifier.`);
  return result;
}

function integer(value: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(`${label} must be an integer from ${minimum} to ${maximum}.`);
  return value as number;
}

function finite(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) fail(`${label} must be a finite number at least ${minimum}.`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be boolean.`);
  return value;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  return boolean(value, label);
}

function requiredBoolean<T extends boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) fail(`${label} must be ${expected}.`);
  return expected;
}

function nullableLiteral<T extends string>(value: unknown, expected: T, label: string): T | null {
  if (value === null) return null;
  return literal(value, expected, label);
}

function literal<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) fail(`${label} must be ${expected}.`);
  return expected;
}

function oneOf<const T extends readonly (string | number)[]>(value: unknown, values: T, label: string): T[number] {
  if (!values.includes(value as never)) fail(`${label} must be one of ${values.join(", ")}.`);
  return value as T[number];
}

function unique(values: readonly (string | number)[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicates.`);
}

function safePath(value: unknown, label: string): string {
  try {
    return safeCanonicalRelativePath(value, label);
  } catch (error) {
    throw new GaussianPipelineContractError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function sha256(value: unknown, label: string): string {
  try {
    return validateCanonicalSha256(value, label);
  } catch (error) {
    throw new GaussianPipelineContractError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function timestamp(value: unknown, label: string): string {
  try {
    return validateCanonicalTimestamp(value, label);
  } catch (error) {
    throw new GaussianPipelineContractError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function fail(message: string): never {
  throw new GaussianPipelineContractError(message);
}
