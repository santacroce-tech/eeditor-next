// (panel "tags" "pim/Tags.eeform") — the sidebar's tags section as a form, in a real browser against a
// real engine, with the PIM loaded the way the install writes it: the form takes the cloud's place;
// a tag lists its notes (its children's too), a click opens one; a note saved with a new #tag shows
// up; ⇩ puts the links in the note in front as a block. Without the line, the cloud is back.
//
// The config, forms and notes are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const DIR = `${UI_WORKSPACE}/tgz`;
let pim = "";

test.beforeAll(async () => {
  pim = await readFile("docs/pim/pim.eelisp", "utf8");
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/pim`, { recursive: true });
  await mkdir(DIR, { recursive: true });
  await writeFile(CONFIG, `${pim}\n(on-start (ed-open "welcome.md"))\n`);
  await writeFile(`${UI_WORKSPACE}/pim/Tags.eeform`, await readFile("docs/pim/Tags.eeform", "utf8"));
  await writeFile(`${UI_WORKSPACE}/pim/Side.eeform`, await readFile("docs/pim/Side.eeform", "utf8"));
  await writeFile(`${DIR}/tgz-one.md`, "# One\n\nAbout #tgzq/sub.\n");
  await writeFile(`${DIR}/tgz-two.md`, "# Two\n\nAlso #tgzq here.\n");
  await writeFile(`${DIR}/tgz-index.md`, "# Index\n\n");
});

test.afterAll(async () => {
  await rm(CONFIG, { force: true });
  await rm(`${UI_WORKSPACE}/pim`, { recursive: true, force: true });
  await rm(DIR, { recursive: true, force: true });
});

const panel = (page) => page.locator(".tags-section .formrun.embedded");
const ctl = (page, name) => panel(page).locator(`.formrun-ctl[data-name="${name}"]`);
const tag = (page, label) => ctl(page, "lstTags").locator(".formrun-item", { hasText: label });

test("the form takes the cloud's place; a tag lists its notes and a click opens one", async ({ page }) => {
  await page.goto("/");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".tags-section .tags-panel")).toBeHidden();
  await ctl(page, "txtFind").locator("input").fill("tgzq");
  await ctl(page, "txtFind").locator("input").press("Tab");
  await expect(ctl(page, "lstTags").locator(".formrun-item")).toHaveText(["#tgzq · 2", " #sub · 1"]);
  await tag(page, "#tgzq · 2").click();
  await expect(ctl(page, "grdNotes").locator("tbody tr")).toHaveText(["tgz-one", "tgz-two"]);
  await ctl(page, "grdNotes").locator("tbody tr", { hasText: "tgz-two" }).click();
  await expect(page.locator(".etab.active .etab-label")).toHaveText("tgz-two.md");
});

test("⇩ puts the links in the note in front; a note saved with the tag joins them", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "tgz-index.md" }).click();
  await expect(page.locator(".etab.active .etab-label")).toHaveText("tgz-index.md");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type("Pinned: #tgzq\n");
  // saved (autosave), then the panels' refresh after a save — which waits while focus is in one
  await expect.poll(() => readFile(`${DIR}/tgz-index.md`, "utf8")).toContain("#tgzq");
  await page.waitForTimeout(900);
  await ctl(page, "txtFind").locator("input").fill("tgzq");
  await ctl(page, "txtFind").locator("input").press("Tab");
  await expect(tag(page, "#tgzq · 3")).toBeVisible(); // saved, and counted
  await tag(page, "#tgzq · 3").click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await ctl(page, "btnLinks").locator("button").click();
  const doc = page.locator(".cm-content");
  await expect(doc).toContainText('<!-- eel: (pim-tagged "tgzq") -->');
  await expect(doc).toContainText("- [[tgz-one]] · tgz");
  await expect.poll(() => readFile(`${DIR}/tgz-index.md`, "utf8")).toContain("[[tgz-two]]");
});

test("without the line, the cloud is back", async ({ page }) => {
  await writeFile(CONFIG, `${pim.replace(/^\(panel "tags".*$/m, "")}\n(on-start (ed-open "welcome.md"))\n`);
  await page.goto("/");
  await expect(page.locator(".tags-section .tag-chip", { hasText: "#tgzq" })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});
