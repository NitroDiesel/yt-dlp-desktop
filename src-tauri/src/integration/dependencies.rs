use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tokio::process::Command;

use crate::{
    domain::{AppSettings, DependencyInfo, DependencyKind, HardwareAccelerationInfo},
    error::{AppError, AppResult},
    integration::{ffmpeg::inspect_hardware_acceleration, process::configure_background_process},
};

const VERSION_CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const ENGINE_UPDATE_TIMEOUT: Duration = Duration::from_secs(180);
/// Automatic yt-dlp updates run at most this often.
pub const ENGINE_UPDATE_INTERVAL: Duration = Duration::from_secs(20 * 60 * 60);

#[derive(Clone)]
pub struct DependencyManager {
    bundled_dir: PathBuf,
    /// Writable folder for the self-updating copy of yt-dlp. The bundled copy
    /// can sit in a read-only location (Linux packages, macOS app bundles).
    engine_dir: PathBuf,
}

impl DependencyManager {
    pub fn new(bundled_dir: PathBuf, engine_dir: PathBuf) -> Self {
        Self {
            bundled_dir,
            engine_dir,
        }
    }

    /// Whether the last yt-dlp update attempt is older than `ENGINE_UPDATE_INTERVAL`.
    pub fn engine_update_due(&self) -> bool {
        let last = std::fs::read_to_string(self.engine_dir.join("last-update-check"))
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(0);
        unix_now().saturating_sub(last) >= ENGINE_UPDATE_INTERVAL.as_secs()
    }

    /// Brings the writable copy of yt-dlp up to date and returns its version.
    /// The copy starts as the bundled build, and is replaced by it whenever the
    /// bundled build is newer. yt-dlp's own updater then fetches the latest
    /// stable release and checks it against the release's SHA2-256SUMS before
    /// swapping it in.
    pub async fn update_yt_dlp(&self, proxy: Option<&str>) -> AppResult<Option<String>> {
        let name = executable_name("yt-dlp");
        let bundled = self.bundled_dir.join(name);
        let managed = self.engine_dir.join(name);
        tokio::fs::create_dir_all(&self.engine_dir).await?;
        let _ = std::fs::write(
            self.engine_dir.join("last-update-check"),
            unix_now().to_string(),
        );
        let _ = tokio::fs::remove_file(self.engine_dir.join(format!("{name}.old"))).await;

        let bundled_version = match bundled.is_file() {
            true => version_of(&bundled).await,
            false => None,
        };
        let managed_version = match managed.is_file() {
            true => version_of(&managed).await,
            false => None,
        };
        if let Some(bundled_version) = &bundled_version
            && managed_version
                .as_deref()
                .is_none_or(|current| version_key(bundled_version) > version_key(current))
        {
            tokio::fs::copy(&bundled, &managed).await?;
        }
        if !managed.is_file() {
            return Err(AppError::DependencyMissing("yt-dlp".into()));
        }

        let mut command = Command::new(&managed);
        command.args(["--ignore-config", "--update"]);
        if let Some(proxy) = proxy.filter(|value| !value.trim().is_empty()) {
            command.arg("--proxy").arg(proxy);
        }
        command
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        configure_background_process(&mut command);
        let output = tokio::time::timeout(ENGINE_UPDATE_TIMEOUT, command.output())
            .await
            .map_err(|_| AppError::Process("yt-dlp did not finish updating in time".into()))??;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let reason = stderr
                .lines()
                .rev()
                .find(|line| line.starts_with("ERROR:"))
                .map(|line| line.trim_start_matches("ERROR:").trim().to_owned())
                .unwrap_or_else(|| format!("the updater exited with {}", output.status));
            return Err(AppError::Process(format!(
                "yt-dlp could not update: {reason}"
            )));
        }
        Ok(version_of(&managed).await)
    }

    /// Version-checks every tool concurrently; yt-dlp's cold start dominates the wall time.
    pub async fn inspect_all(&self, settings: &AppSettings) -> Vec<DependencyInfo> {
        let ffprobe_custom = settings
            .ffmpeg_path
            .as_deref()
            .and_then(|value| Path::new(value).parent())
            .map(|p| p.join(executable_name("ffprobe")))
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string());
        let (yt, ffmpeg, ffprobe, deno) = tokio::join!(
            self.inspect(
                DependencyKind::YtDlp,
                settings.yt_dlp_path.as_deref(),
                executable_name("yt-dlp"),
                &["--version"],
            ),
            self.inspect(
                DependencyKind::Ffmpeg,
                settings.ffmpeg_path.as_deref(),
                executable_name("ffmpeg"),
                &["-version"],
            ),
            self.inspect(
                DependencyKind::Ffprobe,
                ffprobe_custom.as_deref(),
                executable_name("ffprobe"),
                &["-version"],
            ),
            self.inspect(
                DependencyKind::JavascriptRuntime,
                settings.deno_path.as_deref(),
                executable_name("deno"),
                &["--version"],
            ),
        );
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

    pub fn resolve_ffprobe(&self, settings: &AppSettings) -> Option<PathBuf> {
        let custom = settings
            .ffmpeg_path
            .as_deref()
            .and_then(|value| Path::new(value).parent())
            .map(|path| path.join(executable_name("ffprobe")))
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned());
        self.resolve(custom.as_deref(), executable_name("ffprobe"))
    }

    pub async fn inspect_hardware_acceleration(
        &self,
        settings: &AppSettings,
    ) -> HardwareAccelerationInfo {
        let ffmpeg = self.resolve_ffmpeg(settings);
        inspect_hardware_acceleration(ffmpeg.as_deref()).await
    }

    fn resolve(&self, custom: Option<&str>, name: &str) -> Option<PathBuf> {
        self.resolve_with_source(custom, name).map(|(path, _)| path)
    }

    /// A custom path wins, then the updated copy, then the bundled build.
    fn resolve_with_source(
        &self,
        custom: Option<&str>,
        name: &str,
    ) -> Option<(PathBuf, &'static str)> {
        if let Some(path) = custom.map(PathBuf::from).filter(|path| path.is_file()) {
            return Some((path, "custom"));
        }
        let managed = self.engine_dir.join(name);
        if managed.is_file() {
            return Some((managed, "managed"));
        }
        let bundled = self.bundled_dir.join(name);
        bundled.is_file().then_some((bundled, "bundled"))
    }

    async fn inspect(
        &self,
        kind: DependencyKind,
        custom: Option<&str>,
        name: &str,
        args: &[&str],
    ) -> DependencyInfo {
        let Some((path, source)) = self.resolve_with_source(custom, name) else {
            return DependencyInfo {
                kind,
                status: "missing".into(),
                source: "not_found".into(),
                path: None,
                version: None,
                message: Some("Not found on this computer".into()),
            };
        };
        let mut command = Command::new(&path);
        command
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        configure_background_process(&mut command);
        let output = tokio::time::timeout(VERSION_CHECK_TIMEOUT, command.output()).await;
        match output {
            Ok(Ok(output)) if output.status.success() => {
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
            Ok(Ok(output)) => DependencyInfo {
                kind,
                status: "invalid".into(),
                source: source.into(),
                path: Some(path.to_string_lossy().into_owned()),
                version: None,
                message: Some(format!("Version check exited with {}", output.status)),
            },
            Ok(Err(error)) => DependencyInfo {
                kind,
                status: "invalid".into(),
                source: source.into(),
                path: Some(path.to_string_lossy().into_owned()),
                version: None,
                message: Some(error.to_string()),
            },
            Err(_) => timeout_dependency_info(kind, source, &path),
        }
    }
}

