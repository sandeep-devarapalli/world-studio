import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject
} from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions
} from "node:https";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TLSSocket } from "node:tls";
import type { LiveNetworkInterface } from "@world-studio/world-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_AUTH_RECEIPT_SCHEMA,
  LIVE_AUTH_SCHEME,
  LIVE_PAIRING_PERMISSIONS,
  LIVE_PAIRING_REQUEST_PAYLOAD_SCHEMA,
  canonicalLiveAuthJson,
  createPairingRequestEnvelope,
  decodePairingInvitationUri,
  identityIdFor,
  validatePairingGrantEnvelope
} from "./live-auth-contract.js";
import {
  LiveBonjourPublisher,
  type LiveBonjourChildProcess
} from "./live-bonjour.js";
import {
  DesktopIdentityStore,
  type SecretProtector
} from "./live-desktop-identity.js";
import { PairingStore } from "./live-pairing-store.js";
import {
  LIVE_AUTH_HEADERS,
  canonicalLiveRequestBytes
} from "./live-request-auth.js";
import { LiveSecureGateway } from "./live-secure-gateway.js";
import { LiveSessionReceiver } from "./live-session-receiver.js";

const roots: string[] = [];
const gateways: LiveSecureGateway[] = [];
const loopbackReceivers: LiveSessionReceiver[] = [];
const apiRoot = "/api/capture-splat/live/v0.1";
const pairingApiRoot = "/api/capture-splat/pairing/v0.1";
const emptySha256 = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const loopbackInterface: LiveNetworkInterface = {
  id: "lo0|IPv4|127.0.0.1",
  name: "lo0",
  address: "127.0.0.1",
  family: "IPv4"
};

