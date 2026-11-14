import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../app/store";
import { AppShell } from "../../components/AppShell";
import type { DownloadJob } from "../../types/contracts";
import { QueueView } from "./QueueView";

function download(id: string, status: DownloadJob["status"], minute: number): DownloadJob {
  return {
    id,
    request: {
      url: `https://example.com/watch?v=${id}`,
      destination: "D:\\Downloads",
      filenameTemplate: "%(title)s.%(ext)s",
      isPlaylist: false,
      options: { mode: "video" } as DownloadJob["request"]["options"],
    },
    title: `Video ${id}`,
    status,
    progress: {},
    createdAt: `2026-10-30T00:0${minute}:00Z`,
    finishedAt: `2026-10-30T00:0${minute}:00Z`,
    outputPath: status === "completed" ? `D:\\Downloads\\${id}.mp4` : undefined,
    diagnostics: [],
  };
}

describe("Selecting downloads in the list", () => {
  beforeEach(() => {
    useAppStore.setState({
      filter: "all",
      settingsOpen: false,
      newDownloadOpen: false,
      queue: [download("live", "downloading", 9)],
      history: [download("a", "completed", 1), download("b", "failed", 2)],
      inspector: null,
      picked: [],
      removing: undefined,
    });
  });

  it("selects every row with Select all and asks once to remove them", async () => {
    const user = userEvent.setup();
    render(<QueueView />);

    await user.click(screen.getByRole("button", { name: "Select all" }));
    const toolbar = screen.getByRole("toolbar", { name: "Selected downloads" });
    expect(toolbar).toHaveTextContent("3 selected");

    await user.click(within(toolbar).getByRole("button", { name: "Remove" }));
    expect(useAppStore.getState().removing).toEqual({ jobIds: ["b", "a"], skipped: 1 });

    await user.click(screen.getByRole("button", { name: "Deselect" }));
    expect(useAppStore.getState().picked).toEqual([]);
    expect(screen.getByRole("button", { name: "Select all" })).toBeVisible();
  });

  it("adds rows with Ctrl-click", async () => {
    const user = userEvent.setup();
    render(<QueueView />);

    await user.click(screen.getByRole("button", { name: /^Video a,/ }));
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("button", { name: /^Video b,/ }));
    await user.keyboard("{/Control}");

    expect(screen.getByRole("toolbar")).toHaveTextContent("2 selected");
  });

  it("supports Ctrl+A, Delete, and Escape outside text fields", () => {
    const requestRemove = vi.fn();
    useAppStore.setState({ requestRemove });
    render(
      <AppShell>
        <QueueView />
      </AppShell>,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(useAppStore.getState().picked).toEqual(["live", "b", "a"]);

    fireEvent.keyDown(window, { key: "Delete" });
    expect(requestRemove).toHaveBeenCalledWith(["live", "b", "a"]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAppStore.getState().picked).toEqual([]);
  });
});
