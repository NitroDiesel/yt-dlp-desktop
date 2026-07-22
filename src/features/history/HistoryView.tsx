import {
  ClipboardCopy,
  ExternalLink,
  FolderOpen,
  History,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../../app/store";
import { EmptyState } from "../../components/EmptyState";
import { StatusPill } from "../../components/StatusPill";
import { appApi } from "../../lib/api";
import { hostname } from "../../lib/format";

export function HistoryView() {
  const { history, retry, removeHistory, setView } = useAppStore();
  return (
    <div className="view">
      <header className="view-header">
        <div>
          <p className="eyebrow">RECENT ACTIVITY</p>
          <h1>History</h1>
          <p>Completed and failed downloads stay here until you remove them.</p>
        </div>
      </header>
      {history.length === 0 ? (
        <EmptyState
          icon={History}
          title="No download history yet"
          action={
            <button
              className="button button--primary"
              onClick={() => setView("download")}
            >
              Download something
            </button>
          }
        >
          Finished downloads and useful retry details will appear here. Removing
          an entry never deletes the media file.
        </EmptyState>
      ) : (
        <section className="history-list" aria-label="Download history">
          {history.map((job) => (
            <article className="history-row" key={job.id}>
              <div className="history-row__main">
                <p>
                  {hostname(job.request.url)} ·{" "}
                  {job.finishedAt
                    ? new Date(job.finishedAt).toLocaleString()
                    : "Recently"}
                </p>
                <h2>{job.title || "Untitled download"}</h2>
                <span>
                  {job.request.options.mode === "audio"
                    ? `Audio · ${job.request.options.audioFormat.toUpperCase()}`
                    : "Video"}
                </span>
              </div>
              <StatusPill status={job.status} />
              <div className="history-row__actions">
                <button
                  className="icon-button"
                  title="Copy source link"
                  aria-label="Copy source link"
                  onClick={() =>
                    void navigator.clipboard.writeText(job.request.url)
                  }
                >
                  <ClipboardCopy />
                </button>
                {job.outputPath && (
                  <>
                    <button
                      className="icon-button"
                      title="Open file"
                      aria-label="Open downloaded file"
                      onClick={() => void appApi.openJobOutput(job.id)}
                    >
                      <ExternalLink />
                    </button>
                    <button
                      className="icon-button"
                      title="Show in folder"
                      aria-label="Show downloaded file in folder"
                      onClick={() => void appApi.revealJobOutput(job.id)}
                    >
                      <FolderOpen />
                    </button>
                  </>
                )}
                {job.status !== "completed" && (
                  <button
                    className="icon-button"
                    title="Retry"
                    aria-label="Retry download"
                    onClick={() => void retry(job.id)}
                  >
                    <RotateCcw />
                  </button>
                )}
                <button
                  className="icon-button"
                  title="Remove history entry"
                  aria-label="Remove history entry"
                  onClick={() => void removeHistory(job.id)}
                >
                  <Trash2 />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
