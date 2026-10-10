import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useAppStore } from "../../app/store";
import { findJob, jobTitle } from "../../lib/jobs";
import { trashName } from "../../lib/platform";

/**
 * Asks whether removing a finished download should also delete its file. The file
 * goes to the Recycle Bin or Trash, so a wrong choice can be undone there.
 */
export function RemoveDownloadDialog({ jobId }: { jobId: string }) {
  const job = useAppStore((state) => findJob(state.queue, state.history, jobId));
  const removeJob = useAppStore((state) => state.removeJob);
  const cancelRemove = useAppStore((state) => state.cancelRemove);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleteFile, setDeleteFile] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!job) cancelRemove();
  }, [job, cancelRemove]);

  if (!job) return null;

  async function confirm() {
    setRemoving(true);
    setError(undefined);
    try {
      await removeJob(jobId, deleteFile);
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
        <h2 id="remove-download-title">Remove download</h2>
      </header>
      <div className="task-dialog__body">
        <p id="remove-download-question">
          Remove <strong>{jobTitle(job)}</strong> from the list?
        </p>
        <label className="confirm-dialog__option">
          <input
            type="checkbox"
            checked={deleteFile}
            disabled={removing}
            onChange={(event) => setDeleteFile(event.target.checked)}
          />
          <span>
            Also delete the file
            <small title={job.outputPath}>
              It goes to the {trashName}, where you can restore it.
            </small>
          </span>
        </label>
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
          {deleteFile ? "Remove and delete file" : "Remove"}
        </button>
      </footer>
    </dialog>
  );
}
