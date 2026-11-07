// The everyday keys of the default shortcut table and the built-in ones beside the tab keys:
// ⌘I types the date and time at the caret, ⌘⇧I starts a note named with them, ⌘W closes the tab,
// ⌘B hides and shows the sidebar — and the sidebar's edge drags wider, remembered, and double-click
// puts it back.
//
// The notes are written for this spec and removed after it; the config is the default one.

import { expect, test } from "@playwright/test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const DIR = `${UI_WORKSPACE}/everyday`;
const NOTE = "everyday-a.md";
/** "2026-11-04 1635.md": what ⌘⇧I names a note. */
const STAMPED = /^\d{4}-\d{2}-\d{2} \d{4}\.md$/;

test.beforeAll(async () => {
  await mkdir(DIR, { recursive: true });
  await writeFile(`${DIR}/${NOTE}`, "# A\n\n");
});

test.afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  for (const f of await readdir(UI_WORKSPACE)) if (STAMPED.test(f)) await rm(`${UI_WORKSPACE}/${f}`, { force: true });
});

const active = (page) => page.locator(".etab.active .etab-label");

async function openNote(page) {
  await page.goto("/");
  // the launch note first: a click before the app has opened it is undone when it does
  await expect(active(page)).toHaveText("welcome.md");
  await page.locator(".tree-file", { hasText: NOTE }).click();
  await expect(active(page)).toHaveText(NOTE);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
}

test("⌘I types the date and time at the caret", async ({ page }) => {
  await openNote(page);
  await page.keyboard.press("ControlOrMeta+i");
  await expect(page.locator(".cm-content")).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  // still the same note: ⌘I no longer starts a new one
  await expect(active(page)).toHaveText(NOTE);
});

test("⌘⇧I starts a note named with the date and time", async ({ page }) => {
  await openNote(page);
  await page.keyboard.press("ControlOrMeta+Shift+i");
  await expect(active(page)).toHaveText(STAMPED);
  await expect(page.locator(".cm-content")).toContainText(/^# \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
});

test("⌘W closes the tab in front", async ({ page }) => {
  await openNote(page);
  const before = await page.locator(".etab").count();
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.locator(".etab")).toHaveCount(before - 1);
  await expect(page.locator(".etab .etab-label", { hasText: NOTE })).toHaveCount(0);
});

test("⌘B hides the sidebar and shows it again, across a reload", async ({ page }) => {
  await openNote(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toBeVisible();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebar).toBeHidden();
  await page.reload();
  await expect(page.locator(".editor-host")).toBeVisible();
  await expect(sidebar).toBeHidden();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebar).toBeVisible();
});

test("the sidebar's edge drags it wider, within bounds; double-click puts it back", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  const width = async () => Math.round((await sidebar.boundingBox()).width);
  expect(await width()).toBe(240);
  const edge = await page.locator(".side-resizer").boundingBox();
  const y = edge.y + edge.height / 2;
  await page.mouse.move(edge.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 102, y, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(340);
  await page.reload();
  expect(await width()).toBe(340);
  // far past the limit stops at the most it may be
  const edge2 = await page.locator(".side-resizer").boundingBox();
  await page.mouse.move(edge2.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(edge2.x + 900, y, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(480);
  await page.locator(".side-resizer").dblclick();
  expect(await width()).toBe(240);
});
