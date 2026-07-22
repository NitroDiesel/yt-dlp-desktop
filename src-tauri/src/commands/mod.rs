use std::{path::PathBuf, sync::Arc};

use tauri::State;

use crate::{
    application::AppService,
    domain::{AppSettings, AppSnapshot, DependencyInfo, DownloadJob, DownloadRequest, MediaProbe},
    error::{AppError, AppResult},
    platform,
};

#[tauri::command]
pub async fn initialize_app(service: State<'_, Arc<AppService>>) -> AppResult<AppSnapshot> {
    service.snapshot().await
}
#[tauri::command]
pub async fn probe_media(
    service: State<'_, Arc<AppService>>,
    url: String,
) -> AppResult<MediaProbe> {
    service.probe_media(url).await
}
#[tauri::command]
pub async fn cancel_probe(service: State<'_, Arc<AppService>>) -> AppResult<()> {
    service.cancel_probe().await;
    Ok(())
}
#[tauri::command]
pub async fn enqueue_download(
    service: State<'_, Arc<AppService>>,
    request: DownloadRequest,
    start_immediately: bool,
) -> AppResult<DownloadJob> {
    service
        .inner()
        .clone()
        .enqueue(request, start_immediately)
        .await
}
#[tauri::command]
pub async fn cancel_job(service: State<'_, Arc<AppService>>, job_id: String) -> AppResult<()> {
    service.cancel_job(&job_id).await
}
#[tauri::command]
pub async fn retry_job(
    service: State<'_, Arc<AppService>>,
    job_id: String,
) -> AppResult<DownloadJob> {
    service.inner().clone().retry(&job_id).await
}
#[tauri::command]
pub async fn remove_queue_job(
    service: State<'_, Arc<AppService>>,
    job_id: String,
) -> AppResult<()> {
    service.db.hide_job(&job_id).await
}
#[tauri::command]
pub async fn clear_completed_jobs(service: State<'_, Arc<AppService>>) -> AppResult<()> {
    service.db.clear_completed().await
}
#[tauri::command]
pub async fn reorder_job(
    service: State<'_, Arc<AppService>>,
    job_id: String,
    direction: String,
) -> AppResult<()> {
    if !matches!(direction.as_str(), "up" | "down") {
        return Err(AppError::Validation("Invalid queue direction".into()));
    }
    service.db.reorder(&job_id, &direction).await
}
#[tauri::command]
pub async fn set_queue_paused(service: State<'_, Arc<AppService>>, paused: bool) -> AppResult<()> {
    service.inner().clone().set_paused(paused).await
}
#[tauri::command]
pub async fn save_settings(
    service: State<'_, Arc<AppService>>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    service.inner().clone().save_settings(settings).await
}
#[tauri::command]
pub async fn refresh_dependencies(
    service: State<'_, Arc<AppService>>,
) -> AppResult<Vec<DependencyInfo>> {
    Ok(service.dependencies().await)
}
#[tauri::command]
pub async fn remove_history_entry(
    service: State<'_, Arc<AppService>>,
    job_id: String,
) -> AppResult<()> {
    service.db.remove_history(&job_id).await
}
#[tauri::command]
pub async fn open_job_output(service: State<'_, Arc<AppService>>, job_id: String) -> AppResult<()> {
    let path = validated_output(&service, &job_id).await?;
    platform::open_path(&path).await
}
#[tauri::command]
pub async fn reveal_job_output(
    service: State<'_, Arc<AppService>>,
    job_id: String,
) -> AppResult<()> {
    let path = validated_output(&service, &job_id).await?;
    platform::reveal_path(&path).await
}

async fn validated_output(service: &Arc<AppService>, job_id: &str) -> AppResult<PathBuf> {
    let job = service.db.job(job_id).await?;
    if job.status != crate::domain::JobStatus::Completed {
        return Err(AppError::Validation(
            "Only completed downloads can be opened".into(),
        ));
    }
    job.output_path
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Validation("This job has no recorded output file".into()))
}
