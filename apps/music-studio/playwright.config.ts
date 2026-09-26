import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  outputDir: "./test-results",
  fullyParallel: false,
  // Audio-enabled pages and cold Next compilations are expensive on local Docker hosts.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3210",
    colorScheme: "dark",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium", viewport: { width: 1024, height: 1366 } } }
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3210",
    url: "http://127.0.0.1:3210",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
