// Running EELisp from a note with ⌘/Ctrl+Shift+Enter, in a real browser against a real engine: a
// selection runs as it is, anywhere in the note; with nothing selected the ```eelisp block at the
// caret runs. Either way the answer lands in the REPL, which opens if it was hidden.

import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const SOURCE = `# Scratch

(str "sel" "ected")

\`\`\`eelisp
(def x 20)
(+ x 22)
\`\`\`
`;

test.beforeAll(async () => {
  await writeFile(`${UI_WORKSPACE}/scratch.md`, SOURCE);
});

async function openNote(page) {
  await page.addInitScript(() => localStorage.setItem("repl.visible", "0"));
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "scratch.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("Scratch");
  await expect(page.locator(".shell")).toHaveAttribute("data-repl", "off");
}

test("the selection runs, and the hidden REPL opens to show it", async ({ page }) => {
  await openNote(page);
  await page.locator(".cm-line", { hasText: '(str "sel" "ected")' }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("ControlOrMeta+Shift+Enter");

  await expect(page.locator(".shell")).toHaveAttribute("data-repl", "on");
  await expect(page.locator(".repl-echo").last()).toHaveText('› (str "sel" "ected")');
  await expect(page.locator(".repl-result").last()).toContainText("selected");
});

test("with nothing selected, the block at the caret runs", async ({ page }) => {
  await openNote(page);
  await page.locator(".cm-line", { hasText: "(+ x 22)" }).click();
  await page.keyboard.press("ControlOrMeta+Shift+Enter");

  await expect(page.locator(".repl-echo").last()).toHaveText("› (def x 20)\n(+ x 22)");
  await expect(page.locator(".repl-result").last()).toContainText("42");
});
