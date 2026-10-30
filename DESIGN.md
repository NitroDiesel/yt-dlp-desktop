# Design

yt-dlp Desktop looks and behaves like desktop download-manager software, not a web downloader site and not a chat app. The skin is a restrained, dense dark theme; the layout follows conventional download managers.

## Layout

The downloads page is a framed table with column headers, a large view title, and a status bar, as in conventional download managers.

```text
┌ Sidebar ───────┬ All downloads [9]                                  Pause queue ┐
│ yt-dlp Desktop │ ┌ NAME              SIZE   PROGRESS     STATUS    SPEED   ETA ┐ │
│ + New download │ │ ▣ Title           312 MB ━━━━╱╱ 42%   Downloading 2.4 MB/s 0:18│ │
│ All downloads  │ │   Format · site                                          │ │
│ Downloading    │ │ ▣ Title                  ━━━━━━ 100%  Completed           │ │
│ Completed      │ │ ▣ Error message in red   ╱╱╱╱╱╱ 0%    Needs attention     │ │
│ Stopped        │ └───────────────────────────────────────────────────────────┘ │
│ Settings       ├ ↓ 2.4 MB/s  Active 1  Waiting 1  Completed 6  Failed 1  ● Engine ready ┤
└────────────────┴────────────────────────────────────────────────────────────────┘
```

- One downloads table. Sidebar filters split it by state; there is no separate History page.
- Each row starts with the video's thumbnail inside the Name cell, the way video sites list videos; it is not a column of its own. Without a thumbnail, the file type icon takes its place.
- Progress is a rounded fill over a hatched track, with the percentage beside it. The fill is colored by state (primary while downloading, green when complete, red when failed). Empty cells stay blank.
- Columns drop out as the table narrows (container queries): Size and Speed first, then Progress and ETA.
- Selecting a row opens Download details on the right; it floats over the table in narrow windows. Escape closes it.
- New download is a modal new-task dialog: a large link box, the video's thumbnail beside its title once the link is read, then label-left rows for Download (Video or Audio only, shown before the link is read), Quality or Audio format and Bitrate, Container, Video codec, Audio track and Live stream when the video has them, and Clip. Video codec is one list with two groups: "Download as" (Any, H.264, VP9, AV1; picks the version the site already has) and "Convert on GPU" (H.264, HEVC, AV1 through the detected NVIDIA NVENC or AMD AMF encoder; codecs the GPU cannot encode are shown disabled with the reason). Choosing a GPU codec reveals its quality slider and hardware-decoding switch. For a video inside a playlist, "This link" chooses between just the video and the whole playlist. A "Save to" row has the folder button on the right. Advanced, collapsed at the bottom, holds every other yt-dlp feature as controls: subtitles, chapters, SponsorBlock, extra files, file naming, playlist filters, connections, and request headers. There is no free-text argument box. The footer is Cancel and Analyze, then Cancel, Add to queue, and Download.
- App-wide network behavior (impersonation, region, IP version, timeout, request pauses, chunking, retries) lives in Settings. `docs/CAPABILITY_AUDIT.md` maps every yt-dlp option to its control.
- Turning on Clip shows a player for only the selected part: it starts at the start mark and loops at the end mark, while a white playhead runs along a trim track whose two handles set the start and end. Dragging a handle shows the frame at that edge. Sites that only offer segmented streams (HLS, DASH) get the trim track without the player.
- It is an in-app native `<dialog>`, not a second OS window, so no second webview is started. Behind every modal (New download, Settings, Remove download), the app is dimmed and blurred.
- Pasting a link anywhere outside a text field, or into the link box, reads it immediately. Ctrl/⌘+N opens the dialog empty; Ctrl/⌘+comma opens Settings; Ctrl/⌘+B hides or shows the sidebar.
- The sidebar collapses to an icon rail: the button at the right of its brand row, or Ctrl/⌘+B. The rail keeps New download, every filter with its count as a small badge, and Settings; names show as tooltips. The choice is remembered on the device, and the column narrows in 200ms. Windows narrower than 760px always use the rail.
- Dropdowns are a field with a chevron that opens a floating list on the popover surface, with a check beside the current choice. They never use the native popup, which ignores the theme. The list stays fixed in the window so scrolling panels and the dialog cannot clip it, and it flips above the field near the bottom edge.
- Settings opens as a modal over the downloads list, from the sidebar or Ctrl/⌘+comma. On the left, a search field (/ focuses it; it also matches the settings inside each section) above the sections: Downloads, Network, Download engine, GPU acceleration, Appearance, and Updates. On the right, a `Settings / Section` breadcrumb with a close button, then the section's card of rows: title and description left, control right. Changes save from a strip that appears only when something changed, with Discard beside Save; closing with unsaved changes asks first.
- A found app update appears in the status bar as Update to version. It installs on click, or by itself once nothing would be interrupted when Update automatically is on.

## Skin tokens

Dark is the default; light uses a matching zinc palette. Source: `src/styles/global.css`.

| Token | Dark | Light |
|---|---|---|
| Canvas | `#0a0a0a` + fine grain | `#fcfcfc` + fine grain |
| Surface (sidebar, inspector) | `#111111` | `#fafafa` |
| Text / muted | `#f5f5f5` / `#8a8a8a` | `#27272a` / `#71717a` |
| Primary (Blue accent) | `#346bf1` (oklch 0.571 0.21 264) | `#1b4ed8` (oklch 0.488 0.217 264) |
| Popover (dropdown lists) | `#171717` | `#ffffff` |
| Hairline / input border | white 6% / white 8% | `#e4e4e7` / `#d4d4d8` |

- Type: the system UI stack at 13px body, 14px titles, 15px inspector headings; `ui-monospace` with tabular numbers for sizes, speeds, percentages, timecodes, and paths.
- Geometry: 8px control radius, 14px settings cards, 16px settings modal, 32px controls, 52px top bar, 28px status bar, 56px sidebar rail, 64 by 36px row thumbnails.
- Accent: Settings > Appearance offers Blue (default), Violet, Pink, and Graphite as swatches. Each has a dark-theme and a light-theme shade (`--tint-*` in the stylesheet) and drives primary buttons, progress, switches, selected chips, and focus rings. Accents stay clear of the state colors (green complete, red failed, amber warning, light blue in progress) so a state is never mistaken for decoration.

## Rules

- No colored edge rails, decorative card borders, uppercase eyebrow labels, or status chrome that neither reports state nor offers an action.
- Hairlines only separate structural regions: sidebar, table frame and rows, column header, inspector, dialog footer, settings section list and rows, and the guide line beside Advanced options.
- Status is always icon plus words, never color alone, and icons never spin.
- Copy: no em or en dashes, at most one `·` per line, plain verbs, no marketing claims. Numbers shown are real values from yt-dlp, never decorative.
- The app icon is the yt-dlp project's own logo (`>_dlp`, public domain under the Unlicense), rebuilt as a 1024px vector from the official artwork in `src-tauri/icons/app-icon.svg`; the sidebar shows the same file (`src/assets/app-icon.svg`), never a stand-in mark.
- Desktop conventions: arrow cursor, no selection of interface text, and no browser context menu, reload, print, or find in release builds.
- Motion is limited to one-off transitions under 200ms: hover/press, the switch knob, progress `transform`, a dialog opening with its blurred backdrop fading in, dropdown lists fading in with their chevron turning, the sidebar column narrowing, and a stepped skeleton pulse while analyzing. The clip playhead moves only while its preview plays. Nothing else animates continuously. Reduce motion, in Settings or in the OS, turns the transitions off.
