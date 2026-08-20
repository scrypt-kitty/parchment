//! Serves images referenced by the open document over a private `mdasset://`
//! scheme.
//!
//! Tauri's built-in asset protocol is scoped through config globs, which would
//! have to be widened to "anywhere the user might keep a file". This protocol
//! instead resolves every request against the directory of the document that is
//! currently open and refuses anything that escapes it, so a document can only
//! ever reach its own neighbours.

use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext};

use crate::AppState;

pub fn serve<R: tauri::Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match resolve(ctx.app_handle(), request.uri().path()) {
        Some(path) => match std::fs::read(&path) {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime_for(&path))
                .header("Cache-Control", "no-cache")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes)
                .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR)),
            Err(_) => empty(StatusCode::NOT_FOUND),
        },
        None => empty(StatusCode::FORBIDDEN),
    }
}

/// Returns the file only when it genuinely sits inside the open document's
/// directory. Both sides are canonicalized first so `../` and symlinks cannot
/// be used to climb out.
fn resolve<R: tauri::Runtime>(app: &tauri::AppHandle<R>, uri_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode_str(uri_path.trim_start_matches('/'))
        .decode_utf8()
        .ok()?;
    if decoded.is_empty() {
        return None;
    }

    let requested = PathBuf::from(decoded.as_ref()).canonicalize().ok()?;
    if !requested.is_file() {
        return None;
    }

    let root = app
        .state::<AppState>()
        .doc_dir
        .lock()
        .ok()?
        .clone()?
        .canonicalize()
        .ok()?;

    requested.starts_with(&root).then_some(requested)
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("static response always builds")
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}
