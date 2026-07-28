use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

#[cfg(not(target_os = "macos"))]
use std::process::Output;
#[cfg(not(target_os = "macos"))]
use tokio::time::timeout;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex,
    time::{Duration, sleep},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    domain::{DownloadProgress, NvencCodec, NvidiaAccelerationInfo, VideoConversionOptions},
    error::{AppError, AppResult},
    integration::yt_dlp::RunnerEvent,
};

#[cfg(not(target_os = "macos"))]
use crate::domain::NvencEncoderInfo;

#[cfg(not(target_os = "macos"))]
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

pub async fn inspect_nvidia_acceleration(ffmpeg: Option<&Path>) -> NvidiaAccelerationInfo {
    #[cfg(target_os = "macos")]
    {
        let _ = ffmpeg;
        NvidiaAccelerationInfo::unavailable(
            "unsupported_platform",
            "NVENC and NVDEC require an NVIDIA GPU and are supported on Windows and Linux. The bundled macOS engine uses Apple VideoToolbox instead.",
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let Some(ffmpeg) = ffmpeg else {
            return NvidiaAccelerationInfo::unavailable(
                "build_missing",
                "FFmpeg is unavailable, so NVIDIA acceleration cannot be checked.",
            );
        };
        let encoders_output = match run_probe(ffmpeg, &["-hide_banner", "-encoders"]).await {
            Ok(value) => {
                String::from_utf8_lossy(&value.stdout).into_owned()
                    + &String::from_utf8_lossy(&value.stderr)
            }
            Err(message) => {
                return NvidiaAccelerationInfo::unavailable("probe_failed", message);
            }
        };
        let hwaccels_output = match run_probe(ffmpeg, &["-hide_banner", "-hwaccels"]).await {
            Ok(value) => {
                String::from_utf8_lossy(&value.stdout).into_owned()
                    + &String::from_utf8_lossy(&value.stderr)
            }
            Err(message) => {
                return NvidiaAccelerationInfo::unavailable("probe_failed", message);
            }
        };
        let cuda_decode_compiled = hwaccels_output
            .lines()
            .any(|line| line.trim().eq_ignore_ascii_case("cuda"));
        let mut encoders = Vec::new();
        let mut h264_probe_file = None;
        for codec in [NvencCodec::H264, NvencCodec::Hevc, NvencCodec::Av1] {
            let encoder = codec.encoder_name();
            let compiled = encoder_line_present(&encoders_output, encoder);
            let (available, message, probe_file) = if compiled {
                runtime_encoder_probe(ffmpeg, &codec).await
            } else {
                (
                    false,
                    Some(format!("{encoder} is not included in this FFmpeg build.")),
                    None,
                )
            };
            if codec == NvencCodec::H264 {
                h264_probe_file = probe_file;
            }
            encoders.push(NvencEncoderInfo {
                codec,
                encoder: encoder.into(),
                compiled,
                available,
                message,
            });
        }
        let cuda_decode_available =
            if cuda_decode_compiled && encoders[0].available && h264_probe_file.is_some() {
                runtime_decoder_probe(ffmpeg, h264_probe_file.as_deref().unwrap()).await
            } else {
                false
            };
        if let Some(path) = h264_probe_file {
            let _ = tokio::fs::remove_file(path).await;
        }
        let any_available = encoders.iter().any(|encoder| encoder.available);
        NvidiaAccelerationInfo {
            status: if any_available {
                "available"
            } else if encoders.iter().any(|encoder| encoder.compiled) {
                "driver_or_gpu_missing"
            } else {
                "build_missing"
            }
            .into(),
            cuda_decode_compiled,
            cuda_decode_available,
            encoders,
            message: if any_available {
                if cuda_decode_available {
                    "NVIDIA hardware encoding and CUDA decoding are ready for video conversion."
                } else {
                    "NVIDIA hardware encoding is ready. CUDA decoding is unavailable; software decoding will be used."
                }
            } else {
                "The bundled engine supports NVENC, but no compatible NVIDIA GPU and driver were detected."
            }
            .into(),
        }
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn encoder_line_present(output: &str, encoder: &str) -> bool {
    output.lines().any(|line| {
        let mut fields = line.split_whitespace();
        let flags = fields.next().unwrap_or_default();
        let name = fields.next().unwrap_or_default();
        flags.len() >= 6 && name == encoder
    })
}

#[cfg(not(target_os = "macos"))]
async fn runtime_encoder_probe(
    ffmpeg: &Path,
    codec: &NvencCodec,
) -> (bool, Option<String>, Option<PathBuf>) {
    let encoder = codec.encoder_name();
    let probe_file = if *codec == NvencCodec::H264 {
        Some(std::env::temp_dir().join(format!(
            "yt-dlp-desktop-nvenc-probe-{}.h264",
            Uuid::new_v4()
        )))
    } else {
        None
    };
    let mut args = vec![
        "-hide_banner".to_string(),
        "-nostdin".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-f".to_string(),
        "lavfi".to_string(),
        "-i".to_string(),
        "color=c=black:s=256x256:r=1".to_string(),
        "-frames:v".to_string(),
        if probe_file.is_some() { "2" } else { "1" }.to_string(),
        "-an".to_string(),
        "-c:v".to_string(),
        encoder.to_string(),
        "-preset".to_string(),
        "p5".to_string(),
        "-tune".to_string(),
        "hq".to_string(),
        "-rc".to_string(),
        "vbr".to_string(),
        "-cq".to_string(),
        "23".to_string(),
        "-b:v".to_string(),
        "0".to_string(),
    ];
    if let Some(path) = probe_file.as_ref() {
        args.extend([
            "-f".into(),
            "h264".into(),
            "-y".into(),
            path.to_string_lossy().into_owned(),
        ]);
    } else {
        args.extend(["-f".into(), "null".into(), "-".into()]);
    }
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    match run_probe(ffmpeg, &refs).await {
        Ok(output) if output.status.success() => (true, None, probe_file),
        Ok(output) => {
            if let Some(path) = probe_file.as_ref() {
                let _ = tokio::fs::remove_file(path).await;
            }
            (
                false,
                Some(short_process_message(&output, "The encoder probe failed.")),
                None,
            )
        }
        Err(message) => {
            if let Some(path) = probe_file.as_ref() {
                let _ = tokio::fs::remove_file(path).await;
            }
            (false, Some(message), None)
        }
    }
}

#[cfg(not(target_os = "macos"))]
async fn runtime_decoder_probe(ffmpeg: &Path, input: &Path) -> bool {
    let input = input.to_string_lossy();
    run_probe(
        ffmpeg,
        &[
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-hwaccel",
            "cuda",
            "-hwaccel_output_format",
            "cuda",
            "-i",
            &input,
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-dn",
            "-vf",
            "hwdownload,format=nv12",
            "-f",
            "null",
            "-",
        ],
    )
    .await
    .is_ok_and(|output| output.status.success())
}

#[cfg(not(target_os = "macos"))]
async fn run_probe(executable: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    match timeout(PROBE_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(format!("FFmpeg could not be started: {error}")),
        Err(_) => Err("FFmpeg capability detection timed out.".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn short_process_message(output: &Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = stderr
        .lines()
        .rfind(|line| !line.trim().is_empty())
        .unwrap_or(fallback)
        .trim();
    message.chars().take(240).collect()
}

pub struct ConversionOutcome {
    pub output_path: PathBuf,
    pub diagnostics: Vec<String>,
    pub cancelled: bool,
}

pub async fn run_nvenc_conversion(
    ffmpeg: &Path,
    input: &Path,
    options: &VideoConversionOptions,
    cancel: CancellationToken,
    events: tokio::sync::mpsc::UnboundedSender<RunnerEvent>,
) -> AppResult<ConversionOutcome> {
    let output_path = available_output_path(input)?;
    let temporary_path = output_path.with_file_name(format!(
        ".{}.{}.part.mkv",
        output_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("conversion"),
        Uuid::new_v4()
    ));
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-loglevel")
        .arg("warning")
        .arg("-y");
    if options.use_cuda_decode {
        command
            .arg("-hwaccel")
            .arg("cuda")
            .arg("-hwaccel_output_format")
            .arg("cuda");
    }
    command
        .arg("-i")
        .arg(input)
        .args(["-map", "0", "-c", "copy", "-c:v:0"])
        .arg(options.codec.encoder_name())
        .args(["-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq"])
        .arg(options.quality.to_string())
        .args([
            "-b:v",
            "0",
            "-map_metadata",
            "0",
            "-max_muxing_queue_size",
            "4096",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(&temporary_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| AppError::Process(error.to_string()))?;
    let pid = child
        .id()
        .ok_or_else(|| AppError::Process("FFmpeg has no process identifier".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Process("FFmpeg progress output is unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Process("FFmpeg diagnostic output is unavailable".into()))?;
    let diagnostics = Arc::new(Mutex::new(Vec::<String>::new()));
    let diagnostic_state = diagnostics.clone();
    let diagnostic_events = events.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line: String = line.chars().take(1000).collect();
            let mut guard = diagnostic_state.lock().await;
            if guard.len() >= 150 {
                guard.remove(0);
            }
            guard.push(line.clone());
            let _ = diagnostic_events.send(RunnerEvent::Diagnostic(line));
        }
    });
    let progress_events = events.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line == "progress=continue" {
                let _ = progress_events.send(RunnerEvent::Progress(DownloadProgress {
                    stage: Some("NVIDIA GPU conversion".into()),
                    ..DownloadProgress::default()
                }));
            }
        }
    });
    let status = tokio::select! {
        result = child.wait() => Some(result?),
        _ = cancel.cancelled() => {
            terminate_tree(pid, true).await;
            sleep(Duration::from_secs(2)).await;
            if child.try_wait()?.is_none() {
                terminate_tree(pid, false).await;
            }
            let _ = child.wait().await;
            None
        }
    };
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    let captured = diagnostics.lock().await.clone();
    match status {
        None => {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            Ok(ConversionOutcome {
                output_path: input.to_path_buf(),
                diagnostics: captured,
                cancelled: true,
            })
        }
        Some(status) if status.success() => {
            tokio::fs::rename(&temporary_path, &output_path).await?;
            tokio::fs::remove_file(input).await?;
            Ok(ConversionOutcome {
                output_path,
                diagnostics: captured,
                cancelled: false,
            })
        }
        Some(status) => {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            Err(AppError::Process(format!(
                "NVENC conversion exited with {status}. The original download was kept."
            )))
        }
    }
}

fn available_output_path(input: &Path) -> AppResult<PathBuf> {
    let parent = input
        .parent()
        .ok_or_else(|| AppError::Validation("The download has no parent folder".into()))?;
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    for index in 1..=100 {
        let suffix = if index == 1 {
            " [NVENC]".to_string()
        } else {
            format!(" [NVENC {index}]")
        };
        let candidate = parent.join(format!("{stem}{suffix}.mkv"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::Validation(
        "Could not choose a unique NVENC output filename".into(),
    ))
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
async fn terminate_tree(pid: u32, graceful: bool) {
    let mut args = vec!["/PID".to_string(), pid.to_string(), "/T".into()];
    if !graceful {
        args.push("/F".into());
    }
    let _ = Command::new("taskkill.exe")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
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
    fn detects_encoder_names_as_fields_not_substrings() {
        let fixture = " V....D h264_nvenc NVIDIA NVENC H.264 encoder\n V....D hevc_nvenc encoder";
        assert!(encoder_line_present(fixture, "h264_nvenc"));
        assert!(encoder_line_present(fixture, "hevc_nvenc"));
        assert!(!encoder_line_present(fixture, "av1_nvenc"));
    }

    #[test]
    fn chooses_a_non_destructive_sibling_name() {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("video.webm");
        std::fs::write(&input, b"source").unwrap();
        let output = available_output_path(&input).unwrap();
        assert_eq!(output.file_name().unwrap(), "video [NVENC].mkv");
        assert!(input.exists());
    }
}
