import { describe, it, expect } from "vitest";
import {
  defnRange,
  emptyForm,
  formState,
  handlerStub,
  humanName,
  layoutRange,
  lispLiteral,
  newControl,
  newFormSource,
  nextName,
  onOpenPage,
  openPages,
  parseFormSpec,
  printFormSpec,
  printSx,
  readAll,
  readFormSpec,
  replaceLayout,
  topLevelForms,
  type FormSpec,
} from "./form";

const FILE = `;; Contacts.eeform — a comment with (parens) and "quotes" in it
(form "Contacts" :size (480 380) :on-load load-contacts
  (label lblName :text "Name" :at (16 20) :size (72 24))
  (textbox txtName :at (96 16) :size (240 28) :on-change name-changed)
  (button btnSave :text "Save" :at (96 92) :size (90 30) :on-click save-contact)
  (grid grdAll :columns ("name" "age") :at (16 136) :size (448 220) :on-change pick-contact))

(deftable contacts (name:string age:number))

(defn save-contact (f)
  (insert contacts {:name (ui-get f "txtName")})  ; a ")" in a string: ")"
  (ui-set "txtName" :value ""))
`;

describe("s-expressions", () => {
  it("reads and prints the layout subset", () => {
    const src = '(form "T\\"q" :size (1 2.5) :on-load go (button b :text "x\\ny" :at (1 2) :enabled false :v nil))';
    const [x] = readAll(src);
    expect(printSx(x)).toBe(src);
  });
  it("skips comments and reads quotes and dicts", () => {
    const xs = readAll("; hi\n'(1 2) {:a 1} ; tail\n");
    expect(xs.map(printSx)).toEqual(["(quote (1 2))", "{:a 1}"]);
  });
  it("reports where a form is broken", () => {
    expect(() => readAll('(form "x"')).toThrow(/missing \)/);
    expect(() => readAll('(form "x')).toThrow(/unterminated/);
  });
});

describe("top-level forms", () => {
  it("finds each form, ignoring comments and strings", () => {
    const ranges = topLevelForms(FILE);
    const heads = ranges.map((r) => FILE.slice(r.start, r.end).split(/\s+/)[0]);
    expect(heads).toEqual(["(form", "(deftable", "(defn"]);
    expect(FILE.slice(ranges[2].start, ranges[2].end).endsWith('""))')).toBe(true);
  });
  it("locates the layout and a handler by name", () => {
    const l = layoutRange(FILE)!;
    expect(FILE.slice(l.start, l.start + 6)).toBe("(form ");
    const d = defnRange(FILE, "save-contact")!;
    expect(FILE.slice(d.start, d.start + 19)).toBe("(defn save-contact ");
    expect(defnRange(FILE, "load-contacts")).toBeUndefined();
    expect(layoutRange("(defn f (x) x)")).toBeUndefined();
  });
  it("runs an unclosed form to the end", () => {
    expect(topLevelForms("(form (a")).toEqual([{ start: 0, end: 8 }]);
  });
});

