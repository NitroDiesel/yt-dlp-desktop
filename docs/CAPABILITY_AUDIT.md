# yt-dlp capability audit

Audited against the local upstream source tree at `D:\Coding2.0\yt-dlp-master`, version **2026.07.04**. The release component manifest pins the same version.

## Release classification

- **Essential and implemented:** single media, playlists/channels, structured analysis, practical quality selection, best video/audio merging when FFmpeg exists, source/converted audio, subtitles and automatic captions, metadata/thumbnail embedding, output paths/templates, retries, rate limit, proxy, cookies, progress, cancellation, diagnostics, queue, history, and recovery.
- **Advanced and implemented:** exact format selection, playlist item expressions, browser/cookie-file access, custom executable paths, bounded concurrency, and separately tokenized non-conflicting expert arguments.
- **Expert-only upstream capabilities:** extractor-specific authentication, custom downloader/postprocessor behavior, and unrestricted configuration. These are intentionally not first-class UI controls.
- **Deferred:** chapters/SponsorBlock controls, download archive, managed FFmpeg, per-component in-app updating/rollback, and signed automatic app updates. These need additional policy, provenance, or destructive-behavior design before they are safe defaults.

## UI-to-CLI mapping

| Product control | yt-dlp behavior | Notes |
|---|---|---|
| Analyze | `--dump-single-json --skip-download --no-warnings` | Normalized in Rust; probe cancellation is explicit. |
| Best available, with FFmpeg | `-f bv*+ba/b` | Lets yt-dlp merge the best compatible streams. |
| Best available, without FFmpeg | `-f b` | Safe fresh-install default; no merge dependency. |
| Up to Np, with FFmpeg | `-f bv*[height<=N]+ba/b[height<=N]/b` | Falls back instead of failing on an exact missing height. |
| Up to Np, without FFmpeg | `-f b[height<=N]/b` | Selects one compatible file. |
| Best single file | `-f b` | Explicit no-merge mode. |
| Exact format | `-f <selector>` | Advanced selector is validated as one value. |
| Source audio | `-f ba/b` | No conversion. |
| Converted audio | `-x --audio-format <format>` | Rejected before enqueue when FFmpeg is unavailable. |
| Human subtitles | `--write-subs` | Languages use `--sub-langs`. |
| Automatic captions | `--write-auto-subs` | May be combined with human subtitles. |
| Embed subtitles | `--embed-subs` | Rejected without FFmpeg. |
| Metadata | `--embed-metadata` | Enabled by default. |
| Thumbnail | `--embed-thumbnail` | Availability depends on the selected output/container. |
| Playlist range | `--playlist-items <spec>` | Empty scope triggers a native full-playlist confirmation. |
| Destination | `-P <directory>` | Passed as a separate argument. |
| Filename template | `-o <template>` | Default limits the title component and includes media ID. |
| Deno runtime | `--js-runtimes deno:<path>` | Explicit bundled path; independent of `PATH`. |
| FFmpeg location | `--ffmpeg-location <path>` | Only passed when discovered or selected. |
| Proxy | `--proxy <url>` | Credential-bearing URLs are rejected. |
| Cookie file | `--cookies <path>` | File contents never enter app storage. |
| Retries | `--retries <n> --fragment-retries <n>` | App-level retry creates a clean new attempt. |
| Progress | `--newline --progress-template ...` | Parsed from an app-owned sentinel prefix. |
| Final output | `--print after_move:...` | Used to persist the completed file path. |

## Deliberately not exposed in 0.1

The first release does not attempt to surface every upstream flag. Authentication passwords, browser-cookie extraction, arbitrary output scripting, postprocessor argument injection, impersonation, downloader substitution, and unrestricted config files are omitted because they enlarge the secret-handling or command-surface risk. Advanced arguments are available only for non-conflicting, separately tokenized flags.

DRM circumvention is neither implemented nor supported. Extractor behavior is ultimately controlled by upstream yt-dlp and may change as services change.
