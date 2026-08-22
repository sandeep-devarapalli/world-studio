import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type Server as HttpsServer
} from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { hostname } from "node:os";
import type {
  LiveNetworkInterface,
  LiveSecuritySnapshot,
  LiveSessionSnapshot
} from "@world-studio/world-core";
import {
  LIVE_AUTH_AUDIENCE,
  LIVE_AUTH_ERROR_SCHEMA,
  LIVE_AUTH_RECEIPT_SCHEMA,
  LIVE_AUTH_SCHEME,
  LIVE_BONJOUR_DOMAIN,
  LIVE_BONJOUR_SERVICE_TYPE,
  LIVE_PAIRING_GRANT_PAYLOAD_SCHEMA,
  LIVE_PAIRING_INVITATION_SCHEMA,
  LIVE_PAIRING_PERMISSIONS,
  LiveAuthContractError,
  canonicalLiveAuthJson,
  createPairingGrantEnvelope,
  encodePairingInvitationUri,
  pairingVerificationCode,
  validatePairingInvitation,
  verifyPairingRequest,
  type LiveAuthErrorCode,
  type LivePairingInvitation,
  type LivePairingRequestEnvelope,
  type LivePairingRequestPayload
} from "./live-auth-contract.js";
import {
  DesktopIdentityStore,
  type DesktopIdentity
} from "./live-desktop-identity.js";
import {
  LiveBonjourPublisher,
  liveBonjourServiceName
} from "./live-bonjour.js";
import {
  listPrivateLiveInterfaces
} from "./live-network-interfaces.js";
import {
  PairingStore,
  PairingStoreError,
  type PairedDeviceSummary
} from "./live-pairing-store.js";
import {
  LiveRequestAuthError,
  authorizeLiveRequestHeaders
} from "./live-request-auth.js";
import { LiveSessionReceiver } from "./live-session-receiver.js";

const pairingApiRoot = "/api/capture-splat/pairing/v0.1";
const maxPairingBodyBytes = 64 * 1024;
const defaultPairingTtlMs = 120_000;
const defaultPendingTtlMs = 120_000;
const defaultGrantTtlMs = 7 * 24 * 60 * 60 * 1000;
const defaultListenerLeaseMs = 8 * 60 * 60 * 1000;
const defaultSecurePort = 43128;

type GatewayMode = "pairing" | "pending" | "live" | null;

interface PendingPairing {
  envelope: LivePairingRequestEnvelope;
  payload: LivePairingRequestPayload;
  bodySha256: string;
  pairingEpoch: number;
  expiresAt: Date;
  response: ServerResponse | null;
}

export interface LiveSecureGatewayOptions {
  receiver: LiveSessionReceiver;
  identityStore: DesktopIdentityStore;
  pairingStore: PairingStore;
  bonjour?: LiveBonjourPublisher;
  listInterfaces?: () => LiveNetworkInterface[];
  now?: () => Date;
  random?: (size: number) => Buffer;
  desktopName?: string;
  port?: number;
  pairingTtlMs?: number;
  pendingTtlMs?: number;
  grantTtlMs?: number;
  listenerLeaseMs?: number;
  interfacePollMs?: number;
  allowLoopbackForTests?: boolean;
}

export type LiveSecurityUpdateListener = (snapshot: LiveSecuritySnapshot) => void;

export class LiveSecureGateway {
  private readonly receiver: LiveSessionReceiver;
  private readonly identityStore: DesktopIdentityStore;
  private readonly pairingStore: PairingStore;
  private readonly bonjour: LiveBonjourPublisher;
  private readonly listInterfaces: () => LiveNetworkInterface[];
  private readonly now: () => Date;
  private readonly random: (size: number) => Buffer;
  private readonly desktopName: string;
  private readonly requestedPort: number;
  private readonly pairingTtlMs: number;
  private readonly pendingTtlMs: number;
  private readonly grantTtlMs: number;
  private readonly listenerLeaseMs: number;
  private readonly interfacePollMs: number;
  private readonly allowLoopbackForTests: boolean;
  private readonly listeners = new Set<LiveSecurityUpdateListener>();
  private readonly sockets = new Map<Socket, string | null>();
  private readonly lastAuthenticatedAt = new Map<string, string>();
  private lifecycleTransition: Promise<void> = Promise.resolve();
  private lifecycleGeneration = 0;
  private server: HttpsServer | null = null;
  private identity: DesktopIdentity | null = null;
  private selectedInterface: LiveNetworkInterface | null = null;
  private listeningPort: number | null = null;
  private mode: GatewayMode = null;
  private invitation: LivePairingInvitation | null = null;
  private pending: PendingPairing | null = null;
  private activeDeviceId: string | null = null;
  private activeGrantId: string | null = null;
  private lastError: string | undefined;
  private invalidPairingAttempts = 0;
  private pairingTimer: NodeJS.Timeout | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private grantTimer: NodeJS.Timeout | null = null;
  private interfaceTimer: NodeJS.Timeout | null = null;

