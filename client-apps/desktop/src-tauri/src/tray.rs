use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Wry};

use crate::window::bring_forward;

const TRAY_ID: &str = "stigmer-tray";

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = build_menu(app.handle())?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?)
        .icon_as_template(true)
        .tooltip("Stigmer")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => bring_forward(app),
            "check_updates" => {
                bring_forward(app);
                let _ = app.emit("check-for-update", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;

    menu.append(&MenuItem::with_id(
        app,
        "open",
        "Open Stigmer",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "check_updates",
        "Check for Updates\u{2026}",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        "Quit Stigmer",
        true,
        None::<&str>,
    )?)?;

    Ok(menu)
}
