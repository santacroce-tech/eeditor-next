# Welcome to eeditor-next

A native Markdown editor with an embedded **EELisp** engine (Rust).

Pick a file from the sidebar, edit here, and press ⌘/Ctrl+S to save.

Tags like #welcome and #demo are indexed from your notes.

Try the REPL on the right:

```eelisp
(add-item "Try the agenda" :when "2026-09-01" :priority 1)
(items)
```
