# yt-dlp Desktop

yt-dlp Desktop is a focused, cross-platform desktop interface for [yt-dlp](https://github.com/yt-dlp/yt-dlp). The product is built with Tauri 2, Rust, React/TypeScript, Zustand, and SQLite, and ships pinned builds of yt-dlp, Deno, FFmpeg, and FFprobe so normal users do not need a terminal or separate media tooling.

The goal is not to reproduce every yt-dlp flag in a GUI. The goal is to make the useful parts of yt-dlp understandable, reliable, safe, and pleasant for desktop users while preserving an expert escape hatch where it can be exposed without weakening the process boundary.

## What we should never compromise on

### 1. The app must stay approachable

Most users should not need to know what `-f`, `--print`, postprocessors, sidecars, process groups, or JavaScript runtimes are.

Prefer product language over CLI language in the UI. Advanced controls can expose upstream concepts when necessary, but defaults and common workflows should remain obvious to someone who has never used yt-dlp in a terminal.

A new option is not automatically a new checkbox. First decide whether the capability deserves a first-class product control, belongs under advanced settings, or should remain unsupported.

### 2. Rust owns the dangerous parts

React owns presentation and short-lived UI state. Rust owns validation, process execution, process cancellation, persistence, dependency discovery, filesystem actions, platform actions, and the durable queue.

Do not move executable paths, process handles, shell-like command construction, arbitrary filesystem access, persistent queue logic, or secret-bearing values into the webview just because it is easier to implement there.

The Tauri command boundary should stay small and typed.

### 3. Never turn argv into a shell command

yt-dlp, FFmpeg, FFprobe, and Deno are launched as executables with separately constructed arguments. Keep it that way.

Never implement process execution by concatenating user input into a shell command. Never add `cmd /C`, `powershell -Command`, `sh -c`, `bash -c`, or equivalent wrappers around normal media operations.

Expert yt-dlp arguments remain one argv element per line and must continue through the validation layer. Reject conflicting or unsafe flags instead of attempting clever command-string escaping.

### 4. Downloads must survive real desktop behavior

Users close laptops, kill apps, lose connectivity, cancel jobs, change destinations, and relaunch after crashes.

The queue, history, settings, progress, errors, and diagnostics are persisted in SQLite. Keep recovery behavior deliberate. Work left active after an unexpected shutdown becomes interrupted; queued work can be scheduled again.

Do not make the UI the source of truth for durable job state.

### 5. Bundled tools are part of the product

A clean installation should be ready to analyze, download, merge, convert audio, process subtitles, and perform normal post-processing without relying on a system Python, Node.js, yt-dlp, Deno, or FFmpeg installation.

Bundled components are pinned in `packaging/components.json` with exact source assets and SHA-256 hashes. Do not silently fall back to random executables from `PATH`.

Custom executables are explicit expert overrides, not automatic discovery shortcuts.

### 6. Cross-platform means the behavior, not just the build

The supported targets are Windows x64, macOS Intel and Apple silicon, and Linux x64. A change that compiles on one machine is not automatically complete.

Think through path semantics, process termination, executable naming, permissions, packaging, open/reveal behavior, sidecar layout, and GPU capability behavior on every affected platform.

Do not introduce a platform-specific shortcut into shared behavior without containing it behind the platform or integration boundary.

## How to think about changes

Prefer the smallest model that makes the correct behavior obvious.

Do not preserve complexity simply because it already exists, and do not add abstraction because it looks architecturally impressive. Understand the product requirement, find the real boundary it belongs to, and make the smallest change that remains correct across cancellation, persistence, platform differences, and upstream yt-dlp behavior.

Fight scope creep. A downloader desktop app can easily become a generic media automation environment. That is not the goal.

If a requested feature conflicts with an established security or data-integrity boundary, explain the conflict instead of quietly weakening the boundary.

## A small glossary

Use these terms consistently when discussing the codebase:

- **user**: the person using yt-dlp Desktop.
- **frontend** or **webview**: the React/TypeScript application inside Tauri.
- **core**: the Rust application code in `src-tauri/src`.
- **command**: a typed Tauri command exposed by Rust to the frontend.
- **event**: a typed Rust-to-frontend application update such as job progress.
- **job**: one persisted download request and its lifecycle.
- **probe** or **analysis**: a metadata-only yt-dlp invocation used to inspect a URL before enqueueing work.
- **sidecar**: a bundled executable such as yt-dlp, Deno, FFmpeg, or FFprobe.
- **custom executable**: a user-selected replacement for a bundled tool.
- **expert arguments**: separately tokenized yt-dlp arguments accepted through the guarded advanced-input path.
- **component manifest**: `packaging/components.json`, the source of truth for pinned third-party executable versions, assets, and hashes.
- **upstream**: the official yt-dlp project and its documentation/releases.

## The easiest ways to damage this project

1. **Building shell commands.** Never concatenate media URLs, paths, filenames, templates, proxy values, cookie paths, or expert input into command strings. Build typed argv.
2. **Trusting arbitrary paths from the UI.** Open/reveal actions operate on persisted completed-job output paths. Do not turn the frontend into a generic file-launch API.
3. **Mutating released migrations.** Released SQLite migrations are immutable. Add a new migration instead.
4. **Losing the original during conversion.** GPU conversion is non-destructive until the replacement is fully finalized. Failure or cancellation must preserve the source.
5. **Logging secrets.** Diagnostics must remain bounded and redact URLs, query strings, cookie/auth-like values, proxy credentials, and user-directory prefixes.
6. **Running whatever is on `PATH`.** Bundled tools are the default. Custom tools must be explicitly selected and validated.
7. **Guessing yt-dlp behavior.** If a flag, output format, runtime requirement, extractor behavior, or release change matters, verify it against upstream before coding around an assumption.
8. **Updating a component version without provenance work.** A version bump is also a hash, license/notice, package, integration-test, and smoke-test change.

## Upstream yt-dlp is a contract, not an implementation detail

The desktop app wraps yt-dlp behavior, so upstream changes can affect analysis, format selection, subtitles, post-processing, JavaScript runtime requirements, progress output, extractors, authentication behavior, and supported flags.

Before changing yt-dlp integration behavior:

1. Check `packaging/components.json` to determine the version the app actually ships.
2. Review the corresponding official yt-dlp release notes and upstream documentation/source for the behavior being changed.
3. If considering an upgrade, also check the latest official release at `https://github.com/yt-dlp/yt-dlp/releases`.
4. Compare any affected CLI flags or machine-readable output with `docs/CAPABILITY_AUDIT.md` and the Rust argv/parser implementation.
5. Update tests and the capability audit when the product-to-CLI mapping changes.

At the time this file was added, the component manifest pins yt-dlp `2026.07.04`. Do not treat that sentence as the source of truth later; the manifest is authoritative.

Do not automatically chase every upstream release. Upgrade because there is a clear compatibility, extractor, runtime, security, or maintenance reason and the pinned release has been reviewed and verified.

## Hit every affected layer

A common bug in a Tauri app is fixing only the visible layer. Before calling a feature complete, walk the relevant path end to end.

- **UI.** Is the control understandable, keyboard reachable, usable in light/dark/system themes, and sensible at narrow window widths?
- **Frontend state.** Does short-lived Zustand state remain distinct from durable backend state? Are stale probe results ignored?
- **Type boundary.** Do TypeScript types and serialized Rust contracts still agree?
- **Tauri commands/events.** Is the command surface still narrow? Are errors and progress represented consistently?
- **Domain model.** Does the job/settings state machine represent the new behavior rather than encoding it as incidental UI state?
- **Validation.** Are URLs, paths, settings, and expert arguments rejected early when invalid or conflicting?
- **Persistence.** Does the change need a migration? What happens after restart or interruption?
- **Scheduler.** Does concurrency, cancellation, retry, reorder, and recovery still work?
- **yt-dlp integration.** Are argv and sentinel/progress parsing correct for the pinned upstream version?
- **FFmpeg integration.** If media transformation changes, are failure and cancellation non-destructive?
- **Dependencies.** Does the bundled/custom executable model still work?
- **Platform behavior.** Windows, macOS, and Linux may require different process/path/open-reveal handling.
- **Packaging.** Does a clean installed package still work without developer tools?
- **Docs.** User-visible behavior, capability mapping, architecture, security, or release behavior should be updated where relevant.

## How the application is divided

The intended dependency direction is roughly:

```text
React views + Zustand
        │
        │ typed Tauri commands/events
        ▼
Rust application service ───── persistent queue scheduler
        │                               │
        ├── domain                      ├── yt-dlp argv builder
        ├── SQLite persistence          ├── process runner
        ├── dependency discovery        ├── progress/sentinel parser
        └── platform adapter            └── optional FFmpeg conversion
                                                │
                                                ▼
                                  yt-dlp + Deno + FFmpeg
```

Keep orchestration out of React when it controls processes, files, persistence, or recovery.

Keep platform-specific operations behind narrow adapters instead of scattering `cfg`-specific behavior throughout unrelated modules.

## Where code lives

### Frontend

- `src/app` - top-level application composition and app-level frontend behavior.
- `src/components` - reusable presentational/UI components.
- `src/features` - feature-oriented frontend behavior.
- `src/lib` - frontend helpers and Tauri-facing utilities.
- `src/types` - TypeScript contracts/types.
- `src/styles` - application styling.
- `src/test` - frontend test support.

### Rust/Tauri core

- `src-tauri/src/domain` - serialized contracts, job state, settings, dependency metadata, and domain rules.
- `src-tauri/src/application` - startup, orchestration, persistent queue scheduling, recovery, and event emission.
- `src-tauri/src/commands` - the Tauri command surface exposed to the frontend.
- `src-tauri/src/integration/yt_dlp` - argv construction, probing, progress parsing, redaction, and yt-dlp process lifecycle.
- `src-tauri/src/integration/ffmpeg` - FFmpeg capability probes and GPU conversion behavior.
- `src-tauri/src/integration/dependencies` - bundled/custom executable discovery and version checks.
- `src-tauri/src/persistence` - SQLite access and migration-backed persistence.
- `src-tauri/src/platform` - narrow platform actions such as open/reveal.
- `src-tauri/migrations` - additive database migrations.
- `src-tauri/tests` - Rust integration coverage.

### Packaging and operations

- `packaging/components.json` - pinned third-party component versions, assets, and SHA-256 digests.
- `scripts/prepare-sidecars.ps1` - Windows sidecar preparation.
- `scripts/prepare-sidecars.sh` - macOS/Linux sidecar preparation.
- `src-tauri/binaries` - prepared Tauri sidecar location; downloaded binaries are not source artifacts to commit.
- `docs/ARCHITECTURE.md` - architecture and security decisions.
- `docs/CAPABILITY_AUDIT.md` - audited UI-to-yt-dlp capability mapping.
- `docs/RELEASING.md` - release, signing, packaging, and smoke-test runbook.
- `SECURITY.md` - security policy.

## Development setup

Install dependencies using the locked pnpm toolchain:

```text
pnpm install --frozen-lockfile
```

Prepare verified sidecars before running the real desktop app.

Windows:

```text
./scripts/prepare-sidecars.ps1
```

macOS/Linux:

```text
./scripts/prepare-sidecars.sh
```

Then run:

```text
pnpm tauri dev
```

Do not bypass checksum failures in the sidecar scripts. A mismatch means the artifact, manifest, or upstream asset needs investigation.

Use `pnpm dev` only when frontend-only Vite work is sufficient. Features involving Tauri commands, persistence, filesystem behavior, processes, native dialogs, or real sidecars need the actual Tauri app path.

## Verification

Use the smallest meaningful proof while developing, then run the full repository checks before a contribution is considered ready.

Frontend checks:

```text
pnpm lint
pnpm test
pnpm build
```

Rust checks:

```text
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features
```

Backend behavior changes should have focused tests for the state transition, validation rule, argv construction, parser behavior, persistence behavior, or process lifecycle being changed.

Frontend behavior changes should have targeted Vitest/Testing Library coverage where practical. Do not replace meaningful behavior tests with snapshots of large component trees.

For process integration, prefer deterministic fake-process fixtures over tests that depend on a live website or a specific extractor continuing to behave the same way.

Do not use sleeps as the primary synchronization mechanism for cancellation, progress, or queue behavior when an explicit event/state transition can be awaited instead.

## Testing real downloads

Do not use copyrighted or private media casually as test fixtures.

When a real network smoke test is necessary, use media you are authorized to access and avoid committing the source URL, cookies, authentication material, downloaded files, databases, or diagnostics containing private data.

Extractor failures can be upstream/service regressions rather than app regressions. Isolate whether the failure occurs in:

1. the pinned yt-dlp executable by itself,
2. the argv generated by the app,
3. parsing or process lifecycle code,
4. persistence/scheduler behavior, or
5. frontend state/rendering.

Do not paper over an upstream extractor failure with app-specific HTML scraping or service-specific hacks unless that capability explicitly belongs in this product.

## yt-dlp argument rules

- Build arguments as an array, never a command string.
- Preserve the audited product-to-CLI mapping in `docs/CAPABILITY_AUDIT.md` unless intentionally changing it.
- Prefer stable machine-readable yt-dlp output over parsing human-facing console text.
- Keep app-owned sentinel prefixes unique and test their parser behavior.
- Consume stdout and stderr concurrently so child processes cannot deadlock on full pipes.
- Keep Deno explicit through the app-selected runtime path when required by the pinned yt-dlp design.
- Pass FFmpeg location explicitly when discovered/selected; do not rely on incidental `PATH` lookup.
- Treat final output paths as trustworthy only after successful child-process output has produced and persisted them.
- Validate expert flags for conflicts with app-owned arguments and for unsafe command-surface expansion.

If upstream changes a flag or output shape, update the Rust implementation, tests, and capability audit together.

## Cancellation is a feature, not cleanup

Cancellation must stop the relevant process tree/group rather than only the immediate parent while leaving FFmpeg or another child alive.

Use graceful termination first, then force termination after a bounded wait according to the existing platform-specific lifecycle implementation.

A cancelled download must settle into a coherent persisted state. A cancelled conversion must preserve the original media and must not leave a partial replacement presented as completed output.

When adding a new subprocess stage, design its cancellation behavior before calling the stage complete.

## Persistence and migrations

SQLite is the durable source of truth.

- Released migrations are immutable.
- Schema evolution is additive through new migration files.
- State transitions should be transactional where partial updates could produce impossible job state.
- Keep diagnostic tails bounded.
- Do not store cookie contents or credential-bearing proxy URLs.
- Think through startup recovery whenever adding a new active/transient job state.

A migration that can irreversibly transform or discard user data needs an explicit backup/export and forward-repair strategy before release.

## GPU conversion

Hardware acceleration is optional. Normal downloads must not depend on NVIDIA, AMD, or vendor runtime installation.

NVENC/AMF availability is established through runtime capability probes, including a real encode test. Do not show a hardware option simply because an FFmpeg build lists an encoder name.

GPU decoding is a separate capability from GPU encoding and remains opt-in because support varies by codec, profile, driver, and device.

The conversion pipeline is intentionally non-destructive:

1. write to a unique temporary output beside the source,
2. finalize the new output successfully,
3. only then remove/replace the source when that is the intended operation.

On failure or cancellation, preserve the original.

## Security boundaries

Preserve these properties unless a deliberate architecture decision replaces them with an equally strong design:

- no shell command construction,
- no arbitrary open/reveal path supplied directly by the webview,
- no automatic execution of tools found on `PATH`,
- no plaintext storage of cookie contents,
- no credential-bearing proxy URLs in settings,
- bounded/redacted diagnostics,
- bundled-only UI resources under the CSP,
- exact pinned sidecars with verified hashes,
- Deno exposed only as the runtime used by yt-dlp, not as a general-purpose frontend command.

DRM circumvention is not a supported feature. Do not add behavior whose purpose is to bypass DRM or access controls.

## Updating bundled components

Treat a component bump as a supply-chain-sensitive change.

For yt-dlp, Deno, FFmpeg, or FFprobe updates:

1. Review the official release/change information and confirm why the update is needed.
2. Select immutable upstream assets appropriate for every supported target.
3. Independently calculate SHA-256 hashes; do not copy hashes blindly from an untrusted secondary source.
4. Update `packaging/components.json`.
5. Update third-party/license/source notices where required.
6. Run sidecar preparation and the fake-process/integration test suites.
7. Build and smoke-test the affected native packages.
8. For yt-dlp changes, re-audit product-to-CLI behavior and update `docs/CAPABILITY_AUDIT.md` when necessary.

Never commit prepared/downloaded sidecar executables to source control.

## Release integrity

Version values in these locations must remain aligned for releases:

- Git tag: `vMAJOR.MINOR.PATCH`
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Release packages come from a clean tree after native CI/package smoke checks.

Do not weaken signing, provenance, checksum, or protected-environment requirements to make a release easier. If signing credentials are unavailable, keep the release classification consistent with `docs/RELEASING.md` rather than pretending an unsigned package has guarantees it does not have.

## UI taste

The interface should feel like a purpose-built desktop utility, not a terminal wrapper rendered as a form.

- Make common choices understandable without reading yt-dlp documentation.
- Keep advanced complexity progressive rather than permanently visible.
- Prefer immediate, truthful state over decorative motion.
- Do not use continuous animation where static state or a bounded transition communicates the same thing.
- Respect reduced-motion preferences.
- Keep keyboard focus visible and interactions keyboard reachable.
- Make loading, queued, probing, downloading, post-processing, converting, interrupted, cancelled, failed, and completed states visually distinct where users must act differently.
- Error messages should explain what the user can do next without dumping raw subprocess output into the primary UI.
- Diagnostics can expose technical detail after redaction.

## Pull requests and commits

Do not open a pull request unless the maintainer asks for one.

Before a large product or architecture change, open/discuss an issue first rather than committing to a large implementation direction blindly.

Keep one primary concern per change. Avoid unrelated refactors mixed into feature or bug-fix work.

Use clear conventional-style commit subjects when practical, for example:

```text
fix(queue): preserve interrupted jobs on restart
feat(download): add bounded playlist range control
docs: refresh yt-dlp capability audit
```

A useful PR description explains the user-visible or technical problem, the chosen solution, affected platforms/layers, and how it was verified.

UI changes should include before/after screenshots when useful. Behavior involving cancellation, native packaging, installer flow, or timing may need a short recording or explicit smoke-test notes.

## Documentation rules

Documentation is part of the implementation when behavior changes.

- Product behavior and setup: `README.md` or focused docs.
- Architecture/security decisions: `docs/ARCHITECTURE.md`.
- yt-dlp product-to-CLI mapping: `docs/CAPABILITY_AUDIT.md`.
- packaging/signing/release process: `docs/RELEASING.md`.
- vulnerability/reporting policy: `SECURITY.md`.

Keep docs written from the audience's point of view. User-facing docs should not require knowledge of internal module paths unless the document is explicitly for contributors.

## When uncertain

Do not guess about:

- current yt-dlp flags or release behavior,
- extractor-specific behavior,
- Tauri platform/security behavior,
- FFmpeg/NVENC/AMF capability semantics,
- package signing/provenance requirements,
- a destructive filesystem or migration operation.

Check the relevant official upstream documentation/source, inspect the current implementation and tests, and state any remaining uncertainty before changing behavior.

The developer's explicit instruction for the task takes priority over the defaults in this file, but call out any instruction that would weaken a security boundary, risk user data, or invalidate release provenance before proceeding.