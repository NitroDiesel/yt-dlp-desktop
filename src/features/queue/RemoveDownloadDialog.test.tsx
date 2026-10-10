import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../app/store";
import type { DownloadJob } from "../../types/contracts";
import { RemoveDownloadDialog } from "./RemoveDownloadDialog";

const mocks = vi.hoisted(() => ({
  removeQueueJob: vi.fn().mockResolvedValue(undefined),
  removeHistory: vi.fn().mockResolvedValue(undefined),
  trashJobOutput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/api", () => ({ appApi: mocks }));

const finished: DownloadJob = {
  id: "finished",
  request: {
    url: "https://www.tiktok.com/@creator/video/1",
    destination: "D:\\Downloads",
    filenameTemplate: "%(title)s.%(ext)s",
    isPlaylist: false,
    options: {
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
    },
  },
  title: "Dance clip",
  status: "completed",
  progress: { percent: 100 },
  createdAt: "2026-10-10T00:00:00Z",
  outputPath: "D:\\Downloads\\Dance clip.mp4",
  diagnostics: [],
};

describe("Removing a download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      queue: [],
      history: [finished],
      removing: undefined,
      inspector: { kind: "job", id: "finished" },
    });
  });

  it("asks before removing a finished download and keeps its file by default", async () => {
    const user = userEvent.setup();
    useAppStore.getState().requestRemove("finished");
    expect(useAppStore.getState().removing).toBe("finished");
    render(<RemoveDownloadDialog jobId="finished" />);

    expect(screen.getByRole("dialog", { name: "Remove download" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Also delete the file/ })).not.toBeChecked();
    expect(screen.getByText(/where you can restore it/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(mocks.trashJobOutput).not.toHaveBeenCalled();
    expect(mocks.removeHistory).toHaveBeenCalledWith("finished");
    expect(useAppStore.getState().history).toEqual([]);
    expect(useAppStore.getState().removing).toBeUndefined();
  });

  it("moves the file to the trash before removing the entry when asked", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ removing: "finished" });
    render(<RemoveDownloadDialog jobId="finished" />);

    await user.click(screen.getByRole("checkbox", { name: /Also delete the file/ }));
    await user.click(screen.getByRole("button", { name: "Remove and delete file" }));

    expect(mocks.trashJobOutput).toHaveBeenCalledWith("finished");
    expect(mocks.trashJobOutput.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeHistory.mock.invocationCallOrder[0],
    );
    expect(useAppStore.getState().history).toEqual([]);
  });

  it("keeps the entry and explains why when the file can't be deleted", async () => {
    const user = userEvent.setup();
    mocks.trashJobOutput.mockRejectedValueOnce("The file couldn't be moved to the trash: in use");
    useAppStore.setState({ removing: "finished" });
    render(<RemoveDownloadDialog jobId="finished" />);

    await user.click(screen.getByRole("checkbox", { name: /Also delete the file/ }));
    await user.click(screen.getByRole("button", { name: "Remove and delete file" }));

    expect(screen.getByRole("alert")).toHaveTextContent("in use");
    expect(mocks.removeHistory).not.toHaveBeenCalled();
    expect(useAppStore.getState().history).toEqual([finished]);
  });

  it("can be cancelled without changing anything", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ removing: "finished" });
    render(<RemoveDownloadDialog jobId="finished" />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useAppStore.getState().removing).toBeUndefined();
    expect(mocks.removeHistory).not.toHaveBeenCalled();
  });

  it("removes a failed download or a playlist at once, with nothing to delete", () => {
    useAppStore.setState({
      history: [
        { ...finished, id: "failed", status: "failed", outputPath: undefined },
        { ...finished, id: "playlist", request: { ...finished.request, isPlaylist: true } },
      ],
    });

    useAppStore.getState().requestRemove("failed");
    useAppStore.getState().requestRemove("playlist");

    expect(useAppStore.getState().removing).toBeUndefined();
    expect(mocks.removeHistory).toHaveBeenCalledWith("failed");
    expect(mocks.removeHistory).toHaveBeenCalledWith("playlist");
  });
});
