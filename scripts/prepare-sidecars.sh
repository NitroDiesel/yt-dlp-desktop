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
