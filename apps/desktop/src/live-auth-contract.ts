import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject
} from "node:crypto";

export const LIVE_PAIRING_INVITATION_SCHEMA = "capture_splat.live_pairing_invitation.v0.1" as const;
export const LIVE_PAIRING_REQUEST_PAYLOAD_SCHEMA = "capture_splat.live_pairing_request_payload.v0.1" as const;
export const LIVE_PAIRING_REQUEST_ENVELOPE_SCHEMA = "capture_splat.live_pairing_request_envelope.v0.1" as const;
export const LIVE_PAIRING_GRANT_PAYLOAD_SCHEMA = "capture_splat.live_pairing_grant_payload.v0.1" as const;
export const LIVE_PAIRING_GRANT_ENVELOPE_SCHEMA = "capture_splat.live_pairing_grant_envelope.v0.1" as const;
export const LIVE_AUTH_RECEIPT_SCHEMA = "capture_splat.live_auth_receipt.v0.1" as const;
export const LIVE_AUTH_ERROR_SCHEMA = "capture_splat.live_auth_error.v0.1" as const;
export const LIVE_AUTH_SCHEME = "p256-sha256-ieee-p1363-v0.1" as const;
export const LIVE_AUTH_AUDIENCE = "capture_splat.live.v0.1" as const;
export const LIVE_BONJOUR_SERVICE_TYPE = "_capturesplat._tcp" as const;
export const LIVE_BONJOUR_DOMAIN = "local." as const;
export const LIVE_PAIRING_QR_PREFIX = "capture-splat://pair/" as const;
export const LIVE_PAIRING_PERMISSIONS = [
  "receiver:status",
  "session:create",
  "session:resume",
  "frame:put",
  "asset:put",
  "session:finalize"
] as const;
export const LIVE_AUTH_ERROR_CODES = [
  "body_digest_mismatch",
  "desktop_signature_invalid",
  "device_signature_invalid",
  "grant_expired",
  "grant_revoked",
  "grant_unknown",
  "identity_mismatch",
  "invalid_request",
  "pairing_consumed",
  "pairing_expired",
  "pairing_proof_invalid",
  "permission_denied",
  "receiver_not_paired",
  "request_replayed",
  "request_signature_invalid",
  "request_stale",
  "session_owner_mismatch",
  "tls_required"
] as const;

const pairingRequestSignatureDomain = Buffer.from("CAPTURE-SPLAT-PAIRING-REQUEST-V1\0", "ascii");
const pairingProofDomain = Buffer.from("CAPTURE-SPLAT-PAIRING-PROOF-V1\0", "ascii");
const pairingGrantSignatureDomain = Buffer.from("CAPTURE-SPLAT-PAIRING-GRANT-V1\0", "ascii");
const identityPattern = /^(?:wsd|csd)_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const desktopIdPattern = /^wsd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const deviceIdPattern = /^csd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const pairingIdPattern = /^csp_[A-Za-z0-9_-]{21}[AQgw]$/;
const requestIdPattern = /^csr_[A-Za-z0-9_-]{21}[AQgw]$/;
const grantIdPattern = /^csg_[A-Za-z0-9_-]{21}[AQgw]$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const timestampPattern = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const appVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const maxCanonicalPayloadBytes = 8 * 1024;
const maxQrBytes = 4 * 1024;
const maxInvitationTtlMs = 5 * 60 * 1000;
const maxGrantTtlMs = 30 * 24 * 60 * 60 * 1000;

export type LivePairingPermission = typeof LIVE_PAIRING_PERMISSIONS[number];
export type LiveAuthErrorCode = typeof LIVE_AUTH_ERROR_CODES[number];

export interface LivePairingDiscovery {
  service_type: typeof LIVE_BONJOUR_SERVICE_TYPE;
  service_name: string;
  domain: typeof LIVE_BONJOUR_DOMAIN;
}

export interface LivePairingInvitation {
  schema: typeof LIVE_PAIRING_INVITATION_SCHEMA;
  pairing_id: string;
  mode: "qr";
  desktop_id: string;
  desktop_name: string;
  desktop_public_key_b64u: string;
  discovery: LivePairingDiscovery;
  tls_certificate_sha256: string;
  pairing_secret_b64u: string;
  issued_at: string;
  expires_at: string;
  permissions: LivePairingPermission[];
  authority: "proposal_only";
}

