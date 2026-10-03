use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

#[cfg(not(target_os = "macos"))]
use futures::future::join_all;
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
    domain::{
        DownloadProgress, HardwareAccelerationInfo, HardwareEncoderInfo, HardwareEncoderProvider,
        VideoConversionOptions,
    },
    error::{AppError, AppResult},
    integration::{
        process::{configure_grouped_background_process, terminate_process_tree},
        yt_dlp::{RunnerEvent, redact},
    },
};

#[cfg(not(target_os = "macos"))]
use crate::integration::process::configure_background_process;

#[cfg(not(target_os = "macos"))]
use crate::domain::HardwareCodec;

#[cfg(not(target_os = "macos"))]
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

pub async fn inspect_hardware_acceleration(ffmpeg: Option<&Path>) -> HardwareAccelerationInfo {
    #[cfg(target_os = "macos")]
    {
        let _ = ffmpeg;
        HardwareAccelerationInfo::unavailable(
            "unsupported_platform",
            "Automatic NVENC and AMF acceleration is supported on Windows and Linux. The bundled macOS engine uses software conversion in this release.",
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let Some(ffmpeg) = ffmpeg else {
            return HardwareAccelerationInfo::unavailable(
                "build_missing",
                "FFmpeg is unavailable, so GPU acceleration cannot be checked.",
            );
        };
        let encoders_output = match run_probe(ffmpeg, &["-hide_banner", "-encoders"]).await {
            Ok(value) => {
                String::from_utf8_lossy(&value.stdout).into_owned()
                    + &String::from_utf8_lossy(&value.stderr)
            }
            Err(message) => {
                return HardwareAccelerationInfo::unavailable("probe_failed", message);
            }
        };
        let hwaccels_output = match run_probe(ffmpeg, &["-hide_banner", "-hwaccels"]).await {
            Ok(value) => {
                String::from_utf8_lossy(&value.stdout).into_owned()
                    + &String::from_utf8_lossy(&value.stderr)
            }
            Err(message) => {
                return HardwareAccelerationInfo::unavailable("probe_failed", message);
            }
        };
        let cuda_decode_compiled = hwaccels_output
            .lines()
            .any(|line| line.trim().eq_ignore_ascii_case("cuda"));
        let d3d11_decode_compiled = cfg!(windows)
            && hwaccels_output
                .lines()
                .any(|line| line.trim().eq_ignore_ascii_case("d3d11va"));
        let candidates = [HardwareEncoderProvider::Nvenc, HardwareEncoderProvider::Amf]
            .into_iter()
            .flat_map(|provider| {
                [HardwareCodec::H264, HardwareCodec::Hevc, HardwareCodec::Av1]
                    .into_iter()
                    .map(move |codec| (provider.clone(), codec))
            });
        let probes = join_all(candidates.map(|(provider, codec)| async {
            let encoder = provider.encoder_name(&codec).to_string();
            let compiled = encoder_line_present(&encoders_output, &encoder);
            let (available, message, probe_file) = if compiled {
                runtime_encoder_probe(ffmpeg, &provider, &codec).await
            } else {
                (
                    false,
                    Some(format!("{encoder} is not included in this FFmpeg build.")),
                    None,
                )
            };
            (
                provider, codec, encoder, compiled, available, message, probe_file,
            )
        }))
        .await;
        let mut encoders = Vec::new();
        for (provider, codec, encoder, compiled, available, message, probe_file) in probes {
            let decode_backend = match provider {
                HardwareEncoderProvider::Nvenc if cuda_decode_compiled => Some("cuda"),
                HardwareEncoderProvider::Amf if d3d11_decode_compiled => Some("d3d11va"),
                _ => None,
            };
            let decode_available = if available && codec == HardwareCodec::H264 {
                match (decode_backend, probe_file.as_deref()) {
                    (Some(backend), Some(path)) => {
                        runtime_decoder_probe(ffmpeg, path, backend).await
                    }
                    _ => false,
                }
            } else {
                false
            };
            if let Some(path) = probe_file {
                let _ = tokio::fs::remove_file(path).await;
            }
            encoders.push(HardwareEncoderInfo {
                provider: provider.clone(),
                codec,
                encoder,
                compiled,
                available,
                decode_backend: decode_backend.map(str::to_string),
                decode_available,
                message,
            });
        }
        for provider in [HardwareEncoderProvider::Nvenc, HardwareEncoderProvider::Amf] {
            let provider_decode_available = encoders.iter().any(|encoder| {
                encoder.provider == provider
                    && encoder.codec == HardwareCodec::H264
                    && encoder.decode_available
            });
            for encoder in encoders
                .iter_mut()
                .filter(|encoder| encoder.provider == provider && encoder.available)
            {
                encoder.decode_available = provider_decode_available;
            }
        }
        let any_available = encoders.iter().any(|encoder| encoder.available);
        let nvenc_ready = encoders
            .iter()
            .any(|encoder| encoder.provider == HardwareEncoderProvider::Nvenc && encoder.available);
        let amf_ready = encoders
            .iter()
            .any(|encoder| encoder.provider == HardwareEncoderProvider::Amf && encoder.available);
        HardwareAccelerationInfo {
            status: if any_available {
                "available"
            } else if encoders.iter().any(|encoder| encoder.compiled) {
                "driver_or_gpu_missing"
            } else {
                "build_missing"
            }
            .into(),
            encoders,
            message: if nvenc_ready && amf_ready {
                "NVIDIA NVENC and AMD AMF are ready. The app selects the available encoder automatically."
            } else if nvenc_ready {
                "NVIDIA NVENC is ready and will be selected automatically."
            } else if amf_ready {
                "AMD AMF is ready and will be selected automatically."
            } else {
                "The bundled engine supports NVENC and AMF, but no compatible GPU and installed driver were detected."
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
    provider: &HardwareEncoderProvider,
    codec: &HardwareCodec,
) -> (bool, Option<String>, Option<PathBuf>) {
    let encoder = provider.encoder_name(codec);
    let probe_file = if *codec == HardwareCodec::H264 {
        Some(std::env::temp_dir().join(format!("yt-dlp-desktop-gpu-probe-{}.h264", Uuid::new_v4())))
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
    ];
    append_encoder_options(&mut args, provider, 23);
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
async fn runtime_decoder_probe(ffmpeg: &Path, input: &Path, backend: &str) -> bool {
    let input = input.to_string_lossy();
    let output_format = if backend == "cuda" { "cuda" } else { "d3d11" };
    run_probe(
        ffmpeg,
        &[
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-hwaccel",
            backend,
            "-hwaccel_output_format",
            output_format,
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

fn append_encoder_options(args: &mut Vec<String>, provider: &HardwareEncoderProvider, quality: u8) {
    match provider {
        HardwareEncoderProvider::Nvenc => args.extend([
            "-preset".into(),
            "p5".into(),
            "-tune".into(),
            "hq".into(),
            "-rc".into(),
            "vbr".into(),
            "-cq".into(),
            quality.to_string(),
            "-b:v".into(),
            "0".into(),
        ]),
        HardwareEncoderProvider::Amf => args.extend([
            "-usage".into(),
            "transcoding".into(),
            "-quality".into(),
            "quality".into(),
            "-rc".into(),
            "qvbr".into(),
            "-qvbr_quality_level".into(),
            quality.to_string(),
        ]),
    }
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
    configure_background_process(&mut command);
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

pub async fn run_hardware_conversion(
    ffmpeg: &Path,
    input: &Path,
    options: &VideoConversionOptions,
    encoder: &HardwareEncoderInfo,
    cancel: CancellationToken,
    events: tokio::sync::mpsc::UnboundedSender<RunnerEvent>,
) -> AppResult<ConversionOutcome> {
    let input = tokio::fs::canonicalize(input).await?;
    if !tokio::fs::metadata(&input).await?.is_file() {
        return Err(AppError::Validation(
            "The downloaded source is not a regular file".into(),
        ));
    }
    let output_path = available_output_path(&input, &encoder.provider)?;
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
    if options.use_hardware_decode && encoder.decode_available {
        let backend = encoder
            .decode_backend
            .as_deref()
            .ok_or_else(|| AppError::Process("GPU decoder backend is unavailable".into()))?;
        command
            .arg("-hwaccel")
            .arg(backend)
            .arg("-hwaccel_output_format")
            .arg(if backend == "cuda" { "cuda" } else { "d3d11" });
    }
    command
        .arg("-i")
        .arg(&input)
        .args(["-map", "0", "-c", "copy", "-c:v:0"])
        .arg(&encoder.encoder);
    let mut encoder_args = Vec::new();
    append_encoder_options(&mut encoder_args, &encoder.provider, options.quality);
    command
        .args(encoder_args)
        .args([
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
    configure_grouped_background_process(&mut command);
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
            let line: String = redact(&line).chars().take(1000).collect();
            let mut guard = diagnostic_state.lock().await;
            if guard.len() >= 150 {
                guard.remove(0);
            }
            guard.push(line.clone());
            let _ = diagnostic_events.send(RunnerEvent::Diagnostic(line));
        }
    });
    let progress_events = events.clone();
    let conversion_stage = format!("{} GPU conversion", encoder.provider.label());
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line == "progress=continue" {
                let _ = progress_events.send(RunnerEvent::Progress(DownloadProgress {
                    stage: Some(conversion_stage.clone()),
                    ..DownloadProgress::default()
                }));
            }
        }
    });
    let status = tokio::select! {
        result = child.wait() => Some(result?),
        _ = cancel.cancelled() => {
            terminate_process_tree(pid, true).await;
            sleep(Duration::from_secs(2)).await;
            if child.try_wait()?.is_none() {
                terminate_process_tree(pid, false).await;
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
                output_path: input,
                diagnostics: captured,
                cancelled: true,
            })
        }
        Some(status) if status.success() => {
            let current_input = tokio::fs::canonicalize(&input).await?;
            if current_input != input || !tokio::fs::metadata(&current_input).await?.is_file() {
                let _ = tokio::fs::remove_file(&temporary_path).await;
                return Err(AppError::Validation(
                    "The downloaded source changed while it was being converted".into(),
                ));
            }
            tokio::fs::rename(&temporary_path, &output_path).await?;
            tokio::fs::remove_file(&input).await?;
            Ok(ConversionOutcome {
                output_path,
                diagnostics: captured,
                cancelled: false,
            })
        }
        Some(status) => {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            Err(AppError::Process(format!(
                "{} conversion exited with {status}. The original download was kept.",
                encoder.provider.label()
            )))
        }
    }
}

fn available_output_path(input: &Path, provider: &HardwareEncoderProvider) -> AppResult<PathBuf> {
    let parent = input
        .parent()
        .ok_or_else(|| AppError::Validation("The download has no parent folder".into()))?;
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    for index in 1..=100 {
        let label = match provider {
            HardwareEncoderProvider::Nvenc => "NVENC",
            HardwareEncoderProvider::Amf => "AMF",
        };
        let suffix = if index == 1 {
            format!(" [{label}]")
        } else {
            format!(" [{label} {index}]")
        };
        let candidate = parent.join(format!("{stem}{suffix}.mkv"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::Validation(
        "Could not choose a unique GPU-converted output filename".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_encoder_names_as_fields_not_substrings() {
        let fixture = " V....D h264_nvenc NVIDIA NVENC H.264 encoder\n V....D hevc_nvenc encoder\n V....D h264_amf AMD AMF H.264 encoder";
        assert!(encoder_line_present(fixture, "h264_nvenc"));
        assert!(encoder_line_present(fixture, "hevc_nvenc"));
        assert!(encoder_line_present(fixture, "h264_amf"));
        assert!(!encoder_line_present(fixture, "av1_nvenc"));
    }

    #[test]
    fn uses_provider_specific_encoder_options() {
        let mut nvenc = Vec::new();
        append_encoder_options(&mut nvenc, &HardwareEncoderProvider::Nvenc, 21);
        assert!(nvenc.windows(2).any(|pair| pair == ["-cq", "21"]));
        assert!(!nvenc.iter().any(|value| value == "-qvbr_quality_level"));

        let mut amf = Vec::new();
        append_encoder_options(&mut amf, &HardwareEncoderProvider::Amf, 24);
        assert!(amf.windows(2).any(|pair| pair == ["-usage", "transcoding"]));
        assert!(
            amf.windows(2)
                .any(|pair| pair == ["-qvbr_quality_level", "24"])
        );
        assert!(!amf.iter().any(|value| value == "-cq"));
    }

    #[test]
    fn chooses_a_non_destructive_sibling_name() {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("video.webm");
        std::fs::write(&input, b"source").unwrap();
        let output = available_output_path(&input, &HardwareEncoderProvider::Amf).unwrap();
        assert_eq!(output.file_name().unwrap(), "video [AMF].mkv");
        assert!(input.exists());
    }
}
