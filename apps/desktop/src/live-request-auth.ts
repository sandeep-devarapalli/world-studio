import {
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";
import {
  PairingStore,
  PairingStoreError,
  type LiveGrantScope
} from "./live-pairing-store.js";
import type { LiveAuthErrorCode } from "./live-auth-contract.js";

const apiRoot = "/api/capture-splat/live/v0.1";
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const deviceIdPattern = /^csd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const desktopIdPattern = /^wsd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const grantIdPattern = /^csg_[A-Za-z0-9_-]{21}[AQgw]$/;
const requestIdPattern = /^csr_[A-Za-z0-9_-]{21}[AQgw]$/;
const counterPattern = /^(?:0|[1-9][0-9]{0,19})$/;
const maxUInt64 = (1n << 64n) - 1n;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const rfc3339MillisPattern = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const emptySha256 = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const LIVE_AUTH_HEADERS = {
  device: "x-capture-splat-device",
  grant: "x-capture-splat-grant",
  counter: "x-capture-splat-counter",
  request: "x-capture-splat-request",
  time: "x-capture-splat-time",
  contentSha256: "x-capture-splat-content-sha256",
  signature: "x-capture-splat-signature"
} as const;

export interface LiveAuthHeaderRequestLike {
  method?: string;
  url?: string;
  rawHeaders: readonly string[];
}

export interface LiveAuthRequestLike extends LiveAuthHeaderRequestLike {
  bodySizeBytes: number;
}

export interface AuthorizeLiveRequestHeadersInput {
  request: LiveAuthHeaderRequestLike;
  now: Date;
  pairingStore: PairingStore;
  desktopId: string;
  tlsCertificateSha256: string;
  expectedDeviceId?: string;
  expectedGrantId?: string;
  recoverUnknownSessionOwner?: (
    evidence: LiveSessionOwnerRecoveryEvidence
  ) => Promise<boolean>;
  maxClockSkewMs?: number;
}

export interface AuthenticateLiveRequestInput extends Omit<AuthorizeLiveRequestHeadersInput, "request"> {
  request: LiveAuthRequestLike;
  bodySha256: string;
}

export interface LiveRequestPrincipal {
  desktopId: string;
  deviceId: string;
  grantId: string;
  pairingEpoch: number;
  permissions: LiveGrantScope[];
  grantExpiresAt: string;
  scope: LiveGrantScope;
  sessionId: string | null;
  requestId: string;
  counter: string;
  requestTime: string;
  declaredContentLength: number;
  declaredBodySha256: string;
  sessionOwnership: RouteAuthorization["ownership"];
}

export interface LiveSessionOwnerRecoveryEvidence {
  sessionId: string;
  desktopId: string;
  deviceId: string;
  grantId: string;
  pairingEpoch: number;
  permissions: LiveGrantScope[];
  grantExpiresAt: string;
  requestTime: string;
}

export interface CanonicalLiveRequestFields {
  desktopId: string;
  deviceId: string;
  grantId: string;
  counter: string;
  requestId: string;
  requestTime: string;
  method: string;
  canonicalPath: string;
  contentType: string;
  contentLength: number | string;
  bodySha256: string;
}

interface RouteAuthorization {
  scope: LiveGrantScope;
  sessionId: string | null;
  ownership: "none" | "bind" | "require";
  contentKind: "empty" | "json" | "asset";
}

export class LiveRequestAuthError extends Error {
  constructor(
    message: string,
    readonly code: "malformed" | "unauthorized" | "forbidden" | "replay" = "unauthorized",
    readonly statusCode = code === "malformed" ? 400 : code === "forbidden" ? 403 : code === "replay" ? 409 : 401,
    readonly authCode: LiveAuthErrorCode = "invalid_request"
  ) {
    super(message);
    this.name = "LiveRequestAuthError";
  }
}

export async function authorizeLiveRequestHeaders(
  input: AuthorizeLiveRequestHeadersInput
): Promise<LiveRequestPrincipal> {
  const now = input.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new LiveRequestAuthError("Authorization clock is invalid.", "malformed");
  }
  if (!desktopIdPattern.test(input.desktopId)) {
    throw new LiveRequestAuthError("Receiver desktop identity is invalid.", "malformed");
  }
  if (!sha256Pattern.test(input.tlsCertificateSha256)) {
    throw new LiveRequestAuthError("Receiver TLS certificate fingerprint is invalid.", "malformed");
  }
  const method = input.request.method;
  if (typeof method !== "string" || method !== method.toUpperCase() || !/^[A-Z]+$/.test(method)) {
    throw new LiveRequestAuthError("HTTP method is not canonical.", "malformed");
  }
  const canonicalPath = validCanonicalPath(input.request.url);
  const route = authorizeRoute(method, canonicalPath);
  const headers = strictRawHeaders(input.request.rawHeaders);
  rejectHeader(headers, "transfer-encoding");
  rejectHeader(headers, "content-encoding");

  const deviceId = requiredHeader(headers, LIVE_AUTH_HEADERS.device);
  const grantId = requiredHeader(headers, LIVE_AUTH_HEADERS.grant);
  const counter = requiredHeader(headers, LIVE_AUTH_HEADERS.counter);
  const requestId = requiredHeader(headers, LIVE_AUTH_HEADERS.request);
  const requestTime = requiredHeader(headers, LIVE_AUTH_HEADERS.time);
  const declaredBodySha256 = requiredHeader(headers, LIVE_AUTH_HEADERS.contentSha256);
  const signatureValue = requiredHeader(headers, LIVE_AUTH_HEADERS.signature);
  if (!deviceIdPattern.test(deviceId)) throw malformedCredential("device ID");
  if (!grantIdPattern.test(grantId)) throw malformedCredential("grant ID");
  if (
    (input.expectedDeviceId !== undefined && deviceId !== input.expectedDeviceId)
    || (input.expectedGrantId !== undefined && grantId !== input.expectedGrantId)
  ) {
    throw new LiveRequestAuthError(
      "The paired LAN listener is not active for this device grant.",
      "forbidden",
      403,
      "permission_denied"
    );
  }
  if (!counterPattern.test(counter) || BigInt(counter) > maxUInt64) throw malformedCredential("counter");
  if (!requestIdPattern.test(requestId)) throw malformedCredential("request ID");
  const parsedRequestTime = new Date(requestTime);
  if (
    !rfc3339MillisPattern.test(requestTime)
    || !Number.isFinite(parsedRequestTime.getTime())
    || parsedRequestTime.toISOString() !== requestTime
    || Math.abs(now.getTime() - parsedRequestTime.getTime()) > (input.maxClockSkewMs ?? 300_000)
  ) {
    throw new LiveRequestAuthError(
      "Request timestamp is outside the accepted clock window.",
      "unauthorized",
      401,
      "request_stale"
    );
  }
  if (!sha256Pattern.test(declaredBodySha256)) {
    throw new LiveRequestAuthError("Request body digest is malformed.", "malformed");
  }

  const declaredContentLength = canonicalContentLength(requiredHeader(headers, "content-length"));
  const contentType = canonicalContentType(headers, route.contentKind);
  if (
    route.contentKind === "empty"
    && (declaredContentLength !== 0 || declaredBodySha256 !== emptySha256)
  ) {
    throw new LiveRequestAuthError("GET requests must sign an empty body.", "malformed");
  }

  let grant;
  try {
    grant = await input.pairingStore.getGrant(deviceId, grantId, {
      now,
      desktopId: input.desktopId,
      tlsCertificateSha256: input.tlsCertificateSha256
    });
  } catch (error) {
    throw mapPairingError(error);
  }

  const canonical = canonicalLiveRequestBytes({
    desktopId: input.desktopId,
    deviceId,
    grantId,
    counter,
    requestId,
    requestTime,
    method,
    canonicalPath,
    contentType,
    contentLength: declaredContentLength,
    bodySha256: declaredBodySha256
  });
  const signature = canonicalBase64Url(signatureValue, "signature");
  if (signature.byteLength !== 64) throw malformedCredential("signature");
  const publicKey = publicKeyFromX963(grant.publicKeyX963B64u);
  const validSignature = verifySignature(
    "sha256",
    canonical,
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    signature
  );
  if (!validSignature) {
    throw new LiveRequestAuthError(
      "Request signature is invalid.",
      "unauthorized",
      401,
      "request_signature_invalid"
    );
  }

  try {
    grant = await input.pairingStore.reserveCounter(deviceId, grantId, counter, {
      now,
      requiredScope: route.scope,
      desktopId: input.desktopId,
      tlsCertificateSha256: input.tlsCertificateSha256
    });
    if (route.sessionId && route.ownership === "require") {
      try {
        await input.pairingStore.assertSessionOwner(route.sessionId, deviceId);
      } catch (error) {
        if (
          !(error instanceof PairingStoreError)
          || error.code !== "not_found"
          || !input.recoverUnknownSessionOwner
          || !(await input.recoverUnknownSessionOwner({
            sessionId: route.sessionId,
            desktopId: input.desktopId,
            deviceId,
            grantId,
            pairingEpoch: grant.pairingEpoch,
            permissions: [...grant.scopes],
            grantExpiresAt: grant.expiresAt,
            requestTime
          }))
        ) {
          throw error;
        }
        await input.pairingStore.bindSessionOwner(route.sessionId, deviceId, requestTime);
      }
    }
  } catch (error) {
    throw mapPairingError(error);
  }

  return {
    desktopId: input.desktopId,
    deviceId,
    grantId,
    pairingEpoch: grant.pairingEpoch,
    permissions: [...grant.scopes],
    grantExpiresAt: grant.expiresAt,
    scope: route.scope,
    sessionId: route.sessionId,
    requestId,
    counter,
    requestTime,
    declaredContentLength,
    declaredBodySha256,
    sessionOwnership: route.ownership
  };
}

