mod auth;
mod sidecar;
mod tray;

use auth::{AuthCallbackPayload, param};
use sidecar::ProcessManager;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

pub fn run() {
    let mut builder = tauri::Builder::default();

    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .manage(ProcessManager::new())
        .invoke_handler(tauri::generate_handler![
            auth::open_auth_in_browser,
            auth::cancel_auth,
            auth::start_auth_callback_server,
            sidecar::start_runner,
            sidecar::stop_runner,
            sidecar::stop_all_runners,
            sidecar::list_local_runners,
            sidecar::get_runner_logs,
        ])
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                app.deep_link().register_all()?;
            }

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for raw in event.urls() {
                    if raw.scheme() == "stigmer"
                        && raw.host_str() == Some("auth")
                        && raw.path() == "/callback"
                    {
                        let payload = AuthCallbackPayload {
                            code: param(&raw, "code"),
                            state: param(&raw, "state"),
                            error: param(&raw, "error"),
                            error_description: param(&raw, "error_description"),
                        };
                        let _ = handle.emit("auth-callback", payload);

                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            });

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
