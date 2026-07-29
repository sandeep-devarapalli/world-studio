import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";
import {
  validatePairingGrantEnvelope,
  type LivePairingGrantEnvelope,
  type LivePairingGrantPayload
} from "./live-auth-contract.js";

const registrySchema = "capture_splat.pairing_registry.v0.1";
const deviceIdPattern = /^csd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const desktopIdPattern = /^wsd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const grantIdPattern = /^csg_[A-Za-z0-9_-]{21}[AQgw]$/;
const requestIdPattern = /^csr_[A-Za-z0-9_-]{21}[AQgw]$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const counterPattern = /^(?:0|[1-9][0-9]{0,19})$/;
const replayWindowBits = 256n;
const replayWindowMask = (1n << replayWindowBits) - 1n;
const maxUInt64 = (1n << 64n) - 1n;
const emptyReplayBitmap = "0".repeat(64);
const maxRegistryBytes = 16 * 1024 * 1024;

export type LiveGrantScope =
  | "receiver:status"
  | "session:create"
  | "session:resume"
  | "frame:put"
  | "asset:put"
  | "session:finalize";

const liveGrantScopeOrder: readonly LiveGrantScope[] = [
  "receiver:status",
  "session:create",
  "session:resume",
  "frame:put",
  "asset:put",
  "session:finalize"
] as const;
const liveGrantScopes = new Set<LiveGrantScope>(liveGrantScopeOrder);

export interface RegisterPairedDeviceInput {
  deviceId: string;
  displayName: string;
  publicKeyX963B64u: string;
  pairedAt: string;
  grant: {
    grantId: string;
    desktopId: string;
    tlsCertificateSha256: string;
    scopes: LiveGrantScope[];
    issuedAt: string;
    notBefore: string;
    expiresAt: string;
    completion?: {
      requestId: string;
      requestBodySha256: string;
      envelope: LivePairingGrantEnvelope;
    };
  };
}

export interface PairedGrant {
  grantId: string;
  deviceId: string;
  desktopId: string;
  tlsCertificateSha256: string;
  publicKeyX963B64u: string;
  pairingEpoch: number;
  scopes: LiveGrantScope[];
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  replayHighestCounter: string;
}

export interface PairedDeviceSummary {
  deviceId: string;
  displayName: string;
  pairingEpoch: number;
  pairedAt: string;
  revokedAt: string | null;
  grants: Array<{
    grantId: string;
    desktopId: string;
    tlsCertificateSha256: string;
    scopes: LiveGrantScope[];
    issuedAt: string;
    notBefore: string;
    expiresAt: string;
  }>;
}

export interface PairingStoreOptions {
  maxDevices?: number;
  maxSessionOwners?: number;
  randomId?: () => string;
}

export interface GrantAccessOptions {
  now?: Date;
  requiredScope?: LiveGrantScope;
  desktopId?: string;
  tlsCertificateSha256?: string;
}

interface StoredGrant {
  grant_id: string;
  desktop_id: string;
  tls_certificate_sha256: string;
  pairing_epoch: number;
  scopes: LiveGrantScope[];
  issued_at: string;
  not_before: string;
  expires_at: string;
  replay_highest_counter: string;
  replay_bitmap_hex: string;
  pairing_completion: StoredPairingCompletion | null;
}

interface StoredPairingCompletion {
  request_id: string;
  request_body_sha256: string;
  envelope: LivePairingGrantEnvelope;
}

interface StoredDevice {
  device_id: string;
  display_name: string;
  public_key_x963_b64u: string;
  pairing_epoch: number;
  paired_at: string;
  revoked_at: string | null;
  grants: StoredGrant[];
}

interface StoredSessionOwner {
  session_id: string;
  device_id: string;
  bound_at: string;
}

interface StoredRegistry {
  schema: typeof registrySchema;
  devices: StoredDevice[];
  session_owners: StoredSessionOwner[];
}

export class PairingStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid"
      | "corrupt"
      | "not_found"
      | "conflict"
      | "expired"
      | "revoked"
      | "identity"
      | "scope"
      | "replay" = "invalid"
  ) {
    super(message);
    this.name = "PairingStoreError";
  }
}

export class PairingStore {
  readonly root: string;
  private readonly statePath: string;
  private readonly maxDevices: number;
  private readonly maxSessionOwners: number;
  private readonly randomId: () => string;
  private state: StoredRegistry | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(root: string, options: PairingStoreOptions = {}) {
    if (!path.isAbsolute(root)) throw new PairingStoreError("Pairing store root must be absolute.");
    this.root = path.resolve(root);
    this.statePath = path.join(this.root, "pairing-registry.json");
    this.maxDevices = positiveBound(options.maxDevices ?? 64, "maxDevices");
    this.maxSessionOwners = positiveBound(options.maxSessionOwners ?? 100_000, "maxSessionOwners");
    this.randomId = options.randomId ?? randomUUID;
  }

