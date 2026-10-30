// ⌘P's actions, in a real browser against a real engine: ">" (or ⌘⇧P) lists the app's commands,
// every key named by the comment above its (bind …), (action …)s and the folder's forms; typing
// narrows them, Enter runs one in the note in front, and the one picked comes first next time.
// Backspacing the ">" is the file finder again.
//
// The config, form and note are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const NOTE = `${UI_WORKSPACE}/pal-note.md`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const KEYS = `
(bind "Mod-p" (ed-cmd "quick-open"))
(bind "Mod-Shift-p" (ed-cmd "command-palette"))
;; ⌘⌥J — stamp the caret's line with the word palx
(bind "Mod-Alt-j" (ed-replace-range *line-from* *line-to* (str *line-text* " palx")))
(action "Insert the palz greeting" (ed-insert "hello palz"))
(on-start (ed-open "pal-note.md"))
`;

test.beforeAll(async () => {
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/palf`, { recursive: true });
  await writeFile(CONFIG, KEYS);
  await writeFile(NOTE, "first line\n");
  await writeFile(`${UI_WORKSPACE}/palf/Palform.eeform`, `(form "Palform" :size (200 80)\n  (label lblHi :text "palform here" :at (8 8) :size (180 24)))\n`);
});

test.afterAll(async () => {
  await rm(CONFIG, { force: true });
  await rm(NOTE, { force: true });
  await rm(`${UI_WORKSPACE}/palf`, { recursive: true, force: true });
});

const input = (page) => page.locator(".quick-open .qo-input");
const rows = (page) => page.locator(".quick-open .qo-row");

test("> lists the actions: a key by its comment, with its key; Enter runs it in the note", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("pal-note.md");
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+p`);
  await expect(input(page)).toBeFocused();
  await input(page).fill(">stamp");
  await expect(rows(page).first().locator(".qo-title")).toHaveText("Stamp the caret's line with the word palx");
  await expect(rows(page).first().locator(".qo-key")).toHaveText(process.platform === "darwin" ? "⌘⌥J" : "Ctrl+Alt+J");
  await input(page).press("Enter");
  await expect(page.locator(".quick-open")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("first line palx");
});

test("⌘⇧P opens on the actions: an (action …), a form, an app command", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("pal-note.md");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press(`${MOD}+Shift+p`);
  await expect(input(page)).toHaveValue(">");
  await page.keyboard.type("palz");
  await expect(rows(page)).toHaveCount(1);
  await input(page).press("Enter");
  await expect(page.locator(".cm-content")).toContainText("hello palz");

  await page.keyboard.press(`${MOD}+Shift+p`);
  await page.keyboard.type("palform");
  await expect(rows(page).first().locator(".qo-title")).toHaveText("Run form: Palform");
  await input(page).press("Enter");
  await expect(page.locator(".formwin .formrun-name", { hasText: "Palform" })).toBeVisible();

  await page.keyboard.press(`${MOD}+Shift+p`);
  await page.keyboard.type("new mind");
  await expect(rows(page).first().locator(".qo-title")).toHaveText("New mind map");
  await page.keyboard.press("Escape");
  await expect(page.locator(".quick-open")).toBeHidden();
});

test("the one picked last comes first; backspacing the > is the file finder again", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("pal-note.md");
  await page.keyboard.press(`${MOD}+Shift+p`);
  await page.keyboard.type("new folder");
  await expect(rows(page).first().locator(".qo-title")).toHaveText("New folder");
  await page.keyboard.press("Escape"); // closing isn't picking
  await page.keyboard.press(`${MOD}+Shift+p`);
  await page.keyboard.type("palz");
  await input(page).press("Enter");
  await page.keyboard.press(`${MOD}+Shift+p`);
  await expect(rows(page).first().locator(".qo-title")).toHaveText("Insert the palz greeting");
  await page.keyboard.press("Backspace");
  await expect(input(page)).toHaveValue("");
  await page.keyboard.type("pal-no");
  await expect(rows(page).first()).toHaveText("pal-note.md");
  await page.keyboard.press("Escape");
  await expect.poll(() => readFile(NOTE, "utf8")).toContain("hello palz");
});
