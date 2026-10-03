import type { DownloadOptions } from "../types/contracts";

export interface ClipDraft {
  start: string;
  end: string;
  precise: boolean;
}

export type TimecodeResult =
  | { kind: "valid"; seconds: number }
  | { kind: "invalid"; message: string };

export type ClipValidation =
  | {
      kind: "valid";
      startSeconds: number;
      endSeconds: number;
      clip: NonNullable<DownloadOptions["clip"]>;
    }
  | { kind: "invalid"; message: string };

export function parseTimecode(value: string): TimecodeResult {
  const input = value.trim();
  if (!input) {
    return { kind: "invalid", message: "Enter a time." };
  }

  const parts = input.split(":");
  if (parts.length > 3) {
    return { kind: "invalid", message: "Use seconds, MM:SS, or HH:MM:SS." };
  }
  if (
    parts.some((part, index) => {
      const last = index === parts.length - 1;
      const pattern = last ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/;
      return !pattern.test(part);
    })
  ) {
    return { kind: "invalid", message: "Use seconds, MM:SS, or HH:MM:SS." };
  }

  const values = parts.map(Number);
  const seconds = values.at(-1);
  const minutes = values.length > 1 ? values.at(-2) : 0;
  const hours = values.length > 2 ? values[0] : 0;
  if (
    seconds == null ||
    minutes == null ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours) ||
    seconds < 0 ||
    minutes < 0 ||
    hours < 0 ||
    (parts.length > 1 && seconds >= 60) ||
    (parts.length > 2 && minutes >= 60)
  ) {
    return { kind: "invalid", message: "Use seconds, MM:SS, or HH:MM:SS." };
  }

  return {
    kind: "valid",
    seconds: hours * 3600 + minutes * 60 + seconds,
  };
}

export function formatTimecode(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const fractional = milliseconds
    ? `.${milliseconds.toString().padStart(3, "0").replace(/0+$/, "")}`
    : "";
  const secondPart = `${wholeSeconds.toString().padStart(2, "0")}${fractional}`;

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${secondPart}`
    : `${minutes}:${secondPart}`;
}

export function validateClipDraft(
  draft: ClipDraft,
  mediaDuration?: number,
): ClipValidation {
  const start = parseTimecode(draft.start);
  if (start.kind === "invalid") {
    return {
      kind: "invalid",
      message: "Enter the start time as seconds, MM:SS, or HH:MM:SS.",
    };
  }
  const end = parseTimecode(draft.end);
  if (end.kind === "invalid") {
    return {
      kind: "invalid",
      message: "Enter the end time as seconds, MM:SS, or HH:MM:SS.",
    };
  }
  if (end.seconds <= start.seconds) {
    return { kind: "invalid", message: "End time must be after start time." };
  }
  if (
    mediaDuration != null &&
    Number.isFinite(mediaDuration) &&
    end.seconds > mediaDuration + 0.001
  ) {
    return {
      kind: "invalid",
      message: `End time must be within ${formatTimecode(mediaDuration)}.`,
    };
  }

  return {
    kind: "valid",
    startSeconds: start.seconds,
    endSeconds: end.seconds,
    clip: {
      startSeconds: start.seconds,
      durationSeconds: end.seconds - start.seconds,
      precise: draft.precise,
    },
  };
}
