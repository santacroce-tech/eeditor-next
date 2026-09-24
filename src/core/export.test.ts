import { describe, expect, it } from "vitest";
import { FORM_SLOT, codeStrings, collectApp, exportAppHtml, formImages, formNamed, isExportedPage, jsonInScript, readExportedApp, unpackPlan } from "./export";
import { readFormSpec } from "./form";

const TEMPLATE = `<!doctype html><html><head><title>EEditor form</title></head>
<body class="runtime"><div id="app"></div>
${FORM_SLOT}
<script type="module">/* runtime */</script></body></html>`;

/** What a <script type=…> in the page holds, as the browser would hand it back. */
function carried(html: string, type: string): unknown {
  const m = new RegExp(`<script type="${type.replace(/[+]/g, "\\+")}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]) : undefined;
}

const bundle = (main: string, forms: Record<string, string>, assets: Record<string, string> = {}) => ({ main, forms, assets });

describe("exportAppHtml", () => {
  it("puts the app, its title and its data name into the template", () => {
    const b = bundle("Books.eeform", { "Books.eeform": '(form "Books")' });
    const html = exportAppHtml({ template: TEMPLATE, bundle: b, title: "Books", app: "Books.eeform" });
    expect(html).toContain("<title>Books</title>");
    expect(html).toContain('<body class="runtime" data-app="Books.eeform">');
    expect(carried(html, "application/x-eeform-app+json")).toEqual(b);
    expect(html).not.toContain(FORM_SLOT);
  });

  it("carries a form that says </script> without the page breaking", () => {
    const source = '(form "X")\n;; a note: </script><script>alert(1)</script>\n(defn f (x) (str "$& $1" x))';
    const html = exportAppHtml({ template: TEMPLATE, bundle: bundle("X.eeform", { "X.eeform": source }), title: "X", app: "X" });
    expect(html.match(/<\/script>/g)?.length).toBe(2);
    expect((carried(html, "application/x-eeform-app+json") as { forms: Record<string, string> }).forms["X.eeform"]).toBe(source);
  });

  it("escapes a title and a name, and never reads a $ in them as a pattern", () => {
    const html = exportAppHtml({ template: TEMPLATE, bundle: bundle("a", {}), title: 'Q&A <"$1">', app: '"$&"' });
    expect(html).toContain("<title>Q&amp;A &lt;&quot;$1&quot;&gt;</title>");
    expect(html).toContain('data-app="&quot;$&amp;&quot;"');
  });

  it("refuses a template with no place for the app", () => {
    expect(() => exportAppHtml({ template: "<html></html>", bundle: bundle("a", {}), title: "", app: "" })).toThrow(/runtime template/);
  });
});

describe("collectApp", () => {
  const files: Record<string, string> = {
    "apps/Office.eeform": `(form "Office" :main true :size (300 200)
  (listbox lstNav :items ("Books" "Orders") :at (0 0) :size (10 10))
  (image imgLogo :src "logo.png" :at (0 0) :size (10 10)))
;; "Ghost" is only in a comment, so it doesn't count
(defn go (f) (ui-open (ui-get f "lstNav") :in "frmMain"))`,
    "apps/Books.eeform": `(form "Books" :size (100 100))\n(defn more (f) (ui-open "Shared"))`,
    "apps/Orders.eeform": `(form "Orders" :size (100 100))\n(defn back (f) (ui-open "Books"))`,
    "Shared.eeform": `(form "Shared" :size (100 100))`,
    "apps/Ghost.eeform": `(form "Ghost" :size (100 100))`,
  };
  const io = {
    read: async (p: string) => files[p],
    exists: (p: string) => p in files,
    image: async (p: string) => (p === "apps/logo.png" ? "data:image/png;base64,AA" : Promise.reject(new Error("no"))),
  };

  it("takes every form named from the main one, and from those, beside them first — not what a comment mentions", async () => {
    const { bundle: b, missing } = await collectApp("apps/Office.eeform", io);
    expect(b.main).toBe("apps/Office.eeform");
    expect(Object.keys(b.forms).sort()).toEqual(["Shared.eeform", "apps/Books.eeform", "apps/Office.eeform", "apps/Orders.eeform"]);
    expect(b.assets).toEqual({ "apps/logo.png": "data:image/png;base64,AA" });
    expect(missing).toEqual([]);
  });

  it("says which images it couldn't read", async () => {
    const { missing } = await collectApp("apps/Office.eeform", { ...io, image: async () => Promise.reject(new Error("gone")) });
    expect(missing).toEqual(["apps/logo.png"]);
  });
});

describe("codeStrings and formNamed", () => {
  it("reads the strings in code, not in comments, with their escapes", () => {
    expect(codeStrings(';; "not me"\n(f "a" "b\\"c" "a")')).toEqual(["a", 'b"c']);
  });

  it("finds a form beside the one naming it, then at the top, and nothing for a plain string", () => {
    const exists = (p: string) => ["x/A.eeform", "B.eeform"].includes(p);
    expect(formNamed("A", "x/Main.eeform", exists)).toBe("x/A.eeform");
    expect(formNamed("B", "x/Main.eeform", exists)).toBe("B.eeform");
    expect(formNamed("Saved!", "x/Main.eeform", exists)).toBeNull();
  });
});

describe("formImages", () => {
  it("lists every image control's source once, and nothing else", () => {
    const r = readFormSpec(`(form "F" :size (300 200)
      (image imgA :src "assets/a.png" :at (0 0) :size (10 10))
      (image imgB :src "assets/a.png" :at (0 0) :size (10 10))
      (image imgC :src "b.jpg" :at (0 0) :size (10 10))
      (image imgD :at (0 0) :size (10 10))
      (label lbl :text "assets/c.png" :at (0 0) :size (10 10)))`);
    if ("error" in r) throw new Error(r.error);
    expect(formImages(r.spec)).toEqual(["assets/a.png", "b.jpg"]);
  });
});

describe("jsonInScript", () => {
  it("never lets a raw < through", () => {
    expect(jsonInScript("</script>")).toBe('"\\u003c/script>"');
    expect(JSON.parse(jsonInScript("</script>"))).toBe("</script>");
  });
});

describe("isExportedPage", () => {
  it("knows the template's opening lines, and nothing else", () => {
    expect(isExportedPage('<!doctype html>\n<html lang="en">\n<!-- made with EEditor — https://eeditor.app -->\n<head>')).toBe(true);
    expect(isExportedPage("<!doctype html>\n<html>\n<head><title>my page</title>")).toBe(false);
    expect(isExportedPage("# notes\n<!-- made with EEditor -->")).toBe(false);
    expect(isExportedPage("")).toBe(false);
  });
});

describe("readExportedApp and unpackPlan — an exported page back into files", () => {
  const b = {
    main: "apps/Office.eeform",
    forms: { "apps/Office.eeform": '(form "Office" :main true)', "apps/sub/Books.eeform": '(form "Books")', "Shared.eeform": '(form "S")' },
    assets: { "apps/logo.png": "data:image/png;base64,AA" },
  };

  it("reads back exactly the app that was exported — a </script> in a form included", () => {
    const tricky = { ...b, forms: { ...b.forms, "apps/Office.eeform": '(form "Office")\n;; </script> in a comment' } };
    const html = exportAppHtml({ template: TEMPLATE, bundle: tricky, title: "Office", app: "Office.eeform" });
    expect(readExportedApp(html)).toEqual(tricky);
  });

  it("is null for a page that isn't an export, and reads an old one-form export as an app of one", () => {
    expect(readExportedApp("<!doctype html><title>mine</title>")).toBeNull();
    const old = `<html><script type="application/x-eeform+json">${jsonInScript('(form "Old")')}</script></html>`;
    expect(readExportedApp(old)).toEqual({ main: "form.eeform", forms: { "form.eeform": '(form "Old")' }, assets: {} });
  });

  it("keeps each file's place relative to the main form, inside the new folder", () => {
    const plan = unpackPlan(b, "imported/Office forms");
    expect(plan.main).toBe("imported/Office forms/Office.eeform");
    expect(plan.forms.map(([p]) => p).sort()).toEqual([
      "imported/Office forms/Office.eeform",
      "imported/Office forms/Shared.eeform", // it lived outside apps/: by its name, at the top
      "imported/Office forms/sub/Books.eeform",
    ]);
    expect(plan.images).toEqual([["imported/Office forms/logo.png", "data:image/png;base64,AA"]]);
  });
});