fn timeout_dependency_info(kind: DependencyKind, source: &str, path: &Path) -> DependencyInfo {
    let bundled = source != "custom";
    DependencyInfo {
        kind,
        status: if bundled { "available" } else { "invalid" }.into(),
        source: source.into(),
        path: Some(path.to_string_lossy().into_owned()),
        version: None,
        message: Some(if bundled {
            "The bundled tool is ready. Its version response took longer than expected.".into()
        } else {
            format!(
                "Version check timed out after {} seconds",
                VERSION_CHECK_TIMEOUT.as_secs()
            )
        }),
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// First line of `--version`, or None when the tool does not answer.
async fn version_of(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .kill_on_drop(true);
    configure_background_process(&mut command);
    let output = tokio::time::timeout(VERSION_CHECK_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()
        .filter(|output| output.status.success())?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
}

/// yt-dlp versions are dates with an optional build number: 2026.08.19 or 2026.08.19.232202.
fn version_key(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_tool_remains_available_when_version_check_is_slow() {
        let info =
            timeout_dependency_info(DependencyKind::YtDlp, "bundled", Path::new("yt-dlp.exe"));

        assert_eq!(info.status, "available");
        assert!(info.message.unwrap().contains("ready"));
    }

    #[test]
    fn newer_yt_dlp_dates_sort_after_older_ones() {
        assert!(version_key("2026.08.19") > version_key("2026.07.04"));
        assert!(version_key("2026.08.19.232202") > version_key("2026.08.19"));
        assert!(version_key("2027.01.02") > version_key("2026.12.31"));
    }

    #[test]
    fn the_updated_copy_wins_over_the_bundled_one_but_not_a_custom_path() {
        let root = tempfile::tempdir().unwrap();
        let bundled_dir = root.path().join("bundled");
        let engine_dir = root.path().join("engine");
        std::fs::create_dir_all(&bundled_dir).unwrap();
        std::fs::create_dir_all(&engine_dir).unwrap();
        let name = executable_name("yt-dlp");
        std::fs::write(bundled_dir.join(name), b"").unwrap();
        let manager = DependencyManager::new(bundled_dir.clone(), engine_dir.clone());
        assert_eq!(
            manager.resolve_with_source(None, name).unwrap().1,
            "bundled"
        );

        std::fs::write(engine_dir.join(name), b"").unwrap();
        assert_eq!(
            manager.resolve_with_source(None, name),
            Some((engine_dir.join(name), "managed"))
        );

        let custom = root.path().join("custom-yt-dlp");
        std::fs::write(&custom, b"").unwrap();
        let custom = custom.to_string_lossy().into_owned();
        assert_eq!(
            manager.resolve_with_source(Some(&custom), name).unwrap().1,
            "custom"
        );
    }

    #[test]
    fn engine_updates_are_due_until_one_was_attempted_recently() {
        let root = tempfile::tempdir().unwrap();
        let manager =
            DependencyManager::new(root.path().join("bundled"), root.path().to_path_buf());
        assert!(manager.engine_update_due());
        std::fs::write(
            root.path().join("last-update-check"),
            unix_now().to_string(),
        )
        .unwrap();
        assert!(!manager.engine_update_due());
        let stale = unix_now() - ENGINE_UPDATE_INTERVAL.as_secs() - 1;
        std::fs::write(root.path().join("last-update-check"), stale.to_string()).unwrap();
        assert!(manager.engine_update_due());
    }

    #[test]
    fn custom_tool_must_answer_the_version_check() {
        let info = timeout_dependency_info(
            DependencyKind::YtDlp,
            "custom",
            Path::new("custom-yt-dlp.exe"),
        );

        assert_eq!(info.status, "invalid");
        assert!(info.message.unwrap().contains("15 seconds"));
    }
}
