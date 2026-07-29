import { spawn } from "node:child_process";

export const LIVE_BONJOUR_EXECUTABLE = "/usr/bin/dns-sd";
export const LIVE_BONJOUR_SERVICE_TYPE = "_capturesplat._tcp";
export const LIVE_BONJOUR_DOMAIN = "local.";

const desktopIdPattern = /^wsd_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const requiredTxtKeys = [
  "version",
  "mode",
  "desktop_id",
  "tls_fingerprint",
  "transport",
  "auth"
] as const;

export type LiveBonjourMode = "pairing" | "paired";

export interface LiveBonjourRegistrationOptions {
  port: number;
  interfaceName: string;
  mode: LiveBonjourMode;
  desktopId: string;
  tlsCertificateSha256: string;
}

export interface LiveBonjourCommand {
  executable: typeof LIVE_BONJOUR_EXECUTABLE;
  args: string[];
}

export interface LiveBonjourChildProcess {
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type LiveBonjourSpawn = (
  executable: string,
  args: readonly string[]
) => LiveBonjourChildProcess;

export type LiveBonjourTermination =
  | { reason: "error"; error: Error }
  | { reason: "exit"; code: number | null; signal: NodeJS.Signals | null };

export interface LiveBonjourPublisherOptions {
  spawnProcess?: LiveBonjourSpawn;
  onTermination?: (termination: LiveBonjourTermination) => void;
}

export class LiveBonjourPublisher {
  private child: LiveBonjourChildProcess | null = null;
  private readonly spawnProcess: LiveBonjourSpawn;
  private readonly onTermination?: (termination: LiveBonjourTermination) => void;

  constructor(options: LiveBonjourPublisherOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawnDnsSd;
    this.onTermination = options.onTermination;
  }

  get active(): boolean {
    return this.child !== null;
  }

  start(options: LiveBonjourRegistrationOptions): LiveBonjourCommand {
    if (this.child) throw new Error("Capture Splat Bonjour service is already published.");
    const command = buildLiveBonjourCommand(options);
    const child = this.spawnProcess(command.executable, command.args);
    this.child = child;
    child.once("error", (error) => {
      this.clearUnexpectedChild(child, { reason: "error", error });
    });
    child.once("exit", (code, signal) => {
      this.clearUnexpectedChild(child, { reason: "exit", code, signal });
    });
    return command;
  }

  stop(): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    child.kill("SIGTERM");
  }

  private clearUnexpectedChild(
    child: LiveBonjourChildProcess,
    termination: LiveBonjourTermination
  ): void {
    if (this.child !== child) return;
    this.child = null;
    this.onTermination?.(termination);
  }
}

export function buildLiveBonjourCommand(
  options: LiveBonjourRegistrationOptions
): LiveBonjourCommand {
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("Bonjour service port must be an integer from 1 through 65535.");
  }
  const interfaceName = validateInterfaceName(options.interfaceName);
  const desktopId = validateDesktopId(options.desktopId, "desktopId");
  const tlsFingerprint = validateSha256(
    options.tlsCertificateSha256,
    "tlsCertificateSha256"
  );
  if (options.mode !== "pairing" && options.mode !== "paired") {
    throw new Error("Bonjour service mode must be pairing or paired.");
  }
  const txt = validateLiveBonjourTxt([
    "version=0.1",
    `mode=${options.mode}`,
    `desktop_id=${desktopId}`,
    `tls_fingerprint=${tlsFingerprint}`,
    "transport=https",
    "auth=p256-sha256"
  ]);
  const serviceName = liveBonjourServiceName(desktopId);
  return {
    executable: LIVE_BONJOUR_EXECUTABLE,
    args: [
      "-i",
      interfaceName,
      "-R",
      serviceName,
      LIVE_BONJOUR_SERVICE_TYPE,
      LIVE_BONJOUR_DOMAIN,
      String(options.port),
      ...txt
    ]
  };
}

function validateInterfaceName(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value)
    || value === "all"
  ) {
    throw new Error("Bonjour interfaceName must be one concrete Darwin network interface.");
  }
  return value;
}

export function validateLiveBonjourTxt(records: readonly string[]): string[] {
  const values = new Map<string, string>();
  for (const record of records) {
    if (record.includes("\0") || Buffer.byteLength(record, "utf8") > 255) {
      throw new Error("Bonjour TXT records must be non-null strings of at most 255 bytes.");
    }
    const separator = record.indexOf("=");
    if (separator < 1 || separator !== record.lastIndexOf("=")) {
      throw new Error("Bonjour TXT records must use one key=value separator.");
    }
    const key = record.slice(0, separator);
    const value = record.slice(separator + 1);
    if (!(requiredTxtKeys as readonly string[]).includes(key)) {
      throw new Error(`Bonjour TXT key ${key} is not public and allowlisted.`);
    }
    if (values.has(key)) throw new Error(`Bonjour TXT key ${key} is duplicated.`);
    values.set(key, value);
  }
  for (const key of requiredTxtKeys) {
    if (!values.has(key)) throw new Error(`Bonjour TXT key ${key} is required.`);
  }
  if (values.get("version") !== "0.1") throw new Error("Bonjour TXT version is invalid.");
  if (values.get("mode") !== "pairing" && values.get("mode") !== "paired") {
    throw new Error("Bonjour TXT mode is invalid.");
  }
  validateDesktopId(values.get("desktop_id"), "Bonjour TXT desktop_id");
  validateSha256(values.get("tls_fingerprint"), "Bonjour TXT tls_fingerprint");
  if (values.get("transport") !== "https") throw new Error("Bonjour TXT transport must be HTTPS.");
  if (values.get("auth") !== "p256-sha256") throw new Error("Bonjour TXT authentication is invalid.");
  return [...records];
}

export function liveBonjourServiceName(desktopId: string): string {
  const valid = validateDesktopId(desktopId, "desktopId");
  return `World Studio ${valid.slice(-8).toUpperCase()}`;
}

function validateDesktopId(value: unknown, label: string): string {
  if (typeof value !== "string" || !desktopIdPattern.test(value)) {
    throw new Error(`${label} must be a wsd_ P-256 identity.`);
  }
  return value;
}

function validateSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new Error(`${label} must be sha256 followed by 64 lowercase hexadecimal characters.`);
  }
  return value;
}

const spawnDnsSd: LiveBonjourSpawn = (executable, args) =>
  spawn(executable, [...args], {
    shell: false,
    stdio: "ignore"
  }) as LiveBonjourChildProcess;
