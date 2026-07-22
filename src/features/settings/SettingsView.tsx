import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  CircleAlert,
  FileCog,
  FolderOpen,
  RefreshCw,
  Save,
} from "lucide-react";
import { useAppStore } from "../../app/store";
import type { AppSettings, DependencyInfo } from "../../types/contracts";

function DependencyCard({
  dependency,
  onChoose,
}: {
  dependency: DependencyInfo;
  onChoose?: () => void;
}) {
  const ready = dependency.status === "available";
  const labels: Record<DependencyInfo["kind"], string> = {
    yt_dlp: "yt-dlp",
    ffmpeg: "FFmpeg",
    ffprobe: "FFprobe",
    javascript_runtime: "JavaScript runtime",
  };
  return (
    <article className="dependency-card">
      <span
        className={`dependency-icon ${ready ? "dependency-icon--ready" : ""}`}
      >
        {ready ? (
          <Check aria-hidden="true" />
        ) : (
          <CircleAlert aria-hidden="true" />
        )}
      </span>
      <div>
        <h3>{labels[dependency.kind]}</h3>
        <p>
          {ready
            ? dependency.version || "Available"
            : dependency.message || "Not found"}
        </p>
        <small>
          {dependency.path ||
            (dependency.kind === "javascript_runtime"
              ? "Deno is recommended for full YouTube support"
              : "Choose an executable or install it on this system")}
        </small>
      </div>
      {onChoose && (
        <button className="button button--quiet" onClick={onChoose}>
          Choose
        </button>
      )}
    </article>
  );
}

