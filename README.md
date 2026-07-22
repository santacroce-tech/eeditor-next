# eeditor-next (frontend scaffold)

The next-version EEditor UI — **TypeScript + CodeMirror 6**, packaged with **Tauri** for
desktop (macOS/Linux/Windows) and shipped as a **PWA** for the web. It embeds the Rust
`eelisp` engine (`../eelisp-rs`) as a native command (Tauri) or as WebAssembly (browser).

> This directory is a **plan**, not yet an app. It captures the target structure and the
> engine boundary so the build can start cleanly. See `../eeditor/docs/ANALYSIS.md` (§5, §7).

## Why this stack (short version)

- **One engine, everywhere.** Rust `eelisp` → native (Tauri) *and* WASM (browser). Wider reach
  than the Apple-only Swift engine.
- **CodeMirror 6 deletes the hardest coupling.** The Swift app's biggest reimplementation cost
  was the AppKit/UIKit text system + regex highlighting. CodeMirror gives incremental
  highlighting (Lezer), find/replace, undo, and multi-cursor for free.
- **DOM + `window.print()` replaces WKWebView** for markdown preview and PDF.
- **The integration contract ports 1:1.** "call eval → get a typed `Value` → match
  `.tableView`/`.formView`" becomes JSON over the WASM/Tauri boundary.

## Target structure (proposed)

```
eeditor-next/
  src/
    engine/            binding to eelisp (WASM in browser, Tauri invoke on desktop)
      index.ts         eval(src) -> Value(JSON); onOutput stream; editor-callback RPC
    editor/            CodeMirror 6 setup (languages, themes, find, timestamp cmd)
    views/             REPL, RecordTable, RecordForm (browse/edit/defform renderers)
    sidebar/           file tree, calendar, agenda, tags, snippets, bookmarks
    state/             ported ViewModels: autosave, search, quick-open, tabs, calendar math
    markdown/          md -> HTML preview pane
  src-tauri/           Tauri shell (native window, filesystem, eelisp native command)
  index.html  vite.config.ts  package.json  tsconfig.json
```

## The engine boundary — BUILT ✅ (in `../eelisp-rs`, ANALYSIS §5)

The Rust engine already exposes the whole contract. The Tauri backend is a single command:

- **`EngineHandle::spawn(db_path)`** — owns the interpreter on its own thread; `Send + Sync` so it
  lives in Tauri `State`. **`eval(src) -> String`** returns a JSON envelope:
  `{ "ok": true, "result": <json>, "output": "<print/println text>" }` or `{ "ok": false, "error": … }`.
- **Structured results are tagged** so TS can discriminate: `$tableView`, `$formView` (with
  `computedFields` + `isStandalone`), `$record`, `$resultSet`, `$dict` (order-preserving), `$item`.
- **Output capture** is folded into the envelope's `output` (replaces the `onOutput` stream idea).
- **Editor RPC** builtins exist (`buffer-text`, `current-file`, `cursor-pos`, `insert-at`,
  `replace-range`, `selection`, `set-cursor`) backed by host callbacks. Over the thread boundary these
  need a return-channel to the UI — the remaining wiring for the threaded handle (single-thread hosts
  can install callbacks directly on `Interpreter`).
- **Form CRUD** uses `insert`/`update`/`delete`/`item-set` via `eval` — no separate API needed.

See `src-tauri/src/main.rs` for the `eelisp_eval` command. There's also `eelisp --serve` (JSON-line
RPC over stdin/stdout) if a sidecar process is preferred over linking.

## Ported-as-is logic (from EEditorCore — pure algorithms, cheap to move)

Autosave debounce · full-text search + 3-line snippets · quick-open fuzzy rank · calendar grid
math · tags (`#hashtag`) extraction · tab/bookmark/rename bookkeeping · language detection
tables · theme color/CSS data · syntax keyword sets.

## Decisions made

- **Native first: desktop + mobile.** Target macOS/Linux/Windows and iOS/Android via **Tauri v2**
  (which now supports mobile). The engine is embedded as a **native Rust command** (no WASM on the
  critical path). **Web/PWA is deferred** — WASM bindings for `eelisp` come later, once the native
  app is working. This means the engine's serde boundary must be a plain Rust API first; the WASM
  wrapper is additive.

## Open decisions

1. **Tauri v2** confirmed as the shell (vs a Swift/Kotlin-native mobile shell)?
2. Package manager / bundler (assumed: pnpm + Vite).

## Status — frontend scaffolded and building ✅

Real Vite + TypeScript + CodeMirror 6 app, typechecks clean (`tsc --noEmit`) and builds (`vite build`).

