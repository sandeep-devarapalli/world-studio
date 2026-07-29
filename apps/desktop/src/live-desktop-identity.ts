import {
  X509Certificate,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  type KeyObject
} from "node:crypto";
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
import { spawn } from "node:child_process";

const identitySchema = "capture_splat.desktop_identity.v0.1";
const desktopIdPattern = /^wsd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const maxIdentityBytes = 2 * 1024 * 1024;

export interface SecretProtector {
  protect(plaintext: Buffer): Promise<Buffer>;
  unprotect(protectedBytes: Buffer): Promise<Buffer>;
}

export interface CertificateIssueRequest {
  desktopId: string;
  privateKeyPem: string;
}

export interface SelfSignedCertificateIssuer {
  issueSelfSignedCertificate(request: CertificateIssueRequest): Promise<string>;
}

export interface DesktopIdentity {
  desktopId: string;
  publicKeyX963B64u: string;
  privateKeyPem: string;
  certificatePem: string;
  certificateSha256: string;
}

export interface DesktopIdentityStoreOptions {
  secretProtector: SecretProtector;
  certificateIssuer?: SelfSignedCertificateIssuer;
  now?: () => Date;
  randomId?: () => string;
}

interface StoredDesktopIdentity {
  schema: typeof identitySchema;
  desktop_id: string;
  public_key_x963_b64u: string;
  protected_private_key_b64u: string;
  certificate_pem: string;
  created_at: string;
}

export class DesktopIdentityError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "corrupt" | "protection_unavailable" | "certificate_error" = "invalid"
  ) {
    super(message);
    this.name = "DesktopIdentityError";
  }
}

export class DesktopIdentityStore {
  readonly root: string;
  private readonly identityPath: string;
  private readonly secretProtector: SecretProtector;
  private readonly certificateIssuer: SelfSignedCertificateIssuer;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private operation: Promise<DesktopIdentity> | null = null;

  constructor(root: string, options: DesktopIdentityStoreOptions) {
    if (!path.isAbsolute(root)) throw new DesktopIdentityError("Desktop identity root must be absolute.");
    this.root = path.resolve(root);
    this.identityPath = path.join(this.root, "identity.json");
    this.secretProtector = options.secretProtector;
    this.certificateIssuer = options.certificateIssuer ?? new OpenSslSelfSignedCertificateIssuer();
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  loadOrCreate(): Promise<DesktopIdentity> {
    if (this.operation) return this.operation;
    this.operation = this.loadOrCreateInternal().finally(() => {
      this.operation = null;
    });
    return this.operation;
  }

  private async loadOrCreateInternal(): Promise<DesktopIdentity> {
    await ensurePrivateDirectory(this.root);
    const existing = await readOptionalRegularFile(this.identityPath);
    if (existing !== null) return this.decodeStoredIdentity(existing);

    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeyX963 = publicKeyToX963(publicKey);
    const publicKeyX963B64u = publicKeyX963.toString("base64url");
    const desktopId = desktopIdFor(publicKeyX963);
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const certificatePem = await this.certificateIssuer.issueSelfSignedCertificate({
      desktopId,
      privateKeyPem
    });
    validateCertificate(certificatePem, privateKey, publicKeyX963, this.now());

    let protectedPrivateKey: Buffer;
    try {
      protectedPrivateKey = await this.secretProtector.protect(Buffer.from(privateKeyPem, "utf8"));
    } catch {
      throw new DesktopIdentityError(
        "The desktop identity private key could not be protected.",
        "protection_unavailable"
      );
    }
    if (!protectedPrivateKey.byteLength || protectedPrivateKey.byteLength > maxIdentityBytes) {
      throw new DesktopIdentityError("Secret protector returned an invalid payload.", "protection_unavailable");
    }

    const stored: StoredDesktopIdentity = {
      schema: identitySchema,
      desktop_id: desktopId,
      public_key_x963_b64u: publicKeyX963B64u,
      protected_private_key_b64u: protectedPrivateKey.toString("base64url"),
      certificate_pem: certificatePem,
      created_at: this.now().toISOString()
    };
    await atomicWritePrivateJson(this.identityPath, stored, this.randomId);
    return {
      desktopId,
      publicKeyX963B64u,
      privateKeyPem,
      certificatePem,
      certificateSha256: certificateSha256(certificatePem)
    };
  }

  private async decodeStoredIdentity(bytes: Buffer): Promise<DesktopIdentity> {
    if (bytes.byteLength > maxIdentityBytes) {
      throw new DesktopIdentityError("Desktop identity file exceeds its byte limit.", "corrupt");
    }
    const stored = parseStoredIdentity(bytes);
    const publicKeyX963 = decodeCanonicalBase64Url(
      stored.public_key_x963_b64u,
      "public_key_x963_b64u"
    );
    if (publicKeyX963.byteLength !== 65 || publicKeyX963[0] !== 4) {
      throw new DesktopIdentityError("Desktop identity public key is not P-256 X9.63.", "corrupt");
    }
    if (desktopIdFor(publicKeyX963) !== stored.desktop_id) {
      throw new DesktopIdentityError("Desktop identity ID does not match its public key.", "corrupt");
    }
    const protectedPrivateKey = decodeCanonicalBase64Url(
      stored.protected_private_key_b64u,
      "protected_private_key_b64u"
    );
    let plaintext: Buffer;
    try {
      plaintext = await this.secretProtector.unprotect(protectedPrivateKey);
    } catch {
      throw new DesktopIdentityError("Desktop identity private key could not be recovered.", "corrupt");
    }
    const privateKeyPem = plaintext.toString("utf8");
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey(privateKeyPem);
    } catch {
      throw new DesktopIdentityError("Desktop identity private key is invalid.", "corrupt");
    }
    if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new DesktopIdentityError("Desktop identity private key is not P-256.", "corrupt");
    }
    validateCertificate(stored.certificate_pem, privateKey, publicKeyX963, this.now(), "corrupt");
    return {
      desktopId: stored.desktop_id,
      publicKeyX963B64u: stored.public_key_x963_b64u,
      privateKeyPem,
      certificatePem: stored.certificate_pem,
      certificateSha256: certificateSha256(stored.certificate_pem)
    };
  }
}

