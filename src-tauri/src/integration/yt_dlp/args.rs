use std::{ffi::OsString, path::Path};

use url::Url;

use crate::{
    domain::{
        AppSettings, AudioFormat, AudioQuality, DownloadRequest, IpVersion, MediaMode,
        PlaylistOrder, SponsorBlockMode,
    },
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
    // Typed UI features below; set through their controls, never as raw flags.
    "--merge-output-format",
    "-S",
    "--format-sort",
    "--convert-subs",
    "--convert-subtitles",
    "--embed-chapters",
    "--split-chapters",
    "--sponsorblock-mark",
    "--sponsorblock-remove",
    "--write-thumbnail",
    "--convert-thumbnails",
    "--write-description",
    "--write-info-json",
    "--restrict-filenames",
    "-N",
    "--concurrent-fragments",
    "--dateafter",
    "--datebefore",
    "--max-downloads",
    "--sleep-interval",
    "--min-sleep-interval",
    "--max-sleep-interval",
    "--live-from-start",
    "--no-live-from-start",
    "--wait-for-video",
    "--no-wait-for-video",
    "--min-filesize",
    "--max-filesize",
    "--match-filters",
    "--no-match-filters",
    "--break-match-filters",
    "--playlist-random",
    "--add-headers",
    "--referer",
    "--user-agent",
    "--windows-filenames",
    "--trim-filenames",
    "--trim-file-names",
    "--force-overwrites",
    "--yes-overwrites",
    "--no-overwrites",
    "-w",
    "--write-comments",
    "--get-comments",
    "--write-link",
    "--write-url-link",
    "--write-webloc-link",
    "--write-desktop-link",
    "-k",
    "--keep-video",
    "--remove-chapters",
    "--remux-video",
    "-4",
    "--force-ipv4",
    "-6",
    "--force-ipv6",
    "--socket-timeout",
    "--xff",
    "--impersonate",
    "--sleep-requests",
    "--http-chunk-size",
    "--extractor-retries",
    "--legacy-server-connect",
    "--mtime",
    "--no-mtime",
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
    validate_typed_options(&request.options)?;
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

fn validate_upload_date(value: Option<&str>, label: &str) -> AppResult<()> {
    if let Some(value) = value
        && chrono::NaiveDate::parse_from_str(value, "%Y%m%d").is_err()
    {
        return Err(AppError::Validation(format!(
            "Enter a valid {label} upload date"
        )));
    }
    Ok(())
}

fn validate_typed_options(options: &crate::domain::DownloadOptions) -> AppResult<()> {
    if options
        .concurrent_fragments
        .is_some_and(|count| !(1..=16).contains(&count))
    {
        return Err(AppError::Validation(
            "Connections must be between 1 and 16".into(),
        ));
    }
    if options
        .max_downloads
        .is_some_and(|count| !(1..=10_000).contains(&count))
    {
        return Err(AppError::Validation(
            "The download limit must be between 1 and 10,000 items".into(),
        ));
    }
    if options.sleep_interval.is_some_and(|seconds| seconds > 600) {
        return Err(AppError::Validation(
            "The pause between items can be at most 10 minutes".into(),
        ));
    }
    validate_upload_date(options.date_after.as_deref(), "earliest")?;
    validate_upload_date(options.date_before.as_deref(), "latest")?;
    if let (Some(after), Some(before)) = (&options.date_after, &options.date_before)
        && after > before
    {
        return Err(AppError::Validation(
            "The earliest upload date must be before the latest one".into(),
        ));
    }
    if options
        .sponsorblock
        .as_ref()
        .is_some_and(|sponsorblock| sponsorblock.categories.is_empty())
    {
        return Err(AppError::Validation(
            "Choose at least one SponsorBlock category".into(),
        ));
    }
    let in_range = |value: Option<u32>, range: std::ops::RangeInclusive<u32>| {
        value.is_none_or(|value| range.contains(&value))
    };
    if !in_range(options.min_filesize_mb, 1..=1_000_000)
        || !in_range(options.max_filesize_mb, 1..=1_000_000)
        || options
            .min_filesize_mb
            .zip(options.max_filesize_mb)
            .is_some_and(|(min, max)| min > max)
    {
        return Err(AppError::Validation(
            "Choose a file size range where the minimum is not above the maximum".into(),
        ));
    }
    if !in_range(options.min_duration_seconds, 1..=86_400) {
        return Err(AppError::Validation(
            "The minimum length must be between 1 second and 24 hours".into(),
        ));
    }
    if !in_range(options.trim_filenames, 20..=255) {
        return Err(AppError::Validation(
            "File names can be shortened to between 20 and 255 characters".into(),
        ));
    }
    if options.playlist_order == Some(PlaylistOrder::Reverse)
        && options
            .playlist_items
            .as_deref()
            .is_some_and(|items| !items.trim().is_empty())
    {
        return Err(AppError::Validation(
            "Use either reverse order or specific item numbers, not both".into(),
        ));
    }
    if let Some(language) = options.audio_language.as_deref()
        && (language.is_empty()
            || language.len() > 20
            || !language
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-'))
    {
        return Err(AppError::Validation("Choose a valid audio language".into()));
    }
    if let Some(referer) = options.referer.as_deref() {
        let parsed = Url::parse(referer)
            .map_err(|_| AppError::Validation("Enter a valid referrer address".into()))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || referer.len() > 2048
        {
            return Err(AppError::Validation(
                "The referrer must be an http or https address without credentials".into(),
            ));
        }
    }
    let plain_text = |value: &str, max: usize| {
        !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
    };
    if options
        .user_agent
        .as_deref()
        .is_some_and(|agent| !plain_text(agent, 512))
    {
        return Err(AppError::Validation(
            "The user agent must be a single line of up to 512 characters".into(),
        ));
    }
    if options
        .remove_chapters
        .as_deref()
        .is_some_and(|text| !plain_text(text, 200))
    {
        return Err(AppError::Validation(
            "Enter up to 200 characters of chapter title text".into(),
        ));
    }
    Ok(())
}

/// True when the request uses a feature that runs FFmpeg after downloading.
pub fn needs_ffmpeg(options: &crate::domain::DownloadOptions) -> bool {
    (options.mode == MediaMode::Audio && options.audio_format != AudioFormat::Best)
        || options.embed_subtitles
        || options.video_conversion.is_some()
        || options.clip.is_some()
        || options.container.is_some()
        || options.subtitle_format.is_some()
        || options.split_chapters
        || options.embed_chapters
        || options.write_thumbnail
        || options.remove_chapters.is_some()
        || options.sponsorblock.as_ref().is_some_and(|sponsorblock| {
            sponsorblock.mode == crate::domain::SponsorBlockMode::Remove
        })
}

/// Network and access flags shared by analysis and downloads, from Settings.
pub fn network_args(settings: &AppSettings) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    if let Some(browser) = settings.cookie_browser.as_deref() {
        args.extend(["--cookies-from-browser".into(), browser.into()]);
    } else if let Some(file) = settings.cookie_file.as_deref() {
        args.extend(["--cookies".into(), file.into()]);
    }
    if let Some(proxy) = settings.proxy.as_deref() {
        args.extend(["--proxy".into(), proxy.into()]);
    }
    match settings.ip_version {
        Some(IpVersion::Ipv4) => args.push("--force-ipv4".into()),
        Some(IpVersion::Ipv6) => args.push("--force-ipv6".into()),
        None => {}
    }
    if let Some(seconds) = settings.socket_timeout {
        args.extend(["--socket-timeout".into(), seconds.to_string().into()]);
    }
    if let Some(region) = settings.geo_bypass.as_deref() {
        args.extend(["--xff".into(), region.into()]);
    }
    if let Some(target) = settings.impersonate.as_deref() {
        args.extend(["--impersonate".into(), target.into()]);
    }
    if let Some(seconds) = settings.sleep_requests.filter(|seconds| *seconds > 0) {
        args.extend(["--sleep-requests".into(), seconds.to_string().into()]);
    }
    if let Some(retries) = settings.extractor_retries {
        args.extend(["--extractor-retries".into(), retries.to_string().into()]);
    }
    if settings.legacy_server_connect {
        args.push("--legacy-server-connect".into());
    }
    args
}

/// yt-dlp format selector for the request, or `None` to use yt-dlp's default.
fn format_selector(request: &DownloadRequest, settings: &AppSettings) -> AppResult<Option<String>> {
    let options = &request.options;
    let audio = options
        .audio_language
        .as_deref()
        .map(|language| format!("ba[language^={language}]"));
    let merging = settings.ffmpeg_path.is_some();
    let selector = match options.mode {
        MediaMode::Video => match options.quality.as_str() {
            "single" => Some("b".to_string()),
            "best" if !merging => Some("b".to_string()),
            "best" => audio.map(|audio| format!("bv*+{audio}/bv*+ba/b")),
            value @ ("2160" | "1440" | "1080" | "720") => Some(if merging {
                let preferred = audio
                    .map(|audio| format!("bv*[height<={value}]+{audio}/"))
                    .unwrap_or_default();
                format!("{preferred}bv*[height<={value}]+ba/b[height<={value}] / wv*+ba/w")
            } else {
                format!("b[height<={value}] / b")
            }),
            _ => {
                return Err(AppError::Validation(
                    "Choose a supported video quality".into(),
                ));
            }
        },
        MediaMode::Audio => {
            let fallback = if options.audio_format == AudioFormat::Best {
                "ba"
            } else {
                "ba/b"
            };
            Some(match audio {
                Some(audio) => format!("{audio}/{fallback}"),
                None => fallback.to_string(),
            })
        }
        MediaMode::Custom => Some(options.custom_format.clone().unwrap_or_default()),
    };
    Ok(selector)
}

pub fn build_download_args(
    request: &DownloadRequest,
    settings: &AppSettings,
) -> AppResult<Vec<OsString>> {
    validate_request(request)?;
    let options = &request.options;
    let event = "__YTDLP_GUI__";
    let overwrite = if options.force_overwrites {
        "--force-overwrites"
    } else {
        "--no-overwrites"
    };
    let mut args: Vec<OsString> = vec![
        "--ignore-config".into(), "--no-simulate".into(), "--newline".into(), "--color".into(), "never".into(),
        "--progress-delta".into(), "0.25".into(), overwrite.into(), "--part".into(), "--continue".into(),
        "--progress-template".into(), format!(r#"download:{event}{{"v":1,"kind":"download","status":%(progress.status|null)j,"downloadedBytes":%(progress.downloaded_bytes|null)j,"totalBytes":%(progress.total_bytes|null)j,"totalBytesEstimate":%(progress.total_bytes_estimate|null)j,"speed":%(progress.speed|null)j,"eta":%(progress.eta|null)j,"filename":%(progress.filename|null)j,"playlistIndex":%(info.playlist_index|null)j,"playlistCount":%(info.playlist_count|null)j}}"#).into(),
        "--progress-template".into(), format!(r#"postprocess:{event}{{"v":1,"kind":"postprocess","status":%(progress.status|null)j,"postprocessor":%(progress.postprocessor|null)j,"filename":%(info.filepath|null)j}}"#).into(),
        "--print".into(), format!(r#"after_move:{event}{{"v":1,"kind":"after_move","filepath":%(.filepath|null)j,"title":%(.title|null)j}}"#).into(),
        "-P".into(), OsString::from(&request.destination), "-o".into(), OsString::from(&request.filename_template),
        "--retries".into(), settings.retries.to_string().into(), "--fragment-retries".into(), settings.fragment_retries.to_string().into(),
    ];

    // Format and conversion.
    if let Some(selector) = format_selector(request, settings)? {
        args.extend(["-f".into(), selector.into()]);
    }
    if options.mode == MediaMode::Audio && options.audio_format != AudioFormat::Best {
        args.extend([
            "-x".into(),
            "--audio-format".into(),
            options.audio_format.as_str().into(),
        ]);
        if options.audio_format.supports_bitrate() {
            args.extend([
                "--audio-quality".into(),
                options.audio_quality.as_yt_dlp_value().into(),
            ]);
        }
        if options.keep_video {
            args.push("--keep-video".into());
        }
    }
    if options.mode != MediaMode::Audio {
        if let Some(container) = options.container {
            // Merged downloads use the container directly; single files are remuxed.
            args.extend([
                "--merge-output-format".into(),
                container.as_str().into(),
                "--remux-video".into(),
                container.as_str().into(),
            ]);
        }
        if let Some(codec) = options.codec_preference {
            args.extend(["-S".into(), codec.sort_key().into()]);
        }
    }

    // Timeframe.
    if let Some(clip) = options.clip.as_ref() {
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

    // Live streams.
    if options.live_from_start {
        args.push("--live-from-start".into());
    }

    // Subtitles.
    if options.write_subtitles {
        args.push("--write-subs".into());
    }
    if options.write_automatic_subtitles {
        args.push("--write-auto-subs".into());
    }
    if !options.subtitle_languages.is_empty() {
        args.extend([
            "--sub-langs".into(),
            options.subtitle_languages.join(",").into(),
        ]);
    }
    if let Some(format) = options.subtitle_format {
        args.extend(["--convert-subs".into(), format.as_str().into()]);
    }
    if options.embed_subtitles {
        args.push("--embed-subs".into());
    }

    // Metadata, chapters, and SponsorBlock.
    if options.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if options.embed_thumbnail {
        args.push("--embed-thumbnail".into());
    }
    if options.embed_chapters {
        args.push("--embed-chapters".into());
    }
    if options.split_chapters {
        args.push("--split-chapters".into());
    }
    if let Some(text) = options.remove_chapters.as_deref() {
        args.extend([
            "--remove-chapters".into(),
            format!("(?i){}", regex::escape(text.trim())).into(),
        ]);
    }
    if let Some(sponsorblock) = options.sponsorblock.as_ref() {
        let categories = sponsorblock
            .categories
            .iter()
            .map(|category| category.as_str())
            .collect::<Vec<_>>()
            .join(",");
        let flag = match sponsorblock.mode {
            SponsorBlockMode::Mark => "--sponsorblock-mark",
            SponsorBlockMode::Remove => "--sponsorblock-remove",
        };
        args.extend([flag.into(), categories.into()]);
    }

    // Files written beside the media.
    if options.write_thumbnail {
        let format = options
            .thumbnail_format
            .map_or("jpg", |format| format.as_str());
        args.extend([
            "--write-thumbnail".into(),
            "--convert-thumbnails".into(),
            format.into(),
        ]);
    }
    if options.write_description {
        args.push("--write-description".into());
    }
    if options.write_info_json || options.write_comments {
        args.push("--write-info-json".into());
    }
    if options.write_comments {
        args.push("--write-comments".into());
    }
    if options.write_link {
        args.push("--write-link".into());
    }
    if options.restrict_filenames {
        args.push("--restrict-filenames".into());
    }
    if options.windows_filenames {
        args.push("--windows-filenames".into());
    }
    if let Some(length) = options.trim_filenames {
        args.extend(["--trim-filenames".into(), length.to_string().into()]);
    }

    // Playlist and channel selection.
    if options.no_playlist {
        args.push("--no-playlist".into());
    }
    let reverse = options.playlist_order == Some(PlaylistOrder::Reverse);
    let items = options
        .playlist_items
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(reverse.then_some("::-1"));
    if let Some(items) = items {
        args.extend([
            "--yes-playlist".into(),
            "--playlist-items".into(),
            items.into(),
        ]);
    }
    if options.playlist_order == Some(PlaylistOrder::Random) {
        args.push("--playlist-random".into());
    }
    if let Some(date) = options.date_after.as_deref() {
        args.extend(["--dateafter".into(), date.into()]);
    }
    if let Some(date) = options.date_before.as_deref() {
        args.extend(["--datebefore".into(), date.into()]);
    }
    if let Some(megabytes) = options.min_filesize_mb {
        args.extend(["--min-filesize".into(), format!("{megabytes}M").into()]);
    }
    if let Some(megabytes) = options.max_filesize_mb {
        args.extend(["--max-filesize".into(), format!("{megabytes}M").into()]);
    }
    let mut filters = Vec::new();
    if options.skip_live {
        filters.push("!is_live & live_status!=is_upcoming".to_string());
    }
    if let Some(seconds) = options.min_duration_seconds {
        filters.push(format!("duration>=?{seconds}"));
    }
    if !filters.is_empty() {
        args.extend(["--match-filters".into(), filters.join(" & ").into()]);
    }
    if let Some(count) = options.max_downloads {
        args.extend(["--max-downloads".into(), count.to_string().into()]);
    }
    if let Some(seconds) = options.sleep_interval.filter(|seconds| *seconds > 0) {
        args.extend(["--sleep-interval".into(), seconds.to_string().into()]);
    }

    // Transfer.
    if let Some(count) = options.concurrent_fragments {
        args.extend(["--concurrent-fragments".into(), count.to_string().into()]);
    }
    if let Some(referer) = options.referer.as_deref() {
        args.extend(["--add-headers".into(), format!("Referer:{referer}").into()]);
    }
    if let Some(agent) = options.user_agent.as_deref() {
        args.extend(["--add-headers".into(), format!("User-Agent:{agent}").into()]);
    }
    if let Some(limit) = settings.rate_limit.as_deref() {
        args.extend(["--limit-rate".into(), limit.into()]);
    }
    if let Some(megabytes) = settings.http_chunk_size_mb {
        args.extend(["--http-chunk-size".into(), format!("{megabytes}M").into()]);
    }
    if settings.use_download_time {
        args.push("--no-mtime".into());
    }

    // Tools and network.
    if let Some(path) = settings.ffmpeg_path.as_deref() {
        args.extend(["--ffmpeg-location".into(), path.into()]);
    }
    if let Some(path) = settings.deno_path.as_deref() {
        args.extend(["--js-runtimes".into(), format!("deno:{path}").into()]);
    }
    args.extend(network_args(settings));
    args.extend(options.custom_arguments.iter().map(OsString::from));
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
                ..crate::domain::DownloadOptions::default()
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

    fn args_of(value: &DownloadRequest) -> Vec<String> {
        let settings = AppSettings {
            ffmpeg_path: Some(if cfg!(windows) {
                r"C:\ffmpeg.exe".into()
            } else {
                "/tmp/ffmpeg".into()
            }),
            ..AppSettings::default()
        };
        build_download_args(value, &settings)
            .unwrap()
            .iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn maps_interactive_features_to_typed_arguments() {
        let mut value = request();
        value.options.container = Some(crate::domain::VideoContainer::Mp4);
        value.options.codec_preference = Some(crate::domain::CodecPreference::H264);
        value.options.subtitle_format = Some(crate::domain::SubtitleFormat::Srt);
        value.options.embed_chapters = true;
        value.options.sponsorblock = Some(crate::domain::SponsorBlockOptions {
            mode: crate::domain::SponsorBlockMode::Remove,
            categories: vec![
                crate::domain::SponsorCategory::Sponsor,
                crate::domain::SponsorCategory::MusicOfftopic,
            ],
        });
        value.options.write_thumbnail = true;
        value.options.concurrent_fragments = Some(4);
        value.options.date_after = Some("20260101".into());
        value.options.max_downloads = Some(25);
        value.options.sleep_interval = Some(5);

        let args = args_of(&value);
        for pair in [
            ["--merge-output-format", "mp4"],
            ["-S", "vcodec:avc"],
            ["--convert-subs", "srt"],
            ["--sponsorblock-remove", "sponsor,music_offtopic"],
            ["--convert-thumbnails", "jpg"],
            ["--concurrent-fragments", "4"],
            ["--dateafter", "20260101"],
            ["--max-downloads", "25"],
            ["--sleep-interval", "5"],
        ] {
            assert!(
                args.windows(2).any(|window| window == pair),
                "missing {pair:?}"
            );
        }
        assert!(args.iter().any(|argument| argument == "--embed-chapters"));
        assert!(needs_ffmpeg(&value.options));
    }

    #[test]
    fn audio_downloads_ignore_video_container_and_codec() {
        let mut value = request();
        value.options.mode = MediaMode::Audio;
        value.options.container = Some(crate::domain::VideoContainer::Mkv);
        value.options.codec_preference = Some(crate::domain::CodecPreference::Av1);

        let args = args_of(&value);
        assert!(
            !args
                .iter()
                .any(|argument| argument == "--merge-output-format")
        );
        assert!(!args.iter().any(|argument| argument == "-S"));
    }

    #[test]
    fn rejects_out_of_range_interactive_values() {
        let cases: Vec<fn(&mut crate::domain::DownloadOptions)> = vec![
            |options| options.concurrent_fragments = Some(0),
            |options| options.concurrent_fragments = Some(17),
            |options| options.max_downloads = Some(0),
            |options| options.sleep_interval = Some(601),
            |options| options.date_after = Some("2026-01-01".into()),
            |options| options.date_before = Some("20261340".into()),
            |options| {
                options.date_after = Some("20260301".into());
                options.date_before = Some("20260101".into());
            },
            |options| {
                options.sponsorblock = Some(crate::domain::SponsorBlockOptions {
                    mode: crate::domain::SponsorBlockMode::Mark,
                    categories: vec![],
                });
            },
        ];
        for apply in cases {
            let mut value = request();
            apply(&mut value.options);
            assert!(validate_request(&value).is_err());
        }
    }

    #[test]
    fn reserves_interactive_feature_flags() {
        for flag in [
            "--merge-output-format=mkv",
            "-Sres",
            "--sponsorblock-remove=all",
            "--split-chapters",
            "--concurrent-fragments=8",
            "--dateafter=20200101",
        ] {
            let mut value = request();
            value.options.custom_arguments = vec![flag.into()];
            assert!(
                validate_request(&value).is_err(),
                "{flag} should be rejected"
            );
        }
    }

    #[test]
    fn maps_selection_live_file_and_header_options() {
        let mut value = request();
        value.is_playlist = true;
        value.options.audio_language = Some("ja".into());
        value.options.no_playlist = true;
        value.options.live_from_start = true;
        value.options.min_filesize_mb = Some(5);
        value.options.max_filesize_mb = Some(900);
        value.options.skip_live = true;
        value.options.min_duration_seconds = Some(60);
        value.options.playlist_order = Some(crate::domain::PlaylistOrder::Reverse);
        value.options.referer = Some("https://example.com/page".into());
        value.options.user_agent = Some("Mozilla/5.0 Test".into());
        value.options.windows_filenames = true;
        value.options.trim_filenames = Some(120);
        value.options.force_overwrites = true;
        value.options.write_comments = true;
        value.options.write_link = true;
        value.options.remove_chapters = Some("Intro (part 1)".into());

        let args = args_of(&value);
        for pair in [
            [
                "-f",
                "bv*[height<=1080]+ba[language^=ja]/bv*[height<=1080]+ba/b[height<=1080] / wv*+ba/w",
            ],
            ["--min-filesize", "5M"],
            ["--max-filesize", "900M"],
            [
                "--match-filters",
                "!is_live & live_status!=is_upcoming & duration>=?60",
            ],
            ["--playlist-items", "::-1"],
            ["--add-headers", "Referer:https://example.com/page"],
            ["--add-headers", "User-Agent:Mozilla/5.0 Test"],
            ["--trim-filenames", "120"],
            ["--remove-chapters", r"(?i)Intro \(part 1\)"],
        ] {
            assert!(
                args.windows(2).any(|window| window == pair),
                "missing {pair:?}"
            );
        }
        for flag in [
            "--no-playlist",
            "--live-from-start",
            "--windows-filenames",
            "--force-overwrites",
            "--write-info-json",
            "--write-comments",
            "--write-link",
        ] {
            assert!(
                args.iter().any(|argument| argument == flag),
                "missing {flag}"
            );
        }
        assert!(!args.iter().any(|argument| argument == "--no-overwrites"));
    }

    #[test]
    fn applies_network_settings_to_downloads() {
        let settings = AppSettings {
            ip_version: Some(crate::domain::IpVersion::Ipv4),
            socket_timeout: Some(30),
            geo_bypass: Some("US".into()),
            impersonate: Some("chrome".into()),
            sleep_requests: Some(2),
            extractor_retries: Some(5),
            legacy_server_connect: true,
            use_download_time: true,
            http_chunk_size_mb: Some(10),
            ..AppSettings::default()
        };
        let args = build_download_args(&request(), &settings)
            .unwrap()
            .iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        for pair in [
            ["--socket-timeout", "30"],
            ["--xff", "US"],
            ["--impersonate", "chrome"],
            ["--sleep-requests", "2"],
            ["--extractor-retries", "5"],
            ["--http-chunk-size", "10M"],
        ] {
            assert!(
                args.windows(2).any(|window| window == pair),
                "missing {pair:?}"
            );
        }
        for flag in ["--force-ipv4", "--legacy-server-connect", "--no-mtime"] {
            assert!(
                args.iter().any(|argument| argument == flag),
                "missing {flag}"
            );
        }
    }

    #[test]
    fn rejects_unsafe_header_and_selection_values() {
        let cases: Vec<fn(&mut crate::domain::DownloadOptions)> = vec![
            |options| options.referer = Some("file:///etc/passwd".into()),
            |options| options.referer = Some("https://user:pass@example.com".into()),
            |options| options.user_agent = Some("Agent\r\nCookie: x".into()),
            |options| options.audio_language = Some("en;rm".into()),
            |options| {
                options.min_filesize_mb = Some(500);
                options.max_filesize_mb = Some(10);
            },
            |options| options.trim_filenames = Some(5),
            |options| {
                options.playlist_order = Some(crate::domain::PlaylistOrder::Reverse);
                options.playlist_items = Some("1:5".into());
            },
            |options| options.remove_chapters = Some("  ".into()),
        ];
        for apply in cases {
            let mut value = request();
            apply(&mut value.options);
            assert!(validate_request(&value).is_err());
        }
    }
}
