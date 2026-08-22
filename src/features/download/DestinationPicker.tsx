import { ChevronDown, Clock3, FolderOpen } from "lucide-react";

interface DestinationPickerProps {
  destination: string;
  filenameTemplate: string;
  recentDirectories: string[];
  compact?: boolean;
  onBrowse: () => void;
  onSelect: (directory: string) => void;
}

function destinationChoices(
  destination: string,
  recentDirectories: string[],
): string[] {
  return [destination, ...recentDirectories].filter(
    (directory, index, directories) =>
      Boolean(directory) && directories.indexOf(directory) === index,
  );
}

export function DestinationPicker({
  destination,
  filenameTemplate,
  recentDirectories,
  compact = false,
  onBrowse,
  onSelect,
}: DestinationPickerProps) {
  const choices = destinationChoices(destination, recentDirectories);

  return (
    <div
      className={`destination-picker${compact ? " destination-picker--compact" : ""}`}
    >
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
      <label className="recent-destination">
        <Clock3 aria-hidden="true" />
        <span>Recent</span>
        <select
          aria-label="Recent download folders"
          value={destination}
          disabled={choices.length === 0}
          onChange={(event) => onSelect(event.target.value)}
        >
          {choices.length === 0 ? (
            <option value="">No recent folders</option>
          ) : (
            choices.map((directory) => (
              <option key={directory} value={directory}>
                {directory}
              </option>
            ))
          )}
        </select>
        <ChevronDown aria-hidden="true" />
      </label>
    </div>
  );
}
