// The export panel: what Export as HTML is about to put in the file — every form, the images, the
// size — and where it goes, before anything is written. Seeing the forms listed is how the rule
// "a form goes in when the code names it" stops being a surprise.

export interface ExportSummary {
  /** The main form's title. */
  title: string;
  /** The forms going in, main first, by path. */
  forms: string[];
  images: string[];
  /** Images named but unreadable — they will be missing from the page. */
  missing: string[];
  /** The page's size in bytes. */
  bytes: number;
  /** A file of the last export, which it may replace — only ever one that is an exported page. */
  last: string | null;
  /** The name a new file would get, beside the form. */
  fresh: string;
}

/** Where to write: over the last export, or a new file. Null when cancelled. */
export type ExportChoice = { target: string } | null;

const name = (p: string): string => (p.split("/").pop() ?? p).replace(/\.eeform$/i, "");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function exportPanel(s: ExportSummary): Promise<ExportChoice> {
  return new Promise((resolve) => {
    const overlay = el("div", "qo-overlay");
    const panel = el("div", "dlg-panel export-panel");
    const rows = el("div", "export-rows");
    const row = (k: string, v: HTMLElement | string) => {
      rows.append(el("div", "k", k));
      const cell = typeof v === "string" ? el("div", "v", v) : v;
      cell.classList.add("v");
      rows.append(cell);
    };

    const forms = el("div");
    s.forms.forEach((p, i) => {
      if (i) forms.append(" · ");
      forms.append(el("span", i === 0 ? "main-form" : undefined, i === 0 ? `${name(p)} (main)` : name(p)));
    });
    row("Forms", forms);
    row("Images", s.images.length ? s.images.map(name).join(" · ") : "—");
    if (s.missing.length) row("Missing", el("span", "warn", `${s.missing.join(", ")} — can't be read, left out`));
    row("Size", `about ${(s.bytes / 1024 / 1024).toFixed(1)} MB`);

    const save = el("div", "export-save");
    let target = s.last ?? s.fresh;
    if (s.last) {
      const option = (label: string, value: string, checked: boolean) => {
        const l = el("label");
        const r = el("input");
        r.type = "radio";
        r.name = "export-target";
        r.value = value;
        r.checked = checked;
        r.addEventListener("change", () => (target = value));
        l.append(r, label);
        return l;
      };
      save.append(option(`replace the last export — ${s.last}`, s.last, true), option(`a new file — ${s.fresh}`, s.fresh, false));
    } else save.append(el("span", undefined, s.fresh));
    row("Save as", save);

    const actions = el("div", "dlg-actions");
    const cancel = el("button", "dlg-btn", "Cancel");
    const go = el("button", "dlg-btn dlg-primary", "Export");
    actions.append(cancel, go);

    panel.append(
      el("div", "dlg-title", `Export ${s.title} as one HTML file`),
      rows,
      el("div", "export-note", "It runs in any browser, offline, opened from disk. A form goes in when the code names it — a name only put together while the app runs can't be seen."),
      actions,
    );
    overlay.append(panel);
    document.body.append(overlay);

    const close = (choice: ExportChoice) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(choice);
    };
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close({ target });
      }
    }
    cancel.addEventListener("click", () => close(null));
    go.addEventListener("click", () => close({ target }));
    overlay.addEventListener("click", (e) => e.target === overlay && close(null));
    document.addEventListener("keydown", onKey, true);
    go.focus();
  });
}

// ── an app of its own ──

export interface AppSummary {
  /** What it makes: a Mac app, or a Windows or Linux one. */
  kind: "Mac" | "Windows" | "Linux";
  /** The main form's title — the name it starts with. */
  title: string;
  forms: string[];
  images: string[];
  /** The sheets it shows: they go in its own folder, so the home folder isn't offered. */
  sheets: string[];
  missing: string[];
  /** Where its files start, as first offered. */
  folder: "own" | "home";
}

export type AppChoice = { name: string; folder: "own" | "home" } | null;

/** Export as Mac app… (or Windows, Linux): its name, where its files start, what goes in — then the Save dialog. */
export function appPanel(s: AppSummary): Promise<AppChoice> {
  return new Promise((resolve) => {
    const overlay = el("div", "qo-overlay");
    const panel = el("div", "dlg-panel export-panel");
    const rows = el("div", "export-rows");
    const row = (k: string, v: HTMLElement | string) => {
      rows.append(el("div", "k", k));
      const cell = typeof v === "string" ? el("div", "v", v) : v;
      cell.classList.add("v");
      rows.append(cell);
    };

    const nameBox = el("input", "dlg-input");
    nameBox.value = s.title;
    nameBox.spellcheck = false;
    nameBox.setAttribute("aria-label", "The app's name");
    row("Name", nameBox);

    const forms = el("div");
    s.forms.forEach((p, i) => {
      if (i) forms.append(" · ");
      forms.append(el("span", i === 0 ? "main-form" : undefined, i === 0 ? `${name(p)} (main)` : name(p)));
    });
    row("Forms", forms);
    if (s.images.length) row("Images", s.images.map(name).join(" · "));
    if (s.sheets.length) row("Sheets", s.sheets.map(name).join(" · "));
    if (s.missing.length) row("Missing", el("span", "warn", `${s.missing.join(", ")} — can't be read, left out`));

    let folder = s.sheets.length ? "own" : s.folder;
    const where = el("div", "export-save");
    const option = (label: string, value: "own" | "home") => {
      const l = el("label");
      const r = el("input");
      r.type = "radio";
      r.name = "macapp-folder";
      r.value = value;
      r.checked = value === folder;
      r.disabled = s.sheets.length > 0 && value === "home";
      r.addEventListener("change", () => (folder = value));
      l.append(r, label);
      return l;
    };
    where.append(
      option("a folder of its own — for an app that keeps its own records", "own"),
      option("your home folder — for an app that works with your files, like Files", "home"),
    );
    if (s.sheets.length) where.append(el("div", "export-hint", "Its sheets are kept in its own folder, where it finds them the first time it opens."));
    row("Its files", where);

    const actions = el("div", "dlg-actions");
    const cancel = el("button", "dlg-btn", "Cancel");
    const go = el("button", "dlg-btn dlg-primary", "Save…");
    actions.append(cancel, go);

    panel.append(
      el("div", "dlg-title", `Make ${s.title} a ${s.kind} app`),
      rows,
      el(
        "div",
        "export-note",
        s.kind === "Mac"
          ? "A copy of EEditor (about 20 MB) that opens this form and nothing else, with the same engine and a database of its own. It runs on this Mac; on another one, the first time, right-click it and choose Open."
          : `A folder with a copy of EEditor's program in it, named as the app (about 20 MB): it opens this form and nothing else, with the same engine and a database of its own. Copy the whole folder to move it.${s.kind === "Windows" ? " On another PC, Windows may ask once whether to run it." : ""}`,
      ),
      actions,
    );
    overlay.append(panel);
    document.body.append(overlay);

    const close = (choice: AppChoice) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(choice);
    };
    const accept = () => close({ name: nameBox.value, folder });
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        accept();
      }
    }
    cancel.addEventListener("click", () => close(null));
    go.addEventListener("click", accept);
    overlay.addEventListener("click", (e) => e.target === overlay && close(null));
    document.addEventListener("keydown", onKey, true);
    nameBox.focus();
    nameBox.select();
  });
}
