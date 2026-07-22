# yt-dlp Desktop

A focused desktop interface for [yt-dlp](https://github.com/yt-dlp/yt-dlp), built with Tauri 2, Rust, React, and SQLite.

The installer includes pinned, checksum-verified builds of **yt-dlp** and **Deno**. People who install the app do not need Python, yt-dlp, Deno, Node.js, or a terminal. FFmpeg is optional: downloads work immediately using the best compatible single file, while FFmpeg unlocks stream merging, audio conversion, and subtitle embedding.

> Download only media you are authorized to access. This project does not bypass DRM and is not affiliated with yt-dlp or supported media services.

## What it does

- Analyzes a video, playlist, or channel URL before downloading.
- Offers clear video, audio, subtitle, metadata, and destination choices.
- Persists the queue, history, settings, progress, errors, and diagnostics in SQLite.
- Supports pause, reorder, retry, cancel, reveal, and open actions.
- Restores queued work after a restart and marks unexpectedly stopped work as interrupted.
- Runs yt-dlp as a direct child process with typed arguments, bounded diagnostics, and process-tree cancellation.
- Detects bundled, managed, custom, and system tools without depending on the launch directory.

## Install

Download the package for your platform from GitHub Releases and install it normally. The first launch is ready for standard downloads. To enable merging and conversion, choose an existing FFmpeg executable in **Settings → Download engine**.

The initial release targets Windows 10/11 x64, macOS 10.15+ (Intel and Apple silicon), and common x64 Linux distributions. Packages should be signed before a public stable release; see [Releasing](docs/RELEASING.md).

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

Licensed under the GNU General Public License, version 3 or later. This license keeps redistribution compatible with the bundled official yt-dlp standalone executable, which is GPLv3+ software. See [LICENSE](LICENSE).
