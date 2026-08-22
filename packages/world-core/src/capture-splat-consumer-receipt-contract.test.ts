import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  CaptureSplatConsumerReceiptContractError,
  validateCaptureSplatConsumerReceipt,
} from "./capture-splat-consumer-receipt-contract.js";

const contractRoot = fileURLToPath(new URL("../../../contracts/capture-splat-consumer/v0.1/", import.meta.url));

function json(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${contractRoot}/${relativePath}`, "utf8")) as Record<string, unknown>;
}

describe("Capture Splat consumer receipt contract", () => {
  it("accepts the pinned schema fixture in AJV and runtime validation", () => {
    const schema = json("schemas/world_studio.capture_splat_consumer_receipt.v0.1.schema.json");
    const fixture = json("fixtures/valid_receipt.json");
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validateCaptureSplatConsumerReceipt(fixture)).toMatchObject({
      decision: "ready",
      authority: "package_integrity_evidence_only",
      authenticity: "not_established",
      tree: { status: "complete", includes_receipt: false },
    });
  });

  it("rejects open objects and receipts that promote incomplete closure", () => {
    const fixture = json("fixtures/valid_receipt.json");
    expect(() => validateCaptureSplatConsumerReceipt({ ...fixture, source_path: "/private/package" }))
      .toThrow(CaptureSplatConsumerReceiptContractError);

    const incomplete = structuredClone(fixture) as Record<string, any>;
    incomplete.closure.missing_file_count = 1;
    expect(() => validateCaptureSplatConsumerReceipt(incomplete)).toThrow(/ready receipt/i);
  });
});