export interface LivePairingRequestPayload {
  schema: typeof LIVE_PAIRING_REQUEST_PAYLOAD_SCHEMA;
  pairing_id: string;
  request_id: string;
  desktop_id: string;
  device_id: string;
  device_name: string;
  device_public_key_b64u: string;
  device_platform: "ios";
  device_app_version: string;
  client_nonce_b64u: string;
  requested_permissions: LivePairingPermission[];
  created_at: string;
  authority: "proposal_only";
}

export interface LivePairingRequestEnvelope {
  schema: typeof LIVE_PAIRING_REQUEST_ENVELOPE_SCHEMA;
  payload_b64u: string;
  device_signature_b64u: string;
  invitation_proof_b64u: string;
}

export interface LivePairingGrantPayload {
  schema: typeof LIVE_PAIRING_GRANT_PAYLOAD_SCHEMA;
  pairing_id: string;
  request_id: string;
  grant_id: string;
  desktop_id: string;
  device_id: string;
  device_public_key_b64u: string;
  permissions: LivePairingPermission[];
  auth_scheme: typeof LIVE_AUTH_SCHEME;
  audience: typeof LIVE_AUTH_AUDIENCE;
  pairing_epoch: number;
  live_discovery: LivePairingDiscovery;
  tls_certificate_sha256: string;
  issued_at: string;
  not_before: string;
  expires_at: string;
  authority: "proposal_only";
}

export interface LivePairingGrantEnvelope {
  schema: typeof LIVE_PAIRING_GRANT_ENVELOPE_SCHEMA;
  payload_b64u: string;
  desktop_signature_b64u: string;
}

export interface LiveAuthReceipt {
  schema: typeof LIVE_AUTH_RECEIPT_SCHEMA;
  session_id: string;
  desktop_id: string;
  device_id: string;
  grant_id: string;
  pairing_epoch: number;
  permissions: LivePairingPermission[];
  auth_scheme: typeof LIVE_AUTH_SCHEME;
  tls_certificate_sha256: string;
  authenticated_at: string;
  grant_expires_at: string;
  authority: "proposal_only";
}

export interface LiveAuthErrorBody {
  schema: typeof LIVE_AUTH_ERROR_SCHEMA;
  code: LiveAuthErrorCode;
  retryable: boolean;
  message?: string;
}

export class LiveAuthContractError extends Error {
  constructor(
    message: string,
    readonly authCode: LiveAuthErrorCode = "invalid_request"
  ) {
    super(message);
    this.name = "LiveAuthContractError";
  }
}

export function identityIdFor(publicKeyX963B64u: string, kind: "desktop" | "device"): string {
  const raw = validateP256PublicKey(publicKeyX963B64u, "public key");
  const prefix = kind === "desktop" ? "wsd" : "csd";
  return `${prefix}_${createHash("sha256").update(raw).digest("base64url")}`;
}

export function canonicalLiveAuthJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalJsonValue(value)), "utf8");
}

export function encodeLiveAuthBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function decodeLiveAuthBase64Url(
  value: unknown,
  field: string,
  expectedBytes?: number
): Buffer {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new LiveAuthContractError(`${field} must be canonical unpadded Base64URL.`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)) {
    throw new LiveAuthContractError(`${field} has an invalid Base64URL length or encoding.`);
  }
  return bytes;
}

