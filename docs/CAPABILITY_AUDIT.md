# yt-dlp capability audit

Audited against the local upstream source tree at `D:\Coding2.0\yt-dlp-master`, version **2026.07.04**. The release component manifest now pins 2026.08.19, which has the same option set (all 361 long options compared). At runtime the app keeps its own copy of yt-dlp on the latest stable release.

## Release classification

- **Essential and implemented:** single media, playlists/channels, structured analysis, practical quality selection, best video/audio merging, source/converted audio, subtitles and automatic captions, metadata/thumbnail embedding, output paths/templates, retries, rate limit, proxy, cookies, progress, cancellation, diagnostics, queue, history, and recovery.
- **Advanced and implemented:** exact stream selection from the analyzed format list, container and codec preference, subtitle conversion, chapter embedding and splitting, SponsorBlock marking and removal, thumbnail/description/metadata side files, filename presets, restricted filenames, parallel fragment downloads, playlist item expressions, upload-date windows, item limits and pauses, browser/cookie-file access, custom executable paths, bounded concurrency, and runtime-detected NVENC/AMF video conversion. Every one of these is a typed control; the new-download dialog no longer offers a free-text argument box.
- **Expert-only upstream capabilities:** extractor-specific authentication, custom downloader/postprocessor behavior, and unrestricted configuration. These are intentionally not first-class UI controls.
- **Deferred:** download archive, per-component in-app updating/rollback, and signed automatic app updates. These need additional policy, provenance, or destructive-behavior design before they are safe defaults.

## UI-to-CLI mapping

| Product control | yt-dlp behavior | Notes |
|---|---|---|
| Analyze | `--dump-single-json --skip-download --no-warnings` | Normalized in Rust; probe cancellation is explicit. |
| Best available, with FFmpeg | `-f bv*+ba/b` | Lets yt-dlp merge the best compatible streams. |
| Up to Np, with FFmpeg | `-f bv*[height<=N]+ba/b[height<=N]/b` | Falls back instead of failing on an exact missing height. |
| Best single file | `-f b` | Explicit no-merge mode. |
| Pick exact streams | `-f <video>+<audio>` | Chosen from the video-only and audio-only formats in the analysis result. |
| Container | `--merge-output-format mp4\|mkv\|webm` | Video only. Requires FFmpeg. |
| Video codec preference | `-S vcodec:avc\|vp9\|av01` | Video only; sorts candidates within the chosen quality. The "Download as" group of the Video codec list, which it shares with GPU conversion. |
| Source audio | `-f ba/b` | No conversion. |
| Converted audio | `-x --audio-format <format> --audio-quality <0\|bitrate>` | Best conversion quality uses `0`; MP3, M4A, and Opus also offer 320K, 256K, 192K, and 128K. Rejected before enqueue when FFmpeg is unavailable. |
| Human subtitles | `--write-subs` | Languages use `--sub-langs`. |
| Automatic captions | `--write-auto-subs` | May be combined with human subtitles. |
| Embed subtitles | `--embed-subs` | Rejected without FFmpeg. |
| Subtitle format | `--convert-subs srt\|vtt\|ass` | Requires FFmpeg. |
| Chapters | `--embed-chapters`, `--split-chapters` | Split files land in the same destination. Requires FFmpeg. |
| SponsorBlock | `--sponsorblock-mark <categories>` or `--sponsorblock-remove <categories>` | Categories come from a fixed allowlist; at least one is required. Removal requires FFmpeg. |
| Extra files | `--write-thumbnail --convert-thumbnails jpg`, `--write-description`, `--write-info-json` | Written beside the media in the destination. |
| Simple file names | `--restrict-filenames` | ASCII only, no spaces. |
| Connections | `--concurrent-fragments <1-16>` | Speeds up fragmented (HLS/DASH) downloads. |
| Metadata | `--embed-metadata` | Enabled by default. |
| Thumbnail | `--embed-thumbnail` | Availability depends on the selected output/container. |
| Playlist range | `--playlist-items <spec>` | Empty scope with no item limit triggers a native full-playlist confirmation. |
| Upload-date window | `--dateafter <YYYYMMDD>`, `--datebefore <YYYYMMDD>` | Validated as real dates; the start must not follow the end. |
| Item limit and pause | `--max-downloads <1-10000>`, `--sleep-interval <0-600>` | Helps with large channels and site rate limits. |
| Destination | `-P <directory>` | Passed as a separate argument. |
| Filename template | `-o <template>` | Default limits the title component and includes media ID. |
| Deno runtime | `--js-runtimes deno:<path>` | Explicit bundled path; independent of `PATH`. |
| FFmpeg location | `--ffmpeg-location <path>` | Only passed when discovered or selected. |
| Proxy | `--proxy <url>` | Credential-bearing URLs are rejected. |
| Cookie file | `--cookies <path>` | File contents never enter app storage. |
| Retries | `--retries <n> --fragment-retries <n>` | App-level retry creates a clean new attempt. |
| Progress | `--newline --progress-template ...` | Parsed from an app-owned sentinel prefix. |
| Final output | `--print after_move:...` | Used to persist the completed file path. |
| Automatic GPU conversion | direct `ffmpeg` argv using the first working NVENC or AMF encoder for the requested codec | Default off. Chosen from the "Convert on GPU" group of the Video codec list, which shows codecs the GPU cannot encode as disabled. The provider is never persisted or manually selected. Writes a new MKV; source is removed only after success. |
| GPU decode | provider-specific hardware decode arguments | Advanced opt-in shown only after a real runtime decode probe; software decode remains the compatibility fallback. |

## Full option coverage

