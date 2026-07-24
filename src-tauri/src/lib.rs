// eeditor-next — Tauri v2 backend. The frontend reaches the engine + filesystem through commands
// that mirror the dev bridge, so the two transports are interchangeable (ANALYSIS §5):
//   • eelisp_eval(src)            → EngineHandle::eval → JSON envelope ({ok,result,output})
//   • fs_tree / fs_read / fs_write → workspace file access, confined to the workspace root
// Structured engine results are tagged: $tableView / $formView / $record / $resultSet / $dict / $item.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use eelisp::server::EngineHandle;
use serde_json::{json, Value};
use tauri::Manager;

struct Workspace(Mutex<PathBuf>);

const TEXT_EXT: &[&str] = &["md", "markdown", "txt", "eelisp", "lisp", "json", "yaml", "yml", "toml"];

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
        } else {
            let is_text = e
                .path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| TEXT_EXT.contains(&x.to_lowercase().as_str()))
                .unwrap_or(false);
            if is_text {
                out.push(json!({ "name": name, "path": crel, "isDir": false }));
            }
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
    fs::read_to_string(p).map_err(|e| e.to_string())
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

/// Open a native folder dialog, set it as the workspace root, and remember it for next launch.
/// Desktop only — mobile platforms are sandboxed and have no folder picker.
#[cfg(desktop)]
#[tauri::command]
fn pick_workspace(app: tauri::AppHandle, ws: tauri::State<Workspace>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app.dialog().file().blocking_pick_folder()?.into_path().ok()?;
    *ws.0.lock().unwrap() = path.clone();
    save_workspace(&app, &path);
    Some(path.to_string_lossy().to_string())
}

#[cfg(mobile)]
#[tauri::command]
fn pick_workspace(_app: tauri::AppHandle, _ws: tauri::State<Workspace>) -> Option<String> {
    None // sandboxed storage — the workspace is fixed to the app's data dir
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
/// Desktop: last-used → $EEDITOR_WORKSPACE → ./workspace → home dir.
fn initial_workspace(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(mobile)]
    {
        // Documents is the Files-app-visible folder; fall back to app-data if unavailable.
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
    app.path().home_dir().unwrap_or(cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineHandle::spawn(":memory:".to_string()))
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
            pick_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