export function validatePairingInvitation(value: unknown): LivePairingInvitation {
  const invitation = record(value, "pairing invitation");
  exactKeys(invitation, [
    "schema", "pairing_id", "mode", "desktop_id", "desktop_name",
    "desktop_public_key_b64u", "discovery", "tls_certificate_sha256",
    "pairing_secret_b64u", "issued_at", "expires_at", "permissions", "authority"
  ], "pairing invitation");
  literal(invitation.schema, LIVE_PAIRING_INVITATION_SCHEMA, "pairing invitation schema");
  pattern(invitation.pairing_id, pairingIdPattern, "pairing_id");
  literal(invitation.mode, "qr", "pairing mode");
  const desktopId = pattern(invitation.desktop_id, desktopIdPattern, "desktop_id");
  stringBound(invitation.desktop_name, "desktop_name", 80);
  const publicKey = stringValue(invitation.desktop_public_key_b64u, "desktop_public_key_b64u");
  if (identityIdFor(publicKey, "desktop") !== desktopId) {
    throw new LiveAuthContractError("desktop_id does not match the desktop public key.");
  }
  const discovery = validateDiscovery(invitation.discovery, "discovery");
  pattern(invitation.tls_certificate_sha256, sha256Pattern, "tls_certificate_sha256");
  decodeLiveAuthBase64Url(invitation.pairing_secret_b64u, "pairing_secret_b64u", 32);
  const issuedAt = timestamp(invitation.issued_at, "issued_at");
  const expiresAt = timestamp(invitation.expires_at, "expires_at");
  validateInterval(issuedAt, expiresAt, maxInvitationTtlMs, "pairing invitation");
  const permissions = validatePermissions(invitation.permissions, "permissions");
  literal(invitation.authority, "proposal_only", "authority");
  return {
    schema: LIVE_PAIRING_INVITATION_SCHEMA,
    pairing_id: invitation.pairing_id as string,
    mode: "qr",
    desktop_id: desktopId,
    desktop_name: invitation.desktop_name as string,
    desktop_public_key_b64u: publicKey,
    discovery,
    tls_certificate_sha256: invitation.tls_certificate_sha256 as string,
    pairing_secret_b64u: invitation.pairing_secret_b64u as string,
    issued_at: invitation.issued_at as string,
    expires_at: invitation.expires_at as string,
    permissions,
    authority: "proposal_only"
  };
}

export function validatePairingRequestEnvelope(value: unknown): {
  envelope: LivePairingRequestEnvelope;
  payload: LivePairingRequestPayload;
  payloadBytes: Buffer;
} {
  const envelope = record(value, "pairing request envelope");
  exactKeys(envelope, [
    "schema", "payload_b64u", "device_signature_b64u", "invitation_proof_b64u"
  ], "pairing request envelope");
  literal(envelope.schema, LIVE_PAIRING_REQUEST_ENVELOPE_SCHEMA, "request envelope schema");
  const payloadBytes = canonicalPayload(envelope.payload_b64u, "payload_b64u");
  const payload = validatePairingRequestPayload(JSON.parse(payloadBytes.toString("utf8")) as unknown);
  const signature = decodeLiveAuthBase64Url(envelope.device_signature_b64u, "device_signature_b64u", 64);
  validateP1363(signature, "device_signature_b64u");
  decodeLiveAuthBase64Url(envelope.invitation_proof_b64u, "invitation_proof_b64u", 32);
  return {
    envelope: {
      schema: LIVE_PAIRING_REQUEST_ENVELOPE_SCHEMA,
      payload_b64u: envelope.payload_b64u as string,
      device_signature_b64u: envelope.device_signature_b64u as string,
      invitation_proof_b64u: envelope.invitation_proof_b64u as string
    },
    payload,
    payloadBytes
  };
}

