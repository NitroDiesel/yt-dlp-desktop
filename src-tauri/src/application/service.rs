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
use tokio::{
    sync::{Mutex, RwLock, mpsc::UnboundedReceiver},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    domain::{
        AppSettings, AppSnapshot, DependencyInfo, DownloadJob, DownloadProgress, DownloadRequest,
        HardwareAccelerationInfo, JobStatus, MediaProbe,
    },
    error::{AppError, AppResult},
    integration::{
        dependencies::DependencyManager,
        ffmpeg::run_hardware_conversion,
        yt_dlp::{
            RunnerEvent, build_download_args, needs_ffmpeg, network_args, probe, run_download,
        },
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
    /// Tool version checks spawn processes; they run once and on explicit refresh.
    dependency_cache: RwLock<Option<Vec<DependencyInfo>>>,
    /// GPU detection runs several test encodes, so it is cached per FFmpeg binary
    /// and started only when something needs the answer.
    hardware_cache: RwLock<Option<HardwareCache>>,
    hardware_probe: Mutex<()>,
}

struct HardwareCache {
    ffmpeg: Option<PathBuf>,
    info: HardwareAccelerationInfo,
}

/// Live progress reaches the UI at most four times a second and SQLite every
/// two seconds; status changes and finished files are written immediately.
const EMIT_INTERVAL: Duration = Duration::from_millis(250);
const PERSIST_INTERVAL: Duration = Duration::from_secs(2);

struct JobPublisher {
    persisted_status: JobStatus,
    last_emit: Option<Instant>,
    last_persist: Instant,
    dirty: bool,
}

impl JobPublisher {
    fn new(status: JobStatus, now: Instant) -> Self {
        Self {
            persisted_status: status,
            last_emit: None,
            last_persist: now,
            dirty: false,
        }
    }

    /// Returns `(persist, emit)` for an update observed at `now`.
    fn decide(&mut self, status: &JobStatus, now: Instant, urgent: bool) -> (bool, bool) {
        let urgent = urgent || *status != self.persisted_status;
        let persist = urgent || now.duration_since(self.last_persist) >= PERSIST_INTERVAL;
        let emit = urgent
            || self
                .last_emit
                .is_none_or(|last| now.duration_since(last) >= EMIT_INTERVAL);
        if persist {
            self.persisted_status = status.clone();
            self.last_persist = now;
        }
        if emit {
            self.last_emit = Some(now);
        }
        self.dirty = !emit;
        (persist, emit)
    }

    fn next_emit(&self) -> Instant {
        self.last_emit
            .map_or_else(Instant::now, |last| last + EMIT_INTERVAL)
    }
}

impl AppService {
    pub async fn new(app: AppHandle, data_dir: PathBuf) -> AppResult<Arc<Self>> {
        let db = Database::connect(&data_dir.join("workspace.sqlite3")).await?;
        db.recover_interrupted().await?;
        let mut settings = db.settings().await?;
        if restore_last_download_directory(&mut settings).await {
            db.save_settings(&settings).await?;
        }
        let executable = std::env::current_exe().map_err(|error| {
            AppError::Process(format!("Cannot locate the app executable: {error}"))
        })?;
        let bundled_dir = executable
            .parent()
            .map(PathBuf::from)
            .ok_or_else(|| AppError::Process("Cannot locate the bundled download engine".into()))?;
        Ok(Arc::new(Self {
            db,
            dependencies: DependencyManager::new(bundled_dir),
            settings: RwLock::new(settings),
            app,
            queue_paused: AtomicBool::new(false),
            running: Mutex::new(HashMap::new()),
            scheduler: Mutex::new(()),
            probe_cancel: Mutex::new(None),
            dependency_cache: RwLock::new(None),
            hardware_cache: RwLock::new(None),
            hardware_probe: Mutex::new(()),
        }))
    }

    /// Initial state for the UI. GPU detection is reported as `checking` until
    /// a client asks for it, so launching the app never waits on test encodes.
    pub async fn snapshot(&self) -> AppResult<AppSnapshot> {
        let settings = self.settings.read().await.clone();
        let dependencies =
            cached_or_load(&self.dependency_cache, self.inspect_dependencies()).await;
        let ffmpeg = self.dependencies.resolve_ffmpeg(&settings);
        let hardware_acceleration = self
            .cached_hardware(&ffmpeg)
            .await
            .unwrap_or_else(HardwareAccelerationInfo::checking);
        Ok(AppSnapshot {
            settings,
            queue: self.db.queue().await?,
            history: self.db.history().await?,
            dependencies,
            hardware_acceleration,
            queue_paused: self.queue_paused.load(Ordering::SeqCst),
        })
    }

    async fn cached_hardware(&self, ffmpeg: &Option<PathBuf>) -> Option<HardwareAccelerationInfo> {
        self.hardware_cache
            .read()
            .await
            .as_ref()
            .filter(|cache| &cache.ffmpeg == ffmpeg)
            .map(|cache| cache.info.clone())
    }

    /// Cached GPU capability for the current FFmpeg; `force` re-runs the probe.
    async fn hardware_for(&self, settings: &AppSettings, force: bool) -> HardwareAccelerationInfo {
        let ffmpeg = self.dependencies.resolve_ffmpeg(settings);
        if !force && let Some(info) = self.cached_hardware(&ffmpeg).await {
            return info;
        }
        let _probe = self.hardware_probe.lock().await;
        if !force && let Some(info) = self.cached_hardware(&ffmpeg).await {
            return info;
        }
        let info = self
            .dependencies
            .inspect_hardware_acceleration(settings)
            .await;
        *self.hardware_cache.write().await = Some(HardwareCache {
            ffmpeg,
            info: info.clone(),
        });
        info
    }

    pub async fn start(self: &Arc<Self>) -> AppResult<()> {
        self.clone().schedule().await
    }

    pub async fn probe_media(&self, url: String, no_playlist: bool) -> AppResult<MediaProbe> {
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
        let result = probe(
            &executable,
            deno.as_deref(),
            &url,
            no_playlist,
            network_args(&settings),
            token,
        )
        .await;
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
        let needs_ffmpeg = needs_ffmpeg(&request.options);
        if needs_ffmpeg && settings.ffmpeg_path.is_none() {
            return Err(AppError::DependencyMissing(
                "FFmpeg is required for the selected conversion, chapters, SponsorBlock, or subtitle options. Turn them off or restore FFmpeg in Settings.".into(),
            ));
        }
        if let Some(conversion) = request.options.video_conversion.as_ref() {
            if request.is_playlist {
                return Err(AppError::Validation(
                    "GPU conversion currently supports single-video jobs only".into(),
                ));
            }
            if request.options.mode != crate::domain::MediaMode::Video {
                return Err(AppError::Validation(
                    "GPU conversion is available for video downloads only".into(),
                ));
            }
            validate_video_conversion(conversion)?;
            let capability = self.hardware_for(&settings, false).await;
            let encoder = capability.encoder_for(&conversion.codec);
            if encoder.is_none() {
                return Err(AppError::DependencyMissing(format!(
                    "No working NVENC or AMF encoder is available for {} on this computer",
                    conversion.codec.label()
                )));
            }
            if conversion.use_hardware_decode
                && !encoder.is_some_and(|encoder| encoder.decode_available)
            {
                return Err(AppError::DependencyMissing(
                    "GPU decoding is not available for the automatically selected encoder".into(),
                ));
            }
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
        let mut result = match executable {
            Some(executable) => match build_download_args(&job.request, &settings) {
                Ok(args) => {
                    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
                    let runner_cancel = cancel.clone();
                    let runner = tokio::spawn(async move {
                        run_download(&executable, args, runner_cancel, tx).await
                    });
                    self.relay_events(&mut job, &mut rx, |job, event| match event {
                        RunnerEvent::Progress(progress) => {
                            job.progress = progress;
                            job.status = JobStatus::Downloading;
                            false
                        }
                        RunnerEvent::PostProcess(stage) => {
                            job.status = JobStatus::PostProcessing;
                            job.progress.stage = Some(stage);
                            true
                        }
                        RunnerEvent::Output { path, title } => {
                            job.output_path = Some(path);
                            if title.is_some() {
                                job.title = title;
                            }
                            true
                        }
                        RunnerEvent::Diagnostic(line) => {
                            push_diagnostic(job, line);
                            false
                        }
                    })
                    .await;
                    match runner.await {
                        Ok(value) => value,
                        Err(error) => Err(AppError::Process(error.to_string())),
                    }
                }
                Err(error) => Err(error),
            },
            None => Err(AppError::DependencyMissing("yt-dlp".into())),
        };
        if let Ok(outcome) = &mut result
            && !outcome.cancelled
            && outcome.error.is_none()
        {
            let reported = outcome
                .output_path
                .as_deref()
                .or(job.output_path.as_deref())
                .map(PathBuf::from);
            match reported {
                Some(path) => match validate_downloaded_file(&job.request.destination, &path).await
                {
                    Ok(path) => {
                        let path = path.to_string_lossy().into_owned();
                        outcome.output_path = Some(path.clone());
                        job.output_path = Some(path);
                    }
                    Err(error) => result = Err(error),
                },
                None => {
                    result = Err(AppError::Validation(
                        "yt-dlp did not report a downloaded file inside the selected destination"
                            .into(),
                    ));
                }
            }
        }
        if let (Ok(outcome), Some(conversion)) =
            (&mut result, job.request.options.video_conversion.as_ref())
            && !outcome.cancelled
            && outcome.error.is_none()
        {
            let ffmpeg = self.dependencies.resolve_ffmpeg(&settings);
            let input = outcome.output_path.as_ref().map(PathBuf::from);
            match (ffmpeg, input) {
                (Some(ffmpeg), Some(input)) => {
                    job.status = JobStatus::PostProcessing;
                    job.progress.stage = Some("Automatic GPU conversion".into());
                    let _ = self.db.update_job(&job).await;
                    let _ = self.app.emit("download-job-changed", &job);
                    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
                    let conversion_cancel = cancel.clone();
                    let capability = self.hardware_for(&settings, false).await;
                    if let Some(encoder) = capability.encoder_for(&conversion.codec).cloned() {
                        let conversion_options = conversion.clone();
                        let converter = tokio::spawn(async move {
                            run_hardware_conversion(
                                &ffmpeg,
                                &input,
                                &conversion_options,
                                &encoder,
                                conversion_cancel,
                                tx,
                            )
                            .await
                        });
                        self.relay_events(&mut job, &mut rx, |job, event| {
                            match event {
                                RunnerEvent::Progress(progress) => {
                                    job.progress.stage = progress.stage;
                                    job.status = JobStatus::PostProcessing;
                                }
                                RunnerEvent::Diagnostic(line) => push_diagnostic(job, line),
                                RunnerEvent::Output { .. } | RunnerEvent::PostProcess(_) => {}
                            }
                            false
                        })
                        .await;
                        match converter.await {
                            Ok(Ok(converted)) if converted.cancelled => {
                                outcome.cancelled = true;
                                outcome.diagnostics.extend(converted.diagnostics);
                            }
                            Ok(Ok(converted)) => {
                                outcome.output_path =
                                    Some(converted.output_path.to_string_lossy().into_owned());
                                outcome.diagnostics.extend(converted.diagnostics);
                            }
                            Ok(Err(error)) => result = Err(error),
                            Err(error) => result = Err(AppError::Process(error.to_string())),
                        }
                    } else {
                        result = Err(AppError::DependencyMissing(format!(
                            "No working NVENC or AMF encoder is available for {}",
                            conversion.codec.label()
                        )));
                    }
                }
                _ => {
                    result = Err(AppError::DependencyMissing(
                        "FFmpeg or the downloaded source file is unavailable for GPU conversion"
                            .into(),
                    ));
                }
            }
        }
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
        let mut current = self.settings.write().await;
        self.db.save_settings(&settings).await?;
        let tools_changed = current.yt_dlp_path != settings.yt_dlp_path
            || current.ffmpeg_path != settings.ffmpeg_path
            || current.deno_path != settings.deno_path;
        *current = settings.clone();
        drop(current);
        if tools_changed {
            self.dependency_cache.write().await.take();
        }
        self.clone().schedule().await?;
        Ok(settings)
    }
    pub async fn remember_download_directory(
        self: &Arc<Self>,
        directory: String,
    ) -> AppResult<AppSettings> {
        let directory = directory.trim();
        let path = PathBuf::from(directory);
        if directory.is_empty() || !path.is_absolute() {
            return Err(AppError::Validation(
                "Choose an absolute download folder".into(),
            ));
        }
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|_| AppError::Validation("The selected folder is unavailable".into()))?;
        if !metadata.is_dir() {
            return Err(AppError::Validation(
                "Choose an existing download folder".into(),
            ));
        }

        let mut current = self.settings.write().await;
        let mut settings = current.clone();
        settings.last_download_directory = Some(directory.into());
        settings.legacy_recent_download_directories.clear();
        validate_settings(&settings)?;
        self.db.save_settings(&settings).await?;
        *current = settings.clone();
        Ok(settings)
    }
    /// Re-checks every tool and refreshes the cached result.
    pub async fn dependencies(&self) -> Vec<DependencyInfo> {
        let dependencies = self.inspect_dependencies().await;
        *self.dependency_cache.write().await = Some(dependencies.clone());
        dependencies
    }

    async fn inspect_dependencies(&self) -> Vec<DependencyInfo> {
        let settings = self.settings.read().await.clone();
        self.dependencies.inspect_all(&settings).await
    }

    /// GPU capability; cached unless `force` asks for a fresh probe.
    pub async fn hardware_acceleration(&self, force: bool) -> HardwareAccelerationInfo {
        let settings = self.settings.read().await.clone();
        self.hardware_for(&settings, force).await
    }

    /// Feeds runner events into `job`, persisting and emitting at a bounded rate.
    /// `apply` returns true for events that must reach the UI immediately.
    async fn relay_events(
        &self,
        job: &mut DownloadJob,
        events: &mut UnboundedReceiver<RunnerEvent>,
        mut apply: impl FnMut(&mut DownloadJob, RunnerEvent) -> bool,
    ) {
        let mut publisher = JobPublisher::new(job.status.clone(), Instant::now());
        loop {
            let event = if publisher.dirty {
                tokio::select! {
                    event = events.recv() => event,
                    _ = tokio::time::sleep_until(publisher.next_emit()) => {
                        self.publish(job, &mut publisher, false).await;
                        continue;
                    }
                }
            } else {
                events.recv().await
            };
            let Some(event) = event else { break };
            let urgent = apply(job, event);
            self.publish(job, &mut publisher, urgent).await;
        }
    }

    async fn publish(&self, job: &DownloadJob, publisher: &mut JobPublisher, urgent: bool) {
        let (persist, emit) = publisher.decide(&job.status, Instant::now(), urgent);
        if persist {
            let _ = self.db.update_job(job).await;
        }
        if emit {
            let _ = self.app.emit("download-job-changed", job);
        }
    }
}

/// Returns the cached value, or runs `load` and caches its result. The read
/// guard is released before the write lock is taken; holding it across the
/// load (as a `match` scrutinee would) deadlocks the first launch.
async fn cached_or_load<T: Clone>(
    cache: &RwLock<Option<T>>,
    load: impl std::future::Future<Output = T>,
) -> T {
    let cached = cache.read().await.clone();
    if let Some(value) = cached {
        return value;
    }
    let value = load.await;
    *cache.write().await = Some(value.clone());
    value
}

fn push_diagnostic(job: &mut DownloadJob, line: String) {
    if job.diagnostics.len() >= 100 {
        job.diagnostics.remove(0);
    }
    job.diagnostics.push(line);
}

pub(crate) async fn validate_downloaded_file(
    destination: &str,
    output: &std::path::Path,
) -> AppResult<PathBuf> {
    let destination = tokio::fs::canonicalize(destination)
        .await
        .map_err(|_| AppError::Validation("The selected destination is unavailable".into()))?;
    let output = tokio::fs::canonicalize(output)
        .await
        .map_err(|_| AppError::Validation("The downloaded file no longer exists".into()))?;
    let metadata = tokio::fs::metadata(&output).await?;
    if !metadata.is_file() || !output.starts_with(&destination) {
        return Err(AppError::Validation(
            "The download engine reported a file outside the selected destination".into(),
        ));
    }
    Ok(output)
}

fn validate_video_conversion(conversion: &crate::domain::VideoConversionOptions) -> AppResult<()> {
    let maximum = 51;
    if !(1..=maximum).contains(&conversion.quality) {
        return Err(AppError::Validation(format!(
            "{} GPU quality must be between 1 and {maximum}",
            conversion.codec.label()
        )));
    }
    Ok(())
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
    if !PathBuf::from(&settings.download_directory).is_absolute() {
        return Err(AppError::Validation(
            "Choose an absolute download folder".into(),
        ));
    }
    if let Some(directory) = settings.last_download_directory.as_deref()
        && (directory.trim() != directory || !PathBuf::from(directory).is_absolute())
    {
        return Err(AppError::Validation(
            "The last download folder must use an absolute path".into(),
        ));
    }
    for (label, value) in [
        ("yt-dlp", settings.yt_dlp_path.as_deref()),
        ("FFmpeg", settings.ffmpeg_path.as_deref()),
        ("Deno", settings.deno_path.as_deref()),
    ] {
        if let Some(value) = value.filter(|value| !value.is_empty()) {
            let path = PathBuf::from(value);
            if !path.is_absolute() || !path.is_file() {
                return Err(AppError::Validation(format!(
                    "Choose an existing {label} executable"
                )));
            }
        }
    }
    if let Some(path) = settings
        .cookie_file
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(path);
        if !path.is_absolute() || !path.is_file() {
            return Err(AppError::Validation(
                "Choose an existing Netscape-format cookie file".into(),
            ));
        }
    }
    if let Some(browser) = settings
        .cookie_browser
        .as_deref()
        .filter(|value| !value.is_empty())
        && (browser.len() > 200
            || !browser
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || ".:_+-".contains(value)))
    {
        return Err(AppError::Validation(
            "Enter a valid browser cookie source".into(),
        ));
    }
    if settings
        .socket_timeout
        .is_some_and(|seconds| !(1..=600).contains(&seconds))
    {
        return Err(AppError::Validation(
            "The network timeout must be between 1 and 600 seconds".into(),
        ));
    }
    if let Some(region) = settings.geo_bypass.as_deref()
        && !(matches!(region, "default" | "never")
            || (region.len() == 2
                && region
                    .chars()
                    .all(|character| character.is_ascii_uppercase())))
    {
        return Err(AppError::Validation(
            "Choose a region bypass of Automatic, Off, or a two-letter country code".into(),
        ));
    }
    if settings
        .impersonate
        .as_deref()
        .is_some_and(|target| !matches!(target, "chrome" | "edge" | "safari" | "firefox"))
    {
        return Err(AppError::Validation(
            "Choose Chrome, Edge, Safari, or Firefox to impersonate".into(),
        ));
    }
    if settings.sleep_requests.is_some_and(|seconds| seconds > 60)
        || settings
            .extractor_retries
            .is_some_and(|retries| retries > 100)
        || settings
            .http_chunk_size_mb
            .is_some_and(|megabytes| !(1..=1024).contains(&megabytes))
    {
        return Err(AppError::Validation(
            "A network setting is outside its allowed range".into(),
        ));
    }
    if settings.retries > 100 || settings.fragment_retries > 100 {
        return Err(AppError::Validation(
            "Retry counts must be between 0 and 100".into(),
        ));
    }
    if let Some(limit) = settings
        .rate_limit
        .as_deref()
        .filter(|value| !value.is_empty())
        && (limit.len() > 24
            || !regex::Regex::new(r"(?i)^\d+(?:\.\d+)?(?:[kmgtp](?:i?b)?)?$")
                .expect("static rate-limit pattern")
                .is_match(limit))
    {
        return Err(AppError::Validation(
            "Enter a rate limit such as 5M or 750K".into(),
        ));
    }
    if let Some(proxy) = settings.proxy.as_deref().filter(|value| !value.is_empty()) {
        let parsed = url::Url::parse(proxy)
            .map_err(|_| AppError::Validation("Enter a valid proxy URL".into()))?;
        if !matches!(parsed.scheme(), "http" | "https" | "socks4" | "socks5") {
            return Err(AppError::Validation(
                "Use an HTTP, HTTPS, SOCKS4, or SOCKS5 proxy URL".into(),
            ));
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(AppError::Validation(
                "Proxy credentials are not stored by this release. Use a proxy URL without a username or password.".into(),
            ));
        }
    }
    Ok(())
}

