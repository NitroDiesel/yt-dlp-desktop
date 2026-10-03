import { describe, expect, it } from "vitest";
import type { DownloadJob, JobStatus } from "../types/contracts";
import { countDownloads, linkFromText, mergeDownloads } from "./jobs";

function job(id: string, status: JobStatus, finishedAt?: string): DownloadJob {
  return {
    id,
    status,
    finishedAt,
    createdAt: "2026-09-01T00:00:00Z",
    progress: {},
    diagnostics: [],
    request: {
      url: "https://example.com/v",
      destination: "/downloads",
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
  };
}

describe("downloads list", () => {
  it("lists running work first in queue order, then finished work newest first, once each", () => {
    const old = job("old", "completed", "2026-09-01T10:00:00Z");
    const recent = job("recent", "failed", "2026-09-03T10:00:00Z");
    const queue = [job("waiting", "queued"), recent, job("running", "downloading")];
    const history = [recent, old];

    expect(mergeDownloads(queue, history).map((item) => item.id)).toEqual([
      "waiting",
      "running",
      "recent",
      "old",
    ]);
    expect(countDownloads(queue, history)).toEqual({
      all: 4,
      downloading: 2,
      completed: 1,
      stopped: 1,
    });
  });

  it("finds a link inside pasted text", () => {
    expect(linkFromText("watch this https://youtu.be/abc?t=4 later")).toBe(
      "https://youtu.be/abc?t=4",
    );
    expect(linkFromText("not a link")).toBeUndefined();
  });
});