  constructor(options: LiveSecureGatewayOptions) {
    this.receiver = options.receiver;
    this.identityStore = options.identityStore;
    this.pairingStore = options.pairingStore;
    this.listInterfaces = options.listInterfaces ?? listPrivateLiveInterfaces;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? randomBytes;
    this.desktopName = validateDesktopName(options.desktopName ?? hostname());
    this.requestedPort = integerBound(options.port ?? defaultSecurePort, "port", 0, 65_535);
    this.pairingTtlMs = integerBound(options.pairingTtlMs ?? defaultPairingTtlMs, "pairingTtlMs", 1, 300_000);
    this.pendingTtlMs = integerBound(options.pendingTtlMs ?? defaultPendingTtlMs, "pendingTtlMs", 1, 300_000);
    this.grantTtlMs = integerBound(options.grantTtlMs ?? defaultGrantTtlMs, "grantTtlMs", 1, 30 * 24 * 60 * 60 * 1000);
    this.listenerLeaseMs = integerBound(options.listenerLeaseMs ?? defaultListenerLeaseMs, "listenerLeaseMs", 1, 24 * 60 * 60 * 1000);
    this.interfacePollMs = integerBound(options.interfacePollMs ?? 5_000, "interfacePollMs", 50, 60_000);
    this.allowLoopbackForTests = options.allowLoopbackForTests === true;
    this.bonjour = options.bonjour ?? new LiveBonjourPublisher({
      onTermination: () => {
        void this.failClosed("Bonjour publication stopped unexpectedly.");
      }
    });
  }

