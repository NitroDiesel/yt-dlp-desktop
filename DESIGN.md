# Design

yt-dlp Desktop looks and behaves like desktop download-manager software, not a web downloader site and not a chat app. The skin is a restrained, dense dark theme; the layout follows conventional download managers.

## Layout

The downloads page follows Motrix: a framed table with column headers, a large view title, and a status bar.

```text
┌ Sidebar ───────┬ All downloads [9]                                  Pause queue ┐
│ yt-dlp Desktop │ ┌ NAME              SIZE   PROGRESS     STATUS    SPEED   ETA ┐ │
│ + New download │ │ Title             312 MB ▓▓▓▓░░ 42%   Downloading 2.4 MB/s 0:18│ │
│ All downloads  │ │ Format · site                                            │ │
│ Downloading    │ │ Title                    ▓▓▓▓▓▓ 100%  Completed           │ │
│ Completed      │ │ Error message in red     ▓░░░░░ 0%    Needs attention     │ │
│ Stopped        │ └───────────────────────────────────────────────────────────┘ │
│ Settings       ├ ↓ 2.4 MB/s  Active 1  Waiting 1  Completed 6  Failed 1  ● Engine ready ┤
└────────────────┴────────────────────────────────────────────────────────────────┘
```

- One downloads table. Sidebar filters split it by state; there is no separate History page.
- Progress bars are colored by state (primary while downloading, green when complete, red when failed). Empty cells stay blank.
- Columns drop out as the table narrows (container queries): Size and Speed first, then Progress and ETA.
- Selecting a row opens Download details on the right; it floats over the table in narrow windows. Escape closes it.
- New download is a modal dialog in the style of Motrix's "New task": a large link box, then label-left rows for Download (Video or Audio only, shown before the link is read), Quality or Audio format and Bitrate, Container, Audio track and Live stream when the video has them, Clip, and GPU. For a video inside a playlist, "This link" chooses between just the video and the whole playlist. A "Save to" row has the folder button on the right. Advanced, collapsed at the bottom, holds every other yt-dlp feature as controls: codec, subtitles, chapters, SponsorBlock, extra files, file naming, playlist filters, connections, and request headers. There is no free-text argument box. The footer is Cancel and Analyze, then Cancel, Add to queue, and Download.
- App-wide network behavior (impersonation, region, IP version, timeout, request pauses, chunking, retries) lives in Settings. `docs/CAPABILITY_AUDIT.md` maps every yt-dlp option to its control.
- It is an in-app native `<dialog>`, not a second OS window, so no second webview is started.
- Pasting a link anywhere outside a text field, or into the link box, reads it immediately. Ctrl/⌘+N opens the dialog empty; Ctrl/⌘+comma opens Settings; Ctrl/⌘+B hides or shows the sidebar.
- The sidebar can be hidden, as in Motrix: the button at the right of its brand row, or Ctrl/⌘+B. While it is hidden, each page header starts with Show sidebar and New download. The choice is remembered on the device. It switches instantly; a width animation would re-lay out the table every frame.
- Dropdowns are a field with a chevron that opens a floating list on the popover surface, with a check beside the current choice. They never use the native popup, which ignores the theme. The list stays fixed in the window so scrolling panels and the dialog cannot clip it, and it flips above the field near the bottom edge.
- Settings uses grouped rows: section title, a card of rows, title and description left, control right. Changes save from a strip that appears only when something changed, with Discard beside Save.

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
- Geometry: 8px control radius, 14px settings cards, 32px controls, 52px top bar, 28px status bar.
- Accent: Settings > Appearance offers Blue (default), Violet, Pink, and Graphite as swatches. Each has a dark-theme and a light-theme shade (`--tint-*` in the stylesheet) and drives primary buttons, progress, switches, selected chips, and focus rings. Accents stay clear of the state colors (green complete, red failed, amber warning, light blue in progress) so a state is never mistaken for decoration.

## Rules

- No colored edge rails, decorative card borders, uppercase eyebrow labels, or status chrome that neither reports state nor offers an action.
- Hairlines only separate structural regions: sidebar, table frame and rows, column header, inspector, dialog footer, settings rows, and the guide line beside Advanced options.
- Status is always icon plus words, never color alone, and icons never spin.
- Copy: no em or en dashes, at most one `·` per line, plain verbs, no marketing claims. Numbers shown are real values from yt-dlp, never decorative.
- The sidebar shows the real app icon (`src/assets/app-icon.svg`, copied from `src-tauri/icons`), not a stand-in mark.
- Desktop conventions: arrow cursor, no selection of interface text, and no browser context menu, reload, print, or find in release builds.
- Motion is limited to short hover/press transitions, the switch knob, progress `transform`, and a stepped skeleton pulse while analyzing. Reduce motion turns all of it off.
