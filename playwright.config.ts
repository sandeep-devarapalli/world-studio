import { defineConfig, devices } from "@playwright/test";

const testPort = process.env.WORLD_STUDIO_TEST_PORT ?? "4173";
const testUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "apps/web/tests",
  timeout: 30_000,
  use: {
    baseURL: testUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `pnpm --filter @world-studio/web exec vite --host 127.0.0.1 --port ${testPort} --strictPort --mode test`,
    url: testUrl,
    reuseExistingServer: false
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
