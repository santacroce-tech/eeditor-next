// The title bar (main.ts): our own row above the panes, with the search pill and Today. A browser
// draws it with the paper theme only; on a Mac the window's title bar is transparent over it
// (data-titlebar="overlay", set from the backend's answer), and it keeps clear of the traffic lights.

import { expect, test } from "@playwright/test";

const ready = async (page) => {
  await page.goto("/");
  await expect(page.locator(".etab.active")).toBeVisible();
};
const theme = (page, name) => page.evaluate((t) => (document.documentElement.dataset.theme = t), name);

test("no title bar in a browser's dark theme; the paper theme has one, and the panes start below it", async ({ page }) => {
  await ready(page);
  await theme(page, "dark");
  await expect(page.locator(".titlebar")).toBeHidden();
  expect((await page.locator(".shell").boundingBox()).y).toBe(0);

  await theme(page, "paper");
  await expect(page.locator(".titlebar")).toBeVisible();
  const bar = await page.locator(".titlebar").boundingBox();
  const shell = await page.locator(".shell").boundingBox();
  expect(shell.y).toBe(bar.height);
  expect(Math.round(shell.y + shell.height)).toBe(page.viewportSize().height);
});

test("the search pill opens the palette, and Today the day", async ({ page }) => {
  await ready(page);
  await theme(page, "paper");
  await page.locator(".titlebar-search").click();
  await expect(page.locator(".qo-panel:not(.search-panel)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".qo-panel:not(.search-panel)")).toBeHidden();

  await page.locator('.titlebar [data-action="today"]').click();
  await expect(page.locator(".today")).toBeVisible();
  await page.locator('.titlebar [data-action="today"]').click();
  await expect(page.locator(".today")).toBeHidden();
});

test("under a Mac's transparent title bar: every theme has it, clear of the traffic lights, the pill centred", async ({ page }) => {
  await ready(page);
  await theme(page, "dark");
  await page.evaluate(() => (document.documentElement.dataset.titlebar = "overlay"));
  await expect(page.locator(".titlebar")).toBeVisible();
  const pill = await page.locator(".titlebar-search").boundingBox();
  expect(pill.x).toBeGreaterThan(80);
  const width = page.viewportSize().width;
  expect(Math.abs(pill.x + pill.width / 2 - width / 2)).toBeLessThan(8);
  // dragging the window is the bar's own job, and its empty sides'
  await expect(page.locator(".titlebar")).toHaveAttribute("data-tauri-drag-region", "");
  // full screen: no lights to keep clear of
  await page.evaluate(() => (document.documentElement.dataset.fullscreen = "on"));
  expect((await page.locator(".titlebar-side").first().boundingBox()).x).toBeLessThan(20);
});
