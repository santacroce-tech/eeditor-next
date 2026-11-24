// The Today page (ui/today.ts): the agenda as a day, over the editor pane. ⌘⇧D, the rail's sun or
// ⌘P → "Today" opens it; Esc, or opening any file, puts the editor back. And the paper theme, whose
// cards it is drawn as.

import { expect, test } from "@playwright/test";

const open = async (page) => {
  await page.goto("/");
  await expect(page.locator(".etab.active")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(page.locator(".today")).toBeVisible();
};
const due = (page, text) => page.locator(".today-main .today-item", { hasText: text });
const inbox = (page, text) => page.locator(".today-side .today-item", { hasText: text });

test("a task typed on the page is due that day; its ring finishes it", async ({ page }) => {
  await open(page);
  await expect(page.locator(".today-title")).toHaveText("Today");
  await expect(page.locator(".today-day.selected")).toHaveClass(/is-today/);
  await page.locator(".today-add-input").fill("file the expenses");
  await page.locator(".today-add-input").press("Enter");
  await expect(due(page, "file the expenses")).toBeVisible();
  await expect(page.locator(".today-summary")).toContainText("task");
  // the sidebar's agenda has it too
  await page.locator('.side-rail [data-key="agenda"]').click();
  await expect(page.locator(".agenda-list .ag-item", { hasText: "file the expenses" })).toBeVisible();

  await due(page, "file the expenses").locator(".today-check").click();
  await expect(due(page, "file the expenses")).toHaveCount(0);
  await expect(page.locator(".agenda-list .ag-item", { hasText: "file the expenses" })).toHaveCount(0);
});

test("the next day: a task for it, then brought back from the week ahead", async ({ page }) => {
  await open(page);
  await page.locator(".today").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".today-title")).toHaveText("Tomorrow");
  await page.locator(".today-add-input").fill("post the parcel");
  await page.locator(".today-add-input").press("Enter");
  await expect(due(page, "post the parcel")).toBeVisible();

  await page.locator(".today-nav .today-pill", { hasText: "Today" }).click();
  await expect(page.locator(".today-title")).toHaveText("Today");
  await expect(due(page, "post the parcel")).toHaveCount(0);
  const ahead = inbox(page, "post the parcel");
  await expect(ahead).toContainText("tomorrow");
  await ahead.hover();
  await ahead.locator(".today-pill").click();
  await expect(due(page, "post the parcel")).toBeVisible();
  await due(page, "post the parcel").locator(".today-check").click();
  await expect(due(page, "post the parcel")).toHaveCount(0);
});

test("an item added elsewhere with no day is in the inbox", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".today")).toBeHidden();
  await page.locator('.side-rail [data-key="agenda"]').click();
  await page.locator(".agenda-input").fill("learn the oboe");
  await page.locator(".agenda-input").press("Enter");
  await expect(page.locator(".agenda-list .ag-item", { hasText: "learn the oboe" })).toBeVisible();
  await page.locator('.side-rail [data-action="today"]').click();
  await expect(inbox(page, "learn the oboe")).toBeVisible();
  await inbox(page, "learn the oboe").locator(".today-check").click();
  await expect(inbox(page, "learn the oboe")).toHaveCount(0);
});

test("Esc and opening a file both put the editor back; the REPL returns with it", async ({ page }) => {
  await open(page);
  await expect(page.locator('.side-rail [data-action="today"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".today")).toBeHidden();
  await expect(page.locator(".editor-host")).toBeVisible();

  await page.locator('.side-rail [data-action="today"]').click();
  await expect(page.locator(".today")).toBeVisible();
  await page.locator(".tree-file", { hasText: "welcome.md" }).first().click(); // files are in front
  await expect(page.locator(".today")).toBeHidden();
  await expect(page.locator('.side-rail [data-action="today"]')).toHaveAttribute("aria-pressed", "false");
});

test("the paper theme: light cards on a dark frame, remembered", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".etab.active")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.keyboard.type("theme: paper");
  await page.locator(".quick-open .qo-input").press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  const lightness = (sel) =>
    page.locator(sel).first().evaluate((e) => {
      const [r, g, b] = getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number);
      return (r + g + b) / 3;
    });
  expect(await lightness(".editor-pane")).toBeGreaterThan(230);
  expect(await lightness(".shell")).toBeLessThan(40);
  expect(await lightness(".cm-editor")).toBeGreaterThan(230);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await page.evaluate(() => localStorage.removeItem("theme"));
});
