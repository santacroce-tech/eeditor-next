// Mind maps in a real browser against the dev bridge: a .mindmap.md opens as a map, the keyboard
// and the pointer edit it, and what lands on disk is still the markdown outline — with the prose
// around it untouched.

import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const FILE = "Trip.mindmap.md";
const SOURCE = `# Trip

- Where
  - Lisbon
  - Porto
- When
- Who

Prose under the map is just a note.
`;

const onDisk = () => readFile(`${UI_WORKSPACE}/${FILE}`, "utf8");
const node = (page, text) => page.locator(".mm-node", { hasText: text });

test.beforeAll(async () => {
  await writeFile(`${UI_WORKSPACE}/${FILE}`, SOURCE);
});

async function openMap(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: FILE }).click();
  await expect(page.locator(".mm-d0")).toHaveText("Trip");
}

test("a .mindmap.md opens as a map of its outline", async ({ page }) => {
  await openMap(page);
  await expect(page.locator(".mm-node")).toHaveCount(6);
  await expect(page.locator(".form-modes .head-btn.active")).toHaveText("map");
  await expect(page.locator(".mm-d0")).toHaveText("Trip");
  await expect(page.locator(".mm-d1")).toHaveText(["Where", "When", "Who"]);
  await expect(page.locator(".mm-edge")).toHaveCount(5);
  // the text editor and the preview are out of the way
  await expect(page.locator(".editor-host")).toBeHidden();
  await expect(page.locator(".head-btn", { hasText: "preview" })).toBeHidden();
});

test("Tab adds a child, typing names it, and the outline on disk follows", async ({ page }) => {
  await openMap(page);
  await node(page, "Who").click();
  await page.keyboard.press("Tab");
  await expect(page.locator(".mm-input")).toBeVisible();
  await page.keyboard.type("Ana");
  // Tab again files the next one beside it without leaving the keyboard
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape"); // an empty new node is dropped, not saved
  await expect(node(page, "Ana")).toHaveCount(1);
  await expect.poll(onDisk).toContain("- Who\n  - Ana\n\nProse under the map is just a note.\n");
  await expect.poll(onDisk).not.toContain("  - \n");

  // Enter adds a sibling of the selected node (⌘0 first: keeping Ana in view panned the far side off)
  await page.keyboard.press(`${MOD}+0`);
  await node(page, "Lisbon").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Sintra");
  await page.keyboard.press("Enter");
  await expect.poll(onDisk).toContain("  - Lisbon\n  - Sintra\n  - Porto\n");
});

test("typing over a node renames it, and ⌘Z in the map is the editor's undo", async ({ page }) => {
  await openMap(page);
  await node(page, "When").click();
  await page.keyboard.type("October");
  await page.keyboard.press("Enter");
  await expect(node(page, "October")).toHaveCount(1);
  await expect.poll(onDisk).toContain("- October\n");

  await page.keyboard.press(`${MOD}+z`);
  await expect(node(page, "When")).toHaveCount(1);
  await expect.poll(onDisk).toContain("- When\n");
});

test("arrows walk the map and Delete removes a branch", async ({ page }) => {
  await openMap(page);
  await page.locator(".mm-d0").click();
  await page.keyboard.press("ArrowRight"); // into a right-hand branch
  const sel = page.locator(".mm-node.mm-sel");
  await expect(sel).toHaveClass(/mm-d1/);
  await page.locator(".mm-stage").focus();
  await node(page, "Porto").click();
  await page.keyboard.press("ArrowUp");
  await expect(sel).toHaveText("Sintra");
  await page.keyboard.press("Delete");
  await expect(node(page, "Sintra")).toHaveCount(0);
  await expect.poll(onDisk).not.toContain("Sintra");
});

test("a branch folds away and says how much it hides", async ({ page }) => {
  await openMap(page);
  await node(page, "Where").click();
  await page.keyboard.press(`${MOD}+/`);
  await expect(node(page, "Lisbon")).toHaveCount(0);
  await expect(page.locator(".mm-badge")).toHaveText("2");
  await page.locator(".mm-badge").click();
  await expect(node(page, "Lisbon")).toHaveCount(1);
});