  subscribe(listener: LiveSecurityUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async status(): Promise<LiveSecuritySnapshot> {
    await this.pairingStore.initialize();
    const devices = await this.pairingStore.list();
    return this.snapshot(devices);
  }

  beginPairing(interfaceId: string): Promise<LiveSecuritySnapshot> {
    return this.withLifecycleTransition(() => this.beginPairingUnlocked(interfaceId));
  }

  private async beginPairingUnlocked(interfaceId: string): Promise<LiveSecuritySnapshot> {
    if (this.server) throw new Error("A paired LAN listener is already active.");
    this.lastError = undefined;
    this.identity = await this.identityStore.loadOrCreate();
    await this.pairingStore.initialize();
    const selected = this.selectInterface(interfaceId);
    await this.startServer(selected, "pairing");
    const issuedAt = this.validNow();
    const expiresAt = new Date(issuedAt.getTime() + this.pairingTtlMs);
    const pairingId = this.randomId("csp");
    const serviceName = liveBonjourServiceName(this.identity.desktopId);
    const invitation = validatePairingInvitation({
      schema: LIVE_PAIRING_INVITATION_SCHEMA,
      pairing_id: pairingId,
      mode: "qr",
      desktop_id: this.identity.desktopId,
      desktop_name: this.desktopName,
      desktop_public_key_b64u: this.identity.publicKeyX963B64u,
      discovery: {
        service_type: LIVE_BONJOUR_SERVICE_TYPE,
        service_name: serviceName,
        domain: LIVE_BONJOUR_DOMAIN
      },
      tls_certificate_sha256: this.identity.certificateSha256,
      pairing_secret_b64u: this.randomBytes(32, "pairing secret").toString("base64url"),
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      permissions: [...LIVE_PAIRING_PERMISSIONS],
      authority: "proposal_only"
    });
    this.invitation = invitation;
    this.invalidPairingAttempts = 0;
    try {
      this.bonjour.start({
        port: this.requireListeningPort(),
        interfaceName: selected.name,
        mode: "pairing",
        desktopId: this.identity.desktopId,
        tlsCertificateSha256: this.identity.certificateSha256
      });
    } catch (error) {
      await this.stopServerOnly();
      throw error;
    }
    this.pairingTimer = setTimeout(() => {
      void this.failClosed("Pairing invitation expired.");
    }, this.pairingTtlMs);
    this.pairingTimer.unref();
    return this.emit();
  }

  async cancelPairing(): Promise<LiveSecuritySnapshot> {
    return this.withLifecycleTransition(async () => {
      if (this.mode !== "pairing" && this.mode !== "pending") return this.status();
      this.sendPendingProblem(409, "pairing_consumed", false);
      await this.stopUnlocked();
      return this.status();
    });
  }

  async rejectPairing(): Promise<LiveSecuritySnapshot> {
    return this.withLifecycleTransition(async () => {
      if (!this.pending) throw new Error("There is no pending pairing request.");
      this.sendPendingProblem(403, "permission_denied", false);
      await this.stopUnlocked();
      return this.status();
    });
  }

  async approvePairing(): Promise<LiveSecuritySnapshot> {
    return this.withLifecycleTransition(async () => {
      const pending = this.pending;
      const identity = this.identity;
      const selected = this.selectedInterface;
      if (!pending || !identity || !selected || this.listeningPort === null) {
        throw new Error("There is no pending pairing request.");
      }
      const now = this.validNow();
      if (now.getTime() >= pending.expiresAt.getTime()) {
        await this.failClosedUnlocked("Pending pairing approval expired.");
        throw new Error("Pending pairing approval expired.");
      }
      const grantId = this.randomId("csg");
      const issuedAt = now.toISOString();
      const notBefore = issuedAt;
      const expiresAt = new Date(now.getTime() + this.grantTtlMs).toISOString();
      const grant = createPairingGrantEnvelope({
        schema: LIVE_PAIRING_GRANT_PAYLOAD_SCHEMA,
        pairing_id: pending.payload.pairing_id,
        request_id: pending.payload.request_id,
        grant_id: grantId,
        desktop_id: identity.desktopId,
        device_id: pending.payload.device_id,
        device_public_key_b64u: pending.payload.device_public_key_b64u,
        permissions: [...LIVE_PAIRING_PERMISSIONS],
        auth_scheme: LIVE_AUTH_SCHEME,
        audience: LIVE_AUTH_AUDIENCE,
        pairing_epoch: pending.pairingEpoch,
        live_discovery: {
          service_type: LIVE_BONJOUR_SERVICE_TYPE,
          service_name: liveBonjourServiceName(identity.desktopId),
          domain: LIVE_BONJOUR_DOMAIN
        },
        tls_certificate_sha256: identity.certificateSha256,
        issued_at: issuedAt,
        not_before: notBefore,
        expires_at: expiresAt,
        authority: "proposal_only"
      }, identity.privateKeyPem);
      const registered = await this.pairingStore.registerDevice({
        deviceId: pending.payload.device_id,
        displayName: pending.payload.device_name,
        publicKeyX963B64u: pending.payload.device_public_key_b64u,
        pairedAt: issuedAt,
        grant: {
          grantId,
          desktopId: identity.desktopId,
          tlsCertificateSha256: identity.certificateSha256,
          scopes: [...LIVE_PAIRING_PERMISSIONS],
          issuedAt,
          notBefore,
          expiresAt,
          completion: {
            requestId: pending.payload.request_id,
            requestBodySha256: pending.bodySha256,
            envelope: grant
          }
        }
      });
      if (registered.pairingEpoch !== pending.pairingEpoch) {
        await this.failClosedUnlocked("Pairing epoch changed during approval.");
        throw new Error("Pairing state changed during approval.");
      }
      this.pending = null;
      this.mode = "live";
      this.activeDeviceId = pending.payload.device_id;
      this.activeGrantId = grantId;
      this.clearTimer("pairing");
      try {
        this.bonjour.start({
          port: this.requireListeningPort(),
          interfaceName: selected.name,
          mode: "paired",
          desktopId: identity.desktopId,
          tlsCertificateSha256: identity.certificateSha256
        });
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Bonjour publication failed.";
      }
      sendJsonIfOpen(pending.response, 200, grant);
      this.startLeaseTimer();
      this.startGrantTimer(expiresAt);
      return this.emit();
    });
  }

  startPairedReceiver(input: {
    interfaceId: string;
    grantId: string;
  }): Promise<LiveSecuritySnapshot> {
    return this.withLifecycleTransition(() => this.startPairedReceiverUnlocked(input));
  }

  private async startPairedReceiverUnlocked(input: {
    interfaceId: string;
    grantId: string;
  }): Promise<LiveSecuritySnapshot> {
    if (this.server) throw new Error("A paired LAN listener is already active.");
    await this.pairingStore.initialize();
    const devices = await this.pairingStore.list();
    const device = devices.find((candidate) => (
      candidate.revokedAt === null
      && candidate.grants.some((grant) => grant.grantId === input.grantId)
    ));
    if (!device) throw new Error("The selected pairing grant is unavailable or revoked.");
    this.identity = await this.identityStore.loadOrCreate();
    const grant = await this.pairingStore.getGrant(device.deviceId, input.grantId, {
      now: this.validNow(),
      requiredScope: "receiver:status",
      desktopId: this.identity.desktopId,
      tlsCertificateSha256: this.identity.certificateSha256
    });
    const selected = this.selectInterface(input.interfaceId);
    this.lastError = undefined;
    await this.startServer(selected, "live");
    this.activeDeviceId = device.deviceId;
    this.activeGrantId = input.grantId;
    try {
      this.bonjour.start({
        port: this.requireListeningPort(),
        interfaceName: selected.name,
        mode: "paired",
        desktopId: this.identity.desktopId,
        tlsCertificateSha256: this.identity.certificateSha256
      });
    } catch (error) {
      await this.stopServerOnly();
      throw error;
    }
    this.startLeaseTimer();
    this.startGrantTimer(grant.expiresAt);
    return this.emit();
  }

  stop(): Promise<void> {
    return this.withLifecycleTransition(() => this.stopUnlocked());
  }

  private async stopUnlocked(): Promise<void> {
    this.sendPendingProblem(409, "receiver_not_paired", true);
    await this.stopServerOnly();
    this.lastError = undefined;
    await this.emit();
  }

  async stopPairedReceiver(): Promise<LiveSecuritySnapshot> {
    return this.withLifecycleTransition(async () => {
      await this.stopUnlocked();
      return this.status();
    });
  }

  revokeGrant(grantId: string): Promise<LiveSecuritySnapshot> {
    return this.withLifecycleTransition(() => this.revokeGrantUnlocked(grantId));
  }

  private async revokeGrantUnlocked(grantId: string): Promise<LiveSecuritySnapshot> {
    const devices = await this.pairingStore.list();
    const device = devices.find((candidate) => candidate.grants.some((grant) => grant.grantId === grantId));
    if (!device) throw new Error("Pairing grant was not found.");
    await this.pairingStore.revoke(device.deviceId, this.validNow().toISOString());
    for (const [socket, socketDeviceId] of this.sockets) {
      if (socketDeviceId === device.deviceId) socket.destroy();
    }
    if (this.activeDeviceId === device.deviceId) await this.stopUnlocked();
    return this.status();
  }

  private async startServer(selected: LiveNetworkInterface, mode: Exclude<GatewayMode, null>): Promise<void> {
    const identity = this.identity;
    if (!identity) throw new Error("Desktop identity is unavailable.");
    this.mode = mode;
    this.selectedInterface = selected;
    const server = createServer({
      key: identity.privateKeyPem,
      cert: identity.certificatePem,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      honorCipherOrder: true
    }, (request, response) => {
      void this.handleRequest(request, response);
    });
    server.maxConnections = 16;
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxRequestsPerSocket = 128;
    server.on("secureConnection", (socket) => {
      this.sockets.set(socket, null);
      socket.once("close", () => this.sockets.delete(socket));
    });
    server.on("tlsClientError", (_error, socket) => socket.destroy());
    server.on("clientError", (_error, socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.requestedPort, selected.address);
      });
    } catch (error) {
      server.closeAllConnections();
      this.mode = null;
      this.selectedInterface = null;
      throw error;
    }
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string" || address.address !== selected.address) {
      await this.stopServerOnly();
      throw new Error("Secure receiver did not bind the selected interface.");
    }
    this.listeningPort = address.port;
    this.lifecycleGeneration += 1;
    this.interfaceTimer = setInterval(() => {
      if (!this.selectedInterface || this.listInterfaces().some((entry) => entry.id === this.selectedInterface!.id)) return;
      void this.failClosed("Selected network interface changed or disappeared.");
    }, this.interfacePollMs);
    this.interfaceTimer.unref();
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (
        request.method === "GET"
        && request.url === `${pairingApiRoot}/health`
        && (this.mode === "pairing" || this.mode === "pending")
      ) {
        sendJson(response, 200, {
          schema: "capture_splat.live_pairing_health.v0.1",
          ok: true,
          protocol: "0.1"
        });
        return;
      }
      if (
        request.method === "POST"
        && request.url === `${pairingApiRoot}/requests`
      ) {
        await this.handlePairingRequest(request, response);
        return;
      }
      if (this.mode !== "live" || !this.identity) {
        sendAuthProblem(response, 404, "receiver_not_paired", true);
        return;
      }
      const activeDeviceId = this.activeDeviceId;
      const activeGrantId = this.activeGrantId;
      if (!activeDeviceId || !activeGrantId) {
        sendAuthProblem(response, 404, "receiver_not_paired", true);
        return;
      }
      const principal = await authorizeLiveRequestHeaders({
        request: {
          method: request.method,
          url: request.url,
          rawHeaders: request.rawHeaders
        },
        now: this.validNow(),
        pairingStore: this.pairingStore,
        desktopId: this.identity.desktopId,
        tlsCertificateSha256: this.identity.certificateSha256,
        expectedDeviceId: activeDeviceId,
        expectedGrantId: activeGrantId,
        recoverUnknownSessionOwner: async (evidence) => {
          try {
            await this.receiver.store.assertRecoverableSessionOwner(
              evidence.sessionId,
              {
                schema: LIVE_AUTH_RECEIPT_SCHEMA,
                session_id: evidence.sessionId,
                desktop_id: evidence.desktopId,
                device_id: evidence.deviceId,
                grant_id: evidence.grantId,
                pairing_epoch: evidence.pairingEpoch,
                permissions: evidence.permissions,
                auth_scheme: LIVE_AUTH_SCHEME,
                tls_certificate_sha256: this.identity!.certificateSha256,
                authenticated_at: evidence.requestTime,
                grant_expires_at: evidence.grantExpiresAt,
                authority: "proposal_only"
              }
            );
            return true;
          } catch {
            return false;
          }
        }
      });
      this.sockets.set(request.socket, principal.deviceId);
      this.lastAuthenticatedAt.set(principal.deviceId, this.validNow().toISOString());
      await this.emit();
      const sessionId = principal.sessionId;
      if (sessionId === null) {
        const snapshot = this.secureTransportSnapshot();
        if (request.url === "/api/capture-splat/live/v0.1/health") {
          sendJson(response, 200, {
            schema: "capture_splat.live_receiver_health.v0.1",
            ok: true,
            receiver: snapshot
          });
        } else {
          sendJson(response, 200, snapshot);
        }
        return;
      }
      await this.receiver.dispatch(request, response, {
        expectedBodySha256: principal.declaredBodySha256,
        onSessionAuthorized: async () => {
            await this.pairingStore.bindSessionOwner(
              sessionId,
              principal.deviceId,
              principal.requestTime
            );
        },
        authReceipt: {
          schema: LIVE_AUTH_RECEIPT_SCHEMA,
          session_id: sessionId,
          desktop_id: principal.desktopId,
          device_id: principal.deviceId,
          grant_id: principal.grantId,
          pairing_epoch: principal.pairingEpoch,
          permissions: principal.permissions,
          auth_scheme: LIVE_AUTH_SCHEME,
          tls_certificate_sha256: this.identity.certificateSha256,
          authenticated_at: principal.requestTime,
          grant_expires_at: principal.grantExpiresAt,
          authority: "proposal_only"
        }
      });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof LiveRequestAuthError) {
        sendAuthProblem(
          response,
          error.statusCode,
          error.authCode,
          retryableAuthError(error.authCode)
        );
        return;
      }
      if (error instanceof LiveAuthContractError) {
        sendAuthProblem(response, 400, error.authCode, retryableAuthError(error.authCode));
        return;
      }
      sendAuthProblem(response, 500, "invalid_request", true);
    }
  }

  private async handlePairingRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const body = await readCanonicalPairingBody(request);
    const bodySha256 = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const parsedValue = JSON.parse(body.toString("utf8")) as unknown;
    const requestId = requestIdFromPairingEnvelope(parsedValue);
    await this.withLifecycleTransition(async () => {
      const completed = requestId
        ? await this.pairingStore.getCompletedPairing(requestId)
        : null;
      if (completed) {
        if (completed.requestBodySha256 !== bodySha256) {
          sendAuthProblem(response, 409, "pairing_consumed", false);
        } else {
          sendJson(response, 200, completed.envelope);
        }
        return;
      }
      if (this.pending) {
        if (
          requestId === this.pending.payload.request_id
          && bodySha256 === this.pending.bodySha256
        ) {
          if (this.pending.response && this.pending.response !== response) this.pending.response.destroy();
          this.pending.response = response;
          this.observePendingResponse(this.pending, response);
          return;
        }
        sendAuthProblem(response, 409, "pairing_consumed", false);
        return;
      }
      const invitation = this.invitation;
      if (this.mode !== "pairing" || !invitation) {
        sendAuthProblem(response, 409, "pairing_consumed", false);
        return;
      }
      try {
        const verified = verifyPairingRequest(parsedValue, invitation, this.validNow());
        const existing = (await this.pairingStore.list()).find(
          (device) => device.deviceId === verified.payload.device_id
        );
        const pending: PendingPairing = {
          envelope: verified.envelope,
          payload: verified.payload,
          bodySha256,
          pairingEpoch: (existing?.pairingEpoch ?? 0) + 1,
          expiresAt: new Date(this.validNow().getTime() + this.pendingTtlMs),
          response
        };
        this.pending = pending;
        this.invitation = null;
        this.mode = "pending";
        this.bonjour.stop();
        this.clearTimer("pairing");
        this.observePendingResponse(pending, response);
        this.pairingTimer = setTimeout(() => {
          void this.failClosed("Pending pairing approval expired.");
        }, this.pendingTtlMs);
        this.pairingTimer.unref();
        await this.emit();
      } catch (error) {
        this.invalidPairingAttempts += 1;
        sendAuthProblem(
          response,
          error instanceof LiveAuthContractError && error.authCode === "pairing_expired" ? 410 : 401,
          error instanceof LiveAuthContractError ? error.authCode : "invalid_request",
          error instanceof LiveAuthContractError ? retryableAuthError(error.authCode) : true
        );
        if (this.invalidPairingAttempts >= 5) {
          await this.failClosedUnlocked("Pairing attempt limit reached.");
        }
      }
    });
  }

  private observePendingResponse(pending: PendingPairing, response: ServerResponse): void {
    response.setTimeout(this.pendingTtlMs, () => {
      if (pending.response === response) pending.response = null;
      response.destroy();
    });
    response.once("close", () => {
      if (pending.response === response && !response.writableEnded) pending.response = null;
    });
  }

  private secureTransportSnapshot(): LiveSessionSnapshot {
    return {
      state: this.mode === "live" ? "listening" : "stopped",
      listening: this.selectedInterface && this.listeningPort !== null
        ? { host: this.selectedInterface.address, port: this.listeningPort }
        : null,
      sessionId: null,
      sourceManifestId: null,
      coordinateUnits: null,
      expectedCount: null,
      finalSequenceId: null,
      receivedCount: 0,
      contiguousCount: 0,
      pendingCount: 0,
      missingCount: 0,
      nextExpectedSequenceId: 1,
      missingRanges: [],
      frames: [],
      authority: "proposal_only",
      updatedAt: null
    };
  }

  private async snapshot(devices: PairedDeviceSummary[]): Promise<LiveSecuritySnapshot> {
    const now = this.validNow();
    const pairedDevices = devices.flatMap((device) => {
      const grant = device.grants.at(-1);
      if (!grant) return [];
      return [{
        deviceId: device.deviceId,
        displayName: device.displayName,
        pairingEpoch: device.pairingEpoch,
        grantId: grant.grantId,
        scopes: [...grant.scopes],
        pairedAt: device.pairedAt,
        expiresAt: grant.expiresAt,
        revokedAt: device.revokedAt,
        lastAuthenticatedAt: this.lastAuthenticatedAt.get(device.deviceId) ?? null
      }];
    });
    const invitationUri = this.invitation ? encodePairingInvitationUri(this.invitation) : null;
    const state: LiveSecuritySnapshot["state"] = this.mode === "pairing"
      ? "pairing"
      : this.mode === "pending"
        ? "pairing_pending"
        : this.mode === "live"
          ? "secure_listening"
          : pairedDevices.some((device) => (
              device.revokedAt === null
              && new Date(device.expiresAt).getTime() > now.getTime()
            ))
            ? "paired"
            : "loopback_only";
    return {
      state,
      desktopId: this.identity?.desktopId ?? null,
      desktopName: this.desktopName,
      interfaces: this.listInterfaces(),
      selectedInterfaceId: this.selectedInterface?.id ?? null,
      secureListening: this.selectedInterface && this.listeningPort !== null
        ? { host: this.selectedInterface.address, port: this.listeningPort, tls: true }
        : null,
      pairingInvitationUri: invitationUri,
      pairingVerificationCode: this.invitation && this.identity
        ? pairingVerificationCode(this.identity.certificateSha256)
        : null,
      tlsCertificateSha256: this.identity?.certificateSha256 ?? null,
      pairingExpiresAt: this.invitation?.expires_at ?? this.pending?.expiresAt.toISOString() ?? null,
      pendingDevice: this.pending ? {
        deviceId: this.pending.payload.device_id,
        displayName: this.pending.payload.device_name,
        pairingEpoch: this.pending.pairingEpoch,
        requestedAt: this.pending.payload.created_at,
        expiresAt: this.pending.expiresAt.toISOString()
      } : null,
      pairedDevices,
      updatedAt: now.toISOString(),
      ...(this.lastError ? { error: this.lastError } : {})
    };
  }

  private async emit(): Promise<LiveSecuritySnapshot> {
    const snapshot = await this.status();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Renderer subscriptions cannot change transport state.
      }
    }
    return snapshot;
  }

  private failClosed(message: string): Promise<void> {
    const generation = this.lifecycleGeneration;
    return this.withLifecycleTransition(async () => {
      if (generation !== this.lifecycleGeneration) return;
      await this.failClosedUnlocked(message);
    });
  }

  private async failClosedUnlocked(message: string): Promise<void> {
    this.lastError = message;
    this.sendPendingProblem(503, "receiver_not_paired", true);
    await this.stopServerOnly();
    await this.emit();
  }

  private async stopServerOnly(): Promise<void> {
    this.lifecycleGeneration += 1;
    const interruptedLiveTransport = this.mode === "live";
    this.bonjour.stop();
    this.clearTimer("pairing");
    this.clearTimer("lease");
    this.clearTimer("grant");
    if (this.interfaceTimer) {
      clearInterval(this.interfaceTimer);
      this.interfaceTimer = null;
    }
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const socket of this.sockets.keys()) socket.destroy();
    this.sockets.clear();
    this.listeningPort = null;
    this.selectedInterface = null;
    this.mode = null;
    this.invitation = null;
    this.pending = null;
    this.activeDeviceId = null;
    this.activeGrantId = null;
    this.invalidPairingAttempts = 0;
    if (interruptedLiveTransport) await this.receiver.markTransportInterrupted();
  }

  private sendPendingProblem(statusCode: number, code: LiveAuthErrorCode, retryable: boolean): void {
    if (!this.pending) return;
    sendAuthProblemIfOpen(this.pending.response, statusCode, code, retryable);
  }

  private startLeaseTimer(): void {
    this.clearTimer("lease");
    this.leaseTimer = setTimeout(() => {
      void this.failClosed("Secure LAN listener lease expired.");
    }, this.listenerLeaseMs);
    this.leaseTimer.unref();
  }

  private startGrantTimer(expiresAt: string): void {
    this.clearTimer("grant");
    const expiresAtMs = Date.parse(expiresAt);
    const schedule = (): void => {
      const remainingMs = expiresAtMs - this.validNow().getTime();
      if (remainingMs <= 0) {
        void this.failClosed("Pairing grant expired.");
        return;
      }
      const delay = Math.min(remainingMs, 2_147_000_000);
      this.grantTimer = setTimeout(() => {
        this.grantTimer = null;
        schedule();
      }, delay);
      this.grantTimer.unref();
    };
    schedule();
  }

  private clearTimer(kind: "pairing" | "lease" | "grant"): void {
    const timer = kind === "pairing"
      ? this.pairingTimer
      : kind === "lease"
        ? this.leaseTimer
        : this.grantTimer;
    if (timer) clearTimeout(timer);
    if (kind === "pairing") this.pairingTimer = null;
    else if (kind === "lease") this.leaseTimer = null;
    else this.grantTimer = null;
  }

  private selectInterface(interfaceId: string): LiveNetworkInterface {
    const selected = this.listInterfaces().find((entry) => entry.id === interfaceId);
    if (!selected) throw new Error("The selected private network interface is no longer available.");
    if (
      selected.address === "0.0.0.0"
      || selected.address === "::"
      || (!this.allowLoopbackForTests && selected.address.startsWith("127."))
    ) {
      throw new Error("Secure LAN cannot bind a wildcard or loopback address.");
    }
    return selected;
  }

  private requireListeningPort(): number {
    if (this.listeningPort === null) throw new Error("Secure receiver is not listening.");
    return this.listeningPort;
  }

  private randomId(prefix: "csp" | "csg"): string {
    return `${prefix}_${this.randomBytes(16, `${prefix} identifier`).toString("base64url")}`;
  }

  private randomBytes(size: number, label: string): Buffer {
    const value = this.random(size);
    if (!Buffer.isBuffer(value) || value.byteLength !== size) {
      throw new Error(`${label} generator returned the wrong byte count.`);
    }
    return value;
  }

  private withLifecycleTransition<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.lifecycleTransition;
    let release = (): void => {};
    this.lifecycleTransition = new Promise<void>((resolve) => {
      release = resolve;
    });
    return prior.then(operation).finally(release);
  }

  private validNow(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Security clock is invalid.");
    return value;
  }
}

