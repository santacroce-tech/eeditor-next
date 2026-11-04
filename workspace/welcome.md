# Welcome to EEditor

A Markdown editor with an embedded **EELisp** engine (Rust). Your notes are plain files in this
folder; pick one from the sidebar, edit here, and it saves itself (⌘S saves now).

Tags like #welcome and #demo are indexed from your notes, and [[todo]] is a wiki-link —
⌘-click it.

## What's in here

- **examples/** — forms you can run (▶ run in the tab): **Office** ties the others together;
  **Books**, **Orders** and **Tables** are dBASE-style data screens, **Agenda** is the agenda as a
  form, **Functions** lists every function with its source, **Spectrum** is a ZX Spectrum and
  **MSX** an MSX with a game of Snake, **Display** paints a screen from EELisp, and **Raycaster**
  walks a 3D maze.
- **examples/EEditor.mindmap.md** — every shortcut and the EELisp dialect, as a mind map.
- **Contacts.eeform** — a small form to take apart in the designer.

## Try the REPL

⌘J opens it. Or put the caret in this block and press ⌘⇧↩:

```eelisp
(add "Try the agenda tomorrow")
(items)
```

## Keys worth knowing

- ⌘P opens any note by name; ⌘⇧P finds an action instead — everything EEditor can do, by name
  (or type `>` after ⌘P).
- ⌘⇧F searches every note, and ⌘D opens today's note.
- ⌘I types the date and time at the caret; ⌘⇧I starts a new note named with them.
- Tabs: ⌃Tab and ⌃⇧Tab go to the next and previous one, ⌘1…⌘8 pick one, ⌘9 the last, and ⌘W
  closes the one in front.
- ⌘B hides and shows the sidebar; drag its right edge to make it wider (double-click the edge to
  put it back).
- Opening a form asks: ▶ Run, or Design (which runs nothing). F5 runs the form in front.
- ⌘⇧K opens the shortcut table — which is EELisp too, so every key here can be changed.
