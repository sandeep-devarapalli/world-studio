import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  GaussianPipelineContractError,
  parseGaussianPipelineJson,
  stableGaussianPipelineJson,
  validateCaptureSplatTrainingDataset,
  validateGaussianAsset,
  validateGaussianBenchmarkReport,
  validateGaussianPipelineBinding,
  validateGaussianTrainingJob,
} from "./gaussian-pipeline-contract.js";

const contractRoot = fileURLToPath(new URL("../../../contracts/gaussian-pipeline/v0.1/", import.meta.url));
const schemaFiles = [
  "schemas/capture_splat.training_dataset.v0.1.schema.json",
  "schemas/world_studio.gaussian_pipeline_defs.v0.1.schema.json",
  "schemas/world_studio.gaussian_training_job.v0.1.schema.json",
  "schemas/world_studio.gaussian_asset.v0.1.schema.json",
  "schemas/world_studio.gaussian_benchmark_report.v0.1.schema.json",
] as const;
const fixtureFiles = [
  "fixtures/valid_capture_training_dataset.json",
  "fixtures/valid_capture_training_dataset_measured.json",
  "fixtures/valid_training_job.json",
  "fixtures/valid_asset.json",
  "fixtures/valid_benchmark_report.json",
] as const;
const fingerprints: Record<(typeof schemaFiles)[number] | (typeof fixtureFiles)[number], string> = {
  "schemas/capture_splat.training_dataset.v0.1.schema.json": "e47d63397d9423551195eed60fb8a3feb5991bded3ca0a3510bb355fa06754a9",
  "schemas/world_studio.gaussian_pipeline_defs.v0.1.schema.json": "c3481dbefc98299169dd2924a7aaba671b3815e06f9dc5c325e4c2ffb2d7c120",
  "schemas/world_studio.gaussian_training_job.v0.1.schema.json": "9de7fa8a2d755b3e1eb387d92e94ace09cd9187d6dbc6a462f51b059b05294e4",
  "schemas/world_studio.gaussian_asset.v0.1.schema.json": "cc2d8ce6b581857ecc296d2dd96ff45674254f8d9ee10da862911f02533aaa20",
  "schemas/world_studio.gaussian_benchmark_report.v0.1.schema.json": "d5e2d7489b039c0d8c4301331572c84f06a7947e5324f53232f6acfae7173d0a",
  "fixtures/valid_capture_training_dataset.json": "b778cc92e0b59ea699f10513c07bd4ca3addc18df4163b778ac8fffae2e325c6",
  "fixtures/valid_capture_training_dataset_measured.json": "591632bcb3ea32adf40c35095d16caebdbe139e692f87bee3b6dcfd8005d63a7",
  "fixtures/valid_training_job.json": "222d5c48f2aeec61336061c1a403d4e6f56a22a7fb6132f66d5fb948e25cae62",
  "fixtures/valid_asset.json": "2cc333e8adb75a61f4cb15fb732a9bef5ea6241e28af039a79146268152c0195",
  "fixtures/valid_benchmark_report.json": "032ebc5bf1234b5f2b13851d90ae08aadcb38c5fad1995ef3f5afb8032cba2ff",
};

function bytes(relativePath: string): Buffer {
  return readFileSync(join(contractRoot, relativePath));
}

function json<T = Record<string, unknown>>(relativePath: string): T {
  return JSON.parse(bytes(relativePath).toString("utf8")) as T;
}

