import { describe, expect, it } from "vitest";
import {
  listPrivateLiveInterfaces,
  selectPrivateLiveInterface,
  type NetworkInterfaceSource
} from "./live-network-interfaces.js";

const source: NetworkInterfaceSource = {
  lo0: [entry("127.0.0.1", true)],
  en0: [entry("192.168.1.9"), entry("2001:db8::1", false, "IPv6")],
  en7: [entry("169.254.4.8")],
  utun3: [entry("10.20.30.40")],
  public0: [entry("203.0.113.5")]
};

describe("live network interface selection", () => {
  it("lists only concrete non-loopback private IPv4 addresses", () => {
    expect(listPrivateLiveInterfaces(source)).toEqual([
      { id: "en0|IPv4|192.168.1.9", name: "en0", address: "192.168.1.9", family: "IPv4" },
      { id: "en7|IPv4|169.254.4.8", name: "en7", address: "169.254.4.8", family: "IPv4" },
      { id: "utun3|IPv4|10.20.30.40", name: "utun3", address: "10.20.30.40", family: "IPv4" }
    ]);
  });

  it("resolves only an exact current interface ID", () => {
    expect(selectPrivateLiveInterface("en0|IPv4|192.168.1.9", source).address).toBe("192.168.1.9");
    expect(() => selectPrivateLiveInterface("en0|IPv4|0.0.0.0", source)).toThrow(/no longer available/);
    expect(() => selectPrivateLiveInterface("en0|IPv4|127.0.0.1", source)).toThrow(/no longer available/);
  });
});

function entry(
  address: string,
  internal = false,
  family: "IPv4" | "IPv6" = "IPv4"
): import("node:os").NetworkInterfaceInfo {
  return {
    address,
    netmask: family === "IPv4" ? "255.255.255.0" : "ffff:ffff:ffff:ffff::",
    family,
    mac: "00:00:00:00:00:00",
    internal,
    cidr: null
  };
}
