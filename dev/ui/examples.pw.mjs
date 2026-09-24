// The example forms in workspace/examples, run in a real browser against a real engine: each one
// loads, and the thing it is there to show works. Seeded by setup.mjs.

import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/** Open a form from the tree and run it in its tab; the runner is returned. */
async function run(page, name) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: `${name}.eeform` }).click();
  await page.waitForSelector(".fd-canvas");
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await page.waitForSelector(".formrun-canvas");
  return page.locator(".formrun-host");
}

const ctl = (form, name) => form.locator(`.formrun-ctl[data-name=${name}]`);

test("Functions lists the engine's functions, shows one's source, and runs it", async ({ page }) => {
  const form = await run(page, "Functions");
  await expect(ctl(form, "lblCount")).toContainText("functions");
  await ctl(form, "grdFns").locator(".formrun-filter").fill("str-join");
  await ctl(form, "grdFns").locator("tbody tr", { hasText: "str-join" }).first().click();
  await expect(ctl(form, "lblSig")).toHaveText("(str-join sep parts) → string");
  await expect(ctl(form, "txtSource").locator("textarea")).toHaveValue(/str-join — builtin/);
  await ctl(form, "txtArgs").locator("input").fill(`"-" '("a" "b")`);
  await ctl(form, "btnRun").locator("button").click();
  await expect(ctl(form, "txtResult").locator("textarea")).toHaveValue(/^a-b\n\n; string$/);

  // its own handlers are functions too, listed with the comment written above them
  await ctl(form, "cboKind").locator("select").selectOption("function");
  await ctl(form, "grdFns").locator(".formrun-filter").fill("fns-rows");
  await ctl(form, "grdFns").locator("tbody tr").first().click();
  await expect(ctl(form, "txtSource").locator("textarea")).toHaveValue(/;; The listing, as data/);
});

test("Books moves record by record and does New, Edit, Save, Delete", async ({ page }) => {
  const form = await run(page, "Books");
  await expect(ctl(form, "lblPos")).toHaveText("No records");
  await expect(ctl(form, "btnSave").locator("button")).toBeDisabled();

  await form.locator(".formrun-menu", { hasText: "Record" }).click();
  await form.locator(".formrun-menuitem", { hasText: "Add sample books" }).click();
  await expect(ctl(form, "lblPos")).toHaveText("Record 1 of 3");
  await expect(ctl(form, "txtTitle").locator("input")).toHaveValue("The Mythical Man-Month");
  await expect(ctl(form, "txtTitle").locator("input")).toBeDisabled();
  await expect(ctl(form, "btnPrev").locator("button")).toBeDisabled();

  await ctl(form, "btnNext").locator("button").click();
  await expect(ctl(form, "lblPos")).toHaveText("Record 2 of 3");
  await ctl(form, "btnLast").locator("button").click();
  await expect(ctl(form, "txtAuthor").locator("input")).toHaveValue("Douglas Hofstadter");
  await expect(ctl(form, "btnNext").locator("button")).toBeDisabled();

  await ctl(form, "btnNew").locator("button").click();
  await expect(ctl(form, "lblPos")).toHaveText("New record");
  await ctl(form, "txtTitle").locator("input").fill("Dune");
  await ctl(form, "txtYear").locator("input").fill("1965");
  await ctl(form, "btnSave").locator("button").click();
  await expect(ctl(form, "lblPos")).toHaveText("Record 4 of 4");
  await expect(ctl(form, "lblStatus")).toHaveText("Saved Dune");

  await ctl(form, "btnFirst").locator("button").click();
  await ctl(form, "btnEdit").locator("button").click();
  await ctl(form, "txtYear").locator("input").fill("1976");
  await ctl(form, "btnSave").locator("button").click();
  await expect(ctl(form, "txtYear").locator("input")).toHaveValue("1976");

  await ctl(form, "txtFind").locator("input").fill("dune");
  await ctl(form, "txtFind").locator("input").press("Tab");
  await expect(ctl(form, "lblPos")).toHaveText("Record 4 of 4");
  await ctl(form, "btnDelete").locator("button").click();
  await expect(ctl(form, "lblPos")).toHaveText("Record 3 of 3");
  await expect(ctl(form, "lblStatus")).toHaveText("Deleted Dune");
});

