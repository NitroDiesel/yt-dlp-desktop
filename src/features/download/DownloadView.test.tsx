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
      nvidiaAcceleration: {
        status: "available",
        cudaDecodeCompiled: true,
        cudaDecodeAvailable: true,
        message: "NVIDIA hardware acceleration is ready.",
        encoders: [
          {
            codec: "h264",
            encoder: "h264_nvenc",
            compiled: true,
            available: true,
          },
          {
            codec: "hevc",
            encoder: "hevc_nvenc",
            compiled: true,
            available: true,
          },
          {
            codec: "av1",
            encoder: "av1_nvenc",
            compiled: true,
            available: false,
            message: "Unsupported GPU",
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

  it("offers detected NVENC codecs as an explicit conversion step", async () => {
    const user = userEvent.setup();
    render(<DownloadView />);

    await user.click(
      screen.getByRole("checkbox", {
        name: "Convert video with NVIDIA NVENC",
      }),
    );

    expect(screen.getByLabelText("Video codec")).toHaveValue("h264");
    expect(
      screen.getByRole("checkbox", { name: /Decode on the GPU too/ }),
    ).toBeEnabled();
    expect(screen.getByRole("option", { name: /AV1/ })).toBeDisabled();
  });
});
