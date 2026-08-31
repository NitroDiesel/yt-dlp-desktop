import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DownloadJob } from "../../types/contracts";
import { JobCard } from "./JobCard";

const mocks = vi.hoisted(() => ({
  revealJobOutput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/api", () => ({
  appApi: { revealJobOutput: mocks.revealJobOutput },
}));

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
  outputPath: "D:\\Downloads\\Downloaded track.mp3",
  diagnostics: [],
};

describe("JobCard", () => {
  it("keeps the card clean and wires Show in folder to the completed job", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <JobCard
        job={completedJob}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    expect(container.querySelector(".job-card__rail")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(mocks.revealJobOutput).toHaveBeenCalledWith("completed-job");
  });
});