  initialize(): Promise<void> {
    return this.withLock(async () => {
      if (this.state) return;
      await ensurePrivateDirectory(this.root);
      const bytes = await readOptionalRegularFile(this.statePath);
      if (bytes === null) {
        const initial: StoredRegistry = {
          schema: registrySchema,
          devices: [],
          session_owners: []
        };
        await atomicWriteRegistry(this.statePath, initial, this.randomId);
        this.state = initial;
        return;
      }
      if (bytes.byteLength > maxRegistryBytes) {
        throw new PairingStoreError("Pairing registry exceeds its byte limit.", "corrupt");
      }
      const recovered = parseRegistry(bytes);
      validateRegistry(recovered, this.maxDevices, this.maxSessionOwners);
      this.state = recovered;
    });
  }

  registerDevice(input: RegisterPairedDeviceInput): Promise<PairedDeviceSummary> {
    const normalized = validateRegistration(input);
    return this.withStateMutation(async (next) => {
      const existingIndex = next.devices.findIndex((device) => device.device_id === normalized.deviceId);
      if (existingIndex < 0 && next.devices.length >= this.maxDevices) {
        throw new PairingStoreError("Paired-device limit has been reached.", "conflict");
      }
      const existing = existingIndex < 0 ? undefined : next.devices[existingIndex];
      if (existing && existing.public_key_x963_b64u !== normalized.publicKeyX963B64u) {
        throw new PairingStoreError("Device ID is already paired to a different public key.", "conflict");
      }
      if (existing?.grants.some((grant) => grant.grant_id === normalized.grant.grantId)) {
        throw new PairingStoreError("Pairing grant ID cannot be reused across pairing epochs.", "conflict");
      }
      const pairingEpoch = (existing?.pairing_epoch ?? 0) + 1;
      if (!Number.isSafeInteger(pairingEpoch)) {
        throw new PairingStoreError("Device pairing epoch is exhausted.", "conflict");
      }
      const stored: StoredDevice = {
        device_id: normalized.deviceId,
        display_name: normalized.displayName,
        public_key_x963_b64u: normalized.publicKeyX963B64u,
        pairing_epoch: pairingEpoch,
        paired_at: normalized.pairedAt,
        revoked_at: null,
        grants: [{
          grant_id: normalized.grant.grantId,
          desktop_id: normalized.grant.desktopId,
          tls_certificate_sha256: normalized.grant.tlsCertificateSha256,
          pairing_epoch: pairingEpoch,
          scopes: normalized.grant.scopes,
          issued_at: normalized.grant.issuedAt,
          not_before: normalized.grant.notBefore,
          expires_at: normalized.grant.expiresAt,
          replay_highest_counter: "0",
          replay_bitmap_hex: emptyReplayBitmap,
          pairing_completion: normalized.grant.completion ? {
            request_id: normalized.grant.completion.requestId,
            request_body_sha256: normalized.grant.completion.requestBodySha256,
            envelope: normalized.grant.completion.envelope
          } : null
        }]
      };
      const completion = stored.grants[0]?.pairing_completion;
      if (completion) {
        const payload = validateStoredCompletion(completion, stored, stored.grants[0]!);
        if (payload.pairing_epoch !== pairingEpoch) {
          throw new PairingStoreError("Pairing completion epoch differs from the new pairing epoch.");
        }
      }
      if (existingIndex < 0) next.devices.push(stored);
      else next.devices[existingIndex] = stored;
      next.devices.sort((left, right) => left.device_id.localeCompare(right.device_id));
      return summarizeDevice(stored);
    });
  }

  revoke(deviceId: string, revokedAt = new Date().toISOString()): Promise<PairedDeviceSummary> {
    validDeviceId(deviceId);
    const timestamp = validTimestamp(revokedAt, "revokedAt");
    return this.withStateMutation(async (next) => {
      const device = requireDevice(next, deviceId);
      if (device.revoked_at === null) {
        device.pairing_epoch += 1;
        if (!Number.isSafeInteger(device.pairing_epoch)) {
          throw new PairingStoreError("Device pairing epoch is exhausted.", "conflict");
        }
        device.revoked_at = timestamp;
      }
      return summarizeDevice(device);
    });
  }

  async list(): Promise<PairedDeviceSummary[]> {
    await this.initialize();
    return this.withLock(async () => this.requireState().devices.map(summarizeDevice));
  }