function fixture<T = Record<string, unknown>>(name: (typeof fixtureFiles)[number]): T {
  return json<T>(name);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("Gaussian pipeline schemas", () => {
  it("pins every schema and fixture and accepts the strict examples with AJV 2020", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    for (const name of schemaFiles) ajv.addSchema(json(name));
    const pairs = [
      ["fixtures/valid_capture_training_dataset.json", "urn:world-studio:schema:capture_splat.training_dataset.v0.1"],
      ["fixtures/valid_capture_training_dataset_measured.json", "urn:world-studio:schema:capture_splat.training_dataset.v0.1"],
      ["fixtures/valid_training_job.json", "urn:world-studio:schema:world_studio.gaussian_training_job.v0.1"],
      ["fixtures/valid_asset.json", "urn:world-studio:schema:world_studio.gaussian_asset.v0.1"],
      ["fixtures/valid_benchmark_report.json", "urn:world-studio:schema:world_studio.gaussian_benchmark_report.v0.1"],
    ] as const;
    for (const [fixtureName, schemaId] of pairs) {
      const validate = ajv.getSchema(schemaId);
      expect(validate, schemaId).toBeTypeOf("function");
      expect(validate!(fixture(fixtureName)), JSON.stringify(validate!.errors)).toBe(true);
    }
    for (const [relativePath, expected] of Object.entries(fingerprints)) {
      expect(createHash("sha256").update(bytes(relativePath)).digest("hex"), relativePath).toBe(expected);
    }
  });
});

