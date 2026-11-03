// The tab keys every editor has: ⌃Tab / ⌃⇧Tab step through the open tabs, ⌘1…⌘9 pick one by
// position, ⌘9 the last — with the caret in it. A (bind …) on one of those keys replaces it.
//
// The notes and the config are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const DIR = `${UI_WORKSPACE}/tabk`;
const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const NOTES = ["tabk-a.md", "tabk-b.md", "tabk-c.md"];

test.beforeAll(async () => {
  await mkdir(DIR, { recursive: true });
  for (const n of NOTES) await writeFile(`${DIR}/${n}`, `# ${n}\n`);
});

test.afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  await rm(CONFIG, { force: true });
});

const active = (page) => page.locator(".etab.active .etab-label");

async function openAll(page) {
  await page.goto("/");
  for (const n of NOTES) {
    await page.locator(".tree-file", { hasText: n }).click();
    await expect(active(page)).toHaveText(n);
  }
  const labels = await page.locator(".etab .etab-label").allTextContents();
  return labels;
}

test("⌃Tab and ⌃⇧Tab step through the tabs, wrapping round", async ({ page }) => {
  const labels = await openAll(page);
  const last = labels.length - 1;
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Tab");
  await expect(active(page)).toHaveText(labels[0]);
  await page.keyboard.press("Control+Shift+Tab");
  await expect(active(page)).toHaveText(labels[last]);
  await page.keyboard.press("Control+Shift+Tab");
  await expect(active(page)).toHaveText(labels[last - 1]);
  // the caret is in the note: typing goes into it
  await expect(page.locator(".cm-editor.cm-focused")).toBeVisible();
});

test("⌘1…⌘8 pick a tab by position, ⌘9 the last; past the end nothing happens", async ({ page }) => {
  const labels = await openAll(page);
  await page.keyboard.press("ControlOrMeta+1");
  await expect(active(page)).toHaveText(labels[0]);
  await page.keyboard.press(`ControlOrMeta+${labels.length - 1}`);
  await expect(active(page)).toHaveText(labels[labels.length - 2]);
  await page.keyboard.press("ControlOrMeta+9");
  await expect(active(page)).toHaveText(labels[labels.length - 1]);
  if (labels.length < 8) {
    await page.keyboard.press("ControlOrMeta+8"); // no eighth tab: stays put
    await expect(active(page)).toHaveText(labels[labels.length - 1]);
  }
});

test("a (bind …) on the same key replaces the built-in one", async ({ page }) => {
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await writeFile(CONFIG, `(bind "Mod-1" (ed-open "tabk/tabk-b.md"))\n`);
  const labels = await openAll(page);
  await page.keyboard.press("ControlOrMeta+1");
  await expect(active(page)).toHaveText("tabk-b.md");
  await page.keyboard.press("ControlOrMeta+9"); // the rest are still there
  await expect(active(page)).toHaveText(labels[labels.length - 1]);
});
