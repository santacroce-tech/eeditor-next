// The MSX (workspace/examples/MSX.eeform) in a real browser over the real engine: C-BIOS boots
// with no cartridge, Demo puts one in, and its sprite moves on the cursor keys — drawn by the host
// from the video chip's memory ("tms9918").

import { expect, test } from "@playwright/test";

async function run(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "MSX.eeform" }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-screen");
  return page.locator(".formrun-host");
}

const screen = (form) => form.locator(".formrun-screen");
const frames = async (form) => Number((await screen(form).getAttribute("data-frames")) ?? 0);
const pixel = (page, x, y) =>
  page.evaluate(([x, y]) => [...document.querySelector(".formrun-screen").getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)], [x, y]);
const BLUE = [84, 85, 237]; // TMS9918 colour 4, C-BIOS's background
const YELLOW = [230, 206, 128]; // colour 11, the demo's sprite

test("C-BIOS boots, the demo cartridge runs, and the cursor keys move its sprite", async ({ page }) => {
  const form = await run(page);
  await expect.poll(() => frames(form)).toBeGreaterThan(3);
  await expect(screen(form)).toHaveAttribute("data-kind", "tms9918");
  expect(await screen(form).evaluate((c) => [c.width, c.height])).toEqual([256, 192]);
  await expect(form.locator(".formrun-screen-kbtoggle")).toBeHidden();

  // with no cartridge C-BIOS ends on its text screen, in blue
  await expect.poll(() => pixel(page, 250, 185), { timeout: 15_000 }).toEqual(BLUE);

  // the demo: a smiley at (124, 121) — its top row is pixels 126–129
  await form.locator("button", { hasText: "Demo" }).click();
  await expect.poll(() => pixel(page, 127, 121), { timeout: 15_000 }).toEqual(YELLOW);

  await screen(form).click();
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => pixel(page, 127, 121), { timeout: 5000 }).not.toEqual(YELLOW);
  await page.keyboard.up("ArrowRight");

  const a = await frames(form);
  const t0 = Date.now();
  await page.waitForTimeout(2000);
  const fps = ((await frames(form)) - a) / ((Date.now() - t0) / 1000);
  console.log(`msx: ${fps.toFixed(1)} frames/s painted in the browser (real time is 60)`);
  expect(fps).toBeGreaterThan(5);
});
