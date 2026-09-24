import { describe, expect, it } from "vitest";
import { FORM_SLOT, exportFormHtml, formImages, isExportedPage, jsonInScript } from "./export";
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

describe("exportFormHtml", () => {
  it("puts the form, its title and its data name into the template", () => {
    const html = exportFormHtml({ template: TEMPLATE, source: '(form "Books")', title: "Books", app: "Books.eeform" });
    expect(html).toContain("<title>Books</title>");
    expect(html).toContain('<body class="runtime" data-app="Books.eeform">');
    expect(carried(html, "application/x-eeform+json")).toBe('(form "Books")');
    expect(html).not.toContain(FORM_SLOT);
    expect(html).not.toContain("x-eeform-assets"); // no images, no assets script
  });

  it("carries a form that says </script> without the page breaking", () => {
    const source = '(form "X")\n;; a note: </script><script>alert(1)</script>\n(defn f (x) (str "$& $1" x))';
    const html = exportFormHtml({ template: TEMPLATE, source, title: "X", app: "X" });
    // only the template's own closing tags remain, plus the one that ends the form's script
    expect(html.match(/<\/script>/g)?.length).toBe(2);
    expect(carried(html, "application/x-eeform+json")).toBe(source);
  });

  it("escapes a title and a name, and never reads a $ in them as a pattern", () => {
    const html = exportFormHtml({ template: TEMPLATE, source: "", title: 'Q&A <"$1">', app: '"$&"' });
    expect(html).toContain("<title>Q&amp;A &lt;&quot;$1&quot;&gt;</title>");
    expect(html).toContain('data-app="&quot;$&amp;&quot;"');
  });

  it("carries images by the path the form names them with", () => {
    const assets = { "assets/logo.png": "data:image/png;base64,iVBOR" };
    const html = exportFormHtml({ template: TEMPLATE, source: "", title: "T", app: "T", assets });
    expect(carried(html, "application/x-eeform-assets+json")).toEqual(assets);
  });

  it("refuses a template with no place for the form", () => {
    expect(() => exportFormHtml({ template: "<html></html>", source: "", title: "", app: "" })).toThrow(/runtime template/);
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
