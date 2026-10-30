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
- `application`: app startup, commands, persistent queue scheduling, recovery, event emission, and app updates.
- `integration/yt_dlp`: typed argument construction, metadata probing, line protocol parsing, redaction, and the child-process lifecycle.
- `integration/ffmpeg`: runtime NVENC/AMF capability probes and the cancellation-safe, non-destructive GPU conversion stage.
- `integration/dependencies`: bundled and explicitly selected custom executable discovery and version checks.
- `persistence`: migrations and SQLite queries. Migration `0001_initial.sql` is applied from the first release.
- `platform`: the narrow open, reveal, and move-to-trash adapter. It receives a persisted completed job ID, not an arbitrary path from the UI.
- `commands`: the only Tauri command surface exposed to the frontend.

## Process lifecycle

1. The UI asks Rust to probe a URL. Rust validates the input and invokes the selected yt-dlp executable directly, never through a shell.
2. The probe response is normalized into a small media contract. Stale or cancelled responses are ignored in the UI.
3. Enqueue validates the destination and options, stores the job, and notifies the scheduler.
4. The scheduler claims jobs up to the configured concurrency (1-4). Arguments are assembled as an array; conflicting expert flags are rejected.
5. yt-dlp emits a machine-readable sentinel protocol. stdout/stderr are consumed concurrently to prevent pipe deadlocks. Structured progress is emitted to the UI at most four times a second and persisted at most every two seconds; status changes and reported output files are written and emitted immediately.
6. Cancellation first targets the whole process group/tree gracefully, then force-terminates it after a bounded wait.
7. Optional GPU conversion re-checks the driver, automatically selects a working NVENC or AMF encoder for the requested codec, and writes a unique temporary MKV beside the source. The source is removed only after the GPU output is finalized; failures and cancellation preserve it.
8. Output paths are accepted only from successful child-process output, persisted, and used for open, reveal, and delete actions.

## Persistence and recovery

The database lives in the per-user Tauri application-data directory. Jobs, settings, dependency metadata, and the bounded diagnostic tail are transactional. At startup, work left in an active state is marked `interrupted`; queued work is scheduled again. Completed and failed records remain in history until the user removes them. The UI shows the queue and history as one downloads list; "Clear list" in the Completed view removes completed records from both, never the files. Removing one completed single download asks whether to keep its file or delete it too; deleting re-validates the recorded path inside the job's destination and moves the file to the Recycle Bin or Trash (the `trash` crate), never a permanent delete. A playlist records only one of its files, so its files are never deleted this way.

Settings are one JSON document; fields added after a release carry serde defaults, so older saved settings still load (for example, a missing accent color reads as Blue). The one exception to SQLite is whether the sidebar is collapsed to its icon rail: it is a window-layout preference, kept in the webview's local storage and never sent to Rust.

## Resource use

- Tool version checks run concurrently once per launch and again only on "Check again" or when a custom tool path changes.
- GPU detection runs real test encodes, so it is deferred until something needs it (opening New download or Settings, or a GPU conversion job) and cached per FFmpeg binary for the session.
- The UI subscribes to narrow store slices and memoizes download rows, so a progress event re-renders only the affected row, the status bar, and an open details panel.
- No continuously running CSS animation: status icons are static, progress moves with `transform`, and the analysis skeleton uses a stepped pulse only while a link is being read. The clip playhead follows the preview with `requestAnimationFrame` only while it plays.
- Backdrop blur is drawn only behind an open modal.
- Sidebar counts are tallied without sorting, since they recompute on every progress event.
- Analysis picks the smallest thumbnail at least 240px wide, and rows load it lazily, so a long list decodes small images. The clip preview attaches its stream only while the clip editor is open and releases the buffers when it closes.
- Release builds use link-time optimization, one codegen unit, and stripped symbols for a smaller binary.

Schema changes must be additive migrations. Released migrations are immutable. A future change that cannot be rolled back must include a backup/export path before the migration ships.

## Security boundaries

