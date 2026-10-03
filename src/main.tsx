import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/global.css";

/**
 * Release builds behave like a desktop app, not a web page: no reload, print,
 * find, or "Inspect" context menu. Text fields keep their copy/paste menu.
 */
function suppressBrowserChrome() {
  window.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("input, textarea, pre, .mono")) event.preventDefault();
  });
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (
      key === "f5" ||
      (modifier && ["r", "p", "f", "g", "u", "j"].includes(key)) ||
      (modifier && event.shiftKey && ["i", "c"].includes(key))
    )
      event.preventDefault();
  });
}

async function bootstrap() {
  if (import.meta.env.PROD) suppressBrowserChrome();
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("visual-preview")
  ) {
    const { installVisualPreview } = await import("./visualPreview");
    await installVisualPreview();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
