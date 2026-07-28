param(
  [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$binaryDirectory = Join-Path $repositoryRoot "src-tauri\binaries"
$extension = if ($Target -match "windows") { ".exe" } else { "" }

function Require-Sidecar {
  param([string]$Name)
  $path = Join-Path $binaryDirectory "$Name-$Target$extension"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing prepared sidecar: $path"
  }
  return $path
}

$ytDlp = Require-Sidecar "yt-dlp"
$deno = Require-Sidecar "deno"
$ffmpeg = Require-Sidecar "ffmpeg"
$ffprobe = Require-Sidecar "ffprobe"

& $ytDlp --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "yt-dlp version check failed." }
& $deno --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Deno version check failed." }
& $ffmpeg -hide_banner -version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "FFmpeg version check failed." }
& $ffprobe -hide_banner -version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "FFprobe version check failed." }

if ($Target -match "windows|linux") {
  $encoders = (& $ffmpeg -hide_banner -encoders 2>&1) -join "`n"
  foreach ($encoder in @(
      "h264_nvenc", "hevc_nvenc", "av1_nvenc",
      "h264_amf", "hevc_amf", "av1_amf"
    )) {
    if ($encoders -notmatch "(?m)^\s*V\S*\s+$encoder\s") {
      throw "The prepared FFmpeg build is missing $encoder."
    }
  }
  $accelerators = (& $ffmpeg -hide_banner -hwaccels 2>&1) -join "`n"
  if ($accelerators -notmatch "(?m)^cuda\s*$") {
    throw "The prepared FFmpeg build is missing CUDA hardware acceleration."
  }
}

Write-Output "Verified yt-dlp, Deno, FFmpeg, and FFprobe for $Target."