- No shell command strings are constructed.
- User expert arguments are one argv element per line and pass an allow/deny validation layer.
- Proxy URLs containing embedded credentials are rejected so secrets are not stored as plaintext settings.
- Cookie files are referenced by path; their contents are not copied into the database or diagnostics.
- Diagnostics are bounded and redact URLs, query strings, authorization/cookie-like values, and local user-directory prefixes.
- The content security policy allows only bundled UI resources and Tauri IPC.
- Bundled sidecars are pinned to exact versions and verified before packaging.
- yt-dlp is the one tool that updates after installation, because sites break old releases quickly and yt-dlp itself warns once a build is 90 days old. The app keeps a copy in `<app data>/engine/`, which is writable even where the bundled copy is not (Linux packages, macOS app bundles). It seeds that copy from the bundled build, or replaces it whenever the bundled build is newer, then runs `yt-dlp --update` on it. yt-dlp's own updater fetches the latest stable release from github.com/yt-dlp/yt-dlp and refuses a binary whose SHA-256 does not match the release's `SHA2-256SUMS`. Lookup order is: custom path, then the updated copy, then the bundled build. Automatic updates run in the background at launch, at most every 20 hours (`engine/last-update-check`), and never touch a custom yt-dlp. Every yt-dlp run passes `--no-update`, so the command-line "older than 90 days" warning does not reach the UI.
- Deno is passed explicitly to yt-dlp as the JavaScript runtime; it is not exposed as a general-purpose UI command.

## Thumbnails and clip preview

Analysis returns an https thumbnail and, when the site offers one, a single-file https stream up to 720p for the clip preview (streams with sound first). HLS, DASH, and other segmented protocols are skipped because a plain video element can't play them. The thumbnail link is saved in the job's request (a serde-default field, so older jobs still load); enqueue drops anything that isn't a plain https link. Rust then downloads the image in the background, through the configured proxy, to `<app data>/thumbnails/<job id>`, keeping only JPEG, PNG, or WebP files up to 2 MB. The list loads it through the `thumb` protocol, which serves files by job ID only, so the list works offline and after a site removes the image. If the saved copy is missing, the row uses the site's image, then the file icon. At launch, thumbnails of removed downloads are deleted and missing ones are fetched again. The content security policy allows that protocol plus https images and media for these uses only; scripts, styles, and connections stay local. The preview URL is never persisted or logged.

## App updates

The app updates itself with the Tauri updater plugin. When **Update automatically** is on, the UI asks Rust to check at launch and every six hours; Rust fetches `releases/latest/download/latest.json` from GitHub through the configured proxy. A found update installs when nothing would be interrupted: no download running or about to start, and no dialog open. The user can also install it from the status bar or Settings, and Rust refuses while a download runs; waiting downloads stay queued and resume after the restart. Development builds never check.

Every package is signed with the project's updater key (minisign; the public key is in `tauri.conf.json`), and each signature carries the version it was signed for. With `requireSignedVersion`, a tampered manifest can't pair a newer version number with an older signed package. Windows runs the NSIS installer in passive mode and it starts the app again; macOS replaces the `.app`; an AppImage replaces itself; a `.deb` installs through pkexec. Progress reaches the UI at most four times a second.

## Bundled-tools decision

Official standalone yt-dlp and Deno executables plus FFmpeg and FFprobe are packaged as Tauri sidecars. A fresh installation therefore supports best-stream merging and post-processing without asking the user to install developer tooling. Each target uses an immutable archive URL and SHA-256 digest; the packaged notices record the exact sources and build recipes. Explicitly selected custom paths remain optional expert overrides; PATH executables are never run automatically.

NVENC and AMF are runtime capabilities, not bundled drivers. The app first checks the codecs compiled into FFmpeg, then performs a real one-frame encode before showing an option. NVIDIA is preferred only when both vendors pass for the same codec; otherwise the working backend is selected automatically. GPU decoding is independently tested and remains opt-in because source codec/profile support differs by GPU. The pinned component manifest is `packaging/components.json`; notices are shipped inside every app package.
