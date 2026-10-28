// The agenda panel's "in notes" group, in a real browser against a real engine: a "- [ ] …" line
// with no {#id} is listed under its note, a click opens the note at that line, and ＋ makes it an
// agenda item and links the line — which then leaves the group. Linked lines and fenced examples
// are never listed.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const NOTE = `# Plans

- [ ] water the ficus zz
- [ ] already linked zz {#999}

\`\`\`
- [ ] an example zz
\`\`\`

- [ ] book the vet zz
`;

const PATH = `${UI_WORKSPACE}/nt/plans.md`;

test.beforeAll(async () => {
  await mkdir(`${UI_WORKSPACE}/nt`, { recursive: true });
  await writeFile(PATH, NOTE);
});

test.afterAll(async () => {
  await rm(`${UI_WORKSPACE}/nt`, { recursive: true, force: true });
});

const group = (page) => page.locator(".ag-notes-group");
const ours = (page) => page.locator(".ag-note-task", { hasText: " zz" });

test("unlinked tasks are listed, folded, and open their note at the line", async ({ page }) => {
  await page.goto("/");
  await expect(group(page)).toBeVisible();
  const head = page.locator(".ag-notes-head");
  if (!(await page.locator(".ag-notes-body").isVisible())) await head.click();
  await expect(head).toContainText("▾ in notes, not in the agenda");
  await expect(ours(page).locator(".ag-text")).toHaveText(["water the ficus zz", "book the vet zz"]);

  await ours(page).filter({ hasText: "book the vet" }).locator(".ag-text").click();
  await expect(page.locator(".cm-content")).toContainText("water the ficus");
  await expect(page.locator(".cm-activeLine")).toContainText("book the vet zz");

  await head.click();
  await expect(page.locator(".ag-notes-body")).toBeHidden();
  await page.reload();
  await expect(page.locator(".ag-notes-body")).toBeHidden(); // the fold is remembered
});

test("＋ adds it to the agenda and links the line", async ({ page }) => {
  await page.goto("/");
  await expect(ours(page)).toHaveCount(2);
  await page.locator(".ag-notes-head").click(); // a new page starts folded
  await ours(page).filter({ hasText: "water the ficus" }).locator(".ag-note-add").click();

  await expect(page.locator(".ag-item .ag-text", { hasText: "water the ficus zz" })).toHaveCount(1);
  await expect(ours(page)).toHaveCount(1);
  await expect.poll(() => readFile(PATH, "utf8")).toMatch(/^- \[ \] water the ficus zz \{#\d+\}$/m);
  expect(await readFile(PATH, "utf8")).toContain("- [ ] book the vet zz\n");
});
