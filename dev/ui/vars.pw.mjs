// Variables across forms: `local` is one open form's own, `public` is shared by a main form and the
// forms it opens (and heard through :on-public), `:persist` keeps a public one between runs.

import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const SHOP = `(form "Shop" :size (320 160) :on-load shop-load :on-public shop-heard
  (label lblCart :at (16 16) :size (280 24))
  (button btnBrowse :text "Browse" :at (16 56) :size (96 30) :on-click shop-browse)
  (label lblHeard :at (16 100) :size (280 24)))

(public cart '())
(public visits 0 :persist true)

(defn shop-show () (ui-set "lblCart" :text (str (length (var "cart")) " in the cart · visit " (var "visits"))))
(defn shop-load (f) (var! "visits" (+ (var "visits") 1)) (shop-show))
(defn shop-heard (f) (ui-set "lblHeard" :text (str "heard " (ui-get f "$changed"))) (shop-show))
(defn shop-browse (f) (ui-open "vars/Picker"))
`;

const PICKER = `(form "Picker" :size (300 120)
  (button btnAdd :text "Add a book" :at (16 16) :size (120 30) :on-click pick-add)
  (label lblMine :at (16 60) :size (260 24)))

(defn pick-add (f)
  (var! "cart" (cons "book" (var "cart")))
  (ui-set "lblMine" :text (str (length (var "cart")) " in the cart")))
`;

test.beforeAll(() => {
  mkdirSync(`${UI_WORKSPACE}/vars`, { recursive: true });
  writeFileSync(`${UI_WORKSPACE}/vars/Shop.eeform`, SHOP);
  writeFileSync(`${UI_WORKSPACE}/vars/Picker.eeform`, PICKER);
});

async function runInTab(page, name) {
  await page.locator(".tree-file", { hasText: `${name}.eeform` }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-host .formrun-canvas");
}

test("a public variable is shared with the forms a form opens, and they hear each other", async ({ page }) => {
  await page.goto("/");
  await runInTab(page, "Shop");
  const shop = page.locator(".formrun-host");
  await expect(shop.locator(".formrun-ctl[data-name=lblCart]")).toHaveText("0 in the cart · visit 1");

  await shop.locator(".formrun-ctl[data-name=btnBrowse] button").click();
  const picker = page.locator(".formwin");
  await picker.locator(".formrun-ctl[data-name=btnAdd] button").click();
  await picker.locator(".formrun-ctl[data-name=btnAdd] button").click();
  await expect(picker.locator(".formrun-ctl[data-name=lblMine]")).toHaveText("2 in the cart");
  // Shop never asked: Picker's write reached it through :on-public
  await expect(shop.locator(".formrun-ctl[data-name=lblHeard]")).toHaveText("heard cart");
  await expect(shop.locator(".formrun-ctl[data-name=lblCart]")).toHaveText("2 in the cart · visit 1");
  await picker.locator(".formrun-stop").click();

  // run again: the cart was the run's, the visit count is kept
  await shop.locator(".formrun-stop").click();
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await expect(page.locator(".formrun-host .formrun-ctl[data-name=lblCart]")).toHaveText("0 in the cart · visit 2");
});

test("a local variable is one open form's own: two copies of Books keep their own place", async ({ page }) => {
  await page.goto("/");
  await runInTab(page, "Books");
  const tab = page.locator(".formrun-host");
  const pos = (f) => f.locator(".formrun-ctl[data-name=lblPos]");
  if ((await pos(tab).innerText()) === "No records") {
    await tab.locator(".formrun-menu", { hasText: "Record" }).click();
    await tab.locator(".formrun-menuitem", { hasText: "Add sample books" }).click();
  }
  await expect(pos(tab)).toHaveText(/^Record 1 of \d+$/);
  await tab.locator(".formrun-ctl[data-name=btnNext] button").click();
  await expect(pos(tab)).toHaveText(/^Record 2 of/);

  // a second copy, in a window: it starts at the first record, and moving it leaves the tab alone
  await page.locator(".repl-input").fill('(ed-form "examples/Books")');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  const win = page.locator(".formwin");
  await expect(pos(win)).toHaveText(/^Record 1 of/);
  await win.locator(".formrun-ctl[data-name=btnLast] button").click();
  await expect(pos(tab)).toHaveText(/^Record 2 of/);
  // (the window floats over the tab's buttons, so the click goes to the button itself)
  await tab.locator(".formrun-ctl[data-name=btnFirst] button").dispatchEvent("click");
  await expect(pos(tab)).toHaveText(/^Record 1 of/);
  await expect(win.locator(".formrun-ctl[data-name=btnNext] button")).toBeDisabled(); // still at the last
});

test("an undeclared variable is named in a message, not a crash", async ({ page }) => {
  writeFileSync(
    `${UI_WORKSPACE}/vars/Typo.eeform`,
    `(form "Typo" :size (200 80) :on-load typo-load (label lbl :at (8 8) :size (180 24)))\n(defn typo-load (f) (var "carrt"))\n`,
  );
  await page.goto("/");
  await runInTab(page, "Typo");
  await expect(page.locator(".toast").last()).toContainText('No variable "carrt"');
});