test("Tables opens any table, queries it, and edits a cell in place", async ({ page }) => {
  const form = await run(page, "Tables");
  await ctl(form, "cboTable").locator("select").selectOption("books");
  await expect(ctl(form, "lblQuery")).toHaveText("λ (query books)");
  await expect(ctl(form, "grdRows").locator("tbody tr")).toHaveCount(3);

  await ctl(form, "txtWhere").locator("input").fill("year < 1980");
  await ctl(form, "cboOrder").locator("select").selectOption("year");
  await ctl(form, "btnQuery").locator("button").click();
  await expect(ctl(form, "lblQuery")).toHaveText('λ (query books :where "year < 1980" :order "year")');
  await expect(ctl(form, "grdRows").locator("tbody tr")).toHaveCount(2);
  await expect(ctl(form, "grdRows").locator("tbody tr").first()).toContainText("The Mythical Man-Month");

  const cell = ctl(form, "grdRows").locator("tbody tr").first().locator("td").nth(1);
  await cell.dblclick();
  await form.locator(".formrun-cell").fill("F. P. Brooks");
  await form.locator(".formrun-cell").press("Enter");
  await expect(ctl(form, "lblCount")).toHaveText(/^Saved row \d+$/);
  await page.locator(".repl-input").fill('(field-get (first (records (query books :order "year"))) :author)');
  await page.locator(".repl-input").press(`${process.platform === "darwin" ? "Meta" : "Control"}+Enter`);
  await expect(page.locator(".repl-scrollback .result-scalar").last()).toContainText("F. P. Brooks");
});

test("Orders shows the picked customer's orders and their total", async ({ page }) => {
  const form = await run(page, "Orders");
  await form.locator(".formrun-menu", { hasText: "Orders" }).click();
  await form.locator(".formrun-menuitem", { hasText: "Add sample data" }).click();
  await ctl(form, "grdCustomers").locator("tbody tr", { hasText: "Ada Lovelace" }).click();
  await expect(ctl(form, "lblOrders")).toHaveText("Orders of Ada Lovelace");
  await expect(ctl(form, "grdOrders").locator("tbody tr")).toHaveCount(2);
  await expect(ctl(form, "lblTotal")).toHaveText("2 orders · total 112");

  await ctl(form, "txtItem").locator("input").fill("Ink");
  await ctl(form, "txtQty").locator("input").fill("2");
  await ctl(form, "txtPrice").locator("input").fill("1.5");
  await ctl(form, "btnAddOrder").locator("button").click();
  await expect(ctl(form, "lblTotal")).toHaveText("3 orders · total 115");
});

