// A form's own keys: :on-key hears the keys named in :keys — as `$pressed`, written the way (bind …)
// writes them, with `$control` the control that had the focus — before the app's shortcuts do, and
// never while the caret is in a text box. A listbox or grid moves its pick with ↑ ↓ Home End, and
// Enter is a double-click. After file commands the form gave, its :on-refresh runs: dir-list sees
// the folder as it is now.
//
// The form, the notes and the config are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const DIR = `${UI_WORKSPACE}/fk`;
const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;

const FORM = `(form "Keys" :size (420 260) :on-load fk-load :on-key fk-key :on-refresh fk-load
  :keys ("Mod-Right" "Mod-b" "Tab" "F5")
  (listbox lstLeft :at (10 10) :size (190 150) :on-dblclick fk-open)
  (grid grdRight :at (210 10) :size (200 150) :columns ("name") :on-change fk-pick :on-dblclick fk-open)
  (textbox txtName :at (10 170) :size (190 24))
  (label lblKey :text "" :at (10 200) :size (400 20))
  (label lblCount :text "" :at (10 224) :size (400 20)))
(defn fk-names (dir) (map (fn (e) (dict-get e :name)) (dir-list dir)))
(defn fk-load (f)
  (ui-set "lstLeft" :items (fk-names "fk/left"))
  (ui-set "grdRight" :rows (map (fn (n) {:name n}) (fk-names "fk/right")))
  (ui-set "lblCount" :text (str (length (fk-names "fk/left")) " left · " (length (fk-names "fk/right")) " right")))
(defn fk-key (f)
  (ui-set "lblKey" :text (str (ui-get f "$pressed") " in " (ui-get f "$control")))
  (cond (= (ui-get f "$pressed") "Mod-Right")
          (ui-editor (ed-move (str "fk/left/" (ui-get f "lstLeft")) (str "fk/right/" (ui-get f "lstLeft"))))
        (= (ui-get f "$pressed") "Tab") (ui-focus "grdRight")
        true nil))
(defn fk-pick (f) (ui-set "lblKey" :text (str "picked " (dict-get (ui-get f "grdRight") :name))))
(defn fk-open (f) (ui-set "lblKey" :text "opened"))
`;

test.beforeAll(async () => {
  await mkdir(`${DIR}/left`, { recursive: true });
  await mkdir(`${DIR}/right`, { recursive: true });
  for (const n of ["one.md", "two.md"]) await writeFile(`${DIR}/left/${n}`, `# ${n}\n`);
  for (const n of ["r1.md", "r2.md", "r3.md"]) await writeFile(`${DIR}/right/${n}`, `# ${n}\n`);
  await writeFile(`${DIR}/Keys.eeform`, FORM);
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await writeFile(CONFIG, `(bind "Ctrl-Alt-f" (ed-form "fk/Keys"))\n`);
});

test.afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
  await rm(CONFIG, { force: true });
});

const ctl = (page, name) => page.locator(`.formwin .formrun-ctl[data-name=${name}]`);

async function openForm(page) {
  await page.goto("/");
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+Alt+f");
  await expect(ctl(page, "lblCount")).toHaveText("2 left · 3 right");
}

test("the keys in :keys reach :on-key, with the control that had the focus", async ({ page }) => {
  await openForm(page);
  await ctl(page, "lstLeft").locator(".formrun-item", { hasText: "one.md" }).click();
  await page.keyboard.press("F5");
  await expect(ctl(page, "lblKey")).toHaveText("F5 in lstLeft");
  // ⌘B is the app's sidebar key — but this form names it, so it is the form's
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.keyboard.press(`${MOD}+b`);
  await expect(ctl(page, "lblKey")).toHaveText("Mod-b in lstLeft");
  await expect(page.locator(".sidebar")).toBeVisible();
  // Tab is in :keys too: the form moves the focus to the grid itself
  await page.keyboard.press("Tab");
  await expect(ctl(page, "lblKey")).toHaveText("Tab in lstLeft");
  await expect(ctl(page, "grdRight").locator(".formrun-grid")).toBeFocused();
});

test("a key the form doesn't name is the app's, and a text box keeps every key", async ({ page }) => {
  await openForm(page);
  await ctl(page, "lstLeft").locator(".formrun-item", { hasText: "one.md" }).click();
  await page.keyboard.press(`${MOD}+Shift+F5`); // not in :keys
  await expect(ctl(page, "lblKey")).toHaveText("");
  await ctl(page, "txtName").locator("input").click();
  await page.keyboard.press("F5");
  await page.keyboard.type("abc");
  await expect(ctl(page, "lblKey")).toHaveText("");
  await expect(ctl(page, "txtName").locator("input")).toHaveValue("abc");
});

test("↑ ↓ Home End move a grid's pick and Enter opens it; a listbox too", async ({ page }) => {
  await openForm(page);
  await ctl(page, "grdRight").locator("td", { hasText: "r1.md" }).click();
  await expect(ctl(page, "lblKey")).toHaveText("picked r1.md");
  await page.keyboard.press("ArrowDown");
  await expect(ctl(page, "lblKey")).toHaveText("picked r2.md");
  await page.keyboard.press("End");
  await expect(ctl(page, "lblKey")).toHaveText("picked r3.md");
  await page.keyboard.press("Home");
  await expect(ctl(page, "lblKey")).toHaveText("picked r1.md");
  await page.keyboard.press("Enter");
  await expect(ctl(page, "lblKey")).toHaveText("opened");

  await ctl(page, "lstLeft").locator(".formrun-item", { hasText: "one.md" }).click();
  await page.keyboard.press("ArrowDown");
  await expect(ctl(page, "lstLeft").locator(".formrun-item.selected")).toHaveText("two.md");
});

test("⌘→ moves the pick to the other folder, and :on-refresh lists them again", async ({ page }) => {
  await openForm(page);
  await ctl(page, "lstLeft").locator(".formrun-item", { hasText: "one.md" }).click();
  await page.keyboard.press(`${MOD}+ArrowRight`);
  await expect(ctl(page, "lblCount")).toHaveText("1 left · 4 right");
  expect(await stat(`${DIR}/right/one.md`).then(() => true, () => false)).toBe(true);
  await expect(ctl(page, "grdRight").locator("td", { hasText: "one.md" })).toBeVisible();
});
