// Images and diagrams in a note, driven in a real browser against the dev bridge: a ```mermaid
// sequence diagram and a workspace image both show in the preview and on the printed page, a
// broken one says so, and a pasted image is stored beside the note and linked from it.

import { expect, test } from "@playwright/test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

test.describe.configure({ mode: "serial" });

/** A 3×2 red PNG — small enough to inline, real enough for the webview to decode. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==";

const NOTE = "notes/diagram.md";
const SOURCE = `# Handshake

\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello Bob
    Bob-->>Alice: Hi Alice
\`\`\`

![a red dot](assets/red%20dot.png)

\`\`\`mermaid
sequenceDiagram
    this is not a diagram
\`\`\`

![gone](assets/nope.png)
`;

test.beforeAll(async () => {
  await mkdir(`${UI_WORKSPACE}/notes/assets`, { recursive: true });
  await writeFile(`${UI_WORKSPACE}/notes/assets/red dot.png`, Buffer.from(PNG_B64, "base64"));
  await writeFile(`${UI_WORKSPACE}/${NOTE}`, SOURCE);
});

async function openNote(page) {
  await page.goto("/");
  await page.locator(".tree-file", { hasText: "diagram.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("Handshake");
}

test("the preview draws the sequence diagram and shows the workspace image", async ({ page }) => {
  await openNote(page);
  await page.locator(".head-btn", { hasText: "preview" }).click();

  const preview = page.locator(".preview-host");
  const diagram = preview.locator(".mermaid-diagram svg");
  await expect(diagram).toHaveCount(1, { timeout: 15_000 });
  await expect(diagram).toContainText("Hello Bob");
  await expect(diagram).toContainText("Alice");

  // the image comes from the workspace, as a blob — and it decodes
  const img = preview.locator("img");
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(3);
  await expect(img).toHaveAttribute("alt", "a red dot");

  // a broken diagram keeps its source and says what went wrong; a missing image says so
  await expect(preview.locator(".mermaid-error")).toHaveCount(1);
  await expect(preview.locator("pre code.language-mermaid")).toContainText("this is not a diagram");
  await expect(preview.locator(".md-missing")).toContainText("assets/nope.png");
});

test("the printed page carries the diagram and the image", async ({ page }) => {
  await openNote(page);
  // The print view is a hidden iframe; its own print() is the dialog, which a test has no use for.
  await page.evaluate(() => {
    const add = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
      const out = add.call(this, child);
      if (child instanceof HTMLIFrameElement && child.contentWindow) child.contentWindow.print = () => {};
      return out;
    };
  });
  await page.locator(".head-btn", { hasText: "PDF" }).click();

  const frame = page.frameLocator('iframe[aria-hidden="true"]');
  await expect(frame.locator(".mermaid-diagram svg")).toHaveCount(1, { timeout: 15_000 });
  await expect(frame.locator(".mermaid-diagram svg")).toContainText("Hello Bob");
  await expect(frame.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect.poll(() => frame.locator("img").evaluate((el) => el.naturalWidth)).toBe(3);
});

test("a pasted image is stored beside the note and linked from it", async ({ page }) => {
  await openNote(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "image.png", { type: "image/png" }));
    const ev = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector(".cm-content").dispatchEvent(ev);
  }, PNG_B64);

  await expect(page.locator(".cm-content")).toContainText(/!\[\]\(assets\/pasted-\d{8}-\d{6}\.png\)/);
  const stored = await readdir(`${UI_WORKSPACE}/notes/assets`);
  expect(stored.filter((f) => f.startsWith("pasted-"))).toHaveLength(1);

  // …and it shows in the preview like any other
  await page.locator(".head-btn", { hasText: "preview" }).click();
  await expect(page.locator(".preview-host img")).toHaveCount(2);
  for (const img of await page.locator(".preview-host img").all()) {
    await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(3);
  }
});

test("an image dropped on the editor is stored under its own name and linked where it fell", async ({ page }) => {
  await openNote(page);
  const heading = page.locator(".cm-line", { hasText: "# Handshake" });
  const box = await heading.boundingBox();
  await page.evaluate(
    ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "Red Dot (copy).png", { type: "image/png" }));
      const ev = new DragEvent("drop", { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true });
      document.querySelector(".cm-content").dispatchEvent(ev);
    },
    { b64: PNG_B64, x: box.x + box.width - 2, y: box.y + box.height / 2 },
  );

  // dropped at the end of the heading line, so the link lands right after "Handshake"
  await expect(heading).toContainText("# Handshake![Red Dot (copy)](assets/Red-Dot-copy.png)");
  expect(await readdir(`${UI_WORKSPACE}/notes/assets`)).toContain("Red-Dot-copy.png");
  // no copy-in question: the image went into the note, not the workspace root
  await expect(page.locator(".dlg-panel")).toHaveCount(0);
});
