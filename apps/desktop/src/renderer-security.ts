export interface TrustedRendererInvocation {
  isMainFrame: boolean;
  senderUrl: string;
  trustedUrl: string;
}

export function trustedRendererUrl(value: string): string {
  const url = parseRendererUrl(value);
  if (url.search || url.hash) {
    throw new Error("The World Studio renderer URL cannot include a query or fragment.");
  }
  return url.href;
}

export function isTrustedRendererUrl(value: string, trustedValue: string): boolean {
  try {
    const url = parseRendererUrl(value);
    const trustedUrl = parseRendererUrl(trustedValue);
    return url.protocol === trustedUrl.protocol
      && url.hostname === trustedUrl.hostname
      && url.port === trustedUrl.port
      && url.pathname === trustedUrl.pathname
      && url.search === trustedUrl.search;
  } catch {
    return false;
  }
}

export function assertTrustedRendererInvocation(input: TrustedRendererInvocation): void {
  if (!input.isMainFrame || !isTrustedRendererUrl(input.senderUrl, input.trustedUrl)) {
    throw new Error("Live security IPC is restricted to the trusted World Studio renderer.");
  }
}

function parseRendererUrl(value: string): URL {
  const url = new URL(value);
  if (!["file:", "http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The World Studio renderer URL is invalid.");
  }
  return url;
}
