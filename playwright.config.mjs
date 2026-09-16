// The grid's tests: a real browser against the dev bridge and a real engine, because everything that
// makes a grid a grid — scrolling, clipboard, drag — only exists in one.
//
// Specs are `*.pw.mjs` so vitest, which claims `*.test.*` and `*.spec.*`, leaves them alone.

import { defineConfig } from "@playwright/test";

/** A workspace of its own, wiped before each run (dev/ui/setup.mjs). */
export const UI_WORKSPACE = ".ui-workspace";

export default defineConfig({
  testDir: "dev/ui",
  testMatch: "**/*.pw.mjs",
  globalSetup: "./dev/ui/setup.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? [["list"]] : [["list"]],
  use: { baseURL: "http://localhost:5173", trace: process.env.CI ? "retain-on-failure" : "off" },
  webServer: [
    {
      command: "node dev/bridge.mjs",
      port: 8787,
      env: { WORKSPACE_ROOT: UI_WORKSPACE },
      stdout: "pipe",
      reuseExistingServer: false,
    },
    { command: "npx vite --port 5173 --strictPort", port: 5173, reuseExistingServer: false },
  ],
});