  async getGrant(
    deviceId: string,
    grantId: string,
    options: GrantAccessOptions = {}
  ): Promise<PairedGrant> {
    validDeviceId(deviceId);
    validGrantId(grantId);
    if (options.requiredScope) validScope(options.requiredScope);
    await this.initialize();
    return this.withLock(async () => {
      const { device, grant } = requireActiveGrant(
        this.requireState(),
        deviceId,
        grantId,
        options.now ?? new Date(),
        options
      );
      return grantResult(device, grant);
    });
  }

  async reserveCounter(
    deviceId: string,
    grantId: string,
    counterValue: string,
    options: GrantAccessOptions = {}
  ): Promise<PairedGrant> {
    const counter = validCounter(counterValue);
    if (options.requiredScope) validScope(options.requiredScope);
    return this.withStateMutation(async (next) => {
      const { device, grant } = requireActiveGrant(
        next,
        validDeviceId(deviceId),
        validGrantId(grantId),
        options.now ?? new Date(),
        options
      );
      const highest = BigInt(grant.replay_highest_counter);
      let bitmap = BigInt(`0x${grant.replay_bitmap_hex}`);
      if (counter > highest) {
        const shift = counter - highest;
        bitmap = shift >= replayWindowBits
          ? 1n
          : ((bitmap << shift) & replayWindowMask) | 1n;
        grant.replay_highest_counter = counter.toString();
      } else {
        const distance = highest - counter;
        if (distance >= replayWindowBits) {
          throw new PairingStoreError("Request counter is outside the replay window.", "replay");
        }
        const bit = 1n << distance;
        if ((bitmap & bit) !== 0n) {
          throw new PairingStoreError("Request counter was already used.", "replay");
        }
        bitmap |= bit;
      }
      grant.replay_bitmap_hex = bitmap.toString(16).padStart(64, "0");
      return grantResult(device, grant);
    });
  }

  async getCompletedPairing(
    requestId: string
  ): Promise<{ requestId: string; requestBodySha256: string; envelope: LivePairingGrantEnvelope } | null> {
    const validRequest = validRequestId(requestId);
    await this.initialize();
    return this.withLock(async () => {
      for (const device of this.requireState().devices) {
        for (const grant of device.grants) {
          const completion = grant.pairing_completion;
          if (completion?.request_id !== validRequest) continue;
          validateStoredCompletion(completion, device, grant);
          return {
            requestId: completion.request_id,
            requestBodySha256: completion.request_body_sha256,
            envelope: structuredClone(completion.envelope)
          };
        }
      }
      return null;
    });
  }

  bindSessionOwner(
    sessionId: string,
    deviceId: string,
    boundAt = new Date().toISOString()
  ): Promise<{ sessionId: string; deviceId: string; boundAt: string }> {
    const validSession = validSessionId(sessionId);
    const validDevice = validDeviceId(deviceId);
    const timestamp = validTimestamp(boundAt, "boundAt");
    return this.withStateMutation(async (next) => {
      const device = requireDevice(next, validDevice);
      if (device.revoked_at !== null) {
        throw new PairingStoreError("Revoked device cannot bind a live session.", "revoked");
      }
      const existing = next.session_owners.find((owner) => owner.session_id === validSession);
      if (existing) {
        if (existing.device_id !== validDevice) {
          throw new PairingStoreError("Live session belongs to a different paired device.", "conflict");
        }
        return ownerResult(existing);
      }
      if (next.session_owners.length >= this.maxSessionOwners) {
        throw new PairingStoreError("Session-owner limit has been reached.", "conflict");
      }
      const owner: StoredSessionOwner = {
        session_id: validSession,
        device_id: validDevice,
        bound_at: timestamp
      };
      next.session_owners.push(owner);
      next.session_owners.sort((left, right) => left.session_id.localeCompare(right.session_id));
      return ownerResult(owner);
    });
  }

  async assertSessionOwner(sessionId: string, deviceId: string): Promise<void> {
    const validSession = validSessionId(sessionId);
    const validDevice = validDeviceId(deviceId);
    await this.initialize();
    await this.withLock(async () => {
      const owner = this.requireState().session_owners.find((candidate) => candidate.session_id === validSession);
      if (!owner) throw new PairingStoreError("Live session has no paired-device owner.", "not_found");
      if (owner.device_id !== validDevice) {
        throw new PairingStoreError("Live session belongs to a different paired device.", "conflict");
      }
    });
  }

  private requireState(): StoredRegistry {
    if (!this.state) throw new PairingStoreError("Pairing store is not initialized.", "corrupt");
    return this.state;
  }

  private async withStateMutation<T>(operation: (next: StoredRegistry) => Promise<T>): Promise<T> {
    await this.initialize();
    return this.withLock(async () => {
      const next = structuredClone(this.requireState());
      const result = await operation(next);
      validateRegistry(next, this.maxDevices, this.maxSessionOwners);
      await assertPrivateStore(this.root, this.statePath);
      await atomicWriteRegistry(this.statePath, next, this.randomId);
      this.state = next;
      return result;
    });
  }

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.queue;
    let release = (): void => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    return prior.then(operation).finally(release);
  }
}

