import type { ReactNode } from "react";
import {
  ChevronRight,
  Download,
  History,
  ListVideo,
  PanelLeft,
  Settings,
} from "lucide-react";
import { useAppStore, type ViewName } from "../app/store";

const navigation: Array<{
  view: ViewName;
  label: string;
  icon: typeof Download;
}> = [
  { view: "queue", label: "Queue", icon: ListVideo },
  { view: "history", label: "History", icon: History },
];

const viewLabels: Record<ViewName, string> = {
  download: "New download",
  queue: "Queue",
  history: "History",
  settings: "Settings",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { activeView, setView, queue, dependencies } = useAppStore();
  const activeJobs = queue.filter((job) =>
    ["downloading", "post_processing"].includes(job.status),
  );
  const queuedJobs = queue.filter((job) => job.status === "queued");
  const ytDlpReady = dependencies.some(
    (dependency) =>
      dependency.kind === "yt_dlp" && dependency.status === "available",
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <div className="brand" aria-label="yt-dlp Desktop">
          <PanelLeft className="brand-mark" aria-hidden="true" />
          <span className="brand-copy">
            <strong>yt-dlp</strong> Desktop
          </span>
        </div>

        <button
          className={`sidebar-new ${activeView === "download" ? "sidebar-new--active" : ""}`}
          onClick={() => setView("download")}
        >
          <Download aria-hidden="true" />
          <span>New download</span>
          <kbd>Ctrl N</kbd>
        </button>

        <div className="sidebar-section-heading">
          <span>Downloads</span>
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map(({ view, label, icon: Icon }) => {
            const count =
              view === "queue" ? activeJobs.length + queuedJobs.length : 0;
            return (
              <button
                key={view}
                className={`nav-item ${activeView === view ? "nav-item--active" : ""}`}
                aria-current={activeView === view ? "page" : undefined}
                onClick={() => setView(view)}
              >
                <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                <span>{label}</span>
                {count > 0 && (
                  <span className="nav-count" aria-label={`${count} jobs`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            className="engine-status"
            aria-label={
              ytDlpReady
                ? "Download engine ready. Open settings"
                : "Download engine setup needed. Open settings"
            }
            onClick={() => setView("settings")}
          >
            <span
              className={`status-dot ${ytDlpReady ? "status-dot--ready" : "status-dot--warning"}`}
              aria-hidden="true"
            />
            <span>
              <strong>{ytDlpReady ? "Engine ready" : "Setup needed"}</strong>
              <small>Bundled runtime</small>
            </span>
          </button>
          <button
            className={`sidebar-settings ${activeView === "settings" ? "sidebar-settings--active" : ""}`}
            aria-current={activeView === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <section className="workspace-shell">
        <header className="workspace-bar">
          <div className="workspace-crumbs" aria-label="Current workspace">
            <span>yt-dlp Desktop</span>
            <ChevronRight aria-hidden="true" />
            <strong>{viewLabels[activeView]}</strong>
          </div>
          <div className="workspace-bar__status">
            <span
              className={`status-dot ${ytDlpReady ? "status-dot--ready" : "status-dot--warning"}`}
              aria-hidden="true"
            />
            {ytDlpReady ? "Ready" : "Setup needed"}
          </div>
        </header>
        <main className="workspace" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </section>
    </div>
  );
}
