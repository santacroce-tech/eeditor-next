// The grid's tests: a real browser against the dev bridge and a real engine, because everything that
// makes a grid a grid — scrolling, clipboard, drag — only exists in one.
//
// Specs are `*.pw.mjs` so vitest, which claims `*.test.*` and `*.spec.*`, leaves them alone.

import { defineConfig } from "@playwright/test";

/** A workspace of its own, wiped before each run (dev/ui/setup.mjs, run ahead of the bridge). */
export const UI_WORKSPACE = ".ui-workspace";
/** A folder that starts empty, for what a new folder gets (dev/ui/samples.pw.mjs), on its own bridge. */
export const UI_EMPTY = ".ui-empty";
export const EMPTY_URL = "http://localhost:5174";

export default defineConfig({
  testDir: "dev/ui",
  testMatch: "**/*.pw.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? [["list"]] : [["list"]],
  use: { baseURL: "http://localhost:5173", trace: process.env.CI ? "retain-on-failure" : "off" },
  webServer: [
    {
      command: "node dev/ui/setup.mjs && node dev/bridge.mjs",
      port: 8787,
      env: { WORKSPACE_ROOT: UI_WORKSPACE },
      stdout: "pipe",
      reuseExistingServer: false,
    },
    { command: "npx vite --port 5173 --strictPort", port: 5173, reuseExistingServer: false },
    {
      command: "node dev/ui/setup.mjs empty && node dev/bridge.mjs",
      port: 8788,
      env: { WORKSPACE_ROOT: UI_EMPTY, BRIDGE_PORT: "8788" },
      stdout: "pipe",
      reuseExistingServer: false,
    },
    {
      command: "npx vite --port 5174 --strictPort",
      port: 5174,
      env: { VITE_BRIDGE_URL: "http://localhost:8788" },
      reuseExistingServer: false,
    },
  ],
});