test("dragging a node onto another moves its branch there", async ({ page }) => {
  await openMap(page);
  const from = await node(page, "Porto").boundingBox();
  const to = await node(page, "Who").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator(".mm-node.mm-drop")).toHaveText("Who");
  await page.mouse.up();
  await expect.poll(onDisk).toContain("- Who\n  - Ana\n  - Porto\n");
  await expect.poll(onDisk).toContain("  - Lisbon\n- When");
});

test("the text view is the same file, and an edit there shows in the map", async ({ page }) => {
  await openMap(page);
  await page.locator(".form-modes .head-btn", { hasText: "text" }).click();
  await expect(page.locator(".editor-host .cm-content")).toContainText("Prose under the map is just a note.");
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("\n#travel");
  await page.locator(".form-modes .head-btn", { hasText: "map" }).click();
  await expect(page.locator(".mm-node")).toHaveCount(7);
  await expect.poll(onDisk).toContain("Prose under the map is just a note.\n\n#travel");
});

test("a new mind map is made from the tree with its name as the central topic", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-dir").first().click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "New mind map…" }).click();
  await page.keyboard.type("Plans");
  await page.keyboard.press("Enter");
  await expect(page.locator(".mm-d0")).toHaveText("Plans");
  await expect(page.locator(".mm-node")).toHaveCount(2);
  await expect.poll(() => readFile(`${UI_WORKSPACE}/Plans.mindmap.md`, "utf8")).toBe("# Plans\n\n- Idea\n");
});

test("the big sample opens folded to its sections, and ⌘⇧/ opens them all", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.locator(".tree-file", { hasText: "EEditor.mindmap.md" }).click();
  await expect(page.locator(".mm-d0")).toHaveText("EEditor");
  await expect(page.locator(".mm-d1")).toHaveText(["Shortcuts", "EELisp"]);
  const folded = await page.locator(".mm-badge").count();
  expect(folded).toBeGreaterThan(10);
  const shown = await page.locator(".mm-node").count();
  expect(shown).toBeLessThanOrEqual(60);
  // inline code is drawn without its backticks
  await page.locator(".mm-badge").last().click();
  await expect(page.locator(".mm-text").filter({ hasText: "(functions)" }).first()).not.toContainText("`");
  // folds are remembered across a reload
  const after = await page.locator(".mm-badge").count();
  await page.reload();
  await page.locator(".tree-file", { hasText: "EEditor.mindmap.md" }).click();
  await expect(page.locator(".mm-badge")).toHaveCount(after);
  await page.locator(".mm-stage").focus();
  await page.keyboard.press(`${MOD}+Shift+/`);
  await expect(page.locator(".mm-badge")).toHaveCount(0);
  expect(await page.locator(".mm-node").count()).toBeGreaterThan(250);
});

test("PNG saves a picture of the map beside it, never over one", async ({ page }) => {
  await openMap(page);
  await page.locator(".mm-btn", { hasText: "PNG" }).click();
  await expect(page.locator(".toast").last()).toContainText("Trip.png");
  await page.locator(".mm-btn", { hasText: "PNG" }).click();
  await expect(page.locator(".toast").last()).toContainText("Trip");
  const png = await readFile(`${UI_WORKSPACE}/Trip.png`);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  await page.locator(".mm-btn", { hasText: "SVG" }).click();
  await expect.poll(() => readFile(`${UI_WORKSPACE}/Trip.svg`, "utf8").catch(() => "")).toContain("<svg");
});

test("renamed away from .mindmap.md it is a plain note again", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Plans.mindmap.md" }).click();
  await expect(page.locator(".mm-d0")).toHaveText("Plans");
  await page.locator(".tree-file", { hasText: "Plans.mindmap.md" }).click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "Rename…" }).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type("Plans.md");
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-host")).toBeVisible();
  await expect(page.locator(".mindmap-host")).toBeHidden();
  await expect(page.locator(".editor-host .cm-content")).toContainText("# Plans");
});
