// A frame: forms opened with (ui-open "X" :in "frmBody") run inside the main form — one screen at a
// time the dBASE way (the others stay open, a Window menu switches), or as tabs, or as windows.

import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const main = (mode) => `(form "Main" :size (640 420) :on-load main-load :on-public main-heard :menu (("Go" ("Picker" go-picker)))
  (listbox lstNav :items ("Picker" "Notes") :at (8 8) :size (140 160) :on-change main-go)
  (button btnHome :text "Home" :default true :at (8 176) :size (140 30) :on-click main-home)
  (label lblCart :at (8 216) :size (140 24))
  (label lblShowing :at (8 246) :size (140 24))
  (label lblHome :at (8 276) :size (140 24))
  (frame frmBody :mode "${mode}" :at (156 8) :size (476 404) :on-change main-switched))

(public cart '())
(defn main-load (f) (ui-set "lblCart" :text "cart: 0"))
(defn main-go (f) (ui-open (str "frames/" (ui-get f "lstNav")) :in "frmBody"))
(defn go-picker (f) (ui-open "frames/Picker" :in "frmBody"))
(defn main-heard (f) (ui-set "lblCart" :text (str "cart: " (length (var "cart")))))
(defn main-switched (f) (ui-set "lblShowing" :text (str "showing " (ui-get f "frmBody"))))
(defn main-home (f) (ui-set "lblHome" :text "Home pressed"))
`;

const PICKER = `(form "Picker" :size (300 200)
  (button btnAdd :text "Add a book" :at (16 16) :size (120 30) :on-click pick-add)
  (button btnNotes :text "Notes" :at (16 56) :size (120 30) :on-click pick-notes)
  (button btnDone :text "Done" :at (16 96) :size (120 30) :on-click pick-done))
(defn pick-add (f) (var! "cart" (cons "book" (var "cart"))))
(defn pick-notes (f) (ui-open "frames/Notes" :in "frmBody"))
(defn pick-done (f) (ui-close))
`;

const NOTES = `(form "Notes" :size (300 160)
  (textbox txtNote :at (16 16) :size (260 28))
  (button btnClose :text "Close" :at (16 56) :size (120 30) :on-click notes-close))
(defn notes-close (f) (ui-close))
`;

test.beforeAll(() => {
  mkdirSync(`${UI_WORKSPACE}/frames`, { recursive: true });
  writeFileSync(`${UI_WORKSPACE}/frames/Main.eeform`, main("screens"));
  writeFileSync(`${UI_WORKSPACE}/frames/MainTabs.eeform`, main("tabs").replace('"Main"', '"MainTabs"'));
  writeFileSync(`${UI_WORKSPACE}/frames/MainWindows.eeform`, main("windows").replace('"Main"', '"MainWindows"'));
  writeFileSync(`${UI_WORKSPACE}/frames/Picker.eeform`, PICKER);
  writeFileSync(`${UI_WORKSPACE}/frames/Notes.eeform`, NOTES);
});

const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function runMain(page, name) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: `${name}.eeform` }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-host .formrun-ctl[data-name=frmBody]");
  return page.locator(".formrun-host");
}
const frame = (host) => host.locator(".formrun-ctl[data-name=frmBody]");
const inFrame = (host) => frame(host).locator(".formrun.in-frame");
const pick = (host, item) => host.locator(".formrun-ctl[data-name=lstNav] .formrun-item", { hasText: item }).click();
async function windowMenu(page, host, item) {
  await host.locator(".formrun-menubar").first().locator(".formrun-menu", { hasText: "Window" }).click();
  await page.locator(".formrun-menulist .formrun-menuitem", { hasText: item }).first().click();
}

