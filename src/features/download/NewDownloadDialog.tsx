import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, ChevronDown, ChevronRight, X } from "lucide-react";
import { useAppStore } from "../../app/store";
import { Select, type SelectOption } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { formatBytes, formatDuration, hostname } from "../../lib/format";
import { isVideoInPlaylist, linkFromText } from "../../lib/jobs";
import { validateClipDraft, type ClipDraft } from "../../lib/timecode";
import type {
  AudioFormat,
  AudioQuality,
  CodecPreference,
  DownloadOptions,
  DownloadRequest,
  HardwareAccelerationInfo,
  HardwareCodec,
  HardwareEncoderProvider,
  MediaFormat,
  MediaProbe,
  SponsorCategory,
  SubtitleFormat,
  VideoContainer,
} from "../../types/contracts";
import { ClipEditor } from "./ClipEditor";
import { DestinationPicker } from "./DestinationPicker";

const defaultTemplate = "%(title).200B [%(id)s].%(ext)s";
const pickStreams = "pick";

const qualityOptions = [
  { value: "best", label: "Best available" },
  { value: "2160", label: "Up to 2160p" },
  { value: "1440", label: "Up to 1440p" },
  { value: "1080", label: "Up to 1080p" },
  { value: "720", label: "Up to 720p" },
  { value: "single", label: "Best single file, no merging" },
];

const audioFormatOptions = [
  { value: "best", label: "Original format, no conversion" },
  { value: "mp3", label: "MP3, widest compatibility" },
  { value: "m4a", label: "M4A, AAC audio" },
  { value: "opus", label: "Opus, small and high quality" },
  { value: "flac", label: "FLAC, lossless" },
  { value: "wav", label: "WAV, uncompressed" },
] satisfies ReadonlyArray<{ value: AudioFormat; label: string }>;

const audioQualityOptions = [
  { value: "best", label: "Best available" },
  { value: "320K", label: "320 kbps" },
  { value: "256K", label: "256 kbps" },
  { value: "192K", label: "192 kbps" },
  { value: "128K", label: "128 kbps" },
] satisfies ReadonlyArray<{ value: AudioQuality; label: string }>;

const containerOptions: Array<{ value: VideoContainer | ""; label: string }> = [
  { value: "", label: "Automatic" },
  { value: "mp4", label: "MP4, plays on most devices" },
  { value: "mkv", label: "MKV, keeps every stream" },
  { value: "webm", label: "WebM" },
];

const codecOptions: Array<{ value: CodecPreference | ""; label: string }> = [
  { value: "", label: "Any, best quality first" },
  { value: "h264", label: "H.264, most compatible" },
  { value: "vp9", label: "VP9" },
  { value: "av1", label: "AV1, smallest files" },
];

const subtitleFormatOptions: Array<{ value: SubtitleFormat | ""; label: string }> = [
  { value: "", label: "Keep original" },
  { value: "srt", label: "SRT" },
  { value: "vtt", label: "VTT" },
  { value: "ass", label: "ASS" },
];

const sponsorCategories: Array<{ value: SponsorCategory; label: string }> = [
  { value: "sponsor", label: "Sponsors" },
  { value: "selfpromo", label: "Self promotion" },
  { value: "interaction", label: "Like and subscribe reminders" },
  { value: "intro", label: "Intros" },
  { value: "outro", label: "Outros and end cards" },
  { value: "preview", label: "Previews and recaps" },
  { value: "filler", label: "Off-topic filler" },
  { value: "music_offtopic", label: "Non-music in music videos" },
];

const filenamePresets = [
  { value: "default", label: "Use the Settings template", template: undefined },
  { value: "title", label: "Title", template: "%(title).200B.%(ext)s" },
  { value: "title-id", label: "Title [video ID]", template: defaultTemplate },
  { value: "uploader", label: "Uploader - Title", template: "%(uploader).80B - %(title).150B.%(ext)s" },
  { value: "date", label: "Upload date Title", template: "%(upload_date>%Y-%m-%d)s %(title).180B.%(ext)s" },
  { value: "index", label: "Playlist number - Title", template: "%(playlist_index)03d - %(title).180B.%(ext)s" },
];

const gpuCodecLabels: Record<HardwareCodec, string> = {
  h264: "H.264 on GPU",
  hevc: "HEVC on GPU, smaller files",
  av1: "AV1 on GPU",
};

const providerNames: Record<HardwareEncoderProvider, string> = {
  nvenc: "NVIDIA NVENC",
  amf: "AMD AMF",
};

const defaultOptions: DownloadOptions = {
  mode: "video",
  quality: "best",
  audioFormat: "best",
  audioQuality: "best",
  subtitleLanguages: [],
  writeSubtitles: false,
  writeAutomaticSubtitles: false,
  embedSubtitles: false,
  embedMetadata: true,
  embedThumbnail: false,
  customArguments: [],
};

const hasCodec = (codec?: string) => Boolean(codec && codec !== "none");

const languageNames =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(undefined, { type: "language" })
    : undefined;

