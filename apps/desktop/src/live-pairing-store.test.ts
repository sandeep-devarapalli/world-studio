import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PairingStore,
  deviceIdFor,
  type LiveGrantScope,
  type RegisterPairedDeviceInput
} from "./live-pairing-store.js";

const roots: string[] = [];
const desktopId = `wsd_${Buffer.alloc(32, 1).toString("base64url")}`;
const tlsCertificateSha256 = `sha256:${"a".repeat(64)}`;
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

describe("PairingStore", () => {
  it("enforces grant validity, scope, and revocation", async () => {
    const store = new PairingStore(await tempRoot("grant"));
    const registration = deviceRegistration("phone-a", allScopes);
    const paired = await store.registerDevice(registration);
    expect(paired).toMatchObject({ deviceId: registration.deviceId, pairingEpoch: 1, revokedAt: null });

    await expect(store.getGrant(registration.deviceId, registration.grant.grantId, {
      now: new Date("2026-07-29T10:30:00.000Z"),
      requiredScope: "asset:put",
      desktopId,
      tlsCertificateSha256
    })).resolves.toMatchObject({
      pairingEpoch: 1,
      replayHighestCounter: "0",
      desktopId,
      tlsCertificateSha256
    });
    await expect(store.getGrant(registration.deviceId, registration.grant.grantId, {
      now: new Date("2026-07-29T10:30:00.000Z"),
      desktopId: `wsd_${Buffer.alloc(32, 2).toString("base64url")}`,
      tlsCertificateSha256
    })).rejects.toMatchObject({ code: "identity" });
    await expect(store.getGrant(registration.deviceId, registration.grant.grantId, {
      now: new Date("2026-07-29T10:30:00.000Z"),
      desktopId,
      tlsCertificateSha256: `sha256:${"b".repeat(64)}`
    })).rejects.toMatchObject({ code: "identity" });
    await expect(store.getGrant(registration.deviceId, registration.grant.grantId, {
      now: new Date("2026-07-29T09:59:59.999Z")
    })).rejects.toMatchObject({ code: "expired" });
    await expect(store.getGrant(registration.deviceId, registration.grant.grantId, {
      now: new Date("2026-07-30T00:00:00.000Z")
    })).rejects.toMatchObject({ code: "expired" });

    await store.revoke(registration.deviceId, "2026-07-29T11:00:00.000Z");
    await expect(store.getGrant(registration.deviceId, registration.grant.grantId, {
      now: new Date("2026-07-29T11:00:01.000Z")
    })).rejects.toMatchObject({ code: "revoked" });
    expect((await store.list())[0]).toMatchObject({ revokedAt: "2026-07-29T11:00:00.000Z", pairingEpoch: 2 });
  });

  it("persists a bounded UInt64 replay window across restart", async () => {
    const root = await tempRoot("replay");
    const registration = deviceRegistration("phone-a", allScopes);
    const store = new PairingStore(root);
    await store.registerDevice(registration);
    const options = {
      now: new Date("2026-07-29T10:30:00.000Z"),
      requiredScope: "frame:put" as const
    };

    await expect(store.reserveCounter(registration.deviceId, registration.grant.grantId, "0", options))
      .resolves.toMatchObject({ replayHighestCounter: "0" });
    await expect(store.reserveCounter(registration.deviceId, registration.grant.grantId, "0", options))
      .rejects.toMatchObject({ code: "replay" });
    await expect(store.reserveCounter(registration.deviceId, registration.grant.grantId, "1", options))
      .resolves.toMatchObject({ replayHighestCounter: "1" });
    await expect(store.reserveCounter(registration.deviceId, registration.grant.grantId, "3", options))
      .resolves.toMatchObject({ replayHighestCounter: "3" });
    await expect(store.reserveCounter(registration.deviceId, registration.grant.grantId, "2", options))
      .resolves.toMatchObject({ replayHighestCounter: "3" });
    await expect(store.reserveCounter(registration.deviceId, registration.grant.grantId, "2", options))
      .rejects.toMatchObject({ code: "replay" });

    const restarted = new PairingStore(root);
    await expect(restarted.reserveCounter(registration.deviceId, registration.grant.grantId, "3", options))
      .rejects.toMatchObject({ code: "replay" });
    await expect(restarted.reserveCounter(registration.deviceId, registration.grant.grantId, "300", options))
      .resolves.toMatchObject({ replayHighestCounter: "300" });
    await expect(restarted.reserveCounter(registration.deviceId, registration.grant.grantId, "44", options))
      .rejects.toMatchObject({ code: "replay" });
    await expect(restarted.reserveCounter(registration.deviceId, registration.grant.grantId, "18446744073709551616", options))
      .rejects.toThrow(/UInt64/);
  });

  it("requires canonical millisecond timestamps and scope ordering", async () => {
    const store = new PairingStore(await tempRoot("canonical-registration"));
    const registration = deviceRegistration("phone-a", allScopes);
    expect(() => store.registerDevice({
      ...registration,
      pairedAt: "2026-07-29T10:00:00Z"
    })).toThrow(/RFC 3339/);
    expect(() => store.registerDevice({
      ...registration,
      pairedAt: "0000-07-29T10:00:00.000Z"
    })).toThrow(/RFC 3339/);
    expect(() => store.registerDevice({
      ...registration,
      grant: {
        ...registration.grant,
        scopes: [...registration.grant.scopes].reverse()
      }
    })).toThrow(/canonical order/);
    await store.registerDevice(registration);
    const statePath = path.join(store.root, "pairing-registry.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      devices: Array<{ grants: Array<{ scopes: LiveGrantScope[] }> }>;
    };
    state.devices[0]!.grants[0]!.scopes.reverse();
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    await expect(new PairingStore(store.root).initialize())
      .rejects.toThrow(/canonical order/);
  });

  it("binds a session to one device and preserves ownership across re-pairing", async () => {
    const store = new PairingStore(await tempRoot("owner"));
    const first = deviceRegistration("phone-a", allScopes);
    const second = deviceRegistration("phone-b", allScopes);
    await store.registerDevice(first);
    await store.registerDevice(second);
    await store.bindSessionOwner("room-session", first.deviceId, "2026-07-29T10:15:00.000Z");
    await expect(store.assertSessionOwner("room-session", first.deviceId)).resolves.toBeUndefined();
    await expect(store.bindSessionOwner("room-session", second.deviceId))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(store.assertSessionOwner("room-session", second.deviceId))
      .rejects.toMatchObject({ code: "conflict" });

    await expect(store.registerDevice(first)).rejects.toMatchObject({ code: "conflict" });
    await store.registerDevice({
      ...first,
      grant: {
        ...first.grant,
        grantId: `csg_${Buffer.alloc(16, 7).toString("base64url")}`
      }
    });
    await expect(store.assertSessionOwner("room-session", first.deviceId)).resolves.toBeUndefined();
  });

  it("fails closed on registry corruption and symlinks", async () => {
    const corruptRoot = await tempRoot("corrupt");
    const store = new PairingStore(corruptRoot);
    await store.registerDevice(deviceRegistration("phone-a", allScopes));
    const statePath = path.join(corruptRoot, "pairing-registry.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    state.unexpected = true;
    await writeFile(statePath, JSON.stringify(state));
    await expect(new PairingStore(corruptRoot).initialize()).rejects.toMatchObject({ code: "corrupt" });

    const symlinkRoot = await tempRoot("symlink");
    const outside = path.join(await tempRoot("outside"), "registry.json");
    await writeFile(outside, "{}");
    await symlink(outside, path.join(symlinkRoot, "pairing-registry.json"));
    await expect(new PairingStore(symlinkRoot).initialize()).rejects.toThrow(/regular file/);
  });
});

function deviceRegistration(name: string, scopes: LiveGrantScope[]): RegisterPairedDeviceInput {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const publicKeyBytes = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from(jwk.y!, "base64url")
  ]);
  return {
    deviceId: deviceIdFor(publicKeyBytes),
    displayName: name,
    publicKeyX963B64u: publicKeyBytes.toString("base64url"),
    pairedAt: "2026-07-29T10:00:00.000Z",
    grant: {
      grantId: `csg_${createGrantIdBytes(name).toString("base64url")}`,
      desktopId,
      tlsCertificateSha256,
      scopes,
      issuedAt: "2026-07-29T10:00:00.000Z",
      notBefore: "2026-07-29T10:00:00.000Z",
      expiresAt: "2026-07-30T00:00:00.000Z"
    }
  };
}

function createGrantIdBytes(name: string): Buffer {
  return Buffer.from(name.padEnd(16, "\0").slice(0, 16), "utf8");
}

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-pairing-${label}-`));
  roots.push(root);
  return root;
}
