param(
  [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "packaging\components.json") | ConvertFrom-Json
$targetDirectory = Join-Path $repositoryRoot "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("yt-dlp-desktop-sidecars-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

function Get-VerifiedFile {
  param([string]$Uri, [string]$Destination, [string]$ExpectedHash)
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
  if ($actualHash -ne $ExpectedHash.ToLowerInvariant()) {
    throw "Checksum mismatch for $Uri. Expected $ExpectedHash, received $actualHash."
  }
}

try {
  $ytTarget = $manifest.ytDlp.targets.$Target
  $denoTarget = $manifest.deno.targets.$Target
  if (-not $ytTarget -or -not $denoTarget) { throw "Unsupported sidecar target: $Target" }

  $ytDownload = Join-Path $temporaryDirectory $ytTarget.asset
  Get-VerifiedFile -Uri "https://github.com/yt-dlp/yt-dlp/releases/download/$($manifest.ytDlp.version)/$($ytTarget.asset)" -Destination $ytDownload -ExpectedHash $ytTarget.sha256
  $ytExtension = if ($Target -match "windows") { ".exe" } else { "" }

  $denoArchive = Join-Path $temporaryDirectory $denoTarget.asset
  Get-VerifiedFile -Uri "https://github.com/denoland/deno/releases/download/v$($manifest.deno.version)/$($denoTarget.asset)" -Destination $denoArchive -ExpectedHash $denoTarget.sha256
  $denoExtract = Join-Path $temporaryDirectory "deno"
  [System.IO.Compression.ZipFile]::ExtractToDirectory($denoArchive, $denoExtract)
  $denoName = if ($Target -match "windows") { "deno.exe" } else { "deno" }
  $denoSource = Join-Path $denoExtract $denoName
  if (-not (Test-Path -LiteralPath $denoSource -PathType Leaf)) { throw "Deno archive did not contain the expected executable." }
  $denoExtension = if ($Target -match "windows") { ".exe" } else { "" }
  Copy-Item -LiteralPath $ytDownload -Destination (Join-Path $targetDirectory "yt-dlp-$Target$ytExtension") -Force
  Copy-Item -LiteralPath $denoSource -Destination (Join-Path $targetDirectory "deno-$Target$denoExtension") -Force
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
}
