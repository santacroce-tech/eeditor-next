// The app on the WebAssembly engine: `?engine=wasm` swaps the dev bridge's engine for the one
// compiled to WebAssembly and running in the page. Needs `npm run engine:wasm` first; skipped
// without it. The workspace (files) still comes from the bridge — only the engine moves.

import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const built = existsSync("public/engine/eelisp_web_bg.wasm");

test.skip(!built, "no WebAssembly engine — run `npm run engine:wasm`");

async function evalRepl(page, src) {
  await page.locator(".repl-input").fill(src);
  await page.locator(".repl-input").press(`${MOD}+Enter`);
}

test("the REPL runs on the WebAssembly engine", async ({ page }) => {
  const wasmLoaded = page.waitForResponse((r) => r.url().endsWith("/engine/eelisp_web_bg.wasm"));
  await page.goto("/?engine=wasm");
  await page.waitForSelector(".repl-input");

  await evalRepl(page, "(+ 1 2)");
  await expect(page.locator(".repl-scrollback .result-scalar").last()).toHaveText("3");
  expect((await wasmLoaded).status()).toBe(200);

  // it is the page's engine, not the bridge's: the browser build has no HTTP, and says so
  await evalRepl(page, '(http-get "https://example.com")');
  await expect(page.locator(".repl-scrollback").last()).toContainText("isn't available in this build");

  // SQLite, in the page
  await evalRepl(page, '(deftable pets (name:string)) (insert pets {:name "Rex"}) (count-records pets)');
  await expect(page.locator(".repl-scrollback .result-scalar").last()).toHaveText("1");
});

test("a form runs on the WebAssembly engine", async ({ page }) => {
  await page.goto("/?engine=wasm");
  await page.locator(".tree-file", { hasText: "Books.eeform" }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  const form = page.locator(".formrun-host");
  await form.locator(".formrun-menu", { hasText: "Record" }).click();
  await form.locator(".formrun-menuitem", { hasText: "Add sample books" }).click();
  await expect(form.locator(".formrun-ctl[data-name=lblPos]")).toHaveText("Record 1 of 3");
  await form.locator(".formrun-ctl[data-name=btnNext] button").click();
  await expect(form.locator(".formrun-ctl[data-name=txtAuthor] input")).toHaveValue("Abelson & Sussman");
});
