// What a keybinding config can do beyond the note in front, in a real browser against a real
// engine: (on-load …) definitions that come back on every reload, (on-tick …) once a minute,
// *line-from* / *line-to*, writing and appending to notes open or not, a prompt that calls back,
// and a form handing editor commands to the app with (ui-editor …).
//
// The config is written for this spec and removed after it, so the other specs get the defaults.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const disk = (p) => readFile(`${UI_WORKSPACE}/${p}`, "utf8");
/** The note in front, one line per line: innerText doubles the newline of an empty line. */
const buffer = async (page) => (await page.locator(".editor-host .cm-content").innerText()).replace(/\n+/g, "\n");

const config = (version) => `
(on-load
  (def kh-version "${version}")
  (defn kh-greet (name) (ed-insert (str "hello " name))))
(on-tick (ed-notify "tick" kh-version))
(bind "Ctrl-Alt-r" (ed-cmd "reload-keys"))
(bind "Ctrl-Alt-v" (ed-message kh-version))
(bind "Ctrl-Alt-l" (ed-replace-range *line-from* *line-to* "replaced"))
(bind "Ctrl-Alt-a" (ed-append *file* "- appended" "## Log"))
(bind "Ctrl-Alt-w" (ed-write "kh/other.md" "written\\n"))
(bind "Ctrl-Alt-c" (ed-write *file* "never" "not what it says"))
(bind "Ctrl-Alt-p" (ed-prompt "Name?" kh-greet "Ana" (list "Ana" "Bob")))
(bind "Ctrl-Alt-f" (ed-form "kh/Cap"))
`;

const FORM = `(form "Cap" :size (200 80)
  (button btnGo :text "Go" :at (10 10) :size (80 30) :on-click kh-go))
(defn kh-go (f) (ui-editor (ed-append "kh/from-form.md" "- from the form" "## Inbox")) (ui-message "filed"))
`;

const NOTE = "# Day\n\n## Log\n\n- 🍕 pizza\n\n## Notes\n\nlast line\n";

test.beforeAll(async () => {
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/kh`, { recursive: true });
  await writeFile(CONFIG, config("v1"));
  await writeFile(`${UI_WORKSPACE}/kh-day.md`, NOTE);
  await writeFile(`${UI_WORKSPACE}/kh/Cap.eeform`, FORM);
});

test.afterAll(async () => {
  await rm(CONFIG, { force: true });
});

async function openDay(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "kh-day.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("pizza");
}

test("(on-load …) defines what the keys call, and runs again when the config is reloaded", async ({ page }) => {
  await openDay(page);
  await page.keyboard.press("Control+Alt+v");
  await expect(page.locator(".toast").last()).toHaveText("v1");
  await writeFile(CONFIG, config("v2"));
  await page.keyboard.press("Control+Alt+r");
  // the reload is asynchronous: ask until it has landed
  await expect(async () => {
    await page.keyboard.press("Control+Alt+v");
    await expect(page.locator(".toast", { hasText: "v2" }).first()).toBeVisible({ timeout: 500 });
  }).toPass();
});

test("*line-from* / *line-to* are the caret line's ends, an emoji or not", async ({ page }) => {
  await openDay(page);
  await page.locator(".cm-line", { hasText: "pizza" }).click();
  await page.keyboard.press("Control+Alt+l");
  await expect.poll(() => buffer(page)).toContain("## Log\nreplaced\n## Notes");
});

test("ed-append files a line under a heading of the open note, and saves it", async ({ page }) => {
  await writeFile(`${UI_WORKSPACE}/kh-day.md`, NOTE);
  await openDay(page);
  await page.locator(".cm-line", { hasText: "last line" }).click();
  await page.keyboard.press("Control+Alt+a");
  await expect.poll(() => buffer(page)).toContain("- 🍕 pizza\n- appended\n## Notes");
  await expect.poll(() => disk("kh-day.md")).toContain("- 🍕 pizza\n- appended\n");
  // the caret stayed on its line: typing lands there, not at the top
  await page.keyboard.type("!");
  await expect.poll(() => buffer(page)).toContain("last line!");
});

test("ed-write writes a note that isn't open — and leaves one that no longer says what it expected", async ({ page }) => {
  await openDay(page);
  await page.keyboard.press("Control+Alt+w");
  await expect.poll(() => disk("kh/other.md").catch(() => "")).toBe("written\n");
  const before = await buffer(page);
  await page.keyboard.press("Control+Alt+c");
  await page.waitForTimeout(300);
  expect(await buffer(page)).toBe(before);
});

test("ed-prompt asks, offers its choices, and calls back with the answer", async ({ page }) => {
  await openDay(page);
  await page.locator(".cm-line", { hasText: "last line" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+Alt+p");
  const input = page.locator(".dlg-input");
  await expect(input).toHaveValue("Ana");
  await expect(page.locator(".dlg-panel datalist option")).toHaveCount(2);
  await input.fill("Bob");
  await input.press("Enter");
  await expect.poll(() => buffer(page)).toContain("hello Bob");
  // Escape: nothing runs
  await page.keyboard.press("Control+Alt+p");
  await page.locator(".dlg-input").press("Escape");
  await expect(page.locator(".dlg-input")).toHaveCount(0);
  expect((await buffer(page)).match(/hello/g)).toHaveLength(1);
});

test("(on-tick …) runs on the minute", async ({ page }) => {
  await page.clock.install();
  await openDay(page);
  await page.clock.runFor(61_000);
  await expect(page.locator(".toast", { hasText: "tick — v" })).toHaveCount(1);
});

test("a form's (ui-editor …) is carried out by the app", async ({ page }) => {
  await openDay(page);
  await page.keyboard.press("Control+Alt+f");
  await page.locator(".formwin .formrun-ctl.button", { hasText: "Go" }).click();
  await expect(page.locator(".toast", { hasText: "filed" })).toHaveCount(1);
  await expect.poll(() => disk("kh/from-form.md").catch(() => "")).toBe("## Inbox\n\n- from the form\n");
});