export class OpenSslSelfSignedCertificateIssuer implements SelfSignedCertificateIssuer {
  constructor(
    private readonly executable = "/usr/bin/openssl",
    private readonly validityDays = 3650,
    private readonly timeoutMs = 15_000
  ) {
    if (this.executable !== "/usr/bin/openssl") {
      throw new DesktopIdentityError("Production certificate issuer must use /usr/bin/openssl.");
    }
    if (!Number.isSafeInteger(validityDays) || validityDays < 1) {
      throw new DesktopIdentityError("Certificate validityDays must be a positive integer.");
    }
  }

  issueSelfSignedCertificate(request: CertificateIssueRequest): Promise<string> {
    if (!desktopIdPattern.test(request.desktopId)) {
      return Promise.reject(new DesktopIdentityError("Certificate desktop ID is invalid."));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        [
          "req",
          "-new",
          "-x509",
          "-key",
          "/dev/stdin",
          "-sha256",
          "-days",
          String(this.validityDays),
          "-subj",
          `/CN=World Studio ${request.desktopId}`,
          "-addext",
          "basicConstraints=critical,CA:FALSE",
          "-addext",
          "keyUsage=critical,digitalSignature",
          "-addext",
          "extendedKeyUsage=serverAuth",
          "-addext",
          "subjectAltName=DNS:world-studio.local",
          "-out",
          "/dev/stdout"
        ],
        {
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          env: { PATH: "/usr/bin:/bin", LANG: "C" }
        }
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (error?: Error, certificate?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(certificate ?? "");
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new DesktopIdentityError("Certificate issuer timed out.", "certificate_error"));
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > maxIdentityBytes) {
          child.kill("SIGKILL");
          finish(new DesktopIdentityError("Certificate issuer output exceeded its byte limit.", "certificate_error"));
          return;
        }
        stdout.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.reduce((total, value) => total + value.byteLength, 0) < 16 * 1024) {
          stderr.push(Buffer.from(chunk));
        }
      });
      child.once("error", () => {
        finish(new DesktopIdentityError("Certificate issuer could not be started.", "certificate_error"));
      });
      child.once("close", (code) => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim().slice(0, 500);
          finish(new DesktopIdentityError(
            `Certificate issuer failed${detail ? `: ${detail}` : "."}`,
            "certificate_error"
          ));
          return;
        }
        const certificate = Buffer.concat(stdout).toString("utf8");
        if (!certificate.includes("-----BEGIN CERTIFICATE-----")) {
          finish(new DesktopIdentityError("Certificate issuer returned invalid output.", "certificate_error"));
          return;
        }
        finish(undefined, certificate);
      });
      child.stdin.once("error", () => {
        finish(new DesktopIdentityError("Certificate issuer rejected its private-key input.", "certificate_error"));
      });
      child.stdin.end(request.privateKeyPem);
    });
  }
}

