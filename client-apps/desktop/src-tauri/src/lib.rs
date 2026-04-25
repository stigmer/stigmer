mod auth;
mod sidecar;
mod tray;

use sidecar::ProcessManager;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub fn run() {
    let mut builder = tauri::Builder::default();

    builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
        // Deep link URLs are forwarded automatically via the deep-link
        // feature flag — no manual argv parsing needed here.
    }));

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(ProcessManager::new())
        .invoke_handler(tauri::generate_handler![
            auth::open_auth_window,
            auth::close_auth_overlay,
            sidecar::start_runner,
            sidecar::stop_runner,
            sidecar::stop_all_runners,
            sidecar::list_local_runners,
            sidecar::get_runner_logs,
        ])
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            tray::setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Stigmer Desktop");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        RunEvent::ExitRequested { .. } => {
            let _ = app_handle.save_window_state(StateFlags::all());
            let mgr = app_handle.state::<ProcessManager>();
            mgr.shutdown_all_sync();
        }
        _ => {}
    });
}