/** "ja" becomes "Japanese (ja)"; unknown codes are shown as-is. */
function languageName(code: string): string {
  try {
    const name = languageNames?.of(code.split("-orig")[0]);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}


function streamLabel(format: MediaFormat): string {
  const parts = [
    format.height ? `${format.height}p${format.fps && format.fps > 30 ? Math.round(format.fps) : ""}` : undefined,
    format.extension.toUpperCase(),
    hasCodec(format.videoCodec) ? format.videoCodec!.split(".")[0] : undefined,
    hasCodec(format.audioCodec) && !hasCodec(format.videoCodec)
      ? format.audioCodec!.split(".")[0]
      : undefined,
    format.bitrateKbps ? `${Math.round(format.bitrateKbps)} kbps` : undefined,
    format.fileSize ? formatBytes(format.fileSize) : undefined,
    format.hdr ? "HDR" : undefined,
    format.language ? languageName(format.language) : undefined,
  ];
  return `${parts.filter(Boolean).join(", ")} (ID ${format.formatId})`;
}

/** Label on the left, control on the right, as in a desktop "new task" form. */
function FormRow({
  label,
  controlId,
  children,
}: {
  label: string;
  controlId: string;
  children: ReactNode;
}) {
  return (
    <div className="form-row">
      <label className="form-row__label" id={`${controlId}-label`} htmlFor={controlId}>
        {label}
      </label>
      <div className="form-row__control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} id={id}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type CodecChoice = CodecPreference | "" | `gpu:${HardwareCodec}`;

/**
 * One codec choice: which version to download from the site, or a GPU encoder
 * (NVIDIA NVENC or AMD AMF) to re-encode with after downloading. GPU choices
 * bring up their quality and decoding options.
 */
function VideoCodec({
  hardware,
  options,
  setOptions,
  isPlaylist,
}: {
  hardware?: HardwareAccelerationInfo;
  options: DownloadOptions;
  setOptions: (options: DownloadOptions) => void;
  isPlaylist: boolean;
}) {
  const conversion = isPlaylist ? undefined : options.videoConversion;
  const encoderFor = (codec: HardwareCodec) =>
    hardware?.encoders.find((encoder) => encoder.codec === codec && encoder.available);
  const selected = conversion ? encoderFor(conversion.codec) : undefined;
  const providers = new Set(
    hardware?.encoders.filter((encoder) => encoder.available).map((encoder) => encoder.provider),
  );
  const vendor = [...providers].map((provider) => providerNames[provider]).join(", ");
  const unavailable = isPlaylist
    ? "one video at a time"
    : !hardware || hardware.status === "checking"
      ? "checking the GPU"
      : "not supported here";
  const update = (patch: Partial<NonNullable<DownloadOptions["videoConversion"]>>) =>
    conversion && setOptions({ ...options, videoConversion: { ...conversion, ...patch } });

  const choices: ReadonlyArray<SelectOption<CodecChoice>> = [
    ...codecOptions.map((option) => ({ ...option, group: "Download as" })),
    ...(["h264", "hevc", "av1"] as const).map((codec) => ({
      value: `gpu:${codec}` as const,
      label: encoderFor(codec) && !isPlaylist ? gpuCodecLabels[codec] : `${gpuCodecLabels[codec]} (${unavailable})`,
      disabled: !encoderFor(codec) || isPlaylist,
      group: vendor ? `Convert on GPU (${vendor})` : "Convert on GPU",
    })),
  ];

  const choose = (choice: CodecChoice) => {
    if (choice.startsWith("gpu:")) {
      const codec = choice.slice(4) as HardwareCodec;
      setOptions({
        ...options,
        codecPreference: undefined,
        videoConversion: {
          codec,
          quality: conversion?.quality ?? 23,
          useHardwareDecode: Boolean(conversion?.useHardwareDecode && encoderFor(codec)?.decodeAvailable),
        },
      });
    } else {
      setOptions({
        ...options,
        codecPreference: (choice || undefined) as CodecPreference | undefined,
        videoConversion: undefined,
      });
    }
  };

  return (
    <>
      <Select
        id="video-codec"
        value={conversion ? (`gpu:${conversion.codec}` as const) : (options.codecPreference ?? "")}
        options={choices}
        onChange={choose}
      />
      {conversion && (
        <div className="option-block__body">
          <span className="field__help">
            Re-encodes to MKV after downloading. The original is removed only once the new file is complete.
          </span>
          <label className="field">
            <span className="field__label">
              Quality <span className="mono">{conversion.quality}</span>
            </span>
            <input
              type="range"
              min="1"
              max="51"
              value={conversion.quality}
              onChange={(event) => update({ quality: Number(event.target.value) })}
            />
            <span className="field__help">Lower numbers keep more detail and make larger files.</span>
          </label>
          <Toggle
            label="Hardware decoding"
            description={
              selected?.decodeAvailable
                ? "Off: the CPU reads the source and the GPU encodes. On: the GPU does both, which is faster but fails on some sources."
                : "This GPU can encode but not decode here, so the CPU reads the source."
            }
            checked={conversion.useHardwareDecode}
            disabled={!selected?.decodeAvailable}
            onChange={(checked) => update({ useHardwareDecode: checked })}
          />
        </div>
      )}
    </>
  );
}

/** Every yt-dlp feature the app supports, as controls instead of typed flags. */
function AdvancedOptions({
  options,
  setOptions,
  probe,
  filenamePreset,
  setFilenamePreset,
}: {
  options: DownloadOptions;
  setOptions: (options: DownloadOptions) => void;
  probe?: MediaProbe;
  filenamePreset: string;
  setFilenamePreset: (preset: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const set = (patch: Partial<DownloadOptions>) => setOptions({ ...options, ...patch });
  const check = (key: keyof DownloadOptions) => (checked: boolean) => set({ [key]: checked });
  const isPlaylist = Boolean(probe?.isPlaylist);
  const wantsSubtitles = options.writeSubtitles || options.writeAutomaticSubtitles;
  const sponsorblock = options.sponsorblock;
  const toggleCategory = (category: SponsorCategory, checked: boolean) =>
    sponsorblock &&
    set({
      sponsorblock: {
        ...sponsorblock,
        categories: checked
          ? [...sponsorblock.categories, category]
          : sponsorblock.categories.filter((item) => item !== category),
      },
    });
  const subtitleLanguages = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const track of probe?.subtitles ?? []) {
      if (!seen.has(track.language) || !track.automatic) seen.set(track.language, track.automatic);
    }
    return [...seen.entries()]
      .filter(([, automatic]) => !automatic || options.writeAutomaticSubtitles)
      .map(([language]) => language)
      .slice(0, 24);
  }, [probe?.subtitles, options.writeAutomaticSubtitles]);
  const toggleLanguage = (language: string, checked: boolean) =>
    set({
      subtitleLanguages: checked
        ? [...options.subtitleLanguages, language]
        : options.subtitleLanguages.filter((item) => item !== language),
    });
  const toDate = (value?: string) =>
    value ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
  const fromDate = (value: string) => (value ? value.replaceAll("-", "") : undefined);
  const numberOrUndefined = (value: string) => (value ? Number(value) : undefined);
  const converting = options.mode === "audio" && options.audioFormat !== "best";

  return (
    <section className="advanced">
      <button
        type="button"
        className="advanced__trigger"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        Advanced
      </button>
      {expanded && (
        <div className="advanced__body">
          {converting && (
            <FormRow label="Audio" controlId="keep-video">
              <Toggle
                inline
                label="Keep the original video file too"
                checked={Boolean(options.keepVideo)}
                onChange={check("keepVideo")}
              />
            </FormRow>
          )}

          <FormRow label="Subtitles" controlId="subtitle-languages">
            <Toggle
              inline
              label="Download available subtitles"
              checked={options.writeSubtitles}
              onChange={check("writeSubtitles")}
            />
            <Toggle
              inline
              label="Include automatic captions"
              checked={options.writeAutomaticSubtitles}
              onChange={check("writeAutomaticSubtitles")}
            />
            {wantsSubtitles && (
              <>
                {subtitleLanguages.length > 0 && (
                  <div className="chip-group" role="group" aria-label="Subtitle languages">
                    {subtitleLanguages.map((language) => (
                      <label className="chip" key={language}>
                        <input
                          type="checkbox"
                          checked={options.subtitleLanguages.includes(language)}
                          onChange={(event) => toggleLanguage(language, event.target.checked)}
                        />
                        {languageName(language)}
                      </label>
                    ))}
                  </div>
                )}
                <input
                  id="subtitle-languages"
                  placeholder="Languages, for example en.*, ja (empty means English)"
                  value={options.subtitleLanguages.join(", ")}
                  onChange={(event) =>
                    set({
                      subtitleLanguages: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <div className="inline-field">
                  <span>Save as</span>
                  <Select
                    id="subtitle-format"
                    label="Subtitle format"
                    value={options.subtitleFormat ?? ""}
                    options={subtitleFormatOptions}
                    onChange={(value) => set({ subtitleFormat: value || undefined })}
                  />
                </div>
                <Toggle
                  inline
                  label="Embed subtitles in the file"
                  checked={options.embedSubtitles}
                  onChange={check("embedSubtitles")}
                />
              </>
            )}
          </FormRow>

          <FormRow label="Chapters" controlId="remove-chapters">
            <Toggle
              inline
              label="Embed chapter markers"
              checked={Boolean(options.embedChapters)}
              onChange={check("embedChapters")}
            />
            <Toggle
              inline
              label="Also save each chapter as its own file"
              checked={Boolean(options.splitChapters)}
              onChange={check("splitChapters")}
            />
            <input
              id="remove-chapters"
              placeholder="Cut out chapters whose title contains…"
              value={options.removeChapters ?? ""}
              onChange={(event) => set({ removeChapters: event.target.value || undefined })}
            />
          </FormRow>

          <FormRow label="SponsorBlock" controlId="sponsorblock">
            <Select
              id="sponsorblock"
              value={sponsorblock?.mode ?? "off"}
              options={[
                { value: "off", label: "Off" },
                { value: "mark", label: "Mark segments as chapters" },
                { value: "remove", label: "Cut segments out of the file" },
              ]}
              onChange={(mode) =>
                set({
                  sponsorblock:
                    mode === "off"
                      ? undefined
                      : { mode, categories: sponsorblock?.categories ?? ["sponsor"] },
                })
              }
            />
            {sponsorblock && (
              <div className="chip-group" role="group" aria-label="SponsorBlock segments">
                {sponsorCategories.map((category) => (
                  <label className="chip" key={category.value}>
                    <input
                      type="checkbox"
                      checked={sponsorblock.categories.includes(category.value)}
                      onChange={(event) => toggleCategory(category.value, event.target.checked)}
                    />
                    {category.label}
                  </label>
                ))}
              </div>
            )}
            {sponsorblock && sponsorblock.categories.length === 0 && (
              <span className="field__error">Choose at least one kind of segment.</span>
            )}
          </FormRow>

          <FormRow label="Extra files" controlId="extra-files">
            <div className="inline-field">
              <Toggle
                inline
                label="Thumbnail image"
                checked={Boolean(options.writeThumbnail)}
                onChange={check("writeThumbnail")}
              />
              {options.writeThumbnail && (
                <Select
                  id="thumbnail-format"
                  label="Thumbnail format"
                  value={options.thumbnailFormat ?? "jpg"}
                  options={[
                    { value: "jpg", label: "JPG" },
                    { value: "png", label: "PNG" },
                    { value: "webp", label: "WebP" },
                  ]}
                  onChange={(value) => set({ thumbnailFormat: value === "jpg" ? undefined : value })}
                />
              )}
            </div>
            <Toggle
              inline
              label="Video description (text)"
              checked={Boolean(options.writeDescription)}
              onChange={check("writeDescription")}
            />
            <Toggle
              inline
              label="Full metadata (JSON)"
              checked={Boolean(options.writeInfoJson)}
              onChange={check("writeInfoJson")}
            />
            <Toggle
              inline
              label="Comments (saved in the metadata JSON)"
              checked={Boolean(options.writeComments)}
              onChange={check("writeComments")}
            />
            <Toggle
              inline
              label="Shortcut to the source page"
              checked={Boolean(options.writeLink)}
              onChange={check("writeLink")}
            />
          </FormRow>

          <FormRow label="File" controlId="filename-preset">
            <Select
              id="filename-preset"
              value={filenamePreset}
              options={filenamePresets
                .filter((preset) => preset.value !== "index" || isPlaylist)
                .map(({ value, label }) => ({ value, label }))}
              onChange={setFilenamePreset}
            />
            <Toggle
              inline
              label="Embed title and metadata"
              checked={options.embedMetadata}
              onChange={check("embedMetadata")}
            />
            <Toggle
              inline
              label="Embed thumbnail as cover art"
              checked={options.embedThumbnail}
              onChange={check("embedThumbnail")}
            />
            <Toggle
              inline
              label="Simple file names (no spaces or special characters)"
              checked={Boolean(options.restrictFilenames)}
              onChange={check("restrictFilenames")}
            />
            <Toggle
              inline
              label="Windows-safe file names"
              checked={Boolean(options.windowsFilenames)}
              onChange={check("windowsFilenames")}
            />
            <div className="inline-field">
              <span>Shorten names to</span>
              <Select
                id="trim-filenames"
                label="Shorten file names"
                value={String(options.trimFilenames ?? "")}
                options={[
                  { value: "", label: "no limit" },
                  { value: "150", label: "150 characters" },
                  { value: "100", label: "100 characters" },
                  { value: "60", label: "60 characters" },
                ]}
                onChange={(value) => set({ trimFilenames: numberOrUndefined(value) })}
              />
            </div>
            <Toggle
              inline
              label="Replace a file that already exists"
              checked={Boolean(options.forceOverwrites)}
              onChange={check("forceOverwrites")}
            />
          </FormRow>

          {isPlaylist && (
            <FormRow label="Playlist" controlId="playlist-items">
              <input
                id="playlist-items"
                placeholder="Items: all, or 1:10 and 1,3,8"
                value={options.playlistItems ?? ""}
                disabled={options.playlistOrder === "reverse"}
                onChange={(event) => set({ playlistItems: event.target.value })}
              />
              <div className="inline-field">
                <span>Order</span>
                <Select
                  id="playlist-order"
                  label="Order"
                  value={options.playlistOrder ?? ""}
                  options={[
                    { value: "", label: "As listed" },
                    { value: "reverse", label: "Reversed, oldest first on channels" },
                    { value: "random", label: "Random" },
                  ]}
                  onChange={(value) =>
                    set({
                      playlistOrder: value || undefined,
                      playlistItems: value === "reverse" ? undefined : options.playlistItems,
                    })
                  }
                />
              </div>
              <div className="inline-field">
                <span>Uploaded from</span>
                <input
                  type="date"
                  aria-label="Uploaded on or after"
                  value={toDate(options.dateAfter)}
                  onChange={(event) => set({ dateAfter: fromDate(event.target.value) })}
                />
                <span>to</span>
                <input
                  type="date"
                  aria-label="Uploaded on or before"
                  value={toDate(options.dateBefore)}
                  onChange={(event) => set({ dateBefore: fromDate(event.target.value) })}
                />
              </div>
              <div className="inline-field">
                <span>Only files from</span>
                <input
                  type="number"
                  min="1"
                  aria-label="Minimum file size in megabytes"
                  placeholder="any"
                  value={options.minFilesizeMb ?? ""}
                  onChange={(event) => set({ minFilesizeMb: numberOrUndefined(event.target.value) })}
                />
                <span>to</span>
                <input
                  type="number"
                  min="1"
                  aria-label="Maximum file size in megabytes"
                  placeholder="any"
                  value={options.maxFilesizeMb ?? ""}
                  onChange={(event) => set({ maxFilesizeMb: numberOrUndefined(event.target.value) })}
                />
                <span>MB</span>
              </div>
              <div className="inline-field">
                <span>Skip videos shorter than</span>
                <Select
                  id="min-duration"
                  label="Skip videos shorter than"
                  value={String(options.minDurationSeconds ?? "")}
                  options={[
                    { value: "", label: "no minimum" },
                    { value: "60", label: "1 minute" },
                    { value: "180", label: "3 minutes, skips Shorts" },
                    { value: "600", label: "10 minutes" },
                  ]}
                  onChange={(value) => set({ minDurationSeconds: numberOrUndefined(value) })}
                />
              </div>
              <Toggle
                inline
                label="Skip live streams and premieres"
                checked={Boolean(options.skipLive)}
                onChange={check("skipLive")}
              />
              <div className="inline-field">
                <span>Stop after</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  aria-label="Maximum number of items"
                  placeholder="all"
                  value={options.maxDownloads ?? ""}
                  onChange={(event) => set({ maxDownloads: numberOrUndefined(event.target.value) })}
                />
                <span>items, pause</span>
                <Select
                  id="sleep-interval"
                  label="Pause between items"
                  value={String(options.sleepInterval ?? 0)}
                  options={[
                    { value: "0", label: "no pause" },
                    { value: "5", label: "5 seconds" },
                    { value: "15", label: "15 seconds" },
                    { value: "30", label: "30 seconds" },
                    { value: "60", label: "1 minute" },
                  ]}
                  onChange={(value) => set({ sleepInterval: Number(value) || undefined })}
                />
                <span>between items</span>
              </div>
            </FormRow>
          )}

          <FormRow label="Connections" controlId="connections">
            <Select
              id="connections"
              value={String(options.concurrentFragments ?? 1)}
              options={[
                { value: "1", label: "1, gentlest on the site" },
                { value: "2", label: "2" },
                { value: "4", label: "4, faster for streamed video" },
                { value: "8", label: "8" },
                { value: "16", label: "16" },
              ]}
              onChange={(value) =>
                set({ concurrentFragments: value === "1" ? undefined : Number(value) })
              }
            />
          </FormRow>

          <FormRow label="Referer" controlId="referer">
            <input
              id="referer"
              type="url"
              placeholder="Page the video is embedded on, if the site requires it"
              value={options.referer ?? ""}
              onChange={(event) => set({ referer: event.target.value.trim() || undefined })}
            />
          </FormRow>

          <FormRow label="User agent" controlId="user-agent">
            <input
              id="user-agent"
              placeholder="Automatic"
              value={options.userAgent ?? ""}
              onChange={(event) => set({ userAgent: event.target.value || undefined })}
            />
          </FormRow>
        </div>
      )}
    </section>
  );
}

/**
 * Modal "new task" window: link, type and quality, folder, advanced options.
 * Uses the native <dialog> for focus trapping, Escape, and the top layer.
 */
export function NewDownloadDialog() {
  const { settings, dependencies, hardwareAcceleration, probe, isAnalyzing, analyzeError, draftUrl } =
    useAppStore(
      useShallow((state) => ({
        settings: state.settings,
        dependencies: state.dependencies,
        hardwareAcceleration: state.hardwareAcceleration,
        probe: state.probe,
        isAnalyzing: state.isAnalyzing,
        analyzeError: state.analyzeError,
        draftUrl: state.draftUrl,
      })),
    );
  const { analyze, setDraftUrl, enqueue, rememberDownloadDirectory, closeNewDownload, showSettings } =
    useAppStore(
      useShallow((state) => ({
        analyze: state.analyze,
        setDraftUrl: state.setDraftUrl,
        enqueue: state.enqueue,
        rememberDownloadDirectory: state.rememberDownloadDirectory,
        closeNewDownload: state.closeNewDownload,
        showSettings: state.showSettings,
      })),
    );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState(
    settings?.lastDownloadDirectory ?? settings?.downloadDirectory ?? "",
  );
  const [options, setOptions] = useState<DownloadOptions>({
    ...defaultOptions,
    mode: settings?.defaultMode === "audio" ? "audio" : "video",
    quality: settings?.defaultQuality ?? "best",
  });
  const [videoStream, setVideoStream] = useState("");
  const [audioStream, setAudioStream] = useState("");
  const [filenamePreset, setFilenamePreset] = useState("default");
  const [wholePlaylist, setWholePlaylist] = useState(false);
  const [clipDraft, setClipDraft] = useState<ClipDraft>();
  const [submitting, setSubmitting] = useState<"now" | "queue">();
  const [submitError, setSubmitError] = useState<string>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const ready = (kind: string) =>
    dependencies.some((dependency) => dependency.kind === kind && dependency.status === "available");
  const ytDlpReady = ready("yt_dlp");
  const ffmpegReady = ready("ffmpeg");
  const picking = options.mode === "custom";
  const clipDisabledReason = probe?.isPlaylist
    ? "Clips work with one video at a time."
    : probe?.isLive
      ? "Live streams can't be trimmed before downloading."
      : !ffmpegReady
        ? "Cutting a clip needs the bundled FFmpeg engine."
        : undefined;
  const clipValidation = useMemo(
    () => (clipDraft ? validateClipDraft(clipDraft, probe?.durationSeconds) : undefined),
    [clipDraft, probe?.durationSeconds],
  );
  const clipBlocked = Boolean(clipDraft && (clipDisabledReason || clipValidation?.kind === "invalid"));
  const maxHeight = useMemo(
    () => Math.max(0, ...(probe?.formats.map((format) => format.height ?? 0) ?? [])),
    [probe?.formats],
  );
  const streams = useMemo(() => {
    const usable = (probe?.formats ?? []).filter((format) => format.extension !== "mhtml");
    return {
      video: usable
        .filter((format) => hasCodec(format.videoCodec))
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0)),
      audio: usable
        .filter((format) => hasCodec(format.audioCodec) && !hasCodec(format.videoCodec))
        .sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0)),
    };
  }, [probe?.formats]);
  const lossless = ["best", "flac", "wav"].includes(options.audioFormat);
  const sponsorIncomplete = options.sponsorblock?.categories.length === 0;
  const link = draftUrl.trim();
  const playlistLink = isVideoInPlaylist(link);
  const audioLanguages = useMemo(
    () => [
      ...new Set(
        (probe?.formats ?? [])
          .filter((format) => hasCodec(format.audioCodec) && format.language)
          .map((format) => format.language!),
      ),
    ],
    [probe?.formats],
  );

  function setType(type: "video" | "audio") {
    setOptions({
      ...options,
      mode: type,
      quality: options.mode === "custom" ? "best" : options.quality,
      videoConversion: type === "video" ? options.videoConversion : undefined,
    });
  }

  function setQuality(quality: string) {
    if (quality === pickStreams) {
      setOptions({ ...options, mode: "custom", videoConversion: undefined });
      if (!videoStream && streams.video[0]) setVideoStream(streams.video[0].formatId);
      if (!audioStream && streams.audio[0]) setAudioStream(streams.audio[0].formatId);
      return;
    }
    setOptions({ ...options, mode: "video", quality });
  }

  function startAnalysis(value = link, whole = wholePlaylist) {
    if (!value || !ytDlpReady) return;
    setClipDraft(undefined);
    if (isVideoInPlaylist(value) && !whole) void analyze(value, true);
    else void analyze(value);
  }

  function setPlaylistScope(scope: "video" | "playlist") {
    setWholePlaylist(scope === "playlist");
    startAnalysis(link, scope === "playlist");
  }

  function onLinkKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      startAnalysis();
    }
  }

  function onLinkPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = linkFromText(event.clipboardData.getData("text"));
    if (!pasted) return;
    event.preventDefault();
    setDraftUrl(pasted);
    startAnalysis(pasted);
  }

  async function chooseDestination() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: destination || undefined,
    });
    if (!selected) return;
    setDestination(selected);
    setSubmitError(undefined);
    try {
      await rememberDownloadDirectory(selected);
    } catch {
      setSubmitError("This folder is selected, but it couldn't be remembered for the next download.");
    }
  }

  async function submit(startImmediately: boolean) {
    if (!probe || !destination) return;
    if (clipDraft && clipDisabledReason) return setSubmitError(clipDisabledReason);
    if (clipValidation?.kind === "invalid") return setSubmitError(clipValidation.message);
    const customFormat = picking
      ? [videoStream, audioStream].filter(Boolean).join("+")
      : undefined;
    if (picking && !customFormat) return setSubmitError("Choose a video or audio stream.");
    if (probe.isPlaylist && !options.playlistItems?.trim() && !options.maxDownloads) {
      const scope = probe.playlistCount ? `all ${probe.playlistCount} items` : "the full collection";
      let approved: boolean;
      try {
        approved = await confirm(`This will download ${scope}. Continue?`, {
          title: "Download the whole playlist?",
          kind: "warning",
          okLabel: "Download all",
          cancelLabel: "Go back",
        });
      } catch {
        setSubmitError("Playlist confirmation unavailable. Please try the download again.");
        return;
      }
      if (!approved) return;
    }
    setSubmitting(startImmediately ? "now" : "queue");
    setSubmitError(undefined);
    const template =
      filenamePresets.find((preset) => preset.value === filenamePreset)?.template ??
      settings?.filenameTemplate ??
      defaultTemplate;
    const request: DownloadRequest = {
      url: probe.url,
      destination,
      filenameTemplate: template,
      isPlaylist: probe.isPlaylist,
      options: {
        ...options,
        customFormat,
        customArguments: [],
        noPlaylist: playlistLink && !wholePlaylist,
        videoConversion: probe.isPlaylist ? undefined : options.videoConversion,
        clip: clipValidation?.kind === "valid" ? clipValidation.clip : undefined,
      },
    };
    try {
      await enqueue(request, startImmediately);
    } catch (error) {
      setSubmitError(String(error));
    } finally {
      setSubmitting(undefined);
    }
  }

  const blocked = !destination || clipBlocked || sponsorIncomplete || Boolean(submitting);

  return (
    <dialog
      ref={dialogRef}
      className="task-dialog"
      aria-labelledby="new-download-title"
      onCancel={(event) => {
        event.preventDefault();
        closeNewDownload();
      }}
    >
      <header className="task-dialog__header">
        <h2 id="new-download-title">New download</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          title="Close (Esc)"
          onClick={closeNewDownload}
        >
          <X />
        </button>
      </header>

      <div className="task-dialog__body">
        <textarea
          className="link-box"
          rows={3}
          autoFocus
          spellCheck={false}
          aria-label="Video, playlist, or channel link"
          placeholder="Paste a video, playlist, or channel link"
          value={draftUrl}
          onChange={(event) => {
            setDraftUrl(event.target.value.replace(/\s+/g, " ").trimStart());
            setClipDraft(undefined);
          }}
          onKeyDown={onLinkKeyDown}
          onPaste={onLinkPaste}
        />

        {!ytDlpReady && (
          <div className="callout callout--warning">
            <strong>The bundled downloader couldn't start</strong>
            <p>Reinstall the app to restore its tools, or choose a trusted replacement in Settings.</p>
            <button type="button" className="button button--outline button--compact" onClick={showSettings}>
              Open Settings
            </button>
          </div>
        )}

        {isAnalyzing && (
          <div className="skeleton-stack" aria-live="polite" aria-label="Reading link">
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--line" />
          </div>
        )}

        {analyzeError && (
          <div className="callout callout--error" role="alert">
            <strong>Couldn't read that link</strong>
            <p>{analyzeError}</p>
          </div>
        )}

        {probe && (
          <section className="media-head" aria-labelledby="media-title">
            <h3 id="media-title">{probe.title}</h3>
            <p className="media-head__meta">
              {probe.creator ? `${probe.creator} on ${hostname(probe.url)}` : hostname(probe.url)}
            </p>
            <p className="tags">
              {probe.durationSeconds != null && (
                <span className="tag mono">{formatDuration(probe.durationSeconds)}</span>
              )}
              {probe.isPlaylist && (
                <span className="tag">
                  {probe.playlistCount ? `Playlist of ${probe.playlistCount}` : "Playlist"}
                </span>
              )}
              {probe.isLive && <span className="tag tag--live">Live</span>}
              {maxHeight > 0 && <span className="tag mono">{maxHeight}p max</span>}
            </p>
            {probe.warnings.map((warning) => (
              <p className="inline-warning" key={warning}>
                <AlertCircle aria-hidden="true" />
                {warning}
              </p>
            ))}
          </section>
        )}

        <div className="form-rows">
          {playlistLink && (
            <FormRow label="This link" controlId="playlist-scope">
              <Segmented
                id="playlist-scope"
                label="What to download from this link"
                value={wholePlaylist ? "playlist" : "video"}
                options={[
                  { value: "video", label: "Just this video" },
                  { value: "playlist", label: "Whole playlist" },
                ]}
                onChange={setPlaylistScope}
              />
            </FormRow>
          )}

          <FormRow label="Download" controlId="download-type">
            <Segmented
              id="download-type"
              label="Download type"
              value={options.mode === "audio" ? "audio" : "video"}
              options={[
                { value: "video", label: "Video" },
                { value: "audio", label: "Audio only" },
              ]}
              onChange={setType}
            />
          </FormRow>

          {options.mode !== "audio" && (
            <>
              <FormRow label="Quality" controlId="video-quality">
                <Select
                  id="video-quality"
                  value={picking ? pickStreams : options.quality}
                  options={[
                    ...qualityOptions,
                    {
                      value: pickStreams,
                      label: probe ? "Pick exact streams…" : "Pick exact streams (read the link first)",
                      disabled: !probe || streams.video.length + streams.audio.length === 0,
                    },
                  ]}
                  onChange={setQuality}
                />
                {!picking &&
                  /^\d+$/.test(options.quality) &&
                  maxHeight > 0 &&
                  maxHeight < Number(options.quality) && (
                    <span className="field__help">
                      This source tops out at {maxHeight}p, so that is what you get.
                    </span>
                  )}
                {options.quality === "best" && !picking && !ffmpegReady && (
                  <span className="field__help">Saves a single file until FFmpeg is available.</span>
                )}
              </FormRow>

              {picking && (
                <>
                  <FormRow label="Video stream" controlId="video-stream">
                    <Select
                      id="video-stream"
                      value={videoStream}
                      options={[
                        { value: "", label: "None, audio only" },
                        ...streams.video.map((format) => ({
                          value: format.formatId,
                          label: streamLabel(format),
                        })),
                      ]}
                      onChange={setVideoStream}
                    />
                  </FormRow>
                  <FormRow label="Audio stream" controlId="audio-stream">
                    <Select
                      id="audio-stream"
                      value={audioStream}
                      options={[
                        { value: "", label: "None, or the one inside the video stream" },
                        ...streams.audio.map((format) => ({
                          value: format.formatId,
                          label: streamLabel(format),
                        })),
                      ]}
                      onChange={setAudioStream}
                    />
                  </FormRow>
                </>
              )}

              <FormRow label="Container" controlId="container">
                <Select
                  id="container"
                  value={options.container ?? ""}
                  options={containerOptions}
                  onChange={(value) => setOptions({ ...options, container: value || undefined })}
                />
              </FormRow>

              {!picking && (
                <FormRow label="Video codec" controlId="video-codec">
                  <VideoCodec
                    hardware={hardwareAcceleration}
                    options={options}
                    setOptions={setOptions}
                    isPlaylist={Boolean(probe?.isPlaylist)}
                  />
                </FormRow>
              )}
            </>
          )}

          {options.mode === "audio" && (
            <>
              <FormRow label="Audio format" controlId="audio-format">
                <Select
                  id="audio-format"
                  value={options.audioFormat}
                  options={audioFormatOptions}
                  onChange={(audioFormat) =>
                    setOptions({
                      ...options,
                      audioFormat,
                      audioQuality: ["best", "flac", "wav"].includes(audioFormat)
                        ? "best"
                        : options.audioQuality,
                    })
                  }
                />
              </FormRow>
              <FormRow label="Bitrate" controlId="audio-bitrate">
                <Select
                  id="audio-bitrate"
                  value={options.audioQuality}
                  options={audioQualityOptions}
                  disabled={lossless}
                  onChange={(audioQuality) => setOptions({ ...options, audioQuality })}
                />
                {lossless && (
                  <span className="field__help">
                    {options.audioFormat === "best"
                      ? "The original audio keeps its quality."
                      : "Lossless formats have no target bitrate."}
                  </span>
                )}
              </FormRow>
            </>
          )}

          {audioLanguages.length > 1 && (
            <FormRow label="Audio track" controlId="audio-language">
              <Select
                id="audio-language"
                value={options.audioLanguage ?? ""}
                options={[
                  { value: "", label: "Original language" },
                  ...audioLanguages.map((language) => ({
                    value: language,
                    label: languageName(language),
                  })),
                ]}
                onChange={(value) => setOptions({ ...options, audioLanguage: value || undefined })}
              />
            </FormRow>
          )}

          {probe?.isLive && (
            <FormRow label="Live stream" controlId="live-from-start">
              <Toggle
                inline
                label="Record from the beginning, not from now"
                checked={Boolean(options.liveFromStart)}
                onChange={(checked) => setOptions({ ...options, liveFromStart: checked })}
              />
            </FormRow>
          )}

          {probe && (
            <FormRow label="Clip" controlId="clip">
              <ClipEditor
                value={clipDraft}
                durationSeconds={probe.durationSeconds}
                disabledReason={clipDisabledReason}
                onChange={setClipDraft}
              />
            </FormRow>
          )}

        </div>

        <DestinationPicker destination={destination} onBrowse={() => void chooseDestination()} />

        <AdvancedOptions
          options={options}
          setOptions={setOptions}
          probe={probe}
          filenamePreset={filenamePreset}
          setFilenamePreset={setFilenamePreset}
        />
      </div>

      <footer className="task-dialog__footer">
        {submitError && (
          <p className="task-dialog__error" role="alert">
            <AlertCircle aria-hidden="true" />
            {submitError}
          </p>
        )}
        <button type="button" className="button button--outline" onClick={closeNewDownload}>
          Cancel
        </button>
        {probe ? (
          <>
            <button
              type="button"
              className="button button--outline"
              disabled={blocked}
              onClick={() => void submit(false)}
            >
              {submitting === "queue" ? "Adding…" : "Add to queue"}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={blocked}
              onClick={() => void submit(true)}
            >
              {submitting === "now" ? "Starting…" : "Download"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--primary"
            disabled={!link || !ytDlpReady || isAnalyzing}
            onClick={() => startAnalysis()}
          >
            {isAnalyzing ? "Reading link…" : "Analyze"}
          </button>
        )}
      </footer>
    </dialog>
  );
}
