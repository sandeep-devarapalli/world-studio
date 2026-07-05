import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "apps/web/tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "pnpm --filter @world-studio/web exec vite --host 127.0.0.1 --mode test",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
