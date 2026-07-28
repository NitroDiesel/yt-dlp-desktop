#!/usr/bin/env bash
set -euo pipefail

target="${1:-x86_64-unknown-linux-gnu}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$root/packaging/components.json"
destination="$root/src-tauri/binaries"
mkdir -p "$destination"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

field() {
  node -e 'const m=require(process.argv[1]); const c=m[process.argv[2]]; const t=c.targets[process.argv[3]]; if(!t)process.exit(2); console.log(process.argv[4]==="version"?c.version:t[process.argv[4]])' "$manifest" "$1" "$target" "$2"
}

verify_sha256() {
  expected="$1"
  file="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  test "$actual" = "$expected"
}

yt_version="$(field ytDlp version)"
yt_asset="$(field ytDlp asset)"
yt_hash="$(field ytDlp sha256)"
deno_version="$(field deno version)"
deno_asset="$(field deno asset)"
deno_hash="$(field deno sha256)"

curl --fail --location --retry 3 "https://github.com/yt-dlp/yt-dlp/releases/download/$yt_version/$yt_asset" --output "$temporary/$yt_asset"
verify_sha256 "$yt_hash" "$temporary/$yt_asset"

curl --fail --location --retry 3 "https://github.com/denoland/deno/releases/download/v$deno_version/$deno_asset" --output "$temporary/$deno_asset"
verify_sha256 "$deno_hash" "$temporary/$deno_asset"
unzip -q "$temporary/$deno_asset" -d "$temporary/deno"
test -f "$temporary/deno/deno"
install -m 0755 "$temporary/$yt_asset" "$destination/yt-dlp-$target"
install -m 0755 "$temporary/deno/deno" "$destination/deno-$target"

node - "$manifest" "$target" <<'NODE' >"$temporary/ffmpeg-artifacts.tsv"
const manifest = require(process.argv[2])
const target = manifest.ffmpeg.targets[process.argv[3]]
if (!target) process.exit(2)
for (const artifact of target.artifacts) {
  for (const [binary, entry] of Object.entries(artifact.entries)) {
    console.log([artifact.asset, artifact.url, artifact.sha256, artifact.archive, binary, entry].join("\t"))
  }
}
NODE

artifact_index=0
last_asset=""
last_extract_path=""
while IFS=$'\t' read -r asset url hash archive binary entry; do
  artifact_path="$temporary/$asset"
  if [[ "$asset" == "$last_asset" ]]; then
    extract_path="$last_extract_path"
  else
    extract_path="$temporary/ffmpeg-$artifact_index"
  fi
  if [[ ! -f "$artifact_path" ]]; then
    curl --fail --location --retry 3 "$url" --output "$artifact_path"
    verify_sha256 "$hash" "$artifact_path"
  fi
  if [[ "$asset" != "$last_asset" ]]; then
    mkdir -p "$extract_path"
    case "$archive" in
      zip) unzip -q "$artifact_path" -d "$extract_path" ;;
      tar.xz) tar -xJf "$artifact_path" -C "$extract_path" ;;
      *) echo "Unsupported FFmpeg archive type: $archive" >&2; exit 2 ;;
    esac
  fi
  test -f "$extract_path/$entry"
  install -m 0755 "$extract_path/$entry" "$destination/$binary-$target"
  last_asset="$asset"
  last_extract_path="$extract_path"
  artifact_index=$((artifact_index + 1))
done <"$temporary/ffmpeg-artifacts.tsv"