export async function authenticateLiveRequest(
  input: AuthenticateLiveRequestInput
): Promise<LiveRequestPrincipal> {
  const principal = await authorizeLiveRequestHeaders({
    request: input.request,
    now: input.now,
    pairingStore: input.pairingStore,
    desktopId: input.desktopId,
    tlsCertificateSha256: input.tlsCertificateSha256,
    ...(input.expectedDeviceId === undefined ? {} : { expectedDeviceId: input.expectedDeviceId }),
    ...(input.expectedGrantId === undefined ? {} : { expectedGrantId: input.expectedGrantId }),
    ...(input.recoverUnknownSessionOwner === undefined
      ? {}
      : { recoverUnknownSessionOwner: input.recoverUnknownSessionOwner }),
    ...(input.maxClockSkewMs === undefined ? {} : { maxClockSkewMs: input.maxClockSkewMs })
  });
  verifyAuthenticatedLiveRequestBody(principal, {
    bodySizeBytes: input.request.bodySizeBytes,
    bodySha256: input.bodySha256
  });
  if (principal.sessionId && principal.sessionOwnership === "bind") {
    try {
      await input.pairingStore.bindSessionOwner(
        principal.sessionId,
        principal.deviceId,
        principal.requestTime
      );
    } catch (error) {
      throw mapPairingError(error);
    }
  }
  return principal;
}

