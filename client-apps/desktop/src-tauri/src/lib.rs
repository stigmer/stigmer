mod auth;
mod deep_link;
mod lifecycle;
mod menu;
mod runner;
mod tray;
mod user_path;
mod window;
mod workspace;

use deep_link::DeepLinkEvent;
use lifecycle::{Act, Lifecycle};
use runner::RunnerState;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use user_path::UserPath;
use window::{bring_forward, MAIN_WINDOW};

pub fn run() {
    let mut builder = tauri::Builder::default();

    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        bring_forward(app);
    }));

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notifications::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .manage(RunnerState::new())
        .manage(UserPath::resolve_in_background())
        .invoke_handler(tauri::generate_handler![
            auth::open_auth_in_browser,
            auth::cancel_auth,
            auth::start_auth_callback_server,
            auth::start_sign_in_callback_server,
            runner::start_runner,
            runner::stop_runner,
            runner::kill_runner,
            runner::add_session,
            runner::remove_session,
            runner::update_runner_token,
            runner::runner_status,
            runner::bundled_node_path,
            user_path::user_tool_path,
            window::show_main_window,
            workspace::list_workspace_files,
            workspace::read_workspace_file,
            workspace::search_workspace_content,
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
                bring_forward(&show_handle);
            });

            // Each stigmer:// URL becomes at most one app event (deep_link.rs
            // decides which); the window comes forward for any it serves.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for raw in event.urls() {
                    let Some(routed) = deep_link::route(&raw) else {
                        continue;
                    };
                    let name = routed.name();
                    let _ = match routed {
                        DeepLinkEvent::AuthCallback(payload)
                        | DeepLinkEvent::SignInCallback(payload) => handle.emit(name, payload),
                        DeepLinkEvent::BillingReturn(payload) => handle.emit(name, payload),
                    };
                    bring_forward(&handle);
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

    app.run(move |app_handle, event| {
        let Some(lifecycle) = Lifecycle::of(&event) else {
            return;
        };
        let close_api = match &event {
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => Some(api),
            _ => None,
        };
        for act in lifecycle::decide(lifecycle, is_dev) {
            match act {
                Act::SaveWindowState => {
                    let _ = app_handle.save_window_state(StateFlags::all());
                }
                Act::PreventClose => {
                    if let Some(api) = close_api {
                        api.prevent_close();
                    }
                }
                Act::HideMainWindow => hide_main_window(app_handle),
                Act::BringForward => bring_forward(app_handle),
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
                Act::KillRunner => {
                    tauri::async_runtime::block_on(app_handle.state::<RunnerState>().kill());
                }
            }
        }
    });
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
}
