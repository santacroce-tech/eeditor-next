// Export as HTML: a form becomes one file that runs on its own — opened from disk, with the network
// off. Needs the runtime template: `npm run engine:wasm && npm run runtime:template`.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });
test.skip(!existsSync("public/runtime/eeform-runtime.html"), "no runtime template — run `npm run engine:wasm && npm run runtime:template`");

const ctl = (page, name) => page.locator(`.formrun-ctl[data-name=${name}]`);

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Export from the tree: the panel opens; `pick` chooses "a new file" over replacing the last one. */
async function exportFromTree(page, name, as = name, pick) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: `${name}.eeform` }).click({ button: "right" });
  await page.locator(".ctx-menu .ctx-item", { hasText: "Export as HTML…" }).click();
  const panel = page.locator(".export-panel");
  await expect(panel).toBeVisible();
  if (pick) await panel.locator("label", { hasText: pick }).click();
  await panel.locator(".dlg-btn", { hasText: "Export" }).click();
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

test("exporting again offers to replace the last export, or to make a new file", async ({ page }) => {
  // Books.html is the export from the test before: replacing it is the panel's first answer
  const before = statSync(resolve(UI_WORKSPACE, "examples", "Books.html")).mtimeMs;
  await exportFromTree(page, "Books", "Books");
  expect(statSync(resolve(UI_WORKSPACE, "examples", "Books.html")).mtimeMs).toBeGreaterThan(before);
  // …or a new file beside it
  await exportFromTree(page, "Books", "Books-1", "a new file");
});

test("a page of your own with the export's name is never replaced", async ({ page }) => {
  writeFileSync(resolve(UI_WORKSPACE, "examples", "Orders.html"), "<!doctype html><title>my own page</title>\n");
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Orders.eeform" }).click({ button: "right" });
  await page.locator(".ctx-menu .ctx-item", { hasText: "Export as HTML…" }).click();
  const panel = page.locator(".export-panel");
  await expect(panel.locator("input[type=radio]")).toHaveCount(0); // nothing offered to replace
  await expect(panel).toContainText("examples/Orders-1.html");
  await panel.locator(".dlg-btn", { hasText: "Export" }).click();
  await expect(page.locator(".toast").last()).toContainText("Exported Orders-1.html");
  expect(readFileSync(resolve(UI_WORKSPACE, "examples", "Orders.html"), "utf8")).toContain("my own page");
});

test("the ⇪ export button shows what goes in; (ed-export …) exports without asking", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Office.eeform" }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .form-export").click();
  const panel = page.locator(".export-panel");
  await expect(panel.locator(".main-form")).toHaveText("Office (main)");
  for (const f of ["Books", "Orders", "Tables", "Agenda", "Functions"]) await expect(panel).toContainText(f);
  await expect(panel).toContainText(/about 1\.\d MB/);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(existsSync(resolve(UI_WORKSPACE, "examples", "Office.html"))).toBe(false); // cancelled: nothing written

  await page.locator(".repl-input").fill('(ed-export "examples/Tables")');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await expect(page.locator(".toast").last()).toContainText("Exported Tables.html");
  await expect(panel).toHaveCount(0);
  expect(existsSync(resolve(UI_WORKSPACE, "examples", "Tables.html"))).toBe(true);
  // with no name: the form in front
  await page.locator(".repl-input").fill("(ed-export)");
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await expect(page.locator(".toast").last()).toContainText("Exported Office.html with 5 more forms");
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

test("Office exports as a whole app: every screen inside one file, run from disk, offline", async ({ page, browser }) => {
  const file = await exportFromTree(page, "Office");
  await expect(page.locator(".toast").last()).toContainText("with 5 more forms");

  const ctx = await browser.newContext();
  await ctx.setOffline(true);
  const p = await ctx.newPage();
  const outside = [];
  p.on("request", (r) => !/^(file|blob|data):/.test(r.url()) && outside.push(r.url()));
  await p.goto("file://" + file);
  await expect(p).toHaveTitle("Office");
  const bar = p.locator(".formrun-menubar").first();
  const frame = ctl(p, "frmMain");

  await ctl(p, "lstNav").locator(".formrun-item", { hasText: "Books" }).click();
  await expect(frame.locator(".formrun-ctl[data-name=lblPos]")).toHaveText("No records");
  await expect(bar.locator(".formrun-menu")).toHaveText(["Office", "Record", "Go", "Window"]);
  await bar.locator(".formrun-menu", { hasText: "Record" }).click();
  await p.locator(".formrun-menulist .formrun-menuitem", { hasText: "Add sample books" }).click();
  await expect(frame.locator(".formrun-ctl[data-name=lblPos]")).toHaveText("Record 1 of 3");

  await ctl(p, "lstNav").locator(".formrun-item", { hasText: "Agenda" }).click();
  await expect(frame.locator(".formrun-ctl[data-name=tabMain]")).toBeVisible();

  // reload: the books are kept, and Office opens the last screen again
  await p.reload();
  await expect(ctl(p, "lblShowing")).toHaveText("showing Agenda");
  await expect(ctl(p, "lblBooks")).toHaveText("3 books");
  expect(outside).toEqual([]);
  await ctx.close();
});

test("an exported page unpacks back into forms that edit and run", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: /^Office\.html$/ }).click({ button: "right" });
  await page.locator(".ctx-menu .ctx-item", { hasText: "Import forms from this page…" }).click();
  await expect(page.locator(".toast").last()).toContainText("Unpacked 6 forms into Office forms");
  for (const f of ["Office", "Books", "Orders", "Tables", "Agenda", "Functions"]) {
    expect(existsSync(resolve(UI_WORKSPACE, "examples", "Office forms", `${f}.eeform`))).toBe(true);
  }
  // the main form opened; run it from its new folder — its screens are found beside it there
  await expect(page.locator(".etab.active .etab-label")).toHaveText("Office.eeform");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  const host = page.locator(".formrun-host");
  await ctl(host, "lstNav").locator(".formrun-item", { hasText: "Books" }).click();
  await expect(ctl(host, "frmMain").locator(".formrun-ctl[data-name=lblPos]")).toHaveText(/^(No records|Record \d+ of \d+)$/);

  // a page that isn't an export says so
  writeFileSync(resolve(UI_WORKSPACE, "examples", "Plain.html"), "<!doctype html><p>hello</p>\n");
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Plain.html" }).click({ button: "right" });
  await page.locator(".ctx-menu .ctx-item", { hasText: "Import forms from this page…" }).click();
  await expect(page.locator(".toast").last()).toContainText("isn't a page exported from EEditor");
});
