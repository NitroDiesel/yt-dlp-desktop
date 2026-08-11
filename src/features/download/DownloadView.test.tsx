import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../app/store";
import type { AppSettings, MediaProbe } from "../../types/contracts";
import { DownloadView } from "./DownloadView";

const dialogMocks = vi.hoisted(() => ({ confirm: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);

const settings: AppSettings = {
  downloadDirectory: "C:\\Downloads",
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

describe("DownloadView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      settings,
      probe,
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
      setView: vi.fn(),
    });
  });

  it("shows task-level choices and progressively reveals advanced settings", async () => {
    const user = userEvent.setup();
    render(<DownloadView />);

    expect(
      screen.getByRole("heading", { name: "A useful test video" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /Best available/ })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Audio" }));
    expect(screen.getByLabelText("Audio format")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /Subtitles, metadata/ }),
    );
    expect(screen.getByText("Download available subtitles")).toBeVisible();
    expect(screen.getByText("Expert arguments")).toBeVisible();
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
    render(<DownloadView />);

    await user.type(
      screen.getByRole("textbox", {
        name: "Video, playlist, or channel link",
      }),
      "https://example.com/watch/slow-engine",
    );
    const analyzeButton = screen.getByRole("button", { name: "Analyze media" });
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
    render(<DownloadView />);

    await user.click(screen.getByRole("button", { name: "Download now" }));
    expect(dialogMocks.confirm).toHaveBeenCalledWith(
      "This will download all 24 items. Continue?",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(enqueue).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Download now" }));
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("offers detected GPU codecs as an automatic conversion step", async () => {
    const user = userEvent.setup();
    render(<DownloadView />);

    await user.click(
      screen.getByRole("checkbox", {
        name: "Convert video with automatic GPU acceleration",
      }),
    );

    expect(screen.getByLabelText("Video codec")).toHaveValue("h264");
    expect(
      screen.getByRole("checkbox", { name: /Decode on the GPU too/ }),
    ).toBeEnabled();
    expect(screen.getByRole("option", { name: /AV1/ })).toBeDisabled();
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
    render(<DownloadView />);

    await user.click(
      screen.getByRole("checkbox", {
        name: "Convert video with automatic GPU acceleration",
      }),
    );

    expect(screen.getByRole("option", { name: /AMD AMF/ })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /Decode on the GPU too/ }),
    ).toBeDisabled();
  });
});
