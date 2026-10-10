import { memo } from "react";
import {
  FileAudio,
  FileVideo,
  FolderOpen,
  ListVideo,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { StatusPill } from "../../components/StatusPill";
import { appApi } from "../../lib/api";
import { formatBytes, formatDuration } from "../../lib/format";
import { isRunning, isStopped, jobMeta, jobTitle } from "../../lib/jobs";
import type { DownloadJob } from "../../types/contracts";

function percentOf(job: DownloadJob): number {
  if (job.status === "completed" || job.status === "post_processing") return 100;
  return Math.max(0, Math.min(100, job.progress.percent ?? 0));
}

/**
 * One download in the table. Memoized: a progress event re-renders only the row
 * whose job object changed.
 */
export const JobRow = memo(function JobRow({
  job,
  selected,
  onSelect,
  onCancel,
  onRetry,
  onRemove,
}: {
  job: DownloadJob;
  selected: boolean;
  /** Pass stable store actions so the memo holds. */
  onSelect: (jobId: string) => void;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onRemove: (jobId: string) => void;
}) {
  const title = jobTitle(job);
  const running = isRunning(job.status);
  const downloading = job.status === "downloading";
  const Icon = job.request.isPlaylist
    ? ListVideo
    : job.request.options.mode === "audio"
      ? FileAudio
      : FileVideo;
  const percent = percentOf(job);
  const { progress } = job;
  const size = progress.totalBytes;
  const detail =
    job.status === "failed" || job.status === "interrupted"
      ? job.errorMessage || "Download failed"
      : job.status === "post_processing"
        ? progress.stage || "Processing media"
        : jobMeta(job);

  return (
    <li className={`job-row ${selected ? "job-row--selected" : ""}`}>
      <button
        type="button"
        className="job-row__select"
        aria-current={selected ? "true" : undefined}
        aria-label={`${title}, ${job.status.replaceAll("_", " ")}`}
        onClick={() => onSelect(job.id)}
      >
        <span className="job-cell job-cell--name">
          <Icon className="job-row__icon" aria-hidden="true" />
          <span className="job-row__text">
            <span className="job-row__title" title={title}>
              {title}
            </span>
            <span
              className={`job-row__meta ${isStopped(job.status) ? "job-row__meta--error" : ""}`}
              title={detail}
            >
              {detail}
            </span>
          </span>
        </span>
        <span className="job-cell job-cell--size mono">
          {size ? formatBytes(size) : ""}
        </span>
        <span className="job-cell job-cell--progress">
          <span
            className={`progress-line progress-line--${job.status}`}
            role="progressbar"
            aria-label={`${title} progress`}
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ transform: `scaleX(${percent / 100})` }} />
          </span>
          <span className="progress-line__numbers mono">
            <span>{percent.toFixed(downloading && percent < 10 ? 1 : 0)}%</span>
            <span>
              {progress.downloadedBytes != null && job.status !== "completed"
                ? formatBytes(progress.downloadedBytes)
                : size
                  ? formatBytes(size)
                  : ""}
            </span>
          </span>
        </span>
        <span className="job-cell job-cell--status">
          <StatusPill status={job.status} variant="pill" />
        </span>
        <span className="job-cell job-cell--speed mono">
          {downloading && progress.speedBytesPerSecond
            ? `${formatBytes(progress.speedBytesPerSecond)}/s`
            : ""}
        </span>
        <span className="job-cell job-cell--eta mono">
          {downloading && progress.etaSeconds != null
            ? formatDuration(progress.etaSeconds)
            : ""}
        </span>
      </button>
      <div className="job-row__actions">
        {job.status === "completed" && job.outputPath && (
          <button
            type="button"
            className="icon-button"
            aria-label="Show in folder"
            title="Show in folder"
            onClick={() => void appApi.revealJobOutput(job.id)}
          >
            <FolderOpen />
          </button>
        )}
        {(running || job.status === "queued") && (
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel"
            title="Cancel"
            onClick={() => void onCancel(job.id)}
          >
            <X />
          </button>
        )}
        {isStopped(job.status) && (
          <button
            type="button"
            className="icon-button"
            aria-label="Retry"
            title="Retry"
            onClick={() => void onRetry(job.id)}
          >
            <RotateCcw />
          </button>
        )}
        {!running && (
          <button
            type="button"
            className="icon-button"
            aria-label="Remove"
            title="Remove"
            onClick={() => onRemove(job.id)}
          >
            <Trash2 />
          </button>
        )}
      </div>
    </li>
  );
});
