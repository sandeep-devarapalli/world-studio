import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  LIVE_BONJOUR_DOMAIN,
  LIVE_BONJOUR_EXECUTABLE,
  LIVE_BONJOUR_SERVICE_TYPE,
  LiveBonjourPublisher,
  buildLiveBonjourCommand,
  validateLiveBonjourTxt,
  type LiveBonjourChildProcess,
  type LiveBonjourTermination
} from "./live-bonjour.js";

const desktopId = `wsd_${Buffer.alloc(32).toString("base64url")}`;
const tlsFingerprint = `sha256:${"b".repeat(64)}`;

describe("LiveBonjourPublisher", () => {
  it("publishes one concrete secret-free registration through absolute dns-sd", () => {
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child);
    const publisher = new LiveBonjourPublisher({ spawnProcess });

    const command = publisher.start({
      port: 43127,
      interfaceName: "en0",
      mode: "pairing",
      desktopId,
      tlsCertificateSha256: tlsFingerprint
    });

    const expectedArgs = [
      "-i",
      "en0",
      "-R",
      "World Studio AAAAAAAA",
      LIVE_BONJOUR_SERVICE_TYPE,
      LIVE_BONJOUR_DOMAIN,
      "43127",
      "version=0.1",
      "mode=pairing",
      `desktop_id=${desktopId}`,
      `tls_fingerprint=${tlsFingerprint}`,
      "transport=https",
      "auth=p256-sha256"
    ];
    expect(command).toEqual({ executable: LIVE_BONJOUR_EXECUTABLE, args: expectedArgs });
    expect(spawnProcess).toHaveBeenCalledWith(LIVE_BONJOUR_EXECUTABLE, expectedArgs);
    expect(expectedArgs).not.toContain("-B");
    expect(expectedArgs).not.toContain("-L");
    expect(expectedArgs).not.toContain("-P");
    expect(publisher.active).toBe(true);
  });

  it("rejects secret, unknown, duplicate, malformed, and incomplete TXT records", () => {
    const valid = buildLiveBonjourCommand({
      port: 43127,
      interfaceName: "en0",
      mode: "paired",
      desktopId,
      tlsCertificateSha256: tlsFingerprint
    }).args.slice(7);

    expect(() => validateLiveBonjourTxt([...valid, "pairing_secret=do-not-advertise"]))
      .toThrow(/not public and allowlisted/);
    expect(() => validateLiveBonjourTxt([...valid, "mode=paired"]))
      .toThrow(/duplicated/);
    expect(() => validateLiveBonjourTxt(valid.filter((record) => !record.startsWith("auth="))))
      .toThrow(/auth is required/);
    expect(() => validateLiveBonjourTxt(valid.map((record) => (
      record.startsWith("desktop_id=") ? "desktop_id=not-a-checksum" : record
    )))).toThrow(/wsd_ P-256 identity/);
    expect(() => validateLiveBonjourTxt(valid.map((record) => (
      record.startsWith("mode=") ? "mode=pairing=secret" : record
    )))).toThrow(/one key=value separator/);
  });

  it("stops idempotently and ignores the expected child exit", () => {
    const child = new FakeChild();
    const onTermination = vi.fn();
    const publisher = new LiveBonjourPublisher({
      spawnProcess: () => child,
      onTermination
    });
    publisher.start({
      port: 43127,
      interfaceName: "en0",
      mode: "paired",
      desktopId,
      tlsCertificateSha256: tlsFingerprint
    });

    publisher.stop();
    publisher.stop();
    child.emit("exit", 0, "SIGTERM");

    expect(child.killSignals).toEqual(["SIGTERM"]);
    expect(publisher.active).toBe(false);
    expect(onTermination).not.toHaveBeenCalled();
  });

  it.each([
    {
      event: "error" as const,
      args: [new Error("dns-sd failed")] as const,
      expected: { reason: "error", error: expect.any(Error) }
    },
    {
      event: "exit" as const,
      args: [7, null] as const,
      expected: { reason: "exit", code: 7, signal: null }
    }
  ])("cleans up an unexpected child $event and permits restart", ({ event, args, expected }) => {
    const first = new FakeChild();
    const second = new FakeChild();
    const children = [first, second];
    const terminations: LiveBonjourTermination[] = [];
    const publisher = new LiveBonjourPublisher({
      spawnProcess: () => children.shift()!,
      onTermination: (termination) => terminations.push(termination)
    });
    const options = {
      port: 43127,
      interfaceName: "en0",
      mode: "pairing" as const,
      desktopId,
      tlsCertificateSha256: tlsFingerprint
    };

    publisher.start(options);
    first.emit(event, ...args);
    expect(publisher.active).toBe(false);
    expect(terminations).toEqual([expect.objectContaining(expected)]);

    publisher.start(options);
    expect(publisher.active).toBe(true);
    publisher.stop();
  });

  it("validates the complete command before starting a child", () => {
    const spawnProcess = vi.fn();
    const publisher = new LiveBonjourPublisher({ spawnProcess });

    expect(() => publisher.start({
      port: 0,
      interfaceName: "en0",
      mode: "pairing",
      desktopId,
      tlsCertificateSha256: tlsFingerprint
    })).toThrow(/port/);
    expect(() => publisher.start({
      port: 43127,
      interfaceName: "en0",
      mode: "pairing",
      desktopId: `wsd_${"A".repeat(42)}!`,
      tlsCertificateSha256: tlsFingerprint
    })).toThrow(/wsd_/);
    expect(() => publisher.start({
      port: 43127,
      interfaceName: "all",
      mode: "pairing",
      desktopId,
      tlsCertificateSha256: tlsFingerprint
    })).toThrow(/interfaceName/);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(publisher.active).toBe(false);
  });
});

class FakeChild extends EventEmitter implements LiveBonjourChildProcess {
  readonly killSignals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killSignals.push(signal);
    return true;
  }
}