async fn restore_last_download_directory(settings: &mut AppSettings) -> bool {
    let original = settings.last_download_directory.clone();
    let had_legacy_directories = !settings.legacy_recent_download_directories.is_empty();
    let mut candidates = Vec::new();
    if let Some(directory) = settings.last_download_directory.take() {
        candidates.push(directory);
    }
    candidates.append(&mut settings.legacy_recent_download_directories);

    settings.last_download_directory = None;
    for directory in candidates {
        let path = PathBuf::from(&directory);
        if path.is_absolute()
            && tokio::fs::metadata(&path)
                .await
                .is_ok_and(|metadata| metadata.is_dir())
        {
            settings.last_download_directory = Some(directory);
            break;
        }
    }

    original != settings.last_download_directory || had_legacy_directories
}

#[cfg(test)]
mod tests {
    use super::{
        EMIT_INTERVAL, JobPublisher, PERSIST_INTERVAL, cached_or_load,
        restore_last_download_directory, validate_downloaded_file,
    };
    use crate::domain::{AppSettings, JobStatus};
    use std::{fs, time::Duration};
    use tokio::{sync::RwLock, time::Instant};

    #[tokio::test]
    async fn an_empty_cache_is_filled_without_deadlocking() {
        let cache = RwLock::new(None);
        let first =
            tokio::time::timeout(Duration::from_secs(5), cached_or_load(&cache, async { 7 }))
                .await
                .expect("filling an empty cache must not wait on its own read lock");
        assert_eq!(first, 7);
        assert_eq!(*cache.read().await, Some(7));

        let second = cached_or_load(&cache, async { unreachable!("cached value is reused") }).await;
        assert_eq!(second, 7);
    }

