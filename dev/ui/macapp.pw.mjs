// A form as a Mac app, without building one: the bridge serves the app.json EEDITOR_APP names, as
// the Mac app's backend serves its own, and runtime.html runs it the way the app's window does —
// the form filling the page, on the bridge's engine, with (ui-editor …) carried out on real files.
// Files is the app: ⌘→ moves a file on disk, ↵ on a note hands it to the system (the bridge notes
// which), and the page has none of the editor's chrome nor an HTML export's Save data…. Then an app
// with a sheet: the sheet it carries becomes a file in its folder the first time, and stays its own.
//
// Run on its own (npx playwright test dev/ui/macapp.pw.mjs) as well as in the suite: the bridge's
// engine is shared, and an earlier test that loads the editor would hide anything the app forgot.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { UI_APP, UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const DIR = `${UI_WORKSPACE}/macapp`;
const there = (p) => stat(`${UI_WORKSPACE}/${p}`).then(() => true, () => false);

test.beforeAll(async () => {
  await mkdir(`${DIR}/a`, { recursive: true });
  await mkdir(`${DIR}/b`, { recursive: true });
  await writeFile(`${DIR}/a/one.md`, "# One\n");
  const files = await readFile("workspace/examples/Files.eeform", "utf8");
  const app = { name: "My Files", id: "com.eeditor.form.my-files", folder: "home", bundle: { main: "Files.eeform", forms: { "Files.eeform": files }, assets: {} } };
  await mkdir(UI_APP.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(UI_APP, JSON.stringify(app));
});

test.afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  await rm(`${UI_WORKSPACE}/deskcalc`, { recursive: true, force: true });
  await rm(UI_APP, { force: true });
});

const ctl = (page, name) => page.locator(`.formrun-ctl[data-name=${name}]`);
const grid = (page, side) => ctl(page, side === "left" ? "grdLeft" : "grdRight");
const label = (page, side) => ctl(page, side === "left" ? "lblLeft" : "lblRight");
const row = (page, side, name) => grid(page, side).locator("tbody tr", { has: page.locator("td", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`) }) });

async function go(page, side, path) {
  await grid(page, side).locator("tbody tr").first().click();
  for (let i = 0; i < 6 && (await label(page, side).textContent()) !== "/"; i++) {
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(50);
  }
  await expect(label(page, side)).toHaveText("/");
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    await row(page, side, `${part}/`).dblclick();
    at += "/" + part;
    await expect(label(page, side)).toHaveText(at);
  }
}

test("the app's form fills the page, named as the app, with nothing of the editor's", async ({ page }) => {
  await page.goto("/runtime.html");
  await page.waitForSelector(".formrun-canvas");
  await expect(page).toHaveTitle("My Files");
  await expect(page.locator(".rt-bar")).toHaveCount(0); // no Save data… — its data is a file already
  await expect(page.locator(".sidebar, .cm-editor")).toHaveCount(0);
});

test("its file commands work on real files", async ({ page }) => {
  await page.goto("/runtime.html");
  await page.waitForSelector(".formrun-canvas");
  await go(page, "left", "macapp/a");
  await go(page, "right", "macapp/b");
  await row(page, "left", "one.md").click();
  await page.keyboard.press(`${MOD}+ArrowRight`);
  await expect(row(page, "right", "one.md")).toBeVisible();
  await expect(row(page, "left", "one.md")).toHaveCount(0);
  expect(await there("macapp/b/one.md")).toBe(true);
  expect(await there("macapp/a/one.md")).toBe(false);
});

test("↵ on a note hands it to the system — an app has no editor to open it in", async ({ page, request }) => {
  await page.goto("/runtime.html");
  await page.waitForSelector(".formrun-canvas");
  await go(page, "right", "macapp/b");
  await row(page, "right", "one.md").click();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await request.post("http://localhost:8787/fs/opened-with-system", { data: {} })).json())
    .toBe("macapp/b/one.md");
});

const CALC = `(form "Calc" :size (520 340) :main true
  (sheet shtRates :file "Rates" :toolbar false :at (8 8) :size (500 240))
  (button btnBump :text "Double A1" :at (8 260) :size (120 30) :on-click calc-bump)
  (label lblTotal :at (140 264) :size (360 24)))

(defn calc-bump (f)
  (sheet-set "deskcalc/Rates" "A1" (str (* 2 (sheet-get "deskcalc/Rates" "A1"))))
  (ui-set "lblTotal" :text (str "A3 is " (sheet-get "deskcalc/Rates" "A3"))))
`;

test("an app's sheet is placed in its folder the first time, then kept as its own", async ({ page, request }) => {
  // the sheet's bytes, as an export carries them — made on the engine, then the file taken away
  await mkdir(`${UI_WORKSPACE}/deskcalc`, { recursive: true });
  const ev = async (src) => JSON.parse(await (await request.post("http://localhost:8787/eval", { data: { src } })).text());
  const made = await ev(
    '(sheet-new "deskcalc/Rates") (sheet-set "deskcalc/Rates" "A1" "20") (sheet-set "deskcalc/Rates" "A2" "1") (sheet-set "deskcalc/Rates" "A3" "=(+ A1 A2)") (sheet-bytes "deskcalc/Rates")',
  );
  expect(made.error).toBeUndefined();
  await ev('(sheet-close "deskcalc/Rates")');
  await rm(`${UI_WORKSPACE}/deskcalc/Rates.eesheet`);
  const app = {
    name: "Calc",
    id: "com.eeditor.form.calc",
    folder: "own",
    bundle: { main: "deskcalc/Calc.eeform", forms: { "deskcalc/Calc.eeform": CALC }, assets: {}, sheets: { "deskcalc/Rates.eesheet": made.result } },
  };
  await writeFile(UI_APP, JSON.stringify(app));

  await page.goto("/runtime.html");
  await expect(page.locator(".formrun-ctl[data-name=shtRates] .sheet")).toBeVisible();
  expect(await there("deskcalc/Rates.eesheet")).toBe(true);
  await page.locator(".formrun-ctl[data-name=btnBump] button").click();
  await expect(page.locator(".formrun-ctl[data-name=lblTotal]")).toHaveText("A3 is 41");

  // opened again: the file is the app's now — what it carries doesn't write over it
  await page.goto("/runtime.html");
  await expect(page.locator(".formrun-ctl[data-name=shtRates] .sheet")).toBeVisible();
  await page.locator(".formrun-ctl[data-name=btnBump] button").click();
  await expect(page.locator(".formrun-ctl[data-name=lblTotal]")).toHaveText("A3 is 81");
});
