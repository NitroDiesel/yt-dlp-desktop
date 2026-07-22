import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { JobStatus } from "../types/contracts";

const labels: Record<JobStatus, string> = {
  queued: "Waiting",
  analyzing: "Analyzing",
  downloading: "Downloading",
  post_processing: "Finishing",
  completed: "Completed",
  failed: "Needs attention",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export function StatusPill({ status }: { status: JobStatus }) {
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "failed"
        ? AlertCircle
        : status === "cancelled"
          ? Ban
          : status === "interrupted"
            ? RotateCcw
            : ["downloading", "post_processing", "analyzing"].includes(status)
              ? LoaderCircle
              : Clock3;
  return (
    <span className={`status-pill status-pill--${status}`}>
      <Icon
        size={14}
        className={
          ["downloading", "post_processing", "analyzing"].includes(status)
            ? "spin"
            : ""
        }
        aria-hidden="true"
      />
      {labels[status]}
    </span>
  );
}