export function verifyAuthenticatedLiveRequestBody(
  principal: Pick<LiveRequestPrincipal, "declaredContentLength" | "declaredBodySha256">,
  evidence: { bodySizeBytes: number; bodySha256: string }
): void {
  if (!Number.isSafeInteger(evidence.bodySizeBytes) || evidence.bodySizeBytes < 0) {
    throw new LiveRequestAuthError("Received body length is invalid.", "malformed");
  }
  if (!sha256Pattern.test(evidence.bodySha256)) {
    throw new LiveRequestAuthError("Received body digest is malformed.", "malformed");
  }
  if (principal.declaredContentLength !== evidence.bodySizeBytes) {
    throw new LiveRequestAuthError(
      "Content-Length does not match the received bytes.",
      "unauthorized",
      401,
      "body_digest_mismatch"
    );
  }
  if (!constantTimeTextEqual(principal.declaredBodySha256, evidence.bodySha256)) {
    throw new LiveRequestAuthError(
      "Request body digest does not match the received bytes.",
      "unauthorized",
      401,
      "body_digest_mismatch"
    );
  }
}

export function canonicalLiveRequestBytes(fields: CanonicalLiveRequestFields): Buffer {
  if (!desktopIdPattern.test(fields.desktopId)) throw new LiveRequestAuthError("Canonical desktop ID is invalid.", "malformed");
  if (!deviceIdPattern.test(fields.deviceId)) throw new LiveRequestAuthError("Canonical device ID is invalid.", "malformed");
  if (!grantIdPattern.test(fields.grantId)) throw new LiveRequestAuthError("Canonical grant ID is invalid.", "malformed");
  if (!counterPattern.test(fields.counter) || BigInt(fields.counter) > maxUInt64) {
    throw new LiveRequestAuthError("Canonical counter is invalid.", "malformed");
  }
  if (!requestIdPattern.test(fields.requestId)) throw new LiveRequestAuthError("Canonical request ID is invalid.", "malformed");
  const parsedRequestTime = new Date(fields.requestTime);
  if (
    !rfc3339MillisPattern.test(fields.requestTime)
    || !Number.isFinite(parsedRequestTime.getTime())
    || parsedRequestTime.toISOString() !== fields.requestTime
  ) {
    throw new LiveRequestAuthError("Canonical request time is invalid.", "malformed");
  }
  if (fields.method !== "GET" && fields.method !== "POST" && fields.method !== "PUT") {
    throw new LiveRequestAuthError("Canonical method is invalid.", "malformed");
  }
  validCanonicalPath(fields.canonicalPath);
  if (
    fields.contentType !== "-"
    && fields.contentType !== "application/json"
    && !mediaTypePattern.test(fields.contentType)
  ) {
    throw new LiveRequestAuthError("Canonical content type is invalid.", "malformed");
  }
  const contentLength = canonicalUInt64(fields.contentLength, "Canonical content length");
  if (!sha256Pattern.test(fields.bodySha256)) {
    throw new LiveRequestAuthError("Canonical body digest is invalid.", "malformed");
  }
  return Buffer.from([
    "CAPTURE-SPLAT-AUTH-V1",
    fields.desktopId,
    fields.deviceId,
    fields.grantId,
    fields.counter,
    fields.requestId,
    fields.requestTime,
    fields.method,
    fields.canonicalPath,
    fields.contentType,
    contentLength,
    fields.bodySha256,
    ""
  ].join("\n"), "ascii");
}

