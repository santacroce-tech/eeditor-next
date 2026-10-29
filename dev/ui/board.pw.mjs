// The board control (a kanban), in a real browser against a real engine: rows as cards in a lane
// per :lane-by value; a drag to another lane, or ⌥→ on the card picked, moves it and runs :on-move
// with $from and $to. Then the PIM's use of it — the Agenda window's Board tab: a category's
// children as columns, a card dragged across refiled there, and ⇩ putting the board in the note in
// front as a table.
//
// The forms, config and note are written for this spec and removed after it.

import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

const CONFIG = `${UI_WORKSPACE}/.eeditor/keybindings.eelisp`;
const NOTE = `${UI_WORKSPACE}/brd-note.md`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const KANBAN = `(form "Kanban" :size (600 320) :on-load kb-load
  (board brdTasks :lanes ("To do" "Doing" "Done") :lane-by "stage" :card "title" :sub "who" :at (8 8) :size (584 264) :on-move kb-moved :on-change kb-picked)
  (label lblSaid :at (8 280) :size (584 24)))
(defn kb-load (f)
  (ui-set "brdTasks" :rows (list {:id 1 :title "write the spec" :who "Ana" :stage "To do"}
                                 {:id 2 :title "pick the fonts" :who "Bob" :stage "To do"}
                                 {:id 3 :title "ship it" :who "" :stage "Done"})))
(defn kb-moved (f)
  (ui-set "lblSaid" :text (str (dict-get (ui-get f "brdTasks") "title") ": " (ui-get f "$from") " → " (ui-get f "$to"))))
(defn kb-picked (f)
  (ui-set "lblSaid" :text (str "picked " (dict-get (ui-get f "brdTasks") "title"))))
`;

test.beforeAll(async () => {
  await mkdir(`${UI_WORKSPACE}/brd`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/pim`, { recursive: true });
  await mkdir(`${UI_WORKSPACE}/.eeditor`, { recursive: true });
  await writeFile(`${UI_WORKSPACE}/brd/Kanban.eeform`, KANBAN);
  await writeFile(`${UI_WORKSPACE}/pim/Agenda.eeform`, await readFile("docs/pim/Agenda.eeform", "utf8"));
  await writeFile(CONFIG, `${await readFile("docs/pim/pim.eelisp", "utf8")}\n(on-start (ed-open "welcome.md"))\n`);
  await writeFile(NOTE, "# Board\n\n");
});

test.afterAll(async () => {
  await rm(`${UI_WORKSPACE}/brd`, { recursive: true, force: true });
  await rm(`${UI_WORKSPACE}/pim`, { recursive: true, force: true });
  await rm(CONFIG, { force: true });
  await rm(NOTE, { force: true });
});

async function repl(page, src) {
  const input = page.locator(".repl-input");
  if (!(await input.isVisible())) await page.locator(".head-btn", { hasText: "λ" }).click();
  await input.fill(src);
  await input.press(`${MOD}+Enter`);
}

const lane = (scope, name) => scope.locator(`.formrun-lane[data-lane="${name}"]`);

test("cards sit in their lanes; a drag or ⌥→ moves one and :on-move hears $from and $to", async ({ page }) => {
  await page.goto("/");
  await repl(page, '(ed-form "brd/Kanban")');
  const win = page.locator(".formwin").filter({ has: page.locator(".formrun-name", { hasText: "Kanban" }) });
  await expect(lane(win, "To do").locator(".formrun-lane-head")).toHaveText("To do · 2");
  await expect(lane(win, "Doing").locator(".formrun-card")).toHaveCount(0);
  await expect(lane(win, "To do").locator(".formrun-card").first()).toContainText("Ana"); // :sub

  await lane(win, "To do").locator(".formrun-card", { hasText: "pick the fonts" }).dragTo(lane(win, "Doing").locator(".formrun-lane-body"));
  await expect(lane(win, "Doing").locator(".formrun-card")).toHaveText(["pick the fontsBob"]);
  const said = win.locator(".formrun-ctl[data-name=lblSaid] .formrun-label");
  await expect(said).toHaveText("pick the fonts: To do → Doing");

  const spec = lane(win, "To do").locator(".formrun-card", { hasText: "write the spec" });
  await spec.click();
  await expect(said).toHaveText("picked write the spec");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(said).toHaveText("write the spec: To do → Doing");
  await expect(lane(win, "Doing").locator(".formrun-lane-head")).toHaveText("Doing · 2");
  await expect(lane(win, "Doing").locator(".formrun-card.selected")).toBeFocused();
});

test("the Agenda window's Board: a category's children as columns, a drag refiles, ⇩ writes the table", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".etab.active .etab-label")).toHaveText("welcome.md");
  await repl(page, '(pim-add "call the printer brdz #wk/calls" (list))');
  await repl(page, '(pim-add "answer Ana brdz #wk/mail" (list))');
  await repl(page, '(ed-open "brd-note.md")');
  await expect(page.locator(".etab.active .etab-label")).toHaveText("brd-note.md");
  await page.locator(".agenda-section .side-btn", { hasText: "⤢" }).click();
  const win = page.locator(".formwin").filter({ has: page.locator(".formrun-name", { hasText: /^Agenda$/ }) });
  await win.locator(".formrun-tab", { hasText: "Board" }).click();
  await expect(lane(win, "wk")).toBeVisible(); // a top-level category is a column
  await expect(lane(win, "no category")).toBeVisible(); // and so are the items with none
  await win.locator(".formrun-ctl[data-name=cboBoard] select").selectOption("wk");
  await expect(lane(win, "wk/calls").locator(".formrun-card", { hasText: "call the printer brdz" })).toHaveCount(1);

  await lane(win, "wk/calls").locator(".formrun-card", { hasText: "call the printer brdz" }).dragTo(lane(win, "wk/mail").locator(".formrun-lane-body"));
  await expect(win.locator(".formrun-ctl[data-name=lblBoard] .formrun-label")).toContainText("filed under wk/mail");
  await expect(lane(win, "wk/mail").locator(".formrun-card")).toHaveCount(2);
  await expect(lane(win, "wk/calls").locator(".formrun-card")).toHaveCount(0);

  await win.locator(".formrun-ctl[data-name=btnBoardNote] button").click();
  await expect(page.locator(".cm-content")).toContainText('<!-- eel: (pim-board "wk") -->');
  await expect(page.locator(".cm-content")).toContainText("| mail · 2 |");
  await expect.poll(() => readFile(NOTE, "utf8")).toContain("answer Ana brdz");
});
