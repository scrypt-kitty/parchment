mod assets;
mod menu;
mod watcher;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use tauri::WindowEvent;
use tauri::{Emitter, Manager, State, WebviewWindowBuilder};

/// Label prefix of every window after the first. The capability file grants
/// permissions to `doc-*`, so the two must stay in step.
const WINDOW_PREFIX: &str = "doc-";

/// What one window knows about its document. Each window is an independent
/// viewer: its own file, its own watcher, its own image scope.
#[derive(Default)]
pub struct WinState {
    /// Directory of the open document. The custom asset protocol refuses to
    /// serve anything outside it.
    doc_dir: Option<PathBuf>,
    /// The document this window shows, or has been promised. Set the moment a
    /// window is chosen for a file, not when the load finishes, so two quick
    /// opens cannot both claim the same empty window.
    doc_path: Option<PathBuf>,
    /// A file waiting for the webview to start listening.
    pending: Option<PathBuf>,
    /// Set once the frontend has registered its event listeners. Until then an
    /// emitted `open-file` would be delivered into the void, so files are parked
    /// in `pending` instead.
    ready: bool,
    watcher: watcher::Watch,
}

impl WinState {
    fn holds(&self, path: &Path) -> bool {
        self.doc_path.as_deref() == Some(path) || self.pending.as_deref() == Some(path)
    }

    fn is_empty(&self) -> bool {
        self.doc_path.is_none() && self.pending.is_none()
    }
}

/// Everything the Rust side needs to remember between calls. Deliberately small:
/// the document itself is never cached, it is re-read from disk on every load so
/// what you see is always what is on disk.
#[derive(Default)]
pub struct AppState {
    /// Per-window state, keyed by window label.
    windows: Mutex<HashMap<String, WinState>>,
    next_window: AtomicU64,
    /// Mirrors the frontend's recent-files list so the native Open Recent
    /// submenu can be rebuilt from it. Paths only — never contents.
    recent: Mutex<Vec<RecentFile>>,
    /// Whether the automatic update check is enabled, reflected as the checked
    /// state of the corresponding menu item.
    auto_update: AtomicBool,
    /// Whether a document that changes on disk reloads by itself, or waits to
    /// be reloaded from the prompt.
    auto_reload: AtomicBool,
}

impl AppState {
    /// The directory `mdasset://` requests from `label` are confined to.
    pub fn doc_dir_for(&self, label: &str) -> Option<PathBuf> {
        self.windows.lock().ok()?.get(label)?.doc_dir.clone()
    }
}

/// One entry of the Open Recent submenu.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
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
    window: tauri::Window,
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

    {
        let mut windows = state.windows.lock().unwrap();
        let win = windows.entry(window.label().to_owned()).or_default();
        win.doc_dir = Some(dir.clone());
        win.doc_path = Some(path.clone());
        win.watcher.watch(app, window.label(), &path);
    }

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

/// Called once per window at startup. Doubles as the frontend's "I am
/// listening now" signal, which is why it flips `ready`.
#[tauri::command]
fn take_pending_file(window: tauri::Window, state: State<'_, AppState>) -> Option<String> {
    let mut windows = state.windows.lock().unwrap();
    let win = windows.entry(window.label().to_owned()).or_default();
    win.ready = true;
    win.pending.take().map(|p| p.to_string_lossy().into_owned())
}

/// Open `path` in whichever window should show it. The frontend calls this for
/// every user-initiated open (dialog, recent list, drop, link) rather than
/// loading into itself, so a document that is already open is focused instead
/// of duplicated and an occupied window is never silently replaced.
#[tauri::command]
async fn open_in_window(app: tauri::AppHandle, window: tauri::Window, path: String) {
    route_open(&app, PathBuf::from(path), Some(window.label()));
}

/// Replaces the Open Recent submenu contents. Called by the frontend, which
/// owns the list; Rust only mirrors it for the native menu.
#[tauri::command]
fn set_recent_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    files: Vec<RecentFile>,
) -> Result<(), String> {
    *state.recent.lock().unwrap() = files;
    rebuild_menu(&app, &state)
}

/// Syncs the checked state of "Check Automatically" with the stored preference.
#[tauri::command]
fn set_auto_update_checked(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.auto_update.store(enabled, Ordering::SeqCst);
    rebuild_menu(&app, &state)
}

/// Syncs the checked state of "Reload Automatically" with the stored preference.
#[tauri::command]
fn set_auto_reload_checked(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.auto_reload.store(enabled, Ordering::SeqCst);
    rebuild_menu(&app, &state)
}

fn rebuild_menu(app: &tauri::AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let recent = state.recent.lock().unwrap().clone();
    let auto_update = state.auto_update.load(Ordering::SeqCst);
    let auto_reload = state.auto_reload.load(Ordering::SeqCst);
    menu::install(app, &recent, auto_update, auto_reload)
        .map_err(|e| format!("Can't rebuild the menu: {e}"))
}

