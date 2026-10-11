// What a new, empty folder gets: the offer, and then all of it — the workspace/ samples *and* the PIM
// tour (its agenda, its notes, its keys), working at once, without a restart. Runs against its own
// bridge on a folder that starts empty every run (UI_EMPTY, see playwright.config.mjs).

import { expect, test } from "@playwright/test";
import { access, readFile } from "node:fs/promises";
import { EMPTY_URL, UI_EMPTY } from "../../playwright.config.mjs";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const there = (p) => access(`${UI_EMPTY}/${p}`).then(() => true, () => false);
const pad2 = (n) => String(n).padStart(2, "0");
const d = new Date();
const today = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.md`;

test("an empty folder is offered the samples, and gets every one of them, the PIM tour included", async ({ page }) => {
  await page.goto(EMPTY_URL);
  const dlg = page.locator(".dlg-panel");
  await expect(dlg).toContainText("This folder is empty");
  await dlg.getByRole("button", { name: "Add samples" }).click();
  await expect(page.locator(".toast").first()).toContainText("Added");
  await expect(page.locator(".toast").first()).not.toContainText("No PIM tour");

  // the workspace/ samples
  for (const p of ["welcome.md", "todo.md", "notes/roadmap.md", "Contacts.eeform", "examples/Office.eeform",
    "examples/EEditor.mindmap.md"]) expect(await there(p), p).toBe(true);
  // the PIM tour
  for (const p of ["TRY ME.md", "inbox.md", "bills.md", "dashboard.md", "projects/site.md", "projects/home.md",
    "pim/Capture.eeform", ".eeditor/keybindings.eelisp", today]) expect(await there(p), p).toBe(true);
  expect(await readFile(`${UI_EMPTY}/welcome.md`, "utf8")).toContain("TRY ME.md");

  // it opens on the welcome note, the agenda has the tour's items, and the PIM's keys are live
  await expect(page.locator(".etab.active .etab-label")).toHaveText("welcome.md");
  await expect(page.getByText("renew the passport")).toBeVisible();
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press(`${MOD}+Alt+k`);
  await expect(page.locator(".toast").filter({ hasText: "No clock running" })).toBeVisible();

  // and it isn't empty any more: no offer the next time
  await page.reload();
  await expect(page.locator(".etab.active .etab-label")).toHaveText("welcome.md");
  await expect(dlg).toHaveCount(0);
});