async function readCanonicalPairingBody(request: IncomingMessage): Promise<Buffer> {
  if (request.headers["transfer-encoding"] || request.headers["content-encoding"]) {
    throw new LiveAuthContractError("Pairing request encoding is not accepted.");
  }
  const contentType = oneRawHeader(request.rawHeaders, "content-type");
  if (contentType !== "application/json") {
    throw new LiveAuthContractError("Pairing requests require canonical application/json.");
  }
  const contentLengthValue = oneRawHeader(request.rawHeaders, "content-length");
  if (!/^[1-9][0-9]*$/.test(contentLengthValue)) {
    throw new LiveAuthContractError("Pairing Content-Length is invalid.");
  }
  const contentLength = Number(contentLengthValue);
  if (!Number.isSafeInteger(contentLength) || contentLength > maxPairingBodyBytes) {
    throw new LiveAuthContractError("Pairing request exceeds its byte limit.");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const value of request) {
    const chunk = Buffer.from(value);
    received += chunk.byteLength;
    if (received > contentLength || received > maxPairingBodyBytes) {
      throw new LiveAuthContractError("Pairing request body exceeds Content-Length.");
    }
    chunks.push(chunk);
  }
  if (received !== contentLength) throw new LiveAuthContractError("Pairing request body was truncated.");
  const body = Buffer.concat(chunks);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new LiveAuthContractError("Pairing request must be strict JSON.");
  }
  if (!canonicalLiveAuthJson(parsed).equals(body)) {
    throw new LiveAuthContractError("Pairing request must use exact canonical JSON bytes.");
  }
  return body;
}

