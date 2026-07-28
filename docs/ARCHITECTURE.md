# Architecture

## Decision record

The app uses a React/TypeScript view layer and a Rust application core inside Tauri 2. React owns presentation and short-lived form state. Rust owns validation, process execution, cancellation, persistence, dependency discovery, and platform actions. SQLite is the durable source of truth.

This split is intentional: URLs and user options cross a small typed command boundary, while executable paths, process handles, queue scheduling, logs, and filesystem actions never live in the web view.

```text
React views + Zustand store
          │ typed Tauri commands/events
          ▼
Application service ───── Queue scheduler
          │                    │
          ├── SQLite           ├── typed argv builder
          ├── dependency scan  ├── child-process runner
          └── platform adapter └── sentinel/progress parser
                                  │
                                  ▼
                      yt-dlp + Deno + FFmpeg
```

## Modules

- `domain`: serialized contracts, job state machine, settings, dependency metadata, and error categories.
- `application`: app startup, commands, persistent queue scheduling, recovery, and event emission.
- `integration/yt_dlp`: typed argument construction, metadata probing, line protocol parsing, redaction, and the child-process lifecycle.
- `integration/ffmpeg`: NVIDIA capability probes and the cancellation-safe, non-destructive NVENC conversion stage.
- `integration/dependencies`: bundled/managed/custom/system executable discovery and version checks.
- `persistence`: migrations and SQLite queries. Migration `0001_initial.sql` is applied from the first release.
- `platform`: the narrow open/reveal adapter. It receives a persisted completed job ID, not an arbitrary path from the UI.
- `commands`: the only Tauri command surface exposed to the frontend.

## Process lifecycle

1. The UI asks Rust to probe a URL. Rust validates the input and invokes the selected yt-dlp executable directly—never through a shell.
2. The probe response is normalized into a small media contract. Stale or cancelled responses are ignored in the UI.
3. Enqueue validates the destination and options, stores the job, and notifies the scheduler.
4. The scheduler claims jobs up to the configured concurrency (1–4). Arguments are assembled as an array; conflicting expert flags are rejected.
5. yt-dlp emits a machine-readable sentinel protocol. stdout/stderr are consumed concurrently to prevent pipe deadlocks. Structured progress is persisted and emitted to the UI.
6. Cancellation first targets the whole process group/tree gracefully, then force-terminates it after a bounded wait.
7. Optional NVENC conversion writes a unique temporary MKV beside the source. The source is removed only after the GPU output is finalized; failures and cancellation preserve it.
8. Output paths are accepted only from successful child-process output, persisted, and used for open/reveal actions.

## Persistence and recovery

The database lives in the per-user Tauri application-data directory. Jobs, settings, dependency metadata, and the bounded diagnostic tail are transactional. At startup, work left in an active state is marked `interrupted`; queued work is scheduled again. Completed and failed records remain in history until the user clears them.

Schema changes must be additive migrations. Released migrations are immutable. A future change that cannot be rolled back must include a backup/export path before the migration ships.

## Security boundaries

- No shell command strings are constructed.
- User expert arguments are one argv element per line and pass an allow/deny validation layer.
- Proxy URLs containing embedded credentials are rejected so secrets are not stored as plaintext settings.
- Cookie files are referenced by path; their contents are not copied into the database or diagnostics.
- Diagnostics are bounded and redact URLs, query strings, authorization/cookie-like values, and local user-directory prefixes.
- The content security policy allows only bundled UI resources, Tauri IPC, and remote media thumbnails.
- Bundled sidecars are pinned to exact versions and verified before packaging.
- Deno is passed explicitly to yt-dlp as the JavaScript runtime; it is not exposed as a general-purpose UI command.

## Bundled-tools decision

Official standalone yt-dlp and Deno executables plus FFmpeg and FFprobe are packaged as Tauri sidecars. A fresh installation therefore supports best-stream merging and post-processing without asking the user to install developer tooling. Each target uses an immutable archive URL and SHA-256 digest; the packaged notices record the exact sources and build recipes. Custom/system paths remain optional overrides.

NVENC is a runtime capability, not a bundled driver. Windows/Linux builds include the NVIDIA codecs, but the app enables conversion only after a real encoder probe succeeds. CUDA decoding is separately tested and remains opt-in because source codec/profile support differs by GPU. The pinned component manifest is `packaging/components.json`; notices are shipped inside every app package.
