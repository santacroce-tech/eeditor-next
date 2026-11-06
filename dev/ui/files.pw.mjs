// Files.eeform, the two-panel file browser in workspace/examples, driven by its keys in a real
// browser against a real engine: folders open and close, ⌘→ moves the pick across, ⌥⌘← copies it
// back, Rename and New folder use the box, ⌘⌫ sends one to the trash, ↵ on a file opens its tab —
// and the panels always show the folders as they are on disk.
//
// The folders are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const DIR = `${UI_WORKSPACE}/fmt`;
const there = (p) => stat(`${UI_WORKSPACE}/${p}`).then(() => true, () => false);

test.beforeAll(async () => {
  await mkdir(`${DIR}/a/sub`, { recursive: true });
  await mkdir(`${DIR}/b`, { recursive: true });
  await writeFile(`${DIR}/a/one.md`, "# One\n");
  await writeFile(`${DIR}/a/two.md`, "# Two\n");
  await writeFile(`${DIR}/b/three.md`, "# Three\n");
});

test.afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
});

const ctl = (form, name) => form.locator(`.formrun-ctl[data-name=${name}]`);
const grid = (form, side) => ctl(form, side === "left" ? "grdLeft" : "grdRight");
const label = (form, side) => ctl(form, side === "left" ? "lblLeft" : "lblRight");
const row = (form, side, name) => grid(form, side).locator("tbody tr", { has: form.page().locator("td", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`) }) });

async function run(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Files.eeform" }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-canvas");
  return page.locator(".formrun-host");
}

/** Take a panel to a folder: up to the top with ⌫, then down through each name with a double-click. */
async function go(form, side, path) {
  const page = form.page();
  await grid(form, side).locator("tbody tr").first().click();
  for (let i = 0; i < 6 && (await label(form, side).textContent()) !== "/"; i++) {
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(50);
  }
  await expect(label(form, side)).toHaveText("/");
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    await row(form, side, `${part}/`).dblclick();
    at += "/" + part;
    await expect(label(form, side)).toHaveText(at);
  }
}

test("opens at the top, folders first; into a folder and back up", async ({ page }) => {
  const form = await run(page);
  await go(form, "left", "");
  await expect(row(form, "left", "fmt/")).toBeVisible();
  // folders come before files
  const names = await grid(form, "left").locator("tbody tr td:first-child").allTextContents();
  const lastDir = names.findLastIndex((n) => n.endsWith("/"));
  const firstFile = names.findIndex((n) => !n.endsWith("/"));
  expect(firstFile === -1 || lastDir < firstFile).toBe(true);
  await row(form, "left", "fmt/").dblclick();
  await expect(label(form, "left")).toHaveText("/fmt");
  await expect(row(form, "left", "../")).toBeVisible();
  await row(form, "left", "a/").click();
  await page.keyboard.press("Enter");
  await expect(label(form, "left")).toHaveText("/fmt/a");
  await expect(row(form, "left", "one.md")).toBeVisible();
  await expect(row(form, "left", "one.md").locator("td").nth(1)).toHaveText("6 B");
  await page.keyboard.press(`${MOD}+ArrowUp`);
  await expect(label(form, "left")).toHaveText("/fmt");
});

test("⌘→ moves the pick into the other panel's folder; ⌥⌘← copies it back", async ({ page }) => {
  const form = await run(page);
  await go(form, "left", "fmt/a");
  await go(form, "right", "fmt/b");
  await row(form, "left", "one.md").click();
  await page.keyboard.press(`${MOD}+ArrowRight`);
  await expect(row(form, "right", "one.md")).toBeVisible();
  await expect(row(form, "left", "one.md")).toHaveCount(0);
  expect(await there("fmt/b/one.md")).toBe(true);
  expect(await there("fmt/a/one.md")).toBe(false);
  await expect(ctl(form, "lblStatus")).toHaveText("Moved one.md to /fmt/b");

  await row(form, "right", "one.md").click();
  await page.keyboard.press(`${MOD}+Alt+ArrowLeft`);
  await expect(row(form, "left", "one.md")).toBeVisible();
  await expect(row(form, "right", "one.md")).toBeVisible();
  expect(await there("fmt/a/one.md")).toBe(true);

  // the same again: the name is taken, so nothing is written over
  await row(form, "right", "one.md").click();
  await page.keyboard.press(`${MOD}+Alt+ArrowLeft`);
  await expect(page.locator(".toast").filter({ hasText: "already exists" })).toBeVisible();
});

test("Tab goes to the other panel; ↵ on a file opens it in a tab", async ({ page }) => {
  const form = await run(page);
  await go(form, "left", "fmt/a");
  await go(form, "right", "fmt/b");
  await row(form, "left", "two.md").click();
  await page.keyboard.press("Tab");
  await expect(grid(form, "right").locator(".formrun-grid")).toBeFocused();
  await row(form, "right", "three.md").click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("three.md");
});

test("Rename and New folder take the name in the box; ⌘⌫ sends the pick to the trash", async ({ page }) => {
  const form = await run(page);
  await go(form, "left", "fmt/a");
  await row(form, "left", "two.md").click();
  await expect(ctl(form, "txtName").locator("input")).toHaveValue("two.md");
  await ctl(form, "txtName").locator("input").fill("deux.md");
  await ctl(form, "btnRename").locator("button").click();
  await expect(row(form, "left", "deux.md")).toBeVisible();
  expect(await there("fmt/a/deux.md")).toBe(true);

  await ctl(form, "txtName").locator("input").fill("made");
  await ctl(form, "btnFolder").locator("button").click();
  await expect(row(form, "left", "made/")).toBeVisible();
  expect(await there("fmt/a/made")).toBe(true);

  await row(form, "left", "deux.md").click();
  await page.keyboard.press(`${MOD}+Backspace`);
  await expect(row(form, "left", "deux.md")).toHaveCount(0);
  expect(await there("fmt/a/deux.md")).toBe(false);
  await expect(ctl(form, "lblStatus")).toHaveText("deux.md is in the Trash");
});

test("⇧⌘→ shows this folder in the other panel; ⌘G and Go to take a panel to a typed folder", async ({ page }) => {
  const form = await run(page);
  await go(form, "left", "fmt/a");
  await go(form, "right", "");
  await row(form, "left", "../").click();
  await page.keyboard.press(`${MOD}+Shift+ArrowRight`);
  await expect(label(form, "right")).toHaveText("/fmt/a");
  await expect(ctl(form, "lblStatus")).toHaveText("Both panels at /fmt/a");

  // ⌘G: the caret in the box; ↵ there is Go to, in the panel last used
  await row(form, "left", "../").click();
  await page.keyboard.press(`${MOD}+g`);
  await expect(ctl(form, "txtName").locator("input")).toBeFocused();
  await page.keyboard.type("/fmt/b");
  await page.keyboard.press("Enter");
  await expect(label(form, "left")).toHaveText("/fmt/b");
  await expect(grid(form, "left").locator(".formrun-grid")).toBeFocused();
  // a folder that isn't there, or a file, is said so — the panel stays
  await ctl(form, "txtName").locator("input").fill("fmt/nowhere");
  await ctl(form, "btnGo").locator("button").click();
  await expect(ctl(form, "lblStatus")).toHaveText("There is no /fmt/nowhere");
  await ctl(form, "txtName").locator("input").fill("fmt/b/three.md");
  await ctl(form, "btnGo").locator("button").click();
  await expect(ctl(form, "lblStatus")).toHaveText("/fmt/b/three.md is a file, not a folder");
  await expect(label(form, "left")).toHaveText("/fmt/b");
  // ↵ in a panel still opens its pick, and isn't taken for Go to
  await row(form, "left", "../").click();
  await page.keyboard.press("Enter");
  await expect(label(form, "left")).toHaveText("/fmt");
});

test("each panel's folder is remembered between runs", async ({ page }) => {
  const form = await run(page);
  await go(form, "left", "fmt/b");
  const again = await run(page);
  await expect(label(again, "left")).toHaveText("/fmt/b");
});
