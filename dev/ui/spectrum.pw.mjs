// The ZX Spectrum in a form (workspace/examples/Spectrum.eeform), in a real browser over the real
// engine: the screen control paints what the EELisp machine draws, a picked ROM boots, and the
// keys go to the machine rather than the form.

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function run(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Spectrum.eeform" }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-screen");
  return page.locator(".formrun-host");
}

const ctl = (form, name) => form.locator(`.formrun-ctl[data-name=${name}]`);
const frames = async (form) => Number((await form.locator(".formrun-screen").getAttribute("data-frames")) ?? 0);
/** The RGB of one pixel of the Spectrum's 256×192 picture. */
const pixel = (page, x, y) =>
  page.evaluate(([x, y]) => [...document.querySelector(".formrun-screen").getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)], [x, y]);

test("Demo runs a Z80 program with no ROM: the bars paint, the border changes, frames keep coming", async ({ page }) => {
  const form = await run(page);
  await expect(ctl(form, "lblStatus")).toHaveText("no ROM");
  await ctl(form, "btnDemo").locator("button").click();
  await expect(ctl(form, "lblStatus")).toHaveText("demo");
  await expect.poll(() => frames(form)).toBeGreaterThan(5);

  // the first cell's paper, then the next one's: colour bars, not a black screen
  await expect.poll(() => pixel(page, 12, 4)).not.toEqual([0, 0, 0]);
  const border = await ctl(form, "scrZX").evaluate((e) => e.style.background);
  await expect.poll(() => ctl(form, "scrZX").evaluate((e) => e.style.background), { timeout: 5000 }).not.toBe(border);

  // the frame rate, as the page sees it: the machine, the engine round trip and the painting
  const a = await frames(form);
  const t0 = Date.now();
  await page.waitForTimeout(3000);
  const fps = ((await frames(form)) - a) / ((Date.now() - t0) / 1000);
  console.log(`spectrum: ${fps.toFixed(1)} frames/s painted in the browser (real time is 50)`);
  expect(fps).toBeGreaterThan(5);

  // Pause stops the frames; Resume starts them again
  await ctl(form, "btnPause").locator("button").click();
  await page.waitForTimeout(300);
  const held = await frames(form);
  await page.waitForTimeout(500);
  expect(await frames(form)).toBe(held);
  await ctl(form, "btnPause").locator("button").click();
  await expect.poll(() => frames(form)).toBeGreaterThan(held);
});

test("Load ROM… picks a file and the machine boots from it", async ({ page }) => {
  const form = await run(page);
  // Not Sinclair's ROM — 16 KB whose first instructions draw a white bar in the top-left cell:
  //   LD HL,0x5800 / LD (HL),0x07 / LD A,0xFF / LD (0x4000),A / JR $
  const rom = Buffer.alloc(16384);
  Buffer.from([0x21, 0x00, 0x58, 0x36, 0x07, 0x3e, 0xff, 0x32, 0x00, 0x40, 0x18, 0xfe]).copy(rom);
  const chooser = page.waitForEvent("filechooser");
  await ctl(form, "btnRom").locator("button").click();
  await (await chooser).setFiles({ name: "test.rom", mimeType: "application/octet-stream", buffer: rom });
  await expect(ctl(form, "lblStatus")).toHaveText("running");
  await expect.poll(() => pixel(page, 0, 0)).toEqual([215, 215, 215]);
  expect(await pixel(page, 8, 0)).toEqual([0, 0, 0]);

  // a file that isn't a ROM is refused, and says why
  const again = page.waitForEvent("filechooser");
  await ctl(form, "btnRom").locator("button").click();
  await (await again).setFiles({ name: "small.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(10) });
  await expect(page.locator(".toast").last()).toContainText("a 48K ROM is 16384");
});

test("keys held on the screen go to the machine, not to the form", async ({ page }) => {
  const form = await run(page);
  await ctl(form, "btnDemo").locator("button").click();
  const screen = form.locator(".formrun-screen");
  await screen.click();
  await expect(screen).toBeFocused();
  // Enter would press a :default button; here it is the Spectrum's ENTER, and the form stays put
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(screen).toBeFocused();
  await expect(form.locator(".formrun-ctl.screen")).toHaveCount(1);
});
