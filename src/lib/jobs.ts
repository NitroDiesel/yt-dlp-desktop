import type { DownloadJob, JobStatus } from "../types/contracts";
import { hostname } from "./format";
import { formatTimecode } from "./timecode";

export type DownloadFilter = "all" | "downloading" | "completed" | "stopped";

export const filterLabels: Record<DownloadFilter, string> = {
  all: "All downloads",
  downloading: "Downloading",
  completed: "Completed",
  stopped: "Stopped",
};

const runningStatuses: ReadonlySet<JobStatus> = new Set([
  "analyzing",
  "downloading",
  "post_processing",
]);

export function isRunning(status: JobStatus): boolean {
  return runningStatuses.has(status);
}

/** A finished single download whose file Remove can also move to the trash. */
export function hasDeletableFile(job: DownloadJob): boolean {
  return job.status === "completed" && Boolean(job.outputPath) && !job.request.isPlaylist;
}

export function isStopped(status: JobStatus): boolean {
  return (
    status === "failed" || status === "cancelled" || status === "interrupted"
  );
}

export function filterFor(status: JobStatus): Exclude<DownloadFilter, "all"> {
  if (status === "completed") return "completed";
  if (isStopped(status)) return "stopped";
  return "downloading";
}

/**
 * One downloads list built from the persisted queue and history. Running and
 * waiting jobs keep their queue order; finished ones follow, newest first.
 */
export function mergeDownloads(
  queue: DownloadJob[],
  history: DownloadJob[],
): DownloadJob[] {
  const inProgress: DownloadJob[] = [];
  const finished = new Map<string, DownloadJob>();
  for (const job of queue) {
    if (filterFor(job.status) === "downloading") inProgress.push(job);
    else finished.set(job.id, job);
  }
  const inProgressIds = new Set(inProgress.map((job) => job.id));
  for (const job of history) {
    if (!finished.has(job.id) && !inProgressIds.has(job.id))
      finished.set(job.id, job);
  }
  const done = [...finished.values()].sort((a, b) =>
    (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt),
  );
  return [...inProgress, ...done];
}

export function countDownloads(
  queue: DownloadJob[],
  history: DownloadJob[],
): Record<DownloadFilter, number> {
  const counts = { all: 0, downloading: 0, completed: 0, stopped: 0 };
  for (const job of mergeDownloads(queue, history)) {
    counts.all += 1;
    counts[filterFor(job.status)] += 1;
  }
  return counts;
}

export function findJob(
  queue: DownloadJob[],
  history: DownloadJob[],
  id: string,
): DownloadJob | undefined {
  return (
    queue.find((job) => job.id === id) ?? history.find((job) => job.id === id)
  );
}

/** "Video, up to 1080p", "MP3, 320 kbps", "Exact format 137+140". */
export function formatSummary(job: DownloadJob): string {
  const { options } = job.request;
  if (options.mode === "audio") {
    if (options.audioFormat === "best") return "Audio, original format";
    const bitrate =
      options.audioQuality === "best"
        ? ""
        : `, ${options.audioQuality.replace("K", " kbps")}`;
    return `${options.audioFormat.toUpperCase()}${bitrate}`;
  }
  if (options.mode === "custom")
    return options.customFormat
      ? `Exact format ${options.customFormat}`
      : "Exact format";
  const quality =
    options.quality === "best"
      ? "best quality"
      : options.quality === "single"
        ? "single file"
        : `up to ${options.quality}p`;
  return `Video, ${quality}`;
}

export function clipSummary(job: DownloadJob): string | undefined {
  const clip = job.request.options.clip;
  if (!clip) return undefined;
  return `${formatTimecode(clip.startSeconds)} to ${formatTimecode(clip.startSeconds + clip.durationSeconds)}`;
}

export function jobMeta(job: DownloadJob): string {
  const clip = clipSummary(job);
  const format = clip ? `${formatSummary(job)}, clip ${clip}` : formatSummary(job);
  return `${format} · ${hostname(job.request.url)}`;
}

export function jobTitle(job: DownloadJob): string {
  return job.title || hostname(job.request.url);
}

export function formatWhen(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Extracts the first web link from pasted text, if any. */
export function linkFromText(text: string): string | undefined {
  const match = text.trim().match(/https?:\/\/[^\s<>"']+/i);
  return match?.[0];
}

/** A link like watch?v=ID&list=ID points at one video inside a playlist. */
export function isVideoInPlaylist(link: string): boolean {
  try {
    const url = new URL(link);
    return (
      url.searchParams.has("list") &&
      (url.searchParams.has("v") || url.hostname.endsWith("youtu.be"))
    );
  } catch {
    return false;
  }
}
