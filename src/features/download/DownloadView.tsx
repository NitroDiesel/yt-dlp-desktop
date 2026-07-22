import { useMemo, useState, type FormEvent } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Clipboard,
  Download,
  FolderOpen,
  ListPlus,
  Radio,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { useAppStore } from "../../app/store";
import { formatDuration, hostname } from "../../lib/format";
import type {
  DownloadOptions,
  DownloadRequest,
  MediaMode,
} from "../../types/contracts";

const qualityOptions = [
  {
    value: "best",
    label: "Best available",
    note: "yt-dlp chooses the best video and audio",
  },
  { value: "2160", label: "Up to 2160p", note: "4K where available" },
  { value: "1440", label: "Up to 1440p", note: "Sharper than Full HD" },
  {
    value: "1080",
    label: "Up to 1080p",
    note: "A practical quality and size balance",
  },
  { value: "720", label: "Up to 720p", note: "Smaller and broadly compatible" },
  {
    value: "single",
    label: "Best single file",
    note: "Works without merging streams",
  },
];

const defaultOptions: DownloadOptions = {
  mode: "video",
  quality: "best",
  audioFormat: "best",
  subtitleLanguages: [],
  writeSubtitles: false,
  writeAutomaticSubtitles: false,
  embedSubtitles: false,
  embedMetadata: true,
  embedThumbnail: false,
  customArguments: [],
};