afterEach(async () => {
  await Promise.all(gateways.splice(0).map(async (gateway) => {
    await gateway.stop().catch(() => undefined);
  }));
  await Promise.all(loopbackReceivers.splice(0).map(async (receiver) => {
    await receiver.stop().catch(() => undefined);
  }));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LiveSecureGateway", () => {
  it("pins TLS, holds pairing for approval, authenticates once, and fails closed on revocation", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-gateway-"));
    roots.push(root);
    let randomByte = 16;
    const gateway = new LiveSecureGateway({
      receiver: new LiveSessionReceiver({
        root: path.join(root, "live-sessions"),
        port: 0
      }),
      identityStore: new DesktopIdentityStore(path.join(root, "identity"), {
        secretProtector: new XorProtector()
      }),
      pairingStore: new PairingStore(path.join(root, "pairing")),
      bonjour: fakeBonjour(),
      listInterfaces: () => [loopbackInterface],
      now: () => now,
      random: (size) => Buffer.alloc(size, randomByte++),
      desktopName: "World Studio Test Mac",
      port: 0,
      pairingTtlMs: 30_000,
      pendingTtlMs: 30_000,
      grantTtlMs: 60_000,
      listenerLeaseMs: 60_000,
      interfacePollMs: 60_000,
      allowLoopbackForTests: true
    });
    gateways.push(gateway);

    const pairing = await gateway.beginPairing(loopbackInterface.id);
    const invitation = decodePairingInvitationUri(pairing.pairingInvitationUri);
    const listener = pairing.secureListening;
    expect(listener).toMatchObject({ host: "127.0.0.1", tls: true });
    expect(invitation.authority).toBe("proposal_only");
    expect(invitation.tls_certificate_sha256).toBe(pairing.tlsCertificateSha256);

    const pairingHealth = await tlsJsonRequest({
      port: listener!.port,
      path: `${pairingApiRoot}/health`,
      method: "GET"
    });
    expect(pairingHealth.statusCode).toBe(200);
    expect(pairingHealth.json).toMatchObject({
      schema: "capture_splat.live_pairing_health.v0.1",
      ok: true
    });
    expect(pairingHealth.peerCertificateSha256).toBe(invitation.tls_certificate_sha256);

    const device = deviceIdentity();
    const requestEnvelope = createPairingRequestEnvelope({
      schema: LIVE_PAIRING_REQUEST_PAYLOAD_SCHEMA,
      pairing_id: invitation.pairing_id,
      request_id: requestId(32),
      desktop_id: invitation.desktop_id,
      device_id: device.deviceId,
      device_name: "Capture Splat Test iPhone",
      device_public_key_b64u: device.publicKeyX963B64u,
      device_platform: "ios",
      device_app_version: "0.1-test",
      client_nonce_b64u: Buffer.alloc(16, 33).toString("base64url"),
      requested_permissions: [...LIVE_PAIRING_PERMISSIONS],
      created_at: now.toISOString(),
      authority: "proposal_only"
    }, device.privateKey, invitation.pairing_secret_b64u);
    const pairingBody = canonicalLiveAuthJson(requestEnvelope);
    const pendingResponse = tlsJsonRequest({
      port: listener!.port,
      path: `${pairingApiRoot}/requests`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(pairingBody.byteLength)
      },
      body: pairingBody
    });
    let pendingSettled = false;
    void pendingResponse.then(
      () => {
        pendingSettled = true;
      },
      () => {
        pendingSettled = true;
      }
    );

    const pending = await waitForState(gateway, "pairing_pending");
    expect(pending.pendingDevice).toMatchObject({
      deviceId: device.deviceId,
      displayName: "Capture Splat Test iPhone"
    });
    expect(pendingSettled).toBe(false);

    await gateway.approvePairing();
    const grantResponse = await pendingResponse;
    expect(grantResponse.statusCode).toBe(200);
    const grant = validatePairingGrantEnvelope(
      grantResponse.json,
      invitation.desktop_public_key_b64u
    ).payload;
    expect(grant).toMatchObject({
      pairing_id: invitation.pairing_id,
      desktop_id: invitation.desktop_id,
      device_id: device.deviceId,
      tls_certificate_sha256: invitation.tls_certificate_sha256,
      authority: "proposal_only"
    });
    const repeatedPairing = await tlsJsonRequest({
      port: listener!.port,
      path: `${pairingApiRoot}/requests`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(pairingBody.byteLength)
      },
      body: pairingBody
    });
    expect(repeatedPairing.json).toEqual(grantResponse.json);
    const changedPairingBody = canonicalLiveAuthJson({
      ...requestEnvelope,
      invitation_proof_b64u: Buffer.alloc(32, 99).toString("base64url")
    });
    const conflictingPairing = await tlsJsonRequest({
      port: listener!.port,
      path: `${pairingApiRoot}/requests`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(changedPairingBody.byteLength)
      },
      body: changedPairingBody
    });
    expect(conflictingPairing).toMatchObject({
      statusCode: 409,
      json: {
        schema: "capture_splat.live_auth_error.v0.1",
        code: "pairing_consumed",
        retryable: false
      }
    });

    const stopUpdates: Array<Awaited<ReturnType<LiveSecureGateway["status"]>>> = [];
    const unsubscribe = gateway.subscribe((snapshot) => stopUpdates.push(snapshot));
    await gateway.stop();
    unsubscribe();
    expect(stopUpdates.at(-1)).toMatchObject({
      state: "paired",
      secureListening: null
    });

    const restartedGateway = new LiveSecureGateway({
      receiver: new LiveSessionReceiver({
        root: path.join(root, "live-sessions"),
        port: 0
      }),
      identityStore: new DesktopIdentityStore(path.join(root, "identity"), {
        secretProtector: new XorProtector()
      }),
      pairingStore: new PairingStore(path.join(root, "pairing")),
      bonjour: fakeBonjour(),
      listInterfaces: () => [loopbackInterface],
      now: () => now,
      desktopName: "World Studio Test Mac",
      port: 0,
      listenerLeaseMs: 60_000,
      interfacePollMs: 60_000,
      allowLoopbackForTests: true
    });
    gateways.push(restartedGateway);
    const restarted = await restartedGateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId: grant.grant_id
    });
    const livePort = restarted.secureListening!.port;
    const durableRetry = await tlsJsonRequest({
      port: livePort,
      path: `${pairingApiRoot}/requests`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(pairingBody.byteLength)
      },
      body: pairingBody
    });
    expect(durableRetry.json).toEqual(grantResponse.json);

    const liveHealth = signedLiveHealth({
      desktopId: invitation.desktop_id,
      deviceId: device.deviceId,
      grantId: grant.grant_id,
      privateKey: device.privateKey,
      counter: "1",
      requestTime: now.toISOString()
    });
    const authenticated = await tlsJsonRequest({
      port: livePort,
      path: liveHealth.path,
      method: "GET",
      headers: liveHealth.headers
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json).toMatchObject({
      schema: "capture_splat.live_receiver_health.v0.1",
      ok: true,
      receiver: {
        authority: "proposal_only"
      }
    });

    const replay = await tlsJsonRequest({
      port: livePort,
      path: liveHealth.path,
      method: "GET",
      headers: liveHealth.headers
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json).toEqual({
      schema: "capture_splat.live_auth_error.v0.1",
      code: "request_replayed",
      retryable: false
    });

    const unauthenticated = await tlsJsonRequest({
      port: livePort,
      path: `${apiRoot}/health`,
      method: "GET",
      headers: { "content-length": "0" }
    });
    expect(unauthenticated.statusCode).toBe(400);
    expect(unauthenticated.json).toEqual({
      schema: "capture_splat.live_auth_error.v0.1",
      code: "invalid_request",
      retryable: true
    });

    const revoked = await restartedGateway.revokeGrant(grant.grant_id);
    expect(revoked).toMatchObject({
      state: "loopback_only",
      secureListening: null
    });
    expect(revoked.pairedDevices).toEqual([
      expect.objectContaining({
        deviceId: device.deviceId,
        grantId: grant.grant_id,
        revokedAt: now.toISOString()
      })
    ]);
    await expect(restartedGateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId: grant.grant_id
    })).rejects.toThrow(/unavailable or revoked/);
    await expect(tlsJsonRequest({
      port: livePort,
      path: `${apiRoot}/health`,
      method: "GET",
      headers: liveHealth.headers
    })).rejects.toThrow();
  }, 20_000);

  it("serializes simultaneous pairing requests without replacing the displayed pending device", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-pairing-race-"));
    roots.push(root);
    const gateway = new LiveSecureGateway({
      receiver: new LiveSessionReceiver({ root: path.join(root, "live-sessions"), port: 0 }),
      identityStore: new DesktopIdentityStore(path.join(root, "identity"), {
        secretProtector: new XorProtector()
      }),
      pairingStore: new PairingStore(path.join(root, "pairing")),
      bonjour: fakeBonjour(),
      listInterfaces: () => [loopbackInterface],
      now: () => now,
      random: (size) => Buffer.alloc(size, 44),
      desktopName: "World Studio Pairing Race Mac",
      port: 0,
      pairingTtlMs: 30_000,
      pendingTtlMs: 30_000,
      listenerLeaseMs: 60_000,
      interfacePollMs: 60_000,
      allowLoopbackForTests: true
    });
    gateways.push(gateway);
    const pairing = await gateway.beginPairing(loopbackInterface.id);
    const invitation = decodePairingInvitationUri(pairing.pairingInvitationUri);
    const firstDevice = deviceIdentity();
    const secondDevice = deviceIdentity();
    const firstBody = pairingRequestBody(invitation, firstDevice, requestId(45), 45, now);
    const secondBody = pairingRequestBody(invitation, secondDevice, requestId(46), 46, now);
    const send = (body: Buffer) => tlsJsonRequest({
      port: pairing.secureListening!.port,
      path: `${pairingApiRoot}/requests`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(body.byteLength)
      },
      body
    });
    const firstResponse = send(firstBody);
    const secondResponse = send(secondBody);
    const pending = await waitForState(gateway, "pairing_pending");
    const firstWon = pending.pendingDevice?.deviceId === firstDevice.deviceId;
    expect(pending.pendingDevice?.deviceId).toBe(
      firstWon ? firstDevice.deviceId : secondDevice.deviceId
    );
    const rejected = await withTimeout(firstWon ? secondResponse : firstResponse, 2_000);
    expect(rejected).toMatchObject({
      statusCode: 409,
      json: {
        code: "pairing_consumed",
        retryable: false
      }
    });
    await gateway.rejectPairing();
    const displayed = await withTimeout(firstWon ? firstResponse : secondResponse, 2_000);
    expect(displayed).toMatchObject({
      statusCode: 403,
      json: {
        code: "permission_denied",
        retryable: false
      }
    });
  }, 20_000);

  it("serializes ephemeral pairing starts and stops without an orphan invitation or listener", async () => {
    await expectConcurrentPairingLifecycle(0, "ephemeral");
  }, 20_000);

  it("serializes fixed-port pairing starts without the EADDRINUSE state race", async () => {
    await expectConcurrentPairingLifecycle(await unusedFixedPort(), "fixed");
  }, 20_000);

  it("ignores a stale listener failure queued behind stop and restart", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-lifecycle-stale-"));
    roots.push(root);
    const gateway = secureGateway({
      receiver: new LiveSessionReceiver({ root: path.join(root, "live-sessions"), port: 0 }),
      identityStore: new DesktopIdentityStore(path.join(root, "identity"), {
        secretProtector: new XorProtector()
      }),
      pairingStore: new PairingStore(path.join(root, "pairing")),
      now
    });
    gateways.push(gateway);
    await gateway.beginPairing(loopbackInterface.id);

    const stop = gateway.stopPairedReceiver();
    const restart = gateway.beginPairing(loopbackInterface.id);
    const staleFailure = (
      gateway as unknown as { failClosed(message: string): Promise<void> }
    ).failClosed("Expired listener callback.");
    await Promise.all([stop, restart, staleFailure]);

    const current = await gateway.status();
    expect(current).toMatchObject({
      state: "pairing",
      secureListening: { host: "127.0.0.1", tls: true },
      pairingInvitationUri: expect.stringMatching(/^capture-splat:\/\/pair\//)
    });
    expect(current.error).toBeUndefined();
    expect((await tlsJsonRequest({
      port: current.secureListening!.port,
      path: `${pairingApiRoot}/health`,
      method: "GET"
    })).statusCode).toBe(200);
  }, 20_000);

  it("serializes fixed-port paired start, revoke, and stop transitions", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-lifecycle-fixed-"));
    roots.push(root);
    const fixedPort = await unusedFixedPort();
    const identityStore = new DesktopIdentityStore(path.join(root, "identity"), {
      secretProtector: new XorProtector()
    });
    const identity = await identityStore.loadOrCreate();
    const pairingStore = new PairingStore(path.join(root, "pairing"));
    const device = deviceIdentity();
    const grantId = `csg_${Buffer.alloc(16, 47).toString("base64url")}`;
    await registerTestGrant(pairingStore, identity, device, grantId, now);
    const gateway = secureGateway({
      receiver: new LiveSessionReceiver({ root: path.join(root, "live-sessions"), port: 0 }),
      identityStore,
      pairingStore,
      now,
      port: fixedPort
    });
    gateways.push(gateway);

    const [started, stopped] = await Promise.all([
      gateway.startPairedReceiver({
        interfaceId: loopbackInterface.id,
        grantId
      }),
      gateway.stopPairedReceiver()
    ]);
    expect(started).toMatchObject({
      state: "secure_listening",
      secureListening: { host: "127.0.0.1", port: fixedPort, tls: true },
      pairingInvitationUri: null
    });
    expect(stopped).toMatchObject({
      state: "paired",
      secureListening: null,
      pairingInvitationUri: null
    });
    await expect(tlsJsonRequest({
      port: fixedPort,
      path: `${apiRoot}/health`,
      method: "GET"
    })).rejects.toThrow();

    await gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    });
    const [revoked, finalStop] = await Promise.all([
      gateway.revokeGrant(grantId),
      gateway.stopPairedReceiver()
    ]);
    for (const snapshot of [revoked, finalStop, await gateway.status()]) {
      expect(snapshot).toMatchObject({
        state: "loopback_only",
        secureListening: null,
        pairingInvitationUri: null
      });
    }
    expect(revoked.pairedDevices).toEqual([
      expect.objectContaining({
        deviceId: device.deviceId,
        grantId,
        revokedAt: now.toISOString()
      })
    ]);
    await expect(tlsJsonRequest({
      port: fixedPort,
      path: `${apiRoot}/health`,
      method: "GET"
    })).rejects.toThrow();
    await expect(gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    })).rejects.toThrow(/unavailable or revoked/);
  }, 20_000);

  it("rejects a durable grant after the desktop identity is reset", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-identity-reset-"));
    roots.push(root);
    const originalIdentity = await new DesktopIdentityStore(path.join(root, "identity-original"), {
      secretProtector: new XorProtector()
    }).loadOrCreate();
    const pairingStore = new PairingStore(path.join(root, "pairing"));
    const device = deviceIdentity();
    const grantId = `csg_${Buffer.alloc(16, 62).toString("base64url")}`;
    await pairingStore.registerDevice({
      deviceId: device.deviceId,
      displayName: "Capture Splat Identity Test",
      publicKeyX963B64u: device.publicKeyX963B64u,
      pairedAt: new Date(now.getTime() - 1_000).toISOString(),
      grant: {
        grantId,
        desktopId: originalIdentity.desktopId,
        tlsCertificateSha256: originalIdentity.certificateSha256,
        scopes: [...LIVE_PAIRING_PERMISSIONS],
        issuedAt: new Date(now.getTime() - 1_000).toISOString(),
        notBefore: new Date(now.getTime() - 1_000).toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString()
      }
    });
    const gateway = secureGateway({
      receiver: new LiveSessionReceiver({ root: path.join(root, "live-sessions"), port: 0 }),
      identityStore: new DesktopIdentityStore(path.join(root, "identity-reset"), {
        secretProtector: new XorProtector()
      }),
      pairingStore,
      now
    });
    gateways.push(gateway);

    await expect(gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    })).rejects.toThrow(/different desktop identity/);
    expect((await gateway.status()).secureListening).toBeNull();
  }, 20_000);

  it("stops and emits a fresh snapshot when the active grant expires", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-grant-expiry-"));
    roots.push(root);
    const identityStore = new DesktopIdentityStore(path.join(root, "identity"), {
      secretProtector: new XorProtector()
    });
    const identity = await identityStore.loadOrCreate();
    const pairingStore = new PairingStore(path.join(root, "pairing"));
    const device = deviceIdentity();
    const issuedAt = new Date();
    const grantId = `csg_${Buffer.alloc(16, 63).toString("base64url")}`;
    await pairingStore.registerDevice({
      deviceId: device.deviceId,
      displayName: "Capture Splat Expiry Test",
      publicKeyX963B64u: device.publicKeyX963B64u,
      pairedAt: issuedAt.toISOString(),
      grant: {
        grantId,
        desktopId: identity.desktopId,
        tlsCertificateSha256: identity.certificateSha256,
        scopes: [...LIVE_PAIRING_PERMISSIONS],
        issuedAt: issuedAt.toISOString(),
        notBefore: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 1_000).toISOString()
      }
    });
    const gateway = new LiveSecureGateway({
      receiver: new LiveSessionReceiver({ root: path.join(root, "live-sessions"), port: 0 }),
      identityStore,
      pairingStore,
      bonjour: fakeBonjour(),
      listInterfaces: () => [loopbackInterface],
      now: () => new Date(),
      desktopName: "World Studio Expiry Test Mac",
      port: 0,
      listenerLeaseMs: 60_000,
      interfacePollMs: 60_000,
      allowLoopbackForTests: true
    });
    gateways.push(gateway);
    const updates: Array<Awaited<ReturnType<LiveSecureGateway["status"]>>> = [];
    gateway.subscribe((snapshot) => updates.push(snapshot));

    expect((await gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    })).state).toBe("secure_listening");
    await waitForSecureStop(gateway);
    expect(updates.at(-1)).toMatchObject({
      state: "loopback_only",
      secureListening: null,
      error: "Pairing grant expired."
    });
  }, 20_000);

  it("redacts an active loopback session from authenticated health and status", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-loopback-isolation-"));
    roots.push(root);
    const receiver = new LiveSessionReceiver({
      root: path.join(root, "live-sessions"),
      port: 0
    });
    loopbackReceivers.push(receiver);
    const loopback = await receiver.start();
    const loopbackSessionId = "loopback-private-session";
    const loopbackResponse = await fetch(
      `http://${loopback.listening!.host}:${loopback.listening!.port}${apiRoot}/sessions/${loopbackSessionId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: liveSessionBody(loopbackSessionId)
      }
    );
    expect(loopbackResponse.status).toBe(200);
    expect(await receiver.status()).toMatchObject({
      sessionId: loopbackSessionId,
      expectedCount: 2
    });

    const identityStore = new DesktopIdentityStore(path.join(root, "identity"), {
      secretProtector: new XorProtector()
    });
    const identity = await identityStore.loadOrCreate();
    const pairingStore = new PairingStore(path.join(root, "pairing"));
    const device = deviceIdentity();
    const grantId = `csg_${Buffer.alloc(16, 64).toString("base64url")}`;
    await registerTestGrant(pairingStore, identity, device, grantId, now);
    const gateway = secureGateway({ receiver, identityStore, pairingStore, now });
    gateways.push(gateway);
    const listening = await gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    });
    const auth = {
      desktopId: identity.desktopId,
      deviceId: device.deviceId,
      grantId,
      privateKey: device.privateKey,
      requestTime: now.toISOString()
    };
    const health = await tlsJsonRequest({
      port: listening.secureListening!.port,
      path: signedLiveHealth({ ...auth, counter: "0" }).path,
      method: "GET",
      headers: signedLiveHealth({ ...auth, counter: "0" }).headers
    });
    expect(health.json).toMatchObject({
      receiver: {
        state: "listening",
        sessionId: null,
        sourceManifestId: null,
        receivedCount: 0,
        frames: []
      }
    });
    expect(JSON.stringify(health.json)).not.toContain(loopbackSessionId);

    const status = await signedTlsRequest(listening.secureListening!.port, signedLiveRequest({
      ...auth,
      counter: "1",
      requestIdByte: 65,
      method: "GET",
      path: `${apiRoot}/status`,
      contentType: "-",
      body: Buffer.alloc(0)
    }));
    expect(status.json).toMatchObject({
      state: "listening",
      sessionId: null,
      sourceManifestId: null,
      receivedCount: 0,
      frames: []
    });
    expect(JSON.stringify(status.json)).not.toContain(loopbackSessionId);
  }, 20_000);

  it("redacts another paired device's session and still rejects its session route", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-device-isolation-"));
    roots.push(root);
    const identityStore = new DesktopIdentityStore(path.join(root, "identity"), {
      secretProtector: new XorProtector()
    });
    const identity = await identityStore.loadOrCreate();
    const pairingStore = new PairingStore(path.join(root, "pairing"));
    const firstDevice = deviceIdentity();
    const secondDevice = deviceIdentity();
    const firstGrant = `csg_${Buffer.alloc(16, 66).toString("base64url")}`;
    const secondGrant = `csg_${Buffer.alloc(16, 67).toString("base64url")}`;
    await registerTestGrant(pairingStore, identity, firstDevice, firstGrant, now);
    await registerTestGrant(pairingStore, identity, secondDevice, secondGrant, now);
    const receiver = new LiveSessionReceiver({
      root: path.join(root, "live-sessions"),
      port: 0
    });
    const gateway = secureGateway({ receiver, identityStore, pairingStore, now });
    gateways.push(gateway);
    const firstListening = await gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId: firstGrant
    });
    const privateSessionId = "first-device-private-session";
    const firstAuth = {
      desktopId: identity.desktopId,
      deviceId: firstDevice.deviceId,
      grantId: firstGrant,
      privateKey: firstDevice.privateKey,
      requestTime: now.toISOString()
    };
    expect((await signedTlsRequest(firstListening.secureListening!.port, signedLiveRequest({
      ...firstAuth,
      counter: "0",
      requestIdByte: 68,
      method: "PUT",
      path: `${apiRoot}/sessions/${privateSessionId}`,
      contentType: "application/json",
      body: liveSessionBody(privateSessionId)
    }))).statusCode).toBe(200);
    await gateway.stop();

    const secondListening = await gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId: secondGrant
    });
    const secondAuth = {
      desktopId: identity.desktopId,
      deviceId: secondDevice.deviceId,
      grantId: secondGrant,
      privateKey: secondDevice.privateKey,
      requestTime: now.toISOString()
    };
    const status = await signedTlsRequest(secondListening.secureListening!.port, signedLiveRequest({
      ...secondAuth,
      counter: "0",
      requestIdByte: 69,
      method: "GET",
      path: `${apiRoot}/status`,
      contentType: "-",
      body: Buffer.alloc(0)
    }));
    expect(status.json).toMatchObject({
      sessionId: null,
      sourceManifestId: null,
      expectedCount: null,
      receivedCount: 0,
      frames: []
    });
    expect(JSON.stringify(status.json)).not.toContain(privateSessionId);
    expect(await receiver.status()).toMatchObject({ sessionId: privateSessionId });

    const crossOwner = await signedTlsRequest(secondListening.secureListening!.port, signedLiveRequest({
      ...secondAuth,
      counter: "1",
      requestIdByte: 70,
      method: "GET",
      path: `${apiRoot}/sessions/${privateSessionId}`,
      contentType: "-",
      body: Buffer.alloc(0)
    }));
    expect(crossOwner).toMatchObject({
      statusCode: 403,
      json: {
        code: "session_owner_mismatch",
        retryable: false
      }
    });
  }, 20_000);

  it("recovers a missing registry owner only from the durable authenticated receipt", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-owner-recovery-"));
    roots.push(root);
    const liveRoot = path.join(root, "live-sessions");
    const identityStore = new DesktopIdentityStore(path.join(root, "identity"), {
      secretProtector: new XorProtector()
    });
    const identity = await identityStore.loadOrCreate();
    const pairingStore = new PairingStore(path.join(root, "pairing"));
    const device = deviceIdentity();
    const grantId = `csg_${Buffer.alloc(16, 71).toString("base64url")}`;
    await registerTestGrant(pairingStore, identity, device, grantId, now);
    const sessionId = "receipt-recovery-session";
    const receipt = {
      schema: LIVE_AUTH_RECEIPT_SCHEMA,
      session_id: sessionId,
      desktop_id: identity.desktopId,
      device_id: device.deviceId,
      grant_id: grantId,
      pairing_epoch: 1,
      permissions: [...LIVE_PAIRING_PERMISSIONS],
      auth_scheme: LIVE_AUTH_SCHEME,
      tls_certificate_sha256: identity.certificateSha256,
      authenticated_at: new Date(now.getTime() - 1_000).toISOString(),
      grant_expires_at: new Date(now.getTime() + 60_000).toISOString(),
      authority: "proposal_only" as const
    };
    const initialReceiver = new LiveSessionReceiver({ root: liveRoot, port: 0 });
    await initialReceiver.store.putSession(
      JSON.parse(liveSessionBody(sessionId).toString("utf8")),
      receipt
    );
    await expect(pairingStore.assertSessionOwner(sessionId, device.deviceId))
      .rejects.toMatchObject({ code: "not_found" });

    const restartedReceiver = new LiveSessionReceiver({ root: liveRoot, port: 0 });
    const gateway = secureGateway({
      receiver: restartedReceiver,
      identityStore,
      pairingStore: new PairingStore(path.join(root, "pairing")),
      now
    });
    gateways.push(gateway);
    const listening = await gateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    });
    const recovered = await signedTlsRequest(listening.secureListening!.port, signedLiveRequest({
      desktopId: identity.desktopId,
      deviceId: device.deviceId,
      grantId,
      privateKey: device.privateKey,
      requestTime: now.toISOString(),
      counter: "0",
      requestIdByte: 72,
      method: "GET",
      path: `${apiRoot}/sessions/${sessionId}`,
      contentType: "-",
      body: Buffer.alloc(0)
    }));
    expect(recovered.json).toMatchObject({
      operation: "resume",
      status: "accepted",
      session_id: sessionId
    });
    await expect(new PairingStore(path.join(root, "pairing")).assertSessionOwner(
      sessionId,
      device.deviceId
    )).resolves.toBeUndefined();
  }, 20_000);

  it("resumes an authenticated evidence session after restart and finalizes with provenance", async () => {
    const now = new Date();
    const root = await mkdtemp(path.join(tmpdir(), "world-studio-secure-resume-"));
    roots.push(root);
    const liveRoot = path.join(root, "live-sessions");
    const identityStore = new DesktopIdentityStore(path.join(root, "identity"), {
      secretProtector: new XorProtector()
    });
    const identity = await identityStore.loadOrCreate();
    const pairingStore = new PairingStore(path.join(root, "pairing"));
    const device = deviceIdentity();
    const grantId = `csg_${Buffer.alloc(16, 61).toString("base64url")}`;
    await pairingStore.registerDevice({
      deviceId: device.deviceId,
      displayName: "Capture Splat Resume iPhone",
      publicKeyX963B64u: device.publicKeyX963B64u,
      pairedAt: new Date(now.getTime() - 1_000).toISOString(),
      grant: {
        grantId,
        desktopId: identity.desktopId,
        tlsCertificateSha256: identity.certificateSha256,
        scopes: [...LIVE_PAIRING_PERMISSIONS],
        issuedAt: new Date(now.getTime() - 1_000).toISOString(),
        notBefore: new Date(now.getTime() - 1_000).toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString()
      }
    });
    const firstReceiver = new LiveSessionReceiver({ root: liveRoot, port: 0 });
    const firstGateway = secureGateway({
      receiver: firstReceiver,
      identityStore,
      pairingStore,
      now
    });
    gateways.push(firstGateway);
    const firstListening = await firstGateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    });
    const firstPort = firstListening.secureListening!.port;
    const auth = {
      desktopId: identity.desktopId,
      deviceId: device.deviceId,
      grantId,
      privateKey: device.privateKey,
      requestTime: now.toISOString()
    };

    const malformedSession = signedLiveRequest({
      ...auth,
      counter: "0",
      requestIdByte: 69,
      method: "PUT",
      path: `${apiRoot}/sessions/secure-session`,
      contentType: "application/json",
      body: Buffer.from("{}")
    });
    expect((await signedTlsRequest(firstPort, malformedSession)).statusCode).toBe(400);
    await expect(pairingStore.assertSessionOwner("secure-session", device.deviceId))
      .rejects.toMatchObject({ code: "not_found" });
    expect((await signedTlsRequest(firstPort, malformedSession)).json).toMatchObject({
      code: "request_replayed",
      retryable: false
    });

    const sessionBody = liveSessionBody();
    expect((await signedTlsRequest(firstPort, signedLiveRequest({
      ...auth,
      counter: "1",
      requestIdByte: 70,
      method: "PUT",
      path: `${apiRoot}/sessions/secure-session`,
      contentType: "application/json",
      body: sessionBody
    }))).json).toMatchObject({ operation: "session", status: "accepted" });
    await waitForReceiverState(firstReceiver, "interrupted");

    const keepAliveAgent = new HttpsAgent({
      keepAlive: true,
      rejectUnauthorized: false,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3"
    });
    const liveResume = await signedTlsRequest(firstPort, signedLiveRequest({
      ...auth,
      counter: "100",
      requestIdByte: 100,
      method: "GET",
      path: `${apiRoot}/sessions/secure-session`,
      contentType: "-",
      body: Buffer.alloc(0)
    }), keepAliveAgent);
    expect(liveResume.json).toMatchObject({ operation: "resume", status: "accepted" });
    await waitForReceiverState(firstReceiver, "resuming");
    keepAliveAgent.destroy();
    await waitForReceiverState(firstReceiver, "interrupted");

    const source2 = Buffer.from("secure-frame-two");
    const frame2Body = liveFrameBody(2, source2);
    await signedTlsRequest(firstPort, signedLiveRequest({
      ...auth,
      counter: "2",
      requestIdByte: 71,
      method: "PUT",
      path: `${apiRoot}/sessions/secure-session/frames/2`,
      contentType: "application/json",
      body: frame2Body
    }));
    const pending = await signedTlsRequest(firstPort, signedLiveRequest({
      ...auth,
      counter: "3",
      requestIdByte: 72,
      method: "PUT",
      path: `${apiRoot}/sessions/secure-session/frames/2/assets/source`,
      contentType: "image/jpeg",
      body: source2
    }));
    expect(pending.json).toMatchObject({
      received_count: 1,
      contiguous_count: 0,
      missing_ranges: [{ start: 1, end: 1 }]
    });

    await firstGateway.stop();
    expect(await firstReceiver.status()).toMatchObject({ state: "interrupted", receivedCount: 1 });

    const restartedReceiver = new LiveSessionReceiver({ root: liveRoot, port: 0 });
    const restartedGateway = secureGateway({
      receiver: restartedReceiver,
      identityStore,
      pairingStore: new PairingStore(path.join(root, "pairing")),
      now
    });
    gateways.push(restartedGateway);
    const restartedListening = await restartedGateway.startPairedReceiver({
      interfaceId: loopbackInterface.id,
      grantId
    });
    const restartedPort = restartedListening.secureListening!.port;
    const resume = await signedTlsRequest(restartedPort, signedLiveRequest({
      ...auth,
      counter: "4",
      requestIdByte: 73,
      method: "GET",
      path: `${apiRoot}/sessions/secure-session`,
      contentType: "-",
      body: Buffer.alloc(0)
    }));
    expect(resume.json).toMatchObject({
      operation: "resume",
      received_count: 1,
      missing_ranges: [{ start: 1, end: 1 }]
    });

    const source1 = Buffer.from("secure-frame-one");
    const frame1Body = liveFrameBody(1, source1);
    const corruptedBody = Buffer.from(frame1Body);
    corruptedBody[corruptedBody.byteLength - 1] = corruptedBody.at(-1) === 0x7d ? 0x20 : 0x7d;
    const corrupted = signedLiveRequest({
      ...auth,
      counter: "5",
      requestIdByte: 74,
      method: "PUT",
      path: `${apiRoot}/sessions/secure-session/frames/1`,
      contentType: "application/json",
      body: frame1Body
    });
    const corruptResponse = await signedTlsRequest(restartedPort, {
      ...corrupted,
      body: corruptedBody
    });
    expect(corruptResponse).toMatchObject({
      statusCode: 401,
      json: {
        schema: "capture_splat.live_auth_error.v0.1",
        code: "body_digest_mismatch",
        retryable: true
      }
    });

    await signedTlsRequest(restartedPort, signedLiveRequest({
      ...auth,
      counter: "6",
      requestIdByte: 75,
      method: "PUT",
      path: `${apiRoot}/sessions/secure-session/frames/1`,
      contentType: "application/json",
      body: frame1Body
    }));
    const contiguous = await signedTlsRequest(restartedPort, signedLiveRequest({
      ...auth,
      counter: "7",
      requestIdByte: 76,
      method: "PUT",
      path: `${apiRoot}/sessions/secure-session/frames/1/assets/source`,
      contentType: "image/jpeg",
      body: source1
    }));
    expect(contiguous.json).toMatchObject({
      received_count: 2,
      contiguous_count: 2,
      missing_ranges: []
    });

    const finalizeBody = Buffer.from(JSON.stringify({
      schema: "capture_splat.live_finalize.v0.1",
      session_id: "secure-session",
      final_sequence_id: 2
    }));
    const finalized = await signedTlsRequest(restartedPort, signedLiveRequest({
      ...auth,
      counter: "8",
      requestIdByte: 77,
      method: "POST",
      path: `${apiRoot}/sessions/secure-session/finalize`,
      contentType: "application/json",
      body: finalizeBody
    }));
    expect(finalized.json).toMatchObject({ finalized: true, status: "finalized" });
    const duplicateFinalize = await signedTlsRequest(restartedPort, signedLiveRequest({
      ...auth,
      counter: "9",
      requestIdByte: 78,
      method: "POST",
      path: `${apiRoot}/sessions/secure-session/finalize`,
      contentType: "application/json",
      body: finalizeBody
    }));
    expect(duplicateFinalize.json).toMatchObject({ finalized: true, status: "finalized" });

    const sessionRoot = path.join(liveRoot, "secure-session");
    const receipt = JSON.parse(await readFile(path.join(sessionRoot, "auth-receipt.json"), "utf8"));
    expect(receipt).toMatchObject({
      schema: "capture_splat.live_auth_receipt.v0.1",
      desktop_id: identity.desktopId,
      device_id: device.deviceId,
      grant_id: grantId,
      authority: "proposal_only"
    });
    const handoff = JSON.parse(
      await readFile(path.join(sessionRoot, "capture-splat.world-studio.json"), "utf8")
    );
    expect(handoff).toMatchObject({
      session_id: "secure-session",
      live_auth_receipt: "auth-receipt.json",
      live_auth_receipt_sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      final_sequence_id: 2,
      authority: "proposal_only"
    });
  }, 20_000);
});

class XorProtector implements SecretProtector {
  async protect(plaintext: Buffer): Promise<Buffer> {
    return xor(plaintext);
  }

  async unprotect(protectedBytes: Buffer): Promise<Buffer> {
    return xor(protectedBytes);
  }
}

class FakeBonjourChild extends EventEmitter implements LiveBonjourChildProcess {
  kill(_signal?: NodeJS.Signals): boolean {
    return true;
  }
}

function fakeBonjour(): LiveBonjourPublisher {
  return new LiveBonjourPublisher({
    spawnProcess: () => new FakeBonjourChild()
  });
}

function xor(value: Buffer): Buffer {
  return Buffer.from(value.map((byte) => byte ^ 0xa5));
}

function deviceIdentity(): {
  deviceId: string;
  publicKeyX963B64u: string;
  privateKey: KeyObject;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1"
  });
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Generated test key is missing P-256 coordinates.");
  const publicKeyX963B64u = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url")
  ]).toString("base64url");
  return {
    deviceId: identityIdFor(publicKeyX963B64u, "device"),
    publicKeyX963B64u,
    privateKey
  };
}

function pairingRequestBody(
  invitation: ReturnType<typeof decodePairingInvitationUri>,
  device: ReturnType<typeof deviceIdentity>,
  pairingRequestId: string,
  nonceByte: number,
  now: Date
): Buffer {
  return canonicalLiveAuthJson(createPairingRequestEnvelope({
    schema: LIVE_PAIRING_REQUEST_PAYLOAD_SCHEMA,
    pairing_id: invitation.pairing_id,
    request_id: pairingRequestId,
    desktop_id: invitation.desktop_id,
    device_id: device.deviceId,
    device_name: `Capture Splat Race ${nonceByte}`,
    device_public_key_b64u: device.publicKeyX963B64u,
    device_platform: "ios",
    device_app_version: "0.1-test",
    client_nonce_b64u: Buffer.alloc(16, nonceByte).toString("base64url"),
    requested_permissions: [...LIVE_PAIRING_PERMISSIONS],
    created_at: now.toISOString(),
    authority: "proposal_only"
  }, device.privateKey, invitation.pairing_secret_b64u));
}

async function registerTestGrant(
  pairingStore: PairingStore,
  identity: { desktopId: string; certificateSha256: string },
  device: ReturnType<typeof deviceIdentity>,
  grantId: string,
  now: Date
): Promise<void> {
  const issuedAt = new Date(now.getTime() - 1_000).toISOString();
  await pairingStore.registerDevice({
    deviceId: device.deviceId,
    displayName: "Capture Splat Test Device",
    publicKeyX963B64u: device.publicKeyX963B64u,
    pairedAt: issuedAt,
    grant: {
      grantId,
      desktopId: identity.desktopId,
      tlsCertificateSha256: identity.certificateSha256,
      scopes: [...LIVE_PAIRING_PERMISSIONS],
      issuedAt,
      notBefore: issuedAt,
      expiresAt: new Date(now.getTime() + 60_000).toISOString()
    }
  });
}

function signedLiveHealth(input: {
  desktopId: string;
  deviceId: string;
  grantId: string;
  privateKey: KeyObject;
  counter: string;
  requestTime: string;
}): { path: string; headers: Record<string, string> } {
  const requestPath = `${apiRoot}/health`;
  const id = requestId(34);
  const canonical = canonicalLiveRequestBytes({
    desktopId: input.desktopId,
    deviceId: input.deviceId,
    grantId: input.grantId,
    counter: input.counter,
    requestId: id,
    requestTime: input.requestTime,
    method: "GET",
    canonicalPath: requestPath,
    contentType: "-",
    contentLength: 0,
    bodySha256: emptySha256
  });
  const signature = sign("sha256", canonical, {
    key: input.privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return {
    path: requestPath,
    headers: {
      "content-length": "0",
      [LIVE_AUTH_HEADERS.device]: input.deviceId,
      [LIVE_AUTH_HEADERS.grant]: input.grantId,
      [LIVE_AUTH_HEADERS.counter]: input.counter,
      [LIVE_AUTH_HEADERS.request]: id,
      [LIVE_AUTH_HEADERS.time]: input.requestTime,
      [LIVE_AUTH_HEADERS.contentSha256]: emptySha256,
      [LIVE_AUTH_HEADERS.signature]: signature
    }
  };
}

function secureGateway(input: {
  receiver: LiveSessionReceiver;
  identityStore: DesktopIdentityStore;
  pairingStore: PairingStore;
  now: Date;
  port?: number;
}): LiveSecureGateway {
  return new LiveSecureGateway({
    receiver: input.receiver,
    identityStore: input.identityStore,
    pairingStore: input.pairingStore,
    bonjour: fakeBonjour(),
    listInterfaces: () => [loopbackInterface],
    now: () => input.now,
    random: (size) => Buffer.alloc(size, 91),
    desktopName: "World Studio Secure Resume Mac",
    port: input.port ?? 0,
    listenerLeaseMs: 60_000,
    interfacePollMs: 60_000,
    allowLoopbackForTests: true
  });
}

async function expectConcurrentPairingLifecycle(
  port: number,
  label: "ephemeral" | "fixed"
): Promise<void> {
  const now = new Date();
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-secure-lifecycle-${label}-`));
  roots.push(root);
  const gateway = secureGateway({
    receiver: new LiveSessionReceiver({ root: path.join(root, "live-sessions"), port: 0 }),
    identityStore: new DesktopIdentityStore(path.join(root, "identity"), {
      secretProtector: new XorProtector()
    }),
    pairingStore: new PairingStore(path.join(root, "pairing")),
    now,
    port
  });
  gateways.push(gateway);

  const attempts = await Promise.allSettled([
    gateway.beginPairing(loopbackInterface.id),
    gateway.beginPairing(loopbackInterface.id)
  ]);
  const fulfilled = attempts.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<LiveSecureGateway["status"]>>> =>
      result.status === "fulfilled"
  );
  const rejected = attempts.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toEqual(expect.objectContaining({
    message: "A paired LAN listener is already active."
  }));
  const firstPort = fulfilled[0]!.value.secureListening!.port;
  expect(fulfilled[0]!.value).toMatchObject({
    state: "pairing",
    secureListening: { host: "127.0.0.1", ...(port === 0 ? {} : { port }), tls: true },
    pairingInvitationUri: expect.stringMatching(/^capture-splat:\/\/pair\//)
  });

  await gateway.stopPairedReceiver();
  const [restarted, stopped] = await Promise.all([
    gateway.beginPairing(loopbackInterface.id),
    gateway.stopPairedReceiver()
  ]);
  const secondPort = restarted.secureListening!.port;
  expect(stopped).toMatchObject({
    state: "loopback_only",
    secureListening: null,
    pairingInvitationUri: null
  });
  expect(await gateway.status()).toMatchObject({
    state: "loopback_only",
    secureListening: null,
    pairingInvitationUri: null
  });
  for (const closedPort of new Set([firstPort, secondPort])) {
    await expect(tlsJsonRequest({
      port: closedPort,
      path: `${pairingApiRoot}/health`,
      method: "GET"
    })).rejects.toThrow();
  }
}

function unusedFixedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a fixed lifecycle-test port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function signedLiveRequest(input: {
  desktopId: string;
  deviceId: string;
  grantId: string;
  privateKey: KeyObject;
  counter: string;
  requestIdByte: number;
  requestTime: string;
  method: "GET" | "POST" | "PUT";
  path: string;
  contentType: string;
  body: Buffer;
}): {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
} {
  const bodySha256 = sha256(input.body);
  const id = requestId(input.requestIdByte);
  const canonical = canonicalLiveRequestBytes({
    desktopId: input.desktopId,
    deviceId: input.deviceId,
    grantId: input.grantId,
    counter: input.counter,
    requestId: id,
    requestTime: input.requestTime,
    method: input.method,
    canonicalPath: input.path,
    contentType: input.contentType,
    contentLength: input.body.byteLength,
    bodySha256
  });
  const signature = sign("sha256", canonical, {
    key: input.privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return {
    path: input.path,
    method: input.method,
    headers: {
      "content-length": String(input.body.byteLength),
      ...(input.contentType === "-" ? {} : { "content-type": input.contentType }),
      [LIVE_AUTH_HEADERS.device]: input.deviceId,
      [LIVE_AUTH_HEADERS.grant]: input.grantId,
      [LIVE_AUTH_HEADERS.counter]: input.counter,
      [LIVE_AUTH_HEADERS.request]: id,
      [LIVE_AUTH_HEADERS.time]: input.requestTime,
      [LIVE_AUTH_HEADERS.contentSha256]: bodySha256,
      [LIVE_AUTH_HEADERS.signature]: signature
    },
    body: input.body
  };
}

function signedTlsRequest(
  port: number,
  request: ReturnType<typeof signedLiveRequest>,
  agent?: HttpsAgent
): Promise<TlsJsonResponse> {
  return tlsJsonRequest({
    port,
    path: request.path,
    method: request.method,
    headers: request.headers,
    body: request.body,
    ...(agent ? { agent } : {})
  });
}

function liveSessionBody(sessionId = "secure-session"): Buffer {
  return Buffer.from(JSON.stringify({
    schema: "capture_splat.live_session.v0.1",
    session_id: sessionId,
    created_at: "2026-07-29T10:30:00Z",
    source_manifest: {
      path: "capture.json",
      sha256: sha256(Buffer.from("secure-manifest")),
      size_bytes: 15,
      schema: "capture_splat.v0.3"
    },
    expected_frame_count: 2,
    coordinate_system: {
      id: "arkit_world",
      units: "meters",
      handedness: "right",
      world_up: "+Y",
      camera_forward: "-Z",
      matrix_layout: "row-major",
      vector_convention: "column-vector"
    },
    authority: "proposal_only"
  }));
}

function liveFrameBody(sequenceId: number, bytes: Buffer): Buffer {
  return Buffer.from(JSON.stringify({
    schema: "capture_splat.live_frame.v0.1",
    session_id: "secure-session",
    sequence_id: sequenceId,
    timestamp: {
      value: sequenceId * 0.25,
      clock_domain: "arkit_session"
    },
    source_frame: {
      path: `rgb/frame-${sequenceId}.jpg`,
      sha256: sha256(bytes),
      size_bytes: bytes.byteLength,
      media_type: "image/jpeg",
      width: 20,
      height: 10
    },
    intrinsics: {
      model: "pinhole",
      fl_x: 5,
      fl_y: 5,
      cx: 5,
      cy: 2.5,
      calibration_width: 10,
      calibration_height: 5,
      applies_to: "depth"
    },
    camera_to_world: [
      1, 0, 0, sequenceId,
      0, 1, 0, 0,
      0, 0, 1, -sequenceId,
      0, 0, 0, 1
    ],
    coordinate_frame: "arkit_world",
    tracking: { state: "normal" },
    quality: { accepted: true }
  }));
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function requestId(byte: number): string {
  return `csr_${Buffer.alloc(16, byte).toString("base64url")}`;
}

async function waitForState(
  gateway: LiveSecureGateway,
  state: "pairing_pending"
): Promise<Awaited<ReturnType<LiveSecureGateway["status"]>>> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const snapshot = await gateway.status();
    if (snapshot.state === state) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for gateway state ${state}.`);
}

async function waitForSecureStop(gateway: LiveSecureGateway): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if ((await gateway.status()).secureListening === null) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the secure listener to stop.");
}

async function waitForReceiverState(
  receiver: LiveSessionReceiver,
  state: "interrupted" | "resuming"
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if ((await receiver.status()).state === state) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for receiver state ${state}.`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for HTTP response.")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface TlsJsonResponse {
  statusCode: number;
  json: unknown;
  peerCertificateSha256: string;
}

function tlsJsonRequest(input: {
  port: number;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: Buffer;
  agent?: HttpsAgent;
}): Promise<TlsJsonResponse> {
  return new Promise((resolve, reject) => {
    let peerCertificateSha256 = "";
    const options: RequestOptions = {
      hostname: "127.0.0.1",
      port: input.port,
      path: input.path,
      method: input.method,
      headers: input.headers,
      rejectUnauthorized: false,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      agent: input.agent ?? false
    };
    const request = httpsRequest(options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.once("error", reject);
      response.once("end", () => {
        try {
          const bytes = Buffer.concat(chunks);
          resolve({
            statusCode: response.statusCode ?? 0,
            json: JSON.parse(bytes.toString("utf8")) as unknown,
            peerCertificateSha256
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
    request.once("socket", (socket) => {
      socket.once("secureConnect", () => {
        const certificate = (socket as TLSSocket).getPeerCertificate(true);
        if (!certificate.raw) {
          request.destroy(new Error("TLS peer did not provide a certificate."));
          return;
        }
        peerCertificateSha256 = `sha256:${createHash("sha256")
          .update(certificate.raw)
          .digest("hex")}`;
      });
    });
    request.end(input.body);
  });
}