function authorizeRoute(method: string, rawPath: string): RouteAuthorization {
  if (method === "GET" && (rawPath === `${apiRoot}/health` || rawPath === `${apiRoot}/status`)) {
    return { scope: "receiver:status", sessionId: null, ownership: "none", contentKind: "empty" };
  }
  let match = new RegExp(`^${escapeRegex(apiRoot)}/sessions/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$`).exec(rawPath);
  if (match) {
    if (method === "PUT") {
      return { scope: "session:create", sessionId: match[1]!, ownership: "bind", contentKind: "json" };
    }
    if (method === "GET") {
      return { scope: "session:resume", sessionId: match[1]!, ownership: "require", contentKind: "empty" };
    }
    throw new LiveRequestAuthError("HTTP method is not allowed for this live route.", "malformed");
  }
  match = new RegExp(
    `^${escapeRegex(apiRoot)}/sessions/([A-Za-z0-9][A-Za-z0-9._-]{0,127})/finalize$`
  ).exec(rawPath);
  if (match) {
    if (method !== "POST") throw new LiveRequestAuthError("HTTP method is not allowed for finalization.", "malformed");
    return { scope: "session:finalize", sessionId: match[1]!, ownership: "require", contentKind: "json" };
  }
  match = new RegExp(
    `^${escapeRegex(apiRoot)}/sessions/([A-Za-z0-9][A-Za-z0-9._-]{0,127})/frames/([1-9][0-9]*)$`
  ).exec(rawPath);
  if (match) {
    if (method !== "PUT") throw new LiveRequestAuthError("HTTP method is not allowed for frame metadata.", "malformed");
    return { scope: "frame:put", sessionId: match[1]!, ownership: "require", contentKind: "json" };
  }
  match = new RegExp(
    `^${escapeRegex(apiRoot)}/sessions/([A-Za-z0-9][A-Za-z0-9._-]{0,127})/frames/([1-9][0-9]*)/assets/(source|depth|confidence|mask-person|mask-valid|mask-object)$`
  ).exec(rawPath);
  if (match) {
    if (method !== "PUT") throw new LiveRequestAuthError("HTTP method is not allowed for frame assets.", "malformed");
    return { scope: "asset:put", sessionId: match[1]!, ownership: "require", contentKind: "asset" };
  }
  throw new LiveRequestAuthError("Live request path is not canonical.", "malformed");
}

