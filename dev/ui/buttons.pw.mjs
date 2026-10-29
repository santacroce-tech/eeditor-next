// Header buttons from the keybindings config, and task lines in the preview, in a real browser
// against a real engine: (button "…" "Key") clicks that key's binding, a button with a body runs it,
// the caret stays where it was, and a reload redraws them. The preview shows a task's priority,
// id and categories set apart, with no bullet beside the box.
//
// The config is written for this spec and removed after it, so the other specs get the defaults.

import { expect, test } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;

const config = (label) => `
(bind "Ctrl-Alt-l" (ed-replace-range *line-from* *line-to* (str "line " *line*)))
(bind "Ctrl-Alt-r" (ed-cmd "reload-keys"))
(button "${label}" "Ctrl-Alt-l")
(button "hi" (ed-message "hello from a button"))
(button "nothing" "Ctrl-Alt-z")
`;

const NOTE = `# Tasks

- [ ] !!! renew the passport {#1}
- [ ] dentist {#4}  _work/admin, money_
- [x] call the bank {#7} ✓ 2026-10-10
- [ ] just _italic_ here
- plain bullet
`;

test.beforeAll(async () => {
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/bt`, { recursive: true });
  await writeFile(CONFIG, config("number it"));
  await writeFile(`${UI_WORKSPACE}/bt/tasks.md`, NOTE);
});

test.afterAll(async () => {
  await rm(CONFIG, { force: true });
  await rm(`${UI_WORKSPACE}/bt`, { recursive: true, force: true });
});

async function openNote(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "tasks.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("renew the passport");
}

test("a button clicks its key, at the caret; one with a body runs it", async ({ page }) => {
  await openNote(page);
  const buttons = page.locator(".user-btns .head-btn");
  // a config with none of the header's own buttons gets them after its own
  await expect(buttons).toHaveText(["number it", "hi", "nothing", "☀ light", "image…", "preview", "PDF", "⌘", "λ ›"]);
  await expect(buttons.first()).toHaveAttribute("title", /number it — (⌃⌥L|Ctrl\+Alt\+L)/);

  await page.locator(".cm-line", { hasText: "plain bullet" }).click();
  await buttons.first().click();
  await expect(page.locator(".cm-line", { hasText: "line 7" })).toHaveCount(1);
  await expect(page.locator(".cm-line", { hasText: "plain bullet" })).toHaveCount(0);

  await buttons.nth(1).click();
  await expect(page.locator(".toast")).toContainText("hello from a button");
  await buttons.nth(2).click();
  await expect(page.locator(".toast").last()).toContainText("nothing is bound to Ctrl-Alt-z");
});

test("reloading the config redraws the buttons", async ({ page }) => {
  await openNote(page);
  await writeFile(CONFIG, config("renamed"));
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Alt+r");
  await expect(page.locator(".user-btns .head-btn").first()).toHaveText("renamed");
});

test("writing a header button takes the header over: order, labels, and what's left out", async ({ page }) => {
  await writeFile(
    CONFIG,
    `(button "📝" (ed-cmd "toggle-preview"))\n(button "hi" (ed-message "hello from a button"))\n(button (ed-cmd "toggle-theme"))\n`,
  );
  await openNote(page);
  const buttons = page.locator(".user-btns .head-btn");
  await expect(buttons).toHaveText(["📝", "hi", "☀ light"]); // no PDF, no ⌘, no λ
  // a labelled command button keeps its label, and still behaves like the command's own
  await buttons.first().click();
  await expect(page.locator(".preview-host")).toBeVisible();
  await expect(buttons.first()).toHaveText("📝");
  await expect(buttons.first()).toHaveAttribute("aria-pressed", "true");
  // an unlabelled one is labelled by the app, and follows the state
  await buttons.nth(2).click();
  await expect(buttons.nth(2)).toHaveText("▦ VB6");
  await buttons.nth(2).click();
  await buttons.nth(2).click(); // back to dark for the specs after this one
  await expect(buttons.nth(2)).toHaveText("☀ light");
  await writeFile(CONFIG, config("number it"));
});

test("the preview shows task lines as tasks", async ({ page }) => {
  await writeFile(`${UI_WORKSPACE}/bt/tasks.md`, NOTE);
  await openNote(page);
  await page.locator(".head-btn", { hasText: "preview" }).click();
  const preview = page.locator(".preview-host");
  await expect(preview.locator("li.task")).toHaveCount(4);
  await expect(preview.locator("li.task-done")).toHaveCount(1);
  await expect(preview.locator(".task-pri-3")).toHaveText("!!!");
  await expect(preview.locator(".task-id")).toHaveText(["#1", "#4", "#7"]);
  await expect(preview.locator(".task-cat")).toHaveText(["work/admin", "money"]);
  await expect(preview.locator(".task-stamp")).toHaveText("✓ 2026-10-10");
  await expect(preview.locator("li.task").first()).toHaveText(/^!!!\s*renew the passport\s*#1$/);
  // no {#id} on the line: its italic stays italic, and a plain bullet is no task
  await expect(preview.locator("li.task em")).toHaveText("italic");
  await expect(preview.locator("li:not(.task)")).toHaveText("plain bullet");
  const bullet = await preview.locator("li.task").first().evaluate((el) => getComputedStyle(el).listStyleType);
  expect(bullet).toBe("none");
});
