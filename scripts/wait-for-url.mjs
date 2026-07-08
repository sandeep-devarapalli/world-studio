const url = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 30_000);
const startedAt = Date.now();

if (!url) {
  console.error("usage: node scripts/wait-for-url.mjs <url> [timeoutMs]");
  process.exit(2);
}

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok || response.status < 500) process.exit(0);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

console.error(`timed out waiting for ${url}`);
process.exit(1);
