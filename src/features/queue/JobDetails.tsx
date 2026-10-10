import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ExternalLink,
  FolderOpen,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useAppStore } from "../../app/store";
import { Diagnostics } from "../../components/Diagnostics";
import { InspectorFrame } from "../../components/InspectorFrame";
import { StatusPill } from "../../components/StatusPill";
import { appApi } from "../../lib/api";
import { formatBytes, formatEta, hostname } from "../../lib/format";
import {
  clipSummary,
  findJob,
  formatSummary,
  isRunning,
  isStopped,
  jobTitle,
} from "../../lib/jobs";
import type { DownloadJob } from "../../types/contracts";

const codecNames = { h264: "H.264", hevc: "HEVC", av1: "AV1" } as const;

function Progress({ job }: { job: DownloadJob }) {
  const { progress } = job;
  const percent = Math.max(0, Math.min(100, progress.percent ?? 0));
  if (job.status === "post_processing" || job.status === "analyzing") {
    return (
      <p className="detail-progress__stage">
        {progress.stage || "Preparing the media file"}
      </p>
    );
  }
  return (
    <div className="detail-progress">
      <div className="detail-progress__numbers">
        <strong className="mono">
          {percent.toFixed(percent < 10 ? 1 : 0)}%
        </strong>
        <span className="mono">
          {progress.speedBytesPerSecond
            ? `${formatBytes(progress.speedBytesPerSecond)}/s`
            : "Connecting…"}
        </span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={`${jobTitle(job)} progress`}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      <div className="detail-progress__numbers detail-progress__numbers--muted">
        <span className="mono">
          {progress.totalBytes
            ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}`
            : `${formatBytes(progress.downloadedBytes)} so far`}
        </span>
        <span>{formatEta(progress.etaSeconds)}</span>
      </div>
      {progress.playlistCount != null && (
        <p className="detail-progress__stage">
          Item {progress.playlistIndex ?? 1} of {progress.playlistCount}
        </p>
      )}
    </div>
  );
}

export function JobDetails({ jobId }: { jobId: string }) {
  const job = useAppStore((state) =>
    findJob(state.queue, state.history, jobId),
  );
  const closeInspector = useAppStore((state) => state.closeInspector);
  const cancel = useAppStore((state) => state.cancel);
  const retry = useAppStore((state) => state.retry);
  const requestRemove = useAppStore((state) => state.requestRemove);
  const reorder = useAppStore((state) => state.reorder);

  if (!job) return null;
  const title = jobTitle(job);
  const running = isRunning(job.status);
  const clip = clipSummary(job);
  const saved = job.outputPath || job.request.destination;

  const footer = (
    <>
      {job.status === "completed" && job.outputPath && (
        <>
          <button
            type="button"
            className="button button--outline"
            onClick={() => void appApi.revealJobOutput(job.id)}
          >
            <FolderOpen aria-hidden="true" /> Show in folder
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void appApi.openJobOutput(job.id)}
          >
            <ExternalLink aria-hidden="true" /> Open file
          </button>
        </>
      )}
      {isStopped(job.status) && (
        <button
          type="button"
          className="button button--primary"
          onClick={() => void retry(job.id)}
        >
          <RotateCcw aria-hidden="true" /> Retry
        </button>
      )}
      {(running || job.status === "queued") && (
        <button
          type="button"
          className="button button--outline"
          onClick={() => void cancel(job.id)}
        >
          <X aria-hidden="true" /> Cancel download
        </button>
      )}
    </>
  );

  return (
    <InspectorFrame
      title="Download details"
      onClose={closeInspector}
      footer={footer}
    >
      <section className="detail-head">
        <StatusPill status={job.status} />
        <h2>{title}</h2>
        <p className="detail-head__source">
          <span>{hostname(job.request.url)}</span>
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label="Copy source link"
            title="Copy source link"
            onClick={() => void navigator.clipboard.writeText(job.request.url)}
          >
            <ClipboardCopy />
          </button>
        </p>
      </section>

      {running && <Progress job={job} />}

      {job.status === "failed" && (
        <div className="callout callout--error" role="status">
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
        <div className="callout callout--warning" role="status">
          <strong>Stopped when the app closed</strong>
          <p>Retry to continue. Partial data is kept so yt-dlp can resume.</p>
        </div>
      )}
      {job.status === "cancelled" && (
        <p className="detail-note">
          Cancelled. Partial files were kept where it was safe to do so.
        </p>
      )}

      <dl className="facts">
        <div>
          <dt>Format</dt>
          <dd>{formatSummary(job)}</dd>
        </div>
        {clip && (
          <div>
            <dt>Clip</dt>
            <dd className="mono">{clip}</dd>
          </div>
        )}
        {job.request.isPlaylist && (
          <div>
            <dt>Items</dt>
            <dd>{job.request.options.playlistItems || "Whole playlist"}</dd>
          </div>
        )}
        {job.request.options.videoConversion && (
          <div>
            <dt>GPU conversion</dt>
            <dd>
              {codecNames[job.request.options.videoConversion.codec]}, quality{" "}
              {job.request.options.videoConversion.quality}
            </dd>
          </div>
        )}
        <div>
          <dt>{job.outputPath ? "File" : "Folder"}</dt>
          <dd className="mono facts__path" title={saved}>
            {saved}
          </dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{new Date(job.createdAt).toLocaleString()}</dd>
        </div>
        {job.finishedAt && (
          <div>
            <dt>Finished</dt>
            <dd>{new Date(job.finishedAt).toLocaleString()}</dd>
          </div>
        )}
      </dl>

      <Diagnostics lines={job.diagnostics} />

      <div className="detail-secondary">
        {job.status === "queued" && (
          <>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void reorder(job.id, "up")}
            >
              <ChevronUp aria-hidden="true" /> Move up
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void reorder(job.id, "down")}
            >
              <ChevronDown aria-hidden="true" /> Move down
            </button>
          </>
        )}
        {!running && (
          <button
            type="button"
            className="button button--ghost button--danger"
            onClick={() => requestRemove(job.id)}
          >
            <Trash2 aria-hidden="true" /> Remove
          </button>
        )}
      </div>
    </InspectorFrame>
  );
}