describe("Gaussian pipeline runtime contracts", () => {
  it("keeps legacy Capture Splat v0.3 training evidence compatible without granting authority", () => {
    const dataset = fixture<Record<string, unknown>>("fixtures/valid_capture_training_dataset.json");
    expect(validateCaptureSplatTrainingDataset(dataset)).toMatchObject({
      capture_profile: "video_3dgs_max",
      authority: {
        capture_evidence_only: true,
        trainer_consumption_claim: false,
        training_execution_authority: false,
      },
      projection: {
        mode: "projected_pinhole_from_equirectangular",
        native_equirectangular: false,
      },
      source_frame_set: { count: 2 },
    });
    expect(() => validateCaptureSplatTrainingDataset({
      ...dataset,
      authority: { ...(dataset.authority as object), trainer_consumption_claim: true },
    })).toThrow(/trainer_consumption_claim/);
    expect(() => validateCaptureSplatTrainingDataset({
      ...dataset,
      projection: { ...(dataset.projection as object), native_equirectangular: true },
    })).toThrow(/flags do not match/);
    const evidence = clone(dataset.evidence as Record<string, unknown>);
    evidence.depth = { referenced_frame_count: 1, available_frame_count: 2 };
    expect(() => validateCaptureSplatTrainingDataset({ ...dataset, evidence })).toThrow(/cannot exceed/);
    expect(() => validateCaptureSplatTrainingDataset({ ...dataset, capture_profile: "../video" })).toThrow(/must be an identifier/);
  });

  it("validates measured Capture Splat registration and RGB-D overlap as one exact evidence group", () => {
    const dataset = fixture<Record<string, unknown>>("fixtures/valid_capture_training_dataset_measured.json");
    expect(validateCaptureSplatTrainingDataset(dataset)).toMatchObject({
      evidence: {
        sfm: {
          registered_image_count: 2,
          registered_image_parse_status: "complete",
          registered_rgbd_overlap_count: 1,
          registered_rgbd_overlap: {
            available: true,
            depth_bearing_capture_frame_count: 1,
            matched_count: 1,
            unmatched_registered_image_count: 1,
          },
        },
      },
      authority: { metric_authority: false, collision_authority: false },
    });

    const partialGroup = clone(dataset);
    const partialSfm = (partialGroup.evidence as Record<string, unknown>).sfm as Record<string, unknown>;
    delete partialSfm.registered_rgbd_overlap_count;
    expect(() => validateCaptureSplatTrainingDataset(partialGroup)).toThrow(/must contain exactly/);

    const excessRegistered = clone(dataset);
    const excessSfm = (excessRegistered.evidence as Record<string, unknown>).sfm as Record<string, unknown>;
    excessSfm.registered_image_count = 3;
    (excessSfm.registered_rgbd_overlap as Record<string, unknown>).unmatched_registered_image_count = 2;
    expect(() => validateCaptureSplatTrainingDataset(excessRegistered)).toThrow(/cannot exceed the source frame count/);

    const mismatchedOverlap = clone(dataset);
    ((mismatchedOverlap.evidence as Record<string, unknown>).sfm as Record<string, unknown>).registered_rgbd_overlap_count = 2;
    expect(() => validateCaptureSplatTrainingDataset(mismatchedOverlap)).toThrow(/must agree with overlap evidence/);

    const partial = clone(dataset);
    const partialSfmEvidence = (partial.evidence as Record<string, unknown>).sfm as Record<string, unknown>;
    partialSfmEvidence.registered_image_parse_status = "partial";
    partialSfmEvidence.registered_image_invalid_record_count = 1;
    partialSfmEvidence.registered_rgbd_overlap_count = null;
    partialSfmEvidence.registered_rgbd_overlap = {
      available: false,
      reason: "colmap_images_parse_incomplete",
      matching: "unique_case_sensitive_rgb_basename_with_same_root_rgb_and_depth_v1",
      depth_bearing_capture_frame_count: 0,
      matched_count: 0,
      ambiguous_basename_count: 0,
      unmatched_registered_image_count: 2,
    };
    expect(validateCaptureSplatTrainingDataset(partial)).toMatchObject({
      evidence: { sfm: { registered_image_parse_status: "partial", registered_rgbd_overlap_count: null } },
    });

    const unreconciled = clone(dataset);
    const unreconciledOverlap = (((unreconciled.evidence as Record<string, unknown>).sfm as Record<string, unknown>).registered_rgbd_overlap as Record<string, unknown>);
    unreconciledOverlap.unmatched_registered_image_count = 0;
    expect(() => validateCaptureSplatTrainingDataset(unreconciled)).toThrow(/must reconcile registered_image_count/);
  });

  it("round-trips and binds the canonical fixtures", () => {
    const job = fixture("fixtures/valid_training_job.json");
    const asset = fixture("fixtures/valid_asset.json");
    const benchmark = fixture("fixtures/valid_benchmark_report.json");
    expect(validateGaussianTrainingJob(job)).toMatchObject({
      authority: "proposal_only",
      dataset: { fixture_id: "nerf-synthetic-lego", storage_state: "metadata_only" },
      worker: {
        integration: "external_process",
        source_revision: "aede0ae3b2d01a7930c71b9c7f52354dc180146b",
      },
      profile: { seed: null },
    });
    expect(validateGaussianAsset(asset)).toMatchObject({
      authority: "visual_proposal",
      loaded_world_effect: "none",
      representation: {
        splat_count: 998,
        coordinate_frame: { length_unit: "unknown", up_axis: null, forward_axis: null },
      },
    });
    expect(validateGaussianBenchmarkReport(benchmark)).toMatchObject({
      decision: "hold",
      environment: { spark_version: "2.1.0" },
      execution: { cold_runs: 0, measured_runs: 0 },
    });
    expect(validateGaussianPipelineBinding(job, asset, benchmark, {
      training_job_sha256: `sha256:${"1".repeat(64)}`,
      asset_manifest_sha256: `sha256:${"2".repeat(64)}`,
    })).toMatchObject({
      trainingJob: { job_id: "gaussian-training-lego-fixture", profile: { quantization: "mixed" } },
      asset: { representation: { quantization: "none" } },
    });
    expect(validateGaussianTrainingJob(parseGaussianPipelineJson(stableGaussianPipelineJson(job)))).toEqual(job);
  });

  it("rejects malformed JSON, duplicate members, non-finite values, and open objects", () => {
    expect(() => parseGaussianPipelineJson('{"schema":')).toThrow(GaussianPipelineContractError);
    expect(() => parseGaussianPipelineJson('{"schema":"a","schema":"b"}')).toThrow(/duplicate/i);
    expect(() => stableGaussianPipelineJson({ value: Number.NaN })).toThrow(/non-finite/i);
    const job = fixture("fixtures/valid_training_job.json");
    expect(() => validateGaussianTrainingJob({ ...job, executable: "/tmp/trainer" })).toThrow(/exactly/);
  });

  it("keeps standard and local-capture inputs explicit and paths checksum-bound", () => {
    const job = fixture<Record<string, unknown>>("fixtures/valid_training_job.json");
    const inputs = job.inputs as Array<Record<string, unknown>>;
    expect(() => validateGaussianTrainingJob({ ...job, inputs: inputs.slice(0, 1) })).toThrow(/images and cameras/);
    expect(() => validateGaussianTrainingJob({
      ...job,
      inputs: [{ ...inputs[0], content: { ...(inputs[0]!.content as object), path: "../images.json" } }, inputs[1]],
    })).toThrow(/safe POSIX-relative path/);
    expect(() => validateGaussianTrainingJob({
      ...job,
      worker: { ...(job.worker as object), source_revision: "aede0ae3" },
    })).toThrow(/full lowercase Git SHA/);
    const profile = job.profile as Record<string, unknown>;
    expect(validateGaussianTrainingJob({ ...job, profile: { ...profile, seed: 42 } }).profile.seed).toBe(42);
    expect(() => validateGaussianTrainingJob({ ...job, profile: { ...profile, seed: "unavailable" } })).toThrow(/training job seed/);
  });

  it("keeps asset geometry finite, reconciled, and visual-only", () => {
    const asset = fixture<Record<string, unknown>>("fixtures/valid_asset.json");
    const representation = asset.representation as Record<string, unknown>;
    const validation = asset.validation as Record<string, unknown>;
    expect(() => validateGaussianAsset({
      ...asset,
      validation: { ...validation, nonfinite_value_count: 1 },
    })).toThrow(/cannot contain non-finite/);
    expect(() => validateGaussianAsset({
      ...asset,
      representation: { ...representation, splat_count: 999 },
    })).toThrow(/removed_splat_count/);
    expect(() => validateGaussianAsset({ ...asset, prohibited_uses: ["collision"] })).toThrow(/visual-only|must contain 4/);
  });

  it("separates registered metric frames from unregistered trainer gauge", () => {
    const asset = fixture<Record<string, unknown>>("fixtures/valid_asset.json");
    const representation = asset.representation as Record<string, unknown>;
    const coordinate = representation.coordinate_frame as Record<string, unknown>;
    expect(() => validateGaussianAsset({
      ...asset,
      representation: {
        ...representation,
        coordinate_frame: { ...coordinate, up_axis: "+Y" },
      },
    })).toThrow(/unregistered gauge/);
    expect(() => validateGaussianAsset({
      ...asset,
      representation: {
        ...representation,
        coordinate_frame: { ...coordinate, length_unit: "m" },
      },
    })).toThrow(/registered up_axis/);
    expect(() => validateGaussianAsset({
      ...asset,
      representation: {
        ...representation,
        coordinate_frame: {
          ...coordinate,
          length_unit: "m",
          up_axis: "+Y",
          forward_axis: "-Y",
        },
      },
    })).toThrow(/distinct cardinal axes/);
    expect(validateGaussianAsset({
      ...asset,
      representation: {
        ...representation,
        coordinate_frame: {
          ...coordinate,
          length_unit: "m",
          up_axis: "+Y",
          forward_axis: "-Z",
        },
      },
    }).representation.coordinate_frame).toEqual({
      frame_id: "trainer_world_unregistered",
      length_unit: "m",
      handedness: "right",
      up_axis: "+Y",
      forward_axis: "-Z",
    });
  });

  it("holds metadata-only and unmeasured reports and requires raw fixed-camera evidence for promotion", () => {
    const report = fixture<Record<string, unknown>>("fixtures/valid_benchmark_report.json");
    const metrics = report.metrics as Record<string, unknown>;
    const execution = report.execution as Record<string, unknown>;
    expect(() => validateGaussianBenchmarkReport({
      ...report,
      execution: { ...execution, measured_runs: 1 },
      metrics: {
        ...metrics,
        frame_time_ms: { samples: 1, minimum: 10, median: 11, p95: 12, maximum: 13 },
      },
    })).toThrow(/hydrated fixture/);
    expect(() => validateGaussianBenchmarkReport({ ...report, decision: "promote" })).toThrow(/hydrated inputs/);
    const claims = clone(report.claims as Array<Record<string, unknown>>);
    claims[0] = { ...claims[0], limitation: "" };
    expect(() => validateGaussianBenchmarkReport({ ...report, claims })).toThrow(/Held.*limitation/);
    const evidence = {
      media_type: "application/json",
      path: "evidence/unmeasured.json",
      sha256: `sha256:${"d".repeat(64)}`,
      size_bytes: 128,
    };
    claims[0] = { ...claims[0], decision: "promote", evidence: [evidence], limitation: "" };
    expect(() => validateGaussianBenchmarkReport({ ...report, claims })).toThrow(/Unmeasured.*held/);
    expect(() => validateGaussianBenchmarkReport({
      ...report,
      limitations: ["duplicate", "duplicate"],
    })).toThrow(/must not contain duplicates/);
  });

  it("rejects mismatched bindings and promoted capability claims without their evidence conditions", () => {
    const job = fixture("fixtures/valid_training_job.json");
    const asset = fixture("fixtures/valid_asset.json");
    const report = fixture<Record<string, unknown>>("fixtures/valid_benchmark_report.json");
    expect(() => validateGaussianPipelineBinding(job, asset, report, {
      training_job_sha256: `sha256:${"f".repeat(64)}`,
      asset_manifest_sha256: `sha256:${"2".repeat(64)}`,
    })).toThrow(/exact training job/);

    const claims = clone(report.claims as Array<Record<string, unknown>>);
    const evidence = {
      media_type: "application/json",
      path: "evidence/device-report.json",
      sha256: `sha256:${"e".repeat(64)}`,
      size_bytes: 1024,
    };
    claims[1] = { ...claims[1], decision: "promote", evidence: [evidence] };
    const distribution = { samples: 3, minimum: 1, median: 2, p95: 3, maximum: 4 };
    const promotedClaimReport = {
      ...report,
      claims,
      execution: {
        ...(report.execution as Record<string, unknown>),
        fixture_state: "hydrated",
        measured_runs: 3,
      },
      metrics: {
        ...(report.metrics as Record<string, unknown>),
        peak_device_memory_bytes: distribution,
      },
      raw_results: evidence,
    };
    expect(() => validateGaussianPipelineBinding(job, asset, promotedClaimReport, {
      training_job_sha256: `sha256:${"1".repeat(64)}`,
      asset_manifest_sha256: `sha256:${"2".repeat(64)}`,
    })).toThrow(/10M SH3 in 8GB/);

    const quantizedClaims = clone(report.claims as Array<Record<string, unknown>>);
    quantizedClaims[3] = { ...quantizedClaims[3], decision: "promote", evidence: [evidence], limitation: "" };
    const unquantizedJob = clone(job as Record<string, unknown>);
    unquantizedJob.profile = { ...(unquantizedJob.profile as Record<string, unknown>), quantization: "none" };
    expect(() => validateGaussianPipelineBinding(unquantizedJob, asset, {
      ...report,
      claims: quantizedClaims,
      execution: {
        ...(report.execution as Record<string, unknown>),
        fixture_state: "hydrated",
        measured_runs: 3,
      },
      metrics: {
        ...(report.metrics as Record<string, unknown>),
        frame_time_ms: distribution,
      },
      raw_results: evidence,
    }, {
      training_job_sha256: `sha256:${"1".repeat(64)}`,
      asset_manifest_sha256: `sha256:${"2".repeat(64)}`,
    })).toThrow(/Quantized-training promotion requires a quantized job/);
  });
});
