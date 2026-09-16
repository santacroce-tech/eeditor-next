// What a sheet has to do, driven in a real browser against a real engine: type values and formulas,
// copy cells around, fill, survive a reload, and be findable by search.
//
// One workspace for the file, in order — each test builds on the sheet the one before left.

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/**
 * The key a binding means by "Mod" — ⌘ on macOS, Ctrl everywhere else, which is what the keybindings
 * file resolves it to. The grid's own shortcuts take either, but a binding only fires for its own.
 */
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const SHEET = "Budget.eesheet";

/** Every cell the grid is drawing, in the order it drew them. */
const shown = (page) => page.$$eval(".sheet-cell", (els) => els.map((e) => e.textContent));

/** Select a cell or area by typing into the name box, the way a person jumps somewhere. */
async function go(page, ref) {
  await page.locator(".sheet-namebox").fill(ref);
  await page.locator(".sheet-namebox").press("Enter");
}

/** Type into the selected cell and commit it. */
async function type(page, text) {
  await page.locator(".sheet-scroller").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await settled(page);
}

/**
 * Paste `text` as the browser would deliver it. A synthetic ⌘V doesn't make Chromium paste, and the
 * event lands on the body when what has focus isn't editable — which is exactly what the grid relies
 * on, so this dispatches the event the same way a real paste arrives.
 */
async function paste(page, text) {
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  // The write is queued, and selects what it wrote when it lands: wait, or the next step's selection
  // is the one that loses.
  await settled(page);
}

/** Wait for the grid's pending writes to finish. */
const settled = (page) => page.waitForFunction(() => !document.querySelector(".sheet")?.classList.contains("busy"));

/** What ⌘C put on the clipboard, read from the event itself. */
const copy = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        document.addEventListener("copy", (e) => resolve(e.clipboardData.getData("text/plain")), { once: true });
        document.execCommand("copy");
      }),
  );

async function openSheet(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: SHEET }).click();
  await page.waitForSelector(".sheet-scroller");
}

test("a new sheet takes values and formulas, and dependents follow", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-dir").click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "New sheet…" }).click();
  await page.locator(".dlg-input").fill("Budget");
  await page.locator(".dlg-input").press("Enter");
  await page.waitForSelector(".sheet-scroller");
  await expect(page.locator(".etab.active .etab-label")).toHaveText(SHEET);

  await go(page, "A1");
  await type(page, "rent");
  await go(page, "B1");
  await type(page, "1200");
  await go(page, "A2");
  await type(page, "food");
  await go(page, "B2");
  await type(page, "450");
  await go(page, "A3");
  await type(page, "total");
  await go(page, "B3");
  await type(page, "=(sum B1:B2)");
  await expect.poll(() => shown(page)).toEqual(["rent", "1200", "food", "450", "total", "1650"]);

  // changing what a formula reads recalculates it
  await go(page, "B1");
  await type(page, "1000");
  await expect.poll(() => shown(page)).toEqual(["rent", "1000", "food", "450", "total", "1450"]);
});

test("a copied formula reads where it lands, and undo puts it back", async ({ page }) => {
  await openSheet(page);
  await go(page, "B3");
  await page.locator(".sheet-scroller").focus();
  const clipboard = await copy(page);
  expect(clipboard).toBe("1450"); // the value, for anyone else

  await go(page, "C3");
  await paste(page, clipboard);
  // pasted one column right, the formula adds up column C — which is empty
  await expect(page.locator(".sheet-formula")).toHaveValue("=(sum C1:C2)");
  await expect.poll(() => shown(page)).toContain("0");

  await page.locator(".sheet-scroller").focus();
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator(".sheet-formula")).toHaveValue("");
});

test("text from another program lands as values", async ({ page }) => {
  await openSheet(page);
  await go(page, "D1");
  await paste(page, "alpha\tbeta\ngamma\t42");
  await expect.poll(() => shown(page)).toContain("gamma");
  await go(page, "E2");
  await expect(page.locator(".sheet-formula")).toHaveValue("42");
});

test("the fill handle repeats a formula down a column", async ({ page }) => {
  await openSheet(page);
  await go(page, "A5");
  await paste(page, "1\n2\n3");
  await go(page, "B5");
  await type(page, "=(* A5 10)");
  await go(page, "B5"); // Enter moved on to B6; come back to read what B5 holds
  await expect(page.locator(".sheet-formula")).toHaveValue("=(* A5 10)");

  // drag the handle at the bottom-right of B5 down two rows
  const box = await page.locator(".sheet-scroller").boundingBox();
  const gutter = await page.$eval(".sheet-rowname", (e) => parseFloat(e.style.width));
  const widths = await page.$$eval(".sheet-colname", (els) => els.slice(0, 2).map((e) => parseFloat(e.style.width)));
  const rowH = 24;
  const headH = 24;
  const x = box.x + gutter + widths[0] + widths[1]; // B's right edge
  const handleY = box.y + headH + 5 * rowH; // row 5's bottom edge — where the handle sits
  const middleOfRow = (row) => box.y + headH + (row - 1) * rowH + rowH / 2;
  await page.mouse.move(x, handleY);
  await page.mouse.down();
  await page.mouse.move(x - 10, middleOfRow(7));
  await page.mouse.up();

  await go(page, "B7");
  await expect(page.locator(".sheet-formula")).toHaveValue("=(* A7 10)");
  await expect.poll(() => shown(page)).toContain("30");
});

test("a sheet reopens with its values, and search finds a cell in it", async ({ page }) => {
  await openSheet(page);
  await expect.poll(() => shown(page)).toContain("1450");

  // the search modal is a keybinding away, and a hit in a sheet lands on the cell
  await page.keyboard.press(`${MOD}+Shift+f`);
  await page.locator(".search-panel .qo-input").fill("food");
  await expect(page.locator(".search-loc").first()).toHaveText(`${SHEET}:A2`);
  await page.locator(".search-row").first().click();
  await expect(page.locator(".etab.active .etab-label")).toHaveText(SHEET);
  await expect(page.locator(".sheet-namebox")).toHaveValue("A2");
});

test("a number typed the way people write one arrives with its format", async ({ page }) => {
  await openSheet(page);
  await go(page, "D5");
  await type(page, "50%");
  await go(page, "D6");
  await type(page, "$1,200");
  const cells = await shown(page);
  expect(cells).toContain("50%");
  expect(cells.some((c) => c.includes("1,200"))).toBe(true); // the currency symbol follows the locale
  // what was typed is what the cell keeps
  await go(page, "D5");
  await expect(page.locator(".sheet-formula")).toHaveValue("50%");
});

test("a sheet exports as CSV and imports back", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: SHEET }).click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "Export as CSV" }).click();
  await expect(page.locator(".tree-file", { hasText: "Budget.csv" })).toBeVisible();

  await page.locator(".tree-file", { hasText: "Budget.csv" }).click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "Import as sheet" }).click();
  await page.waitForSelector(".sheet-scroller");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("Budget-1.eesheet");
  // the values came across; the formula arrived as what it worked out to
  await expect.poll(() => shown(page)).toContain("1450");
});