    #[test]
    fn progress_bursts_are_coalesced_but_state_changes_are_immediate() {
        let start = Instant::now();
        let mut publisher = JobPublisher::new(JobStatus::Downloading, start);
        let downloading = JobStatus::Downloading;

        assert_eq!(publisher.decide(&downloading, start, false), (false, true));
        let soon = start + Duration::from_millis(40);
        assert_eq!(publisher.decide(&downloading, soon, false), (false, false));
        assert!(publisher.dirty, "a skipped update is flushed later");
        assert_eq!(publisher.next_emit(), start + EMIT_INTERVAL);

        let later = start + EMIT_INTERVAL;
        assert_eq!(publisher.decide(&downloading, later, false), (false, true));
        assert!(!publisher.dirty);

        let finishing = JobStatus::PostProcessing;
        let stage = later + Duration::from_millis(10);
        assert_eq!(publisher.decide(&finishing, stage, false), (true, true));
        let output = stage + Duration::from_millis(10);
        assert_eq!(publisher.decide(&finishing, output, true), (true, true));

        let persisted = output + PERSIST_INTERVAL;
        assert_eq!(publisher.decide(&finishing, persisted, false), (true, true));
    }

    #[tokio::test]
    async fn accepts_regular_files_inside_the_destination() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("downloads");
        fs::create_dir(&destination).unwrap();
        let output = destination.join("video.mp4");
        fs::write(&output, b"media").unwrap();

