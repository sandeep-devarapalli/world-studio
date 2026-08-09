import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  CanonicalGraphContractError,
  parseCanonicalGraphJson,
  safeCanonicalRelativePath,
  stableCanonicalJson,
  validateCanonicalAssetManifest,
  validateCanonicalDelta,
  validateCanonicalSha256,
  validateCanonicalTimestamp,
  validateCanonicalTransitionBinding,
  validateCanonicalWorldManifest,
  type CanonicalAssetManifestV1,
  type CanonicalAssetVersionReferenceV1,
  type CanonicalDeltaV1,
  type CanonicalTransformEdgeV1,
  type CanonicalWorldManifestV2,
} from "./world-graph-contract.js";

const contractRoot = fileURLToPath(new URL("../../../contracts/world-graph/v0.1/", import.meta.url));
const schemaFiles = [
  "schemas/world_studio.world_graph_defs.v0.1.schema.json",
  "schemas/world_studio.world.v0.2.schema.json",
  "schemas/world_studio.asset.v0.1.schema.json",
  "schemas/world_studio.delta.v0.1.schema.json",
] as const;
const fixtureFiles = [
  "fixtures/valid_root_world.json",
  "fixtures/valid_child_world.json",
  "fixtures/valid_asset.json",
  "fixtures/valid_delta.json",
] as const;
const fingerprints: Record<(typeof schemaFiles)[number] | (typeof fixtureFiles)[number], string> = {
  "schemas/world_studio.world_graph_defs.v0.1.schema.json": "45545dbd40d3d6e09228e9eecf6e7ec35e9df93ea454843dca056286d0590536",
  "schemas/world_studio.world.v0.2.schema.json": "815bc2c25863966e5c2b700eba995efbe653183c1d266c7571425b80768af7e7",
  "schemas/world_studio.asset.v0.1.schema.json": "e22184bb76a0732e893109a62d4aca3714cefbacd6432e98fe453a8d7e7e319a",
  "schemas/world_studio.delta.v0.1.schema.json": "cb292036c0b5f288d1acd1162a0567567329d2a7fa7bb6dbb311fc59364c3c24",
  "fixtures/valid_root_world.json": "d0de5f356f65084bda881f9690cc854b6ae5ecee2ffe58388f714de54c50cf39",
  "fixtures/valid_child_world.json": "7944521f67cff3835c77972699451dfe7be97d68a539678cc55cf809fa55df8d",
  "fixtures/valid_asset.json": "4b4ec370d3440430662be3d3e91994b5336e328e5f04c0c79ec36e2da8b2ee54",
  "fixtures/valid_delta.json": "d0d95760a7760315ec6961d9fbef14dc94cabe7ee080d4196d8f855c29524e37",
};

function bytes(relativePath: string): Buffer {
  return readFileSync(join(contractRoot, relativePath));
}

function jsonFile<T = Record<string, unknown>>(relativePath: string): T {
  return JSON.parse(bytes(relativePath).toString("utf8")) as T;
}

function fixture<T = Record<string, unknown>>(name: (typeof fixtureFiles)[number]): T {
  return jsonFile<T>(name);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("canonical World/Asset/Delta schemas", () => {
  it("pins schema and fixture bytes", () => {
    for (const [relativePath, expected] of Object.entries(fingerprints)) {
      expect(createHash("sha256").update(bytes(relativePath)).digest("hex"), relativePath).toBe(expected);
    }
  });

  it("accepts every strict fixture with AJV 2020 and rejects open objects", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const schemas = schemaFiles.map((name) => jsonFile<Record<string, unknown>>(name));
    ajv.addSchema(schemas[0]);
    const validators = schemas.slice(1).map((schema) => ajv.compile(schema));
    expect(validators[0]!(fixture("fixtures/valid_root_world.json")), validators[0]!.errors?.map(String).join("\n")).toBe(true);
    expect(validators[0]!(fixture("fixtures/valid_child_world.json")), validators[0]!.errors?.map(String).join("\n")).toBe(true);
    expect(validators[1]!(fixture("fixtures/valid_asset.json")), validators[1]!.errors?.map(String).join("\n")).toBe(true);
    expect(validators[2]!(fixture("fixtures/valid_delta.json")), validators[2]!.errors?.map(String).join("\n")).toBe(true);

    const openWorld = fixture("fixtures/valid_root_world.json");
    openWorld.unexpected = true;
    expect(validators[0]!(openWorld)).toBe(false);
    expect(() => validateCanonicalWorldManifest(openWorld)).toThrow(/exactly/);
  });
});

