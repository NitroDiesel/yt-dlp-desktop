import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertCircle } from "lucide-react";
import { useAppStore, type PendingRemoval } from "../../app/store";
import { findJob, hasDeletableFile, jobTitle } from "../../lib/jobs";
import { trashName } from "../../lib/platform";
import type { DownloadJob } from "../../types/contracts";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Asks before removing downloads from the list, and whether their finished files
 * go too. Files go to the Recycle Bin or Trash, so a wrong choice can be undone there.
 */
export function RemoveDownloadDialog({ removal }: { removal: PendingRemoval }) {
  const jobs = useAppStore(
    useShallow((state) =>
      removal.jobIds
        .map((id) => findJob(state.queue, state.history, id))
        .filter((job): job is DownloadJob => job !== undefined),
    ),
  );
  const removeJobs = useAppStore((state) => state.removeJobs);
  const cancelRemove = useAppStore((state) => state.cancelRemove);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (jobs.length === 0) cancelRemove();
  }, [jobs.length, cancelRemove]);

  if (jobs.length === 0) return null;

  const single = jobs.length === 1 ? jobs[0] : undefined;
  const files = jobs.filter(hasDeletableFile).length;
  const keptPlaylists = jobs.some(
    (job) => job.request.isPlaylist && job.status === "completed",
  );

  async function confirm() {
    setRemoving(true);
    setError(undefined);
    try {
      await removeJobs(
        jobs.map((job) => job.id),
        deleteFiles,
      );
    } catch (reason) {
      setError(String(reason));
      setRemoving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="task-dialog confirm-dialog"
      aria-labelledby="remove-download-title"
      aria-describedby="remove-download-question"
      onCancel={(event) => {
        event.preventDefault();
        if (!removing) cancelRemove();
      }}
    >
      <header className="task-dialog__header">
        <h2 id="remove-download-title">
          {single ? "Remove download" : `Remove ${jobs.length} downloads`}
        </h2>
      </header>
      <div className="task-dialog__body">
        <p id="remove-download-question">
          {single ? (
            <>
              Remove <strong>{jobTitle(single)}</strong> from the list?
            </>
          ) : (
            `Remove ${jobs.length} downloads from the list?`
          )}
          {removal.skipped > 0 &&
            ` ${plural(removal.skipped, "active download stays", "active downloads stay")}.`}
        </p>
        {files > 0 && (
          <label className="confirm-dialog__option">
            <input
              type="checkbox"
              checked={deleteFiles}
              disabled={removing}
              onChange={(event) => setDeleteFiles(event.target.checked)}
            />
            <span>
              {single ? "Also delete the file" : `Also delete ${plural(files, "file", "files")}`}
              <small title={single?.outputPath}>
                {files === 1 ? "It goes" : "They go"} to the {trashName}, where you can
                restore {files === 1 ? "it" : "them"}.
                {keptPlaylists && " Playlist files stay in their folders."}
              </small>
            </span>
          </label>
        )}
      </div>
      <footer className="task-dialog__footer">
        {error && (
          <p className="task-dialog__error" role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        <button
          type="button"
          className="button button--outline"
          disabled={removing}
          onClick={cancelRemove}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--primary"
          autoFocus
          disabled={removing}
          onClick={() => void confirm()}
        >
          {deleteFiles
            ? single
              ? "Remove and delete file"
              : `Remove and delete ${plural(files, "file", "files")}`
            : "Remove"}
        </button>
      </footer>
    </dialog>
  );
}
