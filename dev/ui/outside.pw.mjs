// A folder outside the workspace, granted to it — here by the bridge's EEDITOR_ROOTS, as ~Outside;
// in the desktop app by ⋯ → Add a folder outside the workspace…. EELisp reads it as ~Outside/…,
// the file commands move and copy in and out of it, a note in it opens in a tab and saves back,
// and Files.eeform shows it at the top of each panel. Nothing names a folder that wasn't granted,
// or climbs out of one that was.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { UI_OUTSIDE, UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const there = (p) => stat(p).then(() => true, () => false);

const config = `
(bind "Ctrl-Alt-l" (ed-message (str-join " " (map (fn (e) (dict-get e :path)) (dir-list "~Outside")))))
(bind "Ctrl-Alt-r" (ed-message (str (roots))))
(bind "Ctrl-Alt-i" (ed-move "ot/in.md" "~Outside/in.md"))
(bind "Ctrl-Alt-o" (ed-copy "~Outside/report.md" "ot/report.md"))
(bind "Ctrl-Alt-e" (ed-move "ot/x.md" "~Outside/../escaped.md"))
(bind "Ctrl-Alt-n" (ed-move "ot/x.md" "~Nowhere/x.md"))
(bind "Ctrl-Alt-p" (ed-open "~Outside/report.md"))
(forms-open "run")
`;

test.beforeAll(async () => {
  await mkdir(`${UI_OUTSIDE}/sub`, { recursive: true });
  await writeFile(`${UI_OUTSIDE}/report.md`, "# Report\n");
  await mkdir(`${UI_WORKSPACE}/ot`, { recursive: true });
  await writeFile(`${UI_WORKSPACE}/ot/in.md`, "# In\n");
  await writeFile(`${UI_WORKSPACE}/ot/x.md`, "# X\n");
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await writeFile(CONFIG, config);
});

test.afterAll(async () => {
  await rm(`${UI_WORKSPACE}/ot`, { recursive: true, force: true });
  await rm(CONFIG, { force: true });
  for (const f of ["in.md", "sub", "report.md"]) await rm(`${UI_OUTSIDE}/${f}`, { recursive: true, force: true });
});

async function press(page, key) {
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press(key);
}
const toast = (page, text) => page.locator(".toast").filter({ hasText: text });

test("EELisp reads the granted folder as ~Outside/…", async ({ page }) => {
  await page.goto("/");
  await press(page, "Control+Alt+r");
  await expect(toast(page, "~Outside")).toBeVisible();
  await press(page, "Control+Alt+l");
  await expect(toast(page, "~Outside/sub ~Outside/report.md")).toBeVisible();
});

test("files move into it and copy out of it; nothing escapes it, nothing ungranted is reached", async ({ page }) => {
  await page.goto("/");
  await press(page, "Control+Alt+i");
  await expect.poll(() => there(`${UI_OUTSIDE}/in.md`)).toBe(true);
  expect(await there(`${UI_WORKSPACE}/ot/in.md`)).toBe(false);
  await press(page, "Control+Alt+o");
  await expect.poll(() => there(`${UI_WORKSPACE}/ot/report.md`)).toBe(true);
  expect(await there(`${UI_OUTSIDE}/report.md`)).toBe(true);

  await press(page, "Control+Alt+e");
  await expect(toast(page, "escapes workspace")).toBeVisible();
  await press(page, "Control+Alt+n");
  await expect(toast(page, "no folder by that name")).toBeVisible();
  expect(await there(`${UI_WORKSPACE}/ot/x.md`)).toBe(true);
});

test("a note in it opens in a tab and saves back there", async ({ page }) => {
  await page.goto("/");
  await press(page, "Control+Alt+p");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("report.md");
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("\nmore");
  await page.keyboard.press(`${MOD}+s`);
  await expect.poll(() => readFile(`${UI_OUTSIDE}/report.md`, "utf8")).toContain("more");
});

test("Files shows it at the top of a panel, and moves into it", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Files.eeform" }).click();
  // this spec's keybindings say (forms-open "run"): no question, it runs
  const form = page.locator(".formrun-host");
  const grid = (side) => form.locator(`.formrun-ctl[data-name=${side === "left" ? "grdLeft" : "grdRight"}]`);
  const label = (side) => form.locator(`.formrun-ctl[data-name=${side === "left" ? "lblLeft" : "lblRight"}]`);
  const cell = (side, t) => grid(side).locator("td", { hasText: new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\/~]/g, "\\$&")}$`) });
  for (const side of ["left", "right"]) {
    await grid(side).locator("tbody tr").first().click();
    for (let i = 0; i < 6 && (await label(side).textContent()) !== "/"; i++) {
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(50);
    }
  }
  // the granted folder comes first at the top
  await expect(grid("left").locator("tbody tr td:first-child").first()).toHaveText("~Outside/");
  await cell("right", "~Outside/").dblclick();
  await expect(label("right")).toHaveText("~Outside");
  await cell("left", "ot/").dblclick();
  await cell("left", "x.md").click();
  await page.keyboard.press(`${MOD}+ArrowRight`);
  await expect(cell("right", "x.md")).toBeVisible();
  expect(await there(`${UI_OUTSIDE}/x.md`)).toBe(true);
  await rm(`${UI_OUTSIDE}/x.md`, { force: true });
  // ⌫ from the granted folder goes back to the top
  await grid("right").locator("tbody tr").first().click();
  await page.keyboard.press("Backspace");
  await expect(label("right")).toHaveText("/");
});
