use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use chrono::Utc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    domain::{
        AppSettings, AppSnapshot, DependencyInfo, DownloadJob, DownloadProgress, DownloadRequest,
        JobStatus, MediaProbe,
    },
    error::{AppError, AppResult},
    integration::{
        dependencies::DependencyManager,
        yt_dlp::{RunnerEvent, build_download_args, probe, run_download},
    },
    persistence::Database,
};

pub struct AppService {
    pub db: Database,
    dependencies: DependencyManager,
    settings: RwLock<AppSettings>,
    app: AppHandle,
    queue_paused: AtomicBool,
    running: Mutex<HashMap<String, CancellationToken>>,
    scheduler: Mutex<()>,
    probe_cancel: Mutex<Option<CancellationToken>>,
}

impl AppService {
    pub async fn new(app: AppHandle, data_dir: PathBuf) -> AppResult<Arc<Self>> {
        let db = Database::connect(&data_dir.join("workspace.sqlite3")).await?;
        db.recover_interrupted().await?;
        let settings = db.settings().await?;
        Ok(Arc::new(Self {
            db,
            dependencies: DependencyManager::new(
                data_dir.join("components"),
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(PathBuf::from))
                    .unwrap_or_default(),
            ),
            settings: RwLock::new(settings),
            app,
            queue_paused: AtomicBool::new(false),
            running: Mutex::new(HashMap::new()),
            scheduler: Mutex::new(()),
            probe_cancel: Mutex::new(None),
        }))
    }

    pub async fn snapshot(&self) -> AppResult<AppSnapshot> {
        let settings = self.settings.read().await.clone();
        let dependencies = self.dependencies.inspect_all(&settings).await;
        Ok(AppSnapshot {
            settings,
            queue: self.db.queue().await?,
            history: self.db.history().await?,
            dependencies,
            queue_paused: self.queue_paused.load(Ordering::SeqCst),
        })
    }

    pub async fn start(self: &Arc<Self>) -> AppResult<()> {
        self.clone().schedule().await
    }

    pub async fn probe_media(&self, url: String) -> AppResult<MediaProbe> {
        let settings = self.settings.read().await.clone();
        let executable = self.dependencies.resolve_yt_dlp(&settings).ok_or_else(|| {
            AppError::DependencyMissing(
                "yt-dlp. Choose it in Settings before analyzing a link".into(),
            )
        })?;
        let token = CancellationToken::new();
        {
            let mut current = self.probe_cancel.lock().await;
            if let Some(previous) = current.replace(token.clone()) {
                previous.cancel();
            }
        }
        let deno = self.dependencies.resolve_deno(&settings);
        let result = probe(&executable, deno.as_deref(), &url, token).await;
        self.probe_cancel.lock().await.take();
        result
    }
    pub async fn cancel_probe(&self) {
        if let Some(token) = self.probe_cancel.lock().await.take() {
            token.cancel();
        }
    }

    pub async fn enqueue(
        self: &Arc<Self>,
        request: DownloadRequest,
        start_immediately: bool,
    ) -> AppResult<DownloadJob> {
        let mut settings = self.settings.read().await.clone();
        if settings.deno_path.is_none() {
            settings.deno_path = self
                .dependencies
                .resolve_deno(&settings)
                .map(|path| path.to_string_lossy().into_owned());
        }
        if settings.ffmpeg_path.is_none() {
            settings.ffmpeg_path = self
                .dependencies
                .resolve_ffmpeg(&settings)
                .map(|path| path.to_string_lossy().into_owned());
        }
        let needs_ffmpeg = (request.options.mode == crate::domain::MediaMode::Audio
            && request.options.audio_format != "best")
            || request.options.embed_subtitles;
        if needs_ffmpeg && settings.ffmpeg_path.is_none() {
            return Err(AppError::DependencyMissing(
                "FFmpeg is required for conversion or embedded subtitles. Choose source audio or configure FFmpeg in Settings.".into(),
            ));
        }
        let _ = build_download_args(&request, &settings)?;
        let job = DownloadJob {
            id: Uuid::new_v4().to_string(),
            request,
            title: None,
            status: JobStatus::Queued,
            progress: DownloadProgress::default(),
            created_at: Utc::now().to_rfc3339(),
            started_at: None,
            finished_at: None,
            output_path: None,
            error_category: None,
            error_message: None,
            diagnostics: vec![],
        };
        let position = if start_immediately {
            -1
        } else {
            self.db.next_position().await?
        };
        self.db.insert_job(&job, position).await?;
        self.clone().schedule().await?;
        Ok(job)
    }

    fn schedule(self: Arc<Self>) -> Pin<Box<dyn Future<Output = AppResult<()>> + Send>> {
        Box::pin(async move {
            let _guard = self.scheduler.lock().await;
            if self.queue_paused.load(Ordering::SeqCst) {
                return Ok(());
            }
            let concurrency = self.settings.read().await.queue_concurrency.clamp(1, 4) as usize;
            let running_count = self.running.lock().await.len();
            if running_count >= concurrency {
                return Ok(());
            }
            let slots = concurrency - running_count;
            let jobs = self
                .db
                .queue()
                .await?
                .into_iter()
                .filter(|job| job.status == JobStatus::Queued)
                .take(slots)
                .collect::<Vec<_>>();
            for mut job in jobs {
                job.status = JobStatus::Downloading;
                job.started_at = Some(Utc::now().to_rfc3339());
                self.db.update_job(&job).await?;
                let token = CancellationToken::new();
                self.running
                    .lock()
                    .await
                    .insert(job.id.clone(), token.clone());
                let service = self.clone();
                tokio::spawn(async move {
                    service.run_job(job, token).await;
                });
            }
            Ok(())
        })
    }

    async fn run_job(self: Arc<Self>, mut job: DownloadJob, cancel: CancellationToken) {
        let mut settings = self.settings.read().await.clone();
        if settings.deno_path.is_none() {
            settings.deno_path = self
                .dependencies
                .resolve_deno(&settings)
                .map(|path| path.to_string_lossy().into_owned());
        }
        if settings.ffmpeg_path.is_none() {
            settings.ffmpeg_path = self
                .dependencies
                .resolve_ffmpeg(&settings)
                .map(|path| path.to_string_lossy().into_owned());
        }
        let executable = self.dependencies.resolve_yt_dlp(&settings);
        let result = match executable {
            Some(executable) => match build_download_args(&job.request, &settings) {
                Ok(args) => {
                    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
                    let runner_cancel = cancel.clone();
                    let runner = tokio::spawn(async move {
                        run_download(&executable, args, runner_cancel, tx).await
                    });
                    while let Some(event) = rx.recv().await {
                        match event {
                            RunnerEvent::Progress(progress) => {
                                job.progress = progress;
                                job.status = JobStatus::Downloading;
                            }
                            RunnerEvent::PostProcess(stage) => {
                                job.status = JobStatus::PostProcessing;
                                job.progress.stage = Some(stage);
                            }
                            RunnerEvent::Output { path, title } => {
                                job.output_path = Some(path);
                                if title.is_some() {
                                    job.title = title;
                                }
                            }
                            RunnerEvent::Diagnostic(line) => {
                                if job.diagnostics.len() >= 100 {
                                    job.diagnostics.remove(0);
                                }
                                job.diagnostics.push(line);
                            }
                        }
                        let _ = self.db.update_job(&job).await;
                        let _ = self.app.emit("download-job-changed", &job);
                    }
                    match runner.await {
                        Ok(value) => value,
                        Err(error) => Err(AppError::Process(error.to_string())),
                    }
                }
                Err(error) => Err(error),
            },
            None => Err(AppError::DependencyMissing("yt-dlp".into())),
        };
        match result {
            Ok(outcome) => {
                job.output_path = outcome.output_path.or(job.output_path);
                job.title = outcome.title.or(job.title);
                job.diagnostics = outcome.diagnostics;
                job.finished_at = Some(Utc::now().to_rfc3339());
                if outcome.cancelled {
                    job.status = JobStatus::Cancelled;
                } else if let Some(category) = outcome.error {
                    job.status = JobStatus::Failed;
                    job.error_category = Some(category);
                    job.error_message = Some(
                        "yt-dlp could not finish this download. Review the details and retry."
                            .into(),
                    );
                } else {
                    job.status = JobStatus::Completed;
                    job.progress.percent = Some(100.0);
                }
            }
            Err(error) => {
                job.status = if cancel.is_cancelled() {
                    JobStatus::Cancelled
                } else {
                    JobStatus::Failed
                };
                job.finished_at = Some(Utc::now().to_rfc3339());
                job.error_category = Some(
                    if matches!(error, AppError::DependencyMissing(_)) {
                        "dependency_missing"
                    } else {
                        "download_failed"
                    }
                    .into(),
                );
                job.error_message = Some(error.to_string());
            }
        }
        let _ = self.db.update_job(&job).await;
        let _ = self.app.emit("download-job-changed", &job);
        self.running.lock().await.remove(&job.id);
        let _ = self.clone().schedule().await;
    }

    pub async fn cancel_job(&self, id: &str) -> AppResult<()> {
        if let Some(token) = self.running.lock().await.get(id) {
            token.cancel();
            return Ok(());
        }
        let mut job = self.db.job(id).await?;
        if job.status == JobStatus::Queued {
            job.status = JobStatus::Cancelled;
            job.finished_at = Some(Utc::now().to_rfc3339());
            self.db.update_job(&job).await?;
            let _ = self.app.emit("download-job-changed", &job);
        }
        Ok(())
    }
    pub async fn retry(self: &Arc<Self>, id: &str) -> AppResult<DownloadJob> {
        let original = self.db.job(id).await?;
        if !matches!(
            original.status,
            JobStatus::Failed | JobStatus::Cancelled | JobStatus::Interrupted
        ) {
            return Err(AppError::Validation(
                "Only stopped or failed jobs can be retried".into(),
            ));
        }
        self.enqueue(original.request, true).await
    }
    pub async fn set_paused(self: &Arc<Self>, paused: bool) -> AppResult<()> {
        self.queue_paused.store(paused, Ordering::SeqCst);
        if !paused {
            self.clone().schedule().await?
        }
        Ok(())
    }
    pub async fn save_settings(self: &Arc<Self>, settings: AppSettings) -> AppResult<AppSettings> {
        validate_settings(&settings)?;
        self.db.save_settings(&settings).await?;
        *self.settings.write().await = settings.clone();
        self.clone().schedule().await?;
        Ok(settings)
    }
    pub async fn dependencies(&self) -> Vec<DependencyInfo> {
        let settings = self.settings.read().await.clone();
        self.dependencies.inspect_all(&settings).await
    }
}

fn validate_settings(settings: &AppSettings) -> AppResult<()> {
    if !(1..=4).contains(&settings.queue_concurrency) {
        return Err(AppError::Validation(
            "Queue concurrency must be between 1 and 4".into(),
        ));
    }
    if !matches!(settings.theme.as_str(), "system" | "light" | "dark") {
        return Err(AppError::Validation("Choose a supported theme".into()));
    }
    if settings.filename_template.contains('/')
        || settings.filename_template.contains('\\')
        || settings.filename_template.trim().is_empty()
    {
        return Err(AppError::Validation(
            "The filename template must be a filename, not a path".into(),
        ));
    }
    if let Some(proxy) = settings.proxy.as_deref().filter(|value| !value.is_empty()) {
        let parsed = url::Url::parse(proxy)
            .map_err(|_| AppError::Validation("Enter a valid proxy URL".into()))?;
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(AppError::Validation(
                "Proxy credentials are not stored by this release. Use a proxy URL without a username or password.".into(),
            ));
        }
    }
    Ok(())
}
