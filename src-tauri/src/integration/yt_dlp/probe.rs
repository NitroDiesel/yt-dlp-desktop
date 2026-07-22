use std::{path::Path, process::Stdio};

use serde_json::Value;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::{
    domain::{MediaFormat, MediaProbe, SubtitleTrack},
    error::{AppError, AppResult},
};

pub async fn probe(
    executable: &Path,
    deno: Option<&Path>,
    url: &str,
    cancel: CancellationToken,
) -> AppResult<MediaProbe> {
    let parsed = url::Url::parse(url)
        .map_err(|_| AppError::Validation("Enter a valid media address".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::Validation(
            "Only http and https links are supported".into(),
        ));
    }
    let mut command = Command::new(executable);
    command.arg("--ignore-config");
    if let Some(deno) = deno {
        command
            .arg("--js-runtimes")
            .arg(format!("deno:{}", deno.to_string_lossy()));
    }
    command
        .args([
            "--dump-single-json",
            "--flat-playlist",
            "--yes-playlist",
            "--playlist-items",
            ":200",
            "--color",
            "never",
            url,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut command);
    let child = command
        .spawn()
        .map_err(|error| AppError::Process(error.to_string()))?;
    let pid = child.id();
    let output = tokio::select! {
        output = child.wait_with_output() => output?,
        _ = cancel.cancelled() => { if let Some(pid)=pid { terminate_tree(pid, false).await; } return Err(AppError::Process("Analysis cancelled".into())); }
    };
    if !output.status.success() {
        let stderr = redact(&String::from_utf8_lossy(&output.stderr));
        return Err(AppError::Process(classify_probe_error(&stderr)));
    }
    if output.stdout.len() > 32 * 1024 * 1024 {
        return Err(AppError::Parse(
            "The collection metadata is too large to analyze safely".into(),
        ));
    }
    let value: Value = serde_json::from_slice(&output.stdout)?;
    Ok(from_json(
        value,
        url,
        &String::from_utf8_lossy(&output.stderr),
    ))
}

fn from_json(value: Value, input_url: &str, stderr: &str) -> MediaProbe {
    let entries = value.get("entries").and_then(Value::as_array);
    let is_playlist = entries.is_some();
    let formats = value
        .get("formats")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|format| MediaFormat {
            format_id: text(format, "format_id").unwrap_or_default(),
            extension: text(format, "ext").unwrap_or_else(|| "unknown".into()),
            width: number_u32(format, "width"),
            height: number_u32(format, "height"),
            fps: format.get("fps").and_then(Value::as_f64),
            video_codec: text(format, "vcodec"),
            audio_codec: text(format, "acodec"),
            bitrate_kbps: format.get("tbr").and_then(Value::as_f64),
            file_size: format
                .get("filesize")
                .or_else(|| format.get("filesize_approx"))
                .and_then(Value::as_u64),
            note: text(format, "format_note"),
            hdr: text(format, "dynamic_range").is_some_and(|v| !matches!(v.as_str(), "SDR" | "")),
        })
        .collect();
    let mut subtitles = Vec::new();
    collect_subtitles(&mut subtitles, value.get("subtitles"), false);
    collect_subtitles(&mut subtitles, value.get("automatic_captions"), true);
    let playlist_count = value
        .get("n_entries")
        .and_then(Value::as_u64)
        .or_else(|| entries.map(|e| e.len() as u64))
        .map(|v| v.min(u32::MAX as u64) as u32);
    let mut warnings: Vec<String> = stderr
        .lines()
        .filter(|line| line.contains("WARNING:"))
        .take(5)
        .map(redact)
        .collect();
    if playlist_count == Some(200) {
        warnings.push("This collection preview is limited to 200 items. Choose a narrower item range for very large channels.".into());
    }
    MediaProbe {
        id: text(&value, "id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        url: text(&value, "webpage_url").unwrap_or_else(|| input_url.into()),
        title: text(&value, "title").unwrap_or_else(|| "Untitled media".into()),
        creator: text(&value, "uploader").or_else(|| text(&value, "channel")),
        duration_seconds: value.get("duration").and_then(Value::as_f64),
        thumbnail_url: text(&value, "thumbnail"),
        is_playlist,
        playlist_count,
        is_live: value
            .get("is_live")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        formats,
        subtitles,
        warnings,
    }
}

fn collect_subtitles(target: &mut Vec<SubtitleTrack>, value: Option<&Value>, automatic: bool) {
    if let Some(map) = value.and_then(Value::as_object) {
        for (language, tracks) in map {
            let extensions = tracks
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|track| text(track, "ext"))
                .collect();
            target.push(SubtitleTrack {
                language: language.clone(),
                name: None,
                extensions,
                automatic,
            });
        }
    }
}
fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}
fn number_u32(value: &Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .map(|v| v.min(u32::MAX as u64) as u32)
}
fn classify_probe_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("unsupported url") {
        "This site or link is not supported".into()
    } else if lower.contains("private") || lower.contains("sign in") || lower.contains("login") {
        "This media requires authentication. Configure browser cookies in Settings.".into()
    } else if lower.contains("not available") || lower.contains("unavailable") {
        "This media is unavailable".into()
    } else if lower.contains("timed out") || lower.contains("network") {
        "The network request failed or timed out".into()
    } else {
        "yt-dlp could not analyze this link. It may need an update.".into()
    }
}
pub fn redact(value: &str) -> String {
    let proxy = regex::Regex::new(r"(?i)(https?://)([^\s/@:]+):([^\s/@]+)@").unwrap();
    let tokens = regex::Regex::new(r"(?i)(token|key|signature|auth|password)=([^&\s]+)").unwrap();
    tokens
        .replace_all(&proxy.replace_all(value, "$1[redacted]@"), "$1=[redacted]")
        .into_owned()
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP);
}
#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}
#[cfg(windows)]
async fn terminate_tree(pid: u32, _graceful: bool) {
    let _ = Command::new("taskkill.exe")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .await;
}
#[cfg(unix)]
async fn terminate_tree(pid: u32, graceful: bool) {
    unsafe {
        libc::kill(
            -(pid as i32),
            if graceful {
                libc::SIGINT
            } else {
                libc::SIGKILL
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_proxy_and_query_secrets() {
        let value = redact("https://user:pass@proxy.test token=abc&x=1");
        assert!(!value.contains("pass"));
        assert!(!value.contains("abc"));
    }
}
