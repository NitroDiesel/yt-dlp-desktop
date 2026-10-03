export type MediaMode = "video" | "audio" | "custom";
export type HardwareCodec = "h264" | "hevc" | "av1";
export type HardwareEncoderProvider = "nvenc" | "amf";
export type AudioFormat = "best" | "mp3" | "m4a" | "opus" | "flac" | "wav";
export type AudioQuality = "best" | "320K" | "256K" | "192K" | "128K";
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
  language?: string;
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
  audioFormat: AudioFormat;
  audioQuality: AudioQuality;
  subtitleLanguages: string[];
  writeSubtitles: boolean;
  writeAutomaticSubtitles: boolean;
  embedSubtitles: boolean;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  playlistItems?: string;
  customFormat?: string;
  customArguments: string[];
  clip?: {
    startSeconds: number;
    durationSeconds: number;
    precise: boolean;
  };
  videoConversion?: {
    codec: HardwareCodec;
    quality: number;
    useHardwareDecode: boolean;
  };
  container?: VideoContainer;
  codecPreference?: CodecPreference;
  subtitleFormat?: SubtitleFormat;
  embedChapters?: boolean;
  splitChapters?: boolean;
  sponsorblock?: {
    mode: "mark" | "remove";
    categories: SponsorCategory[];
  };
  writeThumbnail?: boolean;
  writeDescription?: boolean;
  writeInfoJson?: boolean;
  restrictFilenames?: boolean;
  concurrentFragments?: number;
  /** Upload-date window for playlists and channels, as YYYYMMDD. */
  dateAfter?: string;
  dateBefore?: string;
  maxDownloads?: number;
  sleepInterval?: number;
  /** Preferred audio track language, for videos with several dubs. */
  audioLanguage?: string;
  /** For a video link that also names a playlist: download only the video. */
  noPlaylist?: boolean;
  liveFromStart?: boolean;
  minFilesizeMb?: number;
  maxFilesizeMb?: number;
  skipLive?: boolean;
  minDurationSeconds?: number;
  playlistOrder?: "reverse" | "random";
  referer?: string;
  userAgent?: string;
  windowsFilenames?: boolean;
  trimFilenames?: number;
  forceOverwrites?: boolean;
  writeComments?: boolean;
  writeLink?: boolean;
  thumbnailFormat?: "jpg" | "png" | "webp";
  keepVideo?: boolean;
  /** Plain text; chapters whose title contains it are cut out. */
  removeChapters?: string;
}

export type VideoContainer = "mp4" | "mkv" | "webm";
export type CodecPreference = "h264" | "vp9" | "av1";
export type SubtitleFormat = "srt" | "vtt" | "ass";
export type SponsorCategory =
  | "sponsor"
  | "selfpromo"
  | "interaction"
  | "intro"
  | "outro"
  | "preview"
  | "filler"
  | "music_offtopic";

export interface DownloadRequest {
  url: string;
  destination: string;
  filenameTemplate: string;
  isPlaylist: boolean;
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

/** Highlight color for primary buttons, progress, switches, and focus rings. */
export type AccentColor = "blue" | "violet" | "pink" | "graphite";

export interface AppSettings {
  downloadDirectory: string;
  lastDownloadDirectory?: string;
  filenameTemplate: string;
  defaultMode: MediaMode;
  defaultQuality: string;
  queueConcurrency: number;
  theme: "system" | "light" | "dark";
  accent: AccentColor;
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
  ipVersion?: "ipv4" | "ipv6";
  socketTimeout?: number;
  /** yt-dlp --xff: "default", "never", or a two-letter country code. */
  geoBypass?: string;
  impersonate?: "chrome" | "edge" | "safari" | "firefox";
  sleepRequests?: number;
  httpChunkSizeMb?: number;
  extractorRetries?: number;
  legacyServerConnect?: boolean;
  /** Stamp files with the download time instead of the upload date. */
  useDownloadTime?: boolean;
}

export interface DependencyInfo {
  kind: "yt_dlp" | "ffmpeg" | "ffprobe" | "javascript_runtime";
  status: "available" | "missing" | "invalid";
  source: "bundled" | "managed" | "custom" | "system" | "not_found";
  path?: string;
  version?: string;
  message?: string;
}

export interface HardwareEncoderInfo {
  provider: HardwareEncoderProvider;
  codec: HardwareCodec;
  encoder: string;
  compiled: boolean;
  available: boolean;
  decodeBackend?: string;
  decodeAvailable: boolean;
  message?: string;
}

export interface HardwareAccelerationInfo {
  status:
    | "checking"
    | "available"
    | "unsupported_platform"
    | "build_missing"
    | "driver_or_gpu_missing"
    | "probe_failed";
  encoders: HardwareEncoderInfo[];
  message: string;
}

export interface AppSnapshot {
  settings: AppSettings;
  queue: DownloadJob[];
  history: DownloadJob[];
  dependencies: DependencyInfo[];
  hardwareAcceleration: HardwareAccelerationInfo;
  queuePaused: boolean;
}
