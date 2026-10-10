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
