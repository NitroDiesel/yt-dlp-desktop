# Agent guide

Use this file as the entrypoint for coding-agent work in this repository.

## Load the authoritative context

- Read `README.md` for current user-facing capabilities, supported platforms, bundled dependencies, and local verification commands.
- Read `docs/ARCHITECTURE.md` before changing commands, persistence, process execution, dependency discovery, GPU conversion, or filesystem actions.
- Read `docs/CAPABILITY_AUDIT.md` before changing yt-dlp option coverage.
- Read `docs/RELEASING.md` before changing versions, packaging, tags, signing, checksums, attestations, or GitHub Releases.
- Read `CONTRIBUTING.md` before opening a pull request.

The files above are the source of truth. Update the relevant document when a change makes it inaccurate.

## Product direction

yt-dlp Desktop is a focused desktop download manager, not a browser and not a chat or prompt interface. Its information architecture should feel familiar to users of conventional download managers. Its visual skin may borrow the restrained density, typography, surfaces, and dark theme of T3 Code without copying T3 Code's chat layout.

Keep the primary flow lightweight and obvious: analyze a link, choose video/audio/exact format, choose a destination, then download or queue. Put expert controls behind progressive disclosure. Remove decorative status chrome when it does not communicate state or provide an action.

A fresh installation must be ready to use. yt-dlp, Deno, FFmpeg, and FFprobe ship as pinned, checksum-verified sidecars. NVIDIA NVENC and AMD AMF are runtime capabilities detected from FFmpeg, the installed GPU, and the installed driver; vendor drivers and SDKs are not bundled.

## Engineering boundaries

- React and TypeScript own presentation and short-lived form state. Rust owns validation, durable state, process execution, cancellation, dependency resolution, and platform actions.
- Every frontend contract change must be mirrored at the Rust serde boundary and remain compatible with persisted jobs where practical.
- Build child-process arguments as typed argv elements. Keep shell execution, arbitrary executable discovery, and unmanaged output redirection outside the download path.
- Treat SQLite migrations as append-only after release. Add a migration instead of editing a released migration.
- Keep open/reveal actions tied to a validated completed job. The frontend must not send arbitrary filesystem paths to platform commands.
- Keep bundled dependency versions and checksums in `packaging/components.json`; never commit downloaded sidecar binaries.

## Completion criteria

Before proposing a merge, run every check in the README and add a regression test for changed behavior. Packaging changes also require sidecar verification and package smoke coverage on each supported target.

Keep the versions in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` aligned. A release is complete only after the pull request is merged, the tag points to `main`, the release workflow succeeds, the release is stable rather than a prerelease, and its public installers, checksums, and provenance are present.

Preserve unrelated working-tree changes and local artifacts. Material Codex-authored commits use `Co-authored-by: Codex <codex@openai.com>`.
