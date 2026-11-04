// The MSX (workspace/examples/MSX.eeform) in a real browser over the real engine: C-BIOS boots
// with no cartridge, Demo puts one in, its sprite moves on the cursor keys — drawn by the host
// from the video chip's memory ("tms9918") — and Space plays a note on the PSG.

import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function run(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "MSX.eeform" }).click();
  // forms open running — the default (forms-open "run")
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

  // Space: the cartridge plays a note on the PSG, and the frames carry its samples
  expect(await screen(form).getAttribute("data-sounds")).toBeNull();
  await page.keyboard.down("Space");
  await expect.poll(async () => Number((await screen(form).getAttribute("data-sounds")) ?? 0), { timeout: 5000 }).toBeGreaterThan(3);
  await page.keyboard.up("Space");

  // Snake: the tutorial's game — its title, then Space starts it on a field of bricks
  await form.locator("button", { hasText: "Snake" }).click();
  await expect(form.getByText("snake: press Space")).toBeVisible();
  const BRICK = [212, 82, 77]; // colour 6, the wall's bricks
  await expect.poll(() => pixel(page, 2, 9), { timeout: 15_000 }).toEqual(BRICK);
  await screen(form).click();
  await page.keyboard.press("Space");
  // the snake's head starts at cell (11, 12) and heads right
  await expect.poll(() => pixel(page, 13 * 8 + 4, 12 * 8 + 4), { timeout: 5000 }).not.toEqual([0, 0, 0]);

  const a = await frames(form);
  const t0 = Date.now();
  await page.waitForTimeout(2000);
  const fps = ((await frames(form)) - a) / ((Date.now() - t0) / 1000);
  console.log(`msx: ${fps.toFixed(1)} frames/s painted in the browser (real time is 60)`);
  expect(fps).toBeGreaterThan(5);
});

test("a cartridge over 32 KB gets a mapper — guessed, or the one Mapper says", async ({ page }) => {
  const form = await run(page);
  // 128 KB whose code writes to Konami SCC's bank addresses (LD (0x9000),A; LD (0xB000),A)
  const rom = Buffer.alloc(0x20000, 0);
  rom.set([0x41, 0x42, 0x10, 0x40], 0);
  rom.set([0x32, 0x00, 0x90, 0x32, 0x00, 0xb0, 0x32, 0x00, 0x50, 0x18, 0xfe], 0x10);
  const file = join(mkdtempSync(join(tmpdir(), "msx-")), "big.rom");
  writeFileSync(file, rom);
  const chooser = page.waitForEvent("filechooser");
  await form.locator("button", { hasText: "Load cartridge" }).click();
  await (await chooser).setFiles(file);
  await expect(form.getByText("big.rom · konami-scc")).toBeVisible();
  await form.locator("select").selectOption("ascii16");
  await expect(form.getByText("big.rom · ascii16")).toBeVisible();
  await expect.poll(() => frames(form)).toBeGreaterThan(3);
});
