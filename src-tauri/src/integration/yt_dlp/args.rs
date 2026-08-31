use std::{ffi::OsString, path::Path};

use url::Url;

use crate::{
    domain::{AppSettings, AudioFormat, AudioQuality, DownloadRequest, MediaMode},
    error::{AppError, AppResult},
};

const MANAGED_FLAGS: &[&str] = &[
    "--ignore-config",
    "--no-simulate",
    "--progress-template",
    "--print",
    "-P",
    "--paths",
    "-o",
    "--output",
    "-f",
    "--format",
    "-x",
    "--extract-audio",
    "--audio-format",
    "--audio-quality",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "--embed-subs",
    "--embed-metadata",
    "--embed-thumbnail",
    "--playlist-items",
    "-I",
    "--yes-playlist",
    "--no-playlist",
    "--proxy",
    "--cookies",
    "--cookies-from-browser",
    "--ffmpeg-location",
    "--retries",
    "--fragment-retries",
    "--limit-rate",
    "--js-runtimes",
    "--no-js-runtimes",
    "--recode-video",
    "--download-sections",
    "--force-keyframes-at-cuts",
    "--no-force-keyframes-at-cuts",
    "--postprocessor-args",
    "--ppa",
];

// These options escape the app's typed process and file boundaries. Keeping
// ordinary yt-dlp flags available preserves expert flexibility without letting
// a download request execute programs, load code/config, or redirect outputs.
const UNSAFE_FLAGS: &[&str] = &[
    "--alias",
    "--exec",
    "--exec-before-download",
    "--plugin-dirs",
    "--config-locations",
    "--load-info-json",
    "--downloader",
    "--downloader-args",
    "--external-downloader",
    "--external-downloader-args",
    "--use-postprocessor",
    "--print-to-file",
    "--download-archive",
    "--batch-file",
    "-a",
    "--cache-dir",
    "--netrc",
    "-n",
    "--netrc-location",
    "--netrc-cmd",
    "--write-pages",
    "--load-pages",
    "--remote-components",
    "--update",
    "--update-to",
    "-U",
    "--username",
    "-u",
    "--password",
    "-p",
    "--twofactor",
    "-2",
    "--video-password",
    "--ap-mso",
    "--ap-username",
    "--ap-password",
    "--client-certificate",
    "--client-certificate-key",
    "--client-certificate-password",
    "--simulate",
    "--skip-download",
    "-O",
];

fn matches_flag(argument: &str, flag: &str) -> bool {
    let name = argument.split_once('=').map_or(argument, |(name, _)| name);
    if flag.starts_with("--") && name.starts_with("--") {
        flag.starts_with(name)
    } else {
        name == flag
            || (flag.starts_with('-')
                && !flag.starts_with("--")
                && name.starts_with(flag)
                && name.len() > flag.len())
    }
}

pub fn validate_request(request: &DownloadRequest) -> AppResult<()> {
    let url = Url::parse(&request.url)
        .map_err(|_| AppError::Validation("Enter a valid http or https media address".into()))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Validation(
            "Only http and https media addresses are supported".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::Validation(
            "Media addresses containing usernames or passwords are not supported".into(),
        ));
    }
    if !Path::new(&request.destination).is_absolute() {
        return Err(AppError::Validation(
            "Choose an absolute destination folder".into(),
        ));
    }
    if request.filename_template.trim().is_empty() || request.filename_template.contains('\0') {
        return Err(AppError::Validation(
            "The filename template is invalid".into(),
        ));
    }
    if request.filename_template.contains('/') || request.filename_template.contains('\\') {
        return Err(AppError::Validation(
            "The filename template cannot contain folders".into(),
        ));
    }
    if request.options.mode == MediaMode::Custom
        && request
            .options
            .custom_format
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Err(AppError::Validation(
            "Enter an exact format selector".into(),
        ));
    }
    if request.options.custom_arguments.len() > 64 {
        return Err(AppError::Validation("Too many expert arguments".into()));
    }
    if let Some(conversion) = request.options.video_conversion.as_ref() {
        let maximum = 51;
        if !(1..=maximum).contains(&conversion.quality) {
            return Err(AppError::Validation(format!(
                "{} GPU quality must be between 1 and {maximum}",
                conversion.codec.label()
            )));
        }
    }
    if request.options.audio_quality != AudioQuality::Best
        && !request.options.audio_format.supports_bitrate()
    {
        return Err(AppError::Validation(
            "Choose a bitrate only for MP3, M4A, or Opus audio".into(),
        ));
    }
    if let Some(clip) = request.options.clip.as_ref() {
        let end_seconds = clip.start_seconds + clip.duration_seconds;
        if !clip.start_seconds.is_finite()
            || !clip.duration_seconds.is_finite()
            || !end_seconds.is_finite()
            || clip.start_seconds < 0.0
            || clip.duration_seconds <= 0.0
        {
            return Err(AppError::Validation(
                "Choose a valid clip with an end time after its start time".into(),
            ));
        }
        if request.is_playlist {
            return Err(AppError::Validation(
                "Clip downloads are available for one video at a time".into(),
            ));
        }
    }
    let custom_bytes = request
        .options
        .custom_arguments
        .iter()
        .map(String::len)
        .sum::<usize>();
    if custom_bytes > 64 * 1024 {
        return Err(AppError::Validation(
            "Expert arguments are too large".into(),
        ));
    }
    for argument in &request.options.custom_arguments {
        if argument.contains('\0') || argument.len() > 4096 {
            return Err(AppError::Validation(
                "An expert argument is invalid or too large".into(),
            ));
        }
        if MANAGED_FLAGS
            .iter()
            .any(|flag| matches_flag(argument, flag))
        {
            return Err(AppError::Validation(format!(
                "Expert argument conflicts with a managed option: {argument}"
            )));
        }
        if UNSAFE_FLAGS.iter().any(|flag| matches_flag(argument, flag)) {
            return Err(AppError::Validation(format!(
                "Expert argument is blocked because it can execute code or escape the selected destination: {argument}"
            )));
        }
    }
    Ok(())
}

