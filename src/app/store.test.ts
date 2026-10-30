import { beforeEach, describe, expect, it } from "vitest";
import type { AppSettings, DownloadJob } from "../types/contracts";
import { readyToAutoUpdate, useAppStore } from "./store";

const settings = { autoUpdateApp: true } as AppSettings;

function job(status: DownloadJob["status"]): DownloadJob {
  return {
    id: status,
    request: {} as DownloadJob["request"],
    status,
    progress: {},
    createdAt: "2026-10-30T00:00:00Z",
    diagnostics: [],
  };
}

describe("readyToAutoUpdate", () => {
  beforeEach(() => {
    useAppStore.setState({
      settings,
      appUpdate: { version: "1.2.0", installing: false },
      queue: [job("completed")],
      queuePaused: false,
      newDownloadOpen: false,
      settingsOpen: false,
      removing: undefined,
    });
  });

  const ready = () => readyToAutoUpdate(useAppStore.getState());

  it("installs a found update once nothing would be interrupted", () => {
    expect(ready()).toBe(true);
  });

  it("waits for running and about-to-start downloads", () => {
    useAppStore.setState({ queue: [job("downloading")] });
    expect(ready()).toBe(false);
    useAppStore.setState({ queue: [job("queued")] });
    expect(ready()).toBe(false);
    // A paused queue won't start them, and they resume after the restart.
    useAppStore.setState({ queuePaused: true });
    expect(ready()).toBe(true);
  });

  it("waits while a dialog is open", () => {
    useAppStore.setState({ newDownloadOpen: true });
    expect(ready()).toBe(false);
    useAppStore.setState({ newDownloadOpen: false, settingsOpen: true });
    expect(ready()).toBe(false);
  });

  it("does nothing when automatic updates are off, after a failure, or while installing", () => {
    useAppStore.setState({ settings: { ...settings, autoUpdateApp: false } });
    expect(ready()).toBe(false);
    useAppStore.setState({ settings, appUpdate: { version: "1.2.0", installing: false, error: "offline" } });
    expect(ready()).toBe(false);
    useAppStore.setState({ appUpdate: { version: "1.2.0", installing: true } });
    expect(ready()).toBe(false);
  });
});
