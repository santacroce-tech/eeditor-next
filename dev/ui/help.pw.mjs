// The two cheatsheets, checked where they are used: the ? beside the formula bar and the ? in the
// REPL's head. Each test ends by running what it picked, so a line that stopped being true fails
// here rather than in front of someone reading it.

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const SHEET = "Help.eesheet";

/** Wait for the grid's pending writes to finish. */
const settled = (page) => page.waitForFunction(() => !document.querySelector(".sheet")?.classList.contains("busy"));

/** Select a cell by typing into the name box. */
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

test("the REPL's ? shows the language, and a line picked from it runs", async ({ page }) => {
  await page.goto("/");
  await page.locator(".repl-help").click();
  await expect(page.locator(".help-title")).toHaveText("EELisp in a minute");

  await page.locator(".help-row", { hasText: "(+ 1 2 3)" }).click();
  await expect(page.locator(".help-panel")).toHaveCount(0); // picking closes it
  await expect(page.locator(".repl-input")).toHaveValue("(+ 1 2 3)"); // at the prompt, not run

  await page.locator(".repl-input").press("Meta+Enter");
  await expect(page.locator(".repl-result").last()).toContainText("6");
});

test("Escape closes the cheatsheet and leaves the prompt alone", async ({ page }) => {
  await page.goto("/");
  await page.locator(".repl-input").fill("(str \"half\" \" written\")");
  await page.locator(".repl-help").click();
  await expect(page.locator(".help-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".help-panel")).toHaveCount(0);
  await expect(page.locator(".repl-input")).toHaveValue('(str "half" " written")');
});

test("the sheet's ? types a formula into the selected cell", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-dir").click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "New sheet…" }).click();
  await page.locator(".dlg-input").fill("Help");
  await page.locator(".dlg-input").press("Enter");
  await page.waitForSelector(".sheet-scroller");
  await expect(page.locator(".etab.active .etab-label")).toHaveText(SHEET);

  await go(page, "B1");
  await type(page, "2");
  await go(page, "B2");
  await type(page, "3");

  // somewhere outside B1:B9 — a total that adds up its own cell is a circle, and the grid says so
  await go(page, "D1");
  await page.locator(".sheet-help").click();
  await expect(page.locator(".help-title")).toHaveText("What you can write in a cell");
  await page.locator(".help-row", { hasText: "=(sum B1:B9)" }).click();

  // it arrives as something being typed: Escape would still leave the cell as it was
  await expect(page.locator(".sheet-formula")).toHaveValue("=(sum B1:B9)");
  await page.keyboard.press("Enter");
  await settled(page);
  await go(page, "D1");
  await expect(page.locator(".sheet-formula")).toHaveValue("=(sum B1:B9)");
  await expect.poll(() => page.$$eval(".sheet-cell", (els) => els.map((e) => e.textContent))).toContain("5");
});
