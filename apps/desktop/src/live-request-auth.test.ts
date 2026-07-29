import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PairingStore,
  deviceIdFor,
  type LiveGrantScope,
  type RegisterPairedDeviceInput
} from "./live-pairing-store.js";
import {
  LIVE_AUTH_HEADERS,
  authenticateLiveRequest,
  authorizeLiveRequestHeaders,
  canonicalLiveRequestBytes,
  type AuthenticateLiveRequestInput
} from "./live-request-auth.js";

const roots: string[] = [];
const now = new Date("2026-07-29T10:30:00.000Z");
const requestTime = "2026-07-29T10:30:00.000Z";
const apiRoot = "/api/capture-splat/live/v0.1";
const desktopId = `wsd_${Buffer.alloc(32, 3).toString("base64url")}`;
const tlsCertificateSha256 = `sha256:${"c".repeat(64)}`;
const allScopes: LiveGrantScope[] = [
  "receiver:status",
  "session:create",
  "session:resume",
  "frame:put",
  "asset:put",
  "session:finalize"
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("authenticateLiveRequest", () => {
  it("authenticates exact P1363-signed bytes and binds the live session owner", async () => {
    const fixture = await authFixture();
    const create = signedRequest(fixture, {
      counter: "1",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    await expect(authenticateLiveRequest(create)).resolves.toMatchObject({
      desktopId: fixture.desktopId,
      deviceId: fixture.registration.deviceId,
      grantId: fixture.registration.grant.grantId,
      pairingEpoch: 1,
      scope: "session:create",
      sessionId: "room-session",
      counter: "1"
    });
    await expect(fixture.store.assertSessionOwner("room-session", fixture.registration.deviceId))
      .resolves.toBeUndefined();

    const frame = signedRequest(fixture, {
      counter: "2",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session/frames/1`,
      body: Buffer.from('{"frame":1}'),
      contentType: "application/json"
    });
    await expect(authenticateLiveRequest(frame)).resolves.toMatchObject({
      scope: "frame:put",
      sessionId: "room-session"
    });
    await expect(authenticateLiveRequest(frame)).rejects.toMatchObject({ code: "replay", statusCode: 409 });
  });

  it("rejects inactive or moved receiver identity before replay or ownership mutation", async () => {
    const fixture = await authFixture();
    const create = signedRequest(fixture, {
      counter: "1",
      method: "PUT",
      path: `${apiRoot}/sessions/not-active`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    await expect(authenticateLiveRequest({
      ...create,
      expectedGrantId: `csg_${Buffer.alloc(16, 9).toString("base64url")}`
    })).rejects.toMatchObject({ code: "forbidden", authCode: "permission_denied" });
    await expect(fixture.store.assertSessionOwner("not-active", fixture.registration.deviceId))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(authenticateLiveRequest(create)).resolves.toMatchObject({ counter: "1" });

    const health = signedRequest(fixture, {
      counter: "2",
      method: "GET",
      path: `${apiRoot}/health`,
      body: Buffer.alloc(0),
      contentType: "-"
    });
    await expect(authenticateLiveRequest({
      ...health,
      tlsCertificateSha256: `sha256:${"d".repeat(64)}`
    })).rejects.toMatchObject({ authCode: "identity_mismatch" });
    await expect(authenticateLiveRequest(health)).resolves.toMatchObject({ counter: "2" });
  });

  it("burns a signed counter but never binds ownership when session JSON is rejected", async () => {
    const fixture = await authFixture();
    const create = signedRequest(fixture, {
      counter: "1",
      method: "PUT",
      path: `${apiRoot}/sessions/malformed`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    const declaredBodySha256 = create.bodySha256;
    await expect(authenticateLiveRequest({
      ...create,
      bodySha256: sha(Buffer.from("{"))
    })).rejects.toMatchObject({
      authCode: "body_digest_mismatch"
    });
    await expect(fixture.store.assertSessionOwner("malformed", fixture.registration.deviceId))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(authenticateLiveRequest({
      ...create,
      bodySha256: declaredBodySha256
    })).rejects.toMatchObject({ code: "replay" });
  });

  it("rejects duplicate headers and mutations of method, path, length, digest, or signature", async () => {
    const fixture = await authFixture();
    const duplicate = signedRequest(fixture, {
      counter: "1",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    duplicate.request.rawHeaders = [
      ...duplicate.request.rawHeaders,
      "X-Capture-Splat-Device",
      fixture.registration.deviceId
    ];
    await expect(authenticateLiveRequest(duplicate)).rejects.toMatchObject({ code: "malformed" });

    const changedPath = signedRequest(fixture, {
      counter: "2",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    changedPath.request.url = `${apiRoot}/sessions/other-session`;
    await expect(authenticateLiveRequest(changedPath)).rejects.toMatchObject({ code: "unauthorized" });

    const changedMethod = signedRequest(fixture, {
      counter: "3",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    changedMethod.request.method = "GET";
    await expect(authenticateLiveRequest(changedMethod)).rejects.toMatchObject({ code: "malformed" });

    const changedLength = signedRequest(fixture, {
      counter: "4",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    setHeader(changedLength.request.rawHeaders, "Content-Length", "3");
    await expect(authenticateLiveRequest(changedLength)).rejects.toMatchObject({ code: "unauthorized" });

    const changedBody = signedRequest(fixture, {
      counter: "5",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    changedBody.bodySha256 = sha(Buffer.from('{"changed":true}'));
    await expect(authenticateLiveRequest(changedBody)).rejects.toMatchObject({
      code: "unauthorized",
      authCode: "body_digest_mismatch"
    });

    const changedSignature = signedRequest(fixture, {
      counter: "6",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    const signatureIndex = headerValueIndex(changedSignature.request.rawHeaders, LIVE_AUTH_HEADERS.signature);
    changedSignature.request.rawHeaders[signatureIndex] = Buffer.alloc(64, 7).toString("base64url");
    await expect(authenticateLiveRequest(changedSignature)).rejects.toMatchObject({
      code: "unauthorized",
      authCode: "request_signature_invalid"
    });

    const encodedPath = signedRequest(fixture, {
      counter: "7",
      method: "PUT",
      path: `${apiRoot}/sessions/room-session`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    encodedPath.request.url = `${apiRoot}/sessions/room%2Dsession`;
    await expect(authenticateLiveRequest(encodedPath)).rejects.toMatchObject({ code: "malformed" });
  });

  it("rejects expired, revoked, under-scoped, and cross-device requests", async () => {
    const fixture = await authFixture(["session:create", "session:resume"]);
    const create = signedRequest(fixture, {
      counter: "1",
      method: "PUT",
      path: `${apiRoot}/sessions/owned`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    await authenticateLiveRequest(create);

    const underScoped = signedRequest(fixture, {
      counter: "2",
      method: "PUT",
      path: `${apiRoot}/sessions/owned/frames/1`,
      body: Buffer.from("{}"),
      contentType: "application/json"
    });
    await expect(authenticateLiveRequest(underScoped)).rejects.toMatchObject({
      code: "forbidden",
      authCode: "permission_denied"
    });

    const second = keyFixture("phone-b", allScopes);
    await fixture.store.registerDevice(second.registration);
    const secondFixture = {
      ...fixture,
      privateKey: second.privateKey,
      registration: second.registration
    };
    const takeover = signedRequest(secondFixture, {
      counter: "1",
      method: "GET",
      path: `${apiRoot}/sessions/owned`,
      body: Buffer.alloc(0),
      contentType: "-"
    });
    await expect(authenticateLiveRequest(takeover)).rejects.toMatchObject({
      code: "forbidden",
      authCode: "session_owner_mismatch"
    });

    await fixture.store.revoke(fixture.registration.deviceId, "2026-07-29T10:31:00.000Z");
    const revoked = signedRequest(fixture, {
      counter: "3",
      method: "GET",
      path: `${apiRoot}/sessions/owned`,
      body: Buffer.alloc(0),
      contentType: "-"
    });
    await expect(authenticateLiveRequest({ ...revoked, now: new Date("2026-07-29T10:31:01.000Z") }))
      .rejects.toMatchObject({ code: "unauthorized", authCode: "grant_revoked" });

    const expiredFixture = await authFixture();
    const expired = signedRequest(expiredFixture, {
      counter: "1",
      method: "GET",
      path: `${apiRoot}/health`,
      body: Buffer.alloc(0),
      contentType: "-",
      timestamp: "2026-07-30T00:00:00.000Z"
    });
    await expect(authenticateLiveRequest({ ...expired, now: new Date("2026-07-30T00:00:00.000Z") }))
      .rejects.toMatchObject({ code: "unauthorized", authCode: "grant_expired" });
  });

  it("requires canonical empty GET bodies and current timestamps", async () => {
    const fixture = await authFixture();
    const health = signedRequest(fixture, {
      counter: "1",
      method: "GET",
      path: `${apiRoot}/health`,
      body: Buffer.alloc(0),
      contentType: "-"
    });
    const { bodySizeBytes: _bodySizeBytes, ...headerRequest } = health.request;
    await expect(authorizeLiveRequestHeaders({
      request: headerRequest,
      now: health.now,
      pairingStore: health.pairingStore,
      desktopId: health.desktopId,
      tlsCertificateSha256: health.tlsCertificateSha256
    })).resolves.toMatchObject({
      scope: "receiver:status",
      declaredContentLength: 0,
      declaredBodySha256: sha(Buffer.alloc(0))
    });

    const stale = signedRequest(fixture, {
      counter: "2",
      method: "GET",
      path: `${apiRoot}/health`,
      body: Buffer.alloc(0),
      contentType: "-",
      timestamp: "2026-07-29T10:00:00.000Z"
    });
    await expect(authenticateLiveRequest(stale)).rejects.toMatchObject({
      code: "unauthorized",
      authCode: "request_stale"
    });

    const compressed = signedRequest(fixture, {
      counter: "3",
      method: "GET",
      path: `${apiRoot}/status`,
      body: Buffer.alloc(0),
      contentType: "-"
    });
    compressed.request.rawHeaders = [...compressed.request.rawHeaders, "Content-Encoding", "gzip"];
    await expect(authenticateLiveRequest(compressed)).rejects.toMatchObject({ code: "malformed" });

    const yearZero = signedRequest(fixture, {
      counter: "4",
      method: "GET",
      path: `${apiRoot}/health`,
      body: Buffer.alloc(0),
      contentType: "-"
    });
    setHeader(yearZero.request.rawHeaders, LIVE_AUTH_HEADERS.time, "0000-01-01T00:00:00.000Z");
    await expect(authenticateLiveRequest(yearZero)).rejects.toMatchObject({
      authCode: "request_stale"
    });
  });
});

interface AuthFixture {
  store: PairingStore;
  desktopId: string;
  tlsCertificateSha256: string;
  privateKey: KeyObject;
  registration: RegisterPairedDeviceInput;
}

async function authFixture(scopes = allScopes): Promise<AuthFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "world-studio-live-auth-"));
  roots.push(root);
  const store = new PairingStore(root);
  const device = keyFixture("phone-a", scopes);
  await store.registerDevice(device.registration);
  return {
    store,
    desktopId,
    tlsCertificateSha256,
    privateKey: device.privateKey,
    registration: device.registration
  };
}

function keyFixture(name: string, scopes: LiveGrantScope[]) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const publicKeyX963 = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from(jwk.y!, "base64url")
  ]);
  const registration: RegisterPairedDeviceInput = {
    deviceId: deviceIdFor(publicKeyX963),
    displayName: name,
    publicKeyX963B64u: publicKeyX963.toString("base64url"),
    pairedAt: "2026-07-29T10:00:00.000Z",
    grant: {
      grantId: `csg_${idBytes(`grant-${name}`).toString("base64url")}`,
      desktopId,
      tlsCertificateSha256,
      scopes,
      issuedAt: "2026-07-29T10:00:00.000Z",
      notBefore: "2026-07-29T10:00:00.000Z",
      expiresAt: "2026-07-30T00:00:00.000Z"
    }
  };
  return { privateKey, publicKeyX963, registration };
}

function signedRequest(
  fixture: AuthFixture,
  values: {
    counter: string;
    method: string;
    path: string;
    body: Buffer;
    contentType: string;
    timestamp?: string;
  }
): AuthenticateLiveRequestInput {
  const timestamp = values.timestamp ?? requestTime;
  const bodySha256 = sha(values.body);
  const requestId = `csr_${idBytes(`request-${values.counter}`).toString("base64url")}`;
  const canonical = canonicalLiveRequestBytes({
    desktopId: fixture.desktopId,
    deviceId: fixture.registration.deviceId,
    grantId: fixture.registration.grant.grantId,
    counter: values.counter,
    requestId,
    requestTime: timestamp,
    method: values.method,
    canonicalPath: values.path,
    contentType: values.contentType,
    contentLength: values.body.byteLength,
    bodySha256
  });
  const signature = sign(
    "sha256",
    canonical,
    { key: fixture.privateKey, dsaEncoding: "ieee-p1363" }
  ).toString("base64url");
  const rawHeaders: string[] = [
    "Content-Length", String(values.body.byteLength),
    "X-Capture-Splat-Device", fixture.registration.deviceId,
    "X-Capture-Splat-Grant", fixture.registration.grant.grantId,
    "X-Capture-Splat-Counter", values.counter,
    "X-Capture-Splat-Request", requestId,
    "X-Capture-Splat-Time", timestamp,
    "X-Capture-Splat-Content-SHA256", bodySha256,
    "X-Capture-Splat-Signature", signature
  ];
  if (values.contentType !== "-") rawHeaders.push("Content-Type", values.contentType);
  return {
    request: {
      method: values.method,
      url: values.path,
      rawHeaders,
      bodySizeBytes: values.body.byteLength
    },
    bodySha256,
    now,
    pairingStore: fixture.store,
    desktopId: fixture.desktopId,
    tlsCertificateSha256: fixture.tlsCertificateSha256
  };
}

function setHeader(headers: readonly string[], name: string, value: string): void {
  (headers as string[])[headerValueIndex(headers, name)] = value;
}

function headerValueIndex(headers: readonly string[], name: string): number {
  for (let index = 0; index < headers.length; index += 2) {
    if (headers[index]?.toLowerCase() === name.toLowerCase()) return index + 1;
  }
  throw new Error(`Missing header ${name}`);
}

function sha(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function idBytes(value: string): Buffer {
  return createHash("sha256").update(value).digest().subarray(0, 16);
}
