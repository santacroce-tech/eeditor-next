// The file commands a key or a form can give: (ed-move …), (ed-copy …), (ed-delete …) and
// (ed-mkdir …). On disk they do what they say; a tab open from a moved file follows it, one open
// from a deleted file closes; nothing is ever written over, and nothing leaves the workspace.
//
// The dev bridge keeps a deleted file in .eeditor/trash/ (the desktop app hands it to the system
// Trash). The notes and the config are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const DIR = `${UI_WORKSPACE}/fc`;
const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const there = (p) => stat(`${UI_WORKSPACE}/${p}`).then(() => true, () => false);
const disk = (p) => readFile(`${UI_WORKSPACE}/${p}`, "utf8");

const config = `
(bind "Ctrl-Alt-m" (ed-move "fc/fca.md" "fc/moved/fca2.md"))
(bind "Ctrl-Alt-c" (ed-copy "fc/folder" "fc/folder-copy"))
(bind "Ctrl-Alt-d" (ed-delete "fc/moved/fca2.md"))
(bind "Ctrl-Alt-k" (ed-mkdir "fc/new/deeper"))
(bind "Ctrl-Alt-o" (ed-move "fc/fcb.md" "fc/fcc.md"))
(bind "Ctrl-Alt-e" (ed-move "fc/fcb.md" "../escaped.md"))
`;

test.beforeAll(async () => {
  await mkdir(`${DIR}/folder/inner`, { recursive: true });
  await writeFile(`${DIR}/fca.md`, "# A\n");
  await writeFile(`${DIR}/fcb.md`, "# B\n");
  await writeFile(`${DIR}/fcc.md`, "# C — not to be written over\n");
  await writeFile(`${DIR}/folder/inner/x.md`, "x\n");
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await writeFile(CONFIG, config);
});

test.afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  await rm(CONFIG, { force: true });
  await rm(`${UI_WORKSPACE}/.eeditor/trash`, { recursive: true, force: true });
});

const active = (page) => page.locator(".etab.active .etab-label");

async function press(page, key) {
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press(key);
}

test("ed-move moves a file into a new folder, and its open tab follows", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "fca.md" }).click();
  await expect(active(page)).toHaveText("fca.md");
  await press(page, "Control+Alt+m");
  await expect(active(page)).toHaveText("fca2.md");
  expect(await there("fc/fca.md")).toBe(false);
  expect(await disk("fc/moved/fca2.md")).toBe("# A\n");
  // typed into after the move, it saves to the new place
  await page.keyboard.type("more");
  await page.keyboard.press(`${MOD}+s`);
  await expect.poll(() => disk("fc/moved/fca2.md")).toContain("more");
  expect(await there("fc/fca.md")).toBe(false);
});

test("ed-move never writes over a file that is there", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "fcb.md" }).click();
  await press(page, "Control+Alt+o");
  await expect(page.locator(".toast").filter({ hasText: "already exists" })).toBeVisible();
  expect(await disk("fc/fcc.md")).toBe("# C — not to be written over\n");
  expect(await disk("fc/fcb.md")).toBe("# B\n");
});

test("nothing moves out of the workspace", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "fcb.md" }).click();
  await press(page, "Control+Alt+e");
  await expect(page.locator(".toast").filter({ hasText: "escapes workspace" })).toBeVisible();
  expect(await disk("fc/fcb.md")).toBe("# B\n");
  expect(await stat(`${UI_WORKSPACE}/../escaped.md`).then(() => true, () => false)).toBe(false);
});

test("ed-copy copies a whole folder; ed-mkdir makes the folders above too", async ({ page }) => {
  await page.goto("/");
  await press(page, "Control+Alt+c");
  await expect.poll(() => there("fc/folder-copy/inner/x.md")).toBe(true);
  expect(await disk("fc/folder/inner/x.md")).toBe("x\n");
  await press(page, "Control+Alt+k");
  await expect.poll(() => there("fc/new/deeper")).toBe(true);
  // and the tree shows what the commands made
  await expect(page.locator(".tree-dir", { hasText: "folder-copy" })).toBeVisible();
});

test("ed-delete puts a file in the trash and closes its tab", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "fca2.md" }).click();
  await expect(active(page)).toHaveText("fca2.md");
  await press(page, "Control+Alt+d");
  await expect(page.locator(".etab .etab-label", { hasText: "fca2.md" })).toHaveCount(0);
  expect(await there("fc/moved/fca2.md")).toBe(false);
  const bins = await readdir(`${UI_WORKSPACE}/.eeditor/trash`);
  const kept = await Promise.all(bins.map((b) => there(`.eeditor/trash/${b}/fca2.md`)));
  expect(kept).toContain(true);
});
