import { useEffect, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { open } from "@tauri-apps/plugin-dialog";
import { FileCog, FolderOpen, RefreshCw, Undo2 } from "lucide-react";
import { useAppStore } from "../../app/store";
import { SidebarReveal } from "../../components/AppShell";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import type {
  AccentColor,
  AppSettings,
  DependencyInfo,
  HardwareAccelerationInfo,
} from "../../types/contracts";

const toolLabels: Record<DependencyInfo["kind"], string> = {
  yt_dlp: "yt-dlp",
  ffmpeg: "FFmpeg",
  ffprobe: "FFprobe",
  javascript_runtime: "Deno",
};

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="settings-section" aria-labelledby={id}>
      <header className="settings-section__header">
        <div>
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      <div className="settings-group">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__main">
        <div className="settings-row__text">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {control && <div className="settings-row__control">{control}</div>}
      </div>
      {children}
    </div>
  );
}

function ToolRow({ dependency }: { dependency: DependencyInfo }) {
  const ready = dependency.status === "available";
  return (
    <Row
      title={
        <>
          {toolLabels[dependency.kind]}
          <span className={`tag ${ready ? "" : "tag--error"}`}>
            {ready
              ? dependency.source === "custom"
                ? "Custom"
                : "Bundled"
              : dependency.status === "missing"
                ? "Missing"
                : "Not working"}
          </span>
        </>
      }
      description={
        <>
          {dependency.message && (
            <span className="settings-row__note">{dependency.message}</span>
          )}
          <span className="mono settings-row__path" title={dependency.path}>
            {dependency.path ?? "No executable found"}
          </span>
        </>
      }
      control={
        dependency.version && (
          <span className="mono settings-row__value">
            {dependency.version.match(/\d[\w.-]*/)?.[0] ?? dependency.version}
          </span>
        )
      }
    />
  );
}

const codecNames = { h264: "H.264", hevc: "HEVC", av1: "AV1" } as const;

const accentColors: ReadonlyArray<{ value: AccentColor; label: string }> = [
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "pink", label: "Pink" },
  { value: "graphite", label: "Graphite" },
];

function gpuSummary(hardware?: HardwareAccelerationInfo): string {
  if (!hardware || hardware.status === "checking") return "Checking…";
  const ready = hardware.encoders.filter((encoder) => encoder.available);
  if (ready.length === 0) return "Not available";
  const providers = new Set(
    ready.map((encoder) => (encoder.provider === "nvenc" ? "NVIDIA NVENC" : "AMD AMF")),
  );
  return [...providers].join(" and ");
}