export function verifyPairingRequest(
  value: unknown,
  invitation: LivePairingInvitation,
  now: Date
): { envelope: LivePairingRequestEnvelope; payload: LivePairingRequestPayload; payloadBytes: Buffer } {
  validatePairingInvitation(invitation);
  const parsed = validatePairingRequestEnvelope(value);
  if (
    parsed.payload.pairing_id !== invitation.pairing_id
    || parsed.payload.desktop_id !== invitation.desktop_id
    || parsed.payload.requested_permissions.join("\0") !== invitation.permissions.join("\0")
  ) {
    throw new LiveAuthContractError("Pairing request does not match the invitation.", "identity_mismatch");
  }
  const current = validDate(now, "pairing clock");
  const createdAt = Date.parse(parsed.payload.created_at);
  if (
    current.getTime() < Date.parse(invitation.issued_at)
    || current.getTime() >= Date.parse(invitation.expires_at)
    || createdAt < Date.parse(invitation.issued_at)
    || createdAt >= Date.parse(invitation.expires_at)
    || Math.abs(current.getTime() - createdAt) > maxInvitationTtlMs
  ) {
    throw new LiveAuthContractError("Pairing invitation or request has expired.", "pairing_expired");
  }
  const expectedProof = createHmac(
    "sha256",
    decodeLiveAuthBase64Url(invitation.pairing_secret_b64u, "pairing_secret_b64u", 32)
  ).update(pairingProofDomain).update(parsed.payloadBytes).digest();
  const actualProof = decodeLiveAuthBase64Url(
    parsed.envelope.invitation_proof_b64u,
    "invitation_proof_b64u",
    32
  );
  if (!timingSafeEqual(expectedProof, actualProof)) {
    throw new LiveAuthContractError("Pairing invitation proof is invalid.", "pairing_proof_invalid");
  }
  const publicKey = publicKeyObject(parsed.payload.device_public_key_b64u);
  const valid = verify(
    "sha256",
    Buffer.concat([pairingRequestSignatureDomain, parsed.payloadBytes]),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    decodeLiveAuthBase64Url(parsed.envelope.device_signature_b64u, "device_signature_b64u", 64)
  );
  if (!valid) {
    throw new LiveAuthContractError("Pairing device signature is invalid.", "device_signature_invalid");
  }
  return parsed;
}

export function createPairingRequestEnvelope(
  payloadValue: LivePairingRequestPayload,
  devicePrivateKey: string | KeyObject,
  pairingSecretB64u: string
): LivePairingRequestEnvelope {
  const payload = validatePairingRequestPayload(payloadValue);
  const payloadBytes = canonicalLiveAuthJson(payload);
  const privateKey = typeof devicePrivateKey === "string"
    ? createPrivateKey(devicePrivateKey)
    : devicePrivateKey;
  const signature = sign(
    "sha256",
    Buffer.concat([pairingRequestSignatureDomain, payloadBytes]),
    { key: privateKey, dsaEncoding: "ieee-p1363" }
  );
  const proof = createHmac(
    "sha256",
    decodeLiveAuthBase64Url(pairingSecretB64u, "pairing_secret_b64u", 32)
  ).update(pairingProofDomain).update(payloadBytes).digest();
  return {
    schema: LIVE_PAIRING_REQUEST_ENVELOPE_SCHEMA,
    payload_b64u: payloadBytes.toString("base64url"),
    device_signature_b64u: signature.toString("base64url"),
    invitation_proof_b64u: proof.toString("base64url")
  };
}

export function createPairingGrantEnvelope(
  payloadValue: LivePairingGrantPayload,
  desktopPrivateKey: string | KeyObject
): LivePairingGrantEnvelope {
  const payload = validatePairingGrantPayload(payloadValue);
  const payloadBytes = canonicalLiveAuthJson(payload);
  const privateKey = typeof desktopPrivateKey === "string"
    ? createPrivateKey(desktopPrivateKey)
    : desktopPrivateKey;
  const signature = sign(
    "sha256",
    Buffer.concat([pairingGrantSignatureDomain, payloadBytes]),
    { key: privateKey, dsaEncoding: "ieee-p1363" }
  );
  return {
    schema: LIVE_PAIRING_GRANT_ENVELOPE_SCHEMA,
    payload_b64u: payloadBytes.toString("base64url"),
    desktop_signature_b64u: signature.toString("base64url")
  };
}

