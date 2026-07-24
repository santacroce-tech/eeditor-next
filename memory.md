# EEditor — project memory

A working reference for the EEditor rebuild: what it is, how it's built, how to ship it, and the
gotchas that cost us time. Two repos work together.

| Repo | What | Tests |
|---|---|---|
| **eelisp-rs** (`../eelisp-rs`, github.com/santacroce-tech/eelisp-rs) | The EELisp engine in Rust: interpreter + SQLite + Lotus‑Agenda PIM. The reusable core. | 74 `cargo test` |
| **eeditor-next** (this repo, github.com/santacroce-tech/eeditor-next) | The app: TypeScript + CodeMirror 6 + Tauri v2. Desktop (macOS) + iOS/iPad. | 20 `vitest` |

Both repos are **private** under the `santacroce-tech` org. CI (GitHub Actions) runs the tests on push.

---

## Architecture

Three layers, cleanly separated (the whole point of the rebuild):

1. **Engine — `eelisp-rs`** (Rust). Lexer → parser → TCO evaluator (trampoline) → macros/quasiquote →
   ~95 builtins → dBASE‑style SQLite store → agenda PIM (items, categories, rules, views, recurrence,
   templates, smart NLP) → HTTP/JSON. Host boundary: `Value::TableView`/`FormView` + tagged‑JSON encoder
   (`host.rs`: `$tableView`/`$formView`/`$record`/`$resultSet`/`$dict`/`$item`/`$sym`/`$kw`). `EngineHandle`
   (Send+Sync) owns the interpreter on a thread and returns a `{ok,result,output}` JSON envelope.
2. **Frontend — `eeditor-next/src`** (TypeScript). Pure render model + ported ViewModels
   (`src/core/*` — fuzzy/tags/calendar/blocks/search/wikilink/backlinks, all unit‑tested). `EngineClient`
   auto‑selects a transport: **Tauri `invoke`** in the app, or an **HTTP dev bridge** in the browser.
   `WorkspaceClient` does the same for filesystem access.
3. **Shell — `eeditor-next/src-tauri`** (Rust/Tauri v2). Commands `eelisp_eval`, `fs_tree/read/write/create/
   rename/delete`, `import_file`, `pick_workspace`, `restore_workspace`. Local iOS plugin in
   `src-tauri/plugins/` (see iOS section).

The engine binary powers the browser dev bridge via `eelisp --serve` (JSON‑line RPC over stdin/stdout).

---

## Features

- **Editor**: CodeMirror 6, markdown, light (Solarized) / dark (One Dark) themes, autosave (1s debounce),
  markdown **preview**, **PDF export** (print‑to‑PDF), run a ```eelisp block with ⌘/Ctrl+Shift+Enter.
- **Multiple editor tabs** (open/switch/close; rename/delete keep tabs in sync).
- **File tree**: create/rename/delete files & folders (header buttons + right‑click / long‑press menu).
- **Agenda (PIM)**: smart quick‑add, inline item editor (text/when/priority/**notes**/**recurrence**/
  **categories**), a **rules & categories** panel (define rules, auto‑categorize, apply), **calendar** view
  with drag‑to‑reschedule.
- **Tags** panel (`#hashtag` index), **quick‑open** (⌘P), **full‑text search** (⌘⇧F).
- **Wiki‑links** `[[Note]]`: click in preview / ⌘‑click in editor to navigate, `[[` autocomplete,
  **backlinks** bar.
- **Snippets — the standard EELisp bundle (zzeelisp)**: 10 modules / 153 functions vendored in
  `src/snippets/`, loadable from the REPL's *snippets* button. Runs on the Rust engine (see dialect note).
- **REPL**: renders tables/forms as interactive widgets, not text.
- **Mobile (iOS/iPad)**: responsive single‑pane + tab‑bar layout at ≤900px; the app's notes folder is
  exposed in the **Files app**; import a file / pick a folder (see iOS section).

---

## Build & run

Prereqs: Node 20+, Rust stable, Xcode (for iOS). From `eeditor-next/`:

```bash
npm install
(cd ../eelisp-rs && cargo build --release --bin eelisp)   # engine binary for the dev bridge

# Browser dev (bridge + Vite on :5173)
npm run dev

# Checks
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run smoke       # 10 end-to-end engine-contract checks against the real binary

# Desktop app (standalone .app + .dmg)
npm run tauri build
# → src-tauri/target/release/bundle/macos/eeditor-next.app
# → src-tauri/target/release/bundle/dmg/eeditor-next_2.0.0_aarch64.dmg   (ad-hoc signed)

# iOS
npm run tauri ios build -- --export-method app-store-connect   # signed .ipa for TestFlight/App Store
npm run tauri ios build -- --target aarch64-sim                # simulator build (no signing)
npm run tauri ios dev "iPhone 17"                              # run in the simulator
```