export function SettingsView() {
  const { settings, dependencies, hardwareAcceleration } = useAppStore(
    useShallow((state) => ({
      settings: state.settings,
      dependencies: state.dependencies,
      hardwareAcceleration: state.hardwareAcceleration,
    })),
  );
  const saveSettings = useAppStore((state) => state.saveSettings);
  const refreshEngineStatus = useAppStore((state) => state.refreshEngineStatus);
  const ensureHardwareAcceleration = useAppStore(
    (state) => state.ensureHardwareAcceleration,
  );
  const [draft, setDraft] = useState<AppSettings | undefined>(settings);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [checking, setChecking] = useState(false);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => ensureHardwareAcceleration(), [ensureHardwareAcceleration]);
  if (!draft || !settings) return null;
  const current = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const readyEncoders =
    hardwareAcceleration?.encoders.filter((encoder) => encoder.available) ?? [];
  const gpuDecode = readyEncoders.some((encoder) => encoder.decodeAvailable);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft({ ...current, [key]: value });
    setSaveState("idle");
  };

  async function chooseDirectory() {
    const value = await open({
      directory: true,
      multiple: false,
      defaultPath: current.downloadDirectory || undefined,
    });
    if (value) set("downloadDirectory", value);
  }

  async function chooseExecutable(kind: DependencyInfo["kind"]) {
    const value = await open({
      directory: false,
      multiple: false,
      title: `Choose the ${toolLabels[kind]} executable`,
    });
    if (!value) return;
    if (kind === "yt_dlp") set("ytDlpPath", value);
    if (kind === "ffmpeg") set("ffmpegPath", value);
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
      await saveSettings(current);
      setSaveState("idle");
    } catch {
      setSaveState("error");
    }
  }

  async function checkAgain() {
    setChecking(true);
    try {
      await refreshEngineStatus();
    } finally {
      setChecking(false);
    }
  }

  const overrides = [
    { kind: "yt_dlp" as const, label: "yt-dlp", path: draft.ytDlpPath, key: "ytDlpPath" as const },
    { kind: "ffmpeg" as const, label: "FFmpeg and FFprobe", path: draft.ffmpegPath, key: "ffmpegPath" as const },
    { kind: "javascript_runtime" as const, label: "Deno", path: draft.denoPath, key: "denoPath" as const },
  ];

  return (
    <div className="page">
      <header className="topbar">
        <div className="header-lead">
          <SidebarReveal />
          <h1>Settings</h1>
        </div>
      </header>
      <div className="settings">
        <Section title="Downloads" description="Defaults for new downloads. Each download can still change them.">
          <Row
            title="Default folder"
            description="Used until you pick another folder for a download."
            control={
              <button type="button" className="button button--outline path-button" onClick={() => void chooseDirectory()}>
                <FolderOpen aria-hidden="true" />
                <span className="mono">{draft.downloadDirectory || "Choose a folder"}</span>
              </button>
            }
          />
          <Row
            title="File name"
            description="A yt-dlp output template. Folders and absolute paths aren't allowed."
          >
            <input
              className="mono settings-row__input"
              aria-label="Filename template"
              value={draft.filenameTemplate}
              onChange={(event) => set("filenameTemplate", event.target.value)}
            />
          </Row>
          <Row
            title="Default type"
            control={
              <Select
                label="Default type"
                value={draft.defaultMode}
                onChange={(mode) => set("defaultMode", mode)}
                options={[
                  { value: "video", label: "Video" },
                  { value: "audio", label: "Audio" },
                ]}
              />
            }
          />
          <Row
            title="Default video quality"
            control={
              <Select
                label="Default video quality"
                value={draft.defaultQuality}
                onChange={(quality) => set("defaultQuality", quality)}
                options={[
                  { value: "best", label: "Best available" },
                  { value: "2160", label: "Up to 2160p" },
                  { value: "1440", label: "Up to 1440p" },
                  { value: "1080", label: "Up to 1080p" },
                  { value: "720", label: "Up to 720p" },
                  { value: "single", label: "Best single file" },
                ]}
              />
            }
          />
          <Row
            title="Downloads at once"
            description="More parallel downloads use more bandwidth and can trigger site rate limits."
            control={
              <Select
                label="Downloads at once"
                value={String(draft.queueConcurrency)}
                onChange={(count) => set("queueConcurrency", Number(count))}
                options={["1", "2", "3", "4"].map((count) => ({ value: count, label: count }))}
              />
            }
          />
          <div className="settings-row">
            <Toggle
              label="Date files by download time"
              description="Off: files carry the video's upload date, as yt-dlp does by default."
              checked={Boolean(draft.useDownloadTime)}
              onChange={(checked) => set("useDownloadTime", checked)}
            />
          </div>
        </Section>

        <Section title="Network" description="Cookie contents are never copied into the app.">
          <Row
            title="Retries"
            description="Attempts for a whole download, then for each fragment."
            control={
              <div className="number-pair">
                <input
                  type="number"
                  min="0"
                  max="100"
                  aria-label="Retries"
                  value={draft.retries}
                  onChange={(event) => set("retries", Number(event.target.value))}
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  aria-label="Fragment retries"
                  value={draft.fragmentRetries}
                  onChange={(event) => set("fragmentRetries", Number(event.target.value))}
                />
              </div>
            }
          />
          <Row
            title="Speed limit"
            description="Leave empty for no limit."
            control={
              <input
                className="mono input--narrow"
                aria-label="Rate limit"
                placeholder="5M"
                value={draft.rateLimit ?? ""}
                onChange={(event) => set("rateLimit", event.target.value || undefined)}
              />
            }
          />
          <Row title="Proxy" description="A URL without a username or password; credentials aren't stored.">
            <input
              className="mono settings-row__input"
              type="url"
              autoComplete="off"
              aria-label="Proxy"
              placeholder="socks5://127.0.0.1:1080"
              value={draft.proxy ?? ""}
              onChange={(event) => set("proxy", event.target.value || undefined)}
            />
          </Row>
          <Row
            title="Browser cookies"
            description="Lets yt-dlp read a signed-in browser session for private or age-restricted media."
            control={
              <Select
                label="Browser cookies"
                value={draft.cookieBrowser ?? ""}
                onChange={(browser) => set("cookieBrowser", browser || undefined)}
                options={[
                  { value: "", label: "None" },
                  ...["chrome", "edge", "firefox", "brave", "chromium", "opera", "vivaldi", "safari"].map(
                    (browser) => ({ value: browser, label: browser[0].toUpperCase() + browser.slice(1) }),
                  ),
                ]}
              />
            }
          />
          <Row
            title="Cookie file"
            description="A Netscape-format cookies.txt."
            control={
              <div className="control-pair">
                {draft.cookieFile && (
                  <button type="button" className="button button--ghost button--compact" onClick={() => set("cookieFile", undefined)}>
                    Clear
                  </button>
                )}
                <button type="button" className="button button--outline path-button" onClick={() => void chooseCookieFile()}>
                  <FileCog aria-hidden="true" />
                  <span className="mono">{draft.cookieFile || "Choose file"}</span>
                </button>
              </div>
            }
          />
          <Row
            title="Browser impersonation"
            description="Some sites block downloaders. This makes requests look like the chosen browser."
            control={
              <Select
                label="Browser impersonation"
                value={draft.impersonate ?? ""}
                onChange={(browser) => set("impersonate", browser || undefined)}
                options={[
                  { value: "", label: "Off" },
                  { value: "chrome", label: "Chrome" },
                  { value: "edge", label: "Edge" },
                  { value: "safari", label: "Safari" },
                  { value: "firefox", label: "Firefox" },
                ]}
              />
            }
          />
          <Row
            title="Region"
            description="Ask sites to treat you as being in another country, for region-locked media."
            control={
              <div className="control-pair">
                <Select
                  label="Region bypass"
                  value={
                    draft.geoBypass === undefined || draft.geoBypass === "default"
                      ? ""
                      : draft.geoBypass === "never"
                        ? "never"
                        : "country"
                  }
                  onChange={(mode) => set("geoBypass", mode === "country" ? "US" : mode || undefined)}
                  options={[
                    { value: "", label: "Automatic" },
                    { value: "never", label: "Off" },
                    { value: "country", label: "Specific country" },
                  ]}
                />
                {draft.geoBypass !== undefined && !["default", "never"].includes(draft.geoBypass) && (
                  <input
                    className="mono input--narrow"
                    aria-label="Country code"
                    maxLength={2}
                    value={draft.geoBypass}
                    onChange={(event) => set("geoBypass", event.target.value.toUpperCase())}
                  />
                )}
              </div>
            }
          />
          <Row
            title="IP version"
            description="Force IPv4 or IPv6 when a site misbehaves on one of them."
            control={
              <Select
                label="IP version"
                value={draft.ipVersion ?? ""}
                onChange={(version) => set("ipVersion", version || undefined)}
                options={[
                  { value: "", label: "Automatic" },
                  { value: "ipv4", label: "IPv4 only" },
                  { value: "ipv6", label: "IPv6 only" },
                ]}
              />
            }
          />
          <Row
            title="Timeout"
            description="How long to wait for a server before giving up."
            control={
              <Select
                label="Network timeout"
                value={String(draft.socketTimeout ?? "")}
                onChange={(seconds) => set("socketTimeout", seconds ? Number(seconds) : undefined)}
                options={[
                  { value: "", label: "Default (20 seconds)" },
                  { value: "10", label: "10 seconds" },
                  { value: "60", label: "1 minute" },
                  { value: "180", label: "3 minutes" },
                ]}
              />
            }
          />
          <Row
            title="Pause between requests"
            description="Slows analysis and downloads slightly to avoid site rate limits."
            control={
              <Select
                label="Pause between requests"
                value={String(draft.sleepRequests ?? 0)}
                onChange={(seconds) => set("sleepRequests", Number(seconds) || undefined)}
                options={[
                  { value: "0", label: "No pause" },
                  { value: "1", label: "1 second" },
                  { value: "3", label: "3 seconds" },
                  { value: "10", label: "10 seconds" },
                ]}
              />
            }
          />
          <Row
            title="Download in chunks"
            description="Splits large files into smaller requests, which some sites throttle less."
            control={
              <Select
                label="Chunk size"
                value={String(draft.httpChunkSizeMb ?? "")}
                onChange={(size) => set("httpChunkSizeMb", size ? Number(size) : undefined)}
                options={[
                  { value: "", label: "Off" },
                  { value: "10", label: "10 MB" },
                  { value: "50", label: "50 MB" },
                ]}
              />
            }
          />
          <Row
            title="Retries while reading a page"
            description="Extra attempts when a site's page fails to load during analysis."
            control={
              <input
                type="number"
                min="0"
                max="100"
                className="input--narrow"
                aria-label="Extractor retries"
                placeholder="3"
                value={draft.extractorRetries ?? ""}
                onChange={(event) =>
                  set("extractorRetries", event.target.value ? Number(event.target.value) : undefined)
                }
              />
            }
          />
          <div className="settings-row">
            <Toggle
              label="Legacy server connections"
              description="Allows older HTTPS servers that newer security defaults refuse."
              checked={Boolean(draft.legacyServerConnect)}
              onChange={(checked) => set("legacyServerConnect", checked)}
            />
          </div>
        </Section>

        <Section
          title="Download engine"
          description="Bundled, version-pinned tools. Nothing else needs to be installed."
          action={
            <button
              type="button"
              className="button button--ghost button--compact"
              disabled={checking}
              onClick={() => void checkAgain()}
            >
              <RefreshCw aria-hidden="true" /> {checking ? "Checking…" : "Check again"}
            </button>
          }
        >
          {dependencies.map((dependency) => (
            <ToolRow key={dependency.kind} dependency={dependency} />
          ))}
          <details className="settings-row settings-disclosure">
            <summary>
              <span className="settings-row__text">
                <h3>Custom tool overrides</h3>
                <p>For advanced setups. Replacements run with the app's permissions.</p>
              </span>
            </summary>
            <div className="override-list">
              {overrides.map((override) => (
                <div className="override" key={override.kind}>
                  <span>
                    <strong>{override.label}</strong>
                    <span className="mono">{override.path || "Bundled"}</span>
                  </span>
                  <div className="control-pair">
                    {override.path && (
                      <button
                        type="button"
                        className="button button--ghost button--compact"
                        onClick={() => set(override.key, undefined)}
                      >
                        <Undo2 aria-hidden="true" /> Use bundled
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button--outline button--compact"
                      onClick={() => void chooseExecutable(override.kind)}
                    >
                      Select replacement
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </Section>

        <Section
          title="GPU acceleration"
          description="Detected from the bundled FFmpeg, your GPU, and its driver. Drivers come from NVIDIA or AMD."
        >
          <Row
            title="Hardware encoder"
            description={hardwareAcceleration?.message}
            control={<span className="settings-row__value">{gpuSummary(hardwareAcceleration)}</span>}
          />
          {readyEncoders.length > 0 && (
            <Row
              title="Codecs"
              control={
                <span className="mono settings-row__value">
                  {[...new Set(readyEncoders.map((encoder) => codecNames[encoder.codec]))].join(", ")}
                </span>
              }
            />
          )}
          {readyEncoders.length > 0 && (
            <Row
              title="Hardware decoding"
              description="Optional per download. When unavailable, the CPU reads the source and the GPU still encodes."
              control={<span className="settings-row__value">{gpuDecode ? "Available" : "Not available"}</span>}
            />
          )}
        </Section>

        <Section title="Appearance">
          <Row
            title="Theme"
            control={
              <Select
                label="Theme"
                value={draft.theme}
                onChange={(theme) => set("theme", theme)}
                options={[
                  { value: "system", label: "Match system" },
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            }
          />
          <Row
            title="Accent color"
            description="Buttons, progress, switches, and focus."
            control={
              <div className="accent-picker" role="radiogroup" aria-label="Accent color">
                {accentColors.map((accent) => (
                  <label key={accent.value} className="accent-picker__option" title={accent.label}>
                    <input
                      type="radio"
                      name="accent-color"
                      value={accent.value}
                      aria-label={accent.label}
                      checked={draft.accent === accent.value}
                      onChange={() => set("accent", accent.value)}
                    />
                    <span className="accent-picker__swatch" data-accent={accent.value} aria-hidden="true" />
                  </label>
                ))}
              </div>
            }
          />
          <div className="settings-row">
            <Toggle
              label="Reduce motion"
              description="Turns off transitions."
              checked={draft.reducedMotion}
              onChange={(checked) => set("reducedMotion", checked)}
            />
          </div>
        </Section>
      </div>

      {(dirty || saveState === "error") && (
        <div className="save-strip" role="region" aria-label="Unsaved changes">
          <p>
            {saveState === "error"
              ? "Settings couldn't be saved. Check the highlighted values and try again."
              : "You have unsaved changes."}
          </p>
          <button type="button" className="button button--ghost" onClick={() => setDraft(settings)}>
            Discard
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={saveState === "saving"}
            onClick={() => void save()}
          >
            {saveState === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}
