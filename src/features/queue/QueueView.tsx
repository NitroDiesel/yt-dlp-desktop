import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { confirm } from "@tauri-apps/plugin-dialog";
import { ClipboardPaste, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "../../app/store";
import {
  filterFor,
  filterLabels,
  mergeDownloads,
  type DownloadFilter,
} from "../../lib/jobs";
import { modifierKey } from "../../lib/platform";
import { JobRow } from "./JobRow";

const emptyCopy: Record<DownloadFilter, string> = {
  all: "",
  downloading: "Nothing is downloading or waiting right now.",
  completed: "Finished downloads appear here. Removing one never deletes its file.",
  stopped: "Failed, cancelled, and interrupted downloads appear here for retry.",
};

function EmptyDownloads({ filter }: { filter: DownloadFilter }) {
  const openNewDownload = useAppStore((state) => state.openNewDownload);
  if (filter !== "all") {
    return <p className="list-empty">{emptyCopy[filter]}</p>;
  }
  return (
    <section className="paste-target" aria-labelledby="paste-title">
      <ClipboardPaste aria-hidden="true" />
      <h2 id="paste-title">Paste a link to start</h2>
      <p>
        Copy a video, playlist, or channel link, then press{" "}
        <kbd>{modifierKey}</kbd> <kbd>V</kbd> anywhere in this window.
      </p>
      <button
        type="button"
        className="button button--outline"
        onClick={() => openNewDownload()}
      >
        <Plus aria-hidden="true" /> New download
      </button>
    </section>
  );
}

export function QueueView() {
  const { filter, queue, history, queuePaused, selectedId } = useAppStore(
    useShallow((state) => ({
      filter: state.filter,
      queue: state.queue,
      history: state.history,
      queuePaused: state.queuePaused,
      selectedId:
        state.inspector?.kind === "job" ? state.inspector.id : undefined,
    })),
  );
  const { selectJob, cancel, retry, removeJob, setPaused, clearCompleted } =
    useAppStore(
      useShallow((state) => ({
        selectJob: state.selectJob,
        cancel: state.cancel,
        retry: state.retry,
        removeJob: state.removeJob,
        setPaused: state.setPaused,
        clearCompleted: state.clearCompleted,
      })),
    );

  const jobs = useMemo(() => {
    const all = mergeDownloads(queue, history);
    return filter === "all"
      ? all
      : all.filter((job) => filterFor(job.status) === filter);
  }, [queue, history, filter]);

  async function confirmClearCompleted() {
    const count = jobs.length;
    const approved = await confirm(
      `Remove ${count} completed ${count === 1 ? "download" : "downloads"} from the list? The files stay on your computer.`,
      {
        title: "Clear completed downloads",
        kind: "info",
        okLabel: "Clear list",
        cancelLabel: "Keep",
      },
    ).catch(() => false);
    if (approved) await clearCompleted();
  }

  return (
    <div className="page">
      <header className="downloads-header">
        <h1>
          {filterLabels[filter]}
          <span className="count-badge">{jobs.length}</span>
        </h1>
        <div className="topbar__actions">
          {filter === "completed" && jobs.length > 0 && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void confirmClearCompleted()}
            >
              <Trash2 aria-hidden="true" /> Clear list
            </button>
          )}
          <button
            type="button"
            className="button button--ghost"
            aria-pressed={queuePaused}
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

      <div className="job-table">
        <div className="job-table__head" aria-hidden="true">
          <span className="job-cell--name">Name</span>
          <span className="job-cell--size">Size</span>
          <span className="job-cell--progress">Progress</span>
          <span className="job-cell--status">Status</span>
          <span className="job-cell--speed">Speed</span>
          <span className="job-cell--eta">ETA</span>
        </div>
        {jobs.length === 0 ? (
          <EmptyDownloads filter={filter} />
        ) : (
          <ul className="job-list" aria-label={filterLabels[filter]}>
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                selected={job.id === selectedId}
                onSelect={selectJob}
                onCancel={cancel}
                onRetry={retry}
                onRemove={removeJob}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