export function deviceIdFor(publicKeyX963: Uint8Array): string {
  return `csd_${createHash("sha256").update(publicKeyX963).digest("base64url")}`;
}

function requireActiveGrant(
  state: StoredRegistry,
  deviceId: string,
  grantId: string,
  now: Date,
  options: GrantAccessOptions
): { device: StoredDevice; grant: StoredGrant } {
  if (!Number.isFinite(now.getTime())) throw new PairingStoreError("Authorization time is invalid.");
  const device = requireDevice(state, deviceId);
  if (device.revoked_at !== null) throw new PairingStoreError("Paired device is revoked.", "revoked");
  const grant = device.grants.find((candidate) => candidate.grant_id === grantId);
  if (!grant) throw new PairingStoreError("Pairing grant was not found.", "not_found");
  if (grant.pairing_epoch !== device.pairing_epoch) {
    throw new PairingStoreError("Pairing grant belongs to an earlier pairing epoch.", "revoked");
  }
  if (options.desktopId !== undefined && grant.desktop_id !== validDesktopId(options.desktopId)) {
    throw new PairingStoreError("Pairing grant belongs to a different desktop identity.", "identity");
  }
  if (
    options.tlsCertificateSha256 !== undefined
    && grant.tls_certificate_sha256 !== validSha256(options.tlsCertificateSha256, "tlsCertificateSha256")
  ) {
    throw new PairingStoreError("Pairing grant belongs to a different TLS certificate.", "identity");
  }
  if (now.getTime() < Date.parse(grant.not_before) || now.getTime() >= Date.parse(grant.expires_at)) {
    throw new PairingStoreError("Pairing grant is outside its validity period.", "expired");
  }
  if (options.requiredScope && !grant.scopes.includes(options.requiredScope)) {
    throw new PairingStoreError(`Pairing grant lacks ${options.requiredScope}.`, "scope");
  }
  return { device, grant };
}

function requireDevice(state: StoredRegistry, deviceId: string): StoredDevice {
  const device = state.devices.find((candidate) => candidate.device_id === deviceId);
  if (!device) throw new PairingStoreError("Paired device was not found.", "not_found");
  return device;
}

function grantResult(device: StoredDevice, grant: StoredGrant): PairedGrant {
  return {
    grantId: grant.grant_id,
    deviceId: device.device_id,
    desktopId: grant.desktop_id,
    tlsCertificateSha256: grant.tls_certificate_sha256,
    publicKeyX963B64u: device.public_key_x963_b64u,
    pairingEpoch: grant.pairing_epoch,
    scopes: [...grant.scopes],
    issuedAt: grant.issued_at,
    notBefore: grant.not_before,
    expiresAt: grant.expires_at,
    replayHighestCounter: grant.replay_highest_counter
  };
}

function summarizeDevice(device: StoredDevice): PairedDeviceSummary {
  return {
    deviceId: device.device_id,
    displayName: device.display_name,
    pairingEpoch: device.pairing_epoch,
    pairedAt: device.paired_at,
    revokedAt: device.revoked_at,
    grants: device.grants.map((grant) => ({
      grantId: grant.grant_id,
      desktopId: grant.desktop_id,
      tlsCertificateSha256: grant.tls_certificate_sha256,
      scopes: [...grant.scopes],
      issuedAt: grant.issued_at,
      notBefore: grant.not_before,
      expiresAt: grant.expires_at
    }))
  };
}

function ownerResult(owner: StoredSessionOwner): { sessionId: string; deviceId: string; boundAt: string } {
  return {
    sessionId: owner.session_id,
    deviceId: owner.device_id,
    boundAt: owner.bound_at
  };
}

