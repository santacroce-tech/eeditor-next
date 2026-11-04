// A screen that isn't a Spectrum (workspace/examples/Display.eeform), in a real browser over the
// real engine: an indexed frame paints at its own size, in its palette, column order; the held
// keys reach the program in ui-held, and the clock in ui-ms; held Space, samples go with the frames.

import { expect, test } from "@playwright/test";

async function run(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Display.eeform" }).click();
  // forms open running — the default (forms-open "run")
  await page.waitForSelector(".formrun-screen");
  return page.locator(".formrun-host");
}

const screen = (form) => form.locator(".formrun-screen");
const frames = async (form) => Number((await screen(form).getAttribute("data-frames")) ?? 0);
const pixel = (page, x, y) =>
  page.evaluate(([x, y]) => [...document.querySelector(".formrun-screen").getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)], [x, y]);
const YELLOW = [255, 220, 0];

test("an indexed frame paints at its own size, and the keys held move what it draws", async ({ page }) => {
  const form = await run(page);
  await expect.poll(() => frames(form)).toBeGreaterThan(3);
  await expect(screen(form)).toHaveAttribute("data-kind", "indexed");
  expect(await screen(form).evaluate((c) => [c.width, c.height])).toEqual([160, 100]);
  // no Spectrum keyboard under another machine's picture
  await expect(form.locator(".formrun-screen-kbtoggle")).toBeHidden();

  // the square, where the program starts it; the ground under it, in the palette's browns
  await expect.poll(() => pixel(page, 80, 78)).toEqual(YELLOW);
  expect(await pixel(page, 2, 95)).toEqual([60, 40, 20]);

  // the sky moves with the clock alone
  const sky = await pixel(page, 40, 10);
  await expect.poll(() => pixel(page, 40, 10), { timeout: 5000 }).not.toEqual(sky);

  // hold ← and the square goes left until the edge stops it
  await screen(form).click();
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => pixel(page, 8, 78), { timeout: 10_000 }).toEqual(YELLOW);
  await page.keyboard.up("ArrowLeft");
  expect(await pixel(page, 80, 78)).not.toEqual(YELLOW);

  // silent until Space: then frames carry samples, and the screen offers its sound button
  const sound = form.locator(".zx-sound");
  await expect(sound).toBeHidden();
  expect(await screen(form).getAttribute("data-sounds")).toBeNull();
  await page.keyboard.down("Space");
  await expect.poll(async () => Number((await screen(form).getAttribute("data-sounds")) ?? 0)).toBeGreaterThan(3);
  await page.keyboard.up("Space");
  await expect(sound).toBeVisible();
  await sound.click();
  await expect(sound).toHaveText("🔇");

  const a = await frames(form);
  const t0 = Date.now();
  await page.waitForTimeout(2000);
  const fps = ((await frames(form)) - a) / ((Date.now() - t0) / 1000);
  console.log(`display: ${fps.toFixed(1)} frames/s painted in the browser (asked for 35)`);
  expect(fps).toBeGreaterThan(5);
});
