import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { LiveNetworkInterface } from "@world-studio/world-core";

export type NetworkInterfaceSource = NodeJS.Dict<NetworkInterfaceInfo[]>;

export function listPrivateLiveInterfaces(
  source: NetworkInterfaceSource = networkInterfaces()
): LiveNetworkInterface[] {
  const interfaces: LiveNetworkInterface[] = [];
  for (const [name, entries] of Object.entries(source)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4" || !isPrivateIpv4(entry.address)) continue;
      interfaces.push({
        id: `${name}|IPv4|${entry.address}`,
        name,
        address: entry.address,
        family: "IPv4"
      });
    }
  }
  return interfaces.sort((left, right) => (
    left.name.localeCompare(right.name) || left.address.localeCompare(right.address)
  ));
}

export function selectPrivateLiveInterface(
  interfaceId: string,
  source?: NetworkInterfaceSource
): LiveNetworkInterface {
  const selected = listPrivateLiveInterfaces(source).find((entry) => entry.id === interfaceId);
  if (!selected) throw new Error("The selected private network interface is no longer available.");
  return selected;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = parts as [number, number, number, number];
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
}
