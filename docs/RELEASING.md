# Release runbook

## Release policy

Stable releases are built only from a signed `vMAJOR.MINOR.PATCH` tag after the native CI and package-smoke workflows pass. The tag, `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` must contain the same version. Do not publish a package built from a dirty tree.

Releases are numbered from 1.0.0 (v0.1.0 to v0.1.14 came before and stay as published). Raise PATCH for fixes and MINOR for new features.

Official packages include the exact yt-dlp, Deno, FFmpeg, and FFprobe builds in `packaging/components.json`. Updating any component requires reviewing its release notes and license notices, independently calculating every asset hash, preserving a durable corresponding-source path, running the fake-process integration suite, and completing installation/download/cancellation smoke tests on each platform.

## Local verification

```powershell
pnpm install --frozen-lockfile
./scripts/prepare-sidecars.ps1
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features
pnpm tauri build --bundles nsis
```

Use `./scripts/prepare-sidecars.sh <rust-target>` on macOS/Linux and replace the bundle list with `dmg`, or `deb,appimage`, respectively. Pass an explicit architecture as `pnpm tauri build --target <rust-target> --bundles <bundles>`.

## Native package matrix

| Platform | Rust/sidecar target | Packages |
|---|---|---|
| Windows 10 22H2/11 x64 | `x86_64-pc-windows-msvc` | NSIS `.exe` |
| macOS 12+ Intel | `x86_64-apple-darwin` | `.dmg`, plus `.app.tar.gz` for updates |
| macOS 12+ Apple silicon | `aarch64-apple-darwin` | `.dmg`, plus `.app.tar.gz` for updates |
| Linux x64, glibc 2.28+ | `x86_64-unknown-linux-gnu` | `.deb`, AppImage |

The `Package smoke` workflow creates unsigned internal artifacts on demand and on `main`. The `Release` workflow is tag-only and protected by the `release` GitHub environment. After every platform package and the FFmpeg source-materials archive succeed, it publishes a stable release with generated notes, checksums, build-provenance attestations, and installers. Until Windows Authenticode and Apple signing/notarization credentials are configured, release notes must clearly warn that operating systems may show an unknown-publisher prompt.

## Signing credentials

Configure these as GitHub environment secrets; never put them in repository variables, logs, or local `.env` files:

- Tauri updater: `TAURI_SIGNING_PRIVATE_KEY` is set in the `release` environment; add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the key is replaced by one with a password.
- Apple: `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and App Store Connect issuer/key credentials for notarization.
- Windows: an organization code-signing certificate/provider credential accepted by the selected signing service. Keep the service-specific command in the protected release environment.

## App updates

Installed apps check `https://github.com/NitroDiesel/yt-dlp-desktop/releases/latest/download/latest.json`. The Release workflow signs the NSIS installer, the AppImage, the `.deb`, and a `.tar.gz` of each macOS `.app` with the updater key, binding each signature to the release version, then writes `latest.json` and publishes it with the `.sig` files. Version 1.0.0 and earlier have no updater, so their users install 1.1.0 by hand once.

- Key custody: the maintainer keeps the private key offline, outside the repository, and backed up. Installed apps trust only the public key in `src-tauri/tauri.conf.json`; if the private key is lost, no further update can be delivered and users must reinstall once.
- Key rotation: publish a release whose `tauri.conf.json` carries the new public key, still signed with the old key, then sign later releases with the new key.
- Compromised key: rotate as above at once, delete the `release` environment secret, and post a security advisory.
- Bad release: the updater installs only versions newer than the running one, so publish a fixed, higher version. Deleting the bad release makes `releases/latest` point back to the previous one, which stops further installs of the bad version.

## Manual smoke checklist

Run on a clean non-developer account for every package:

1. Install without administrator elevation where the package supports it.
2. Launch from the normal application menu—not a terminal—and confirm yt-dlp, Deno, FFmpeg, and FFprobe show as bundled/available.
3. Analyze and download one authorized single video with no system yt-dlp, Python, Deno, or FFmpeg installed.
4. Confirm the file appears at the chosen destination and Open/Reveal cannot target an arbitrary path.
5. Start a long authorized download, cancel it, and confirm no child process remains.
6. Queue two jobs, quit during one, relaunch, and verify recovery/interrupted states.
7. Probe a playlist, reject the full-playlist confirmation once, then download an explicit range.
8. On Windows/Linux with supported hardware, verify that only runtime-ready NVIDIA NVENC or AMD AMF codec options appear, run one automatic GPU conversion, and verify hardware decode independently when offered. On unsupported hardware, verify the reason and disabled controls; no GPU driver should be present in the package.
9. Cancel a conversion and force one conversion failure; confirm the original media remains intact and no partial output remains.
10. Exercise light/dark/system themes, keyboard focus, reduced motion, and a narrow window.
11. Inspect diagnostics for URLs, credentials, cookie contents, and home-directory leakage.
12. Install the previous release, then use Settings > Updates > Check for updates and confirm it installs this one and restarts.

## Rollback

If a release is faulty, immediately unpublish its draft/release assets, post a security advisory when appropriate, and republish the last known-good package rather than retagging. Git tags and released migration files are immutable. A database migration problem requires a forward repair release plus user-data backup guidance.
