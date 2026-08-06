import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/global.css";

async function bootstrap() {
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
