// Agenda setup modal: surfaces the engine's rules + categories + auto-categorize machinery.
//   • Rules      — "when the text contains X, assign category Y" (defrule / drop-rule / apply-rules)
//   • Categories — a (possibly hierarchical, "parent/child") category tree (defcategory)
//   • Auto       — run rules automatically as items are added/edited (auto-categorize)
// All of this already exists in the engine; this panel just gives it a UI.

import type { EngineClient } from "../engine/client";
import type { Envelope } from "../engine/types";
import { toast } from "./dialogs";

export interface AgendaSetup {
  open(): void;
}

function strResult(env: Envelope): string {
  return env.ok && typeof env.result === "string" ? env.result : "";
}
function numResult(env: Envelope): number {
  return env.ok && typeof env.result === "number" ? env.result : 0;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createAgendaSetup(engine: EngineClient, onChange: () => void): AgendaSetup {
  let autoOn = false;

  const overlay = el("div", "qo-overlay");
  overlay.style.display = "none";
  const panel = el("div", "setup-panel");
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const head = el("div", "setup-head");
  const title = el("div", "setup-title", "Agenda setup");
  const autoWrap = el("label", "setup-auto");
  const autoBox = el("input", "setup-check");
  autoBox.type = "checkbox";
  autoWrap.append(autoBox, document.createTextNode(" auto-categorize"));
  const applyBtn = el("button", "setup-btn", "Apply rules now");
  head.append(title, autoWrap, applyBtn);

  // ── rules ──
  const rulesSec = el("div", "setup-section");
  rulesSec.append(el("div", "setup-label", "Rules"));
  const rulesList = el("div", "setup-list");
  const ruleForm = el("div", "setup-form");
  const ruleWhen = el("input", "setup-input");
  ruleWhen.placeholder = "when text contains…";
  const ruleCat = el("input", "setup-input");
  ruleCat.placeholder = "assign category…";
  const ruleAdd = el("button", "setup-add", "＋");
  ruleAdd.title = "Add rule";
  ruleForm.append(ruleWhen, document.createTextNode("→"), ruleCat, ruleAdd);
  rulesSec.append(rulesList, ruleForm);

  // ── categories ──
  const catsSec = el("div", "setup-section");
  catsSec.append(el("div", "setup-label", "Categories"));
  const catsTree = el("pre", "setup-tree");
  const catForm = el("div", "setup-form");
  const catName = el("input", "setup-input");
  catName.placeholder = "new category (parent/child ok)…";
  const catAdd = el("button", "setup-add", "＋");
  catAdd.title = "Add category";
  catForm.append(catName, catAdd);
  catsSec.append(catsTree, catForm);

  panel.append(head, rulesSec, catsSec);

  async function refresh(): Promise<void> {
    autoBox.checked = autoOn;
    // rules
    const rulesText = strResult(await engine.evalSrc("(rules)"));
    rulesList.innerHTML = "";
    const lines = rulesText.split("\n").filter((l) => l && !l.startsWith("("));
    if (lines.length === 0) {
      rulesList.append(el("div", "setup-empty", "(no rules yet)"));
    } else {
      for (const line of lines) {
        const name = line.slice(0, line.indexOf(":")).trim();
        const row = el("div", "setup-row");
        row.append(el("span", "setup-rule", line));
        const del = el("button", "setup-del", "×");
        del.title = "Delete rule";
        del.addEventListener("click", () => {
          void engine.evalSrc(`(drop-rule ${JSON.stringify(name)})`).then(() => refresh());
        });
        row.append(del);
        rulesList.append(row);
      }
    }
    // categories
    catsTree.textContent = strResult(await engine.evalSrc("(categories)"));
  }

  function addRule(): void {
    const when = ruleWhen.value.trim();
    const cat = ruleCat.value.trim();
    if (!when || !cat) {
      toast("Enter both a keyword and a category");
      return;
    }
    const name = `${slug(when)}-${slug(cat)}`;
    // case-insensitive "contains": lower-case both sides
    const src = `(defrule ${JSON.stringify(name)} :when (str-contains (str-lower text) ${JSON.stringify(when.toLowerCase())}) :assign ${JSON.stringify(cat)})`;
    void engine.evalSrc(src).then(() => {
      ruleWhen.value = "";
      ruleCat.value = "";
      void refresh();
      onChange();
    });
  }

  function addCategory(): void {
    const name = catName.value.trim();
    if (!name) return;
    void engine.evalSrc(`(defcategory ${JSON.stringify(name)})`).then(() => {
      catName.value = "";
      void refresh();
    });
  }

  ruleAdd.addEventListener("click", addRule);
  ruleCat.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addRule();
  });
  catAdd.addEventListener("click", addCategory);
  catName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addCategory();
  });
  autoBox.addEventListener("change", () => {
    autoOn = autoBox.checked;
    void engine.evalSrc(`(auto-categorize ${autoOn ? "true" : "false"})`).then(() => {
      toast(autoOn ? "Auto-categorize on" : "Auto-categorize off");
    });
  });
  applyBtn.addEventListener("click", () => {
    void engine.evalSrc("(apply-rules)").then((env) => {
      toast(`Applied rules — ${numResult(env)} item(s) updated`);
      void refresh();
      onChange();
    });
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display !== "none") overlay.style.display = "none";
  });

  return {
    open: () => {
      overlay.style.display = "flex";
      void refresh();
    },
  };
}
