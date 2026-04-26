use tauri::image::Image;
use tauri::menu::{AboutMetadata, Menu, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Wry};

/// Menu item ID for "Check for Updates…" — shared with the tray menu's event.
const CHECK_UPDATES_ID: &str = "menu_check_updates";

/// Tauri event name consumed by `useAppUpdater` on the frontend.
const CHECK_FOR_UPDATE_EVENT: &str = "check-for-update";

/// Builds and installs the native app menu bar.
///
/// On macOS, the first submenu becomes the bold application menu (the one to
/// the right of the Apple logo). Naming it "Stigmer" ensures the About dialog
/// and all menu items display the correct product name regardless of the Cargo
/// binary name.
pub fn setup_app_menu(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let menu = build_app_menu(handle)?;
    app.set_menu(menu)?;
    Ok(())
}

/// Handles click events from the app menu bar.
pub fn handle_menu_event(app: &AppHandle, event: &tauri::menu::MenuEvent) {
    if event.id().as_ref() == CHECK_UPDATES_ID {
        let _ = app.emit(CHECK_FOR_UPDATE_EVENT, ());
    }
}

fn build_app_menu(handle: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let version = handle.config().version.clone();

    let about_metadata = AboutMetadata {
        name: Some("Stigmer".into()),
        version,
        copyright: Some("\u{00a9} 2026 Stigmer. All rights reserved.".into()),
        icon: Some(Image::from_bytes(include_bytes!("../icons/icon.png"))?),
        ..Default::default()
    };

    let app_submenu = SubmenuBuilder::new(handle, "Stigmer")
        .about(Some(about_metadata))
        .separator()
        .item(&MenuItem::with_id(
            handle,
            CHECK_UPDATES_ID,
            "Check for Updates\u{2026}",
            true,
            None::<&str>,
        )?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_submenu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_submenu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    Menu::with_items(handle, &[&app_submenu, &edit_submenu, &window_submenu])
}
