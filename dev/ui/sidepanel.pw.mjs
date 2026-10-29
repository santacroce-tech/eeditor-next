// (panel "agenda" "pim/Side.eeform") — a form drawn in the sidebar's agenda section, in a real browser
// against a real engine, with the PIM loaded the way the install writes it: the form takes the
// built-in list's place and stretches to the section; its box adds, its categories filter, ✓
// finishes; the REPL changing the agenda reruns its :on-refresh; another name makes a section of its
// own; and with the line gone, the built-in list is back.
//
// The config and forms are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";
let pim = "";

test.beforeAll(async () => {
  pim = await readFile("docs/pim/pim.eelisp", "utf8");
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/pim`, { recursive: true });
  await writeFile(CONFIG, `${pim}\n(on-start (ed-open "welcome.md"))\n`);
  await writeFile(`${UI_WORKSPACE}/pim/Side.eeform`, await readFile("docs/pim/Side.eeform", "utf8"));
  await writeFile(`${UI_WORKSPACE}/pim/Agenda.eeform`, await readFile("docs/pim/Agenda.eeform", "utf8"));
  await writeFile(
    `${UI_WORKSPACE}/pim/Count.eeform`,
    `(form "Count" :size (224 48) :on-load cnt-fill :on-refresh cnt-fill
  (label lblCount :at (8 8) :size (208 24) :anchor "tlr"))
(defn cnt-fill (f) (ui-set "lblCount" :text (str (item-count) " items")))
`,
  );
});

test.afterAll(async () => {
  await rm(CONFIG, { force: true });
  await rm(`${UI_WORKSPACE}/pim`, { recursive: true, force: true });
});

const panel = (page) => page.locator(".agenda-section .formrun.embedded");
const ctl = (page, name) => panel(page).locator(`.formrun-ctl[data-name="${name}"]`);
const rows = (page) => ctl(page, "grdItems").locator("tbody tr");

async function repl(page, src) {
  const input = page.locator(".repl-input");
  if (!(await input.isVisible())) await page.locator(".head-btn", { hasText: "λ" }).click();
  await input.fill(src);
  await input.press(`${MOD}+Enter`);
}

test("the form takes the agenda's place, as wide as the sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".agenda-section .agenda-add")).toBeHidden();
  await expect(panel(page).locator(".formrun-title")).toBeHidden();
  await expect(ctl(page, "lstCats").locator(".formrun-item").first()).toHaveText(/^all · \d+$/);
  const section = await page.locator(".agenda-section").boundingBox();
  const grid = await ctl(page, "grdItems").boundingBox();
  expect(grid.width).toBeGreaterThan(section.width - 24); // anchored left and right: it stretched
});

test("its box adds, a category lists its own, ✓ finishes", async ({ page }) => {
  await page.goto("/");
  await ctl(page, "txtAdd").locator("input").fill("water the ficus sidez #plants");
  await ctl(page, "txtAdd").locator("input").press("Enter");
  await expect(rows(page).filter({ hasText: "water the ficus sidez" })).toHaveCount(1);
  await expect(ctl(page, "txtAdd").locator("input")).toHaveValue("");

  const plants = ctl(page, "lstCats").locator(".formrun-item", { hasText: /^plants · 1$/ });
  await plants.click();
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().click();
  await ctl(page, "btnDone").locator("button").click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(".toast").last()).toContainText("Done: #");
});

test("the REPL adding an item reruns :on-refresh; another name is a section of its own", async ({ page }) => {
  await writeFile(CONFIG, `${pim}\n(panel "Count" "pim/Count")\n(on-start (ed-open "welcome.md"))\n`);
  await page.goto("/");
  const count = page.locator(".side-panel-section .formrun-ctl[data-name=lblCount]");
  await expect(page.locator(".side-panel-section .side-head")).toContainText("Count");
  await expect(count).toHaveText(/^\d+ items$/);
  const before = Number((await count.textContent()).split(" ")[0]);
  await ctl(page, "lstCats").locator(".formrun-item").first().click(); // back to every item
  await repl(page, '(add "from the repl sidez")');
  await expect(rows(page).filter({ hasText: "from the repl sidez" })).toHaveCount(1);
  await expect(count).toHaveText(`${before + 1} items`);
});

test("without the line, the built-in list is back", async ({ page }) => {
  await writeFile(CONFIG, `${pim.replace(/^\(panel "agenda".*$/m, "")}\n(on-start (ed-open "welcome.md"))\n`);
  await page.goto("/");
  await expect(page.locator(".agenda-section .agenda-add")).toBeVisible();
  await expect(page.locator(".ag-item .ag-text", { hasText: "from the repl sidez" })).toHaveCount(1);
  await expect(panel(page)).toHaveCount(0);
});
