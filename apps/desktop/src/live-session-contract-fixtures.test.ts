import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateLiveAck, validateLiveFrame, validateLiveSession } from "./live-session-contract.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contractRoot = path.join(repoRoot, "contracts/live-session/v0.1");

const fingerprints = {
  "schemas/capture_splat.live_ack.v0.1.schema.json": "618b686f7f8d831f3b7a66937235f6e08e2eed2f3681814fb2fabeb9ba528475",
  "schemas/capture_splat.live_frame.v0.1.schema.json": "adf7736e46f5f0b97308ea17c0e03c1667687979ceff5e2ad03fe44c1023ed65",
  "schemas/capture_splat.live_session.v0.1.schema.json": "cf4a52128e94b0406371f1153601d02758ef3ff10bbe471ea5bbd37a51fe3d8c",
  "fixtures/valid_ack.json": "9831be99f01ece69ab5686fa90c64e6f397d9a27745cd749a7d98ad6c18b33c0",
  "fixtures/valid_frame.json": "0c24c293077e52677f8ca17500cd389f31b8bf863974f8d99ccc7c1b76c32187",
  "fixtures/valid_session.json": "98e1f2e0ca8d8796f9ed02301eacfeab19affbd6a58f52bb4fadbdf8b098f887"
} as const;

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(contractRoot, "fixtures", name), "utf8")) as unknown;
}

describe("Capture Splat live contract mirror", () => {
  it("pins every canonical schema and fixture byte-for-byte", async () => {
    for (const [relativePath, expected] of Object.entries(fingerprints)) {
      const bytes = await readFile(path.join(contractRoot, relativePath));
      expect(createHash("sha256").update(bytes).digest("hex"), relativePath).toBe(expected);
    }
  });

  it("accepts each canonical fixture through the runtime validators", async () => {
    expect(validateLiveSession(await fixture("valid_session.json")).schema).toBe("capture_splat.live_session.v0.1");
    expect(validateLiveFrame(await fixture("valid_frame.json")).schema).toBe("capture_splat.live_frame.v0.1");
    expect(validateLiveAck(await fixture("valid_ack.json")).schema).toBe("capture_splat.live_ack.v0.1");
  });
});
