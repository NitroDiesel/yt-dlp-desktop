use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Stdio,
};

use tokio::process::Command;

use crate::{
    domain::{AppSettings, DependencyInfo, DependencyKind},
    error::AppResult,
};

#[derive(Clone)]
pub struct DependencyManager {
    managed_dir: PathBuf,
    bundled_dir: PathBuf,
}

impl DependencyManager {
    pub fn new(managed_dir: PathBuf, bundled_dir: PathBuf) -> Self {
        Self {
            managed_dir,
            bundled_dir,
        }
    }

    pub async fn inspect_all(&self, settings: &AppSettings) -> Vec<DependencyInfo> {
        let yt = self
            .inspect(
                DependencyKind::YtDlp,
                settings.yt_dlp_path.as_deref(),
                executable_name("yt-dlp"),
                &["--version"],
            )
            .await;
        let ffmpeg = self
            .inspect(
                DependencyKind::Ffmpeg,
                settings.ffmpeg_path.as_deref(),
                executable_name("ffmpeg"),
                &["-version"],
            )
            .await;
        let ffprobe_custom = settings
            .ffmpeg_path
            .as_deref()
            .and_then(|value| Path::new(value).parent())
            .map(|p| p.join(executable_name("ffprobe")))
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string());
        let ffprobe = self
            .inspect(
                DependencyKind::Ffprobe,
                ffprobe_custom.as_deref(),
                executable_name("ffprobe"),
                &["-version"],
            )
            .await;
        let deno = self
            .inspect(
                DependencyKind::JavascriptRuntime,
                settings.deno_path.as_deref(),
                executable_name("deno"),
                &["--version"],
            )
            .await;
        vec![yt, ffmpeg, ffprobe, deno]
    }

    pub fn resolve_yt_dlp(&self, settings: &AppSettings) -> Option<PathBuf> {
        self.resolve(settings.yt_dlp_path.as_deref(), executable_name("yt-dlp"))
    }

    pub fn resolve_deno(&self, settings: &AppSettings) -> Option<PathBuf> {
        self.resolve(settings.deno_path.as_deref(), executable_name("deno"))
    }

    pub fn resolve_ffmpeg(&self, settings: &AppSettings) -> Option<PathBuf> {
        self.resolve(settings.ffmpeg_path.as_deref(), executable_name("ffmpeg"))
    }

    fn resolve(&self, custom: Option<&str>, name: &str) -> Option<PathBuf> {
        if let Some(path) = custom.map(PathBuf::from).filter(|path| path.is_file()) {
            return Some(path);
        }
        let bundled = self.bundled_dir.join(name);
        if bundled.is_file() {
            return Some(bundled);
        }
        let managed = self.managed_dir.join("yt-dlp").join("current").join(name);
        if managed.is_file() {
            return Some(managed);
        }
        let cwd = std::env::current_dir().ok();
        let mut visited = HashSet::new();
        if let Some(paths) = std::env::var_os("PATH") {
            for directory in std::env::split_paths(&paths) {
                if directory.as_os_str().is_empty()
                    || cwd.as_ref().is_some_and(|value| value == &directory)
                    || !visited.insert(directory.clone())
                {
                    continue;
                }
                let candidate = directory.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        None
    }

    async fn inspect(
        &self,
        kind: DependencyKind,
        custom: Option<&str>,
        name: &str,
        args: &[&str],
    ) -> DependencyInfo {
        let Some(path) = self.resolve(custom, name) else {
            return DependencyInfo {
                kind,
                status: "missing".into(),
                source: "not_found".into(),
                path: None,
                version: None,
                message: Some("Not found on this computer".into()),
            };
        };
        let source = if custom.is_some_and(|value| Path::new(value) == path) {
            "custom"
        } else if path.starts_with(&self.bundled_dir) {
            "bundled"
        } else if path.starts_with(&self.managed_dir) {
            "managed"
        } else {
            "system"
        };
        let output = Command::new(&path)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .output()
            .await;
        match output {
            Ok(output) if output.status.success() => {
                let raw = if output.stdout.is_empty() {
                    &output.stderr
                } else {
                    &output.stdout
                };
                let version = String::from_utf8_lossy(raw)
                    .lines()
                    .next()
                    .unwrap_or("Available")
                    .trim()
                    .to_owned();
                DependencyInfo {
                    kind,
                    status: "available".into(),
                    source: source.into(),
                    path: Some(path.to_string_lossy().into_owned()),
                    version: Some(version),
                    message: None,
                }
            }
            Ok(output) => DependencyInfo {
                kind,
                status: "invalid".into(),
                source: source.into(),
                path: Some(path.to_string_lossy().into_owned()),
                version: None,
                message: Some(format!("Version check exited with {}", output.status)),
            },
            Err(error) => DependencyInfo {
                kind,
                status: "invalid".into(),
                source: source.into(),
                path: Some(path.to_string_lossy().into_owned()),
                version: None,
                message: Some(error.to_string()),
            },
        }
    }
}

fn executable_name(base: &str) -> &str {
    if cfg!(windows) {
        match base {
            "yt-dlp" => "yt-dlp.exe",
            "ffmpeg" => "ffmpeg.exe",
            "ffprobe" => "ffprobe.exe",
            "deno" => "deno.exe",
            _ => base,
        }
    } else {
        base
    }
}

#[allow(dead_code)]
pub async fn ensure_directory(path: &Path) -> AppResult<()> {
    tokio::fs::create_dir_all(path).await?;
    Ok(())
}
