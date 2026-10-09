import { mockIPC } from "@tauri-apps/api/mocks";
import type { AppSnapshot, DownloadJob, MediaProbe } from "./types/contracts";

function previewJob(
  title: string,
  status: DownloadJob["status"],
  index: number,
  options: Partial<DownloadJob["request"]["options"]> = {},
  percent = 42,
): DownloadJob {
  const extension = options.mode === "video" ? (options.container ?? "mp4") : (options.audioFormat ?? "mp3");
  return {
    id: `preview-${index}`,
    title,
    status,
    request: {
      url: "https://www.youtube.com/watch?v=preview",
      destination: "D:\\Downloads\\Sound library",
      filenameTemplate: "%(title)s.%(ext)s",
      isPlaylist: false,
      options: {
        mode: "audio", quality: "best", audioFormat: "mp3", audioQuality: "320K",
        subtitleLanguages: [], writeSubtitles: false, writeAutomaticSubtitles: false,
        embedSubtitles: false, embedMetadata: true, embedThumbnail: false, customArguments: [],
        ...options,
      },
    },
    progress: status === "downloading"
      ? { percent, speedBytesPerSecond: 6800000, etaSeconds: 41, totalBytes: 1_480_000_000 }
      : { percent: status === "completed" ? 100 : undefined },
    createdAt: "2026-09-05T10:00:00Z",
    finishedAt: status === "completed" ? "2026-09-05T10:01:00Z" : undefined,
    outputPath: status === "completed" ? `D:\\Downloads\\Sound library\\${title}.${extension}` : undefined,
    errorMessage: status === "failed" ? "The connection was interrupted. Retry to continue downloading." : undefined,
    diagnostics: ["Synthetic visual preview. No media was downloaded."],
  };
}

const previewJobs = [
  previewJob("Time Rewind / Sound Effect", "completed", 1),
  previewJob("Fahhh - Sound effect", "completed", 2),
  previewJob("Yayyy! Sound Effect", "completed", 3),
  previewJob("Children cheering outdoors", "completed", 4),
  previewJob("Sound effects collection with a long descriptive filename for layout testing", "completed", 5),
  previewJob("Rewind - Sound Effect", "completed", 6),
];

/** README screenshots: a realistic mix of video and audio in every state. */
function showcaseJobs(): DownloadJob[] {
  const video = (quality: string, container?: "mp4" | "mkv") => ({ mode: "video" as const, quality, container });
  const audio = (audioFormat: "mp3" | "flac" | "opus", audioQuality: "320K" | "best" = "best") => ({
    mode: "audio" as const,
    audioFormat,
    audioQuality,
  });
  return [
    previewJob("Northern lights timelapse over the fjords", "downloading", 1, video("2160", "mp4"), 64),
    previewJob("How suspension bridges survive earthquakes", "downloading", 2, video("1440", "mkv"), 23),
    previewJob("Building a mechanical keyboard from scratch", "queued", 3, video("1080", "mp4")),
    previewJob("Three hour rain and thunder ambience", "completed", 4, audio("flac")),
    previewJob("Morning city walk through old town, 4K", "completed", 5, video("2160", "mkv")),
    previewJob("Developer conference keynote, full session", "failed", 6, video("1080", "mp4")),
    previewJob("Lo-fi study mix, volume 12", "completed", 7, audio("mp3", "320K")),
    previewJob("Pottery wheel basics for beginners", "completed", 8, video("720", "mp4")),
    previewJob("Podcast episode 214: the history of maps", "completed", 9, audio("opus")),
  ];
}

const snapshot: AppSnapshot = {
  settings: {
    downloadDirectory: "C:\\Users\\Demo\\Downloads",
    lastDownloadDirectory: "D:\\Media\\Saved clips",
    filenameTemplate: "%(title).200B [%(id)s].%(ext)s",
    defaultMode: "video",
    defaultQuality: "best",
    queueConcurrency: 2,
    theme: "dark",
    accent: "blue",
    autoUpdateEngine: true,
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
  const params = new URLSearchParams(window.location.search);
  if (params.has("populated")) {
    const failed = previewJob("Ocean waves", "failed", 9);
    snapshot.queue = params.has("mixed")
      ? [previewJob("Rain on a tin roof", "downloading", 7), previewJob("Forest ambience", "queued", 8), failed, ...previewJobs]
      : previewJobs;
    snapshot.history = params.has("mixed") ? [failed, ...previewJobs] : previewJobs;
  }
  if (params.has("showcase")) {
    const jobs = showcaseJobs();
    jobs[1].progress = { percent: 23, speedBytesPerSecond: 3_100_000, etaSeconds: 236, totalBytes: 912_000_000 };
    snapshot.queue = jobs.filter((job) => job.status !== "completed" && job.status !== "failed");
    snapshot.history = jobs.filter((job) => job.status === "completed" || job.status === "failed");
    probe.title = "Northern lights timelapse over the fjords";
    probe.creator = "Night Sky Studio";
  }
  if (params.get("theme") === "light") snapshot.settings.theme = "light";
  mockIPC(
    (command) => {
      switch (command) {
        case "initialize_app":
          return snapshot;
        case "probe_media":
          return probe;
        case "refresh_dependencies":
        case "update_engine":
          return snapshot.dependencies;
        case "refresh_hardware_acceleration":
          return snapshot.hardwareAcceleration;
        case "reorder_job":
          return snapshot.queue;
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
