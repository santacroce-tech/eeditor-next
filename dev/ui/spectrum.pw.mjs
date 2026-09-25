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

// Not Sinclair's ROM — a loop that reads two half-rows of the keyboard and shows the raw bits in the
// top-left of the screen (black ink on white): 0x4000 ← IN (0x7FFE) (SPACE SYMBOL M N B),
// 0x4001 ← IN (0xBFFE) (ENTER L K J H). A clear bit is a key held down.
//   LD HL,0x5800 / LD (HL),0x38 / INC HL / LD (HL),0x38
//   loop: LD A,0x7F / IN A,(0xFE) / LD (0x4000),A / LD A,0xBF / IN A,(0xFE) / LD (0x4001),A / JR loop
const KEYS_ROM = Buffer.alloc(16384);
Buffer.from([0x21, 0x00, 0x58, 0x36, 0x38, 0x23, 0x36, 0x38, 0x3e, 0x7f, 0xdb, 0xfe, 0x32, 0x00, 0x40, 0x3e, 0xbf, 0xdb, 0xfe, 0x32, 0x01, 0x40, 0x18, 0xf0]).copy(KEYS_ROM);

/** The byte the machine last read from a half-row, read back off the canvas: a dark pixel is a 1. */
const shown = (page, i) =>
  page.evaluate((i) => {
    const d = document.querySelector(".formrun-screen").getContext("2d").getImageData(i * 8, 0, 8, 1).data;
    let b = 0;
    for (let x = 0; x < 8; x++) if (d[x * 4] < 100) b |= 0x80 >> x;
    return b;
  }, i);

async function withKeysRom(page) {
  const form = await run(page);
  const chooser = page.waitForEvent("filechooser");
  await ctl(form, "btnRom").locator("button").click();
  await (await chooser).setFiles({ name: "keys.rom", mimeType: "application/octet-stream", buffer: KEYS_ROM });
  await expect.poll(() => shown(page, 0)).toBe(0xbf); // nothing held: 0xA0 | 0x1F
  return form;
}

test("a typed symbol is the Spectrum's: + is SYMBOL SHIFT + K, and Enter stays on the screen", async ({ page }) => {
  const form = await withKeysRom(page);
  const screen = form.locator(".formrun-screen");
  await screen.click();
  await page.keyboard.down("Shift");
  await page.keyboard.down("+");
  await expect.poll(() => shown(page, 0)).toBe(0xbd); // SYMBOL SHIFT (bit 1)
  expect(await shown(page, 1)).toBe(0xbb); // K (bit 2)
  await page.keyboard.up("+");
  await page.keyboard.up("Shift");
  await expect.poll(() => shown(page, 1)).toBe(0xbf);

  // Enter would press a :default button; here it is the Spectrum's ENTER, and the form stays put
  await page.keyboard.down("Enter");
  await expect.poll(() => shown(page, 1)).toBe(0xbe); // ENTER (bit 0)
  await page.keyboard.up("Enter");
  await expect(screen).toBeFocused();
});

test("the on-screen keyboard: ⌨ shows it, SYMBOL SHIFT latches for the next key", async ({ page }) => {
  const form = await withKeysRom(page);
  const board = form.locator(".formrun-zxkb");
  await expect(board).toBeHidden();
  await form.locator(".formrun-screen-kbtoggle").click();
  await expect(board).toBeVisible();
  await expect(board.locator(".zxkb-key")).toHaveCount(40);

  await board.locator('.zxkb-key[data-key="SYMBOL SHIFT"]').click();
  await expect(board.locator('.zxkb-key[data-key="SYMBOL SHIFT"]')).toHaveClass(/latched/);
  await expect.poll(() => shown(page, 0)).toBe(0xbd);
  const k = board.locator('.zxkb-key[data-key="K"]');
  const box = await k.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => shown(page, 1)).toBe(0xbb); // K, with SYMBOL SHIFT still held: +
  expect(await shown(page, 0)).toBe(0xbd);
  await page.mouse.up();
  // the latch let go with the key
  await expect.poll(() => shown(page, 0)).toBe(0xbf);
  await expect(board.locator('.zxkb-key[data-key="SYMBOL SHIFT"]')).not.toHaveClass(/latched/);
  await expect(form.locator(".formrun-screen")).toBeFocused(); // clicking keys never took the focus

  await form.locator(".formrun-screen-kbtoggle").click();
  await expect(board).toBeHidden();
});

test("BASIC: text pasted on the screen, and the editor's Send, go to the machine to be typed", async ({ page }) => {
  const form = await withKeysRom(page);
  await expect(ctl(form, "txtBasic").locator("textarea")).toHaveValue(/10 BORDER 1/);
  await form.locator(".formrun-screen").evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", '10 PRINT "HI"\n20 GO TO 10');
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(ctl(form, "lblStatus")).toHaveText("typing 2 lines");
  await ctl(form, "btnSend").locator("button").click();
  await expect(ctl(form, "lblStatus")).toHaveText("typing 4 lines");
  await ctl(form, "btnRun").locator("button").click();
  await expect(ctl(form, "lblStatus")).toHaveText("typing 1 line");
});