pub fn build_download_args(
    request: &DownloadRequest,
    settings: &AppSettings,
) -> AppResult<Vec<OsString>> {
    validate_request(request)?;
    let event = "__YTDLP_GUI__";
    let mut args: Vec<OsString> = vec![
        "--ignore-config".into(), "--no-simulate".into(), "--newline".into(), "--color".into(), "never".into(),
        "--progress-delta".into(), "0.25".into(), "--no-overwrites".into(), "--part".into(), "--continue".into(),
        "--progress-template".into(), format!(r#"download:{event}{{"v":1,"kind":"download","status":%(progress.status|null)j,"downloadedBytes":%(progress.downloaded_bytes|null)j,"totalBytes":%(progress.total_bytes|null)j,"totalBytesEstimate":%(progress.total_bytes_estimate|null)j,"speed":%(progress.speed|null)j,"eta":%(progress.eta|null)j,"filename":%(progress.filename|null)j,"playlistIndex":%(info.playlist_index|null)j,"playlistCount":%(info.playlist_count|null)j}}"#).into(),
        "--progress-template".into(), format!(r#"postprocess:{event}{{"v":1,"kind":"postprocess","status":%(progress.status|null)j,"postprocessor":%(progress.postprocessor|null)j,"filename":%(info.filepath|null)j}}"#).into(),
        "--print".into(), format!(r#"after_move:{event}{{"v":1,"kind":"after_move","filepath":%(.filepath|null)j,"title":%(.title|null)j}}"#).into(),
        "-P".into(), OsString::from(&request.destination), "-o".into(), OsString::from(&request.filename_template),
        "--retries".into(), settings.retries.to_string().into(), "--fragment-retries".into(), settings.fragment_retries.to_string().into(),
    ];
    match request.options.mode {
        MediaMode::Video => match request.options.quality.as_str() {
            "best" => {
                if settings.ffmpeg_path.is_none() {
                    args.extend(["-f".into(), "b".into()]);
                }
            }
            "single" => args.extend(["-f".into(), "b".into()]),
            value @ ("2160" | "1440" | "1080" | "720") => args.extend([
                "-f".into(),
                if settings.ffmpeg_path.is_some() {
                    format!("bv*[height<={value}]+ba/b[height<={value}] / wv*+ba/w")
                } else {
                    format!("b[height<={value}] / b")
                }
                .into(),
            ]),
            _ => {
                return Err(AppError::Validation(
                    "Choose a supported video quality".into(),
                ));
            }
        },
        MediaMode::Audio => {
            if request.options.audio_format == AudioFormat::Best {
                args.extend(["-f".into(), "ba".into()]);
            } else {
                args.extend([
                    "-f".into(),
                    "ba/b".into(),
                    "-x".into(),
                    "--audio-format".into(),
                    request.options.audio_format.as_str().into(),
                ]);
                if request.options.audio_format.supports_bitrate() {
                    args.extend([
                        "--audio-quality".into(),
                        request.options.audio_quality.as_yt_dlp_value().into(),
                    ]);
                }
            }
        }
        MediaMode::Custom => args.extend([
            "-f".into(),
            request
                .options
                .custom_format
                .clone()
                .unwrap_or_default()
                .into(),
        ]),
    }
    if let Some(clip) = request.options.clip.as_ref() {
        if settings.ffmpeg_path.is_none() {
            return Err(AppError::DependencyMissing(
                "FFmpeg is required to download a selected timeframe".into(),
            ));
        }
        let end_seconds = clip.start_seconds + clip.duration_seconds;
        args.extend([
            "--download-sections".into(),
            format!(
                "*{}-{}",
                format_timestamp(clip.start_seconds),
                format_timestamp(end_seconds)
            )
            .into(),
        ]);
        if clip.precise {
            args.push("--force-keyframes-at-cuts".into());
        }
    }
    if request.options.write_subtitles {
        args.push("--write-subs".into());
    }
    if request.options.write_automatic_subtitles {
        args.push("--write-auto-subs".into());
    }
    if !request.options.subtitle_languages.is_empty() {
        args.extend([
            "--sub-langs".into(),
            request.options.subtitle_languages.join(",").into(),
        ]);
    }
    if request.options.embed_subtitles {
        args.push("--embed-subs".into());
    }
    if request.options.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if request.options.embed_thumbnail {
        args.push("--embed-thumbnail".into());
    }
    if let Some(items) = request
        .options
        .playlist_items
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.extend([
            "--yes-playlist".into(),
            "--playlist-items".into(),
            items.into(),
        ]);
    }
    if let Some(path) = settings.ffmpeg_path.as_deref() {
        args.extend(["--ffmpeg-location".into(), path.into()]);
    }
    if let Some(path) = settings.deno_path.as_deref() {
        args.extend(["--js-runtimes".into(), format!("deno:{path}").into()]);
    }
    if let Some(browser) = settings.cookie_browser.as_deref() {
        args.extend(["--cookies-from-browser".into(), browser.into()]);
    } else if let Some(file) = settings.cookie_file.as_deref() {
        args.extend(["--cookies".into(), file.into()]);
    }
    if let Some(proxy) = settings.proxy.as_deref() {
        args.extend(["--proxy".into(), proxy.into()]);
    }
    if let Some(limit) = settings.rate_limit.as_deref() {
        args.extend(["--limit-rate".into(), limit.into()]);
    }
    args.extend(request.options.custom_arguments.iter().map(OsString::from));
    args.push(OsString::from(&request.url));
    Ok(args)
}

fn format_timestamp(seconds: f64) -> String {
    let total_milliseconds = (seconds * 1000.0).round() as u64;
    let hours = total_milliseconds / 3_600_000;
    let minutes = (total_milliseconds % 3_600_000) / 60_000;
    let seconds = (total_milliseconds % 60_000) / 1000;
    let milliseconds = total_milliseconds % 1000;
    format!("{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> DownloadRequest {
        DownloadRequest {
            url: "https://example.com/watch?v=1".into(),
            destination: if cfg!(windows) {
                r"C:\Downloads".into()
            } else {
                "/tmp".into()
            },
            filename_template: "%(title)s.%(ext)s".into(),
            is_playlist: false,
            options: crate::domain::DownloadOptions {
                mode: MediaMode::Video,
                quality: "1080".into(),
                audio_format: AudioFormat::Best,
                audio_quality: AudioQuality::Best,
                subtitle_languages: vec![],
                write_subtitles: false,
                write_automatic_subtitles: false,
                embed_subtitles: false,
                embed_metadata: true,
                embed_thumbnail: false,
                playlist_items: None,
                custom_format: None,
                custom_arguments: vec![],
                clip: None,
                video_conversion: None,
            },
        }
    }
    #[test]
    fn builds_quality_cap_without_shell_string() {
        let args = build_download_args(&request(), &AppSettings::default()).unwrap();
        assert!(
            args.iter()
                .any(|arg| arg.to_string_lossy().contains("height<=1080"))
        );
        assert_eq!(args.last().unwrap(), "https://example.com/watch?v=1");
    }

    #[test]
    fn applies_selected_audio_bitrate_during_lossy_conversion() {
        let mut value = request();
        value.options.mode = MediaMode::Audio;
        value.options.audio_format = AudioFormat::Mp3;
        value.options.audio_quality = AudioQuality::Kbps320;
        let settings = AppSettings {
            ffmpeg_path: Some(if cfg!(windows) {
                r"C:\ffmpeg.exe".into()
            } else {
                "/tmp/ffmpeg".into()
            }),
            ..AppSettings::default()
        };

        let args = build_download_args(&value, &settings)
            .unwrap()
            .iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2)
                .any(|pair| pair == ["--audio-format", "mp3"])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--audio-quality", "320K"])
        );
    }

    #[test]
    fn rejects_bitrate_for_lossless_or_source_audio() {
        let mut value = request();
        value.options.mode = MediaMode::Audio;
        value.options.audio_format = AudioFormat::Flac;
        value.options.audio_quality = AudioQuality::Kbps320;

        assert!(validate_request(&value).is_err());
    }

    #[test]
    fn explicitly_requests_the_best_lossy_conversion_quality() {
        let mut value = request();
        value.options.mode = MediaMode::Audio;
        value.options.audio_format = AudioFormat::Opus;

        let args = build_download_args(&value, &AppSettings::default())
            .unwrap()
            .iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(args.windows(2).any(|pair| pair == ["--audio-quality", "0"]));
    }

    #[test]
    fn builds_a_precise_typed_clip_range() {
        let mut value = request();
        value.options.clip = Some(crate::domain::ClipOptions {
            start_seconds: 12.5,
            duration_seconds: 18.25,
            precise: true,
        });
        let settings = AppSettings {
            ffmpeg_path: Some(if cfg!(windows) {
                r"C:\ffmpeg.exe".into()
            } else {
                "/tmp/ffmpeg".into()
            }),
            ..AppSettings::default()
        };

        let args = build_download_args(&value, &settings).unwrap();
        let args = args
            .iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(
            args.windows(2)
                .any(|pair| { pair == ["--download-sections", "*00:00:12.500-00:00:30.750"] })
        );
        assert!(
            args.iter()
                .any(|argument| argument == "--force-keyframes-at-cuts")
        );
    }

    #[test]
    fn rejects_invalid_or_playlist_clip_ranges() {
        let mut value = request();
        value.options.clip = Some(crate::domain::ClipOptions {
            start_seconds: 10.0,
            duration_seconds: 0.0,
            precise: false,
        });
        assert!(validate_request(&value).is_err());

        value.options.clip = Some(crate::domain::ClipOptions {
            start_seconds: 10.0,
            duration_seconds: 5.0,
            precise: false,
        });
        value.is_playlist = true;
        assert!(validate_request(&value).is_err());
    }

    #[test]
    fn requires_ffmpeg_for_clip_downloads() {
        let mut value = request();
        value.options.clip = Some(crate::domain::ClipOptions {
            start_seconds: 5.0,
            duration_seconds: 10.0,
            precise: false,
        });

        assert!(build_download_args(&value, &AppSettings::default()).is_err());
    }

    #[test]
    fn reserves_clip_flags_for_the_typed_feature() {
        for flag in [
            "--download-sections=*00:00:05-00:00:15",
            "--force-keyframes-at-cuts",
            "--no-force-keyframes-at-cuts",
        ] {
            let mut value = request();
            value.options.custom_arguments = vec![flag.into()];
            assert!(build_download_args(&value, &AppSettings::default()).is_err());
        }
    }

    #[test]
    fn rejects_managed_custom_flags() {
        let mut value = request();
        value.options.custom_arguments = vec!["--proxy".into()];
        assert!(build_download_args(&value, &AppSettings::default()).is_err());
    }
    #[test]
    fn rejects_non_web_urls() {
        let mut value = request();
        value.url = "file:///secret".into();
        assert!(build_download_args(&value, &AppSettings::default()).is_err());
    }

    #[test]
    fn rejects_url_credentials() {
        let mut value = request();
        value.url = "https://user:secret@example.com/video".into();
        assert!(build_download_args(&value, &AppSettings::default()).is_err());
    }

    #[test]
    fn rejects_code_execution_and_config_flags() {
        for flag in [
            "--exec=calc.exe",
            "--exe=calc.exe",
            "--alias",
            "--plugin-dirs=/tmp/plugin",
            "--config-locations=custom.conf",
            "--downloader=curl",
            "--external-downloader=curl",
            "--netrc-cmd=echo secret",
            "--download-archive=/tmp/archive",
            "-a/tmp/batch.txt",
            "-uprivate",
            "-psecret",
            "-2123456",
            "-n",
            "--write-pages",
            "--load-pages",
            "--remote-components=ejs:github",
            "--username=private",
            "-U",
            "-Otitle",
        ] {
            let mut value = request();
            value.options.custom_arguments = vec![flag.into()];
            assert!(build_download_args(&value, &AppSettings::default()).is_err());
        }
    }

    #[test]
    fn rejects_out_of_range_gpu_quality() {
        let mut value = request();
        value.options.video_conversion = Some(crate::domain::VideoConversionOptions {
            codec: crate::domain::HardwareCodec::H264,
            quality: 52,
            use_hardware_decode: false,
        });
        assert!(build_download_args(&value, &AppSettings::default()).is_err());
    }

    #[test]
    fn reserves_postprocessor_flags_for_typed_features() {
        for flag in ["--recode-video", "--postprocessor-args", "--ppa"] {
            let mut value = request();
            value.options.custom_arguments = vec![flag.into()];
            assert!(build_download_args(&value, &AppSettings::default()).is_err());
        }
    }
}
