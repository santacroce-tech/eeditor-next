// What a form has to do, in a real browser against a real engine: the designer draws a file and
// writes one back, and a running form's handlers reach the database.
//
// One workspace, in order: the sample Contacts.eeform is seeded by setup.mjs, the new form is made here.

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** The text in the (hidden or shown) CodeMirror buffer. */
const buffer = (page) => page.locator(".editor-host .cm-content").innerText();

async function openContacts(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "Contacts.eeform" }).click();
  await page.waitForSelector(".fd-canvas");
}

test("a form opens in the designer with every control drawn", async ({ page }) => {
  await openContacts(page);
  await expect(page.locator(".form-modes .head-btn.active")).toHaveText("design");
  await expect(page.locator(".fd-title")).toHaveText("Contacts");
  await expect(page.locator(".fd-ctl")).toHaveCount(8);
  await expect(page.locator(".fd-ctl.button .fd-p-button").first()).toHaveText("Save");
  // the properties panel shows the form until something is picked
  await expect(page.locator(".fd-props-head")).toHaveText("Form");
  await page.locator(".fd-ctl[data-name=btnSave]").click();
  await expect(page.locator(".fd-props-head")).toHaveText("Button · btnSave");
  await expect(page.locator(".fd-event input").first()).toHaveValue("save-contact");
  await expect(page.locator(".fd-event input").nth(1)).toHaveValue("check-contact");
});

