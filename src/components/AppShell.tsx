import { useEffect, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowDown,
  CircleCheck,
  CircleStop,
  Download,
  Layers,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "../app/store";
import appIcon from "../assets/app-icon.svg";
import {
  countDownloads,
  filterLabels,
  isRunning,
  linkFromText,
  type DownloadFilter,
} from "../lib/jobs";
import { formatBytes } from "../lib/format";
import { modifierKey } from "../lib/platform";

const filters: Array<{ filter: DownloadFilter; icon: LucideIcon }> = [
  { filter: "all", icon: Layers },
  { filter: "downloading", icon: Download },
  { filter: "completed", icon: CircleCheck },
  { filter: "stopped", icon: CircleStop },
];

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Ctrl/⌘+N, Ctrl/⌘+comma, Escape, and pasting a link anywhere outside a field. */
function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useAppStore.getState();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        store.openNewDownload();
      } else if (modifier && event.key === ",") {
        event.preventDefault();
        store.showSettings();
      } else if (
        event.key === "Escape" &&
        store.inspector &&
        !store.newDownloadOpen &&
        !isEditable(event.target)
      ) {
        store.closeInspector();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const link = linkFromText(event.clipboardData?.getData("text") ?? "");
      if (!link) return;
      event.preventDefault();
      useAppStore.getState().openNewDownload(link);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}

function Sidebar() {
  const { page, filter, newDownloadOpen, showDownloads, showSettings, openNewDownload } =
    useAppStore(
      useShallow((state) => ({
        page: state.page,
        filter: state.filter,
        newDownloadOpen: state.newDownloadOpen,
        showDownloads: state.showDownloads,
        showSettings: state.showSettings,
        openNewDownload: state.openNewDownload,
      })),
    );
  const counts = useAppStore(
    useShallow((state) => countDownloads(state.queue, state.history)),
  );
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img className="brand-mark" src={appIcon} alt="" width={22} height={22} />
        <span className="sidebar__label">
          yt-dlp <span>Desktop</span>
        </span>
      </div>

      <button
        type="button"
        className={`sidebar-row sidebar-row--new ${newDownloadOpen ? "sidebar-row--active" : ""}`}
        onClick={() => openNewDownload()}
        title={`New download (${modifierKey}+N)`}
      >
        <Plus aria-hidden="true" />
        <span className="sidebar__label">New download</span>
        <kbd className="sidebar__label">{modifierKey} N</kbd>
      </button>

      <nav className="sidebar__nav" aria-label="Downloads">
        {filters.map(({ filter: value, icon: Icon }) => {
          const active = page === "downloads" && filter === value;
          return (
            <button
              key={value}
              type="button"
              className={`sidebar-row ${active ? "sidebar-row--active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={filterLabels[value]}
              onClick={() => showDownloads(value)}
            >
              <Icon aria-hidden="true" />
              <span className="sidebar__label">{filterLabels[value]}</span>
              {counts[value] > 0 && (
                <span className="sidebar-row__count">{counts[value]}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className={`sidebar-row ${page === "settings" ? "sidebar-row--active" : ""}`}
          aria-current={page === "settings" ? "page" : undefined}
          title={`Settings (${modifierKey}+,)`}
          onClick={showSettings}
        >
          <Settings aria-hidden="true" />
          <span className="sidebar__label">Settings</span>
        </button>
      </div>
    </aside>
  );
}

/** Aggregate transfer state and engine health, the way download managers report it. */
function StatusBar() {
  const { speed, running, waiting } = useAppStore(
    useShallow((state) => {
      let speed = 0;
      let running = 0;
      let waiting = 0;
      for (const job of state.queue) {
        if (job.status === "queued") waiting += 1;
        else if (isRunning(job.status)) {
          running += 1;
          speed += job.progress.speedBytesPerSecond ?? 0;
        }
      }
      // Rounded to 10 KB/s so tiny speed jitter does not re-render the bar.
      return { speed: Math.round(speed / 10_000) * 10_000, running, waiting };
    }),
  );
  const { completed, stopped } = useAppStore(
    useShallow((state) => countDownloads(state.queue, state.history)),
  );
  const queuePaused = useAppStore((state) => state.queuePaused);
  const engineReady = useAppStore((state) =>
    state.dependencies.some(
      (dependency) => dependency.kind === "yt_dlp" && dependency.status === "available",
    ),
  );
  const showSettings = useAppStore((state) => state.showSettings);

  return (
    <footer className="status-bar">
      <span className="status-bar__speed" title="Total download speed">
        <ArrowDown aria-hidden="true" />
        <span className="mono">{formatBytes(speed)}/s</span>
      </span>
      <span className="status-bar__counts">
        <span>Active {running}</span>
        <span>Waiting {waiting}</span>
        <span>Completed {completed}</span>
        <span>Failed {stopped}</span>
      </span>
      {queuePaused && <span className="status-bar__paused">Queue paused</span>}
      <button
        type="button"
        className={`engine-pill ${engineReady ? "" : "engine-pill--warning"}`}
        onClick={showSettings}
        title="Download engine status. Opens Settings."
      >
        <span className="engine-pill__dot" aria-hidden="true" />
        {engineReady ? "Engine ready" : "Engine needs attention"}
      </button>
    </footer>
  );
}

export function AppShell({
  children,
  inspector,
}: {
  children: ReactNode;
  inspector?: ReactNode;
}) {
  useGlobalShortcuts();
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar />
      <div className={`stage ${inspector ? "stage--inspecting" : ""}`}>
        <main className="workspace" id="main-content" tabIndex={-1}>
          {children}
        </main>
        {inspector}
      </div>
      <StatusBar />
    </div>
  );
}
