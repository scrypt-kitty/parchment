//! Native menu bar. Every custom item just forwards its id to the webview as a
//! `menu-action` event; all behaviour lives in the frontend so there is one
//! place to look for what a command does.
//!
//! The menu is rebuilt wholesale whenever the recent-files list or the
//! auto-update toggle changes. Holding on to individual item handles would mean
//! threading the runtime generic through application state for no real gain —
//! rebuilding a menu of this size is cheap.

use tauri::menu::{
    AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Runtime};

use crate::RecentFile;

pub fn install<R: Runtime>(
    app: &AppHandle<R>,
    recent: &[RecentFile],
    auto_update: bool,
) -> tauri::Result<()> {
    let item = |id: &str, label: &str, accel: &str| {
        MenuItemBuilder::with_id(id, label)
            .accelerator(accel)
            .build(app)
    };

    // Ids carry the path itself rather than an index, so the menu cannot drift
    // out of step with the list the frontend holds.
    let mut open_recent = SubmenuBuilder::new(app, "Open Recent");
    if recent.is_empty() {
        open_recent = open_recent.item(
            &MenuItemBuilder::with_id("recent-none", "No Recent Documents")
                .enabled(false)
                .build(app)?,
        );
    } else {
        for entry in recent.iter().take(12) {
            open_recent = open_recent.item(
                &MenuItemBuilder::with_id(format!("recent:{}", entry.path), &entry.name)
                    .build(app)?,
            );
        }
        open_recent = open_recent
            .separator()
            .item(&MenuItemBuilder::with_id("clear-recent", "Clear Menu").build(app)?);
    }
    let open_recent = open_recent.build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
        .item(&open_recent)
        .item(&item("reload", "Reload from Disk", "CmdOrCtrl+R")?)
        .separator()
        .item(&item(
            "export-html",
            "Export as HTML…",
            "CmdOrCtrl+Shift+E",
        )?)
        .item(&item("print", "Print…", "CmdOrCtrl+P")?)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            app,
            Some("Close Window"),
        )?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .separator()
        .item(&item("find", "Find…", "CmdOrCtrl+F")?)
        .item(&item("find-next", "Find Next", "CmdOrCtrl+G")?)
        .item(&item(
            "find-previous",
            "Find Previous",
            "CmdOrCtrl+Shift+G",
        )?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("zoom-in", "Zoom In", "CmdOrCtrl+=")?)
        .item(&item("zoom-out", "Zoom Out", "CmdOrCtrl+-")?)
        .item(&item("zoom-reset", "Actual Size", "CmdOrCtrl+0")?)
        .separator()
        .item(&item("toggle-toc", "Table of Contents", "CmdOrCtrl+\\")?)
        .item(&item(
            "toggle-theme",
            "Switch Appearance",
            "CmdOrCtrl+Shift+L",
        )?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some("Enter Full Screen"),
        )?)
        .build()?;

    let check_now = MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?;
    let check_auto =
        CheckMenuItemBuilder::with_id("toggle-auto-update", "Check for Updates Automatically")
            .checked(auto_update)
            .build(app)?;

    let about = |extended: bool| AboutMetadata {
        name: Some("Parchment".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        comments: extended.then(|| "A fast, private, open-source Markdown viewer.".into()),
        license: Some("GPL-3.0-or-later".into()),
        website: Some(env!("CARGO_PKG_REPOSITORY").into()),
        ..Default::default()
    };

    // Platform-specific submenus, each bound behind its own cfg.
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "Parchment")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Parchment"),
            Some(about(true)),
        )?)
        .separator()
        .item(&check_now)
        .item(&check_auto)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Parchment"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Parchment"))?)
        .build()?;

    #[cfg(target_os = "macos")]
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, Some("Minimize"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let help = SubmenuBuilder::new(app, "Help")
        .item(&check_now)
        .item(&check_auto)
        .separator()
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Parchment"),
            Some(about(false)),
        )?)
        .build()?;

    // Rebinding by shadowing rather than mutating: a `mut` builder would sit
    // unmutated wherever the cfg'd branches are compiled out (`unused_mut` on
    // Windows and Linux), and a Vec of pushes trips `vec_init_then_push`.
    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = menu.item(&app_menu);
    let menu = menu.item(&file).item(&edit).item(&view);
    #[cfg(target_os = "macos")]
    let menu = menu.item(&window);
    #[cfg(not(target_os = "macos"))]
    let menu = menu.item(&help);

    app.set_menu(menu.build()?)?;

    app.on_menu_event(|app, event| {
        let _ = app.emit("menu-action", event.id().0.as_str());
    });

    Ok(())
}