test("running the form saves into the table and reads it back", async ({ page }) => {
  await openContacts(page);
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-canvas");
  await expect(page.locator(".formrun-grid tbody tr")).toHaveCount(0);

  await page.locator(".formrun-ctl[data-name=txtName] input").fill("Ada Lovelace");
  await page.locator(".formrun-ctl[data-name=txtAge] input").fill("36");
  await page.locator(".formrun-ctl[data-name=btnSave] button").click();
  await expect(page.locator(".formrun-grid tbody tr")).toHaveCount(1);
  await expect(page.locator(".formrun-grid tbody td").first()).toHaveText("Ada Lovelace");
  await expect(page.locator(".formrun-ctl[data-name=lblStatus]")).toHaveText("Saved Ada Lovelace");
  // the handler cleared the boxes after saving
  await expect(page.locator(".formrun-ctl[data-name=txtName] input")).toHaveValue("");

  // a row picked in the grid comes back into the boxes; Save then changes it
  await page.locator(".formrun-grid tbody tr").first().click();
  await expect(page.locator(".formrun-ctl[data-name=txtName] input")).toHaveValue("Ada Lovelace");
  await page.locator(".formrun-ctl[data-name=txtAge] input").fill("37");
  await page.locator(".formrun-ctl[data-name=btnSave] button").click();
  await expect(page.locator(".formrun-grid tbody tr")).toHaveCount(1);
  await expect(page.locator(".formrun-grid tbody td").nth(1)).toHaveText("37");

  // Save is a :submit button: with the :required name box empty it refuses, names the box, and the handler never runs
  await page.locator(".formrun-ctl[data-name=btnSave] button").click();
  await expect(page.locator(".toast").last()).toHaveText("Name is required");
  await expect(page.locator(".formrun-ctl[data-name=txtName]")).toHaveClass(/invalid/);
  await expect(page.locator(".formrun-ctl[data-name=txtName] input")).toBeFocused();
  // :min/:max on the number box, then the :on-validate handler's own rule, each refusing in turn
  await page.locator(".formrun-ctl[data-name=txtName] input").fill("Ada");
  await page.locator(".formrun-ctl[data-name=txtAge] input").fill("200");
  await page.locator(".formrun-ctl[data-name=btnSave] button").click();
  await expect(page.locator(".toast").last()).toHaveText("Age must be at most 150");
  await page.locator(".formrun-ctl[data-name=txtAge] input").fill("40");
  // Save is the :default button: Enter in a box presses it
  await page.locator(".formrun-ctl[data-name=txtAge] input").press("Enter");
  await expect(page.locator(".toast").last()).toHaveText("A contact needs a first and a last name");
  await expect(page.locator(".formrun-grid tbody tr")).toHaveCount(1);

  // the REPL sees the same table
  await page.locator(".repl-input").fill("(count-records contacts)");
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await expect(page.locator(".repl-scrollback .result-scalar").last()).toHaveText("1");

  await page.locator(".formrun-stop").click();
  await expect(page.locator(".form-modes .head-btn.active")).toHaveText("design");

  // an :editable grid: double-click a cell, type, Enter — the row goes back through :on-edit
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-host .formrun-canvas");
  await expect(page.locator(".formrun-host .formrun-grid tbody tr")).toHaveCount(1);
  await page.locator(".formrun-host .formrun-grid tbody td").nth(1).dblclick();
  await page.locator(".formrun-host .formrun-cell").fill("41");
  await page.locator(".formrun-host .formrun-cell").press("Enter");
  await expect(page.locator(".formrun-host .formrun-ctl[data-name=lblStatus]")).toHaveText("Saved Ada Lovelace");
  await page.locator(".repl-input").fill('(count-records contacts :where "age = ?" :params (list 41))');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await expect(page.locator(".repl-scrollback .result-scalar").last()).toHaveText("1");
  await page.locator(".formrun-host .formrun-stop").click();

  // the REPL can open a form — in a floating window, over whatever note is open — the way a keybinding would
  await page.locator(".tree-file", { hasText: "welcome.md" }).click();
  await page.locator(".repl-input").fill('(ed-form "Contacts")');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await page.waitForSelector(".formwin .formrun-canvas");
  await expect(page.locator(".repl-scrollback .repl-output").last()).toHaveText("→ done");
  await expect(page.locator(".formwin .formrun-grid tbody tr")).toHaveCount(1);
  await expect(page.locator(".etab.active .etab-label")).toHaveText("welcome.md");
  // asking again raises the same window rather than opening another
  await page.locator(".repl-input").fill('(ed-form "Contacts")');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await expect(page.locator(".formwin")).toHaveCount(1);
  // its handlers reach the same table
  await page.locator(".formwin .formrun-ctl[data-name=txtName] input").fill("Grace Hopper");
  await page.locator(".formwin .formrun-ctl[data-name=txtAge] input").fill("85");
  await page.locator(".formwin .formrun-ctl[data-name=btnSave] button").click();
  await expect(page.locator(".formwin .formrun-grid tbody tr")).toHaveCount(2);
  await page.locator(".formwin .formrun-stop").click();
  await expect(page.locator(".formwin")).toHaveCount(0);

  // ⧉ on a form running in its tab moves it into a window and hands the tab back to the designer
  await openContacts(page);
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.locator(".formrun-host .formrun-popout").click();
  await expect(page.locator(".formwin .formrun-canvas")).toHaveCount(1);
  await expect(page.locator(".form-modes .head-btn.active")).toHaveText("design");
  await page.locator(".formwin .formrun-stop").click();
});

test("a new form gets a button from the toolbox, written into the code, and undone", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-dir").click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "New form…" }).click();
  await page.locator(".dlg-input").fill("Orders");
  await page.locator(".dlg-input").press("Enter");
  await page.waitForSelector(".fd-canvas");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("Orders.eeform");
  await expect(page.locator(".fd-ctl")).toHaveCount(0);

  await page.locator(".fd-tool", { hasText: "Button" }).click();
  const canvas = page.locator(".fd-canvas");
  await canvas.click({ position: { x: 100, y: 60 } }); // snaps to the 8px grid
  await expect(page.locator(".fd-ctl")).toHaveCount(1);
  await expect(page.locator(".fd-props-head")).toHaveText("Button · btn1");
  // the layout in the file follows
  await expect.poll(() => buffer(page)).toContain("(button btn1 :text \"Button\" :at (104 64) :size (88 32))");

  // double-click writes the handler and opens the code at it
  await page.locator(".fd-ctl[data-name=btn1]").dblclick();
  await expect(page.locator(".form-modes .head-btn.active")).toHaveText("code");
  await expect.poll(() => buffer(page)).toContain("(defn btn1-click (f)");
  await expect.poll(() => buffer(page)).toContain(":on-click btn1-click");

  // back in the designer, ⌘Z is the editor's undo
  await page.locator(".form-modes .head-btn", { hasText: "design" }).click();
  await page.locator(".fd-stage").focus();
  await page.keyboard.press(`${MOD}+z`); // the handler stub
  await page.keyboard.press(`${MOD}+z`); // the :on-click
  await page.keyboard.press(`${MOD}+z`); // the button
  await expect(page.locator(".fd-ctl")).toHaveCount(0);
  await expect.poll(() => buffer(page)).not.toContain("btn1");
});