export function desktopIdFor(publicKeyX963: Uint8Array): string {
  return `wsd_${createHash("sha256").update(publicKeyX963).digest("base64url")}`;
}

function publicKeyToX963(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new DesktopIdentityError("Generated desktop key is not P-256.");
  }
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.byteLength !== 32 || y.byteLength !== 32) {
    throw new DesktopIdentityError("Generated desktop key has invalid coordinates.");
  }
  return Buffer.concat([Buffer.from([4]), x, y]);
}

function validateCertificate(
  certificatePem: string,
  privateKey: KeyObject,
  expectedPublicKeyX963: Buffer,
  now: Date,
  errorCode: DesktopIdentityError["code"] = "certificate_error"
): void {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(certificatePem);
  } catch {
    throw new DesktopIdentityError("Desktop identity certificate is invalid.", errorCode);
  }
  if (!certificate.checkPrivateKey(privateKey) || !certificate.verify(certificate.publicKey)) {
    throw new DesktopIdentityError("Desktop identity certificate does not match its private key.", errorCode);
  }
  if (!publicKeyToX963(certificate.publicKey).equals(expectedPublicKeyX963)) {
    throw new DesktopIdentityError("Desktop identity certificate public key changed.", errorCode);
  }
  if (now.getTime() < Date.parse(certificate.validFrom) || now.getTime() > Date.parse(certificate.validTo)) {
    throw new DesktopIdentityError("Desktop identity certificate is outside its validity period.", errorCode);
  }
}

function certificateSha256(certificatePem: string): string {
  const certificate = new X509Certificate(certificatePem);
  return `sha256:${createHash("sha256").update(certificate.raw).digest("hex")}`;
}

function parseStoredIdentity(bytes: Buffer): StoredDesktopIdentity {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new DesktopIdentityError("Desktop identity file is not strict JSON.", "corrupt");
  }
  if (!isRecord(value)) throw new DesktopIdentityError("Desktop identity file must be an object.", "corrupt");
  exactKeys(value, [
    "schema",
    "desktop_id",
    "public_key_x963_b64u",
    "protected_private_key_b64u",
    "certificate_pem",
    "created_at"
  ]);
  if (value.schema !== identitySchema) throw new DesktopIdentityError("Desktop identity schema is unsupported.", "corrupt");
  if (typeof value.desktop_id !== "string" || !desktopIdPattern.test(value.desktop_id)) {
    throw new DesktopIdentityError("Desktop identity ID is invalid.", "corrupt");
  }
  for (const key of [
    "public_key_x963_b64u",
    "protected_private_key_b64u",
    "certificate_pem",
    "created_at"
  ] as const) {
    if (typeof value[key] !== "string" || !value[key]) {
      throw new DesktopIdentityError(`Desktop identity ${key} is invalid.`, "corrupt");
    }
  }
  if (!Number.isFinite(Date.parse(value.created_at as string))) {
    throw new DesktopIdentityError("Desktop identity created_at is invalid.", "corrupt");
  }
  return value as unknown as StoredDesktopIdentity;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const expected = new Set(keys);
  if (Object.keys(value).length !== expected.size || Object.keys(value).some((key) => !expected.has(key))) {
    throw new DesktopIdentityError("Desktop identity file contains unexpected fields.", "corrupt");
  }
}

function decodeCanonicalBase64Url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DesktopIdentityError(`Desktop identity ${label} is not base64url.`, "corrupt");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new DesktopIdentityError(`Desktop identity ${label} is not canonical base64url.`, "corrupt");
  }
  return decoded;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new DesktopIdentityError("Desktop identity root must be a real directory.", "corrupt");
  }
  await chmod(directory, 0o700);
}

async function readOptionalRegularFile(filePath: string): Promise<Buffer | null> {
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new DesktopIdentityError("Desktop identity file must be a regular file.", "corrupt");
    }
    return await readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWritePrivateJson(
  filePath: string,
  value: unknown,
  randomId: () => string
): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.identity-${randomId()}.tmp`);
  const data = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  try {
    const handle = await open(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.writeFile(data);
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
