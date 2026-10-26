// The spreadsheet functions a formula can call without loading anything: EEditor's own
// (src/sheets/functions.eelisp) and the workspace's (.eeditor/functions.eelisp), both in the engine
// before the first sheet opens.

import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const shown = (page) => page.$$eval(".sheet-cell", (els) => els.map((e) => e.textContent));
const settled = (page) => page.waitForFunction(() => !document.querySelector(".sheet")?.classList.contains("busy"));

async function go(page, ref) {
  await page.locator(".sheet-namebox").fill(ref);
  await page.locator(".sheet-namebox").press("Enter");
}

async function type(page, text) {
  await page.locator(".sheet-scroller").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await settled(page);
}

test.beforeAll(async () => {
  // read when the workspace arrives, so it has to be there before the page loads
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await writeFile(`${UI_WORKSPACE}/.eeditor/functions.eelisp`, "(defn double (x) (* x 2))\n");
});

test("countif over a whole column works in a new sheet, with nothing loaded by hand", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-dir").first().click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "New sheet…" }).click();
  await page.locator(".dlg-input").fill("Tally");
  await page.locator(".dlg-input").press("Enter");
  await page.waitForSelector(".sheet-scroller");

  for (const [ref, text] of [["A1", "Work"], ["A2", "Home"], ["A3", "work"]]) {
    await go(page, ref);
    await type(page, text);
  }
  await go(page, "B1");
  await type(page, '=(countif A:A "Work")');
  await expect.poll(() => shown(page)).toContain("2");
  await go(page, "B1");
  await expect(page.locator(".sheet-formula")).toHaveValue('=(countif A:A "Work")');

  // a row added at the bottom of the column is counted
  await go(page, "A4");
  await type(page, "Work");
  await expect.poll(() => shown(page)).toContain("3");
});

test("the workspace's own functions are there too", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Tally.eesheet" }).click();
  await page.waitForSelector(".sheet-scroller");
  await go(page, "C1");
  await type(page, "=(double 21)");
  await expect.poll(() => shown(page)).toContain("42");
});
