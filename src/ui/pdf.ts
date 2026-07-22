// PDF export (ANALYSIS — the Swift app's PDF export). Renders the current Markdown to a clean,
// theme-independent printable document in a hidden iframe and opens the OS print dialog, where the
// user chooses "Save as PDF". Works in both the Tauri webview and a plain browser — no native deps.

// A self-contained light print stylesheet (print is always light, regardless of the app theme).
const PRINT_CSS = `
  @page { margin: 20mm; }
  * { box-sizing: border-box; }
  body { font: 12pt/1.5 -apple-system, system-ui, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a; background: #fff; margin: 0; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.2em 0 .5em; }
  h1 { font-size: 1.9em; border-bottom: 1px solid #ddd; padding-bottom: .2em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: .2em; }
  h3 { font-size: 1.25em; }
  p, ul, ol, blockquote, table, pre { margin: 0 0 .8em; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .9em;
    background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f4f4f4; padding: 10px 12px; border-radius: 6px; overflow-x: auto;
    page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  a { color: #0645ad; text-decoration: none; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 12px; color: #555; }
  ul, ol { padding-left: 1.6em; }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 4px 10px; }
  h1, h2, h3 { page-break-after: avoid; }
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Export `bodyHtml` (already-rendered Markdown) to PDF via the print dialog.
 * @param onError optional hook if the print window is unavailable.
 */
export function exportPdf(title: string, bodyHtml: string, onError?: (msg: string) => void): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    visibility: "hidden",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    onError?.("Could not open a print view");
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();

  const print = (): void => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      onError?.(String(e));
    }
    // give the print dialog time to read the document before we tear it down
    setTimeout(() => iframe.remove(), 60_000);
  };
  // wait for the document (and any images) to lay out before printing
  if (doc.readyState === "complete") setTimeout(print, 150);
  else iframe.addEventListener("load", () => setTimeout(print, 150), { once: true });
}