test("Agenda adds, edits, files and completes items across its tabs", async ({ page }) => {
  const form = await run(page, "Agenda");
  await ctl(form, "cboShow").locator("select").selectOption("all");

  // Quick add: the preview says what the parser understood
  await form.locator(".formrun-tab", { hasText: "Quick add" }).click();
  await ctl(form, "txtQuick").locator("input").fill("pay rent tomorrow !!");
  await ctl(form, "txtQuick").locator("input").press("Tab");
  await expect(ctl(form, "txtPreview").locator("textarea")).toHaveValue(/text\s+pay rent/);
  await ctl(form, "btnQuick").locator("button").click();
  await expect(ctl(form, "txtPreview").locator("textarea")).toHaveValue("Added: pay rent tomorrow !!");

  // a category and a rule that files by text
  await form.locator(".formrun-tab", { hasText: "Categories & rules" }).click();
  await ctl(form, "txtNewCat").locator("input").fill("home");
  await ctl(form, "btnDefCat").locator("button").click();
  await expect(ctl(form, "txtCats").locator("textarea")).toHaveValue(/home/);
  await ctl(form, "txtRuleName").locator("input").fill("rent");
  await ctl(form, "txtRuleText").locator("input").fill("rent");
  await ctl(form, "cboRuleCat").locator("select").selectOption("home");
  await ctl(form, "btnDefRule").locator("button").click();
  await expect(ctl(form, "txtRules").locator("textarea")).toHaveValue(/rent: \(str-contains/);
  await ctl(form, "btnApply").locator("button").click();
  await expect(page.locator(".toast").last()).toHaveText("Rules changed 1 item");

  // the item, filed, in the grid; picked into the editor; changed; done
  await form.locator(".formrun-tab", { hasText: "Items" }).click();
  const row = ctl(form, "grdItems").locator("tbody tr", { hasText: "pay rent" });
  await expect(row).toContainText("home");
  await row.click();
  await expect(ctl(form, "txtText").locator("input")).toHaveValue("pay rent");
  await ctl(form, "txtNotes").locator("textarea").fill("by transfer");
  await ctl(form, "btnSave").locator("button").click();
  await expect(ctl(form, "lblStatus")).toHaveText("Saved pay rent");
  await page.locator(".repl-input").fill('(dict-get (item->dict (item-get 1)) "notes")');
  await page.locator(".repl-input").press(`${process.platform === "darwin" ? "Meta" : "Control"}+Enter`);
  await expect(page.locator(".repl-scrollback .result-scalar").last()).toContainText("by transfer");
  await ctl(form, "btnDone").locator("button").click();
  await expect(ctl(form, "grdItems").locator("tbody tr", { hasText: "pay rent" })).toHaveCount(0);

  // a saved view
  await form.locator(".formrun-tab", { hasText: "Views" }).click();
  await ctl(form, "txtViewName").locator("input").fill("homey");
  await ctl(form, "cboViewKind").locator("select").selectOption("in category");
  await ctl(form, "txtViewArg").locator("input").fill("home");
  await ctl(form, "btnDefView").locator("button").click();
  await expect(ctl(form, "lstViews")).toContainText("homey");
});

test("Office runs the others in its frame, lends their menus to its bar, and reopens the last screen", async ({ page }) => {
  const form = await run(page, "Office");
  const bar = form.locator(".formrun-menubar").first();
  const frame = ctl(form, "frmMain");
  await ctl(form, "lstNav").locator(".formrun-item", { hasText: "Books" }).click();
  await expect(frame.locator(".formrun.in-frame")).toHaveCount(1);
  await expect(ctl(form, "lblShowing")).toHaveText("showing Books");
  // Books' own menus are on Office's bar now, between Office's and Window
  await expect(bar.locator(".formrun-menu")).toHaveText(["Office", "Record", "Go", "Window"]);
  await bar.locator(".formrun-menu", { hasText: "Go" }).click();
  await page.locator(".formrun-menulist .formrun-menuitem", { hasText: "Last" }).click();
  await expect(frame.locator(".formrun-ctl[data-name=lblPos]")).toHaveText(/^Record (\d+) of \1$/);

  await ctl(form, "lstNav").locator(".formrun-item", { hasText: "Agenda" }).click();
  await expect(bar.locator(".formrun-menu")).toHaveText(["Office", "Agenda", "Rules", "Help", "Window"]);
  await bar.locator(".formrun-menu", { hasText: "Window" }).click();
  await expect(page.locator(".formrun-menulist .formrun-menuitem").first()).toContainText("Books");
  await page.keyboard.press("Escape");

  // run it again: it opens where it was left
  await form.locator(".formrun-stop").first().click();
  await page.locator(".form-modes .head-btn", { hasText: "run" }).click();
  await expect(ctl(page.locator(".formrun-host"), "lblShowing")).toHaveText("showing Agenda");
});
