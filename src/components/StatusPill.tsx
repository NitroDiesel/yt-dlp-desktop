import {
  AlertCircle,
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  Clock3,
  RotateCcw,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { JobStatus } from "../types/contracts";

const statusLabels: Record<JobStatus, string> = {
  queued: "Waiting",
  analyzing: "Starting",
  downloading: "Downloading",
  post_processing: "Finishing",
  completed: "Completed",
  failed: "Needs attention",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

const icons: Record<JobStatus, LucideIcon> = {
  queued: Clock3,
  analyzing: ArrowDownToLine,
  downloading: ArrowDownToLine,
  post_processing: Wand2,
  completed: CheckCircle2,
  failed: AlertCircle,
  cancelled: Ban,
  interrupted: RotateCcw,
};

/**
 * Status in words; color is never the only signal and nothing spins.
 * `pill` is the compact tinted form used in the downloads table.
 */
export function StatusPill({
  status,
  variant = "label",
}: {
  status: JobStatus;
  variant?: "label" | "pill";
}) {
  const Icon = icons[status];
  return (
    <span className={`status status--${status}${variant === "pill" ? " status--pill" : ""}`}>
      {variant === "label" && <Icon aria-hidden="true" />}
      {statusLabels[status]}
    </span>
  );
}
