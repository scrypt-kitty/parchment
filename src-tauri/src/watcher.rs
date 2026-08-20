//! Live reload. Watches the open document and tells the webview to re-read it
//! when something on disk changes.
//!
//! The *parent directory* is watched rather than the file itself: most editors
//! save by writing a temporary file and renaming it over the original, which
//! destroys the inode a file-level watch is holding.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// Editors emit a burst of events for a single save; collapse anything closer
/// together than this into one reload.
const DEBOUNCE: Duration = Duration::from_millis(120);

#[derive(Default)]
pub struct Watch {
    inner: Option<RecommendedWatcher>,
    target: Option<PathBuf>,
}

impl Watch {
    /// Point the watcher at `file`, replacing whatever it was watching before.
    pub fn watch(&mut self, app: AppHandle, file: &Path) {
        if self.target.as_deref() == Some(file) {
            return;
        }

        // Dropping the previous watcher unregisters it and lets its thread end.
        self.inner = None;
        self.target = Some(file.to_path_buf());

        let Some(dir) = file.parent().map(Path::to_path_buf) else {
            return;
        };

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let Ok(mut watcher) = RecommendedWatcher::new(tx, notify::Config::default()) else {
            return;
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        let target = file.to_path_buf();
        std::thread::spawn(move || {
            let mut last = Instant::now() - DEBOUNCE;
            for event in rx {
                let Ok(event) = event else { continue };
                if !matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                ) {
                    continue;
                }
                if !event.paths.iter().any(|p| same_file(p, &target)) {
                    continue;
                }
                if last.elapsed() < DEBOUNCE {
                    continue;
                }
                last = Instant::now();

                // A rename-over-original briefly leaves nothing at the path.
                std::thread::sleep(Duration::from_millis(30));
                if target.exists() {
                    let _ = app.emit("document-changed", target.to_string_lossy());
                }
            }
        });

        self.inner = Some(watcher);
    }
}

/// Compare canonical paths where possible so `/tmp` vs `/private/tmp` on macOS
/// does not cause a miss, falling back to a literal comparison when the file is
/// mid-replacement and cannot be canonicalized.
fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b || a.file_name() == b.file_name(),
    }
}
