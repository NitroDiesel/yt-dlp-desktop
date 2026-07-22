use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaFormat {
    pub format_id: String,
    pub extension: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub bitrate_kbps: Option<f64>,
    pub file_size: Option<u64>,
    pub note: Option<String>,
    pub hdr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub language: String,
    pub name: Option<String>,
    pub extensions: Vec<String>,
    pub automatic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub id: String,
    pub url: String,
    pub title: String,
    pub creator: Option<String>,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub is_playlist: bool,
    pub playlist_count: Option<u32>,
    pub is_live: bool,
    pub formats: Vec<MediaFormat>,
    pub subtitles: Vec<SubtitleTrack>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MediaMode {
    Video,
    Audio,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub mode: MediaMode,
    pub quality: String,
    pub audio_format: String,
    pub subtitle_languages: Vec<String>,
    pub write_subtitles: bool,
    pub write_automatic_subtitles: bool,
    pub embed_subtitles: bool,
    pub embed_metadata: bool,
    pub embed_thumbnail: bool,
    pub playlist_items: Option<String>,
    pub custom_format: Option<String>,
    pub custom_arguments: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub destination: String,
    pub filename_template: String,
    pub options: DownloadOptions,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub percent: Option<f64>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub playlist_index: Option<u32>,
    pub playlist_count: Option<u32>,
    pub filename: Option<String>,
    pub stage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Analyzing,
    Downloading,
    PostProcessing,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Analyzing => "analyzing",
            Self::Downloading => "downloading",
            Self::PostProcessing => "post_processing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    pub id: String,
    pub request: DownloadRequest,
    pub title: Option<String>,
    pub status: JobStatus,
    pub progress: DownloadProgress,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub output_path: Option<String>,
    pub error_category: Option<String>,
    pub error_message: Option<String>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub download_directory: String,
    pub filename_template: String,
    pub default_mode: MediaMode,
    pub default_quality: String,
    pub queue_concurrency: u8,
    pub theme: String,
    pub reduced_motion: bool,
    pub yt_dlp_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub deno_path: Option<String>,
    pub cookie_browser: Option<String>,
    pub cookie_file: Option<String>,
    pub proxy: Option<String>,
    pub rate_limit: Option<String>,
    pub retries: u8,
    pub fragment_retries: u8,
}

impl Default for AppSettings {
    fn default() -> Self {
        let download_directory = dirs::download_dir()
            .or_else(|| dirs::home_dir().map(|p| p.join("Downloads")))
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        Self {
            download_directory,
            filename_template: "%(title).200B [%(id)s].%(ext)s".into(),
            default_mode: MediaMode::Video,
            default_quality: "best".into(),
            queue_concurrency: 1,
            theme: "system".into(),
            reduced_motion: false,
            yt_dlp_path: None,
            ffmpeg_path: None,
            deno_path: None,
            cookie_browser: None,
            cookie_file: None,
            proxy: None,
            rate_limit: None,
            retries: 10,
            fragment_retries: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyKind {
    YtDlp,
    Ffmpeg,
    Ffprobe,
    JavascriptRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInfo {
    pub kind: DependencyKind,
    pub status: String,
    pub source: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub settings: AppSettings,
    pub queue: Vec<DownloadJob>,
    pub history: Vec<DownloadJob>,
    pub dependencies: Vec<DependencyInfo>,
    pub queue_paused: bool,
}
