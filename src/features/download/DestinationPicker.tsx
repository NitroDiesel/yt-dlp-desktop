import { FolderOpen } from "lucide-react";

/** The folder a download is saved to; clicking opens the system folder picker. */
export function DestinationPicker({
  destination,
  onBrowse,
}: {
  destination: string;
  onBrowse: () => void;
}) {
  return (
    <button
      type="button"
      className="path-picker"
      onClick={onBrowse}
      aria-label="Browse for a download folder"
      title={destination || undefined}
    >
      <span className="path-picker__label">Save to</span>
      <span className="path-picker__path mono">
        {destination || "Choose a folder"}
      </span>
      <FolderOpen aria-hidden="true" />
    </button>
  );
}