describe("canonical JSON", () => {
  it("validates and round-trips each fixture through stable serialization", () => {
    const root = fixture("fixtures/valid_root_world.json");
    const child = fixture("fixtures/valid_child_world.json");
    const asset = fixture("fixtures/valid_asset.json");
    const delta = fixture("fixtures/valid_delta.json");
    expect(validateCanonicalWorldManifest(root).version).toBe(1);
    expect(validateCanonicalWorldManifest(child).version).toBe(2);
    expect(validateCanonicalAssetManifest(asset).version).toBe(1);
    expect(validateCanonicalDelta(delta).intent).toBe("replace");
    expect(validateCanonicalWorldManifest(parseCanonicalGraphJson(stableCanonicalJson(root)))).toEqual(root);
    expect(validateCanonicalAssetManifest(parseCanonicalGraphJson(stableCanonicalJson(asset)))).toEqual(asset);
    expect(validateCanonicalDelta(parseCanonicalGraphJson(stableCanonicalJson(delta)))).toEqual(delta);
  });

  it("orders keys by Unicode code point, including integer-looking keys", () => {
    expect(stableCanonicalJson({ "2": "two", "10": "ten", "😀": 1, "\uE000": 2 }))
      .toBe("{\"10\":\"ten\",\"2\":\"two\",\"\":2,\"😀\":1}");
    expect(stableCanonicalJson({ b: -0, a: 1 })).toBe("{\"a\":1,\"b\":0}");
  });

  it("rejects truncated or non-JSON text and unsafe JavaScript values", () => {
    expect(() => parseCanonicalGraphJson('{"a":')).toThrow(CanonicalGraphContractError);
    expect(() => parseCanonicalGraphJson('{"a":NaN}')).toThrow(CanonicalGraphContractError);
    expect(() => parseCanonicalGraphJson('{"a":1,"a":2}')).toThrow(/duplicate object member a/);
    expect(() => parseCanonicalGraphJson('{"a":1,"\\u0061":2}')).toThrow(/duplicate object member a/);
    expect(() => parseCanonicalGraphJson('[{"nested":1,"nested":2}]')).toThrow(/duplicate object member nested/);
    expect(() => stableCanonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => stableCanonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => stableCanonicalJson({ value: undefined })).toThrow(/undefined/);
    expect(() => stableCanonicalJson("\uD800")).toThrow(/surrogate/);
    const sparse = new Array(1);
    expect(() => stableCanonicalJson(sparse)).toThrow(/sparse/);
    const symbolKeyed = { ok: true } as Record<PropertyKey, unknown>;
    symbolKeyed[Symbol("hidden")] = true;
    expect(() => stableCanonicalJson(symbolKeyed)).toThrow(/symbol/);
  });

  it("rejects unsafe paths, hashes, and timestamps", () => {
    for (const path of [
      "/absolute", "file:///tmp/a", "https://example.test/a", "../escape", "a/../b", "a\\b", "a//b", "a/./b",
      " leading/file.json", "trailing /file.json", "folder/ trailing.json ", ".hidden/file.json", "folder./file.json",
      "folder/file.json.",
    ]) {
      expect(() => safeCanonicalRelativePath(path), path).toThrow(/safe POSIX-relative/);
    }
    expect(safeCanonicalRelativePath("assets/chair 01/model.glb")).toBe("assets/chair 01/model.glb");
    expect(() => validateCanonicalSha256(`sha256:${"A".repeat(64)}`)).toThrow(/lowercase/);
    expect(() => validateCanonicalSha256(`sha256:${"a".repeat(63)}`)).toThrow(/64/);
    expect(() => validateCanonicalTimestamp("2026-02-30T00:00:00.000Z")).toThrow(/real/);
    expect(() => validateCanonicalTimestamp("2026-08-09T12:00:00+00:00")).toThrow(/canonical UTC/);
  });
});