export function validatePairingGrantEnvelope(
  value: unknown,
  desktopPublicKeyX963B64u?: string
): { envelope: LivePairingGrantEnvelope; payload: LivePairingGrantPayload; payloadBytes: Buffer } {
  const envelope = record(value, "pairing grant envelope");
  exactKeys(envelope, ["schema", "payload_b64u", "desktop_signature_b64u"], "pairing grant envelope");
  literal(envelope.schema, LIVE_PAIRING_GRANT_ENVELOPE_SCHEMA, "grant envelope schema");
  const payloadBytes = canonicalPayload(envelope.payload_b64u, "payload_b64u");
  const payload = validatePairingGrantPayload(JSON.parse(payloadBytes.toString("utf8")) as unknown);
  const signature = decodeLiveAuthBase64Url(envelope.desktop_signature_b64u, "desktop_signature_b64u", 64);
  validateP1363(signature, "desktop_signature_b64u");
  if (desktopPublicKeyX963B64u) {
    if (
      identityIdFor(desktopPublicKeyX963B64u, "desktop") !== payload.desktop_id
      || !verify(
        "sha256",
        Buffer.concat([pairingGrantSignatureDomain, payloadBytes]),
        { key: publicKeyObject(desktopPublicKeyX963B64u), dsaEncoding: "ieee-p1363" },
        signature
      )
    ) {
      throw new LiveAuthContractError(
        "Pairing grant desktop signature is invalid.",
        "desktop_signature_invalid"
      );
    }
  }
  return {
    envelope: {
      schema: LIVE_PAIRING_GRANT_ENVELOPE_SCHEMA,
      payload_b64u: envelope.payload_b64u as string,
      desktop_signature_b64u: envelope.desktop_signature_b64u as string
    },
    payload,
    payloadBytes
  };
}

export function encodePairingInvitationUri(invitationValue: LivePairingInvitation): string {
  const invitation = validatePairingInvitation(invitationValue);
  const uri = `${LIVE_PAIRING_QR_PREFIX}${canonicalLiveAuthJson(invitation).toString("base64url")}`;
  if (Buffer.byteLength(uri, "ascii") > maxQrBytes) {
    throw new LiveAuthContractError("Pairing invitation exceeds the QR byte limit.");
  }
  return uri;
}

export function decodePairingInvitationUri(uri: unknown): LivePairingInvitation {
  if (
    typeof uri !== "string"
    || !uri.startsWith(LIVE_PAIRING_QR_PREFIX)
    || uri.includes("?")
    || uri.includes("#")
    || uri.includes("%")
    || Buffer.byteLength(uri, "utf8") > maxQrBytes
  ) {
    throw new LiveAuthContractError("Pairing invitation URI is not canonical.");
  }
  const payload = canonicalPayload(uri.slice(LIVE_PAIRING_QR_PREFIX.length), "pairing QR payload");
  return validatePairingInvitation(JSON.parse(payload.toString("utf8")) as unknown);
}

export function pairingVerificationCode(tlsCertificateSha256: string): string {
  const fingerprint = pattern(tlsCertificateSha256, sha256Pattern, "tls_certificate_sha256");
  const numeric = BigInt(`0x${fingerprint.slice(7, 23)}`) % 100_000_000n;
  const value = numeric.toString().padStart(8, "0");
  return `${value.slice(0, 4)} ${value.slice(4)}`;
}

export function validateLiveAuthReceipt(value: unknown): LiveAuthReceipt {
  const receipt = record(value, "live authentication receipt");
  exactKeys(receipt, [
    "schema", "session_id", "desktop_id", "device_id", "grant_id", "pairing_epoch",
    "permissions", "auth_scheme", "tls_certificate_sha256", "authenticated_at",
    "grant_expires_at", "authority"
  ], "live authentication receipt");
  literal(receipt.schema, LIVE_AUTH_RECEIPT_SCHEMA, "receipt schema");
  const sessionId = pattern(
    receipt.session_id,
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
    "session_id"
  );
  const desktopId = pattern(receipt.desktop_id, desktopIdPattern, "desktop_id");
  const deviceId = pattern(receipt.device_id, deviceIdPattern, "device_id");
  const grantId = pattern(receipt.grant_id, grantIdPattern, "grant_id");
  const pairingEpoch = positiveSafeInteger(receipt.pairing_epoch, "pairing_epoch");
  const permissions = validatePermissions(receipt.permissions, "permissions");
  literal(receipt.auth_scheme, LIVE_AUTH_SCHEME, "auth_scheme");
  const certificateSha256 = pattern(
    receipt.tls_certificate_sha256,
    sha256Pattern,
    "tls_certificate_sha256"
  );
  const authenticatedAt = timestamp(receipt.authenticated_at, "authenticated_at");
  const grantExpiresAt = timestamp(receipt.grant_expires_at, "grant_expires_at");
  if (authenticatedAt.getTime() >= grantExpiresAt.getTime()) {
    throw new LiveAuthContractError("Authentication receipt must precede grant expiry.");
  }
  literal(receipt.authority, "proposal_only", "authority");
  return {
    schema: LIVE_AUTH_RECEIPT_SCHEMA,
    session_id: sessionId,
    desktop_id: desktopId,
    device_id: deviceId,
    grant_id: grantId,
    pairing_epoch: pairingEpoch,
    permissions,
    auth_scheme: LIVE_AUTH_SCHEME,
    tls_certificate_sha256: certificateSha256,
    authenticated_at: receipt.authenticated_at as string,
    grant_expires_at: receipt.grant_expires_at as string,
    authority: "proposal_only"
  };
}

