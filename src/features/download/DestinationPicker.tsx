import { FolderOpen } from "lucide-react";

interface DestinationPickerProps {
  destination: string;
  filenameTemplate: string;
  compact?: boolean;
  onBrowse: () => void;
}

export function DestinationPicker({
  destination,
  filenameTemplate,
  compact = false,
  onBrowse,
}: DestinationPickerProps) {
  return (
    <button
      type="button"
      className={`path-picker${compact ? " path-picker--compact" : ""}`}
      onClick={onBrowse}
      aria-label="Browse for a download folder"
    >
      <FolderOpen aria-hidden="true" />
      <span>
        <strong>{destination || "Select a folder"}</strong>
        <small>{filenameTemplate}</small>
      </span>
    </button>
  );
}
