# Release runbook

## Release policy

Stable releases are built only from a signed `vMAJOR.MINOR.PATCH` tag after the native CI and package-smoke workflows pass. The tag, `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` must contain the same version. Do not publish a package built from a dirty tree.

Official packages include the exact yt-dlp and Deno builds in `packaging/components.json`. Updating either component requires reviewing its release notes and license notices, independently calculating every asset hash, running the fake-process integration suite, and completing installation/download/cancellation smoke tests on each platform.

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
| Windows 10/11 x64 | `x86_64-pc-windows-msvc` | NSIS `.exe` |
| macOS Intel | `x86_64-apple-darwin` | `.dmg` |
| macOS Apple silicon | `aarch64-apple-darwin` | `.dmg` |
| Linux x64 | `x86_64-unknown-linux-gnu` | `.deb`, AppImage |

The `Package smoke` workflow creates unsigned internal artifacts on demand and on `main`. The `Release` workflow is tag-only, protected by the `release` GitHub environment, and creates a draft GitHub release. A maintainer verifies signatures, installs the actual uploaded packages on clean machines, then publishes the draft.

## Signing credentials

Configure these as GitHub environment secrets; never put them in repository variables, logs, or local `.env` files:

- Tauri updater: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (when updater artifacts are enabled).
- Apple: `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and App Store Connect issuer/key credentials for notarization.
- Windows: an organization code-signing certificate/provider credential accepted by the selected signing service. Keep the service-specific command in the protected release environment.

Version 0.1 intentionally does not advertise an automatic updater until the public repository URL, signing public key, and immutable release endpoint exist. Add the Tauri updater plugin only after key custody, key rotation, rollback, and compromised-release procedures are documented and tested.

## Manual smoke checklist

Run on a clean non-developer account for every package:

1. Install without administrator elevation where the package supports it.
2. Launch from the normal application menu—not a terminal—and confirm yt-dlp and Deno show as bundled/available.
3. Analyze and download one authorized single video with no system yt-dlp, Python, Deno, or FFmpeg installed.
4. Confirm the file appears at the chosen destination and Open/Reveal cannot target an arbitrary path.
5. Start a long authorized download, cancel it, and confirm no child process remains.
6. Queue two jobs, quit during one, relaunch, and verify recovery/interrupted states.
7. Probe a playlist, reject the full-playlist confirmation once, then download an explicit range.
8. Confirm an FFmpeg-only option is rejected until FFmpeg is configured.
9. Exercise light/dark/system themes, keyboard focus, reduced motion, and a narrow window.
10. Inspect diagnostics for URLs, credentials, cookie contents, and home-directory leakage.

## Rollback

If a release is faulty, immediately unpublish its draft/release assets, post a security advisory when appropriate, and republish the last known-good package rather than retagging. Git tags and released migration files are immutable. A database migration problem requires a forward repair release plus user-data backup guidance.
