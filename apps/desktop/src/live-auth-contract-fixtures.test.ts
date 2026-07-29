import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalLiveAuthJson,
  decodePairingInvitationUri,
  encodePairingInvitationUri,
  validateLiveAuthError,
  validateLiveAuthReceipt,
  validatePairingGrantEnvelope,
  validatePairingGrantPayload,
  validatePairingInvitation,
  validatePairingRequestEnvelope,
  verifyPairingRequest
} from "./live-auth-contract.js";
import { canonicalLiveRequestBytes } from "./live-request-auth.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contractRoot = path.join(repoRoot, "contracts/live-auth/v0.1");
const captureContractRoot = path.resolve(repoRoot, "../capture-splat/contracts/live-auth/v0.1");
type SchemaShape = {
  properties: Record<string, { $ref?: string; pattern?: string }>;
  $defs: Record<string, { pattern?: string }>;
};

const fingerprints = {
  "fixtures/valid_auth_error.json": "5e0c16464f0ca82c5abbe7f06d8f329d2d0462a4c0c61a128b3610fcc1869aec",
  "fixtures/valid_auth_receipt.json": "9242b65c8fc7583937de0c7a0e2310248d7eb93ffc36117c7612996ee8bd374f",
  "fixtures/valid_authenticated_request.json": "32435e32f7fd7381035b3b60ba98acc359de4c11011491679222a836f57bd91e",
  "fixtures/valid_pairing_grant_envelope.json": "3034cf282dd10157676cc64df4fe4c6d231045e5f1728ace2a1c0fe576eb5321",
  "fixtures/valid_pairing_grant_payload.json": "536674a84a72ccf57bf152f684fbec4c4e1929845403887c1c6fac1fbeab19ab",
  "fixtures/valid_pairing_invitation.json": "44fc84990bbea158f82484a4840c16292e7b1ca4e9b8573142a671796e7b570d",
  "fixtures/valid_pairing_request_envelope.json": "f3041e6e62c29beff7ad0d29c9e18a277894a70c46f3629511d8202ca83b7442",
  "fixtures/valid_pairing_request_payload.json": "d91635044981019fcc531a79df5c8aa3a3bc5c6766904df74041c7cc2098e1d6",
  "schemas/capture_splat.live_auth_error.v0.1.schema.json": "e03617e66b9fd4ac868fa1794625210269c38d248f8943fb6a7ef88026d206b8",
  "schemas/capture_splat.live_auth_receipt.v0.1.schema.json": "68b279511da9cc377968022aad6b9475c3144d7d031bf26284d44f11a31e9fc5",
  "schemas/capture_splat.live_pairing_grant_envelope.v0.1.schema.json": "0c5ae83baea553afa3892b30cd31a5f8cc91279f53a6e2a6936f23e333488e11",
  "schemas/capture_splat.live_pairing_grant_payload.v0.1.schema.json": "02ca6fb726f703daac47d440f889a114cd8e44066cb5e94bda2ac28a5c8cd7a3",
  "schemas/capture_splat.live_pairing_invitation.v0.1.schema.json": "146cec88f1a689c47d80e22dc20c6960d301aa6d52bde858aa96bb5c537a21b2",
  "schemas/capture_splat.live_pairing_request_envelope.v0.1.schema.json": "ede4a9f9c030f5529a65e95f88792f3961b30953a5e032e9ec7243a0c31a4a58",
  "schemas/capture_splat.live_pairing_request_payload.v0.1.schema.json": "58676e2c777cffba0cf2faee6487bef8d844a8c23fcaccf6d3d957f3d05bd58b"
} as const;

