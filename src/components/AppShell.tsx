import type { ReactNode } from "react";
import { Download, History, ListVideo, Settings } from "lucide-react";
import { useAppStore, type ViewName } from "../app/store";

const navigation: Array<{
  view: ViewName;
  label: string;
  icon: typeof Download;
}> = [
  { view: "download", label: "Download", icon: Download },
  { view: "queue", label: "Queue", icon: ListVideo },
  { view: "history", label: "History", icon: History },
  { view: "settings", label: "Settings", icon: Settings },
];

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
      <aside className="sidebar">
        <div className="brand" aria-label="yt-dlp Desktop">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-copy">
            <strong>yt-dlp</strong>
            <small>DESKTOP</small>
          </span>
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
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
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

        <button className="engine-status" onClick={() => setView("settings")}>
          <span
            className={`status-dot ${ytDlpReady ? "status-dot--ready" : "status-dot--warning"}`}
          />
          <span>
            <strong>{ytDlpReady ? "Engine ready" : "Setup needed"}</strong>
            <small>yt-dlp dependency</small>
          </span>
        </button>
      </aside>

      <main className="workspace" id="main-content">
        {children}
      </main>
    </div>
  );
}
