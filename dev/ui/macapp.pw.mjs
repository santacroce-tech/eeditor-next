// A form as a Mac app, without building one: the bridge serves the app.json EEDITOR_APP names, as
// the Mac app's backend serves its own, and runtime.html runs it the way the app's window does —
// the form filling the page, on the bridge's engine, with (ui-editor …) carried out on real files.
// Files is the app: ⌘→ moves a file on disk, ↵ on a note hands it to the system (the bridge notes
// which), and the page has none of the editor's chrome nor an HTML export's Save data….

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