function SegmentedMode({
  value,
  onChange,
}: {
  value: MediaMode;
  onChange: (mode: MediaMode) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Download mode">
      {(["video", "audio", "custom"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className={value === mode ? "segmented__active" : ""}
          onClick={() => onChange(mode)}
        >
          {mode === "custom"
            ? "Exact format"
            : mode[0].toUpperCase() + mode.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function DownloadView() {
  const {
    settings,
    dependencies,
    probe,
    isAnalyzing,
    analyzeError,
    analyze,
    cancelAnalysis,
    clearProbe,
    enqueue,
    setView,
  } = useAppStore();
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState(
    settings?.downloadDirectory ?? "",
  );
  const [options, setOptions] = useState<DownloadOptions>({
    ...defaultOptions,
    mode: settings?.defaultMode ?? "video",
    quality: settings?.defaultQuality ?? "best",
  });
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState<"now" | "queue">();
  const [submitError, setSubmitError] = useState<string>();
  const ytDlpReady = dependencies.some(
    (dependency) =>
      dependency.kind === "yt_dlp" && dependency.status === "available",
  );
  const ffmpegReady = dependencies.some(
    (dependency) =>
      dependency.kind === "ffmpeg" && dependency.status === "available",
  );

  const availableHeights = useMemo(
    () =>
      new Set(probe?.formats.map((format) => format.height).filter(Boolean)),
    [probe?.formats],
  );

  async function handleAnalyze(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    await analyze(url.trim());
  }

  async function pasteUrl() {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text.trim());
      clearProbe();
    } catch {
      setSubmitError(
        "Clipboard access is unavailable. Paste the link into the field instead.",
      );
    }
  }

  async function chooseDestination() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: destination || undefined,
    });
    if (selected) setDestination(selected);
  }

  async function submit(startImmediately: boolean) {
    if (!probe || !destination) return;
    if (probe.isPlaylist && !options.playlistItems?.trim()) {
      const scope = probe.playlistCount
        ? `all ${probe.playlistCount} items`
        : "the full collection";
      const approved = await confirm(`This will download ${scope}. Continue?`, {
        title: "Download the full playlist?",
        kind: "warning",
        okLabel: "Download all",
        cancelLabel: "Go back",
      });
      if (!approved) return;
    }
    const kind = startImmediately ? "now" : "queue";
    setSubmitting(kind);
    setSubmitError(undefined);
    const request: DownloadRequest = {
      url: probe.url,
      destination,
      filenameTemplate:
        settings?.filenameTemplate ?? "%(title).200B [%(id)s].%(ext)s",
      options,
    };
    try {
      await enqueue(request, startImmediately);
      setView("queue");
    } catch (error) {
      setSubmitError(String(error));
    } finally {
      setSubmitting(undefined);
    }
  }

  return (
    <div className="view view--download">
      <header className="view-header">
        <div>
          <p className="eyebrow">NEW DOWNLOAD</p>
          <h1>Bring something home.</h1>
        </div>
        <p className="view-header__hint">
          Paste a media link. You stay in control of quality, files, and
          destination.
        </p>
      </header>

      <section className="url-stage" aria-labelledby="url-heading">
        <div className="transport-rail" aria-hidden="true">
          <span className={probe ? "complete" : isAnalyzing ? "active" : ""} />
        </div>
        <form
          className="url-form"
          onSubmit={(event) => void handleAnalyze(event)}
        >
          <label id="url-heading" htmlFor="media-url">
            Media address
          </label>
          <div className="url-input-wrap">
            <input
              id="media-url"
              type="url"
              inputMode="url"
              value={url}
              placeholder="Paste a video, playlist, or channel link"
              aria-describedby="url-help"
              onChange={(event) => {
                setUrl(event.target.value);
                clearProbe();
              }}
              required
            />
            <button
              type="button"
              className="button button--quiet paste-button"
              onClick={() => void pasteUrl()}
            >
              <Clipboard size={17} aria-hidden="true" /> Paste
            </button>
            {isAnalyzing ? (
              <button
                type="button"
                className="button button--secondary analyze-button"
                onClick={() => void cancelAnalysis()}
              >
                <X size={18} aria-hidden="true" /> Cancel analysis
              </button>
            ) : (
              <button
                className="button button--primary analyze-button"
                disabled={!url.trim() || !ytDlpReady}
              >
                <Sparkles size={18} aria-hidden="true" /> Analyze
              </button>
            )}
          </div>
          <p id="url-help" className="field-help">
            The link is read by yt-dlp on this computer. It is not sent to this
            app’s servers.
          </p>
        </form>
      </section>

      {!ytDlpReady && (
        <section className="setup-prompt" aria-labelledby="setup-title">
          <span className="setup-prompt__icon">
            <Settings2 aria-hidden="true" />
          </span>
          <div>
            <p className="step-label">ONE-TIME SETUP</p>
            <h2 id="setup-title">Connect the download engine</h2>
            <p>
              Choose yt-dlp in Settings before analyzing a link. The exact
              executable and version will always stay visible.
            </p>
          </div>
          <button
            className="button button--secondary"
            onClick={() => setView("settings")}
          >
            Open Settings <ArrowRight aria-hidden="true" />
          </button>
        </section>
      )}

      {!probe && !isAnalyzing && !analyzeError && (
        <section className="workflow-guide" aria-label="Download workflow">
          <div>
            <span>1</span>
            <p>
              <strong>Analyze the link</strong>
              <small>Read media details without downloading.</small>
            </p>
          </div>
          <ArrowRight aria-hidden="true" />
          <div>
            <span>2</span>
            <p>
              <strong>Choose the file</strong>
              <small>Set quality, audio, and subtitles.</small>
            </p>
          </div>
          <ArrowRight aria-hidden="true" />
          <div>
            <span>3</span>
            <p>
              <strong>Bring it home</strong>
              <small>Follow progress in the persistent queue.</small>
            </p>
          </div>
        </section>
      )}

      {isAnalyzing && (
        <section
          className="analysis-skeleton"
          aria-live="polite"
          aria-label="Analyzing media"
        >
          <div className="skeleton skeleton--media" />
          <div>
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--short" />
          </div>
        </section>
      )}

      {analyzeError && (
        <section className="inline-message inline-message--error" role="alert">
          <AlertCircle aria-hidden="true" />
          <div>
            <strong>We couldn’t read that link</strong>
            <p>{analyzeError}</p>
          </div>
        </section>
      )}

      {probe && (
        <div className="download-workflow">
          <section className="media-card" aria-labelledby="media-title">
            <div className="media-card__thumb">
              {probe.thumbnailUrl ? (
                <img src={probe.thumbnailUrl} alt="" />
              ) : (
                <Radio aria-hidden="true" />
              )}
              {probe.durationSeconds && (
                <span>{formatDuration(probe.durationSeconds)}</span>
              )}
            </div>
            <div className="media-card__body">
              <p className="media-source">
                {hostname(probe.url)}
                {probe.isLive ? " · LIVE" : ""}
              </p>
              <h2 id="media-title">{probe.title}</h2>
              <p>{probe.creator || "Creator unavailable"}</p>
              {probe.isPlaylist && (
                <span className="collection-badge">
                  {probe.playlistCount
                    ? `${probe.playlistCount} items`
                    : "Collection"}
                </span>
              )}
            </div>
          </section>

          {probe.warnings.map((warning) => (
            <div
              className="inline-message inline-message--warning"
              key={warning}
            >
              <AlertCircle aria-hidden="true" />
              <p>{warning}</p>
            </div>
          ))}

          <section className="configure-card" aria-labelledby="configure-title">
            <div className="section-heading">
              <div>
                <p className="step-label">CHOOSE</p>
                <h2 id="configure-title">How should it be saved?</h2>
              </div>
            </div>
            <SegmentedMode
              value={options.mode}
              onChange={(mode) => setOptions({ ...options, mode })}
            />

            {options.mode === "video" && (
              <div
                className="choice-grid"
                role="radiogroup"
                aria-label="Video quality"
              >
                {qualityOptions.map((quality) => {
                  const unavailable =
                    /^\d+$/.test(quality.value) &&
                    availableHeights.size > 0 &&
                    ![...availableHeights].some(
                      (height) => Number(height) <= Number(quality.value),
                    );
                  return (
                    <label
                      className={`choice-card ${options.quality === quality.value ? "choice-card--selected" : ""}`}
                      key={quality.value}
                    >
                      <input
                        type="radio"
                        name="quality"
                        value={quality.value}
                        checked={options.quality === quality.value}
                        onChange={() =>
                          setOptions({ ...options, quality: quality.value })
                        }
                      />
                      <span>
                        <strong>{quality.label}</strong>
                        <small>
                          {unavailable
                            ? "May use nearest available quality"
                            : quality.value === "best" && !ffmpegReady
                              ? "Best single file until FFmpeg is configured"
                              : quality.note}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {options.mode === "audio" && (
              <div className="field-row">
                <label className="field">
                  <span>Audio format</span>
                  <select
                    value={options.audioFormat}
                    onChange={(event) =>
                      setOptions({
                        ...options,
                        audioFormat: event.target
                          .value as DownloadOptions["audioFormat"],
                      })
                    }
                  >
                    <option value="best">Source audio — no conversion</option>
                    <option value="mp3">MP3 — broad compatibility</option>
                    <option value="m4a">M4A — AAC in an MP4 container</option>
                    <option value="opus">Opus — compact, high quality</option>
                    <option value="flac">FLAC — lossless</option>
                    <option value="wav">WAV — uncompressed</option>
                  </select>
                </label>
                {options.audioFormat !== "best" && (
                  <p className="field-callout">
                    FFmpeg is required to convert audio.
                  </p>
                )}
              </div>
            )}

            {options.mode === "custom" && (
              <label className="field">
                <span>Exact yt-dlp format selector</span>
                <input
                  value={options.customFormat ?? ""}
                  placeholder="For example: 137+140"
                  onChange={(event) =>
                    setOptions({ ...options, customFormat: event.target.value })
                  }
                />
                <small>
                  Use a format ID or selector from the technical format list.
                  Invalid combinations will be rejected.
                </small>
              </label>
            )}

            <button
              type="button"
              className="disclosure-button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronDown
                className={expanded ? "rotate" : ""}
                size={18}
                aria-hidden="true"
              />{" "}
              Subtitles, metadata, and advanced options
            </button>
            {expanded && (
              <div className="advanced-panel">
                <fieldset>
                  <legend>Subtitles</legend>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={options.writeSubtitles}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          writeSubtitles: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>Download available subtitles</strong>
                      <small>Uses the selected languages when available</small>
                    </span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={options.writeAutomaticSubtitles}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          writeAutomaticSubtitles: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>Include automatic captions</strong>
                      <small>
                        Useful when human-made subtitles are unavailable
                      </small>
                    </span>
                  </label>
                  <label className="field">
                    <span>Languages</span>
                    <input
                      placeholder="en.*, ja, zh-Hant"
                      value={options.subtitleLanguages.join(", ")}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          subtitleLanguages: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={options.embedSubtitles}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          embedSubtitles: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>Embed subtitles in the media file</strong>
                      <small>Requires FFmpeg and a compatible container</small>
                    </span>
                  </label>
                </fieldset>
                <fieldset>
                  <legend>File details</legend>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={options.embedMetadata}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          embedMetadata: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>Embed title and metadata</strong>
                    </span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={options.embedThumbnail}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          embedThumbnail: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>Embed thumbnail</strong>
                      <small>May require FFmpeg</small>
                    </span>
                  </label>
                </fieldset>
                {probe.isPlaylist && (
                  <fieldset>
                    <legend>Playlist scope</legend>
                    <label className="field">
                      <span>Items</span>
                      <input
                        placeholder="All items, or 1:10 / 1,3,8"
                        value={options.playlistItems ?? ""}
                        onChange={(event) =>
                          setOptions({
                            ...options,
                            playlistItems: event.target.value,
                          })
                        }
                      />
                      <small>
                        Leave empty to download the full collection.
                      </small>
                    </label>
                  </fieldset>
                )}
                <fieldset>
                  <legend>Expert arguments</legend>
                  <label className="field">
                    <span>Additional arguments</span>
                    <textarea
                      rows={4}
                      placeholder="One argument per line"
                      value={options.customArguments.join("\n")}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          customArguments: event.target.value
                            .split("\n")
                            .filter(Boolean),
                        })
                      }
                    />
                    <small>
                      Arguments that conflict with managed settings are
                      rejected.
                    </small>
                  </label>
                </fieldset>
              </div>
            )}
          </section>

          <section
            className="destination-card"
            aria-labelledby="destination-title"
          >
            <div>
              <p className="step-label">SAVE TO</p>
              <h2 id="destination-title">Choose a destination</h2>
            </div>
            <button
              type="button"
              className="path-picker"
              onClick={() => void chooseDestination()}
            >
              <FolderOpen aria-hidden="true" />
              <span>
                <strong>{destination || "Select a folder"}</strong>
                <small>
                  {settings?.filenameTemplate ??
                    "%(title).200B [%(id)s].%(ext)s"}
                </small>
              </span>
            </button>
          </section>

          {submitError && (
            <div className="inline-message inline-message--error" role="alert">
              <AlertCircle aria-hidden="true" />
              <p>{submitError}</p>
            </div>
          )}
          <div className="download-actions">
            <button
              className="button button--secondary button--large"
              disabled={!destination || Boolean(submitting)}
              onClick={() => void submit(false)}
            >
              <ListPlus aria-hidden="true" />
              {submitting === "queue" ? "Adding…" : "Add to queue"}
            </button>
            <button
              className="button button--primary button--large"
              disabled={!destination || Boolean(submitting)}
              onClick={() => void submit(true)}
            >
              <Download aria-hidden="true" />
              {submitting === "now" ? "Starting…" : "Download now"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