export function validateLiveAuthError(value: unknown): LiveAuthErrorBody {
  const error = record(value, "live authentication error");
  const keys = Object.keys(error);
  if (
    !keys.includes("schema")
    || !keys.includes("code")
    || !keys.includes("retryable")
    || keys.some((key) => !["schema", "code", "retryable", "message"].includes(key))
  ) {
    throw new LiveAuthContractError("Live authentication error has missing or additional fields.");
  }
  literal(error.schema, LIVE_AUTH_ERROR_SCHEMA, "authentication error schema");
  if (
    typeof error.code !== "string"
    || !(LIVE_AUTH_ERROR_CODES as readonly string[]).includes(error.code)
  ) {
    throw new LiveAuthContractError("Authentication error code is invalid.");
  }
  if (typeof error.retryable !== "boolean") {
    throw new LiveAuthContractError("Authentication error retryable must be boolean.");
  }
  if (error.message !== undefined) stringBound(error.message, "message", 256);
  return {
    schema: LIVE_AUTH_ERROR_SCHEMA,
    code: error.code as LiveAuthErrorCode,
    retryable: error.retryable,
    ...(error.message === undefined ? {} : { message: error.message as string })
  };
}

function validatePairingRequestPayload(value: unknown): LivePairingRequestPayload {
  const payload = record(value, "pairing request payload");
  exactKeys(payload, [
    "schema", "pairing_id", "request_id", "desktop_id", "device_id", "device_name",
    "device_public_key_b64u", "device_platform", "device_app_version", "client_nonce_b64u",
    "requested_permissions", "created_at", "authority"
  ], "pairing request payload");
  literal(payload.schema, LIVE_PAIRING_REQUEST_PAYLOAD_SCHEMA, "request payload schema");
  const pairingId = pattern(payload.pairing_id, pairingIdPattern, "pairing_id");
  const requestId = pattern(payload.request_id, requestIdPattern, "request_id");
  const desktopId = pattern(payload.desktop_id, desktopIdPattern, "desktop_id");
  const deviceId = pattern(payload.device_id, deviceIdPattern, "device_id");
  const publicKey = stringValue(payload.device_public_key_b64u, "device_public_key_b64u");
  if (identityIdFor(publicKey, "device") !== deviceId) {
    throw new LiveAuthContractError("device_id does not match the device public key.");
  }
  stringBound(payload.device_name, "device_name", 80);
  literal(payload.device_platform, "ios", "device_platform");
  pattern(payload.device_app_version, appVersionPattern, "device_app_version");
  decodeLiveAuthBase64Url(payload.client_nonce_b64u, "client_nonce_b64u", 16);
  const permissions = validatePermissions(payload.requested_permissions, "requested_permissions");
  timestamp(payload.created_at, "created_at");
  literal(payload.authority, "proposal_only", "authority");
  return {
    schema: LIVE_PAIRING_REQUEST_PAYLOAD_SCHEMA,
    pairing_id: pairingId,
    request_id: requestId,
    desktop_id: desktopId,
    device_id: deviceId,
    device_name: payload.device_name as string,
    device_public_key_b64u: publicKey,
    device_platform: "ios",
    device_app_version: payload.device_app_version as string,
    client_nonce_b64u: payload.client_nonce_b64u as string,
    requested_permissions: permissions,
    created_at: payload.created_at as string,
    authority: "proposal_only"
  };
}

