mod sidecar;

use sidecar::ProcessManager;
use tauri::{Manager, RunEvent};

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
        .build(tauri::generate_context!())
        .expect("error while building Stigmer Desktop");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = &event {
            let mgr = app_handle.state::<ProcessManager>();
            mgr.shutdown_all_sync();
        }
    });
}