function validateRegistration(input: RegisterPairedDeviceInput): RegisterPairedDeviceInput {
  if (!isRecord(input) || !isRecord(input.grant)) throw new PairingStoreError("Device registration is invalid.");
  exactInputKeys(input, ["deviceId", "displayName", "publicKeyX963B64u", "pairedAt", "grant"], "Device registration");
  exactInputKeys(
    input.grant,
    [
      "grantId",
      "desktopId",
      "tlsCertificateSha256",
      "scopes",
      "issuedAt",
      "notBefore",
      "expiresAt",
      ...(input.grant.completion === undefined ? [] : ["completion"])
    ],
    "Pairing grant"
  );
  const deviceId = validDeviceId(input.deviceId);
  const publicKey = decodePublicKey(input.publicKeyX963B64u);
  if (deviceIdFor(publicKey) !== deviceId) {
    throw new PairingStoreError("Device ID does not match its P-256 public key.");
  }
  const displayName = validDisplayName(input.displayName);
  const pairedAt = validTimestamp(input.pairedAt, "pairedAt");
  const desktopId = validDesktopId(input.grant.desktopId);
  const tlsCertificateSha256 = validSha256(
    input.grant.tlsCertificateSha256,
    "grant.tlsCertificateSha256"
  );
  const issuedAt = validTimestamp(input.grant.issuedAt, "grant.issuedAt");
  const notBefore = validTimestamp(input.grant.notBefore, "grant.notBefore");
  const expiresAt = validTimestamp(input.grant.expiresAt, "grant.expiresAt");
  if (Date.parse(notBefore) < Date.parse(issuedAt) || Date.parse(expiresAt) <= Date.parse(notBefore)) {
    throw new PairingStoreError("Grant validity interval is invalid.");
  }
  if (!Array.isArray(input.grant.scopes) || !input.grant.scopes.length) {
    throw new PairingStoreError("Grant must contain at least one scope.");
  }
  const scopes = input.grant.scopes.map(validScope);
  if (new Set(scopes).size !== scopes.length) throw new PairingStoreError("Grant scopes must be unique.");
  if (!canonicalScopeOrder(scopes)) throw new PairingStoreError("Grant scopes are not in canonical order.");
  const completion = input.grant.completion === undefined
    ? undefined
    : validatePairingCompletionInput(input.grant.completion, {
        deviceId,
        publicKeyX963B64u: publicKey.toString("base64url"),
        grantId: validGrantId(input.grant.grantId),
        desktopId,
        tlsCertificateSha256,
        scopes,
        issuedAt,
        notBefore,
        expiresAt
      });
  return {
    deviceId,
    displayName,
    publicKeyX963B64u: publicKey.toString("base64url"),
    pairedAt,
    grant: {
      grantId: validGrantId(input.grant.grantId),
      desktopId,
      tlsCertificateSha256,
      scopes,
      issuedAt,
      notBefore,
      expiresAt,
      ...(completion ? { completion } : {})
    }
  };
}

function validatePairingCompletionInput(
  value: RegisterPairedDeviceInput["grant"]["completion"],
  expected: {
    deviceId: string;
    publicKeyX963B64u: string;
    grantId: string;
    desktopId: string;
    tlsCertificateSha256: string;
    scopes: LiveGrantScope[];
    issuedAt: string;
    notBefore: string;
    expiresAt: string;
  }
): NonNullable<RegisterPairedDeviceInput["grant"]["completion"]> {
  if (!isRecord(value)) throw new PairingStoreError("Pairing completion is invalid.");
  exactInputKeys(value, ["requestId", "requestBodySha256", "envelope"], "Pairing completion");
  const requestId = validRequestId(value.requestId as string);
  const requestBodySha256 = validSha256(value.requestBodySha256 as string, "completion.requestBodySha256");
  let verified;
  try {
    verified = validatePairingGrantEnvelope(value.envelope);
  } catch {
    throw new PairingStoreError("Pairing completion grant envelope is invalid.");
  }
  assertCompletionPayload(verified.payload, {
    ...expected,
    requestId
  });
  return {
    requestId,
    requestBodySha256,
    envelope: verified.envelope
  };
}

function validateStoredCompletion(
  value: unknown,
  device: StoredDevice,
  grant: StoredGrant
): LivePairingGrantPayload {
  if (!isRecord(value)) throw new PairingStoreError("Stored pairing completion is invalid.", "corrupt");
  exactKeys(value, ["request_id", "request_body_sha256", "envelope"], "pairing completion");
  const requestId = validRequestIdCorrupt(value.request_id);
  validSha256Corrupt(value.request_body_sha256, "pairing completion request_body_sha256");
  let verified;
  try {
    verified = validatePairingGrantEnvelope(value.envelope);
  } catch {
    throw new PairingStoreError("Stored pairing completion grant envelope is invalid.", "corrupt");
  }
  try {
    assertCompletionPayload(verified.payload, {
      requestId,
      deviceId: device.device_id,
      publicKeyX963B64u: device.public_key_x963_b64u,
      grantId: grant.grant_id,
      desktopId: grant.desktop_id,
      tlsCertificateSha256: grant.tls_certificate_sha256,
      scopes: grant.scopes,
      issuedAt: grant.issued_at,
      notBefore: grant.not_before,
      expiresAt: grant.expires_at,
      pairingEpoch: grant.pairing_epoch
    });
  } catch {
    throw new PairingStoreError("Stored pairing completion differs from its grant.", "corrupt");
  }
  return verified.payload;
}

