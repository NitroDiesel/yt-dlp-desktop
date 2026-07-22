mod application;
mod commands;
pub mod domain;
pub mod error;
pub mod integration;
mod persistence;
mod platform;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let service = tauri::async_runtime::block_on(application::AppService::new(
                app.handle().clone(),
                data_dir,
            ))
            .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            tauri::async_runtime::block_on(service.start())
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            app.manage(service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::initialize_app,
            commands::probe_media,
            commands::cancel_probe,
            commands::enqueue_download,
            commands::cancel_job,
            commands::retry_job,
            commands::remove_queue_job,
            commands::clear_completed_jobs,
            commands::reorder_job,
            commands::set_queue_paused,
            commands::save_settings,
            commands::refresh_dependencies,
            commands::remove_history_entry,
            commands::open_job_output,
            commands::reveal_job_output,
        ])
        .run(tauri::generate_context!())
        .expect("error while running yt-dlp Desktop");
}
