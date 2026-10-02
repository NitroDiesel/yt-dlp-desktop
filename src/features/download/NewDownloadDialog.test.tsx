import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../app/store";
import type { AppSettings, MediaProbe } from "../../types/contracts";
import { NewDownloadDialog } from "./NewDownloadDialog";

const dialogMocks = vi.hoisted(() => ({ confirm: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);

const settings: AppSettings = {
  downloadDirectory: "C:\\Downloads",
  lastDownloadDirectory: "D:\\Saved videos",
  filenameTemplate: "%(title)s.%(ext)s",
  defaultMode: "video",
  defaultQuality: "best",
  queueConcurrency: 1,
  theme: "system",
  reducedMotion: false,
  retries: 10,
  fragmentRetries: 10,
};

const probe: MediaProbe = {
  id: "abc",
  url: "https://example.com/watch/abc",
  title: "A useful test video",
  creator: "Example creator",
  durationSeconds: 65,
  isPlaylist: false,
  isLive: false,
  formats: [{ formatId: "1", extension: "mp4", height: 1080, hdr: false }],
  subtitles: [],
  warnings: [],
};

describe("NewDownloadDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      settings,
      probe,
      dependencies: [
        {
          kind: "yt_dlp",
          status: "available",
          source: "bundled",
          path: "C:\\Program Files\\yt-dlp Desktop\\yt-dlp.exe",
          version: "2026.08.13",
        },
        {
          kind: "ffmpeg",
          status: "available",
          source: "bundled",
          path: "C:\\Program Files\\yt-dlp Desktop\\ffmpeg.exe",
          version: "8.1",
        },
      ],
      isAnalyzing: false,
      analyzeError: undefined,
      hardwareAcceleration: {
        status: "available",
        message: "NVIDIA NVENC is ready.",
        encoders: [
          {
            provider: "nvenc",
            codec: "h264",
            encoder: "h264_nvenc",
            compiled: true,
            available: true,
            decodeBackend: "cuda",
            decodeAvailable: true,
          },
          {
            provider: "nvenc",
            codec: "hevc",
            encoder: "hevc_nvenc",
            compiled: true,
            available: true,
            decodeBackend: "cuda",
            decodeAvailable: false,
          },
          {
            provider: "nvenc",
            codec: "av1",
            encoder: "av1_nvenc",
            compiled: true,
            available: false,
            decodeBackend: "cuda",
            decodeAvailable: false,
            message: "Unsupported GPU",
          },
          {
            provider: "amf",
            codec: "h264",
            encoder: "h264_amf",
            compiled: true,
            available: false,
            decodeAvailable: false,
          },
        ],
      },
      enqueue: vi.fn(),
      rememberDownloadDirectory: vi.fn(),
      draftUrl: "",
    });
  });

  it("shows task-level choices and progressively reveals advanced settings", async () => {
    const user = userEvent.setup();
    render(<NewDownloadDialog />);

    expect(
      screen.getByRole("heading", { name: "A useful test video" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Quality")).toHaveValue("best");

    await user.click(screen.getByRole("radio", { name: "Audio only" }));
    expect(screen.getByLabelText("Audio format")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Advanced" }),
    );
    expect(screen.getByText("Download available subtitles")).toBeVisible();
    expect(screen.getByLabelText("SponsorBlock")).toBeVisible();
    expect(screen.queryByLabelText(/arguments/i)).not.toBeInTheDocument();
  });

  it("passes the selected audio bitrate to the download request", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ enqueue });
    render(<NewDownloadDialog />);

    await user.click(screen.getByRole("radio", { name: "Audio only" }));
    await user.selectOptions(screen.getByLabelText("Audio format"), "mp3");
    await user.selectOptions(screen.getByLabelText("Bitrate"), "320K");
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mode: "audio",
          audioFormat: "mp3",
          audioQuality: "320K",
        }),
      }),
      true,
    );
  });

  it("allows analysis when a bundled engine is ready but its version probe was slow", async () => {
    const user = userEvent.setup();
    const analyze = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      probe: undefined,
      dependencies: [
        {
          kind: "yt_dlp",
          status: "available",
          source: "bundled",
          path: "C:\\Program Files\\yt-dlp Desktop\\yt-dlp.exe",
          message:
            "The bundled tool is ready. Its version response took longer than expected.",
        },
      ],
      analyze,
    });
    render(<NewDownloadDialog />);

    await user.type(
      screen.getByRole("textbox", {
        name: "Video, playlist, or channel link",
      }),
      "https://example.com/watch/slow-engine",
    );
    const analyzeButton = screen.getByRole("button", { name: "Analyze" });
    expect(analyzeButton).toBeEnabled();

    await user.click(analyzeButton);
    expect(analyze).toHaveBeenCalledWith(
      "https://example.com/watch/slow-engine",
    );
  });

  it("requires confirmation before enqueueing a full playlist", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      probe: { ...probe, isPlaylist: true, playlistCount: 24 },
      enqueue,
    });
    dialogMocks.confirm
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<NewDownloadDialog />);

    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(dialogMocks.confirm).toHaveBeenCalledWith(
      "This will download all 24 items. Continue?",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(enqueue).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("shows a usable error when playlist confirmation cannot open", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      probe: { ...probe, isPlaylist: true, playlistCount: 24 },
      enqueue,
    });
    dialogMocks.confirm.mockRejectedValueOnce(
      new Error("dialog.confirm not allowed"),
    );
    render(<NewDownloadDialog />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Playlist confirmation unavailable. Please try the download again.",
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("offers detected GPU codecs as an automatic conversion step", async () => {
    const user = userEvent.setup();
    render(<NewDownloadDialog />);

    await user.click(
      screen.getByRole("switch", { name: "GPU conversion" }),
    );

    expect(screen.getByLabelText("Video codec")).toHaveValue("h264");
    expect(
      screen.getByRole("switch", { name: "Hardware decoding" }),
    ).toBeEnabled();
    expect(screen.getByRole("option", { name: /AV1/ })).toBeDisabled();
  });

  it("adds an accurate selected timeframe to the download request", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ enqueue });
    render(<NewDownloadDialog />);

    await user.click(
      screen.getByRole("switch", {
        name: "Download only a selected timeframe",
      }),
    );
    const start = screen.getByRole("textbox", { name: "Clip start time" });
    const end = screen.getByRole("textbox", { name: "Clip end time" });
    await user.clear(start);
    await user.type(start, "0:12.5");
    await user.clear(end);
    await user.type(end, "0:30.75");

    expect(
      screen.getByRole("status", { name: "Selected clip duration" }),
    ).toHaveTextContent("18.25 seconds selected");
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          clip: {
            startSeconds: 12.5,
            durationSeconds: 18.25,
            precise: true,
          },
        }),
      }),
      true,
    );
  });

  it("recognizes an AMD AMF-only system without a vendor choice", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      hardwareAcceleration: {
        status: "available",
        message: "AMD AMF is ready.",
        encoders: [
          {
            provider: "amf",
            codec: "h264",
            encoder: "h264_amf",
            compiled: true,
            available: true,
            decodeAvailable: false,
          },
        ],
      },
    });
    render(<NewDownloadDialog />);

    await user.click(
      screen.getByRole("switch", { name: "GPU conversion" }),
    );

    expect(screen.getByRole("option", { name: /AMD AMF/ })).toBeEnabled();
    expect(
      screen.getByRole("switch", { name: "Hardware decoding" }),
    ).toBeDisabled();
  });

  it("restores and updates the last used download folder without a history menu", async () => {
    const user = userEvent.setup();
    const rememberDownloadDirectory = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ rememberDownloadDirectory });
    render(<NewDownloadDialog />);

    const destination = screen.getByRole("button", {
      name: "Browse for a download folder",
    });
    expect(destination).toHaveTextContent("D:\\Saved videos");
    expect(
      screen.queryByRole("combobox", { name: "Recent download folders" }),
    ).not.toBeInTheDocument();

    dialogMocks.open.mockResolvedValueOnce("E:\\New downloads");
    await user.click(destination);
    await waitFor(() =>
      expect(rememberDownloadDirectory).toHaveBeenCalledWith(
        "E:\\New downloads",
      ),
    );
    expect(destination).toHaveTextContent("E:\\New downloads");
  });

  it("reads a pasted link right away and closes on Cancel", async () => {
    const user = userEvent.setup();
    const analyze = vi.fn().mockResolvedValue(undefined);
    const closeNewDownload = vi.fn();
    useAppStore.setState({ probe: undefined, analyze, closeNewDownload });
    render(<NewDownloadDialog />);

    expect(screen.getByRole("dialog", { name: "New download" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    screen.getByRole("textbox", { name: "Video, playlist, or channel link" }).focus();
    await user.paste("https://example.com/watch/pasted");
    expect(analyze).toHaveBeenCalledWith("https://example.com/watch/pasted");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closeNewDownload).toHaveBeenCalledOnce();
  });

  it("offers video or audio before a link is read", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ probe: undefined });
    render(<NewDownloadDialog />);

    expect(screen.getByRole("radio", { name: "Video" })).toBeChecked();
    expect(screen.getByLabelText("Quality")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "Audio only" }));
    expect(screen.getByLabelText("Audio format")).toBeVisible();
    expect(screen.queryByLabelText("Quality")).not.toBeInTheDocument();
  });

  it("turns interactive yt-dlp options into the download request", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ enqueue });
    render(<NewDownloadDialog />);

    await user.selectOptions(screen.getByLabelText("Container"), "mp4");
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.selectOptions(screen.getByLabelText("Video codec"), "h264");
    await user.selectOptions(screen.getByLabelText("SponsorBlock"), "remove");
    await user.click(screen.getByRole("checkbox", { name: "Intros" }));
    await user.click(screen.getByRole("switch", { name: "Embed chapter markers" }));
    await user.click(screen.getByRole("switch", { name: "Thumbnail image" }));
    await user.selectOptions(screen.getByLabelText("Connections"), "4");
    await user.selectOptions(screen.getByLabelText("File"), "uploader");
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        filenameTemplate: "%(uploader).80B - %(title).150B.%(ext)s",
        options: expect.objectContaining({
          container: "mp4",
          codecPreference: "h264",
          sponsorblock: { mode: "remove", categories: ["sponsor", "intro"] },
          embedChapters: true,
          writeThumbnail: true,
          concurrentFragments: 4,
          customArguments: [],
        }),
      }),
      true,
    );
  });

  it("picks exact streams from the formats yt-dlp found", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      enqueue,
      probe: {
        ...probe,
        formats: [
          { formatId: "137", extension: "mp4", height: 1080, videoCodec: "avc1.640028", audioCodec: "none", hdr: false },
          { formatId: "248", extension: "webm", height: 1080, videoCodec: "vp9", audioCodec: "none", hdr: false },
          { formatId: "140", extension: "m4a", videoCodec: "none", audioCodec: "mp4a.40.2", bitrateKbps: 129, hdr: false },
        ],
      },
    });
    render(<NewDownloadDialog />);

    await user.selectOptions(screen.getByLabelText("Quality"), "pick");
    expect(screen.getByLabelText("Video stream")).toHaveValue("137");
    expect(screen.getByLabelText("Audio stream")).toHaveValue("140");
    await user.selectOptions(screen.getByLabelText("Video stream"), "248");
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ mode: "custom", customFormat: "248+140" }),
      }),
      true,
    );
  });

  it("asks for a SponsorBlock segment before allowing a download", async () => {
    const user = userEvent.setup();
    render(<NewDownloadDialog />);

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.selectOptions(screen.getByLabelText("SponsorBlock"), "mark");
    await user.click(screen.getByRole("checkbox", { name: "Sponsors" }));

    expect(screen.getByText("Choose at least one kind of segment.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
  });

  it("downloads just the video from a playlist link unless asked for the whole list", async () => {
    const user = userEvent.setup();
    const analyze = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const link = "https://www.youtube.com/watch?v=abc&list=PL123";
    useAppStore.setState({ analyze, enqueue, draftUrl: link });
    render(<NewDownloadDialog />);

    expect(screen.getByRole("radio", { name: "Just this video" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ noPlaylist: true }) }),
      true,
    );

    await user.click(screen.getByRole("radio", { name: "Whole playlist" }));
    expect(analyze).toHaveBeenLastCalledWith(link);
  });

  it("offers audio tracks and subtitle languages found in the video", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      enqueue,
      probe: {
        ...probe,
        formats: [
          { formatId: "137", extension: "mp4", height: 1080, videoCodec: "avc1", audioCodec: "none", hdr: false },
          { formatId: "140-0", extension: "m4a", videoCodec: "none", audioCodec: "mp4a", language: "en", hdr: false },
          { formatId: "140-1", extension: "m4a", videoCodec: "none", audioCodec: "mp4a", language: "ja", hdr: false },
        ],
        subtitles: [
          { language: "en", extensions: ["vtt"], automatic: false },
          { language: "fr", extensions: ["vtt"], automatic: false },
        ],
      },
    });
    render(<NewDownloadDialog />);

    await user.selectOptions(screen.getByLabelText("Audio track"), "ja");
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.click(screen.getByRole("switch", { name: "Download available subtitles" }));
    await user.click(screen.getByRole("checkbox", { name: /^French/ }));
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          audioLanguage: "ja",
          writeSubtitles: true,
          subtitleLanguages: ["fr"],
        }),
      }),
      true,
    );
  });

  it("filters a playlist and sets request headers without typing flags", async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ enqueue, probe: { ...probe, isPlaylist: true, playlistCount: 80 } });
    render(<NewDownloadDialog />);

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await user.selectOptions(screen.getByLabelText("Order"), "reverse");
    await user.type(screen.getByLabelText("Uploaded on or after"), "2026-01-15");
    await user.type(screen.getByLabelText("Maximum file size in megabytes"), "500");
    await user.selectOptions(screen.getByLabelText(/Skip videos shorter than/), "180");
    await user.click(screen.getByRole("switch", { name: "Skip live streams and premieres" }));
    await user.type(screen.getByLabelText("Maximum number of items"), "20");
    await user.type(screen.getByLabelText("Referer"), "https://example.com/embed");
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          playlistOrder: "reverse",
          dateAfter: "20260115",
          maxFilesizeMb: 500,
          minDurationSeconds: 180,
          skipLive: true,
          maxDownloads: 20,
          referer: "https://example.com/embed",
        }),
      }),
      true,
    );
  });
});