function assertCompletionPayload(
  payload: LivePairingGrantPayload,
  expected: {
    requestId: string;
    deviceId: string;
    publicKeyX963B64u: string;
    grantId: string;
    desktopId: string;
    tlsCertificateSha256: string;
    scopes: LiveGrantScope[];
    issuedAt: string;
    notBefore: string;
    expiresAt: string;
    pairingEpoch?: number;
  }
): void {
  if (
    payload.request_id !== expected.requestId
    || payload.device_id !== expected.deviceId
    || payload.device_public_key_b64u !== expected.publicKeyX963B64u
    || payload.grant_id !== expected.grantId
    || payload.desktop_id !== expected.desktopId
    || payload.tls_certificate_sha256 !== expected.tlsCertificateSha256
    || JSON.stringify(payload.permissions) !== JSON.stringify(expected.scopes)
    || payload.issued_at !== expected.issuedAt
    || payload.not_before !== expected.notBefore
    || payload.expires_at !== expected.expiresAt
    || (expected.pairingEpoch !== undefined && payload.pairing_epoch !== expected.pairingEpoch)
  ) {
    throw new PairingStoreError("Pairing completion differs from its grant.");
  }
}

function parseRegistry(bytes: Buffer): StoredRegistry {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new PairingStoreError("Pairing registry is not strict JSON.", "corrupt");
  }
  if (!isRecord(value)) throw new PairingStoreError("Pairing registry must be an object.", "corrupt");
  exactKeys(value, ["schema", "devices", "session_owners"], "pairing registry");
  if (value.schema !== registrySchema || !Array.isArray(value.devices) || !Array.isArray(value.session_owners)) {
    throw new PairingStoreError("Pairing registry schema is invalid.", "corrupt");
  }
  return value as unknown as StoredRegistry;
}

function validateRegistry(state: StoredRegistry, maxDevices: number, maxSessionOwners: number): void {
  if (state.schema !== registrySchema || !Array.isArray(state.devices) || !Array.isArray(state.session_owners)) {
    throw new PairingStoreError("Pairing registry shape is invalid.", "corrupt");
  }
  if (state.devices.length > maxDevices || state.session_owners.length > maxSessionOwners) {
    throw new PairingStoreError("Pairing registry exceeds configured bounds.", "corrupt");
  }
  const deviceIds = new Set<string>();
  const completionRequestIds = new Set<string>();
  for (const device of state.devices) {
    if (!isRecord(device)) throw new PairingStoreError("Pairing device entry is invalid.", "corrupt");
    exactKeys(device, [
      "device_id",
      "display_name",
      "public_key_x963_b64u",
      "pairing_epoch",
      "paired_at",
      "revoked_at",
      "grants"
    ], "pairing device");
    const deviceId = validDeviceIdCorrupt(device.device_id);
    if (deviceIds.has(deviceId)) throw new PairingStoreError("Pairing registry repeats a device ID.", "corrupt");
    deviceIds.add(deviceId);
    const publicKey = decodePublicKeyCorrupt(device.public_key_x963_b64u);
    if (deviceIdFor(publicKey) !== deviceId) {
      throw new PairingStoreError("Stored device ID does not match its public key.", "corrupt");
    }
    validDisplayNameCorrupt(device.display_name);
    positiveSafeIntegerCorrupt(device.pairing_epoch, "pairing_epoch");
    validTimestampCorrupt(device.paired_at, "paired_at");
    if (device.revoked_at !== null) validTimestampCorrupt(device.revoked_at, "revoked_at");
    if (!Array.isArray(device.grants) || device.grants.length > 8) {
      throw new PairingStoreError("Stored device grants are invalid.", "corrupt");
    }
    const grantIds = new Set<string>();
    for (const grant of device.grants) {
      if (!isRecord(grant)) throw new PairingStoreError("Stored grant is invalid.", "corrupt");
      exactKeys(grant, [
        "grant_id",
        "desktop_id",
        "tls_certificate_sha256",
        "pairing_epoch",
        "scopes",
        "issued_at",
        "not_before",
        "expires_at",
        "replay_highest_counter",
        "replay_bitmap_hex",
        "pairing_completion"
      ], "pairing grant");
      const grantId = validGrantIdCorrupt(grant.grant_id);
      if (grantIds.has(grantId)) throw new PairingStoreError("Pairing registry repeats a grant ID.", "corrupt");
      grantIds.add(grantId);
      validDesktopIdCorrupt(grant.desktop_id);
      validSha256Corrupt(grant.tls_certificate_sha256, "grant.tls_certificate_sha256");
      positiveSafeIntegerCorrupt(grant.pairing_epoch, "grant.pairing_epoch");
      if (!Array.isArray(grant.scopes) || !grant.scopes.length || grant.scopes.length > liveGrantScopes.size) {
        throw new PairingStoreError("Stored grant scopes are invalid.", "corrupt");
      }
      const scopes = grant.scopes.map((scope) => validScopeCorrupt(scope));
      if (new Set(scopes).size !== scopes.length) {
        throw new PairingStoreError("Stored grant scopes are duplicated.", "corrupt");
      }
      if (!canonicalScopeOrder(scopes)) {
        throw new PairingStoreError("Stored grant scopes are not in canonical order.", "corrupt");
      }
      const issued = validTimestampCorrupt(grant.issued_at, "grant.issued_at");
      const notBefore = validTimestampCorrupt(grant.not_before, "grant.not_before");
      const expires = validTimestampCorrupt(grant.expires_at, "grant.expires_at");
      if (Date.parse(notBefore) < Date.parse(issued) || Date.parse(expires) <= Date.parse(notBefore)) {
        throw new PairingStoreError("Stored grant validity interval is invalid.", "corrupt");
      }
      validStoredCounter(grant.replay_highest_counter);
      if (typeof grant.replay_bitmap_hex !== "string" || !/^[0-9a-f]{64}$/.test(grant.replay_bitmap_hex)) {
        throw new PairingStoreError("Stored replay bitmap is invalid.", "corrupt");
      }
      const replayBitmap = BigInt(`0x${grant.replay_bitmap_hex}`);
      if (grant.replay_highest_counter === "0" && replayBitmap !== 0n && replayBitmap !== 1n) {
        throw new PairingStoreError("Counter-zero replay state has invalid bitmap bits.", "corrupt");
      }
      if (grant.replay_highest_counter !== "0" && (replayBitmap & 1n) === 0n) {
        throw new PairingStoreError("Replay bitmap does not contain its highest counter.", "corrupt");
      }
      if (grant.pairing_completion !== null) {
        const payload = validateStoredCompletion(grant.pairing_completion, device, grant);
        if (completionRequestIds.has(payload.request_id)) {
          throw new PairingStoreError("Pairing registry repeats a completed request ID.", "corrupt");
        }
        completionRequestIds.add(payload.request_id);
      }
    }
  }
  const sessionIds = new Set<string>();
  for (const owner of state.session_owners) {
    if (!isRecord(owner)) throw new PairingStoreError("Session-owner entry is invalid.", "corrupt");
    exactKeys(owner, ["session_id", "device_id", "bound_at"], "session owner");
    const sessionId = validSessionIdCorrupt(owner.session_id);
    if (sessionIds.has(sessionId)) throw new PairingStoreError("Pairing registry repeats a session owner.", "corrupt");
    sessionIds.add(sessionId);
    if (!deviceIds.has(validDeviceIdCorrupt(owner.device_id))) {
      throw new PairingStoreError("Session owner references an unknown device.", "corrupt");
    }
    validTimestampCorrupt(owner.bound_at, "session owner bound_at");
  }
}

