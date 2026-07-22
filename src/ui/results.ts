// Render a RenderModel into DOM. The one place that knows how tables/forms look.

import type { RenderModel, TableModel, FormModel } from "../engine/render";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderTable(m: TableModel): HTMLElement {
  const wrap = el("div", "result-table");
  wrap.appendChild(el("div", "result-title", m.title));
  const scroll = el("div", "table-scroll");
  const table = el("table");
  const thead = el("thead");
  const htr = el("tr");
  htr.appendChild(el("th", "col-id", "id"));
  for (const c of m.columns) htr.appendChild(el("th", undefined, c));
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const row of m.rows) {
    const tr = el("tr");
    tr.appendChild(el("td", "col-id", String(row.id)));
    for (const cell of row.cells) tr.appendChild(el("td", undefined, cell));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

function renderForm(m: FormModel): HTMLElement {
  const wrap = el("div", "result-form");
  const badge = m.standalone ? " · calculator" : ` · ${m.recordCount} record(s)`;
  wrap.appendChild(el("div", "result-title", m.title + badge));
  const grid = el("div", "form-grid");
  for (const f of m.fields) {
    grid.appendChild(el("label", "form-label", f.name));
    if (f.choices.length > 0) {
      const sel = el("select", "form-input");
      for (const c of f.choices) {
        const opt = el("option", undefined, c);
        opt.value = c;
        if (c === f.value) opt.selected = true;
        sel.appendChild(opt);
      }
      grid.appendChild(sel);
    } else {
      const input = el("input", "form-input");
      input.value = f.value;
      input.type = f.type === "number" ? "number" : "text";
      grid.appendChild(input);
    }
  }
  for (const c of m.computed) {
    grid.appendChild(el("label", "form-label computed", c.name));
    const box = el("div", "form-input computed", `= ${c.expression}`);
    grid.appendChild(box);
  }
  wrap.appendChild(grid);
  return wrap;
}

export function renderModelEl(m: RenderModel): HTMLElement {
  switch (m.kind) {
    case "table":
      return renderTable(m);
    case "form":
      return renderForm(m);
    case "error":
      return el("pre", "result-error", m.message);
    case "scalar":
      return el("pre", "result-scalar", m.text);
  }
}
