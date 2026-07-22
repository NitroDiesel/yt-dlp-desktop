import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { appApi } from "../../lib/api";
import { formatBytes, formatEta, hostname } from "../../lib/format";
import type { DownloadJob } from "../../types/contracts";
import { Diagnostics } from "../../components/Diagnostics";
import { StatusPill } from "../../components/StatusPill";

export function JobCard({
  job,
  onCancel,
  onRetry,
  onRemove,
  onMove,
}: {
  job: DownloadJob;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const active = ["analyzing", "downloading", "post_processing"].includes(
    job.status,
  );
  const progress = Math.max(0, Math.min(100, job.progress.percent ?? 0));
  return (
    <article className={`job-card job-card--${job.status}`}>
      <div className="job-card__rail" aria-hidden="true">
        <span style={{ height: `${progress}%` }} />
      </div>
      <div className="job-card__content">
        <header className="job-card__header">
          <div className="job-card__title">
            <p>{hostname(job.request.url)}</p>
            <h3>{job.title || "Preparing download…"}</h3>
          </div>
          <StatusPill status={job.status} />
        </header>

        {active && (
          <div className="job-progress">
            <div
              className="progress-track"
              role="progressbar"
              aria-label={`${job.title || "Download"} progress`}
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-copy">
              <strong>
                {job.status === "post_processing"
                  ? "Finishing media"
                  : `${progress.toFixed(progress < 10 ? 1 : 0)}%`}
              </strong>
              <span>
                {job.progress.speedBytesPerSecond
                  ? `${formatBytes(job.progress.speedBytesPerSecond)}/s · ${formatEta(job.progress.etaSeconds)}`
                  : job.progress.stage || "Waiting for progress…"}
              </span>
            </div>
            {job.progress.playlistCount && (
              <p className="playlist-progress">
                Item {job.progress.playlistIndex ?? 1} of{" "}
                {job.progress.playlistCount}
              </p>
            )}
          </div>
        )}

        {job.status === "queued" && (
          <p className="job-summary">
            {job.request.options.mode === "audio"
              ? `Audio · ${job.request.options.audioFormat.toUpperCase()}`
              : `Video · ${job.request.options.quality === "best" ? "Best available" : job.request.options.quality + "p"}`}
            <span>→</span>
            {job.request.destination}
          </p>
        )}
        {job.status === "failed" && (
          <div className="job-error">
            <strong>
              {job.errorCategory?.replaceAll("_", " ") || "Download failed"}
            </strong>
            <p>
              {job.errorMessage ||
                "Open the technical details for more information."}
            </p>
          </div>
        )}
        {job.status === "interrupted" && (
          <div className="job-error">
            <strong>This download stopped when the app closed</strong>
            <p>
              Retry when you’re ready. Existing partial data will be preserved
              for yt-dlp to continue safely.
            </p>
          </div>
        )}
        {job.status === "completed" && (
          <p className="job-summary job-summary--success">
            Saved to {job.outputPath || job.request.destination}
          </p>
        )}
        {job.status === "cancelled" && (
          <p className="job-summary">
            Cancelled · partial files were preserved when safe
          </p>
        )}

        <Diagnostics lines={job.diagnostics} />

        <footer className="job-card__actions">
          {job.status === "queued" && (
            <div className="reorder-actions">
              <button
                className="icon-button"
                title="Move up"
                aria-label="Move job up"
                onClick={() => onMove("up")}
              >
                <ChevronUp />
              </button>
              <button
                className="icon-button"
                title="Move down"
                aria-label="Move job down"
                onClick={() => onMove("down")}
              >
                <ChevronDown />
              </button>
            </div>
          )}
          <span className="action-spacer" />
          {job.status === "completed" && job.outputPath && (
            <button
              className="button button--quiet"
              onClick={() => void appApi.revealJobOutput(job.id)}
            >
              <FolderOpen aria-hidden="true" /> Show in folder
            </button>
          )}
          {active && (
            <button className="button button--danger-quiet" onClick={onCancel}>
              <X aria-hidden="true" /> Cancel
            </button>
          )}
          {["failed", "cancelled", "interrupted"].includes(job.status) && (
            <button className="button button--quiet" onClick={onRetry}>
              <RotateCcw aria-hidden="true" /> Retry
            </button>
          )}
          {[
            "queued",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
          ].includes(job.status) && (
            <button
              className="icon-button"
              aria-label="Remove from queue"
              title="Remove from queue"
              onClick={onRemove}
            >
              <Trash2 />
            </button>
          )}
        </footer>
      </div>
    </article>
  );
}
