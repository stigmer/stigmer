mod sidecar;
mod tray;

use sidecar::ProcessManager;
use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ProcessManager::new())
        .invoke_handler(tauri::generate_handler![
            sidecar::start_runner,
            sidecar::stop_runner,
            sidecar::stop_all_runners,
            sidecar::list_local_runners,
            sidecar::get_runner_logs,
        ])
        .setup(|app| {
            tray::setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Stigmer Desktop");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        RunEvent::ExitRequested { .. } => {
            let mgr = app_handle.state::<ProcessManager>();
            mgr.shutdown_all_sync();
        }
        _ => {}
    });
}