test("several controls at once: marquee, align, copy and paste", async ({ page }) => {
  await openContacts(page);
  const stage = page.locator(".fd-stage");
  // drag a box across the two text boxes (x 96–336, y 16–84 on the canvas)
  const box = await page.locator(".fd-canvas").boundingBox();
  await page.mouse.move(box.x + 90, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 70, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".fd-ctl.selected")).toHaveCount(2);
  await expect(page.locator(".fd-props-head")).toHaveText("2 controls");

  // ⇧-click adds the Save button; it becomes the reference, and "left edges" moves the boxes to x=96 → 96 already, so use right edges
  await page.locator(".fd-ctl[data-name=btnSave]").click({ modifiers: ["Shift"] });
  await expect(page.locator(".fd-props-head")).toHaveText("3 controls");
  await page.locator(".fd-action[title='Left edges']").click();
  await expect.poll(() => buffer(page)).toContain("(textbox txtAge :number true :min 0 :max 150 :at (96 52)");
  await page.locator(".fd-action[title='Same width']").click();
  await expect.poll(() => buffer(page)).toContain("(textbox txtName :placeholder \"Ada Lovelace\" :required true :at (96 16) :size (88 28)");

  // copy the three and paste: three more, freshly named, selected
  await stage.focus();
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+v`);
  await expect(page.locator(".fd-ctl")).toHaveCount(11);
  await expect(page.locator(".fd-ctl.selected")).toHaveCount(3);
  await expect.poll(() => buffer(page)).toContain("(button btn1 :text \"Save\"");
  // Delete takes the whole selection away again
  await page.keyboard.press("Delete");
  await expect(page.locator(".fd-ctl")).toHaveCount(8);
});

test("pages: a control on a tab's page shows only while that page is open", async ({ page }) => {
  await page.goto("/");
  await page.locator(".tree-dir").click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "New form…" }).click();
  await page.locator(".dlg-input").fill("Paged");
  await page.locator(".dlg-input").press("Enter");
  await page.waitForSelector(".fd-canvas");
  const canvas = page.locator(".fd-canvas");
  await page.locator(".fd-tool", { hasText: "Tabs" }).click();
  await canvas.click({ position: { x: 20, y: 20 } });
  await page.locator(".fd-tool", { hasText: "Button" }).click();
  await canvas.click({ position: { x: 60, y: 100 } });
  await expect(page.locator(".fd-props-head")).toHaveText("Button · btn1");
  // put the button on the second page: it disappears, since the designer shows the first
  const pageField = page.locator(".fd-field", { hasText: "Page" }).locator("input");
  await pageField.fill("Details");
  await pageField.press("Enter");
  await expect(page.locator(".fd-ctl[data-name=btn1]")).toBeHidden();
  await expect.poll(() => buffer(page)).toContain(':page "Details"');
  // clicking the tab header in the designer opens that page
  await page.locator(".fd-p-tab", { hasText: "Details" }).click();
  await expect(page.locator(".fd-ctl[data-name=btn1]")).toBeVisible();
  // and when the form runs, the button is there only on its page
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-canvas");
  await expect(page.locator(".formrun-ctl[data-name=btn1]")).toBeHidden();
  await page.locator(".formrun-tab", { hasText: "Details" }).click();
  await expect(page.locator(".formrun-ctl[data-name=btn1]")).toBeVisible();
  await page.locator(".formrun-tab", { hasText: "General" }).click();
  await expect(page.locator(".formrun-ctl[data-name=btn1]")).toBeHidden();
});

test("a sheet control shows a live grid over a .eesheet beside the form", async ({ page }) => {
  await page.goto("/");
  // a sheet with something in it, made from the REPL
  await page.locator(".repl-input").fill('(do (sheet-new "Figures") (sheet-set "Figures" "A1" "hello") (sheet-set "Figures" "B1" "=(* 6 7)"))');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await expect(page.locator(".repl-scrollback .repl-result").last()).toBeVisible();
  await page.locator(".tree-dir").click({ button: "right" });
  await page.locator(".ctx-item", { hasText: "New form…" }).click();
  await page.locator(".dlg-input").fill("Sheeted");
  await page.locator(".dlg-input").press("Enter");
  await page.waitForSelector(".fd-canvas");
  await page.locator(".fd-tool", { hasText: "Sheet" }).click();
  await page.locator(".fd-canvas").click({ position: { x: 20, y: 20 } });
  const fileField = page.locator(".fd-field", { hasText: "Sheet file" }).locator("input");
  await fileField.fill("Figures");
  await fileField.press("Enter");
  await expect.poll(() => buffer(page)).toContain('(sheet sht1 :file "Figures"');
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-ctl[data-name=sht1] .sheet-cell");
  await expect.poll(() => page.$$eval(".formrun-ctl[data-name=sht1] .sheet-cell", (els) => els.map((e) => e.textContent))).toEqual(["hello", "42"]);
  await page.locator(".formrun-stop").click();
});

test("the datagrid: pages, a filter box, sorting by a header; and the menu bar", async ({ page }) => {
  await page.goto("/");
  // six more contacts straight into the table, so the grid has more than a page
  await page.locator(".repl-input").fill('(for-each n (range 1 7) (insert contacts {:name (str "Person " n) :age (* n 10)}))');
  await page.locator(".repl-input").press(`${MOD}+Enter`);
  await expect(page.locator(".repl-scrollback .repl-result").last()).toBeVisible();
  await openContacts(page);
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-host .formrun-canvas");
  const grid = page.locator(".formrun-host .formrun-ctl[data-name=grdAll]");
  await expect(grid.locator("tbody tr")).toHaveCount(5);
  await expect(grid.locator(".formrun-pageno")).toHaveText("1 / 2");
  await expect(grid.locator(".formrun-rowcount")).toHaveText("8 rows");
  await grid.locator(".formrun-pagebtn", { hasText: "›" }).click();
  await expect(grid.locator("tbody tr")).toHaveCount(3);
  await expect(grid.locator(".formrun-pageno")).toHaveText("2 / 2");
  // the filter narrows what is paged
  await grid.locator(".formrun-filter").fill("person 3");
  await expect(grid.locator("tbody tr")).toHaveCount(1);
  await expect(grid.locator("tbody td").first()).toHaveText("Person 3");
  await grid.locator(".formrun-filter").fill("");
  // sort by age, then the other way
  await grid.locator("th", { hasText: "age" }).click();
  await expect(grid.locator("tbody tr").first().locator("td").nth(1)).toHaveText("10");
  await grid.locator("th", { hasText: "age" }).click();
  await expect(grid.locator("tbody tr").first().locator("td").nth(1)).toHaveText("85");
  // the menu bar: an item runs its handler
  await page.locator(".formrun-host .formrun-menu", { hasText: "Help" }).click();
  await page.locator(".formrun-host .formrun-menuitem", { hasText: "About" }).click();
  await expect(page.locator(".toast").last()).toContainText("an EEditor form");
  await page.locator(".formrun-host .formrun-menu", { hasText: "Contacts" }).click();
  await page.locator(".formrun-host .formrun-menuitem", { hasText: "Close" }).click();
  await expect(page.locator(".form-modes .head-btn.active")).toHaveText("design");
});
