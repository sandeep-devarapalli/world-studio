import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopIdentityError,
  DesktopIdentityStore,
  OpenSslSelfSignedCertificateIssuer,
  type SecretProtector
} from "./live-desktop-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopIdentityStore", () => {
  it("creates one protected P-256 identity and recovers the same pinned certificate", async () => {
    const root = await tempRoot("stable");
    const protector = new XorProtector();
    const store = new DesktopIdentityStore(root, {
      secretProtector: protector,
      certificateIssuer: new OpenSslSelfSignedCertificateIssuer()
    });

    const created = await store.loadOrCreate();
    const recovered = await new DesktopIdentityStore(root, {
      secretProtector: protector,
      certificateIssuer: {
        issueSelfSignedCertificate: async () => {
          throw new Error("recovery must not issue a new certificate");
        }
      }
    }).loadOrCreate();

    expect(created.desktopId).toMatch(/^wsd_[A-Za-z0-9_-]{43}$/);
    expect(created.publicKeyX963B64u).toHaveLength(87);
    expect(created.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(created.certificateSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(recovered).toEqual(created);
    expect(await readdir(root)).toEqual(["identity.json"]);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, "identity.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(root, "identity.json"), "utf8")).not.toContain("BEGIN PRIVATE KEY");
  });

  it("fails closed on changed identity metadata, protected bytes, and symlinks", async () => {
    const protector = new XorProtector();
    const corruptRoot = await tempRoot("corrupt");
    const store = new DesktopIdentityStore(corruptRoot, {
      secretProtector: protector,
      certificateIssuer: new OpenSslSelfSignedCertificateIssuer()
    });
    await store.loadOrCreate();
    const identityPath = path.join(corruptRoot, "identity.json");
    const stored = JSON.parse(await readFile(identityPath, "utf8")) as Record<string, unknown>;
    stored.desktop_id = `wsd_${"A".repeat(43)}`;
    await writeFile(identityPath, JSON.stringify(stored));
    await expect(new DesktopIdentityStore(corruptRoot, {
      secretProtector: protector,
      certificateIssuer: new OpenSslSelfSignedCertificateIssuer()
    }).loadOrCreate()).rejects.toMatchObject({ code: "corrupt" });

    const symlinkRoot = await tempRoot("symlink");
    const outside = path.join(await tempRoot("outside"), "identity.json");
    await writeFile(outside, "{}");
    await symlink(outside, path.join(symlinkRoot, "identity.json"));
    await expect(new DesktopIdentityStore(symlinkRoot, {
      secretProtector: protector,
      certificateIssuer: new OpenSslSelfSignedCertificateIssuer()
    }).loadOrCreate()).rejects.toThrow(/regular file/);
  });

  it("does not persist an identity when secret protection fails", async () => {
    const root = await tempRoot("protection");
    const protector: SecretProtector = {
      protect: async () => {
        throw new Error("keychain unavailable");
      },
      unprotect: async () => Buffer.alloc(0)
    };
    const store = new DesktopIdentityStore(root, {
      secretProtector: protector,
      certificateIssuer: new OpenSslSelfSignedCertificateIssuer()
    });
    await expect(store.loadOrCreate()).rejects.toEqual(expect.objectContaining<Partial<DesktopIdentityError>>({
      code: "protection_unavailable"
    }));
    expect(await readdir(root)).toEqual([]);
  });
});

class XorProtector implements SecretProtector {
  async protect(plaintext: Buffer): Promise<Buffer> {
    return xor(plaintext);
  }

  async unprotect(protectedBytes: Buffer): Promise<Buffer> {
    return xor(protectedBytes);
  }
}

function xor(value: Buffer): Buffer {
  return Buffer.from(value.map((byte) => byte ^ 0xa5));
}

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `world-studio-identity-${label}-`));
  roots.push(root);
  return root;
}
