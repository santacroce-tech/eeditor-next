// eeditor-next — Tauri v2 backend. The frontend reaches the engine + filesystem through commands
// that mirror the dev bridge, so the two transports are interchangeable (ANALYSIS §5):
//   • eelisp_eval(src)            → EngineHandle::eval → JSON envelope ({ok,result,output})
//   • fs_tree / fs_read / fs_write → workspace file access, confined to the workspace root
// Structured engine results are tagged: $tableView / $formView / $record / $resultSet / $dict / $item.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use eelisp::server::EngineHandle;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

struct Workspace(Mutex<PathBuf>);

/// Files outside the workspace that the user has explicitly opened in place (drag-and-drop, "Open
/// With", the file picker). `external_read`/`external_write` refuse anything not in here, so the
/// workspace confinement in `resolve` stays the rule and each escape from it is one the user made.
/// In-memory only — a grant lasts for the session, never longer.
#[derive(Default)]
struct ExternalFiles(Mutex<HashSet<PathBuf>>);

/// Paths handed to us by the OS (macOS "Open With" / iOS "Open in…") before the frontend was ready
/// to listen. Drained by `take_pending_opens` on startup; afterwards opens arrive as `open-paths`.
#[derive(Default)]
struct PendingOpens(Mutex<Vec<PathBuf>>);

/// Set once the quit has been handed to the frontend (or forced), so the deferral happens exactly
/// once. See `defer_exit` — quitting must not drop unsaved buffers.
#[derive(Default)]
struct ExitGuard(AtomicBool);

/// How long we wait for the frontend to flush before quitting regardless. A wedged webview must
/// never make the app unquittable; saving a handful of text files takes milliseconds.
const EXIT_FLUSH_TIMEOUT: Duration = Duration::from_secs(3);

/// Id of our own Quit item (see `build_menu`).
const MENU_QUIT: &str = "quit";

/// Hand the quit to the frontend — it holds the unsaved buffers — and arrange to exit anyway if it
/// never answers. Returns false when the exit was already deferred once and should now go through.
fn defer_exit(app: &tauri::AppHandle) -> bool {
    if app.state::<ExitGuard>().0.swap(true, Ordering::SeqCst) {
        return false;
    }
    let _ = app.emit("app-exiting", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(EXIT_FLUSH_TIMEOUT);
        handle.exit(0);
    });
    true
}

/// The default application menu, with one deliberate change: Quit is ours rather than the
/// predefined item. The predefined one terminates the process through the OS, which never reaches
/// the event loop — so ⌘Q would take the last second of typing with it. Everything else mirrors
/// `Menu::default` (the Edit menu in particular: on macOS its items are what make ⌘C/⌘V work).
#[cfg(desktop)]
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let pkg = app.package_info();
    let name = pkg.name.clone();
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app.config().bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let quit = MenuItem::with_id(app, MENU_QUIT, format!("Quit {name}"), true, Some("CmdOrCtrl+Q"))?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about.clone()))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &PredefinedMenuItem::close_window(app, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Help",
                true,
                &[
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                ],
            )?,
        ],
    )
}

/// EEditor edits text, not only Markdown: a source file, a log, a csv, a config, a file with no
/// extension at all are all fair game. So the rule is a *denylist* — formats whose bytes are not
/// text — rather than a list of blessed extensions. What the list can't answer (an unknown
/// extension, no extension) is settled by looking at the content: see `read_text`.
const BINARY_EXT: &[&str] = &[
    // images
    "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "webp", "heic", "heif", "ico", "icns", "psd", "ai",
    // documents & archives
    "pdf", "zip", "gz", "bz2", "xz", "7z", "rar", "tar", "dmg", "iso", "doc", "docx", "xls", "xlsx", "ppt",
    "pptx", "numbers", "pages", "sketch", "epub",
    // audio & video
    "mp3", "wav", "aac", "flac", "ogg", "m4a", "mp4", "m4v", "mov", "avi", "mkv", "webm",
    // fonts
    "ttf", "otf", "woff", "woff2", "eot",
    // executables, objects & databases
    "exe", "dll", "so", "dylib", "o", "a", "bin", "class", "jar", "wasm", "pyc", "db", "sqlite", "sqlite3",
];

