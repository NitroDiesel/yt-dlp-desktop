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
  analyze: (url: string) => invoke<MediaProbe>("probe_media", { url }),
  cancelProbe: () => invoke<void>("cancel_probe"),
  enqueue: (request: DownloadRequest, startImmediately: boolean) =>
    invoke<DownloadJob>("enqueue_download", { request, startImmediately }),
  cancelJob: (jobId: string) => invoke<void>("cancel_job", { jobId }),
  retryJob: (jobId: string) => invoke<DownloadJob>("retry_job", { jobId }),
  removeQueueJob: (jobId: string) =>
    invoke<void>("remove_queue_job", { jobId }),
  clearCompleted: () => invoke<void>("clear_completed_jobs"),
  reorderJob: (jobId: string, direction: "up" | "down") =>
    invoke<void>("reorder_job", { jobId, direction }),
  setQueuePaused: (paused: boolean) =>
    invoke<void>("set_queue_paused", { paused }),
  saveSettings: (settings: AppSettings) =>
    invoke<AppSettings>("save_settings", { settings }),
  refreshDependencies: () =>
    invoke<AppSnapshot["dependencies"]>("refresh_dependencies"),
  removeHistory: (jobId: string) =>
    invoke<void>("remove_history_entry", { jobId }),
  openJobOutput: (jobId: string) => invoke<void>("open_job_output", { jobId }),
  revealJobOutput: (jobId: string) =>
    invoke<void>("reveal_job_output", { jobId }),
  onJobChanged: (handler: (job: DownloadJob) => void): Promise<UnlistenFn> =>
    listen<DownloadJob>("download-job-changed", (event) =>
      handler(event.payload),
    ),
};
