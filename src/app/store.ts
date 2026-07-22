import { create } from "zustand";
import { appApi } from "../lib/api";
import type {
  AppSettings,
  AppSnapshot,
  DependencyInfo,
  DownloadJob,
  DownloadRequest,
  MediaProbe,
} from "../types/contracts";

export type ViewName = "download" | "queue" | "history" | "settings";

interface AppState {
  activeView: ViewName;
  initialized: boolean;
  fatalError?: string;
  settings?: AppSettings;
  dependencies: DependencyInfo[];
  queue: DownloadJob[];
  history: DownloadJob[];
  queuePaused: boolean;
  probe?: MediaProbe;
  isAnalyzing: boolean;
  analysisRevision: number;
  analyzeError?: string;
  setView: (view: ViewName) => void;
  initialize: () => Promise<void>;
  analyze: (url: string) => Promise<void>;
  cancelAnalysis: () => Promise<void>;
  clearProbe: () => void;
  enqueue: (
    request: DownloadRequest,
    startImmediately: boolean,
  ) => Promise<DownloadJob>;
  updateJob: (job: DownloadJob) => void;
  cancel: (jobId: string) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
  removeQueueJob: (jobId: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  reorder: (jobId: string, direction: "up" | "down") => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  refreshDependencies: () => Promise<void>;
  removeHistory: (jobId: string) => Promise<void>;
}

function mergeJob(items: DownloadJob[], job: DownloadJob): DownloadJob[] {
  const index = items.findIndex((item) => item.id === job.id);
  if (index < 0) return [job, ...items];
  return items.map((item) => (item.id === job.id ? job : item));
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: "download",
  initialized: false,
  dependencies: [],
  queue: [],
  history: [],
  queuePaused: false,
  isAnalyzing: false,
  analysisRevision: 0,
  setView: (activeView) => set({ activeView }),
  initialize: async () => {
    try {
      const snapshot: AppSnapshot = await appApi.initialize();
      set({ ...snapshot, initialized: true, fatalError: undefined });
      await appApi.onJobChanged((job) => get().updateJob(job));
    } catch (error) {
      set({ initialized: true, fatalError: String(error) });
    }
  },
  analyze: async (url) => {
    const revision = get().analysisRevision + 1;
    set({
      isAnalyzing: true,
      analyzeError: undefined,
      probe: undefined,
      analysisRevision: revision,
    });
    try {
      const probe = await appApi.analyze(url);
      if (get().analysisRevision === revision) set({ probe });
    } catch (error) {
      if (get().analysisRevision === revision)
        set({ analyzeError: String(error) });
    } finally {
      if (get().analysisRevision === revision) set({ isAnalyzing: false });
    }
  },
  cancelAnalysis: async () => {
    set((state) => ({
      analysisRevision: state.analysisRevision + 1,
      isAnalyzing: false,
      analyzeError: undefined,
      probe: undefined,
    }));
    await appApi.cancelProbe();
  },
  clearProbe: () => set({ probe: undefined, analyzeError: undefined }),
  enqueue: async (request, startImmediately) => {
    const job = await appApi.enqueue(request, startImmediately);
    set((state) => ({ queue: mergeJob(state.queue, job) }));
    return job;
  },
  updateJob: (job) =>
    set((state) => ({
      queue: mergeJob(state.queue, job),
      history: ["completed", "failed", "cancelled"].includes(job.status)
        ? mergeJob(state.history, job)
        : state.history,
    })),
  cancel: async (jobId) => appApi.cancelJob(jobId),
  retry: async (jobId) => {
    const job = await appApi.retryJob(jobId);
    set((state) => ({ queue: mergeJob(state.queue, job) }));
  },
  removeQueueJob: async (jobId) => {
    await appApi.removeQueueJob(jobId);
    set((state) => ({
      queue: state.queue.filter((item) => item.id !== jobId),
    }));
  },
  clearCompleted: async () => {
    await appApi.clearCompleted();
    set((state) => ({
      queue: state.queue.filter((item) => item.status !== "completed"),
    }));
  },
  reorder: async (jobId, direction) => {
    await appApi.reorderJob(jobId, direction);
    const snapshot = await appApi.initialize();
    set({ queue: snapshot.queue });
  },
  setPaused: async (paused) => {
    await appApi.setQueuePaused(paused);
    set({ queuePaused: paused });
  },
  saveSettings: async (settings) => {
    const saved = await appApi.saveSettings(settings);
    set({ settings: saved });
  },
  refreshDependencies: async () => {
    set({ dependencies: await appApi.refreshDependencies() });
  },
  removeHistory: async (jobId) => {
    await appApi.removeHistory(jobId);
    set((state) => ({
      history: state.history.filter((item) => item.id !== jobId),
    }));
  },
}));