test("screens: one form at a time, the others kept, a Window menu to switch", async ({ page }) => {
  const host = await runMain(page, "Main");
  await expect(host.locator(".formrun-menu", { hasText: "Window" })).toHaveCount(0); // nothing open yet

  await pick(host, "Picker");
  await expect(inFrame(host)).toHaveCount(1);
  await expect(host.locator(".formrun-ctl[data-name=lblShowing]")).toHaveText("showing Picker");

  // a form in the frame shares the main form's public variables, and the main form hears it write
  await frame(host).locator(".formrun-ctl[data-name=btnAdd] button").click();
  await frame(host).locator(".formrun-ctl[data-name=btnAdd] button").click();
  await expect(host.locator(".formrun-ctl[data-name=lblCart]")).toHaveText("cart: 2");

  // a form in the frame opens another into the same frame; one screen shows at a time
  await frame(host).locator(".formrun-ctl[data-name=btnNotes] button").click();
  await expect(inFrame(host)).toHaveCount(2);
  await expect(inFrame(host).filter({ visible: true })).toHaveCount(1);
  await expect(host.locator(".formrun-ctl[data-name=lblShowing]")).toHaveText("showing Notes");
  await frame(host).locator(".formrun-ctl[data-name=txtNote] input").fill("hello");

  // Enter in a form inside the frame is that form's: the main form's default button stays unpressed
  await frame(host).locator(".formrun-ctl[data-name=txtNote] input").press("Enter");
  await expect(host.locator(".formrun-ctl[data-name=lblHome]")).toHaveText("");

  // switch away and back: what was typed is still there — the screen was kept, not rebuilt
  await windowMenu(page, host, "Picker");
  await expect(frame(host).locator(".formrun-ctl[data-name=btnAdd]")).toBeVisible();
  await windowMenu(page, host, "Notes");
  await expect(frame(host).locator(".formrun-ctl[data-name=txtNote] input")).toHaveValue("hello");

  // opening one that's open brings it forward, rather than a second copy (Go → Picker: the list
  // still has Picker picked, so clicking it again changes nothing)
  await host.locator(".formrun-menubar").first().locator(".formrun-menu", { hasText: "Go" }).click();
  await page.locator(".formrun-menulist .formrun-menuitem", { hasText: "Picker" }).click();
  await expect(inFrame(host)).toHaveCount(2);
  await expect(frame(host).locator(".formrun-ctl[data-name=btnAdd]")).toBeVisible();

  // ⌃Tab to the next
  await frame(host).locator(".formrun-ctl[data-name=btnAdd] button").focus();
  await page.keyboard.press("Control+Tab");
  await expect(frame(host).locator(".formrun-ctl[data-name=txtNote] input")).toBeVisible();

  // closing one goes back to the one before it
  await frame(host).locator(".formrun-ctl[data-name=btnClose] button").click();
  await expect(inFrame(host)).toHaveCount(1);
  await expect(frame(host).locator(".formrun-ctl[data-name=btnAdd]")).toBeVisible();
  // …and the Window menu's Close does the same as the form's own (ui-close)
  await windowMenu(page, host, "Close Picker");
  await expect(inFrame(host)).toHaveCount(0);
  await expect(host.locator(".formrun-menu", { hasText: "Window" })).toHaveCount(0);
});

test("stopping the main form closes the forms in its frame", async ({ page }) => {
  const host = await runMain(page, "Main");
  await pick(host, "Picker");
  await pick(host, "Notes");
  await expect(inFrame(host)).toHaveCount(2);
  await host.locator(".formrun-stop").first().click();
  await expect(page.locator(".formrun.in-frame")).toHaveCount(0);
});

test("tabs: a tab per form, × closes one", async ({ page }) => {
  const host = await runMain(page, "MainTabs");
  await pick(host, "Picker");
  await pick(host, "Notes");
  const tabs = frame(host).locator(".formrun-frametab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs.filter({ hasText: "Notes" })).toHaveClass(/active/);
  await tabs.filter({ hasText: "Picker" }).locator(".formrun-frametab-label").click();
  await expect(frame(host).locator(".formrun-ctl[data-name=btnAdd]")).toBeVisible();
  await tabs.filter({ hasText: "Picker" }).locator(".formrun-frametab-close").click();
  await expect(tabs).toHaveCount(1);
  await expect(frame(host).locator(".formrun-ctl[data-name=txtNote]")).toBeVisible();
});

test("windows: every form shows, each in a window of its own inside the frame", async ({ page }) => {
  const host = await runMain(page, "MainWindows");
  await pick(host, "Picker");
  await pick(host, "Notes");
  await expect(inFrame(host).filter({ visible: true })).toHaveCount(2);
  await expect(inFrame(host).locator(".formrun-title").first()).toBeVisible();
});