/// Where a requested file should go.
#[derive(Debug, PartialEq, Eq)]
enum Route {
    /// Already open (or on its way) in this window: just bring it forward.
    Focus(String),
    /// An empty window can take it.
    Reuse(String),
    /// Everything is occupied: open another window.
    New,
}

/// Decide a [`Route`]. `live` is the labels of windows that exist, `prefer` the
/// window the request came from. Pure, so the policy is unit-testable.
fn plan(
    windows: &HashMap<String, WinState>,
    live: &[String],
    path: &Path,
    prefer: Option<&str>,
) -> Route {
    let mut held: Vec<&String> = windows
        .iter()
        .filter(|(_, w)| w.holds(path))
        .map(|(label, _)| label)
        .collect();
    held.sort();
    if let Some(label) = held.first() {
        return Route::Focus((*label).clone());
    }

    let empty = |label: &str| windows.get(label).map(WinState::is_empty).unwrap_or(true);
    if let Some(label) = prefer.filter(|l| live.iter().any(|x| x == l)) {
        if empty(label) {
            return Route::Reuse(label.to_owned());
        }
    }
    let mut candidates: Vec<&String> = live.iter().filter(|l| empty(l)).collect();
    candidates.sort();
    match candidates.first() {
        Some(label) => Route::Reuse((*label).clone()),
        None => Route::New,
    }
}

/// Send `path` to the right window, creating one if needed. Safe to call from
/// any thread: window creation is deferred to its own thread, because building
/// a webview from a callback that is itself running on the main thread
/// deadlocks on Windows.
pub fn route_open(app: &tauri::AppHandle, path: PathBuf, prefer: Option<&str>) {
    // Same canonical form `load_document` records, so the comparison is exact.
    let path = path.canonicalize().unwrap_or(path);
    let state = app.state::<AppState>();
    let live: Vec<String> = app.webview_windows().keys().cloned().collect();

    enum Act {
        Focus(String),
        Emit(String),
        Create(String),
    }

    let act = {
        let mut windows = state.windows.lock().unwrap();
        match plan(&windows, &live, &path, prefer) {
            Route::Focus(label) => Act::Focus(label),
            Route::Reuse(label) => {
                let win = windows.entry(label.clone()).or_default();
                win.doc_path = Some(path.clone());
                if win.ready {
                    Act::Emit(label)
                } else {
                    win.pending = Some(path.clone());
                    Act::Focus(label)
                }
            }
            Route::New => {
                let n = state.next_window.fetch_add(1, Ordering::SeqCst) + 1;
                let label = format!("{WINDOW_PREFIX}{n}");
                let win = windows.entry(label.clone()).or_default();
                win.doc_path = Some(path.clone());
                win.pending = Some(path.clone());
                Act::Create(label)
            }
        }
    };

    match act {
        Act::Focus(label) => focus(app, &label),
        Act::Emit(label) => {
            let _ = app.emit_to(label.as_str(), "open-file", path.to_string_lossy());
            focus(app, &label);
        }
        Act::Create(label) => {
            let app = app.clone();
            std::thread::spawn(move || {
                if create_window(&app, &label).is_err() {
                    app.state::<AppState>()
                        .windows
                        .lock()
                        .unwrap()
                        .remove(&label);
                }
            });
        }
    }
}

fn create_window(app: &tauri::AppHandle, label: &str) -> tauri::Result<()> {
    // Same shape as the window in tauri.conf.json, minus centering: left to the
    // OS, new windows cascade instead of stacking exactly on top of each other.
    let mut config = app.config().app.windows[0].clone();
    config.label = label.to_owned();
    config.center = false;
    WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}

