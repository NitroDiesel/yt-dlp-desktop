use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use tauri::State;

use crate::{
    application::{AppService, validate_downloaded_file},
    domain::{
        AppSettings, AppSnapshot, DependencyInfo, DownloadJob, DownloadRequest,
        HardwareAccelerationInfo, MediaProbe,
    },
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
    no_playlist: Option<bool>,
) -> AppResult<MediaProbe> {
    service.probe_media(url, no_playlist.unwrap_or(false)).await
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
) -> AppResult<Vec<DownloadJob>> {
    if !matches!(direction.as_str(), "up" | "down") {
        return Err(AppError::Validation("Invalid queue direction".into()));
    }
    service.db.reorder(&job_id, &direction).await?;
    service.db.queue().await
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
pub async fn remember_download_directory(
    service: State<'_, Arc<AppService>>,
    directory: String,
) -> AppResult<AppSettings> {
    service
        .inner()
        .clone()
        .remember_download_directory(directory)
        .await
}
#[tauri::command]
pub async fn refresh_dependencies(
    service: State<'_, Arc<AppService>>,
) -> AppResult<Vec<DependencyInfo>> {
    Ok(service.dependencies().await)
}
#[tauri::command]
pub async fn update_engine(service: State<'_, Arc<AppService>>) -> AppResult<Vec<DependencyInfo>> {
    service.update_engine().await
}
#[tauri::command]
pub async fn refresh_hardware_acceleration(
    service: State<'_, Arc<AppService>>,
    force: Option<bool>,
) -> AppResult<HardwareAccelerationInfo> {
    Ok(service.hardware_acceleration(force.unwrap_or(true)).await)
}
#[tauri::command]
pub async fn remove_history_entry(
    service: State<'_, Arc<AppService>>,
    job_id: String,
) -> AppResult<()> {
    service.db.remove_history(&job_id).await
}
/// Moves a completed download's file to the Recycle Bin or Trash before its entry
/// is removed. A file that is already gone counts as done.
#[tauri::command]
pub async fn trash_job_output(
    service: State<'_, Arc<AppService>>,
    job_id: String,
) -> AppResult<()> {
    let job = service.db.job(&job_id).await?;
    match trashable_output(&job).await? {
        Some(path) => platform::move_to_trash(path).await,
        None => Ok(()),
    }
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
    platform::open_path(containing_directory(&path)?).await
}

fn containing_directory(path: &Path) -> AppResult<&Path> {
    path.parent()
        .filter(|directory| !directory.as_os_str().is_empty())
        .ok_or_else(|| AppError::Validation("The download folder is unavailable".into()))
}

async fn validated_output(service: &Arc<AppService>, job_id: &str) -> AppResult<PathBuf> {
    let job = service.db.job(job_id).await?;
    let output = recorded_output(&job)?;
    validate_downloaded_file(&job.request.destination, &output).await
}

fn recorded_output(job: &DownloadJob) -> AppResult<PathBuf> {
    if job.status != crate::domain::JobStatus::Completed {
        return Err(AppError::Validation(
            "Only completed downloads can be opened".into(),
        ));
    }
    job.output_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Validation("This job has no recorded output file".into()))
}

/// The file that removing `job` together with its file may delete, or None when it
/// is already gone. A playlist records only one of its files, so it is refused.
async fn trashable_output(job: &DownloadJob) -> AppResult<Option<PathBuf>> {
    if job.request.is_playlist {
        return Err(AppError::Validation(
            "Delete a playlist's files from its folder".into(),
        ));
    }
    let output = recorded_output(job)?;
    if !tokio::fs::try_exists(&output).await.unwrap_or(false) {
        return Ok(None);
    }
    validate_downloaded_file(&job.request.destination, &output)
        .await
        .map(Some)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{containing_directory, trashable_output};
    use crate::domain::{DownloadJob, DownloadRequest, JobStatus};

    fn completed_job(destination: &Path, output: &Path) -> DownloadJob {
        DownloadJob {
            id: "job-1".into(),
            request: DownloadRequest {
                url: "https://example.com/video".into(),
                destination: destination.to_string_lossy().into_owned(),
                filename_template: "%(title)s.%(ext)s".into(),
                is_playlist: false,
                options: Default::default(),
            },
            title: None,
            status: JobStatus::Completed,
            progress: Default::default(),
            created_at: "2026-10-10T00:00:00Z".into(),
            started_at: None,
            finished_at: None,
            output_path: Some(output.to_string_lossy().into_owned()),
            error_category: None,
            error_message: None,
            diagnostics: vec![],
        }
    }

    #[tokio::test]
    async fn only_a_completed_single_download_inside_its_folder_can_be_deleted() {
        let downloads = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let file = downloads.path().join("video.mp4");
        std::fs::write(&file, b"media").unwrap();
        let outside = elsewhere.path().join("other.mp4");
        std::fs::write(&outside, b"media").unwrap();

        let job = completed_job(downloads.path(), &file);
        assert_eq!(
            trashable_output(&job).await.unwrap(),
            Some(std::fs::canonicalize(&file).unwrap())
        );

        let mut failed = job.clone();
        failed.status = JobStatus::Failed;
        assert!(trashable_output(&failed).await.is_err());

        let mut playlist = job.clone();
        playlist.request.is_playlist = true;
        assert!(trashable_output(&playlist).await.is_err());

        assert!(
            trashable_output(&completed_job(downloads.path(), &outside))
                .await
                .is_err()
        );

        std::fs::remove_file(&file).unwrap();
        assert_eq!(trashable_output(&job).await.unwrap(), None);
    }

    #[test]
    fn show_in_folder_targets_the_downloaded_files_parent() {
        let directory = PathBuf::from("downloads").join("music");
        let output = directory.join("track.mp3");

        assert_eq!(containing_directory(&output).unwrap(), directory);
        assert!(containing_directory(Path::new("track.mp3")).is_err());
    }
}
