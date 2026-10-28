// The files header: ＋ and ⋯ are menus, holding what a right-click on the tree offers — so the
// header and the menu can't drift apart. ＋ → New folder… makes one at the top of the workspace.

import { expect, test } from "@playwright/test";
import { rm, stat } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.afterAll(async () => {
  await rm(`${UI_WORKSPACE}/fm-made`, { recursive: true, force: true });
});

test("＋ and ⋯ open the tree's menus", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tree-file").first()).toBeVisible(); // the workspace has loaded
  const head = page.locator(".files-section .side-head-btns .side-btn");
  await expect(head).toHaveText(["＋", "⋯"]);

  await head.first().click();
  const menu = page.locator(".ctx-menu .ctx-item");
  await expect(menu).toHaveText(["New file…", "New sheet…", "New form…", "New mind map…", "New folder…"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ctx-menu")).toHaveCount(0);

  await head.nth(1).click();
  await expect(menu.first()).toHaveText("Open a file…");
  await expect(menu.nth(1)).toHaveText("Open another folder…");
  for (const label of ["Show location…", "Add sample notes…", "Install the PIM keys…", "About EEditor"]) {
    await expect(menu.filter({ hasText: label })).toHaveCount(1);
  }
  await page.keyboard.press("Escape");

  // and an item does what it says
  await head.first().click();
  await menu.filter({ hasText: "New folder…" }).click();
  await page.keyboard.type("fm-made");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tree-dir, .tree-row", { hasText: "fm-made" }).first()).toBeVisible();
  expect((await stat(`${UI_WORKSPACE}/fm-made`)).isDirectory()).toBe(true);
});
