# yt-dlp Desktop

A focused desktop interface for [yt-dlp](https://github.com/yt-dlp/yt-dlp), built with Tauri 2, Rust, React, and SQLite.

The installer includes pinned, checksum-verified builds of **yt-dlp, FFmpeg, FFprobe, and Deno**. People who install the app do not need Python, Node.js, a terminal, or any separate media tools.

> Download only media you are authorized to access. This project does not bypass DRM and is not affiliated with yt-dlp or supported media services.

## What it does

- Analyzes a video, playlist, or channel URL before downloading.
- Offers clear video, audio, subtitle, metadata, and destination choices.
- Persists the queue, history, settings, progress, errors, and diagnostics in SQLite.
- Supports pause, reorder, retry, cancel, reveal, and open actions.
- Restores queued work after a restart and marks unexpectedly stopped work as interrupted.
- Runs yt-dlp as a direct child process with typed arguments, bounded diagnostics, and process-tree cancellation.
- Detects bundled, managed, custom, and system tools without depending on the launch directory.
- Detects usable NVIDIA NVENC/NVDEC capabilities and can optionally re-encode a completed video on the GPU.

## Install

Download the package for your platform from GitHub Releases and install it normally. The first launch is ready for analyzing, downloading, merging, audio conversion, and subtitle post-processing. Custom executable overrides in **Settings → Download engine** are optional expert controls.

The initial release targets Windows 10 22H2/11 x64, macOS 12+ (Intel and Apple silicon), and x64 Linux distributions with glibc 2.28/kernel 4.18 or newer. NVENC requires a compatible NVIDIA GPU and driver 570+ on Windows/Linux; NVIDIA acceleration is not available on macOS. Packages should be signed before a public stable release; see [Releasing](docs/RELEASING.md).

## Develop

Prerequisites for contributors:

- Rust stable
- Node.js 22 or newer and pnpm 11
- The [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)

```powershell
pnpm install --frozen-lockfile
./scripts/prepare-sidecars.ps1
pnpm tauri dev
```

On macOS or Linux, run `./scripts/prepare-sidecars.sh` instead. Sidecar preparation downloads immutable official release assets and refuses to continue if a SHA-256 checksum differs from `packaging/components.json`.

Useful checks:

```text
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features
```

## Design and implementation

- [Architecture and security decisions](docs/ARCHITECTURE.md)
- [Audited yt-dlp capability mapping](docs/CAPABILITY_AUDIT.md)
- [Release, signing, and smoke-test runbook](docs/RELEASING.md)
- [Security policy](SECURITY.md)
- [Third-party notices](src-tauri/resources/THIRD_PARTY_NOTICES.txt)

## License

Copyright © 2026 yt-dlp Desktop contributors.

Licensed under the GNU General Public License, version 3 or later. This keeps redistribution compatible with the bundled official yt-dlp standalone executable and GPL FFmpeg builds. See [LICENSE](LICENSE) and the packaged [FFmpeg notice](src-tauri/resources/FFMPEG_NOTICE.md).