export function SettingsView() {
  const { settings, dependencies, saveSettings, refreshDependencies } =
    useAppStore();
  const [draft, setDraft] = useState<AppSettings | undefined>(settings);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return null;
  const activeDraft = draft;

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft({ ...draft, [key]: value });
    setSaveState("idle");
  };

  async function chooseDirectory() {
    const value = await open({
      directory: true,
      multiple: false,
      defaultPath: activeDraft.downloadDirectory || undefined,
    });
    if (value) set("downloadDirectory", value);
  }

  async function chooseExecutable(kind: DependencyInfo["kind"]) {
    const value = await open({
      directory: false,
      multiple: false,
      title: `Choose ${kind.replaceAll("_", " ")} executable`,
    });
    if (!value) return;
    if (kind === "yt_dlp") set("ytDlpPath", value);
    if (kind === "ffmpeg" || kind === "ffprobe") set("ffmpegPath", value);
    if (kind === "javascript_runtime") set("denoPath", value);
  }

  async function chooseCookieFile() {
    const value = await open({
      directory: false,
      multiple: false,
      title: "Choose a Netscape-format cookie file",
    });
    if (value) set("cookieFile", value);
  }

  async function save() {
    setSaveState("saving");
    try {
      await saveSettings(activeDraft);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="view settings-view">
      <header className="view-header view-header--actions">
        <div>
          <p className="eyebrow">PREFERENCES</p>
          <h1>Settings</h1>
          <p>Defaults stay local to this computer.</p>
        </div>
        <button
          className="button button--primary"
          onClick={() => void save()}
          disabled={saveState === "saving"}
        >
          <Save aria-hidden="true" />
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : "Save changes"}
        </button>
      </header>
      {saveState === "error" && (
        <div className="inline-message inline-message--error" role="alert">
          <CircleAlert aria-hidden="true" />
          <p>
            Settings could not be saved. Check the technical log and try again.
          </p>
        </div>
      )}

      <section
        className="settings-section"
        aria-labelledby="downloads-settings"
      >
        <div className="settings-section__intro">
          <h2 id="downloads-settings">Downloads</h2>
          <p>
            Choose safe defaults for new jobs. Each download can still override
            these.
          </p>
        </div>
        <div className="settings-panel">
          <label className="field field--button">
            <span>Default folder</span>
            <button
              className="path-picker"
              onClick={() => void chooseDirectory()}
            >
              <FolderOpen aria-hidden="true" />
              <strong>{draft.downloadDirectory || "Choose a folder"}</strong>
            </button>
          </label>
          <label className="field">
            <span>Filename template</span>
            <input
              value={draft.filenameTemplate}
              onChange={(event) => set("filenameTemplate", event.target.value)}
            />
            <small>
              yt-dlp template fields are supported. Path separators and absolute
              paths are rejected.
            </small>
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Default mode</span>
              <select
                value={draft.defaultMode}
                onChange={(event) =>
                  set(
                    "defaultMode",
                    event.target.value as AppSettings["defaultMode"],
                  )
                }
              >
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="custom">Exact format</option>
              </select>
            </label>
            <label className="field">
              <span>Default quality</span>
              <select
                value={draft.defaultQuality}
                onChange={(event) => set("defaultQuality", event.target.value)}
              >
                <option value="best">Best available</option>
                <option value="2160">Up to 2160p</option>
                <option value="1440">Up to 1440p</option>
                <option value="1080">Up to 1080p</option>
                <option value="720">Up to 720p</option>
                <option value="single">Best single file</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Simultaneous downloads: {draft.queueConcurrency}</span>
            <input
              type="range"
              min="1"
              max="4"
              value={draft.queueConcurrency}
              onChange={(event) =>
                set("queueConcurrency", Number(event.target.value))
              }
            />
            <small>
              One is safest. Higher values use more bandwidth and may trigger
              site limits.
            </small>
          </label>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="engine-settings">
        <div className="settings-section__intro">
          <h2 id="engine-settings">Download engine</h2>
          <p>
            The exact executable, version, and source are always visible. No
            binary is run silently from the working folder.
          </p>
          <button
            className="button button--quiet"
            onClick={() => void refreshDependencies()}
          >
            <RefreshCw aria-hidden="true" /> Check again
          </button>
        </div>
        <div className="settings-panel dependency-list">
          {dependencies.map((dependency) => (
            <DependencyCard
              key={dependency.kind}
              dependency={dependency}
              onChoose={
                dependency.kind === "ffprobe"
                  ? undefined
                  : () => void chooseExecutable(dependency.kind)
              }
            />
          ))}
          <div className="legal-note">
            <FileCog aria-hidden="true" />
            <p>
              <strong>yt-dlp and Deno are included with the app.</strong> Their
              pinned, verified versions update with app releases. FFmpeg uses
              your system or a custom installation in this release.
            </p>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="network-settings">
        <div className="settings-section__intro">
          <h2 id="network-settings">Network & access</h2>
          <p>Cookie contents are never copied into the app database.</p>
        </div>
        <div className="settings-panel">
          <div className="field-grid">
            <label className="field">
              <span>Retries</span>
              <input
                type="number"
                min="0"
                max="50"
                value={draft.retries}
                onChange={(event) => set("retries", Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>Fragment retries</span>
              <input
                type="number"
                min="0"
                max="50"
                value={draft.fragmentRetries}
                onChange={(event) =>
                  set("fragmentRetries", Number(event.target.value))
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Rate limit</span>
            <input
              placeholder="For example: 5M"
              value={draft.rateLimit ?? ""}
              onChange={(event) =>
                set("rateLimit", event.target.value || undefined)
              }
            />
          </label>
          <label className="field">
            <span>Proxy</span>
            <input
              type="url"
              autoComplete="off"
              placeholder="socks5://127.0.0.1:1080"
              value={draft.proxy ?? ""}
              onChange={(event) =>
                set("proxy", event.target.value || undefined)
              }
            />
            <small>
              Use a URL without credentials. Passwords are intentionally not
              stored.
            </small>
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Browser cookies</span>
              <select
                value={draft.cookieBrowser ?? ""}
                onChange={(event) =>
                  set("cookieBrowser", event.target.value || undefined)
                }
              >
                <option value="">None</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="firefox">Firefox</option>
                <option value="brave">Brave</option>
                <option value="chromium">Chromium</option>
                <option value="opera">Opera</option>
                <option value="vivaldi">Vivaldi</option>
                <option value="safari">Safari</option>
              </select>
            </label>
            <label className="field field--button">
              <span>Cookie file</span>
              <button
                type="button"
                className="path-picker"
                onClick={() => void chooseCookieFile()}
              >
                <FileCog aria-hidden="true" />
                <strong>{draft.cookieFile || "Choose a cookie file"}</strong>
              </button>
            </label>
          </div>
        </div>
      </section>

      <section
        className="settings-section"
        aria-labelledby="appearance-settings"
      >
        <div className="settings-section__intro">
          <h2 id="appearance-settings">Appearance</h2>
          <p>Follow the system or choose a fixed theme.</p>
        </div>
        <div className="settings-panel">
          <label className="field">
            <span>Theme</span>
            <select
              value={draft.theme}
              onChange={(event) =>
                set("theme", event.target.value as AppSettings["theme"])
              }
            >
              <option value="system">Use system setting</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.reducedMotion}
              onChange={(event) => set("reducedMotion", event.target.checked)}
            />
            <span>
              <strong>Reduce motion</strong>
              <small>
                Minimizes transitions and animated progress indicators.
              </small>
            </span>
          </label>
        </div>
      </section>
      <footer className="settings-footer">
        <p>
          {saveState === "saved"
            ? "Your preferences are up to date."
            : "Changes stay on this computer."}
        </p>
        <button
          className="button button--primary button--large"
          onClick={() => void save()}
          disabled={saveState === "saving"}
        >
          <Save aria-hidden="true" />
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : "Save changes"}
        </button>
      </footer>
    </div>
  );
}
