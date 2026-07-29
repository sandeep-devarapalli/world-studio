import { describe, expect, it } from "vitest";
import {
  assertTrustedRendererInvocation,
  isTrustedRendererUrl,
  trustedRendererUrl
} from "./renderer-security.js";

describe("desktop renderer security boundary", () => {
  it("accepts the configured renderer entry and fragment-only navigation", () => {
    const trustedUrl = trustedRendererUrl("http://127.0.0.1:5173");
    expect(trustedUrl).toBe("http://127.0.0.1:5173/");
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/#simulate", trustedUrl)).toBe(true);
    expect(isTrustedRendererUrl("file:///Applications/World%20Studio/index.html#simulate", "file:///Applications/World%20Studio/index.html")).toBe(true);
  });

  it.each([
    "http://127.0.0.1:5174/",
    "http://localhost:5173/",
    "http://127.0.0.1:5173/other.html",
    "http://127.0.0.1:5173/?redirect=https://example.com",
    "http://user:password@127.0.0.1:5173/"
  ])("rejects untrusted dev navigation %s", (value) => {
    expect(isTrustedRendererUrl(value, "http://127.0.0.1:5173/")).toBe(false);
  });

  it("rejects sibling packaged files and unsupported renderer schemes", () => {
    expect(isTrustedRendererUrl(
      "file:///Applications/World%20Studio/other.html",
      "file:///Applications/World%20Studio/index.html"
    )).toBe(false);
    expect(() => trustedRendererUrl("javascript:alert(1)")).toThrow("renderer URL is invalid");
    expect(() => trustedRendererUrl("http://127.0.0.1:5173/?unsafe=1")).toThrow("query or fragment");
  });

  it("rejects iframe and untrusted URL IPC invocations", () => {
    expect(() => assertTrustedRendererInvocation({
      isMainFrame: false,
      senderUrl: "http://127.0.0.1:5173/",
      trustedUrl: "http://127.0.0.1:5173/"
    })).toThrow("trusted World Studio renderer");
    expect(() => assertTrustedRendererInvocation({
      isMainFrame: true,
      senderUrl: "https://attacker.invalid/",
      trustedUrl: "http://127.0.0.1:5173/"
    })).toThrow("trusted World Studio renderer");
  });

  it("accepts only a trusted main-frame IPC invocation", () => {
    expect(() => assertTrustedRendererInvocation({
      isMainFrame: true,
      senderUrl: "file:///Applications/World%20Studio/index.html#live",
      trustedUrl: "file:///Applications/World%20Studio/index.html"
    })).not.toThrow();
  });
});
