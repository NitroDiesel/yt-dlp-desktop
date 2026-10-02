const isApple =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Label for the primary shortcut modifier on this platform. */
export const modifierKey = isApple ? "⌘" : "Ctrl";
