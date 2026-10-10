import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../app/store";
import type { DownloadJob } from "../../types/contracts";
import { JobDetails } from "./JobDetails";
import { JobRow } from "./JobRow";

const mocks = vi.hoisted(() => ({
  revealJobOutput: vi.fn().mockResolvedValue(undefined),
  openJobOutput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/api", () => ({ appApi: mocks }));

const completedJob: DownloadJob = {
  id: "completed-job",
  request: {
    url: "https://www.youtube.com/watch?v=example",
    destination: "D:\\Downloads",
    filenameTemplate: "%(title)s.%(ext)s",
    isPlaylist: false,
    options: {
      mode: "audio",
      quality: "best",
      audioFormat: "mp3",
      audioQuality: "320K",
      subtitleLanguages: [],
      writeSubtitles: false,
      writeAutomaticSubtitles: false,
      embedSubtitles: false,
      embedMetadata: true,
      embedThumbnail: true,
      customArguments: [],
    },
  },
  title: "Downloaded track",
  status: "completed",
  progress: { percent: 100 },
  createdAt: "2026-08-29T00:00:00Z",
  finishedAt: "2026-08-29T00:01:00Z",
  outputPath: "D:\\Downloads\\Downloaded track.mp3",
  diagnostics: [],
};

function renderRow(job: DownloadJob) {
  const handlers = {
    onSelect: vi.fn(),
    onCancel: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <ul>
      <JobRow job={job} selected={false} {...handlers} />
    </ul>,
  );
  return handlers;
}

describe("JobRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a finished download with its format and reveals the file", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderRow(completedJob);

    expect(screen.getByText("Completed")).toBeVisible();
    expect(screen.getByText("MP3, 320 kbps · youtube.com")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    await user.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(mocks.revealJobOutput).toHaveBeenCalledWith("completed-job");

    await user.click(screen.getByRole("button", { name: /Downloaded track/ }));
    expect(onSelect).toHaveBeenCalledWith("completed-job");
  });

  it("shows live progress and can cancel a running download", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderRow({
      ...completedJob,
      status: "downloading",
      outputPath: undefined,
      progress: { percent: 42, speedBytesPerSecond: 2_400_000, etaSeconds: 18 },
    });

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeVisible();
    expect(screen.getByText("2.4 MB/s")).toBeVisible();
    expect(screen.getByText("0:18")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledWith("completed-job");
  });

  it("offers retry and removal for a failed download", async () => {
    const user = userEvent.setup();
    const { onRetry, onRemove } = renderRow({
      ...completedJob,
      status: "failed",
      outputPath: undefined,
    });

    expect(screen.getByText("Needs attention")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRetry).toHaveBeenCalledWith("completed-job");
    expect(onRemove).toHaveBeenCalledWith("completed-job");
  });
});

describe("JobDetails", () => {
  it("explains a failure and keeps the technical log one click away", async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      queue: [
        {
          ...completedJob,
          status: "failed",
          outputPath: undefined,
          errorCategory: "network_failure",
          errorMessage: "Connection interrupted",
          diagnostics: ["ERROR: Connection reset"],
        },
      ],
      history: [],
      retry,
    });
    render(<JobDetails jobId="completed-job" />);

    expect(screen.getByText("Connection interrupted")).toBeVisible();
    expect(screen.getByText("D:\\Downloads")).toBeVisible();
    await user.click(screen.getByText("Technical details"));
    expect(screen.getByText("ERROR: Connection reset")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith("completed-job");
  });

  it("opens a completed file from the details panel", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ queue: [], history: [completedJob] });
    render(<JobDetails jobId="completed-job" />);

    await user.click(screen.getByRole("button", { name: "Open file" }));
    expect(mocks.openJobOutput).toHaveBeenCalledWith("completed-job");
  });
});
