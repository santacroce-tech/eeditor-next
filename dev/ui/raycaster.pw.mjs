// The raycaster (workspace/examples/Raycaster.eeform) in a real browser over the real engine:
// 320×200 indexed frames, textured walls, sprites, a minimap, and the held keys turning and moving the view.

import { expect, test } from "@playwright/test";

async function run(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Raycaster.eeform" }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-screen");
  return page.locator(".formrun-host");
}

const screen = (form) => form.locator(".formrun-screen");
const frames = async (form) => Number((await screen(form).getAttribute("data-frames")) ?? 0);
const pixel = (page, x, y) =>
  page.evaluate(([x, y]) => [...document.querySelector(".formrun-screen").getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)], [x, y]);
// a cheap fingerprint of the 3D view, below the minimap
const view = (page) =>
  page.evaluate(() => {
    const d = document.querySelector(".formrun-screen").getContext("2d").getImageData(0, 60, 320, 140).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0;
    return h;
  });

test("the raycaster draws its maze, and the keys held turn and move the view", async ({ page }) => {
  const form = await run(page);
  await expect.poll(() => frames(form)).toBeGreaterThan(3);
  await expect(screen(form)).toHaveAttribute("data-kind", "indexed");
  expect(await screen(form).evaluate((c) => [c.width, c.height])).toEqual([320, 200]);

  // the minimap: the corner cell is brick at its brightest tone, the player a white dot at (3.5, 8.5)
  await expect.poll(() => pixel(page, 5, 5)).toEqual([200, 82, 59]);
  expect(await pixel(page, 14, 29)).toEqual([255, 255, 255]);
  // a sprite: the lamp at the far end of the corridor, its globe glowing in the middle column
  expect(await pixel(page, 160, 91)).toEqual([255, 244, 200]);

  // standing still, the view stays the same
  const still = await view(page);
  await page.waitForTimeout(300);
  expect(await view(page)).toBe(still);

  // turning changes it
  await screen(form).click();
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => view(page), { timeout: 5000 }).not.toBe(still);
  await page.keyboard.up("ArrowLeft");

  // walking forward moves the dot on the minimap off where it started
  await page.keyboard.down("ArrowUp");
  await expect.poll(() => pixel(page, 14, 29), { timeout: 5000 }).not.toEqual([255, 255, 255]);
  // walking makes footsteps (or a bump, at a wall) — notes for the host, in the frames
  await expect.poll(async () => Number((await screen(form).getAttribute("data-sounds")) ?? 0), { timeout: 5000 }).toBeGreaterThan(0);
  await page.keyboard.up("ArrowUp");

  const a = await frames(form);
  const t0 = Date.now();
  await page.waitForTimeout(2000);
  const fps = ((await frames(form)) - a) / ((Date.now() - t0) / 1000);
  console.log(`raycaster: ${fps.toFixed(1)} frames/s painted in the browser (asked for 35)`);
  expect(fps).toBeGreaterThan(5);
});
