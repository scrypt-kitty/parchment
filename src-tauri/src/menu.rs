//! Native menu bar. Every custom item just forwards its id to the webview as a
//! `menu-action` event; all behaviour lives in the frontend so there is one
//! place to look for what a command does.

use tauri::menu::{
    AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Runtime};

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let item = |id: &str, label: &str, accel: &str| {
        MenuItemBuilder::with_id(id, label)
            .accelerator(accel)
            .build(app)
    };

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
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

    // Platform-specific submenus, each bound behind its own cfg.
    #[cfg(target_os = "macos")]
    let app_menu = {
        let about = AboutMetadata {
            name: Some("Parchment".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            comments: Some("A fast, private, open-source Markdown viewer.".into()),
            license: Some("GPL-3.0-or-later".into()),
            website: Some(env!("CARGO_PKG_REPOSITORY").into()),
            ..Default::default()
        };
        SubmenuBuilder::new(app, "Parchment")
            .item(&PredefinedMenuItem::about(
                app,
                Some("About Parchment"),
                Some(about),
            )?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, Some("Hide Parchment"))?)
            .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
            .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, Some("Quit Parchment"))?)
            .build()?
    };

    #[cfg(target_os = "macos")]
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, Some("Minimize"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let help = {
        let about = AboutMetadata {
            name: Some("Parchment".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            license: Some("GPL-3.0-or-later".into()),
            ..Default::default()
        };
        SubmenuBuilder::new(app, "Help")
            .item(&PredefinedMenuItem::about(
                app,
                Some("About Parchment"),
                Some(about),
            )?)
            .build()?
    };

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