describe("Capture Splat live authentication contract mirror", () => {
  it("pins every mirrored schema and fixture", async () => {
    for (const [relativePath, expected] of Object.entries(fingerprints)) {
      const worldBytes = await readFile(path.join(contractRoot, relativePath));
      expect(createHash("sha256").update(worldBytes).digest("hex"), relativePath).toBe(expected);
    }
  });

  it.skipIf(!existsSync(captureContractRoot))("byte-compares a sibling Capture Splat checkout", async () => {
    for (const relativePath of Object.keys(fingerprints)) {
      const worldBytes = await readFile(path.join(contractRoot, relativePath));
      await expect(readFile(path.join(captureContractRoot, relativePath))).resolves.toEqual(worldBytes);
    }
    await expect(relativeFiles(contractRoot)).resolves.toEqual(await relativeFiles(captureContractRoot));
  });

  it("accepts the canonical pairing fixtures and QR round trip", async () => {
    const invitation = validatePairingInvitation(await fixture("valid_pairing_invitation.json"));
    expect(decodePairingInvitationUri(encodePairingInvitationUri(invitation))).toEqual(invitation);
    expect(validatePairingRequestEnvelope(await fixture("valid_pairing_request_envelope.json")).payload)
      .toEqual(await fixture("valid_pairing_request_payload.json"));
    expect(validatePairingGrantEnvelope(await fixture("valid_pairing_grant_envelope.json")).payload)
      .toEqual(await fixture("valid_pairing_grant_payload.json"));
    expect(validateLiveAuthReceipt(await fixture("valid_auth_receipt.json")).schema)
      .toBe("capture_splat.live_auth_receipt.v0.1");
    expect(validateLiveAuthError(await fixture("valid_auth_error.json"))).toMatchObject({
      code: "request_replayed",
      retryable: false
    });
    await expect(async () => verifyPairingRequest(
      await fixture("valid_pairing_request_envelope.json"),
      invitation,
      new Date(invitation.expires_at)
    )).rejects.toMatchObject({ authCode: "pairing_expired" });
  });

  it("matches the canonical authenticated request byte vector", async () => {
    const vector = await fixture("valid_authenticated_request.json") as Record<string, unknown>;
    const actual = canonicalLiveRequestBytes({
      desktopId: vector.desktop_id as string,
      deviceId: vector.device_id as string,
      grantId: vector.grant_id as string,
      counter: String(vector.counter),
      requestId: vector.request_id as string,
      requestTime: vector.timestamp as string,
      method: vector.method as string,
      canonicalPath: vector.path as string,
      contentType: vector.content_type as string,
      contentLength: vector.content_length as number,
      bodySha256: vector.content_sha256 as string
    });
    expect(actual).toEqual(Buffer.from(vector.canonical_ascii_b64u as string, "base64url"));
    expect(actual.at(-1)).toBe(0x0a);
    expect(() => canonicalLiveRequestBytes({
      desktopId: vector.desktop_id as string,
      deviceId: vector.device_id as string,
      grantId: vector.grant_id as string,
      counter: String(vector.counter),
      requestId: vector.request_id as string,
      requestTime: "2026-02-30T10:32:00.000Z",
      method: vector.method as string,
      canonicalPath: vector.path as string,
      contentType: vector.content_type as string,
      contentLength: vector.content_length as number,
      bodySha256: vector.content_sha256 as string
    })).toThrow(/request time is invalid/);
    const uint64 = canonicalLiveRequestBytes({
      desktopId: vector.desktop_id as string,
      deviceId: vector.device_id as string,
      grantId: vector.grant_id as string,
      counter: "18446744073709551615",
      requestId: vector.request_id as string,
      requestTime: vector.timestamp as string,
      method: "PUT",
      canonicalPath: "/canonical/path",
      contentType: "application/octet-stream",
      contentLength: "18446744073709551615",
      bodySha256: vector.content_sha256 as string
    }).toString("ascii");
    expect(uint64).toContain("\n18446744073709551615\n");
    expect(() => canonicalLiveRequestBytes({
      desktopId: vector.desktop_id as string,
      deviceId: vector.device_id as string,
      grantId: vector.grant_id as string,
      counter: String(vector.counter),
      requestId: vector.request_id as string,
      requestTime: vector.timestamp as string,
      method: "PATCH",
      canonicalPath: "/canonical/path",
      contentType: "application/json",
      contentLength: 0,
      bodySha256: vector.content_sha256 as string
    })).toThrow(/method is invalid/);
  });

  it("rejects non-finite canonical JSON values", () => {
    expect(() => canonicalLiveAuthJson({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalLiveAuthJson({ value: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalLiveAuthJson({ value: "\ud800" })).toThrow(/Unicode scalar/);
  });

  it("rejects noncanonical identifiers, year zero, and invalid Unicode", async () => {
    const invitation = await fixture("valid_pairing_invitation.json") as Record<string, unknown>;
    expect(() => validatePairingInvitation({
      ...invitation,
      pairing_id: `${String(invitation.pairing_id).slice(0, -1)}x`
    })).toThrow(/invalid format/);
    expect(() => validatePairingInvitation({
      ...invitation,
      issued_at: "0000-01-01T00:00:00.000Z"
    })).toThrow(/invalid format|timestamp/);
    expect(() => validatePairingInvitation({
      ...invitation,
      desktop_name: "\ud800"
    })).toThrow(/Unicode scalar/);

    const grant = await fixture("valid_pairing_grant_payload.json") as Record<string, unknown>;
    expect(() => validatePairingGrantPayload({
      ...grant,
      grant_id: `${String(grant.grant_id).slice(0, -1)}x`
    })).toThrow(/invalid format/);

    const receipt = await fixture("valid_auth_receipt.json") as Record<string, unknown>;
    for (const field of ["desktop_id", "device_id"] as const) {
      expect(() => validateLiveAuthReceipt({
        ...receipt,
        [field]: `${String(receipt[field]).slice(0, -1)}B`
      })).toThrow(/invalid format/);
    }
  });

  it("requires canonical Base64URL tail bits in the mirrored schemas", async () => {
    const invitation = await schema("capture_splat.live_pairing_invitation.v0.1.schema.json");
    const requestPayload = await schema("capture_splat.live_pairing_request_payload.v0.1.schema.json");
    const requestEnvelope = await schema("capture_splat.live_pairing_request_envelope.v0.1.schema.json");
    const grantEnvelope = await schema("capture_splat.live_pairing_grant_envelope.v0.1.schema.json");

    expect(invitation.properties.pairing_id.$ref).toBe("#/$defs/pairingId");
    expect(invitation.$defs.pairingId.pattern).toBe("^csp_[A-Za-z0-9_-]{21}[AQgw]$");
    expect(invitation.properties.desktop_id.$ref).toBe("#/$defs/desktopId");
    expect(invitation.$defs.desktopId.pattern).toBe(
      "^wsd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$"
    );
    expect(invitation.$defs.p256PublicKey.pattern).toBe(
      "^[A-Za-z0-9_-]{86}[AEIMQUYcgkosw048]$"
    );
    expect(requestPayload.$defs.requestId.pattern).toBe("^csr_[A-Za-z0-9_-]{21}[AQgw]$");
    expect(requestPayload.$defs.bytes16.pattern).toBe("^[A-Za-z0-9_-]{21}[AQgw]$");
    expect(requestEnvelope.$defs.signature.pattern).toBe(
      "^[A-Za-z0-9_-]{85}[AQgw]$"
    );
    expect(requestEnvelope.properties.payload_b64u.pattern).toBe(
      "^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-][AQgw]|[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048])?$"
    );
    expect(grantEnvelope.$defs.signature.pattern).toBe(
      "^[A-Za-z0-9_-]{85}[AQgw]$"
    );
    expect(grantEnvelope.properties.payload_b64u.pattern).toBe(
      "^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-][AQgw]|[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048])?$"
    );
    const payloadPattern = new RegExp(String(requestEnvelope.properties.payload_b64u.pattern));
    expect(payloadPattern.test(String(
      (await fixture("valid_pairing_request_envelope.json") as Record<string, unknown>).payload_b64u
    ))).toBe(true);
    expect(payloadPattern.test(String(
      (await fixture("valid_pairing_grant_envelope.json") as Record<string, unknown>).payload_b64u
    ))).toBe(true);
    for (const invalid of ["A", "AB", "AAB"]) {
      expect(payloadPattern.test(invalid), invalid).toBe(false);
    }
  });
});

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(contractRoot, "fixtures", name), "utf8")) as unknown;
}

async function schema(name: string): Promise<SchemaShape> {
  return JSON.parse(await readFile(path.join(contractRoot, "schemas", name), "utf8")) as SchemaShape;
}

async function relativeFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const directory of ["fixtures", "schemas"]) {
    for (const name of await readdir(path.join(root, directory))) {
      result.push(`${directory}/${name}`);
    }
  }
  return result.sort();
}
