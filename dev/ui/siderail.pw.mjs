// The sidebar's rail (ui/sidenav.ts): an icon per section at the window's left edge, one section in
// front at a time. Its icon again — or ⌘B — hides the sidebar and the rail stays; the section in
// front is remembered across a reload (a panel's own icon: dev/ui/sidepanel.pw.mjs); ⌘⇧P's "every section stacked" puts the old layout back.

import { expect, test } from "@playwright/test";

const icon = (page, key) => page.locator(`.side-rail [data-key="${key}"]`);
const sec = (page, cls) => page.locator(`.sidebar .${cls}-section`);

test("one section at a time; its icon again hides the sidebar, ⌘B brings it back, a reload remembers", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".side-rail")).toBeVisible();
  await expect(page.locator(".side-rail .side-icon")).toHaveCount(3);
  // files in front at first
  await expect(sec(page, "files")).toBeVisible();
  await expect(sec(page, "tags")).toBeHidden();
  await expect(sec(page, "agenda")).toBeHidden();
  await expect(icon(page, "files")).toHaveAttribute("aria-pressed", "true");

  await icon(page, "agenda").click();
  await expect(sec(page, "agenda")).toBeVisible();
  await expect(sec(page, "files")).toBeHidden();
  await expect(icon(page, "agenda")).toHaveAttribute("aria-pressed", "true");
  await expect(icon(page, "files")).toHaveAttribute("aria-pressed", "false");
  // it has the sidebar's whole height
  const side = await page.locator(".sidebar").boundingBox();
  const agenda = await sec(page, "agenda").boundingBox();
  expect(agenda.height).toBeGreaterThan(side.height - 4);

  await icon(page, "agenda").click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".side-rail")).toBeVisible();
  await expect(icon(page, "agenda")).toHaveAttribute("aria-pressed", "false");

  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sec(page, "agenda")).toBeVisible();
  await expect(icon(page, "agenda")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator(".editor-host")).toBeVisible();
  await expect(sec(page, "agenda")).toBeVisible();
  await expect(sec(page, "files")).toBeHidden();
});

test("⌘⇧P → every section stacked: no rail, all of them shown; and back", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".etab.active")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.keyboard.type("every section stacked");
  await page.locator(".quick-open .qo-input").press("Enter");
  await expect(page.locator(".side-rail")).toBeHidden();
  for (const s of ["files", "tags", "agenda"]) await expect(sec(page, s)).toBeVisible();
  await page.reload();
  await expect(page.locator(".editor-host")).toBeVisible();
  await expect(page.locator(".side-rail")).toBeHidden();
  await expect(sec(page, "tags")).toBeVisible();

  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.keyboard.type("one section at a time");
  await page.locator(".quick-open .qo-input").press("Enter");
  await expect(page.locator(".side-rail")).toBeVisible();
  await expect(sec(page, "tags")).toBeHidden();
});
