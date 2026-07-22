import { useEffect } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { DownloadView } from "../features/download/DownloadView";
import { HistoryView } from "../features/history/HistoryView";
import { QueueView } from "../features/queue/QueueView";
import { SettingsView } from "../features/settings/SettingsView";
import { useAppStore } from "./store";

export default function App() {
  const { activeView, initialize, initialized, fatalError, settings } =
    useAppStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings?.theme ?? "system";
    root.classList.toggle("reduce-motion", Boolean(settings?.reducedMotion));
  }, [settings?.reducedMotion, settings?.theme]);

  if (!initialized) {
    return (
      <main className="center-state" aria-live="polite">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Preparing your download workspace…</p>
      </main>
    );
  }

  if (fatalError) {
    return (
      <main className="center-state center-state--error">
        <AlertTriangle aria-hidden="true" />
        <h1>Couldn’t open the workspace</h1>
        <p>{fatalError}</p>
        <button
          className="button button--primary"
          onClick={() => void initialize()}
        >
          Try again
        </button>
      </main>
    );
  }

  return (
    <AppShell>
      {activeView === "download" && <DownloadView />}
      {activeView === "queue" && <QueueView />}
      {activeView === "history" && <HistoryView />}
      {activeView === "settings" && <SettingsView />}
    </AppShell>
  );
}