function validCanonicalPath(value: string | undefined): string {
  if (
    typeof value !== "string"
    || !/^\/[A-Za-z0-9._/-]+$/.test(value)
    || value.includes("?")
    || value.includes("#")
    || value.includes("%")
    || value.includes("\\")
    || value.includes("//")
    || value.endsWith("/")
    || value.split("/").slice(1).some((part) => part === "." || part === "..")
    || !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new LiveRequestAuthError("Live request path is not canonical.", "malformed");
  }
  return value;
}

function strictRawHeaders(rawHeaders: readonly string[]): Map<string, string> {
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0 || rawHeaders.length > 128) {
    throw new LiveRequestAuthError("Raw HTTP headers are malformed.", "malformed");
  }
  const headers = new Map<string, string>();
  let totalBytes = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const rawName = rawHeaders[index];
    const rawValue = rawHeaders[index + 1];
    if (
      typeof rawName !== "string"
      || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(rawName)
      || typeof rawValue !== "string"
      || /[\r\n\u0000]/.test(rawValue)
    ) {
      throw new LiveRequestAuthError("Raw HTTP header is malformed.", "malformed");
    }
    totalBytes += Buffer.byteLength(rawName, "ascii") + Buffer.byteLength(rawValue, "utf8");
    if (rawValue.length > 8192 || totalBytes > 32 * 1024) {
      throw new LiveRequestAuthError("Raw HTTP headers exceed the authentication limit.", "malformed");
    }
    const name = rawName.toLowerCase();
    if (headers.has(name)) throw new LiveRequestAuthError(`Duplicate HTTP header: ${name}.`, "malformed");
    headers.set(name, rawValue);
  }
  return headers;
}

function requiredHeader(headers: Map<string, string>, name: string): string {
  const value = headers.get(name);
  if (value === undefined || !value || value !== value.trim()) {
    throw new LiveRequestAuthError(`Required HTTP header ${name} is missing or noncanonical.`, "malformed");
  }
  return value;
}

function rejectHeader(headers: Map<string, string>, name: string): void {
  if (headers.has(name)) throw new LiveRequestAuthError(`${name} is not accepted.`, "malformed");
}