function requestIdFromPairingEnvelope(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payloadB64u = (value as Record<string, unknown>).payload_b64u;
  if (typeof payloadB64u !== "string" || !/^[A-Za-z0-9_-]+$/.test(payloadB64u)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64u, "base64url").toString("utf8")) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const requestId = (payload as Record<string, unknown>).request_id;
    return typeof requestId === "string" && /^csr_[A-Za-z0-9_-]{21}[AQgw]$/.test(requestId)
      ? requestId
      : null;
  } catch {
    return null;
  }
}

function oneRawHeader(rawHeaders: string[], wanted: string): string {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === wanted) values.push(rawHeaders[index + 1] ?? "");
  }
  if (values.length !== 1 || !values[0] || values[0] !== values[0].trim()) {
    throw new LiveAuthContractError(`Pairing header ${wanted} is missing, duplicated, or noncanonical.`);
  }
  return values[0];
}

function sendAuthProblem(
  response: ServerResponse,
  statusCode: number,
  code: LiveAuthErrorCode,
  retryable: boolean
): void {
  sendJson(response, statusCode, {
    schema: LIVE_AUTH_ERROR_SCHEMA,
    code,
    retryable
  });
}

function sendAuthProblemIfOpen(
  response: ServerResponse | null,
  statusCode: number,
  code: LiveAuthErrorCode,
  retryable: boolean
): void {
  if (response && !response.destroyed && !response.writableEnded) {
    sendAuthProblem(response, statusCode, code, retryable);
  }
}

function retryableAuthError(code: LiveAuthErrorCode): boolean {
  return code === "body_digest_mismatch"
    || code === "invalid_request"
    || code === "receiver_not_paired"
    || code === "tls_required";
}

function sendJsonIfOpen(response: ServerResponse | null, statusCode: number, value: unknown): void {
  if (response && !response.destroyed && !response.writableEnded) sendJson(response, statusCode, value);
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function validateDesktopName(value: string): string {
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 80) {
    throw new Error("Desktop display name must be between 1 and 80 UTF-8 bytes.");
  }
  return normalized;
}

function integerBound(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is outside its allowed integer range.`);
  }
  return value;
}
