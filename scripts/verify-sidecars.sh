#!/usr/bin/env bash
set -euo pipefail

target="${1:-x86_64-unknown-linux-gnu}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary_directory="$root/src-tauri/binaries"

for binary in yt-dlp deno ffmpeg ffprobe; do
  test -x "$binary_directory/$binary-$target"
done

"$binary_directory/yt-dlp-$target" --version >/dev/null
"$binary_directory/deno-$target" --version >/dev/null
"$binary_directory/ffmpeg-$target" -hide_banner -version >/dev/null
"$binary_directory/ffprobe-$target" -hide_banner -version >/dev/null

if [[ "$target" == *windows* || "$target" == *linux* ]]; then
  encoders="$("$binary_directory/ffmpeg-$target" -hide_banner -encoders 2>&1)"
  for encoder in h264_nvenc hevc_nvenc av1_nvenc; do
    grep -Eq "^[[:space:]]*V[^[:space:]]*[[:space:]]+$encoder[[:space:]]" <<<"$encoders"
  done
  hwaccels="$("$binary_directory/ffmpeg-$target" -hide_banner -hwaccels 2>&1)"
  grep -Eq "^cuda[[:space:]]*$" <<<"$hwaccels"
fi

echo "Verified yt-dlp, Deno, FFmpeg, and FFprobe for $target."