describe("World and Asset semantic validation", () => {
  it("enforces immutable root and child lineage", () => {
    const root = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const child = fixture<CanonicalWorldManifestV2>("fixtures/valid_child_world.json");
    const rootWithParent = clone(root) as unknown as Record<string, unknown>;
    rootWithParent.parent = child.parent;
    expect(() => validateCanonicalWorldManifest(rootWithParent)).toThrow(/version 1/);

    const missingDelta = clone(child) as unknown as Record<string, unknown>;
    missingDelta.applied_delta = null;
    expect(() => validateCanonicalWorldManifest(missingDelta)).toThrow(/require parent and applied_delta/);

    const skippedParent = clone(child);
    skippedParent.parent!.version = 2;
    expect(() => validateCanonicalWorldManifest(skippedParent)).toThrow(/immediately preceding/);

    const sameVersionId = clone(child);
    sameVersionId.parent!.version_id = sameVersionId.version_id;
    expect(() => validateCanonicalWorldManifest(sameVersionId)).toThrow(/version_id must differ/);

    const mismatchedAssetHash = clone(root);
    mismatchedAssetHash.assets[0]!.manifest.sha256 = `sha256:${"f".repeat(64)}`;
    expect(() => validateCanonicalWorldManifest(mismatchedAssetHash)).toThrow(/revision hash must match/);

    const assetChild = fixture<CanonicalAssetManifestV1>("fixtures/valid_asset.json");
    assetChild.version = 2;
    assetChild.version_id = "chair_demo_v2";
    assetChild.parent = {
      kind: "asset",
      id: assetChild.asset_id,
      version_id: "chair_demo_v1",
      version: 1,
      manifest_sha256: `sha256:${fingerprints["fixtures/valid_asset.json"]}`,
    };
    assetChild.applied_delta = {
      delta_id: "chair_delta_001",
      manifest: {
        path: "deltas/chair_delta_001.json",
        sha256: `sha256:${"8".repeat(64)}`,
        size_bytes: 256,
        media_type: "application/json",
      },
    };
    expect(validateCanonicalAssetManifest(assetChild).version).toBe(2);
    assetChild.applied_delta = null;
    expect(() => validateCanonicalAssetManifest(assetChild)).toThrow(/require parent and applied_delta/);
  });

  it("rejects unknown, duplicate, and cross-layer references", () => {
    const unknownFrame = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    unknownFrame.artifacts[0]!.frame_id = "missing_frame";
    expect(() => validateCanonicalWorldManifest(unknownFrame)).toThrow(/frame_id must reference/);

    const unknownEvidence = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    unknownEvidence.authorities[0]!.evidence_artifact_ids = ["missing_artifact"];
    expect(() => validateCanonicalWorldManifest(unknownEvidence)).toThrow(/unknown artifact/);

    const duplicateAuthority = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    duplicateAuthority.authorities.push(clone(duplicateAuthority.authorities[0]!));
    expect(() => validateCanonicalWorldManifest(duplicateAuthority)).toThrow(/domains must not contain duplicates/);

    const collisionClaim = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    collisionClaim.artifacts[1]!.authority.domain = "collision";
    expect(() => validateCanonicalWorldManifest(collisionClaim)).toThrow(/cannot claim collision authority/);

    const contradictoryAuthority = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    contradictoryAuthority.artifacts[1]!.authority.not_approved_for.push("human_visual_review");
    expect(() => validateCanonicalWorldManifest(contradictoryAuthority)).toThrow(/approve and deny/);

    for (const purpose of ["measurement", "semantic_ground_truth"] as const) {
      const illicitApproval = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
      const authority = illicitApproval.artifacts[1]!.authority;
      authority.not_approved_for = authority.not_approved_for.filter((item) => item !== purpose);
      authority.approved_for.push(purpose);
      expect(() => validateCanonicalWorldManifest(illicitApproval), purpose).toThrow(/matching promoted authority/);
    }

    const duplicateManifestPath = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const secondAsset = clone(duplicateManifestPath.assets[0]!);
    secondAsset.revision.id = "table_demo";
    secondAsset.revision.version_id = "table_demo_v1";
    duplicateManifestPath.assets.push(secondAsset);
    expect(() => validateCanonicalWorldManifest(duplicateManifestPath)).toThrow(/manifest paths must not contain duplicates/);

    const mismatchedCaptureManifest = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    mismatchedCaptureManifest.capture_evidence[0]!.manifest.sha256 = `sha256:${"9".repeat(64)}`;
    expect(() => validateCanonicalWorldManifest(mismatchedCaptureManifest)).toThrow(/identical source_manifest/);
  });

  it("rejects invalid uncertainty and readiness claims", () => {
    const reversedBounds = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const uncertainty = reversedBounds.transform_graph.edges[0]!.uncertainty;
    if (uncertainty.status !== "bounded") throw new Error("fixture changed");
    uncertainty.lower = 1;
    uncertainty.upper = 0;
    expect(() => validateCanonicalWorldManifest(reversedBounds)).toThrow(/lower must not exceed upper/);

    const unavailableEvidence = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    unavailableEvidence.readiness.collision.evidence_artifact_ids = ["capture_manifest_001"];
    expect(() => validateCanonicalWorldManifest(unavailableEvidence)).toThrow(/unavailable state/);

    const promotedWithoutEvidence = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    promotedWithoutEvidence.readiness.visual.status = "promoted";
    promotedWithoutEvidence.readiness.visual.evidence_artifact_ids = [];
    expect(() => validateCanonicalWorldManifest(promotedWithoutEvidence)).toThrow(/requires evidence/);

    const crossLayerPromotion = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    crossLayerPromotion.readiness.metric.status = "validated";
    crossLayerPromotion.readiness.metric.evidence_artifact_ids = ["capture_manifest_001"];
    crossLayerPromotion.authorities.push({
      domain: "metric",
      status: "validated",
      approved_for: [],
      not_approved_for: ["collision"],
      limitations: ["Metric evidence is not present."],
      evidence_artifact_ids: ["capture_manifest_001"],
    });
    expect(() => validateCanonicalWorldManifest(crossLayerPromotion)).toThrow(/matching validated layer evidence/);

    const unicodeReason = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    if (unicodeReason.capture_evidence[0]!.uncertainty.status !== "unknown") throw new Error("fixture changed");
    unicodeReason.capture_evidence[0]!.uncertainty.reason = "Incertitude étalonnée.";
    expect(() => validateCanonicalWorldManifest(unicodeReason)).not.toThrow();

    const oversizedUtf8 = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    if (oversizedUtf8.capture_evidence[0]!.uncertainty.status !== "unknown") throw new Error("fixture changed");
    oversizedUtf8.capture_evidence[0]!.uncertainty.reason = "é".repeat(600);
    expect(() => validateCanonicalWorldManifest(oversizedUtf8)).toThrow(/1024 UTF-8 bytes/);
  });

  it("rejects malformed transform graphs and affine matrices", () => {
    const unknownEndpoint = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    unknownEndpoint.transform_graph.edges[0]!.child_frame = "missing";
    expect(() => validateCanonicalWorldManifest(unknownEndpoint)).toThrow(/known nodes/);

    const selfEdge = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    selfEdge.transform_graph.edges[0]!.child_frame = "world_metric";
    expect(() => validateCanonicalWorldManifest(selfEdge)).toThrow(/self edges/);

    const disconnected = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    disconnected.transform_graph.nodes.push({ frame_id: "island", handedness: "right", up_axis: "+Y", forward_axis: "-Z" });
    expect(() => validateCanonicalWorldManifest(disconnected)).toThrow(/connected/);

    const multipleParents = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const second = clone(multipleParents.transform_graph.edges[0]!);
    second.transform_id = "duplicate_parent";
    multipleParents.transform_graph.edges.push(second);
    expect(() => validateCanonicalWorldManifest(multipleParents)).toThrow(/multiple parents/);

    const cycle = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    cycle.transform_graph.nodes.push({ frame_id: "cycle_node", handedness: "right", up_axis: "+Y", forward_axis: "-Z" });
    const forward = clone(cycle.transform_graph.edges[0]!);
    forward.transform_id = "cycle_forward";
    forward.parent_frame = "capture_arkit";
    forward.child_frame = "cycle_node";
    const backward = clone(forward);
    backward.transform_id = "cycle_backward";
    backward.parent_frame = "cycle_node";
    backward.child_frame = "capture_arkit";
    cycle.transform_graph.edges = [forward, backward];
    expect(() => validateCanonicalWorldManifest(cycle)).toThrow(/cycles/);

    const nonAffine = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    nonAffine.transform_graph.edges[0]!.matrix_row_major[12] = 0.1;
    expect(() => validateCanonicalWorldManifest(nonAffine)).toThrow(/affine/);

    const ambiguousConvention = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json") as unknown as Record<string, unknown>;
    const ambiguousGraph = ambiguousConvention.transform_graph as { edges: Array<Record<string, unknown>> };
    ambiguousGraph.edges[0]!.convention = "child_from_parent_row_vector";
    expect(() => validateCanonicalWorldManifest(ambiguousConvention)).toThrow(/convention/);

    const shear = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    shear.transform_graph.edges[0]!.matrix_row_major[1] = 0.5;
    expect(() => validateCanonicalWorldManifest(shear)).toThrow(/without shear/);

    const sameHandedReflection = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    sameHandedReflection.transform_graph.edges[0]!.matrix_row_major[0] = -1;
    expect(() => validateCanonicalWorldManifest(sameHandedReflection)).toThrow(/determinant sign/);

    const crossHandedPositive = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    crossHandedPositive.transform_graph.nodes[1]!.handedness = "left";
    expect(() => validateCanonicalWorldManifest(crossHandedPositive)).toThrow(/determinant sign/);

    const crossHandedReflection = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    crossHandedReflection.transform_graph.nodes[1]!.handedness = "left";
    crossHandedReflection.transform_graph.edges[0]!.matrix_row_major[0] = -1;
    expect(() => validateCanonicalWorldManifest(crossHandedReflection)).not.toThrow();

    const deepChain = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const edgeTemplate = deepChain.transform_graph.edges[0]!;
    let parentFrame = "capture_arkit";
    for (let index = 0; index < 12_000; index += 1) {
      const childFrame = `deep_frame_${index}`;
      deepChain.transform_graph.nodes.push({
        frame_id: childFrame,
        handedness: "right",
        up_axis: "+Y",
        forward_axis: "-Z",
      });
      deepChain.transform_graph.edges.push({
        ...edgeTemplate,
        transform_id: `deep_transform_${index}`,
        parent_frame: parentFrame,
        child_frame: childFrame,
        matrix_row_major: [...edgeTemplate.matrix_row_major],
      });
      parentFrame = childFrame;
    }
    expect(() => validateCanonicalWorldManifest(deepChain)).not.toThrow();
  });
});

