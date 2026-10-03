import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { NewDownloadDialog } from "../features/download/NewDownloadDialog";
import { JobDetails } from "../features/queue/JobDetails";
import { QueueView } from "../features/queue/QueueView";
import { SettingsView } from "../features/settings/SettingsView";
import { useAppStore } from "./store";

export default function App() {
  const { page, inspector, newDownloadOpen, initialized, fatalError, theme, accent, reducedMotion } =
    useAppStore(
      useShallow((state) => ({
        page: state.page,
        inspector: state.inspector,
        newDownloadOpen: state.newDownloadOpen,
        initialized: state.initialized,
        fatalError: state.fatalError,
        theme: state.settings?.theme,
        accent: state.settings?.accent,
        reducedMotion: state.settings?.reducedMotion,
      })),
    );
  const initialize = useAppStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme ?? "system";
    root.dataset.accent = accent ?? "blue";
    root.classList.toggle("reduce-motion", Boolean(reducedMotion));
  }, [accent, reducedMotion, theme]);

  if (!initialized) {
    return (
      <main className="center-state" aria-live="polite">
        <p>Starting yt-dlp Desktop…</p>
      </main>
    );
  }

  if (fatalError) {
    return (
      <main className="center-state">
        <AlertTriangle aria-hidden="true" />
        <h1>yt-dlp Desktop couldn't load its data</h1>
        <p>{fatalError}</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void initialize()}
        >
          Try again
        </button>
      </main>
    );
  }

  const panel =
    page === "downloads" && inspector ? (
      <JobDetails key={inspector.id} jobId={inspector.id} />
    ) : undefined;

  return (
    <AppShell inspector={panel}>
      {page === "settings" ? <SettingsView /> : <QueueView />}
      {newDownloadOpen && <NewDownloadDialog />}
    </AppShell>
  );
}
