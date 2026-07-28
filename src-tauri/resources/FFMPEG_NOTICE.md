# FFmpeg distribution notice

yt-dlp Desktop includes the `ffmpeg` and `ffprobe` command-line programs. They
are separate processes and are distributed under the GNU General Public License
version 3 or (at your option) any later version.

## Windows and Linux

- Build: FFmpeg `8.1.2-21-gce3c09c101`, GPL variant
- Binary build source: https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-06-30-13-34
- FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/commit/ce3c09c101
- Build scripts and dependency source recipes:
  https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-06-30-13-34

## macOS

- Build: FFmpeg 8.1.2
- Binary build source and checksums: https://ffmpeg.martin-riedl.de/
- FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n8.1.2
- Build scripts: https://git.martin-riedl.de/ffmpeg/build-script/src/commit/bb1d6db29c

The exact archive URLs and SHA-256 checksums used by this release are recorded
in `packaging/components.json` in the yt-dlp Desktop source tree:
https://github.com/NitroDiesel/yt-dlp-desktop

Each tagged yt-dlp Desktop release also publishes an
`yt-dlp-desktop-ffmpeg-source-materials.tar.zst` archive beside the installers.
It contains the exact FFmpeg source trees, NVIDIA codec headers, build-script
trees, component manifest, and checksums used for these builds. The build
scripts contain the pinned recipes for every statically linked library.

The complete corresponding source and build recipes remain available from the
links above at no charge. If any link becomes unavailable, open an issue at
https://github.com/NitroDiesel/yt-dlp-desktop/issues and the project will
provide the corresponding source for this release.

The full GPLv3-or-later license text is included as `LICENSE` with yt-dlp
Desktop. FFmpeg and its external libraries retain their respective copyright
notices.