        let validated = validate_downloaded_file(destination.to_str().unwrap(), &output)
            .await
            .unwrap();

        assert_eq!(validated, output.canonicalize().unwrap());
    }

    #[tokio::test]
    async fn rejects_files_outside_the_destination() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("downloads");
        fs::create_dir(&destination).unwrap();
        let output = root.path().join("unrelated.txt");
        fs::write(&output, b"private").unwrap();

        assert!(
            validate_downloaded_file(destination.to_str().unwrap(), &output)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn last_download_directory_is_restored_or_cleared_when_deleted() {
        let root = tempfile::tempdir().unwrap();
        let saved = root.path().join("saved-videos");
        fs::create_dir(&saved).unwrap();
        let mut settings = AppSettings {
            last_download_directory: Some(saved.to_string_lossy().into_owned()),
            ..AppSettings::default()
        };

        assert!(!restore_last_download_directory(&mut settings).await);
        assert_eq!(settings.last_download_directory.as_deref(), saved.to_str());

        fs::remove_dir(&saved).unwrap();
        assert!(restore_last_download_directory(&mut settings).await);
        assert!(settings.last_download_directory.is_none());
    }

    #[tokio::test]
    async fn v014_recent_directory_migrates_to_the_last_used_folder() {
        let root = tempfile::tempdir().unwrap();
        let saved = root.path().join("saved-videos");
        fs::create_dir(&saved).unwrap();
        let mut settings = AppSettings {
            legacy_recent_download_directories: vec![saved.to_string_lossy().into_owned()],
            ..AppSettings::default()
        };

        assert!(restore_last_download_directory(&mut settings).await);
        assert_eq!(settings.last_download_directory.as_deref(), saved.to_str());
        assert!(settings.legacy_recent_download_directories.is_empty());
    }
}