fn is_binary_ext(p: &Path) -> bool {
    p.extension()
        .and_then(|x| x.to_str())
        .map(|x| BINARY_EXT.contains(&x.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Read a file as text, refusing what is plainly not. UTF-8 is the real test; the NUL-byte check
/// just makes the common case cheap and gives a message that says what actually went wrong.
fn read_text(p: &Path) -> Result<String, String> {
    let bytes = fs::read(p).map_err(|e| format!("read {}: {}", p.display(), e))?;
    if bytes.contains(&0) {
        return Err(format!("{} is a binary file — EEditor edits text", p.display()));
    }
    String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text", p.display()))
}

#[tauri::command]
fn eelisp_eval(engine: tauri::State<EngineHandle>, src: String) -> String {
    engine.eval(&src)
}

fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = root.join(rel);
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
    let canon = p.canonicalize().unwrap_or_else(|_| p.clone());
    if canon != canon_root && !canon.starts_with(&canon_root) {
        return Err("path escapes workspace".into());
    }
    Ok(p)
}

fn children_of(dir: &Path, rel: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(dir) else { return out };
    let mut items: Vec<_> = read.flatten().collect();
    items.sort_by_key(|e| (!e.path().is_dir(), e.file_name().to_string_lossy().to_lowercase()));
    for e in items {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let crel = if rel.is_empty() { name.clone() } else { format!("{}/{}", rel, name) };
        if e.path().is_dir() {
            out.push(json!({ "name": name, "path": crel, "isDir": true, "children": children_of(&e.path(), &crel) }));
        } else if !is_binary_ext(&e.path()) {
            out.push(json!({ "name": name, "path": crel, "isDir": false }));
        }
    }
    out
}

#[tauri::command]
fn fs_tree(ws: tauri::State<Workspace>) -> String {
    let root = ws.0.lock().unwrap().clone();
    let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "workspace".into());
    json!({ "name": name, "path": "", "isDir": true, "children": children_of(&root, "") }).to_string()
}

#[tauri::command]
fn fs_read(ws: tauri::State<Workspace>, path: String) -> Result<String, String> {
    let p = resolve(&ws.0.lock().unwrap(), &path)?;
    read_text(&p)
}

#[tauri::command]
fn fs_write(ws: tauri::State<Workspace>, path: String, content: String) -> Result<(), String> {
    let p = resolve(&ws.0.lock().unwrap(), &path)?;
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_create(ws: tauri::State<Workspace>, path: String, is_dir: bool) -> Result<(), String> {
    let p = resolve(&ws.0.lock().unwrap(), &path)?;
    if p.exists() {
        return Err("already exists".into());
    }
    if is_dir {
        fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&p, "").map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn fs_rename(ws: tauri::State<Workspace>, from: String, to: String) -> Result<(), String> {
    let root = ws.0.lock().unwrap();
    let f = resolve(&root, &from)?;
    let t = resolve(&root, &to)?;
    if let Some(parent) = t.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::rename(f, t).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_delete(ws: tauri::State<Workspace>, path: String) -> Result<(), String> {
    let p = resolve(&ws.0.lock().unwrap(), &path)?;
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// Copy a file chosen via the native document picker (path may be outside the workspace — e.g. the
/// iOS Files app / Downloads) into the workspace so it becomes an editable note. Returns the new
/// workspace-relative path (a unique name if one already exists).
#[tauri::command]
fn import_file(ws: tauri::State<Workspace>, src: String) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let data = fs::read(&src_path).map_err(|e| format!("read {}: {}", src, e))?;
    let name = src_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "imported.md".into());
    let root = ws.0.lock().unwrap().clone();
    let mut dest = root.join(&name);
    if dest.exists() {
        let stem = src_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "imported".into());
        let ext = src_path.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
        for i in 1.. {
            let cand = root.join(format!("{}-{}{}", stem, i, ext));
            if !cand.exists() {
                dest = cand;
                break;
            }
        }
    }
    fs::write(&dest, &data).map_err(|e| e.to_string())?;
    Ok(dest.file_name().unwrap().to_string_lossy().to_string())
}

// ── files outside the workspace ────────────────────────────────────────────────────────────────
//
// Dropped on the window, or handed over by "Open With". The user decides per file whether to copy it
// into the workspace (`import_file`) or edit it where it lies (`external_open` → `external_write`).

/// Where an external path sits relative to the workspace: `inside` means it is really a workspace
/// file reached by its absolute path, so the caller should just open it normally and skip the
/// copy/in-place question entirely.
#[derive(serde::Serialize)]
struct ExternalInfo {
    path: String,
    name: String,
    /// Workspace-relative path when the file is inside the workspace, else null.
    rel: Option<String>,
    content: String,
    writable: bool,
}

/// Workspace-relative path for `file`, or None when it sits outside `root`. Both are canonicalized
/// first so a symlink or a `..` detour can't disguise an outside file as an inside one.
fn workspace_rel(root: &Path, file: &Path) -> Option<String> {
    let root = root.canonicalize().ok()?;
    let file = file.canonicalize().ok()?;
    let rel = file.strip_prefix(&root).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// Canonicalize and classify a path we were handed, returning its content and — if it turns out to
/// live inside the workspace after all — its workspace-relative path. Grants in-place access.
#[tauri::command]
fn external_open(
    ws: tauri::State<Workspace>,
    ext: tauri::State<ExternalFiles>,
    path: String,
) -> Result<ExternalInfo, String> {
    let p = PathBuf::from(&path).canonicalize().map_err(|e| format!("{}: {}", path, e))?;
    if !p.is_file() {
        return Err(format!("{} is not a file", p.display()));
    }
    let content = read_text(&p)?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "untitled".into());

    // Already ours? Then it is not "external" at all — hand back the relative path.
    let rel = workspace_rel(&ws.0.lock().unwrap(), &p);

    let writable = !fs::metadata(&p).map(|m| m.permissions().readonly()).unwrap_or(true);
    if rel.is_none() {
        ext.0.lock().unwrap().insert(p.clone());
    }
    Ok(ExternalInfo { path: p.to_string_lossy().to_string(), name, rel, content, writable })
}

/// Re-read a granted external file (used when switching back to its tab).
#[tauri::command]
fn external_read(ext: tauri::State<ExternalFiles>, path: String) -> Result<String, String> {
    let p = granted(&ext, &path)?;
    fs::read_to_string(p).map_err(|e| e.to_string())
}

/// Save back to an external file. Only paths the user opened in place this session are writable.
#[tauri::command]
fn external_write(ext: tauri::State<ExternalFiles>, path: String, content: String) -> Result<(), String> {
    let p = granted(&ext, &path)?;
    fs::write(p, content).map_err(|e| e.to_string())
}

fn granted(ext: &tauri::State<ExternalFiles>, path: &str) -> Result<PathBuf, String> {
    check_granted(&ext.0.lock().unwrap(), path)
}

/// The gate on every external read/write: the canonical path must be one this session granted.
/// Canonicalizing first means `/tmp/../tmp/x.md` or a symlink to a granted file resolves to the
/// same key, and anything else — however it is spelled — is refused.
fn check_granted(set: &HashSet<PathBuf>, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let canon = p.canonicalize().unwrap_or(p);
    if set.contains(&canon) {
        Ok(canon)
    } else {
        Err("file was not opened in this session".into())
    }
}

/// Drain the OS-delivered paths queued before the frontend was listening (cold start via "Open With").
#[tauri::command]
fn take_pending_opens(pending: tauri::State<PendingOpens>) -> Vec<String> {
    pending.0.lock().unwrap().drain(..).map(|p| p.to_string_lossy().to_string()).collect()
}

/// The frontend has flushed its unsaved buffers — quit for real. Arms the guard first so the
/// `ExitRequested` this raises goes straight through instead of being deferred a second time.
#[tauri::command]
fn finish_exit(app: tauri::AppHandle, guard: tauri::State<ExitGuard>) {
    guard.0.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// Open a native folder dialog, set it as the workspace root, and remember it for next launch.
/// Desktop only — mobile platforms are sandboxed and have no folder picker.
///
/// Async + non-blocking: a *synchronous* command runs on the main thread, and
/// `blocking_pick_folder` would then block that same thread waiting on the dialog it just spawned —
/// a deadlock (the picker opens but the promise never resolves, so the app hangs "thinking"). So we
/// present the picker via the non-blocking callback API and wait for the result off the main thread.
#[cfg(desktop)]
#[tauri::command]
async fn pick_workspace(
    app: tauri::AppHandle,
    ws: tauri::State<'_, Workspace>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .unwrap_or(None);
    let path = picked.and_then(|fp| fp.into_path().ok());
    if let Some(p) = &path {
        *ws.0.lock().unwrap() = p.clone();
        save_workspace(&app, p);
    }
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

/// iOS: present the native folder picker (Files / Downloads / iCloud). The chosen folder becomes the
/// workspace; the ios-files plugin holds security-scoped access + persists a bookmark for next launch.
/// Async + non-blocking so it never stalls the main thread while the picker is up.
#[cfg(mobile)]
#[tauri::command]
async fn pick_workspace(app: tauri::AppHandle, ws: tauri::State<'_, Workspace>) -> Result<Option<String>, String> {
    use tauri_plugin_ios_files::IosFilesExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.ios_files().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let path = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .unwrap_or(None);
    if let Some(p) = &path {
        *ws.0.lock().unwrap() = PathBuf::from(p);
    }
    Ok(path)
}

/// iOS: on startup, re-open the folder the user picked last time (via the persisted bookmark).
/// Returns the restored path (and updates the workspace), or None.
#[cfg(mobile)]
#[tauri::command]
async fn restore_workspace(app: tauri::AppHandle, ws: tauri::State<'_, Workspace>) -> Result<Option<String>, String> {
    use tauri_plugin_ios_files::IosFilesExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.ios_files().restore_folder(move |path| {
        let _ = tx.send(path);
    });
    let path = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .unwrap_or(None);
    if let Some(p) = &path {
        *ws.0.lock().unwrap() = PathBuf::from(p);
    }
    Ok(path)
}

#[cfg(desktop)]
#[tauri::command]
fn restore_workspace() -> Option<String> {
    None
}

// ── persisted workspace root (app config dir/workspace.txt) ──

fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("workspace.txt"))
}

fn load_saved_workspace(app: &tauri::AppHandle) -> Option<PathBuf> {
    let s = fs::read_to_string(config_path(app)?).ok()?;
    let p = PathBuf::from(s.trim());
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

#[cfg(desktop)]
fn save_workspace(app: &tauri::AppHandle, path: &Path) {
    if let Some(cfg) = config_path(app) {
        let _ = fs::write(cfg, path.to_string_lossy().as_bytes());
    }
}

/// Resolve the workspace on startup.
/// Mobile: the app's **Documents** dir — exposed to the Files app via UIFileSharingEnabled /
/// LSSupportsOpeningDocumentsInPlace (Info.ios.plist), so the user can add/edit .md files there.
/// Desktop: last-used → $EEDITOR_WORKSPACE → ./workspace (dev) → ~/Documents/EEditor (seeded).
fn initial_workspace(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(mobile)]
    {
        // Default to the app's Documents dir (Files-app-visible). A previously-picked external folder
        // is restored AFTER launch via the `restore_workspace` command (calling the plugin during
        // setup can crash — the bridge isn't ready yet).
        if let Ok(ws) = app.path().document_dir().or_else(|_| app.path().app_data_dir()) {
            let _ = fs::create_dir_all(&ws);
            let welcome = ws.join("welcome.md");
            if !welcome.exists() {
                let _ = fs::write(
                    &welcome,
                    "# EEditor (iOS)\n\nA Markdown editor with the EELisp engine — running natively on iOS.\n\nYour notes live in this folder, which is also visible in the **Files** app under\n**On My iPhone → EEditor** — add or edit .md files there and they show up here.\n\nTap the **REPL** tab and try:\n\n```eelisp\n(+ 1 2 3)\n(map (fn (x) (* x x)) (range 1 6))\n```\n",
                );
            }
            return ws;
        }
    }
    if let Some(saved) = load_saved_workspace(app) {
        return saved;
    }
    if let Ok(p) = std::env::var("EEDITOR_WORKSPACE") {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            return pb;
        }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let w = cwd.join("workspace");
    if w.is_dir() {
        return w;
    }
    // Packaged app: launched from Finder the cwd is `/`, so there's no dev `./workspace` and nothing
    // saved yet. Do NOT fall back to the raw home dir — `fs_tree` walks the whole tree eagerly, and
    // indexing all of $HOME (node_modules, Library, …) would hang the app on first launch. Default to
    // a dedicated notes folder the user can later switch via the folder picker.
    if let Ok(docs) = app.path().document_dir() {
        let ws = docs.join("EEditor");
        if fs::create_dir_all(&ws).is_ok() {
            let empty = fs::read_dir(&ws).map(|mut d| d.next().is_none()).unwrap_or(false);
            if empty {
                let _ = fs::write(
                    ws.join("welcome.md"),
                    "# EEditor\n\nA Markdown editor with the EELisp engine.\n\nYour notes live in this folder (**Documents → EEditor**). Use the **folder…** button in the Files\nheader to point EEditor at any other folder.\n\nShortcuts: ⌘S save · ⌘P quick-open · ⌘⇧F search · ⌘D today's note · ⌘I timestamp heading ·\n⌘⇧↩ run the ```eelisp block at the cursor.\n\n```eelisp\n(+ 1 2 3)\n(map (fn (x) (* x x)) (range 1 6))\n```\n",
                );
            }
            return ws;
        }
    }
    app.path().home_dir().unwrap_or(cwd)
}

/// Queue paths the OS asked us to open and nudge the frontend. Queue-then-notify (rather than
/// emitting the paths themselves) means a cold start and a running app take the same route: the
/// frontend drains `take_pending_opens` on startup *and* on every `open-paths` event, so a file that
/// arrives before the webview exists is not lost and one that arrives after is not handled twice.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn queue_opens(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<PendingOpens>() {
        state.0.lock().unwrap().extend(paths);
    }
    let _ = app.emit("open-paths", ());

    // "Open With" on an already-running app leaves us behind Finder, so the note would open out of
    // sight. Come forward — the user just asked for this file.
    #[cfg(target_os = "macos")]
    for (_, w) in app.webview_windows() {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Our Quit item runs the same deferral as any other exit (see `defer_exit`).
    #[cfg(desktop)]
    let builder = builder.menu(build_menu).on_menu_event(|app, event| {
        if event.id() == MENU_QUIT && !defer_exit(app) {
            app.exit(0);
        }
    });
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_ios_files::init())
        .manage(EngineHandle::spawn(":memory:".to_string()))
        .manage(ExternalFiles::default())
        .manage(PendingOpens::default())
        .manage(ExitGuard::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }
            let ws = initial_workspace(app.handle());
            eprintln!("[eeditor] workspace: {}", ws.display());
            app.manage(Workspace(Mutex::new(ws)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            eelisp_eval,
            fs_tree,
            fs_read,
            fs_write,
            fs_create,
            fs_rename,
            fs_delete,
            import_file,
            external_open,
            external_read,
            external_write,
            take_pending_opens,
            finish_exit,
            pick_workspace,
            restore_workspace
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // A file association delivers its file through RunEvent::Opened — at launch on a cold start, or
    // while we're already running when the user picks EEditor from Finder's "Open With".
    app.run(|app, event| match event {
        // Quitting (⌘Q, the Dock, the last window closing) must not throw away unsaved edits, and
        // the unsaved edits live in the webview. So the first exit is deferred: we ask the frontend
        // to flush and it calls `finish_exit` when it's done. The watchdog is the backstop — a
        // frontend that never answers delays the quit, it doesn't prevent it.
        tauri::RunEvent::ExitRequested { api, .. } => {
            if defer_exit(app) {
                api.prevent_exit();
            }
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Opened { urls } => {
            queue_opens(app, urls.iter().filter_map(|u| u.to_file_path().ok()).collect());
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory that cleans itself up. Avoids pulling in a tempdir dependency.
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("eeditor-test-{}-{}", tag, std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            // canonicalize: on macOS temp_dir is /var/… which is a symlink to /private/var
            Tmp(p.canonicalize().unwrap())
        }
        fn file(&self, name: &str, body: &str) -> PathBuf {
            let p = self.0.join(name);
            if let Some(d) = p.parent() {
                fs::create_dir_all(d).unwrap();
            }
            fs::write(&p, body).unwrap();
            p
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn workspace_rel_spots_files_inside_the_workspace() {
        let t = Tmp::new("rel");
        let root = t.0.join("ws");
        fs::create_dir_all(root.join("notes")).unwrap();
        let inside = t.file("ws/notes/a.md", "x");
        assert_eq!(workspace_rel(&root, &inside).as_deref(), Some("notes/a.md"));
    }

    #[test]
    fn workspace_rel_rejects_outside_and_dotdot_detours() {
        let t = Tmp::new("outside");
        let root = t.0.join("ws");
        fs::create_dir_all(&root).unwrap();
        let outside = t.file("elsewhere/b.md", "x");
        assert_eq!(workspace_rel(&root, &outside), None);

        // spelled as if it were inside, but ".." walks back out
        let sneaky = root.join("../elsewhere/b.md");
        assert_eq!(workspace_rel(&root, &sneaky), None);
    }

    #[test]
    fn ungranted_paths_are_refused() {
        let t = Tmp::new("grant");
        let f = t.file("secret.md", "x");
        let empty = HashSet::new();
        assert!(check_granted(&empty, f.to_str().unwrap()).is_err());
    }

    #[test]
    fn granted_paths_are_accepted_however_they_are_spelled() {
        let t = Tmp::new("grant2");
        let f = t.file("ok.md", "x");
        let mut set = HashSet::new();
        set.insert(f.clone());

        assert_eq!(check_granted(&set, f.to_str().unwrap()).unwrap(), f);
        // a `..` detour to the same file resolves to the same canonical key
        let detour = t.0.join("sub/../ok.md");
        fs::create_dir_all(t.0.join("sub")).unwrap();
        assert_eq!(check_granted(&set, detour.to_str().unwrap()).unwrap(), f);
        // a sibling file is still refused
        let other = t.file("other.md", "x");
        assert!(check_granted(&set, other.to_str().unwrap()).is_err());
    }

    #[test]
    fn any_extension_is_editable_except_the_binary_ones() {
        // the notes we started from
        assert!(!is_binary_ext(Path::new("/x/a.md")));
        assert!(!is_binary_ext(Path::new("/x/a.eelisp")));
        // …and everything else that is still text
        assert!(!is_binary_ext(Path::new("/x/main.rs")));
        assert!(!is_binary_ext(Path::new("/x/data.csv")));
        assert!(!is_binary_ext(Path::new("/x/Makefile"))); // no extension at all
        assert!(!is_binary_ext(Path::new("/x/.gitignore")));
        // formats whose bytes aren't text
        assert!(is_binary_ext(Path::new("/x/a.png")));
        assert!(is_binary_ext(Path::new("/x/a.PNG")));
        assert!(is_binary_ext(Path::new("/x/a.sqlite3")));
    }

    #[test]
    fn read_text_takes_any_text_file_and_refuses_binary_content() {
        let t = Tmp::new("readtext");
        let code = t.file("script.py", "print('hi')\n");
        assert_eq!(read_text(&code).unwrap(), "print('hi')\n");

        // an extension the denylist doesn't know, but the content gives it away
        let blob = t.file("mystery.dat", "PK\u{0}\u{0}binary");
        assert!(read_text(&blob).is_err());
    }
}
