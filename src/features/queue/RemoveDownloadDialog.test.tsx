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

const second: DownloadJob = {
  ...finished,
  id: "second",
  title: "Second clip",
  outputPath: "D:\\Downloads\\Second clip.mp4",
};
const failed: DownloadJob = { ...finished, id: "failed", status: "failed", outputPath: undefined };
const playlist: DownloadJob = {
  ...finished,
  id: "playlist",
  request: { ...finished.request, isPlaylist: true },
};
const running: DownloadJob = { ...finished, id: "running", status: "downloading" };

/** Opens the dialog the way the app does: through requestRemove. */
function openRemove(jobIds: string | string[]) {
  useAppStore.getState().requestRemove(jobIds);
  const removal = useAppStore.getState().removing;
  expect(removal).toBeDefined();
  return render(<RemoveDownloadDialog removal={removal!} />);
}

describe("Removing a download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      queue: [],
      history: [finished],
      removing: undefined,
      picked: [],
      inspector: { kind: "job", id: "finished" },
    });
  });

  it("asks before removing a finished download and keeps its file by default", async () => {
    const user = userEvent.setup();
    openRemove("finished");

    expect(screen.getByRole("dialog", { name: "Remove download" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Also delete the file/ })).not.toBeChecked();
    expect(screen.getByText(/where you can restore it/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(mocks.trashJobOutput).not.toHaveBeenCalled();
    expect(mocks.removeHistory).toHaveBeenCalledWith("finished");
    expect(useAppStore.getState().history).toEqual([]);
    expect(useAppStore.getState().removing).toBeUndefined();
    expect(useAppStore.getState().inspector).toBeNull();
  });

  it("moves the file to the trash before removing the entry when asked", async () => {
    const user = userEvent.setup();
    openRemove("finished");

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
    openRemove("finished");

    await user.click(screen.getByRole("checkbox", { name: /Also delete the file/ }));
    await user.click(screen.getByRole("button", { name: "Remove and delete file" }));

    expect(screen.getByRole("alert")).toHaveTextContent("in use");
    expect(mocks.removeHistory).not.toHaveBeenCalled();
    expect(useAppStore.getState().history).toEqual([finished]);
    expect(useAppStore.getState().removing?.jobIds).toEqual(["finished"]);
  });

  it("can be cancelled without changing anything", async () => {
    const user = userEvent.setup();
    openRemove("finished");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useAppStore.getState().removing).toBeUndefined();
    expect(mocks.removeHistory).not.toHaveBeenCalled();
  });

  it("removes a failed download or a playlist at once, with nothing to delete", () => {
    useAppStore.setState({ history: [failed, playlist] });

    useAppStore.getState().requestRemove("failed");
    useAppStore.getState().requestRemove("playlist");

    expect(useAppStore.getState().removing).toBeUndefined();
    expect(mocks.removeHistory).toHaveBeenCalledWith("failed");
    expect(mocks.removeHistory).toHaveBeenCalledWith("playlist");
  });
});

describe("Removing several downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      queue: [running],
      history: [finished, second, failed, playlist],
      removing: undefined,
      picked: ["finished", "second", "failed", "playlist", "running"],
      inspector: null,
    });
  });

  it("asks once, leaves running downloads out, and keeps files by default", async () => {
    const user = userEvent.setup();
    openRemove(["finished", "second", "failed", "playlist", "running"]);

    expect(screen.getByRole("dialog", { name: "Remove 4 downloads" })).toBeVisible();
    expect(screen.getByText(/1 active download stays/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Also delete 2 files/ })).not.toBeChecked();
    expect(screen.getByText(/Playlist files stay in their folders/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(mocks.trashJobOutput).not.toHaveBeenCalled();
    expect(mocks.removeHistory).toHaveBeenCalledTimes(4);
    expect(mocks.removeQueueJob).not.toHaveBeenCalled();
    expect(useAppStore.getState().history).toEqual([]);
    expect(useAppStore.getState().queue).toEqual([running]);
    expect(useAppStore.getState().picked).toEqual(["running"]);
    expect(useAppStore.getState().removing).toBeUndefined();
  });

  it("moves only finished single files to the trash", async () => {
    const user = userEvent.setup();
    openRemove(["finished", "second", "failed", "playlist"]);

    await user.click(screen.getByRole("checkbox", { name: /Also delete 2 files/ }));
    await user.click(screen.getByRole("button", { name: "Remove and delete 2 files" }));

    expect(mocks.trashJobOutput.mock.calls.map(([id]) => id).sort()).toEqual([
      "finished",
      "second",
    ]);
    expect(useAppStore.getState().history).toEqual([]);
  });

  it("removes the rest and keeps the downloads whose files couldn't be moved", async () => {
    const user = userEvent.setup();
    mocks.trashJobOutput.mockImplementation(async (id: string) => {
      if (id === "second") throw "The file couldn't be moved to the trash: in use";
    });
    openRemove(["finished", "second", "failed"]);

    await user.click(screen.getByRole("checkbox", { name: /Also delete 2 files/ }));
    await user.click(screen.getByRole("button", { name: "Remove and delete 2 files" }));

    expect(screen.getByRole("alert")).toHaveTextContent("in use");
    expect(useAppStore.getState().history.map((job) => job.id)).toEqual(["second", "playlist"]);
    expect(useAppStore.getState().removing).toEqual({ jobIds: ["second"], skipped: 0 });
    mocks.trashJobOutput.mockReset();
  });

  it("does nothing when every selected download is still running", () => {
    useAppStore.getState().requestRemove(["running"]);

    expect(useAppStore.getState().removing).toBeUndefined();
    expect(mocks.removeQueueJob).not.toHaveBeenCalled();
  });
});