describe("the layout", () => {
  it("reads controls, events and the form's own properties", () => {
    const r = readFormSpec(FILE);
    if ("error" in r) throw new Error(r.error);
    const { spec } = r;
    expect(spec.title).toBe("Contacts");
    expect([spec.w, spec.h, spec.onLoad]).toEqual([480, 380, "load-contacts"]);
    expect(spec.controls.map((c) => c.name)).toEqual(["lblName", "txtName", "btnSave", "grdAll"]);
    const grid = spec.controls[3];
    expect(grid.props.columns).toEqual(["name", "age"]);
    expect(grid.events).toEqual({ change: "pick-contact" });
    expect([grid.x, grid.y, grid.w, grid.h]).toEqual([16, 136, 448, 220]);
  });
  it("prints canonically and round-trips", () => {
    const r = readFormSpec(FILE);
    if ("error" in r) throw new Error(r.error);
    const text = printFormSpec(r.spec);
    expect(text.split("\n")[0]).toBe('(form "Contacts" :size (480 380) :on-load load-contacts');
    const again = readFormSpec(text);
    if ("error" in again) throw new Error(again.error);
    expect(again.spec).toEqual(r.spec);
  });
  it("keeps what it doesn't understand", () => {
    const [x] = readAll('(form "T" :size (100 100) :theme dark (button b :at (0 0) :size (8 8) :colour "red" :on-hover glow))');
    const spec = parseFormSpec(x) as FormSpec;
    expect(spec.extra.map(([k]) => k)).toEqual(["theme"]);
    expect(spec.controls[0].extra.map(([k]) => k)).toEqual(["colour"]);
    expect(spec.controls[0].events).toEqual({ hover: "glow" });
    expect(printFormSpec(spec)).toContain(':colour "red" :on-hover glow');
    expect(printFormSpec(spec)).toContain(":theme dark");
  });
  it("fills in defaults and leaves them out again", () => {
    const [x] = readAll('(form (textbox t :at (8 8)) (checkbox c :value true :enabled true :visible false))');
    const spec = parseFormSpec(x) as FormSpec;
    expect(spec.title).toBe("");
    expect([spec.controls[0].w, spec.controls[0].h]).toEqual([160, 32]);
    const out = printFormSpec(spec);
    expect(out).toContain("(checkbox c :value true :at (0 0) :size (144 24) :visible false)");
    expect(out).not.toContain(":enabled");
  });
  it("knows radio groups and dates", () => {
    const [x] = readAll('(form (radio optSize :items ("S" "M" "L") :value "M" :at (8 8) :size (144 72) :on-change pick) (date dtpWhen :value "2026-09-23" :at (8 96) :size (160 32)))');
    const spec = parseFormSpec(x) as FormSpec;
    expect(spec.controls.map((c) => c.type)).toEqual(["radio", "date"]);
    expect(spec.controls[0].props).toEqual({ items: ["S", "M", "L"], value: "M" });
    expect(spec.controls[1].props).toEqual({ value: "2026-09-23" });
    const [y] = readAll('(form (textbox t :number true :required true :at (0 0)) (button b :submit true :at (0 0)))');
    const more = parseFormSpec(y) as FormSpec;
    expect(more.controls[0].props).toEqual({ number: true, required: true });
    expect(more.controls[1].props).toEqual({ submit: true });
    expect(printFormSpec(more)).toContain("(textbox t :number true :required true :at (0 0)");
    const [z] = readAll('(form (image imgLogo :src "assets/logo.png" :at (0 0)) (textbox n :number true :min 0 :max 9 :pattern "[a-z]+" :at (0 0)) (grid g :at (0 0) :on-dblclick open-it) (button b :on-validate check :at (0 0)))');
    const imgs = parseFormSpec(z) as FormSpec;
    expect(imgs.controls[0].props).toEqual({ src: "assets/logo.png" });
    expect(imgs.controls[1].props).toEqual({ number: true, min: 0, max: 9, pattern: "[a-z]+" });
    expect(printFormSpec(imgs)).toContain(":min 0 :max 9");
    const [d] = readAll('(form (date w :min "2026-01-01" :at (0 0)))');
    expect(printFormSpec(parseFormSpec(d) as FormSpec)).toContain(':min "2026-01-01"');
    expect(imgs.controls[2].events).toEqual({ dblclick: "open-it" });
    expect(printFormSpec(imgs)).toContain(":on-validate check");
    expect(handlerStub("b-validate", "validate")).toContain("nil)");
    const [t] = readAll('(form (timer tmr1 :interval 500 :at (0 0) :on-tick tick) (button ok :default true :cancel false :at (0 0)))');
    const timed = parseFormSpec(t) as FormSpec;
    expect(timed.controls[0].props).toEqual({ interval: 500 });
    expect(timed.controls[0].events).toEqual({ tick: "tick" });
    expect(printFormSpec(timed)).toContain("(button ok :default true :at (0 0)");
    expect(readFormSpec(printFormSpec(spec))).toMatchObject({ spec });
    expect(nextName("radio", [])).toBe("opt1");
    expect(nextName("date", ["dtp1"])).toBe("dtp2");
  });
  it("names what it cannot read", () => {
    expect(readFormSpec("(form (widget w))")).toEqual({ error: 'unknown control type "widget"' });
    expect(readFormSpec("(form (button))")).toEqual({ error: "a control is (type name …)" });
    expect(readFormSpec("(defn f (x) x)")).toEqual({ error: "no (form …) in this file" });
    expect(readFormSpec('(form "x"')).toEqual({ error: "missing )" });
  });
});