export function validatePairingGrantPayload(value: unknown): LivePairingGrantPayload {
  const payload = record(value, "pairing grant payload");
  exactKeys(payload, [
    "schema", "pairing_id", "request_id", "grant_id", "desktop_id", "device_id",
    "device_public_key_b64u", "permissions", "auth_scheme", "audience", "pairing_epoch",
    "live_discovery", "tls_certificate_sha256", "issued_at", "not_before", "expires_at",
    "authority"
  ], "pairing grant payload");
  literal(payload.schema, LIVE_PAIRING_GRANT_PAYLOAD_SCHEMA, "grant payload schema");
  const pairingId = pattern(payload.pairing_id, pairingIdPattern, "pairing_id");
  const requestId = pattern(payload.request_id, requestIdPattern, "request_id");
  const grantId = pattern(payload.grant_id, grantIdPattern, "grant_id");
  const desktopId = pattern(payload.desktop_id, desktopIdPattern, "desktop_id");
  const deviceId = pattern(payload.device_id, deviceIdPattern, "device_id");
  const devicePublicKey = stringValue(payload.device_public_key_b64u, "device_public_key_b64u");
  if (identityIdFor(devicePublicKey, "device") !== deviceId) {
    throw new LiveAuthContractError("Grant device identity does not match its public key.");
  }
  const permissions = validatePermissions(payload.permissions, "permissions");
  literal(payload.auth_scheme, LIVE_AUTH_SCHEME, "auth_scheme");
  literal(payload.audience, LIVE_AUTH_AUDIENCE, "audience");
  const pairingEpoch = positiveSafeInteger(payload.pairing_epoch, "pairing_epoch");
  const discovery = validateDiscovery(payload.live_discovery, "live_discovery");
  pattern(payload.tls_certificate_sha256, sha256Pattern, "tls_certificate_sha256");
  const issuedAt = timestamp(payload.issued_at, "issued_at");
  const notBefore = timestamp(payload.not_before, "not_before");
  const expiresAt = timestamp(payload.expires_at, "expires_at");
  if (notBefore.getTime() < issuedAt.getTime()) {
    throw new LiveAuthContractError("Grant not_before precedes issued_at.");
  }
  validateInterval(notBefore, expiresAt, maxGrantTtlMs, "pairing grant");
  literal(payload.authority, "proposal_only", "authority");
  return {
    schema: LIVE_PAIRING_GRANT_PAYLOAD_SCHEMA,
    pairing_id: pairingId,
    request_id: requestId,
    grant_id: grantId,
    desktop_id: desktopId,
    device_id: deviceId,
    device_public_key_b64u: devicePublicKey,
    permissions,
    auth_scheme: LIVE_AUTH_SCHEME,
    audience: LIVE_AUTH_AUDIENCE,
    pairing_epoch: pairingEpoch,
    live_discovery: discovery,
    tls_certificate_sha256: payload.tls_certificate_sha256 as string,
    issued_at: payload.issued_at as string,
    not_before: payload.not_before as string,
    expires_at: payload.expires_at as string,
    authority: "proposal_only"
  };
}

function validatePermissions(value: unknown, field: string): LivePairingPermission[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIVE_PAIRING_PERMISSIONS.length) {
    throw new LiveAuthContractError(`${field} must contain one through six live permissions.`);
  }
  const indices = value.map((entry) => LIVE_PAIRING_PERMISSIONS.indexOf(entry as LivePairingPermission));
  if (
    indices.some((index) => index < 0)
    || new Set(indices).size !== indices.length
    || indices.some((index, position) => position > 0 && index <= indices[position - 1]!)
  ) {
    throw new LiveAuthContractError(`${field} must contain unique permissions in canonical order.`);
  }
  return value as LivePairingPermission[];
}

function validateDiscovery(value: unknown, field: string): LivePairingDiscovery {
  const discovery = record(value, field);
  exactKeys(discovery, ["service_type", "service_name", "domain"], field);
  literal(discovery.service_type, LIVE_BONJOUR_SERVICE_TYPE, `${field}.service_type`);
  stringBound(discovery.service_name, `${field}.service_name`, 63);
  literal(discovery.domain, LIVE_BONJOUR_DOMAIN, `${field}.domain`);
  return {
    service_type: LIVE_BONJOUR_SERVICE_TYPE,
    service_name: discovery.service_name as string,
    domain: LIVE_BONJOUR_DOMAIN
  };
}

