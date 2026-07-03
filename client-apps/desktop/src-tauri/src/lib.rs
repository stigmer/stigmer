mod auth;
mod menu;
mod runner;
mod tray;
mod workspace;

use auth::{AuthCallbackPayload, param};
use runner::RunnerState;
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
        .manage(RunnerState::new())
        .invoke_handler(tauri::generate_handler![
            auth::open_auth_in_browser,
            auth::cancel_auth,
            auth::start_auth_callback_server,
            auth::start_github_callback_server,
            runner::start_runner,
            runner::stop_runner,
            runner::kill_runner,
            runner::add_session,
            runner::remove_session,
            runner::add_workflow_execution,
            runner::remove_workflow_execution,
            runner::update_runner_token,
            runner::runner_status,
            workspace::list_workspace_files,
            workspace::read_workspace_file,
        ])
        .on_menu_event(|app, event| menu::handle_menu_event(app, &event))
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                app.deep_link().register_all()?;
            }

            // Fallback: guarantee the window becomes visible even if the
            // frontend JS fails to call show() (e.g. WebView load error).
            let show_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                if let Some(window) = show_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for raw in event.urls() {
                    let is_auth = raw.scheme() == "stigmer"
                        && raw.host_str() == Some("auth")
                        && raw.path() == "/callback";

                    let is_github = raw.scheme() == "stigmer"
                        && raw.host_str() == Some("github")
                        && raw.path() == "/callback";

                    if is_auth || is_github {
                        let payload = AuthCallbackPayload {
                            code: param(&raw, "code"),
                            state: param(&raw, "state"),
                            error: param(&raw, "error"),
                            error_description: param(&raw, "error_description"),
                        };

                        let event_name = if is_github {
                            "github-callback"
                        } else {
                            "auth-callback"
                        };
                        let _ = handle.emit(event_name, payload);

                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            });

            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            menu::setup_app_menu(app)?;
            tray::setup_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Stigmer Desktop");

    let is_dev = cfg!(debug_assertions);

    app.run(move |app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            if is_dev {
                let _ = app_handle.save_window_state(StateFlags::all());
            } else {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        }
        RunEvent::ExitRequested { .. } => {
            let _ = app_handle.save_window_state(StateFlags::all());
        }
        RunEvent::Exit => {
            // Reap the embedded runner before the process exits. Relying on the crate's
            // `kill_on_drop` is only a soft guarantee (the runner's background reader holds an
            // Arc to the child handle), so reap explicitly here (issue #177).
            //
            // Use `kill()`, not `stop()`. `stop()` sends the IPC shutdown and then waits with a
            // `tokio::time::timeout`, but by `RunEvent::Exit` the tokio time driver is no longer
            // pumped, so that timeout can never fire; and a mid-execution runner never acks the
            // shutdown, so `child.wait()` never returns on its own — `block_on(stop())` would
            // park forever (issue #178). `kill()` is timer-free: a synchronous SIGKILL makes the
            // child a zombie at once, so the first `wait()` poll reaps it and returns immediately.
            // Draining in-flight work is pointless at teardown anyway — the UI is gone and results
            // stream to the control plane, not through our pipes.
            tauri::async_runtime::block_on(app_handle.state::<RunnerState>().kill());
        }
        _ => {}
    });
}