describe("splicing the layout back", () => {
  it("replaces only the layout's range", () => {
    const r = readFormSpec(FILE);
    if ("error" in r) throw new Error(r.error);
    const spec = r.spec;
    spec.controls[2].x = 200;
    const out = replaceLayout(FILE, spec);
    expect(out.src.startsWith(";; Contacts.eeform")).toBe(true);
    expect(out.src).toContain("(button btnSave :text \"Save\" :at (200 92)");
    expect(out.src.slice(out.range.end)).toBe(FILE.slice(layoutRange(FILE)!.end));
  });
  it("puts a layout in front of a file that has none", () => {
    const out = replaceLayout("(defn f (x) x)\n", emptyForm("New"));
    expect(out.src).toBe('(form "New" :size (480 360))\n\n(defn f (x) x)\n');
    expect(out.range).toEqual({ start: 0, end: 28 });
  });
  it("starts a new file with a comment and an empty layout", () => {
    const src = newFormSource("Orders");
    expect(readFormSpec(src)).toMatchObject({ spec: { title: "Orders", controls: [] } });
  });
});

describe("pages", () => {
  const [x] = readAll('(form (tabs tab1 :pages ("A" "B") :at (0 0)) (button a :page "A" :at (0 0)) (button b :page "B" :at (0 0)) (button c :at (0 0)) (button d :page "Nowhere" :at (0 0)))');
  const spec = parseFormSpec(x) as FormSpec;
  const [tab, a, b, c, d] = spec.controls;
  it("opens the first page unless the tabs control says otherwise", () => {
    expect([...openPages(spec)]).toEqual(["A"]);
    expect([...openPages(spec, new Map([["tab1", "B"]]))]).toEqual(["B"]);
    tab.props.value = "B";
    expect([...openPages(spec)]).toEqual(["B"]);
    tab.props.value = "";
  });
  it("hides what is on a closed page, and never what is on none or on an unknown one", () => {
    const open = openPages(spec);
    expect([a, b, c, d].map((k) => onOpenPage(k, spec, open))).toEqual([true, false, true, true]);
    expect(printFormSpec(spec)).toContain('(button a :at (0 0) :size (88 32) :page "A")');
  });
});

describe("designer helpers", () => {
  it("numbers names per type and snaps new controls", () => {
    expect(nextName("button", ["btn1", "txt1"])).toBe("btn2");
    const c = newControl("grid", "grd1", 13, 22);
    expect([c.x, c.y, c.w, c.h]).toEqual([16, 24, 320, 160]);
    expect(newControl("label", "l", 0, 0, 3, 3).w).toBe(16);
  });
  it("names a control for a person", () => {
    expect(humanName("txtFirstName")).toBe("First name");
    expect(humanName("dtpWhen")).toBe("When");
    expect(humanName("due_date")).toBe("Due date");
    expect(humanName("txt")).toBe("Txt");
  });
  it("writes a stub that says its name", () => {
    expect(handlerStub("btnSave-click")).toBe('(defn btnSave-click (f)\n  (ui-message "btnSave-click"))');
  });
});

describe("the form's state for a handler", () => {
  it("is a quoted dict keyed by control name", () => {
    expect(formState({ txtName: "Ada", chk: true, n: 3, lst: null, grd: { id: 1, name: "A" }, items: ["a", "b"] })).toBe(
      `'{:txtName "Ada" :chk true :n 3 :lst nil :grd {:id 1 :name "A"} :items ("a" "b")}`,
    );
  });
  it("drops keys that could not be keywords", () => {
    expect(lispLiteral({ "bad key": 1, ok: 2 })).toBe("{:ok 2}");
  });
});