function canonicalContentLength(value: string): number {
  const canonical = canonicalUInt64(value, "Content-Length");
  const length = Number(canonical);
  if (!Number.isSafeInteger(length)) {
    throw new LiveRequestAuthError("Content-Length exceeds this receiver's safe byte limit.", "malformed");
  }
  return length;
}

function canonicalUInt64(value: number | string, label: string): string {
  const text = typeof value === "number"
    ? Number.isSafeInteger(value) && value >= 0 ? String(value) : ""
    : value;
  if (!/^(?:0|[1-9][0-9]*)$/.test(text) || BigInt(text) > maxUInt64) {
    throw new LiveRequestAuthError(`${label} is not a canonical UInt64.`, "malformed");
  }
  return text;
}

function canonicalContentType(
  headers: Map<string, string>,
  kind: RouteAuthorization["contentKind"]
): string {
  const value = headers.get("content-type");
  if (kind === "empty") {
    if (value !== undefined) throw new LiveRequestAuthError("Empty request must omit Content-Type.", "malformed");
    return "-";
  }
  if (value === undefined || value !== value.trim() || value !== value.toLowerCase()) {
    throw new LiveRequestAuthError("Content-Type is missing or noncanonical.", "malformed");
  }
  if (kind === "json" && value !== "application/json") {
    throw new LiveRequestAuthError("JSON route requires application/json.", "malformed");
  }
  if (kind === "asset" && !mediaTypePattern.test(value)) {
    throw new LiveRequestAuthError("Asset Content-Type is invalid.", "malformed");
  }
  return value;
}

function canonicalBase64Url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new LiveRequestAuthError(`${label} is malformed.`, "malformed");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new LiveRequestAuthError(`${label} is not canonical.`, "malformed");
  return bytes;
}

function publicKeyFromX963(value: string) {
  const bytes = canonicalBase64Url(value, "device public key");
  if (bytes.byteLength !== 65 || bytes[0] !== 4) {
    throw new LiveRequestAuthError("Device public key is invalid.", "unauthorized");
  }
  return createPublicKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: bytes.subarray(1, 33).toString("base64url"),
      y: bytes.subarray(33, 65).toString("base64url")
    }
  });
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "ascii");
  const rightBytes = Buffer.from(right, "ascii");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function mapPairingError(error: unknown): LiveRequestAuthError {
  if (!(error instanceof PairingStoreError)) {
    return new LiveRequestAuthError("Pairing authorization failed.", "unauthorized");
  }
  if (error.code === "replay") {
    return new LiveRequestAuthError("Signed request was replayed.", "replay", 409, "request_replayed");
  }
  if (error.code === "scope") {
    return new LiveRequestAuthError(
      "Paired device lacks the required live scope.",
      "forbidden",
      403,
      "permission_denied"
    );
  }
  if (error.code === "conflict") {
    return new LiveRequestAuthError(
      "Live session belongs to a different paired device.",
      "forbidden",
      403,
      "session_owner_mismatch"
    );
  }
  if (error.code === "corrupt") {
    return new LiveRequestAuthError(
      "Pairing authorization state is unavailable.",
      "forbidden",
      403,
      "invalid_request"
    );
  }
  if (error.code === "identity") {
    return new LiveRequestAuthError(
      "Pairing grant belongs to a different receiver identity.",
      "unauthorized",
      401,
      "identity_mismatch"
    );
  }
  const authCode: LiveAuthErrorCode = error.code === "expired"
    ? "grant_expired"
    : error.code === "revoked"
      ? "grant_revoked"
      : error.code === "not_found"
        ? "grant_unknown"
        : "invalid_request";
  return new LiveRequestAuthError(
    "Pairing credential is invalid, expired, or revoked.",
    "unauthorized",
    401,
    authCode
  );
}

function malformedCredential(label: string): LiveRequestAuthError {
  return new LiveRequestAuthError(`Pairing ${label} is malformed.`, "malformed");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
