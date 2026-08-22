import { useMemo, useState, type FormEvent } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Clipboard,
  Cpu,
  Download,
  ListPlus,
  Radio,
  Scissors,
  Settings2,
  Zap,
  X,
} from "lucide-react";
import { useAppStore } from "../../app/store";
import { formatDuration, hostname } from "../../lib/format";
import {
  formatTimecode,
  validateClipDraft,
  type ClipDraft,
} from "../../lib/timecode";
import type {
  DownloadOptions,
  DownloadRequest,
  MediaMode,
  HardwareCodec,
} from "../../types/contracts";
import { ClipEditor } from "./ClipEditor";
import { DestinationPicker } from "./DestinationPicker";

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
  videoConversion: undefined,
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
    hardwareAcceleration,
    probe,
    isAnalyzing,
    analyzeError,
    analyze,
    cancelAnalysis,
    clearProbe,
    enqueue,
    rememberDownloadDirectory,
    setView,
  } = useAppStore();
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState(
    settings?.recentDownloadDirectories[0] ??
      settings?.downloadDirectory ??
      "",
  );
  const [options, setOptions] = useState<DownloadOptions>({
    ...defaultOptions,
    mode: settings?.defaultMode ?? "video",
    quality: settings?.defaultQuality ?? "best",
  });
  const [clipDraft, setClipDraft] = useState<ClipDraft>();
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
  const gpuReady =
    !probe?.isPlaylist &&
    hardwareAcceleration?.status === "available" &&
    hardwareAcceleration.encoders.some((encoder) => encoder.available);
  const selectedEncoder = options.videoConversion
    ? hardwareAcceleration?.encoders.find(
        (encoder) =>
          encoder.codec === options.videoConversion?.codec &&
          encoder.available,
      )
    : undefined;
  const clipDisabledReason = probe?.isPlaylist
    ? "Clip downloads work with one video at a time. Use a single-video link."
    : probe?.isLive
      ? "Live streams cannot be trimmed before download."
      : !ffmpegReady
        ? "The bundled FFmpeg engine is required to cut a selected timeframe."
        : undefined;
  const clipValidation = useMemo(
    () =>
      clipDraft
        ? validateClipDraft(clipDraft, probe?.durationSeconds)
        : undefined,
    [clipDraft, probe?.durationSeconds],
  );
  const clipBlocked = Boolean(
    clipDraft &&
      (clipDisabledReason || clipValidation?.kind === "invalid"),
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
      setClipDraft(undefined);
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
    if (selected) await selectDestination(selected);
  }

  async function selectDestination(directory: string) {
    setDestination(directory);
    setSubmitError(undefined);
    try {
      await rememberDownloadDirectory(directory);
    } catch {
      setSubmitError(
        "This folder is selected, but it could not be added to Recent folders.",
      );
    }
  }

  async function submit(startImmediately: boolean) {
    if (!probe || !destination) return;
    if (clipDraft && clipDisabledReason) {
      setSubmitError(clipDisabledReason);
      return;
    }
    if (clipValidation?.kind === "invalid") {
      setSubmitError(clipValidation.message);
      return;
    }
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
      isPlaylist: probe.isPlaylist,
      options: {
        ...options,
        clip:
          clipValidation?.kind === "valid"
            ? clipValidation.clip
            : undefined,
      },
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
    <div
      className={`view view--download ${probe || isAnalyzing || analyzeError ? "view--download-active" : "view--download-idle"}`}
    >
      <header className="view-header">
        <div>
          <p className="eyebrow">ADD TASK</p>
          <h1>New download</h1>
          <p>Paste a supported media link and choose how to save it.</p>
        </div>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => setView("queue")}
        >
          <X aria-hidden="true" /> Close
        </button>
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
            Video, playlist, or channel link
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
                setClipDraft(undefined);
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
                title="Analyze media"
                aria-label="Analyze media"
              >
                <ArrowRight size={18} aria-hidden="true" />
                <span className="analyze-button__label">Analyze</span>
              </button>
            )}
          </div>
          <p id="url-help" className="field-help">
            The link is processed locally by the bundled yt-dlp engine.
          </p>
          {!probe && !isAnalyzing && (
            <div className="download-basics">
              <div className="download-basics__group">
                <span className="download-basics__label">Download type</span>
                <SegmentedMode
                  value={options.mode}
                  onChange={(mode) =>
                    setOptions({
                      ...options,
                      mode,
                      videoConversion:
                        mode === "video" ? options.videoConversion : undefined,
                    })
                  }
                />
              </div>
              <div className="download-basics__group">
                <span className="download-basics__label">Save to</span>
                <DestinationPicker
                  compact
                  destination={destination}
                  recentDirectories={
                    settings?.recentDownloadDirectories ?? []
                  }
                  filenameTemplate={
                    settings?.filenameTemplate ??
                    "%(title).200B [%(id)s].%(ext)s"
                  }
                  onBrowse={() => void chooseDestination()}
                  onSelect={(directory) => void selectDestination(directory)}
                />
              </div>
            </div>
          )}
        </form>
      </section>

      {!ytDlpReady && (
        <section className="setup-prompt" aria-labelledby="setup-title">
          <span className="setup-prompt__icon">
            <Settings2 aria-hidden="true" />
          </span>
          <div>
            <p className="step-label">ENGINE UNAVAILABLE</p>
            <h2 id="setup-title">The bundled downloader could not start</h2>
            <p>
              Reinstall the app to restore its included tools, or select a
              trusted replacement in advanced Settings.
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
              <Radio aria-hidden="true" />
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
              onChange={(mode) =>
                setOptions({
                  ...options,
                  mode,
                  videoConversion:
                    mode === "video" ? options.videoConversion : undefined,
                })
              }
            />

            {options.mode === "video" && (
              <>
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

                <section
                  className={`gpu-conversion ${options.videoConversion ? "gpu-conversion--active" : ""}`}
                  aria-labelledby="gpu-conversion-title"
                >
                  <div className="gpu-conversion__heading">
                    <span className="gpu-conversion__icon">
                      <Zap aria-hidden="true" />
                    </span>
                    <div>
                      <div className="gpu-conversion__title-row">
                        <h3 id="gpu-conversion-title">
                          Automatic GPU conversion
                        </h3>
                        <span
                          className={`capability-label capability-label--${gpuReady ? "ready" : "unavailable"}`}
                        >
                          {gpuReady ? "Ready" : "Unavailable"}
                        </span>
                      </div>
                      <p>
                        Re-encode with whichever supported GPU is ready. NVENC
                        and AMF are detected automatically; the source is
                        removed only after the MKV is finalized.
                      </p>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        aria-label="Convert video with automatic GPU acceleration"
                        checked={Boolean(options.videoConversion)}
                        disabled={!gpuReady}
                        onChange={(event) =>
                          setOptions({
                            ...options,
                            videoConversion: event.target.checked
                              ? {
                                  codec:
                                    hardwareAcceleration?.encoders.find(
                                      (encoder) => encoder.available,
                                    )?.codec ?? "h264",
                                  quality: 23,
                                  useHardwareDecode: false,
                                }
                              : undefined,
                          })
                        }
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>

                  {!gpuReady && (
                    <p className="gpu-conversion__status">
                      {probe.isPlaylist
                        ? "GPU conversion is currently available for single-video jobs so every playlist item remains predictable."
                        : hardwareAcceleration?.message ??
                          "Checking the bundled FFmpeg engine, GPU, and installed driver…"}
                    </p>
                  )}

                  {options.videoConversion && (
                    <div className="gpu-conversion__controls">
                      <label className="field">
                        <span>Video codec</span>
                        <select
                          value={options.videoConversion.codec}
                          onChange={(event) => {
                            const codec = event.target.value as HardwareCodec;
                            setOptions({
                              ...options,
                              videoConversion: {
                                ...options.videoConversion!,
                                codec,
                                quality: Math.min(
                                  options.videoConversion!.quality,
                                  51,
                                ),
                              },
                            });
                          }}
                        >
                          {(["h264", "hevc", "av1"] as HardwareCodec[]).map(
                            (codec) => {
                              const encoder =
                                hardwareAcceleration?.encoders.find(
                                  (candidate) =>
                                    candidate.codec === codec &&
                                    candidate.available,
                                );
                              return (
                                <option
                                  key={codec}
                                  value={codec}
                                  disabled={!encoder}
                                >
                                  {codec === "h264"
                                    ? "H.264 — most compatible"
                                    : codec === "hevc"
                                      ? "HEVC — smaller files"
                                      : "AV1 — newest GPUs"}{" "}
                                  {encoder
                                    ? `(${encoder.provider === "nvenc" ? "NVIDIA NVENC" : "AMD AMF"})`
                                    : "(not supported)"}
                                </option>
                              );
                            },
                          )}
                        </select>
                      </label>
                      <label className="field">
                        <span>
                          Quality: {options.videoConversion.quality}
                        </span>
                        <input
                          type="range"
                          min="1"
                          max="51"
                          value={options.videoConversion.quality}
                          onChange={(event) =>
                            setOptions({
                              ...options,
                              videoConversion: {
                                ...options.videoConversion!,
                                quality: Number(event.target.value),
                              },
                            })
                          }
                        />
                        <small>Lower values preserve more detail.</small>
                      </label>
                      <label className="check-row gpu-decode-control">
                        <input
                          type="checkbox"
                          checked={options.videoConversion.useHardwareDecode}
                          disabled={!selectedEncoder?.decodeAvailable}
                          onChange={(event) =>
                            setOptions({
                              ...options,
                              videoConversion: {
                                ...options.videoConversion!,
                                useHardwareDecode: event.target.checked,
                              },
                            })
                          }
                        />
                        <span>
                          <strong>
                            <Cpu aria-hidden="true" /> Decode on the GPU too
                          </strong>
                          <small>
                            Optional. Software decoding is more compatible with
                            unusual source codecs and profiles.
                          </small>
                        </span>
                      </label>
                    </div>
                  )}
                </section>
              </>
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

            <ClipEditor
              value={clipDraft}
              durationSeconds={probe.durationSeconds}
              disabledReason={clipDisabledReason}
              onChange={setClipDraft}
            />

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
                      Managed settings and arguments that execute programs,
                      load plugins, or redirect output are rejected.
                    </small>
                  </label>
                </fieldset>
              </div>
            )}
          </section>

          <aside className="download-summary" aria-label="Download summary">
            <section
              className="destination-card"
              aria-labelledby="destination-title"
            >
              <div>
                <p className="step-label">SAVE TO</p>
                <h2 id="destination-title">Destination</h2>
              </div>
              <DestinationPicker
                destination={destination}
                recentDirectories={settings?.recentDownloadDirectories ?? []}
                filenameTemplate={
                  settings?.filenameTemplate ??
                  "%(title).200B [%(id)s].%(ext)s"
                }
                onBrowse={() => void chooseDestination()}
                onSelect={(directory) => void selectDestination(directory)}
              />
            </section>

            {clipValidation?.kind === "valid" && (
              <div className="clip-summary">
                <Scissors aria-hidden="true" />
                <span>
                  <strong>
                    {formatTimecode(clipValidation.startSeconds)} →{" "}
                    {formatTimecode(clipValidation.endSeconds)}
                  </strong>
                  <small>
                    {clipDraft?.precise ? "Accurate cut" : "Fast keyframe cut"}
                  </small>
                </span>
              </div>
            )}

            {submitError && (
              <div
                className="inline-message inline-message--error"
                role="alert"
              >
                <AlertCircle aria-hidden="true" />
                <p>{submitError}</p>
              </div>
            )}
            <div className="download-actions">
              <button
                className="button button--secondary button--large"
                disabled={!destination || clipBlocked || Boolean(submitting)}
                onClick={() => void submit(false)}
              >
                <ListPlus aria-hidden="true" />
                {submitting === "queue" ? "Adding…" : "Add to queue"}
              </button>
              <button
                className="button button--primary button--large"
                disabled={!destination || clipBlocked || Boolean(submitting)}
                onClick={() => void submit(true)}
              >
                <Download aria-hidden="true" />
                {submitting === "now" ? "Starting…" : "Download now"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
