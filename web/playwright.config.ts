import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3199",
    trace: "retain-on-failure",
    headless: true,
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    ...(process.env.PLAYWRIGHT_CHROME === "1" ? { channel: "chrome" } : {}),
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:3199/api/state",
    timeout: 120000,
    reuseExistingServer: false,
  },
});
