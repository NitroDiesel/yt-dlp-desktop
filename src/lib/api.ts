import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  AppSnapshot,
  DownloadJob,
  DownloadRequest,
  MediaProbe,
} from "../types/contracts";

export const appApi = {
  initialize: () => invoke<AppSnapshot>("initialize_app"),
  analyze: (url: string, noPlaylist = false) =>
    invoke<MediaProbe>("probe_media", { url, noPlaylist }),
  cancelProbe: () => invoke<void>("cancel_probe"),
  enqueue: (request: DownloadRequest, startImmediately: boolean) =>
    invoke<DownloadJob>("enqueue_download", { request, startImmediately }),
  cancelJob: (jobId: string) => invoke<void>("cancel_job", { jobId }),
  retryJob: (jobId: string) => invoke<DownloadJob>("retry_job", { jobId }),
  removeQueueJob: (jobId: string) =>
    invoke<void>("remove_queue_job", { jobId }),
  clearCompleted: () => invoke<void>("clear_completed_jobs"),
  /** Moves a waiting job and returns the reordered queue. */
  reorderJob: (jobId: string, direction: "up" | "down") =>
    invoke<DownloadJob[]>("reorder_job", { jobId, direction }),
  setQueuePaused: (paused: boolean) =>
    invoke<void>("set_queue_paused", { paused }),
  saveSettings: (settings: AppSettings) =>
    invoke<AppSettings>("save_settings", { settings }),
  rememberDownloadDirectory: (directory: string) =>
    invoke<AppSettings>("remember_download_directory", { directory }),
  refreshDependencies: () =>
    invoke<AppSnapshot["dependencies"]>("refresh_dependencies"),
  /** Updates the app's copy of yt-dlp, then returns every tool re-checked. */
  updateEngine: () => invoke<AppSnapshot["dependencies"]>("update_engine"),
  /** Cached GPU capability; `force` re-runs the test encodes. */
  refreshHardwareAcceleration: (force: boolean) =>
    invoke<AppSnapshot["hardwareAcceleration"]>(
      "refresh_hardware_acceleration",
      { force },
    ),
  removeHistory: (jobId: string) =>
    invoke<void>("remove_history_entry", { jobId }),
  openJobOutput: (jobId: string) => invoke<void>("open_job_output", { jobId }),
  revealJobOutput: (jobId: string) =>
    invoke<void>("reveal_job_output", { jobId }),
  onJobChanged: (handler: (job: DownloadJob) => void): Promise<UnlistenFn> =>
    listen<DownloadJob>("download-job-changed", (event) =>
      handler(event.payload),
    ),
  /** Fires after the daily background yt-dlp update. */
  onDependenciesChanged: (
    handler: (dependencies: AppSnapshot["dependencies"]) => void,
  ): Promise<UnlistenFn> =>
    listen<AppSnapshot["dependencies"]>("dependencies-changed", (event) =>
      handler(event.payload),
    ),
};
