// A form on its own: runtime.html runs a .eeform on the WebAssembly engine, in the page, with no
// editor and no bridge — and keeps what it writes in the browser. Needs `npm run engine:wasm`.

import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.skip(!existsSync("public/engine/eelisp_web_bg.wasm"), "no WebAssembly engine — run `npm run engine:wasm`");

const BOOKS = "/runtime.html?form=/workspace/examples/Books.eeform";
const ctl = (page, name) => page.locator(`.formrun-ctl[data-name=${name}]`);

/** Each test starts in a browser of its own, with nothing kept: three books to work with. */
async function withSamples(page) {
  await page.goto(BOOKS);
  await expect(ctl(page, "lblPos")).toHaveText("No records");
  await page.locator(".formrun-menu", { hasText: "Record" }).click();
  await page.locator(".formrun-menuitem", { hasText: "Add sample books" }).click();
  await expect(ctl(page, "lblPos")).toHaveText("Record 1 of 3");
}

test("a form runs on its own, and what it writes is still there after a reload", async ({ page }) => {
  const engineCalls = [];
  page.on("request", (r) => r.url().includes(":8787") && engineCalls.push(r.url()));
  await page.goto(BOOKS);
  await expect(page).toHaveTitle("Books");
  await expect(ctl(page, "lblPos")).toHaveText("No records");

  await page.locator(".formrun-menu", { hasText: "Record" }).click();
  await page.locator(".formrun-menuitem", { hasText: "Add sample books" }).click();
  await expect(ctl(page, "lblPos")).toHaveText("Record 1 of 3");
  await ctl(page, "btnNew").locator("button").click();
  await ctl(page, "txtTitle").locator("input").fill("Dune");
  await ctl(page, "btnSave").locator("button").click();
  await expect(ctl(page, "lblPos")).toHaveText("Record 4 of 4");

  await page.reload(); // the page leaving writes the data; coming back reads it
  await expect(ctl(page, "lblPos")).toHaveText("Record 1 of 4");
  await ctl(page, "btnLast").locator("button").click();
  await expect(ctl(page, "txtTitle").locator("input")).toHaveValue("Dune");
  expect(engineCalls).toEqual([]); // not one call to the bridge: the engine is the page's
});

test("Save data… downloads a SQLite file, and Open data… brings it back", async ({ page }) => {
  await withSamples(page);
  const download = page.waitForEvent("download");
  await page.locator(".rt-btn", { hasText: "Save data…" }).click();
  const file = await (await download).path();
  expect((await download).suggestedFilename()).toBe("Books.db");
  expect(readFileSync(file).subarray(0, 15).toString()).toBe("SQLite format 3");

  // forget everything this browser holds, then open the saved file
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("eeditor"); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.reload();
  await expect(ctl(page, "lblPos")).toHaveText("No records");
  await page.locator(".rt-bar input[type=file]").setInputFiles(file);
  await expect(ctl(page, "lblPos")).toHaveText("Record 1 of 3");

  // something that isn't a database is refused, and the data stays
  await page.locator(".rt-bar input[type=file]").setInputFiles({ name: "x.db", mimeType: "application/octet-stream", buffer: Buffer.from("not a database, only text") });
  await expect(page.locator(".toast").last()).toContainText("isn't data this app can open");
  await expect(ctl(page, "lblPos")).toHaveText("Record 1 of 3");
});

test("closing the form offers to open it again; a page with no form says how to give it one", async ({ page }) => {
  await withSamples(page);
  await ctl(page, "btnNext").locator("button").click();
  await page.locator(".formrun-stop").click();
  await expect(page.locator(".rt-closed")).toHaveText("Books is closed.");
  await page.locator(".rt-btn", { hasText: "Open Books again" }).click();
  await expect(ctl(page, "lblPos")).toHaveText("Record 1 of 3");

  await page.goto("/runtime.html");
  await expect(page.locator(".rt-fail")).toContainText("?form=");
});