fn focus(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The window menu commands should act on: the focused one, else any.
fn active_window_label(app: &tauri::AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .map(|w| w.label().to_owned())
        .or_else(|| windows.contains_key("main").then(|| "main".to_owned()))
        .or_else(|| windows.keys().next().cloned())
}

/// Every real file among the process arguments, skipping argv[0].
fn files_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .collect()
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
            let files = files_from_args(argv);
            if files.is_empty() {
                if let Some(label) = active_window_label(app) {
                    focus(app, &label);
                }
            }
            for path in files {
                route_open(app, path, None);
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
            open_in_window,
            write_text_file,
            take_pending_file,
            set_recent_files,
            set_auto_update_checked,
            set_auto_reload_checked
        ])
        .setup(|app| {
            // Built empty; the frontend repopulates it once it has read its
            // stored list, which happens before the window is shown.
            menu::install(app.handle(), &[], true, true)?;
            // The first file goes to the window that already exists; any more
            // each get a window of their own.
            let mut files = files_from_args(std::env::args()).into_iter();
            if let Some(first) = files.next() {
                let first = first.canonicalize().unwrap_or(first);
                let state = app.state::<AppState>();
                let mut windows = state.windows.lock().unwrap();
                let win = windows.entry("main".to_owned()).or_default();
                win.doc_path = Some(first.clone());
                win.pending = Some(first);
            }
            for path in files {
                route_open(app.handle(), path, None);
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            // Registered once here, not in `menu::install`, which runs on every
            // rebuild and would stack a handler each time. Commands go to the
            // focused window only.
            if let Some(label) = active_window_label(app) {
                let _ = app.emit_to(label.as_str(), "menu-action", event.id().0.as_str());
            }
        })
        .on_window_event(|window, event| match event {
            // Closing the last window quits on Windows and Linux; on macOS the
            // app stays in the Dock, which is the platform convention.
            #[cfg(not(target_os = "macos"))]
            WindowEvent::CloseRequested { .. } => {
                if window.app_handle().webview_windows().len() <= 1 {
                    window.app_handle().exit(0);
                }
            }
            // Dropping the entry drops the window's watcher and its thread.
            tauri::WindowEvent::Destroyed => {
                if let Ok(mut windows) = window.state::<AppState>().windows.lock() {
                    windows.remove(window.label());
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("failed to start Parchment");

    app.run(|_app, _event| {
        // macOS delivers double-clicked and "Open With" files as an Opened event.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    route_open(_app, path, None);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(doc: Option<&str>, pending: Option<&str>) -> WinState {
        WinState {
            doc_path: doc.map(PathBuf::from),
            pending: pending.map(PathBuf::from),
            ..Default::default()
        }
    }

    fn live(labels: &[&str]) -> Vec<String> {
        labels.iter().map(|l| (*l).to_owned()).collect()
    }

    fn map(entries: Vec<(&str, WinState)>) -> HashMap<String, WinState> {
        entries
            .into_iter()
            .map(|(l, w)| (l.to_owned(), w))
            .collect()
    }

    #[test]
    fn untouched_window_takes_the_file() {
        let windows = HashMap::new();
        let route = plan(&windows, &live(&["main"]), Path::new("/a.md"), None);
        assert_eq!(route, Route::Reuse("main".into()));
    }

    #[test]
    fn occupied_window_is_never_replaced() {
        let windows = map(vec![("main", win(Some("/a.md"), None))]);
        let route = plan(&windows, &live(&["main"]), Path::new("/b.md"), Some("main"));
        assert_eq!(route, Route::New);
    }

    #[test]
    fn already_open_file_is_focused_not_duplicated() {
        let windows = map(vec![
            ("main", win(Some("/a.md"), None)),
            ("doc-1", win(Some("/b.md"), None)),
        ]);
        let route = plan(
            &windows,
            &live(&["main", "doc-1"]),
            Path::new("/b.md"),
            Some("main"),
        );
        assert_eq!(route, Route::Focus("doc-1".into()));
    }

    #[test]
    fn file_still_loading_counts_as_open() {
        // A window that has been promised a file but not yet loaded it.
        let windows = map(vec![("doc-1", win(None, Some("/b.md")))]);
        let route = plan(
            &windows,
            &live(&["main", "doc-1"]),
            Path::new("/b.md"),
            None,
        );
        assert_eq!(route, Route::Focus("doc-1".into()));
    }

    #[test]
    fn requesting_window_is_preferred_when_empty() {
        let windows = map(vec![]);
        let route = plan(
            &windows,
            &live(&["main", "doc-1"]),
            Path::new("/a.md"),
            Some("doc-1"),
        );
        assert_eq!(route, Route::Reuse("doc-1".into()));
    }

    #[test]
    fn another_empty_window_is_used_before_creating_one() {
        let windows = map(vec![("main", win(Some("/a.md"), None))]);
        let route = plan(
            &windows,
            &live(&["main", "doc-1"]),
            Path::new("/b.md"),
            Some("main"),
        );
        assert_eq!(route, Route::Reuse("doc-1".into()));
    }

    #[test]
    fn window_promised_a_file_is_not_empty() {
        let windows = map(vec![("doc-1", win(None, Some("/a.md")))]);
        let route = plan(&windows, &live(&["doc-1"]), Path::new("/b.md"), None);
        assert_eq!(route, Route::New);
    }

    #[test]
    fn window_labels_match_the_capability_glob() {
        let capability = include_str!("../capabilities/default.json");
        assert!(capability.contains(&format!("\"{WINDOW_PREFIX}*\"")));
    }

    #[test]
    fn args_skip_argv0_and_non_files() {
        let exe = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let args = vec![exe.clone(), exe.clone(), "no-such-file.md".into()];
        assert_eq!(files_from_args(args), vec![PathBuf::from(exe)]);
    }
}
