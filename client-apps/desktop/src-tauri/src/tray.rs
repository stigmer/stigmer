use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::sidecar;

const TRAY_ID: &str = "stigmer-tray";

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = build_menu(app.handle(), &[])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .tooltip("Stigmer — Idle")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "check_updates" => {
                show_main_window(app);
                let _ = app.emit("check-for-update", ());
            }
            "stop_all" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    sidecar::stop_all_managed(&handle).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Rebuilds the tray menu and tooltip to reflect current runner state.
/// Uses a non-blocking lock on ProcessManager — skips the update if contended,
/// since the next runner state change will trigger another refresh.
pub fn refresh_tray_state(app: &AppHandle) {
    let mgr = app.state::<sidecar::ProcessManager>();
    let names = mgr.runner_names().unwrap_or_default();

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    let tooltip = if names.is_empty() {
        "Stigmer — Idle".to_string()
    } else {
        let count = names.len();
        format!(
            "Stigmer — {} runner{} active",
            count,
            if count == 1 { "" } else { "s" }
        )
    };
    let _ = tray.set_tooltip(Some(&tooltip));

    if let Ok(menu) = build_menu(app, &names) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(app: &AppHandle, runner_names: &[String]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;

    if runner_names.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            "status",
            "No active runners",
            false,
            None::<&str>,
        )?)?;
    } else {
        for name in runner_names {
            menu.append(&MenuItem::with_id(
                app,
                format!("runner:{name}"),
                format!("{name} — Running"),
                false,
                None::<&str>,
            )?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(
            app,
            "stop_all",
            "Stop All Runners",
            true,
            None::<&str>,
        )?)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
