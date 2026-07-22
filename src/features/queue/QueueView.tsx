import { Download, ListVideo, Pause, Play, Trash2 } from "lucide-react";
import { useAppStore } from "../../app/store";
import { EmptyState } from "../../components/EmptyState";
import { JobCard } from "./JobCard";

export function QueueView() {
  const {
    queue,
    queuePaused,
    setPaused,
    cancel,
    retry,
    removeQueueJob,
    clearCompleted,
    reorder,
    setView,
  } = useAppStore();
  const activeCount = queue.filter((job) =>
    ["analyzing", "downloading", "post_processing"].includes(job.status),
  ).length;
  const queuedCount = queue.filter((job) => job.status === "queued").length;
  const hasCompleted = queue.some((job) => job.status === "completed");

  return (
    <div className="view">
      <header className="view-header view-header--actions">
        <div>
          <p className="eyebrow">DOWNLOADS</p>
          <h1>Queue</h1>
          <p>
            {activeCount > 0
              ? `${activeCount} active · ${queuedCount} waiting`
              : queuedCount > 0
                ? `${queuedCount} waiting`
                : "Nothing in motion"}
          </p>
        </div>
        <div className="header-actions">
          {hasCompleted && (
            <button
              className="button button--quiet"
              onClick={() => void clearCompleted()}
            >
              <Trash2 aria-hidden="true" /> Clear completed
            </button>
          )}
          <button
            className="button button--secondary"
            onClick={() => void setPaused(!queuePaused)}
          >
            {queuePaused ? (
              <Play aria-hidden="true" />
            ) : (
              <Pause aria-hidden="true" />
            )}
            {queuePaused ? "Resume queue" : "Pause queue"}
          </button>
        </div>
      </header>

      {queuePaused && (
        <div className="queue-notice">
          <Pause aria-hidden="true" />
          <span>
            <strong>The queue is paused.</strong> Active downloads continue, but
            new ones won’t start.
          </span>
        </div>
      )}

      {queue.length === 0 ? (
        <EmptyState
          icon={ListVideo}
          title="Your queue is clear"
          action={
            <button
              className="button button--primary"
              onClick={() => setView("download")}
            >
              <Download aria-hidden="true" /> Start a download
            </button>
          }
        >
          Analyzed links and active downloads will appear here with progress,
          speed, and time remaining.
        </EmptyState>
      ) : (
        <section className="job-list" aria-label="Download queue">
          {queue.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onCancel={() => void cancel(job.id)}
              onRetry={() => void retry(job.id)}
              onRemove={() => void removeQueueJob(job.id)}
              onMove={(direction) => void reorder(job.id, direction)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
