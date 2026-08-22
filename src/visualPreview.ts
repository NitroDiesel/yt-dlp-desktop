import { mockIPC } from "@tauri-apps/api/mocks";
import type { AppSnapshot, MediaProbe } from "./types/contracts";

const snapshot: AppSnapshot = {
  settings: {
    downloadDirectory: "C:\\Users\\Demo\\Downloads",
    lastDownloadDirectory: "D:\\Media\\Saved clips",
    filenameTemplate: "%(title).200B [%(id)s].%(ext)s",
    defaultMode: "video",
    defaultQuality: "best",
    queueConcurrency: 2,
    theme: "dark",
    reducedMotion: false,
    retries: 10,
    fragmentRetries: 10,
  },
  queue: [],
  history: [],
  dependencies: [
    {
      kind: "yt_dlp",
      status: "available",
      source: "bundled",
      version: "2026.07.04",
      path: "resources\\yt-dlp.exe",
    },
    {
      kind: "ffmpeg",
      status: "available",
      source: "bundled",
      version: "8.0",
      path: "resources\\ffmpeg.exe",
    },
    {
      kind: "ffprobe",
      status: "available",
      source: "bundled",
      version: "8.0",
      path: "resources\\ffprobe.exe",
    },
    {
      kind: "javascript_runtime",
      status: "available",
      source: "bundled",
      version: "deno 2.4.3",
      path: "resources\\deno.exe",
    },
  ],
  hardwareAcceleration: {
    status: "available",
    message: "NVIDIA NVENC is available through the installed driver.",
    encoders: [
      {
        provider: "nvenc",
        codec: "h264",
        encoder: "h264_nvenc",
        compiled: true,
        available: true,
        decodeBackend: "cuda",
        decodeAvailable: true,
      },
    ],
  },
  queuePaused: false,
};

const probe: MediaProbe = {
  id: "preview-video",
  url: "https://www.youtube.com/watch?v=preview",
  title: "A quiet test video for the desktop preview",
  creator: "yt-dlp Desktop",
  durationSeconds: 248,
  isPlaylist: false,
  isLive: false,
  formats: [
    {
      formatId: "401",
      extension: "mp4",
      width: 3840,
      height: 2160,
      fps: 60,
      videoCodec: "av01",
      hdr: false,
    },
  ],
  subtitles: [],
  warnings: [],
};

export async function installVisualPreview() {
  mockIPC(
    (command) => {
      switch (command) {
        case "initialize_app":
          return snapshot;
        case "probe_media":
          return probe;
        case "refresh_dependencies":
          return snapshot.dependencies;
        case "refresh_hardware_acceleration":
          return snapshot.hardwareAcceleration;
        case "save_settings":
        case "remember_download_directory":
          return snapshot.settings;
        default:
          return undefined;
      }
    },
    { shouldMockEvents: true },
  );
}