**Verify UI only with Playwright (its own headless browser) or the iOS simulator (`xcrun simctl`). Never
use macOS `screencapture` — it grabs whatever is on the screen.**

---

## iOS: identity, signing, TestFlight

- **Bundle id**: `com.eeditor.app` (matches the existing App Store app, so builds ship as **updates**, not a
  new app). Hyphen‑free → also valid as a future Android package name.
- **iOS display name**: `EEditor` (via `src-tauri/Info.ios.plist`; desktop `productName` stays `eeditor-next`).
- **Apple Team ID**: `FFJKC46LZP` (paid Developer account), set as `bundle.iOS.developmentTeam` in
  `tauri.conf.json`. Automatic signing; a wildcard dev profile + App Store profile already exist on the build
  machine.
- **Versions**: marketing `version` = `2.0.0`. **Each iOS upload must bump `bundle.iOS.bundleVersion`** (the
  build number) — App Store Connect rejects a duplicate. Currently at **2.0.5**.
- **Universal**: iPhone + iPad (`TARGETED_DEVICE_FAMILY "1,2"`, the Tauri default).
- **Upload to TestFlight**: `tauri ios build --export-method app-store-connect` → the `.ipa` at
  `src-tauri/gen/apple/build/arm64/eeditor-next.ipa` → drag into **Transporter** → Deliver. Then in App Store
  Connect: answer export compliance, add yourself as an **internal tester**. (No API key is stored here; an
  App Store Connect API key would let `xcrun altool --upload-app` run headless.)

### Files‑app access + folder picking (iOS)
- `Info.ios.plist` sets `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`, and the workspace is the
  app's **Documents** dir → visible/editable in **Files → On My iPhone → EEditor**.
- **`file…`** button imports a single file via the dialog plugin (`pick_file` → `import_file` copies it in).
- **`folder…`** button (local plugin `src-tauri/plugins/`, Swift) opens the native **folder** picker
  (`UIDocumentPickerViewController` folder mode) + a **security‑scoped bookmark** so the external folder
  persists across launches. *Status: builds and integrates; being validated on device.*
- **Still TODO**: "Open in EEditor" (receive files from other apps) — needs `CFBundleDocumentTypes` + native
  open‑url handling; can extend the same plugin.

---

## Gotchas (things that bit us)

- **iOS app icon** — `tauri ios init` resets the AppIcon catalog to the default Tauri icon, and `tauri icon`
  re‑adds an **alpha channel** that App Store review rejects. **Auto‑fixed**: a pristine opaque `eλe` set
  lives in `src-tauri/ios-appicon/` (untouched by tauri tooling) and `scripts/prepare-ios-icons.mjs` copies it
  into the catalog from `beforeBuildCommand` on every build.
- **CI lockfile** — `vite 5` + `vitest 4` pull incompatible esbuild ranges → an incomplete `package-lock.json`
  → `npm ci` fails on Linux. Keep **vitest pinned to v2** (vite‑5 compatible). `npm ci --dry-run` does *not*
  catch this; only real `npm ci`/CI does.
- **iOS native calls must be non‑blocking** — a plugin command that blocks the main thread waiting on the
  Swift bridge while a picker presents will **deadlock and get killed**. Run the bridge call on a spawned
  thread with a callback (see `plugins/src/mobile.rs`) and make the command `async`. Don't call the plugin
  during `setup()` — the bridge isn't ready; do it from a command after launch.
- **EELisp dialect** — the engine was aligned to the *original* EELisp (not the Scheme‑flavored first draft):
  flat `let`/`cond`, Clojure `loop`/`recur`, `str-join` in either arg order, string dict keys, and a lenient
  parser (some library files ship slightly unbalanced). Needed to run the zzeelisp bundle.
- **Desktop `.dmg` is ad‑hoc signed** — first open: right‑click the app → Open (or approve in System Settings
  → Privacy & Security). For clean distribution to other Macs, sign with the Developer ID cert + notarize.

---

## Conventions

- **No AI/assistant attribution** anywhere — commit messages, PR bodies, code, or docs.
- Commit/push only when asked; branch off `main` first if needed.
- Bump `bundle.iOS.bundleVersion` before every iOS re‑upload.

---

## Current status

Engine complete (74 tests, runs the full zzeelisp bundle). App feature‑complete for desktop + a strong iOS/iPad
build: file CRUD, agenda (notes/categories/recurrence/rules), wiki‑links + backlinks + autocomplete, snippets,
PDF export, editor tabs, Files‑app access, file import. Green CI on both repos. On TestFlight as `com.eeditor.app`
build 2.0.5.

**In flight**: iOS **folder picker** (native plugin) — device validation. **Next**: "Open in EEditor" file
association.
