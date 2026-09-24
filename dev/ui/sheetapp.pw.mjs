// A sheet inside an exported app: the export carries the .eesheet, the page opens it in its engine,
// keeps it as it changes, and Save data… / Open data… take it along.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });
test.skip(!existsSync("public/runtime/eeform-runtime.html"), "no runtime template — run `npm run engine:wasm && npm run runtime:template`");

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const CALC = `(form "Calc" :size (520 340) :main true
  (sheet shtRates :file "Rates" :toolbar false :at (8 8) :size (500 240))
  (button btnBump :text "Double A1" :at (8 260) :size (120 30) :on-click calc-bump)
  (label lblTotal :at (140 264) :size (360 24)))

;; A3 is =(+ A1 A2) in the sheet: double A1, and say what A3 came to.
(defn calc-bump (f)
  (sheet-set "calc/Rates" "A1" (str (* 2 (sheet-get "calc/Rates" "A1"))))
  (ui-set "lblTotal" :text (str "A3 is " (sheet-get "calc/Rates" "A3"))))
`;

test.beforeAll(() => {
  mkdirSync(`${UI_WORKSPACE}/calc`, { recursive: true });
  writeFileSync(`${UI_WORKSPACE}/calc/Calc.eeform`, CALC);
});

const total = (p) => p.locator(".formrun-ctl[data-name=lblTotal]");
const bump = (p) => p.locator(".formrun-ctl[data-name=btnBump] button").click();

test("an exported app carries its sheet, keeps it as it changes, and saves and opens it", async ({ page, browser }) => {
  // the sheet, made in the workspace through the REPL
  await page.goto("/");
  await page.locator(".repl-input").fill('(sheet-new "calc/Rates") (sheet-set "calc/Rates" "A1" "20") (sheet-set "calc/Rates" "A2" "1") (sheet-set "calc/Rates" "A3" "=(+ A1 A2)")');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  // wait for the engine's answer — the last sheet-set's row — before leaving the page: a navigation
  // can cut the evaluation off before it reaches the engine (the echoed command isn't the answer)
  await expect(page.locator(".repl-scrollback")).toContainText("1 row");
  await page.goto("/");

  // export: the panel lists the sheet with what goes in
  await page.locator(".tree-file", { hasText: "Calc.eeform" }).click({ button: "right" });
  await page.locator(".ctx-menu .ctx-item", { hasText: "Export as HTML…" }).click();
  await expect(page.locator(".export-panel")).toContainText("Rates.eesheet");
  await expect(page.locator(".export-panel")).not.toContainText("Missing");
  await page.locator(".export-panel .dlg-btn", { hasText: "Export" }).click();
  await expect(page.locator(".toast").last()).toContainText("Exported Calc.html");
  const file = resolve(UI_WORKSPACE, "calc", "Calc.html");

  // from disk, offline: the grid is there, and its formulas work
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.setOffline(true);
  const p = await ctx.newPage();
  await p.goto("file://" + file);
  await expect(p.locator(".formrun-ctl[data-name=shtRates] .sheet")).toBeVisible();
  await bump(p);
  await expect(total(p)).toHaveText("A3 is 41");

  // reload: the sheet was kept
  await p.reload();
  await bump(p);
  await expect(total(p)).toHaveText("A3 is 81");

  // Save data… carries the sheet too
  const download = p.waitForEvent("download");
  await p.locator(".rt-btn", { hasText: "Save data…" }).click();
  // (kept outside the context: its downloads go when it closes)
  const saved = resolve(UI_WORKSPACE, "calc", "saved-data.db");
  await (await download).saveAs(saved);
  await ctx.close();

  // a fresh browser starts from the sheet as exported; Open data… brings back the one saved
  const ctx2 = await browser.newContext();
  const q = await ctx2.newPage();
  await q.goto("file://" + file);
  await bump(q);
  await expect(total(q)).toHaveText("A3 is 41");
  await q.locator(".rt-bar input[type=file]").setInputFiles(saved);
  await q.waitForLoadState("load");
  await expect(q.locator(".formrun-ctl[data-name=btnBump]")).toBeVisible();
  await bump(q);
  await expect(total(q)).toHaveText("A3 is 161");
  await ctx2.close();
});

test("importing the page back unpacks its sheet as a file", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Calc.html" }).click({ button: "right" });
  await page.locator(".ctx-menu .ctx-item", { hasText: "Import forms from this page…" }).click();
  await expect(page.locator(".toast").last()).toContainText("Unpacked 1 form into Calc forms");
  expect(existsSync(resolve(UI_WORKSPACE, "calc", "Calc forms", "Rates.eesheet"))).toBe(true);
  // a second Calc.eeform in the tree would trip the specs after this one
  rmSync(resolve(UI_WORKSPACE, "calc", "Calc forms"), { recursive: true, force: true });
});