Every option group in the pinned yt-dlp `options.py`, and where each option lives. "Dialog" means the New download dialog (main form or Advanced). "Managed" means the app sets it itself and rejects it as a raw argument.

| yt-dlp group | Dialog | Settings | Managed by the app | Not exposed, and why |
|---|---|---|---|---|
| General | `--live-from-start` (live streams) | | `--ignore-config`, `--js-runtimes`, `--color`, `--flat-playlist` (analysis), `--no-abort-on-error` default | `--update*` (the app pins its own yt-dlp), `--plugin-dirs`, `--config-locations`, `--remote-components`, `--alias`, `--compat-options` (load code or config); `--wait-for-video` (upcoming streams cannot be analyzed first); `--list-extractors`, `--default-search`, `--mark-watched` (not useful in a GUI) |
| Network | | `--proxy`, `--socket-timeout`, `--impersonate`, `--force-ipv4`, `--force-ipv6` | | `--source-address` (rare multi-interface setups), `--enable-file-urls` (reads local files) |
| Geo-restriction | | `--xff` | | `--geo-verification-proxy` (rare) |
| Video selection | `--playlist-items`, `--no-playlist`, `--dateafter`, `--datebefore`, `--min-filesize`, `--max-filesize`, `--match-filters` (skip live, minimum length), `--max-downloads` | | `--yes-playlist` | `--date`, `--age-limit`, `--break-*`, `--skip-playlist-after-errors` (rare); `--download-archive` (deferred, see above); free-form `--match-filters` expressions (a query language, replaced by typed filters) |
| Authentication | | Browser cookies, cookie file | | Usernames, passwords, two-factor codes, `.netrc`, client certificates (would store secrets; browser cookies cover signed-in sites) |
| Video format | Quality presets, picked streams (`-f`), audio track language, `-S` codec preference, `--merge-output-format` | | | `--video-multistreams`, `--audio-multistreams`, `--prefer-free-formats`, `--check-formats` (rare), `-F` (the stream picker replaces it) |
| Subtitles | `--write-subs`, `--write-auto-subs`, `--sub-langs` (chips from the video plus free patterns) | | | `--sub-format` (conversion covers it), `--list-subs` (analysis lists them) |
| Download | `--concurrent-fragments`, `--playlist-random`, reversed order (`-I ::-1`), `--download-sections` (clips), `--add-headers` (Referer, User-Agent) | `--limit-rate`, `--retries`, `--fragment-retries`, `--http-chunk-size` | | `--throttled-rate`, `--retry-sleep`, `--buffer-size`, `--keep-fragments`, `--hls-use-mpegts`, `--lazy-playlist` (rare); `--downloader*` (runs other programs) |
| Workarounds | Referer and User-Agent headers | `--sleep-requests`, `--legacy-server-connect` | | `--no-check-certificates`, `--prefer-insecure` (disable transport security); `--encoding`, `--bidi-workaround`, `--sleep-subtitles` (rare) |
| Verbosity and simulation | | | `--newline`, `--progress-template`, `--progress-delta`, `--print`, `--no-simulate` | Dump, list, and simulate modes (analysis covers them); `--print-to-file`, `--write-pages`, `--dump-pages` (write outside the destination) |
| Filesystem | Filename presets (`-o`), `--restrict-filenames`, `--windows-filenames`, `--trim-filenames`, `--force-overwrites`, `--write-description`, `--write-info-json`, `--write-comments` | Default folder, filename template, `--no-mtime` | `-P`, `--no-overwrites`, `--part`, `--continue`, cookies | `--batch-file`, `--load-info-json`, `--cache-dir` (read or write outside the destination); `--output-na-placeholder`, `--write-playlist-metafiles`, `--clean-info-json` (defaults are right) |
| Thumbnails | `--write-thumbnail` with JPG, PNG, or WebP | | | `--write-all-thumbnails`, `--list-thumbnails` (rare) |
| Internet shortcuts | `--write-link` | | | Platform-specific variants (`--write-link` already picks the right one) |
| Post-processing | `-x`, `--audio-format`, `--audio-quality`, `--keep-video`, `--remux-video` (with the container choice), `--embed-subs`, `--embed-thumbnail`, `--embed-metadata`, `--embed-chapters`, `--convert-subs`, `--convert-thumbnails`, `--split-chapters`, `--remove-chapters` (plain text, escaped), `--force-keyframes-at-cuts` | | `--ffmpeg-location`; `--recode-video` and `--postprocessor-args` (GPU conversion only) | `--exec`, `--use-postprocessor` (run code); `--parse-metadata`, `--replace-in-metadata` (an expression language); `--embed-info-json`, `--xattrs`, `--concat-playlist`, `--fixup` (rare or right by default) |
| SponsorBlock | `--sponsorblock-mark`, `--sponsorblock-remove` with chosen segment kinds | | | `--sponsorblock-chapter-title`, `--sponsorblock-api` (rare) |
| Extractor | | `--extractor-retries` | | `--extractor-args` (site-specific internals), dynamic MPD and HLS discontinuity switches (rare) |

## Deliberately not exposed

The first release does not attempt to surface every upstream flag. Authentication passwords, browser-cookie extraction, arbitrary output scripting, postprocessor argument injection, impersonation, downloader substitution, and unrestricted config files are omitted because they enlarge the secret-handling or command-surface risk. The backend still accepts separately tokenized, non-conflicting expert arguments on persisted jobs for compatibility, but the interface no longer collects them; every flag behind a typed control is reserved and rejected as a raw argument.

DRM circumvention is neither implemented nor supported. Extractor behavior is ultimately controlled by upstream yt-dlp and may change as services change.
