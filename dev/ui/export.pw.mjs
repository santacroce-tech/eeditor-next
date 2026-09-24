// Export as HTML: a form becomes one file that runs on its own — opened from disk, with the network
// off. Needs the runtime template: `npm run engine:wasm && npm run runtime:template`.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });
test.skip(!existsSync("public/runtime/eeform-runtime.html"), "no runtime template — run `npm run engine:wasm && npm run runtime:template`");

const ctl = (page, name) => page.locator(`.formrun-ctl[data-name=${name}]`);

async function exportFromTree(page, name, as = name) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: `${name}.eeform` }).click({ button: "right" });
  await page.locator(".ctx-menu .ctx-item", { hasText: "Export as HTML…" }).click();
  await expect(page.locator(".toast").last()).toContainText(`Exported ${as}.html`);
  const file = resolve(UI_WORKSPACE, "examples", `${as}.html`);
  expect(existsSync(file)).toBe(true);
  return file;
}

test("Books exported from the tree runs from disk, offline, and keeps what it's given", async ({ page, browser }) => {
  const file = await exportFromTree(page, "Books");
  const kb = statSync(file).size / 1024;
  expect(kb).toBeGreaterThan(1000); // the engine is inside
  expect(kb).toBeLessThan(2500);
  await expect(page.locator(".tree-file", { hasText: "Books.html" })).toBeVisible();

  // the page holds the form's source (and a megabyte of engine), but search reads it as empty
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Shift+f`);
  await page.locator(".search-panel .qo-input").fill("bk-mode!");
  await expect(page.locator(".search-loc").first()).toContainText("Books.eeform");
  await expect(page.locator(".search-loc", { hasText: "Books.html" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const ctx = await browser.newContext();
  await ctx.setOffline(true);
  const p = await ctx.newPage();
  const requests = [];
  p.on("request", (r) => !r.url().startsWith("file:") && !r.url().startsWith("blob:") && !r.url().startsWith("data:") && requests.push(r.url()));
  await p.goto("file://" + file);
  await expect(p).toHaveTitle("Books");
  await expect(ctl(p, "lblPos")).toHaveText("No records");
  await p.locator(".formrun-menu", { hasText: "Record" }).click();
  await p.locator(".formrun-menuitem", { hasText: "Add sample books" }).click();
  await expect(ctl(p, "lblPos")).toHaveText("Record 1 of 3");
  await ctl(p, "btnLast").locator("button").click();
  await expect(ctl(p, "txtAuthor").locator("input")).toHaveValue("Douglas Hofstadter");

  await p.reload();
  await expect(ctl(p, "lblPos")).toHaveText("Record 1 of 3");
  expect(requests).toEqual([]);
  await ctx.close();
});

test("exporting again makes a new file rather than writing over the first", async ({ page }) => {
  await exportFromTree(page, "Books", "Books-1"); // Books.html is taken by the test before
});

test("the Functions browser runs exported too — the whole language is in the file", async ({ page, browser }) => {
  const file = await exportFromTree(page, "Functions");
  const ctx = await browser.newContext();
  await ctx.setOffline(true);
  const p = await ctx.newPage();
  await p.goto("file://" + file);
  await ctl(p, "grdFns").locator(".formrun-filter").fill("str-join");
  await ctl(p, "grdFns").locator("tbody tr", { hasText: "str-join" }).first().click();
  await ctl(p, "txtArgs").locator("input").fill(`"-" '("a" "b")`);
  await ctl(p, "btnRun").locator("button").click();
  await expect(ctl(p, "txtResult").locator("textarea")).toHaveValue(/^a-b/);
  await ctx.close();
});
