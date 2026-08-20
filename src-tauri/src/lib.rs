mod assets;
mod menu;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
#[cfg(not(target_os = "macos"))]
use tauri::WindowEvent;
use tauri::{Emitter, Manager, State};

/// Everything the Rust side needs to remember between calls. Deliberately small:
/// the document itself is never cached, it is re-read from disk on every load so
/// what you see is always what is on disk.
#[derive(Default)]
pub struct AppState {
    /// Directory of the open document. The custom asset protocol refuses to
    /// serve anything outside it.
    doc_dir: Mutex<Option<PathBuf>>,
    /// A file the OS asked us to open before the webview was listening.
    pending: Mutex<Option<PathBuf>>,
    /// Set once the frontend has registered its event listeners. Until then an
    /// emitted `open-file` would be delivered into the void, so files are parked
    /// in `pending` instead.
    ready: AtomicBool,
    watcher: Mutex<watcher::Watch>,
}

#[derive(Serialize)]
pub struct Document {
    path: String,
    dir: String,
    name: String,
    content: String,
}

/// Read a Markdown file and start watching it for external changes.
#[tauri::command]
fn load_document(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Document, String> {
    let requested = PathBuf::from(path);
    let path = requested
        .canonicalize()
        .map_err(|e| format!("Can't open {}: {e}", requested.display()))?;

    let bytes = std::fs::read(&path).map_err(|e| format!("Can't read {}: {e}", path.display()))?;

    const MAX_BYTES: usize = 32 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "{} is {} MB — too large to render.",
            path.display(),
            bytes.len() / 1_048_576
        ));
    }

    // Markdown is text, but files in the wild carry stray bytes; lossy decoding
    // shows the document rather than refusing it.
    let content = strip_bom(&String::from_utf8_lossy(&bytes));

    let dir = path
        .parent()
        .unwrap_or_else(|| Path::new("/"))
        .to_path_buf();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".into());

    *state.doc_dir.lock().unwrap() = Some(dir.clone());
    state.watcher.lock().unwrap().watch(app, &path);

    Ok(Document {
        path: path.to_string_lossy().into_owned(),
        dir: dir.to_string_lossy().into_owned(),
        name,
        content,
    })
}

fn strip_bom(text: &str) -> String {
    text.strip_prefix('\u{feff}').unwrap_or(text).to_owned()
}

/// Used by File > Export as HTML. The path always comes from a native save
/// dialog, so the user has already chosen the destination.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Can't write {path}: {e}"))
}

/// Called once at startup. Doubles as the frontend's "I am listening now"
/// signal, which is why it flips `ready`.
#[tauri::command]
fn take_pending_file(state: State<'_, AppState>) -> Option<String> {
    state.ready.store(true, Ordering::SeqCst);
    state
        .pending
        .lock()
        .unwrap()
        .take()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Route a file to the webview if it can receive it, otherwise park it.
fn deliver(app: &tauri::AppHandle, path: PathBuf) {
    let state = app.state::<AppState>();
    if state.ready.load(Ordering::SeqCst) && app.emit("open-file", path.to_string_lossy()).is_ok() {
        return;
    }
    *state.pending.lock().unwrap() = Some(path);
}

/// First real file among the process arguments, skipping argv[0].
fn file_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be registered before any other plugin. Without it, double-clicking a
    // second .md file on Windows or Linux launches a whole second copy of the
    // app instead of opening the file in the one already running.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(path) = file_from_args(argv) {
                deliver(app, path);
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .register_uri_scheme_protocol("mdasset", assets::serve)
        .invoke_handler(tauri::generate_handler![
            load_document,
            write_text_file,
            take_pending_file
        ])
        .setup(|app| {
            menu::install(app.handle())?;
            if let Some(path) = file_from_args(std::env::args()) {
                *app.state::<AppState>().pending.lock().unwrap() = Some(path);
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            // Closing the only window quits on Windows and Linux; on macOS the
            // app stays in the Dock, which is the platform convention.
            #[cfg(not(target_os = "macos"))]
            if let WindowEvent::CloseRequested { .. } = event {
                _window.app_handle().exit(0);
            }
            let _ = event;
        })
        .build(tauri::generate_context!())
        .expect("failed to start Parchment");

    app.run(|_app, _event| {
        // macOS delivers double-clicked and "Open With" files as an Opened event.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    deliver(_app, path);
                }
            }
        }
    });
}
