// About EEditor, from the workspace's menu: who makes it, and which version is running.

import { expect, test } from "@playwright/test";
import pkg from "../../package.json" with { type: "json" };

test("the workspace menu opens About, naming the developer and the version", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-dir").first().click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "About EEditor" }).click();
  const panel = page.locator(".about-panel");
  await expect(panel).toContainText("Roberto Santacroce Martins");
  await expect(panel.locator(".about-version")).toHaveText(`version ${pkg.version}`);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
