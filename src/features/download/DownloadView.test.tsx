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
});