function validCounter(value: string): bigint {
  if (typeof value !== "string" || !counterPattern.test(value)) {
    throw new PairingStoreError("Request counter must be a canonical unsigned UInt64.");
  }
  const counter = BigInt(value);
  if (counter > maxUInt64) throw new PairingStoreError("Request counter exceeds UInt64.");
  return counter;
}

function validStoredCounter(value: unknown): void {
  if (value === "0") return;
  try {
    validCounter(value as string);
  } catch {
    throw new PairingStoreError("Stored replay counter is invalid.", "corrupt");
  }
}

function validDeviceId(value: string): string {
  if (typeof value !== "string" || !deviceIdPattern.test(value)) {
    throw new PairingStoreError("Device ID is invalid.");
  }
  return value;
}

function validDeviceIdCorrupt(value: unknown): string {
  try {
    return validDeviceId(value as string);
  } catch {
    throw new PairingStoreError("Stored device ID is invalid.", "corrupt");
  }
}

function validDesktopId(value: string): string {
  if (typeof value !== "string" || !desktopIdPattern.test(value)) {
    throw new PairingStoreError("Desktop ID is invalid.");
  }
  return value;
}

function validDesktopIdCorrupt(value: unknown): string {
  try {
    return validDesktopId(value as string);
  } catch {
    throw new PairingStoreError("Stored desktop ID is invalid.", "corrupt");
  }
}

function validGrantId(value: string): string {
  if (typeof value !== "string" || !grantIdPattern.test(value)) {
    throw new PairingStoreError("Grant ID is invalid.");
  }
  return value;
}

function validGrantIdCorrupt(value: unknown): string {
  try {
    return validGrantId(value as string);
  } catch {
    throw new PairingStoreError("Stored grant ID is invalid.", "corrupt");
  }
}