```
src/
  engine/
    types.ts     JSON envelope + tagged Value types (mirror of eelisp-rs/src/host.rs)
    client.ts    EngineClient — Tauri (invoke) or HTTP (dev bridge) transport
    render.ts    pure JsonValue → RenderModel (scalar / table / form / error) — DOM-free, testable
    workspace.ts WorkspaceClient (tree/read/write) — Tauri fs commands or dev-bridge /fs/*
  core/          ported EEditorCore ViewModels (pure, unit-tested)
    fuzzy.ts     quick-open subsequence match + prefix/substring/length ranking + wiki-links
    tags.ts      #hashtag extraction (skips fences/headings/hex/mid-word) + counts
    calendar.ts  Monday-first month grid + activity-by-date
    blocks.ts    find the ```eelisp block at the cursor (in-editor execution)
    search.ts    full-text search: line matches + 3-line context (SearchService)
    core.test.ts / engine/render.test.ts  — 17 vitest cases
  ui/
    editor.ts    CodeMirror 6 editor; switchable theme (one-dark / solarized-light); ⌘⇧⏎ runs the ```eelisp block
    sidebar.ts   workspace file tree (click to open) + flat file list for quick-open
    agenda.ts    agenda panel — `(items)` table + smart-`(add …)` quick-add
    calendar.ts  📅 month grid (calendar.ts) with agenda-item dots (items-between/on) → click a day
    quickopen.ts ⌘/Ctrl+P fuzzy file palette (over fuzzy.ts)
    search.ts    ⌘/Ctrl+Shift+F full-text search modal (over search.ts) → open at line
    tagspanel.ts workspace tag cloud (over tags.ts)
    repl.ts      REPL: scrollback + `run(src)` (reused by in-editor block execution)
    results.ts   RenderModel → DOM (table + form widgets)
  main.ts        [ files+tags+agenda | editor(+preview) | REPL ]; dark/light theme toggle; autosave;
                 ⌘S save · ⌘P open · ⌘⇧F search · ⌘⇧⏎ run-block · 📅 calendar
  styles.css     CSS-variable palette; :root[data-theme="light"] = Solarized
src-tauri/       Tauri v2 desktop app — eelisp_eval + fs_tree/read/write + pick_workspace (folder dialog)
workspace/       sample notes (the dev workspace root the bridge serves)
dev/
  bridge.mjs     Node bridge: /eval (→ eelisp --serve) + /fs/tree|read|write (confined)
  smoke.mjs      end-to-end engine contract test (10/10)
src-tauri/       Tauri v2 backend: eelisp_eval + fs_tree/read/write commands
```

**Verified here (no browser needed):**
- `npm test` — 15 unit tests (fuzzy/tags/calendar/blocks + the render model). ✓
- `npm run smoke` — real `eelisp --serve`: arithmetic, state, `browse→$tableView`, `defform→$formView`,
  `add-item→$item`, output capture, error envelope. 10/10 ✓
- bridge `/fs/*` round-trip: tree, read, write-then-read, and path-escape rejection. ✓
- `tsc --noEmit` clean, `vite build` succeeds. ✓

## Run — standalone desktop app (Tauri v2)

The real target: a native window (macOS/Linux/Windows), engine compiled in, **no browser, no bridge**.

```bash
npm install
npm run tauri dev      # opens the native window; hot-reloads the UI (Vite behind the scenes)
npm run tauri build    # distributable app → src-tauri/target/release/bundle/…  (.app/.dmg on macOS)
```

`src-tauri/` is a full Tauri v2 project (config, icons, capabilities). The engine is a path
dependency (`eelisp = { path = "../../eelisp-rs" }`) linked in-process via `EngineHandle`; commands
`eelisp_eval` + `fs_tree/read/write` + `pick_workspace` back the UI. The **workspace root is
remembered** across launches (saved to the app config dir) — resolution order: last-picked folder →
`$EEDITOR_WORKSPACE` → `./workspace` → home. Use the "open…" button to pick a different folder.
Verified: `cargo build` in `src-tauri/` compiles and the binary launches a native window.

### iOS (Tauri v2, verified in the simulator)

```bash
npm run tauri ios init          # once — generates src-tauri/gen/apple/ (needs Xcode + CocoaPods)
npm run tauri ios dev "iPhone 17"   # build + boot simulator + run
npm run tauri ios build         # device/App Store build (needs a signing team)
```

The same Rust engine (`eelisp`) compiles for `aarch64-apple-ios` and runs in-process on the phone.
Mobile UI: the three panes collapse to one at a time with a bottom **Files / Editor / REPL** tab bar
(safe-area aware). Mobile is sandboxed, so there's no folder picker — the workspace is the app's
data dir, seeded with a starter `welcome.md`. (Android: `tauri android init/dev` — needs Android
Studio + SDK + NDK; not yet attempted.)

### Optional: browser dev + CI checks (no native build)

```bash
cargo build --release --manifest-path ../eelisp-rs/Cargo.toml   # engine binary for the dev bridge
npm run smoke      # engine ↔ TS contract test (10/10)
npm test           # unit tests (15)
npm run dev        # Node bridge + Vite → http://localhost:5173  (the frontend auto-uses HTTP here)
```

The frontend auto-selects its transport: **Tauri `invoke`** inside the app, **HTTP bridge** in a
plain browser — same JSON envelope, no code change.
