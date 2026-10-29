// pim/TRYME.eeform — the PIM as one window — in a real browser against a real engine, with the PIM
// loaded the way the install writes it: ⤢ on the agenda opens it maximized and the grid fills the
// room; ⤢ again gives the room back. Each page does what its key does: quick add, edit, done; a
// note's unlinked "- [ ]" linked; capture into the inbox; clock in and out; the tracker; the review.
//
// The config and notes are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const NOTE = `${UI_WORKSPACE}/tm-plans.md`;

test.beforeAll(async () => {
  const pim = await readFile("docs/pim/pim.eelisp", "utf8");
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/pim`, { recursive: true });
  await writeFile(CONFIG, `${pim}\n(on-start (ed-open "welcome.md"))\n`);
  await writeFile(`${UI_WORKSPACE}/pim/TRYME.eeform`, await readFile("docs/pim/TRYME.eeform", "utf8"));
  await writeFile(NOTE, "# Plans\n\n- [ ] repaint the fence tmz\n");
});

test.afterAll(async () => {
  await rm(CONFIG, { force: true });
  await rm(`${UI_WORKSPACE}/pim`, { recursive: true, force: true });
  await rm(NOTE, { force: true });
});

const win = (page) => page.locator(".formwin", { hasText: "Try the PIM" });
const ctl = (page, name) => win(page).locator(`.formrun-ctl[data-name="${name}"]`);
const tab = (page, name) => win(page).locator(".formrun-tab", { hasText: name });
const status = (page, name) => ctl(page, name).locator(".formrun-label");

async function open(page) {
  await page.goto("/");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("welcome.md");
  await page.locator(".agenda-section .side-btn", { hasText: "⤢" }).click();
  await expect(win(page)).toBeVisible();
}

test("⤢ opens it maximized, the grid takes the room, and ⤢ gives it back", async ({ page }) => {
  await open(page);
  await expect(win(page)).toHaveClass(/maximized/);
  const grid = ctl(page, "grdItems");
  const big = (await grid.boundingBox()).width;
  expect(big).toBeGreaterThan(660);
  // the right-hand editor moved with the right edge
  const vp = page.viewportSize();
  const save = await ctl(page, "btnSave").boundingBox();
  expect(save.x).toBeGreaterThan(vp.width - 400);

  await win(page).locator(".formrun-max").click();
  await expect(win(page)).not.toHaveClass(/maximized/);
  await expect.poll(async () => (await grid.boundingBox()).width).toBeLessThan(big);
  await win(page).locator(".formrun-title").dblclick();
  await expect(win(page)).toHaveClass(/maximized/);
});

test("Start here says the PIM is loaded and lists the keys", async ({ page }) => {
  await open(page);
  await tab(page, "Start here").click();
  await expect(ctl(page, "txtCheck").locator("textarea")).toHaveValue(/✓ the PIM is loaded/);
  await expect(ctl(page, "grdKeys")).toContainText("⌘⌥T");
});

test("Agenda: quick add with #tags, edit, done", async ({ page }) => {
  await open(page);
  const quick = ctl(page, "txtQuick").locator("input");
  await quick.fill("water the ferns tmz tomorrow !! #home | the big ones");
  await quick.press("Tab");
  await expect(status(page, "lblParsed")).toContainText("priority 2");
  await ctl(page, "btnQuick").locator("button").click();
  await expect(status(page, "lblStatus")).toContainText("Added #");
  const row = ctl(page, "grdItems").locator("tr", { hasText: "water the ferns tmz" });
  await expect(row).toContainText("home");
  await row.click();
  await expect(ctl(page, "txtNotes").locator("textarea")).toHaveValue("the big ones");
  await ctl(page, "btnDone").locator("button").click();
  await expect(status(page, "lblStatus")).toContainText("Done ✓");
  await expect(ctl(page, "grdItems").locator("tr", { hasText: "water the ferns tmz" })).toHaveCount(0);
});

test("In notes: an unlinked line is listed and linked", async ({ page }) => {
  await open(page);
  await tab(page, "In notes").click();
  const row = ctl(page, "grdNoteTasks").locator("tr", { hasText: "repaint the fence tmz" });
  await row.click();
  await ctl(page, "btnLink").locator("button").click();
  await expect(status(page, "lblLinkStatus")).toContainText("In the agenda");
  await expect.poll(() => readFile(NOTE, "utf8")).toMatch(/- \[ \] repaint the fence tmz \{#\d+\}/);
  await expect(row).toHaveCount(0);
});

test("Capture, Clock, Tracker and Review do what their keys do", async ({ page }) => {
  await open(page);
  await tab(page, "Capture").click();
  await ctl(page, "optKind").getByText("inbox").click();
  await ctl(page, "txtCap").locator("input").fill("ask about solar tmz");
  await ctl(page, "btnCap").locator("button").click();
  await expect(ctl(page, "grdInbox")).toContainText("ask about solar tmz");

  await tab(page, "Clock").click();
  await ctl(page, "txtClockTask").locator("input").fill("write the tmz report");
  await ctl(page, "btnClockIn").locator("button").click();
  await expect(status(page, "lblClockNow")).toContainText("write the tmz report");
  await ctl(page, "btnClockOut").locator("button").click();
  await expect(status(page, "lblClockNow")).toContainText("no clock running");

  await tab(page, "Tracker").click();
  await ctl(page, "btnCoffee").locator("button").click();
  await expect(status(page, "lblLogStatus")).toContainText("Logged coffee 1");
  await expect(ctl(page, "grdLog")).toContainText("coffee");

  await tab(page, "Review").click();
  await expect(ctl(page, "txtReview").locator("textarea")).toHaveValue(/## Agenda — overdue and the next 7 days/);
  await expect(ctl(page, "txtReview").locator("textarea")).toHaveValue(/## Tracker this week[\s\S]*drink 1/);
});
