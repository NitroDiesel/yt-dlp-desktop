export type MediaMode = "video" | "audio" | "custom";
export type JobStatus =
  | "queued"
  | "analyzing"
  | "downloading"
  | "post_processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface MediaFormat {
  formatId: string;
  extension: string;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrateKbps?: number;
  fileSize?: number;
  note?: string;
  hdr: boolean;
}

export interface SubtitleTrack {
  language: string;
  name?: string;
  extensions: string[];
  automatic: boolean;
}

export interface MediaProbe {
  id: string;
  url: string;
  title: string;
  creator?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  isPlaylist: boolean;
  playlistCount?: number;
  isLive: boolean;
  formats: MediaFormat[];
  subtitles: SubtitleTrack[];
  warnings: string[];
}

export interface DownloadOptions {
  mode: MediaMode;
  quality: string;
  audioFormat: "best" | "mp3" | "m4a" | "opus" | "flac" | "wav";
  subtitleLanguages: string[];
  writeSubtitles: boolean;
  writeAutomaticSubtitles: boolean;
  embedSubtitles: boolean;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  playlistItems?: string;
  customFormat?: string;
  customArguments: string[];
}

export interface DownloadRequest {
  url: string;
  destination: string;
  filenameTemplate: string;
  options: DownloadOptions;
}

export interface DownloadProgress {
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  playlistIndex?: number;
  playlistCount?: number;
  filename?: string;
  stage?: string;
}

export interface DownloadJob {
  id: string;
  request: DownloadRequest;
  title?: string;
  status: JobStatus;
  progress: DownloadProgress;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  outputPath?: string;
  errorCategory?: string;
  errorMessage?: string;
  diagnostics: string[];
}

export interface AppSettings {
  downloadDirectory: string;
  filenameTemplate: string;
  defaultMode: MediaMode;
  defaultQuality: string;
  queueConcurrency: number;
  theme: "system" | "light" | "dark";
  reducedMotion: boolean;
  ytDlpPath?: string;
  ffmpegPath?: string;
  denoPath?: string;
  cookieBrowser?: string;
  cookieFile?: string;
  proxy?: string;
  rateLimit?: string;
  retries: number;
  fragmentRetries: number;
}

export interface DependencyInfo {
  kind: "yt_dlp" | "ffmpeg" | "ffprobe" | "javascript_runtime";
  status: "available" | "missing" | "invalid";
  source: "bundled" | "managed" | "custom" | "system" | "not_found";
  path?: string;
  version?: string;
  message?: string;
}

export interface AppSnapshot {
  settings: AppSettings;
  queue: DownloadJob[];
  history: DownloadJob[];
  dependencies: DependencyInfo[];
  queuePaused: boolean;
}
