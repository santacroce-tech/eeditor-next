// install-pim: the PIM's keys into a folder that has keybindings of its own — the case where
// ⌘⌥U "does nothing" because the PIM only ever arrived with the samples.

import { expect, test } from "@playwright/test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const MINE = `(bind "Mod-s" (ed-cmd "save"))\n(bind "Mod-j" (ed-cmd "toggle-repl"))\n(on-start (ed-open "welcome.md"))\n`;
let before = null;

test.beforeAll(async () => {
  before = await readFile(CONFIG, "utf8").catch(() => null);
  await writeFile(CONFIG, MINE);
});
test.afterAll(async () => {
  if (before === null) await rm(CONFIG, { force: true });
  else await writeFile(CONFIG, before);
  await rm(`${UI_WORKSPACE}/pim`, { recursive: true, force: true });
});

async function run(page, src) {
  await page.locator(".repl-input").fill(src);
  await page.locator(".repl-input").press(`${MOD}+Enter`);
}

test("install-pim adds the PIM to a folder's own keybindings, and its keys come alive", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("welcome.md");

  // before: the PIM's keys aren't there
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+Alt+KeyK`);
  await expect(page.locator(".toast", { hasText: "No clock running" })).toHaveCount(0);

  await run(page, '(ed-cmd "install-pim")');
  await expect(page.locator(".toast", { hasText: "PIM added" })).toBeVisible();

  const text = await readFile(CONFIG, "utf8");
  expect(text.startsWith(MINE.trimEnd())).toBe(true); // my lines first, untouched
  expect(text).toContain("put here by EEditor's install-pim");
  expect(text).toContain("(on-start …) left out"); // mine says what opens; the PIM's doesn't override it
  expect(await readFile(`${UI_WORKSPACE}/pim/Capture.eeform`, "utf8")).toContain("Capture");

  // the keys are live without a restart
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+Alt+KeyK`);
  await expect(page.locator(".toast", { hasText: "No clock running" })).toBeVisible();

  // again: nothing to change
  await run(page, '(ed-cmd "install-pim")');
  await expect(page.locator(".toast", { hasText: "up to date" })).toBeVisible();
  expect((await readFile(CONFIG, "utf8")).split("put here by EEditor's install-pim").length).toBe(2);
});

test("a PIM pasted in by hand is left alone, with a word on why", async ({ page }) => {
  await writeFile(CONFIG, MINE + "(on-load (defn pim-cycle (line) line))\n");
  await page.goto("/");
  await run(page, '(ed-cmd "install-pim")');
  await expect(page.locator(".dlg-panel")).toContainText("pasted in by hand");
  expect(await readFile(CONFIG, "utf8")).toBe(MINE + "(on-load (defn pim-cycle (line) line))\n");
});
