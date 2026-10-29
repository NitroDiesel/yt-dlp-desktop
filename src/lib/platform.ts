import { convertFileSrc } from "@tauri-apps/api/core";

const isApple =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Where a deleted file goes, in this platform's words. */
export const trashName =
  typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent)
    ? "Recycle Bin"
    : "Trash";

/** Label for the primary shortcut modifier on this platform. */
export const modifierKey = isApple ? "⌘" : "Ctrl";

/** The thumbnail the app saved for a download, served by the `thumb` protocol. */
export function savedThumbnail(jobId: string): string | undefined {
  try {
    return convertFileSrc(jobId, "thumb");
  } catch {
    // Outside the app (tests), there is no protocol to ask.
    return undefined;
  }
}