function canonicalPayload(value: unknown, field: string): Buffer {
  const bytes = decodeLiveAuthBase64Url(value, field);
  if (bytes.byteLength > maxCanonicalPayloadBytes) {
    throw new LiveAuthContractError(`${field} exceeds its byte limit.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new LiveAuthContractError(`${field} must contain strict JSON.`);
  }
  if (!canonicalLiveAuthJson(parsed).equals(bytes)) {
    throw new LiveAuthContractError(`${field} must contain exact canonical JSON bytes.`);
  }
  return bytes;
}

function publicKeyObject(value: string): KeyObject {
  const raw = validateP256PublicKey(value, "P-256 public key");
  try {
    return createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33, 65).toString("base64url")
      }
    });
  } catch {
    throw new LiveAuthContractError("P-256 public key is not on the curve.");
  }
}

function validateP256PublicKey(value: unknown, field: string): Buffer {
  const raw = decodeLiveAuthBase64Url(value, field, 65);
  if (raw[0] !== 4) throw new LiveAuthContractError(`${field} must be uncompressed X9.63 P-256.`);
  publicKeyObjectUnchecked(raw);
  return raw;
}

function publicKeyObjectUnchecked(raw: Buffer): KeyObject {
  try {
    return createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33, 65).toString("base64url")
      }
    });
  } catch {
    throw new LiveAuthContractError("P-256 public key is not on the curve.");
  }
}

function validateP1363(value: Buffer, field: string): void {
  const r = BigInt(`0x${value.subarray(0, 32).toString("hex")}`);
  const s = BigInt(`0x${value.subarray(32).toString("hex")}`);
  const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  if (r < 1n || r >= order || s < 1n || s >= order) {
    throw new LiveAuthContractError(`${field} contains invalid P-256 signature scalars.`);
  }
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return validUnicodeString(value, "Canonical JSON string");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LiveAuthContractError("Canonical JSON rejects non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      validUnicodeString(key, "Canonical JSON object key");
      if (source[key] === undefined) throw new LiveAuthContractError("Canonical JSON rejects undefined values.");
      result[key] = canonicalJsonValue(source[key]);
    }
    return result;
  }
  throw new LiveAuthContractError("Value is not canonical JSON data.");
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LiveAuthContractError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], field: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).length !== expected.size || Object.keys(value).some((key) => !expected.has(key))) {
    throw new LiveAuthContractError(`${field} has missing or additional fields.`);
  }
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new LiveAuthContractError(`${field} must be a non-empty string.`);
  return validUnicodeString(value, field);
}

function validUnicodeString(value: string, field: string): string {
  if (Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new LiveAuthContractError(`${field} must contain valid Unicode scalar values.`);
  }
  return value;
}

function stringBound(value: unknown, field: string, maxBytes: number): string {
  const text = stringValue(value, field);
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new LiveAuthContractError(`${field} exceeds its UTF-8 byte limit.`);
  return text;
}

function pattern(value: unknown, expected: RegExp, field: string): string {
  const text = stringValue(value, field);
  if (!expected.test(text)) throw new LiveAuthContractError(`${field} has an invalid format.`);
  return text;
}

function literal<T extends string>(value: unknown, expected: T, field: string): asserts value is T {
  if (value !== expected) throw new LiveAuthContractError(`${field} must be ${expected}.`);
}

function timestamp(value: unknown, field: string): Date {
  const text = pattern(value, timestampPattern, field);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new LiveAuthContractError(`${field} must be a real RFC 3339 millisecond timestamp.`);
  }
  return parsed;
}

function validateInterval(start: Date, end: Date, maximumMs: number, field: string): void {
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > maximumMs) {
    throw new LiveAuthContractError(`${field} validity interval is invalid.`);
  }
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new LiveAuthContractError(`${field} must be a positive safe integer.`);
  }
  return Number(value);
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new LiveAuthContractError(`${field} is invalid.`);
  }
  return value;
}