describe("reversible Delta semantics", () => {
  function deltaFor(intent: CanonicalDeltaV1["intent"]): CanonicalDeltaV1 {
    const delta = fixture<CanonicalDeltaV1>("fixtures/valid_delta.json");
    delta.intent = intent;
    const operation = delta.operations[0]!;
    if (["crop", "filter", "replace"].includes(intent)) return delta;
    if (intent === "merge") {
      if (delta.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
      const second = clone(delta.operations[0]!.effect.before[0]!);
      second.artifact_id = "visual_splat_merge_source_002";
      second.content.path = "world/visual/desk_room_merge_source_002.spz";
      delta.operations[0]!.effect.before.push(second);
      return delta;
    }
    if (intent === "transform") {
      const world = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
      const before = clone(world.transform_graph.edges[0]!);
      const after = clone(before);
      after.matrix_row_major[3] = 1;
      operation.effect = { kind: "transform_edge", before, after };
    } else if (intent === "hide") {
      operation.effect = { kind: "visibility", before: true, after: false };
    } else if (intent === "objectize") {
      const world = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
      operation.effect = {
        kind: "membership",
        before: [],
        after: [clone(world.assets[0]!.revision) as CanonicalAssetVersionReferenceV1],
      };
    } else {
      operation.effect = {
        kind: "annotation",
        before: null,
        after: {
          path: "annotations/object-1.json",
          sha256: `sha256:${"e".repeat(64)}`,
          size_bytes: 128,
          media_type: "application/json",
        },
      };
    }
    return delta;
  }

  function transformTransition(sourceClass: CanonicalTransformEdgeV1["source_class"]): {
    parent: CanonicalWorldManifestV2;
    delta: CanonicalDeltaV1;
    result: CanonicalWorldManifestV2;
    hashes: { parent_manifest_sha256: string; delta_manifest_sha256: string };
  } {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    parent.transform_graph.edges[0]!.source_class = sourceClass;
    const delta = deltaFor("transform");
    const hashes = {
      parent_manifest_sha256: `sha256:${"1".repeat(64)}`,
      delta_manifest_sha256: `sha256:${"2".repeat(64)}`,
    };
    delta.parent.manifest_sha256 = hashes.parent_manifest_sha256;
    delta.provenance.input_versions = [clone(delta.parent)];
    const before = clone(parent.transform_graph.edges[0]!);
    const after = clone(before);
    after.matrix_row_major[3] = 1;
    delta.operations[0]!.target_id = before.transform_id;
    delta.operations[0]!.effect = { kind: "transform_edge", before, after };

    const result = clone(parent);
    result.version_id = delta.result.version_id;
    result.version = delta.result.version;
    result.parent = clone(delta.parent);
    result.created_at = "2026-08-09T12:21:00.000Z";
    result.transform_graph.edges = [clone(after)];
    result.applied_delta = {
      delta_id: delta.delta_id,
      manifest: {
        path: "history/transform_001.delta.json",
        sha256: hashes.delta_manifest_sha256,
        size_bytes: 512,
        media_type: "application/json",
      },
    };
    result.provenance.created_at = result.created_at;
    result.provenance.run_id = "transform_result_001";
    result.provenance.input_versions = [clone(delta.parent), ...parent.assets.map((asset) => clone(asset.revision))];
    return { parent, delta, result, hashes };
  }

  it("accepts all eight intents and records lossless before/after snapshots", () => {
    for (const intent of ["crop", "transform", "filter", "merge", "hide", "replace", "objectize", "annotate"] as const) {
      const delta = deltaFor(intent);
      expect(validateCanonicalDelta(delta).intent).toBe(intent);
      const reversed = clone(delta);
      const effect = reversed.operations[0]!.effect as unknown as { before: unknown; after: unknown };
      const before = effect.before;
      effect.before = effect.after;
      effect.after = before;
      expect(stableCanonicalJson(effect.before)).toBe(stableCanonicalJson(delta.operations[0]!.effect.after));
      expect(stableCanonicalJson(effect.after)).toBe(stableCanonicalJson(delta.operations[0]!.effect.before));
      if (["transform", "hide", "replace", "annotate"].includes(intent)) {
        expect(validateCanonicalDelta(reversed).intent).toBe(intent);
      }
    }
  });

  it("materializes only manual-edit transforms and preserves protected transform evidence", () => {
    const manual = transformTransition("manual_edit");
    expect(() => validateCanonicalTransitionBinding(manual.parent, manual.delta, manual.result, manual.hashes)).not.toThrow();

    for (const sourceClass of ["sensor_calibration", "registration"] as const) {
      const protectedTransition = transformTransition(sourceClass);
      expect(() => validateCanonicalTransitionBinding(
        protectedTransition.parent,
        protectedTransition.delta,
        protectedTransition.result,
        protectedTransition.hashes,
      ), sourceClass).toThrow(/only manual_edit edges/);
    }
  });

  it("materializes Asset replacement transitions and rejects unsupported Asset intents", () => {
    const parent = fixture<CanonicalAssetManifestV1>("fixtures/valid_asset.json");
    const before = clone(parent.artifacts[0]!);
    const after = clone(before);
    after.artifact_id = "chair_visual_mesh_002";
    after.content.path = "assets/chair/visual/chair_v2.glb";
    after.content.sha256 = `sha256:${"5".repeat(64)}`;
    after.content.size_bytes += 256;
    after.provenance.created_at = "2026-08-09T12:30:00.000Z";
    after.provenance.run_id = "asset_replace_run_002";

    const hashes = {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_asset.json"]}`,
      delta_manifest_sha256: `sha256:${"6".repeat(64)}`,
    };
    const delta = fixture<CanonicalDeltaV1>("fixtures/valid_delta.json");
    delta.delta_id = "chair_replace_001";
    delta.scope = "asset";
    delta.parent = {
      kind: "asset",
      id: parent.asset_id,
      version_id: parent.version_id,
      version: parent.version,
      manifest_sha256: hashes.parent_manifest_sha256,
    };
    delta.result = { kind: "asset", id: parent.asset_id, version_id: "chair_demo_v2", version: 2 };
    delta.operations = [{
      operation_id: "replace_chair_visual_001",
      target_id: before.artifact_id,
      effect: { kind: "artifact_binding", before: [before], after: [after] },
    }];
    delta.provenance.input_artifact_ids = [before.artifact_id];
    delta.provenance.input_versions = [clone(delta.parent)];

    const result = clone(parent);
    result.version_id = delta.result.version_id;
    result.version = delta.result.version;
    result.parent = clone(delta.parent);
    result.created_at = "2026-08-09T12:31:00.000Z";
    result.artifacts = [clone(after)];
    result.applied_delta = {
      delta_id: delta.delta_id,
      manifest: {
        path: "history/chair_replace_001.delta.json",
        sha256: hashes.delta_manifest_sha256,
        size_bytes: 1024,
        media_type: "application/json",
      },
    };
    result.authorities[0]!.evidence_artifact_ids = [after.artifact_id];
    result.readiness.visual.evidence_artifact_ids = [after.artifact_id];
    result.provenance.created_at = result.created_at;
    result.provenance.run_id = "asset_manifest_run_002";
    result.provenance.input_artifact_ids = [after.artifact_id];
    result.provenance.input_versions = [clone(delta.parent)];
    expect(() => validateCanonicalTransitionBinding(parent, delta, result, hashes)).not.toThrow();

    for (const intent of ["transform", "objectize"] as const) {
      const unsupported = clone(delta);
      unsupported.intent = intent;
      if (intent === "transform") {
        const edge = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json").transform_graph.edges[0]!;
        const edgeBefore = clone(edge);
        edgeBefore.source_class = "manual_edit";
        const edgeAfter = clone(edgeBefore);
        edgeAfter.matrix_row_major[3] = 1;
        unsupported.operations = [{
          operation_id: "asset_transform_001",
          target_id: edgeBefore.transform_id,
          effect: { kind: "transform_edge", before: edgeBefore, after: edgeAfter },
        }];
      } else {
        unsupported.operations = [{
          operation_id: "asset_objectize_001",
          target_id: parent.asset_id,
          effect: {
            kind: "membership",
            before: [],
            after: [clone(delta.parent) as CanonicalAssetVersionReferenceV1],
          },
        }];
      }
      const unchangedResult = clone(parent);
      unchangedResult.version_id = unsupported.result.version_id;
      unchangedResult.version = unsupported.result.version;
      unchangedResult.parent = clone(unsupported.parent);
      unchangedResult.created_at = result.created_at;
      unchangedResult.applied_delta = clone(result.applied_delta);
      unchangedResult.applied_delta!.delta_id = unsupported.delta_id;
      unchangedResult.provenance.created_at = unchangedResult.created_at;
      unchangedResult.provenance.run_id = `unsupported_${intent}_001`;
      unchangedResult.provenance.input_versions = [clone(unsupported.parent)];
      expect(() => validateCanonicalTransitionBinding(parent, unsupported, unchangedResult, hashes), intent)
        .toThrow(/no schema-backed materialization rule/);
    }
  });

  it("materializes World asset membership and rejects a mismatched result", () => {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const delta = deltaFor("objectize");
    const member = clone(parent.assets[0]!.revision) as CanonicalAssetVersionReferenceV1;
    delta.operations = [{
      operation_id: "remove_chair_membership_001",
      target_id: member.id,
      effect: { kind: "membership", before: [member], after: [] },
    }];
    const hashes = {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: `sha256:${"3".repeat(64)}`,
    };
    delta.parent.manifest_sha256 = hashes.parent_manifest_sha256;
    delta.provenance.input_versions = [clone(delta.parent), clone(member)];

    const result = clone(parent);
    result.version_id = delta.result.version_id;
    result.version = delta.result.version;
    result.parent = clone(delta.parent);
    result.created_at = "2026-08-09T12:40:00.000Z";
    result.assets = [];
    result.applied_delta = {
      delta_id: delta.delta_id,
      manifest: {
        path: "history/remove_chair_membership_001.delta.json",
        sha256: hashes.delta_manifest_sha256,
        size_bytes: 640,
        media_type: "application/json",
      },
    };
    result.provenance.created_at = result.created_at;
    result.provenance.run_id = "world_objectize_result_001";
    result.provenance.input_versions = [clone(delta.parent), clone(member)];
    expect(() => validateCanonicalTransitionBinding(parent, delta, result, hashes)).not.toThrow();

    const mismatched = clone(result);
    mismatched.assets = clone(parent.assets);
    expect(() => validateCanonicalWorldManifest(mismatched)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, mismatched, hashes)).toThrow(/Membership transition result/);
  });

  it("rejects mismatched intent effects, no-ops, broken lineage, and authority changes", () => {
    const mismatched = deltaFor("hide");
    mismatched.intent = "transform";
    expect(() => validateCanonicalDelta(mismatched)).toThrow(/effect kind/);

    const noOp = deltaFor("hide");
    noOp.operations[0]!.effect = { kind: "visibility", before: true, after: true };
    expect(() => validateCanonicalDelta(noOp)).toThrow(/must change state/);

    for (const intent of ["crop", "filter"] as const) {
      const emptyBefore = deltaFor(intent);
      if (emptyBefore.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
      emptyBefore.operations[0]!.effect.before = [];
      expect(() => validateCanonicalDelta(emptyBefore), intent).toThrow(/requires at least one before binding/);
    }

    const worldMembership = deltaFor("objectize");
    if (worldMembership.operations[0]!.effect.kind !== "membership") throw new Error("fixture changed");
    (worldMembership.operations[0]!.effect.after[0]! as { kind: string }).kind = "world";
    expect(() => validateCanonicalDelta(worldMembership)).toThrow(/only asset references/);

    const skippedVersion = deltaFor("replace");
    skippedVersion.result.version = 3;
    expect(() => validateCanonicalDelta(skippedVersion)).toThrow(/next immutable version/);

    const duplicateTarget = deltaFor("replace");
    const duplicateOperation = clone(duplicateTarget.operations[0]!);
    duplicateOperation.operation_id = "replace_visual_splat_002";
    duplicateTarget.operations.push(duplicateOperation);
    expect(() => validateCanonicalDelta(duplicateTarget)).toThrow(/target_id values must not contain duplicates/);

    const chainedArtifacts = deltaFor("replace");
    if (chainedArtifacts.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
    const chainedBefore = clone(chainedArtifacts.operations[0]!.effect.after[0]!);
    const chainedAfter = clone(chainedBefore);
    chainedAfter.artifact_id = "visual_splat_003";
    chainedAfter.content.path = "world/visual/desk_room_v3.spz";
    chainedArtifacts.operations.push({
      operation_id: "replace_visual_splat_002",
      target_id: chainedBefore.artifact_id,
      effect: { kind: "artifact_binding", before: [chainedBefore], after: [chainedAfter] },
    });
    expect(() => validateCanonicalDelta(chainedArtifacts)).toThrow(/cannot chain or overlap artifact/);

    const crossLayerMerge = deltaFor("merge");
    if (crossLayerMerge.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
    crossLayerMerge.operations[0]!.effect.before[1]!.role = "metric_points";
    crossLayerMerge.operations[0]!.effect.before[1]!.authority.domain = "metric";
    expect(() => validateCanonicalDelta(crossLayerMerge)).toThrow(/one artifact role and authority domain/);

    const authority = deltaFor("replace") as unknown as Record<string, unknown>;
    authority.authority_effect = "visual";
    expect(() => validateCanonicalDelta(authority)).toThrow(/must equal none/);

    const promotedAfter = deltaFor("replace");
    if (promotedAfter.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
    promotedAfter.operations[0]!.effect.after[0]!.authority.status = "promoted";
    expect(() => validateCanonicalDelta(promotedAfter)).toThrow(/cannot promote authority status/);

    const sourceMutation = deltaFor("replace");
    if (sourceMutation.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
    for (const artifact of [
      ...sourceMutation.operations[0]!.effect.before,
      ...sourceMutation.operations[0]!.effect.after,
    ]) {
      artifact.role = "source_manifest";
      artifact.authority.domain = "capture";
    }
    expect(() => validateCanonicalDelta(sourceMutation)).toThrow(/immutable capture evidence/);
  });

  it("requires explicit migration from historical world v0.1", () => {
    const historical = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json") as unknown as Record<string, unknown>;
    historical.schema = "world_studio.world.v0.1";
    expect(() => validateCanonicalWorldManifest(historical)).toThrow(/explicit migration/);
  });

  it("binds parent bytes, Delta bytes, and child identity without a circular child hash", () => {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const delta = fixture<CanonicalDeltaV1>("fixtures/valid_delta.json");
    const child = fixture<CanonicalWorldManifestV2>("fixtures/valid_child_world.json");
    const assetSha = `sha256:${fingerprints["fixtures/valid_asset.json"]}`;
    expect(parent.assets[0]!.revision.manifest_sha256).toBe(assetSha);
    expect(parent.assets[0]!.manifest.sha256).toBe(assetSha);
    expect(parent.assets[0]!.manifest.size_bytes).toBe(bytes("fixtures/valid_asset.json").byteLength);
    expect(child.applied_delta!.manifest.size_bytes).toBe(bytes("fixtures/valid_delta.json").byteLength);
    expect(() => validateCanonicalTransitionBinding(parent, delta, child, {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: `sha256:${fingerprints["fixtures/valid_delta.json"]}`,
    })).not.toThrow();

    const wrongDeltaHash = `sha256:${"0".repeat(64)}`;
    expect(() => validateCanonicalTransitionBinding(parent, delta, child, {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: wrongDeltaHash,
    })).toThrow(/applied_delta/);
  });

  it("requires monotonic parent, Delta, and result timestamps", () => {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const delta = fixture<CanonicalDeltaV1>("fixtures/valid_delta.json");
    const child = fixture<CanonicalWorldManifestV2>("fixtures/valid_child_world.json");
    const hashes = {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: `sha256:${fingerprints["fixtures/valid_delta.json"]}`,
    };

    const deltaBeforeParent = clone(delta);
    deltaBeforeParent.created_at = "2026-08-09T12:09:00.000Z";
    expect(() => validateCanonicalDelta(deltaBeforeParent)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, deltaBeforeParent, child, hashes))
      .toThrow(/parent\.created_at <= delta\.created_at <= result\.created_at/);

    const resultBeforeDelta = clone(child);
    resultBeforeDelta.created_at = "2026-08-09T12:19:00.000Z";
    expect(() => validateCanonicalWorldManifest(resultBeforeDelta)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, resultBeforeDelta, hashes))
      .toThrow(/parent\.created_at <= delta\.created_at <= result\.created_at/);
  });

  it("binds Delta provenance to the exact parent version and its artifacts", () => {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const delta = fixture<CanonicalDeltaV1>("fixtures/valid_delta.json");
    const child = fixture<CanonicalWorldManifestV2>("fixtures/valid_child_world.json");
    const hashes = {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: `sha256:${fingerprints["fixtures/valid_delta.json"]}`,
    };

    const missingParent = clone(delta);
    missingParent.provenance.input_versions = [];
    expect(() => validateCanonicalDelta(missingParent)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, missingParent, child, hashes))
      .toThrow(/Delta provenance must include the exact parent version and checksum/);

    const fictionalArtifact = clone(delta);
    fictionalArtifact.provenance.input_artifact_ids = ["fictional_artifact_001"];
    expect(() => validateCanonicalDelta(fictionalArtifact)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, fictionalArtifact, child, hashes))
      .toThrow(/fictional_artifact_001 must exist in the parent manifest/);
  });

  it("does not use a cross-lane validation report to justify a readiness report change", () => {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const delta = fixture<CanonicalDeltaV1>("fixtures/valid_delta.json");
    const child = fixture<CanonicalWorldManifestV2>("fixtures/valid_child_world.json");
    const parentReport = parent.artifacts[1]!;
    const childReport = child.artifacts[1]!;
    parentReport.role = "validation_report";
    parentReport.authority.domain = "metric";
    childReport.role = "validation_report";
    childReport.authority.domain = "metric";
    parent.readiness.visual.report = clone(parentReport.content);
    child.readiness.visual.report = clone(childReport.content);
    if (delta.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
    delta.operations[0]!.effect.before = [clone(parentReport)];
    delta.operations[0]!.effect.after = [clone(childReport)];
    expect(() => validateCanonicalWorldManifest(parent)).not.toThrow();
    expect(() => validateCanonicalWorldManifest(child)).not.toThrow();
    expect(() => validateCanonicalDelta(delta)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, child, {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: `sha256:${fingerprints["fixtures/valid_delta.json"]}`,
    })).toThrow(/visual report cannot change without a declared artifact effect/);
  });

  it("rejects unaccounted transition state and authority changes", () => {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const delta = fixture<CanonicalDeltaV1>("fixtures/valid_delta.json");
    const child = fixture<CanonicalWorldManifestV2>("fixtures/valid_child_world.json");
    const hashes = {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: `sha256:${fingerprints["fixtures/valid_delta.json"]}`,
    };

    const changedCapture = clone(child);
    if (changedCapture.capture_evidence[0]!.uncertainty.status !== "unknown") throw new Error("fixture changed");
    changedCapture.capture_evidence[0]!.uncertainty.reason = "Undeclared capture change.";
    expect(() => validateCanonicalWorldManifest(changedCapture)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, changedCapture, hashes)).toThrow(/capture_evidence byte-for-byte/);

    const changedArtifact = clone(child);
    changedArtifact.artifacts[1]!.content.size_bytes += 1;
    expect(() => validateCanonicalWorldManifest(changedArtifact)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, changedArtifact, hashes)).toThrow(/Artifact transition result/);

    const falseBefore = clone(delta);
    if (falseBefore.operations[0]!.effect.kind !== "artifact_binding") throw new Error("fixture changed");
    falseBefore.operations[0]!.effect.before[0]!.content.size_bytes += 1;
    expect(() => validateCanonicalDelta(falseBefore)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, falseBefore, child, hashes)).toThrow(/before state does not match/);

    const changedAuthority = clone(child);
    changedAuthority.authorities[0]!.status = "held";
    expect(() => validateCanonicalWorldManifest(changedAuthority)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, changedAuthority, hashes)).toThrow(/cannot change visual authority status/);

    const removedDenial = clone(child);
    removedDenial.authorities[0]!.not_approved_for = removedDenial.authorities[0]!.not_approved_for.slice(1);
    expect(() => validateCanonicalWorldManifest(removedDenial)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, removedDenial, hashes)).toThrow(/cannot remove existing restrictions/);

    const changedReadiness = clone(child);
    changedReadiness.readiness.visual.status = "held";
    expect(() => validateCanonicalWorldManifest(changedReadiness)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, changedReadiness, hashes)).toThrow(/cannot change visual status/);

    const changedReport = clone(child);
    changedReport.readiness.visual.report = {
      path: "reports/visual.json",
      sha256: `sha256:${"7".repeat(64)}`,
      size_bytes: 128,
      media_type: "application/json",
    };
    expect(() => validateCanonicalWorldManifest(changedReport)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, changedReport, hashes)).toThrow(/report cannot change/);

    const missingParentProvenance = clone(child);
    missingParentProvenance.provenance.input_versions = missingParentProvenance.provenance.input_versions
      .filter((reference) => reference.kind !== "world");
    expect(() => validateCanonicalWorldManifest(missingParentProvenance)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, missingParentProvenance, hashes)).toThrow(/exact parent version/);

    const changedTransform = clone(child);
    changedTransform.transform_graph.edges[0]!.matrix_row_major[3] = 1;
    expect(() => validateCanonicalWorldManifest(changedTransform)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, changedTransform, hashes)).toThrow(/transform_graph edges/);

    const changedAsset = clone(child);
    changedAsset.assets[0]!.manifest.path = "assets/chair/relocated-manifest.json";
    expect(() => validateCanonicalWorldManifest(changedAsset)).not.toThrow();
    expect(() => validateCanonicalTransitionBinding(parent, delta, changedAsset, hashes)).toThrow(/transition assets/);
  });

  it("fails closed when hide or annotation state cannot be materialized", () => {
    const parent = fixture<CanonicalWorldManifestV2>("fixtures/valid_root_world.json");
    const child = fixture<CanonicalWorldManifestV2>("fixtures/valid_child_world.json");
    const hashes = {
      parent_manifest_sha256: `sha256:${fingerprints["fixtures/valid_root_world.json"]}`,
      delta_manifest_sha256: `sha256:${fingerprints["fixtures/valid_delta.json"]}`,
    };
    for (const intent of ["hide", "annotate"] as const) {
      expect(() => validateCanonicalTransitionBinding(parent, deltaFor(intent), child, hashes), intent)
        .toThrow(/schema-backed state carrier/);
    }
  });
});
