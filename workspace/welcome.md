# Welcome to EEditor

A Markdown editor with an embedded **EELisp** engine (Rust). Your notes are plain files in this
folder; pick one from the sidebar, edit here, and it saves itself (⌘S saves now).

Tags like #welcome and #demo are indexed from your notes, and [[todo]] is a wiki-link —
⌘-click it.

## What's in here

- **examples/** — forms you can run (▶ run in the tab): **Office** ties the others together;
  **Books**, **Orders** and **Tables** are dBASE-style data screens, **Agenda** is the agenda as a
  form, **Functions** lists every function with its source, and **Spectrum** is a ZX Spectrum.
- **examples/EEditor.mindmap.md** — every shortcut and the EELisp dialect, as a mind map.
- **Contacts.eeform** — a small form to take apart in the designer.

## Try the REPL

⌘J opens it. Or put the caret in this block and press ⌘⇧↩:

```eelisp
(add "Try the agenda tomorrow")
(items)
```

⌘P opens any note by name, ⌘⇧F searches them all, ⌘D opens today's note, and ⌘⇧K opens the
shortcut table — which is EELisp too.