function validRequestId(value: string): string {
  if (typeof value !== "string" || !requestIdPattern.test(value)) {
    throw new PairingStoreError("Pairing request ID is invalid.");
  }
  return value;
}

function validRequestIdCorrupt(value: unknown): string {
  try {
    return validRequestId(value as string);
  } catch {
    throw new PairingStoreError("Stored pairing request ID is invalid.", "corrupt");
  }
}

function validSha256(value: string, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new PairingStoreError(`${label} is invalid.`);
  }
  return value;
}

function validSha256Corrupt(value: unknown, label: string): string {
  try {
    return validSha256(value as string, label);
  } catch {
    throw new PairingStoreError(`Stored ${label} is invalid.`, "corrupt");
  }
}

function validSessionId(value: string): string {
  if (typeof value !== "string" || !sessionIdPattern.test(value)) {
    throw new PairingStoreError("Session ID is invalid.");
  }
  return value;
}

function validSessionIdCorrupt(value: unknown): string {
  try {
    return validSessionId(value as string);
  } catch {
    throw new PairingStoreError("Stored session ID is invalid.", "corrupt");
  }
}

function validDisplayName(value: string): string {
  if (typeof value !== "string" || !value || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PairingStoreError("Device display name is invalid.");
  }
  return value;
}

function validDisplayNameCorrupt(value: unknown): void {
  try {
    validDisplayName(value as string);
  } catch {
    throw new PairingStoreError("Stored display name is invalid.", "corrupt");
  }
}

function validTimestamp(value: string, label: string): string {
  if (
    typeof value !== "string"
    || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new PairingStoreError(`${label} must be an RFC 3339 UTC timestamp.`);
  }
  return value;
}

function validTimestampCorrupt(value: unknown, label: string): string {
  try {
    return validTimestamp(value as string, label);
  } catch {
    throw new PairingStoreError(`Stored ${label} is invalid.`, "corrupt");
  }
}

function validScope(value: LiveGrantScope): LiveGrantScope {
  if (!liveGrantScopes.has(value)) throw new PairingStoreError("Grant scope is invalid.");
  return value;
}

function validScopeCorrupt(value: unknown): LiveGrantScope {
  try {
    return validScope(value as LiveGrantScope);
  } catch {
    throw new PairingStoreError("Stored grant scope is invalid.", "corrupt");
  }
}

function canonicalScopeOrder(scopes: readonly LiveGrantScope[]): boolean {
  let previous = -1;
  for (const scope of scopes) {
    const index = liveGrantScopeOrder.indexOf(scope);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

function decodePublicKey(value: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PairingStoreError("Device public key must be canonical base64url.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value
    || decoded.byteLength !== 65
    || decoded[0] !== 4
  ) {
    throw new PairingStoreError("Device public key must be uncompressed P-256 X9.63.");
  }
  try {
    createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: decoded.subarray(1, 33).toString("base64url"),
        y: decoded.subarray(33, 65).toString("base64url")
      }
    });
  } catch {
    throw new PairingStoreError("Device public key is not a valid P-256 point.");
  }
  return decoded;
}

function decodePublicKeyCorrupt(value: unknown): Buffer {
  try {
    return decodePublicKey(value as string);
  } catch {
    throw new PairingStoreError("Stored device public key is invalid.", "corrupt");
  }
}

function positiveSafeIntegerCorrupt(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new PairingStoreError(`Stored ${label} is invalid.`, "corrupt");
  }
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new PairingStoreError(`${label} must be positive.`);
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new PairingStoreError(`${label} contains unexpected fields.`, "corrupt");
  }
}

function exactInputKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new PairingStoreError(`${label} contains unexpected fields.`);
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PairingStoreError("Pairing store root must be a real directory.", "corrupt");
  }
  await chmod(directory, 0o700);
}

async function assertPrivateStore(root: string, statePath: string): Promise<void> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new PairingStoreError("Pairing store root changed type.", "corrupt");
  }
  try {
    const stateInfo = await lstat(statePath);
    if (stateInfo.isSymbolicLink() || !stateInfo.isFile()) {
      throw new PairingStoreError("Pairing registry must be a regular file.", "corrupt");
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PairingStoreError("Pairing registry disappeared.", "corrupt");
    }
    throw error;
  }
}

async function readOptionalRegularFile(filePath: string): Promise<Buffer | null> {
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new PairingStoreError("Pairing registry must be a regular file.", "corrupt");
    }
    return await readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWriteRegistry(
  filePath: string,
  value: StoredRegistry,
  randomId: () => string
): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.pairing-registry-${randomId()}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > maxRegistryBytes) {
    throw new PairingStoreError("Pairing registry exceeds its byte limit.", "conflict");
  }
  try {
    const handle = await open(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
    await chmod(filePath, 0o600);
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await rm(tempPath, { force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
