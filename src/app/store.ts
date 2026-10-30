import { create } from "zustand";
import { appApi } from "../lib/api";
import {
  filterFor,
  findJob,
  hasDeletableFile,
  isRunning,
  isVideoInPlaylist,
  type DownloadFilter,
} from "../lib/jobs";
import type {
  AppSettings,
  AppSnapshot,
  AppUpdateInfo,
  DependencyInfo,
  DownloadJob,
  DownloadRequest,
  MediaProbe,
  HardwareAccelerationInfo,
} from "../types/contracts";

export type Inspector = { kind: "job"; id: string } | null;
export type SettingsSection =
  | "downloads"
  | "network"
  | "engine"
  | "gpu"
  | "appearance"
  | "updates";

/** A newer release found on GitHub, and how far installing it has come. */
export interface AppUpdateState {
  version: string;
  installing: boolean;
  downloaded?: number;
  total?: number;
  error?: string;
}

interface AppState {
  filter: DownloadFilter;
  /** Settings is a modal over the downloads list. */
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  appUpdate?: AppUpdateState;
  inspector: Inspector;
  newDownloadOpen: boolean;
  /** Download waiting in the Remove dialog for the keep-or-delete-file choice. */
  removing?: string;
  /** Hidden sidebar; remembered on this device across launches. */
  sidebarCollapsed: boolean;
  /** Link in the New download dialog; also filled by paste-anywhere. */
  draftUrl: string;
  initialized: boolean;
  fatalError?: string;
  settings?: AppSettings;
  dependencies: DependencyInfo[];
  hardwareAcceleration?: HardwareAccelerationInfo;
  queue: DownloadJob[];
  history: DownloadJob[];
  queuePaused: boolean;
  probe?: MediaProbe;
  isAnalyzing: boolean;
  analysisRevision: number;
  analyzeError?: string;
  showDownloads: (filter?: DownloadFilter) => void;
  showSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  checkAppUpdate: () => Promise<AppUpdateInfo | null>;
  installAppUpdate: () => Promise<void>;
  openNewDownload: (url?: string) => void;
  closeNewDownload: () => void;
  selectJob: (jobId: string) => void;
  closeInspector: () => void;
  toggleSidebar: () => void;
  setDraftUrl: (url: string) => void;
  initialize: () => Promise<void>;
  analyze: (url: string, noPlaylist?: boolean) => Promise<void>;
  cancelAnalysis: () => Promise<void>;
  clearProbe: () => void;
  enqueue: (
    request: DownloadRequest,
    startImmediately: boolean,
  ) => Promise<DownloadJob>;
  updateJob: (job: DownloadJob) => void;
  cancel: (jobId: string) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
  /** Removes at once, or asks first when there is a file that could be deleted too. */
  requestRemove: (jobId: string) => void;
  cancelRemove: () => void;
  removeJob: (jobId: string, deleteFile?: boolean) => Promise<void>;
  clearCompleted: () => Promise<void>;
  reorder: (jobId: string, direction: "up" | "down") => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  updateEngine: () => Promise<void>;
  rememberDownloadDirectory: (directory: string) => Promise<void>;
  ensureHardwareAcceleration: () => void;
  refreshEngineStatus: () => Promise<void>;
}

/** Window-layout preference, so it lives with the webview rather than in app settings. */
const SIDEBAR_KEY = "sidebar-collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
}

function mergeJob(items: DownloadJob[], job: DownloadJob): DownloadJob[] {
  const index = items.findIndex((item) => item.id === job.id);
  if (index < 0) return [job, ...items];
  const next = items.slice();
  next[index] = job;
  return next;
}

let hardwareRequest: Promise<void> | undefined;

/** How often a running app looks for a new release; it also checks at launch. */
const APP_UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
let appUpdateTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Automatic updates install only when nothing would be interrupted: no download
 * running or about to start, and no dialog open.
 */
export function readyToAutoUpdate(state: AppState): boolean {
  const update = state.appUpdate;
  if (!update || update.installing || update.error || !state.settings?.autoUpdateApp)
    return false;
  if (state.newDownloadOpen || state.settingsOpen || state.removing) return false;
  return state.queue.every(
    (job) => !isRunning(job.status) && (job.status !== "queued" || state.queuePaused),
  );
}

export const useAppStore = create<AppState>((set, get) => ({
  filter: "all",
  settingsOpen: false,
  settingsSection: "downloads",
  inspector: null,
  newDownloadOpen: false,
  sidebarCollapsed: readSidebarCollapsed(),
  draftUrl: "",
  initialized: false,
  dependencies: [],
  queue: [],
  history: [],
  queuePaused: false,
  isAnalyzing: false,
  analysisRevision: 0,
  showDownloads: (filter) =>
    set((state) => ({ settingsOpen: false, filter: filter ?? state.filter })),
  showSettings: (section) =>
    set((state) => ({
      settingsOpen: true,
      newDownloadOpen: false,
      settingsSection: section ?? state.settingsSection,
    })),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  checkAppUpdate: async () => {
    const update = await appApi.checkAppUpdate();
    set((state) => ({
      appUpdate: update
        ? state.appUpdate?.version === update.version
          ? state.appUpdate
          : { version: update.version, installing: false }
        : undefined,
    }));
    return update;
  },
  installAppUpdate: async () => {
    const update = get().appUpdate;
    if (!update || update.installing) return;
    set({ appUpdate: { version: update.version, installing: true } });
    try {
      // Resolves only if the restart fails; otherwise the app closes here.
      await appApi.installAppUpdate();
    } catch (error) {
      set({ appUpdate: { version: update.version, installing: false, error: String(error) } });
    }
  },
  openNewDownload: (url) => {
    set({ settingsOpen: false, newDownloadOpen: true });
    get().ensureHardwareAcceleration();
    if (url) {
      set({ draftUrl: url });
      // A video inside a playlist starts as "just this video"; the dialog can widen it.
      if (isVideoInPlaylist(url)) void get().analyze(url, true);
      else void get().analyze(url);
    }
  },
  closeNewDownload: () => {
    if (get().isAnalyzing) void get().cancelAnalysis();
    set({
      newDownloadOpen: false,
      draftUrl: "",
      probe: undefined,
      analyzeError: undefined,
    });
  },
  selectJob: (jobId) => set({ inspector: { kind: "job", id: jobId } }),
  closeInspector: () => set({ inspector: null }),
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed });
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed));
    } catch {
      // Storage can be unavailable; the toggle still works for this session.
    }
  },
  setDraftUrl: (draftUrl) => {
    if (draftUrl === get().draftUrl) return;
    set({ draftUrl, probe: undefined, analyzeError: undefined });
  },
  updateEngine: async () => {
    set({ dependencies: await appApi.updateEngine() });
  },
  initialize: async () => {
    try {
      const snapshot: AppSnapshot = await appApi.initialize();
      set({ ...snapshot, initialized: true, fatalError: undefined });
      await appApi.onJobChanged((job) => get().updateJob(job));
      await appApi.onDependenciesChanged((dependencies) => set({ dependencies }));
      if (!appUpdateTimer) {
        await appApi.onAppUpdateProgress(({ downloaded, total }) =>
          set((state) => ({
            appUpdate: state.appUpdate && { ...state.appUpdate, downloaded, total },
          })),
        );
        const check = () => {
          if (get().settings?.autoUpdateApp) void get().checkAppUpdate().catch(() => null);
        };
        appUpdateTimer = setInterval(check, APP_UPDATE_INTERVAL);
        check();
        useAppStore.subscribe((state) => {
          if (readyToAutoUpdate(state)) void state.installAppUpdate();
        });
      }
    } catch (error) {
      set({ initialized: true, fatalError: String(error) });
    }
  },
  analyze: async (url, noPlaylist = false) => {
    const revision = get().analysisRevision + 1;
    set({
      isAnalyzing: true,
      analyzeError: undefined,
      probe: undefined,
      analysisRevision: revision,
    });
    try {
      const probe = await appApi.analyze(url, noPlaylist);
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
    set((state) => ({
      queue: mergeJob(state.queue, job),
      filter: state.filter === "all" ? "all" : "downloading",
      draftUrl: "",
      probe: undefined,
      newDownloadOpen: false,
      inspector: { kind: "job", id: job.id },
    }));
    return job;
  },
  updateJob: (job) =>
    set((state) => ({
      queue: mergeJob(state.queue, job),
      history:
        filterFor(job.status) !== "downloading" && job.status !== "interrupted"
          ? mergeJob(state.history, job)
          : state.history,
    })),
  cancel: async (jobId) => appApi.cancelJob(jobId),
  retry: async (jobId) => {
    const job = await appApi.retryJob(jobId);
    set((state) => ({
      queue: mergeJob(state.queue, job),
      inspector:
        state.inspector?.kind === "job" && state.inspector.id === jobId
          ? { kind: "job", id: job.id }
          : state.inspector,
    }));
  },
  requestRemove: (jobId) => {
    const { queue, history } = get();
    const job = findJob(queue, history, jobId);
    if (job && hasDeletableFile(job)) set({ removing: jobId });
    else void get().removeJob(jobId);
  },
  cancelRemove: () => set({ removing: undefined }),
  removeJob: async (jobId, deleteFile = false) => {
    const { queue, history } = get();
    if (deleteFile) await appApi.trashJobOutput(jobId);
    await Promise.all([
      queue.some((job) => job.id === jobId) && appApi.removeQueueJob(jobId),
      history.some((job) => job.id === jobId) && appApi.removeHistory(jobId),
    ]);
    set((state) => ({
      queue: state.queue.filter((job) => job.id !== jobId),
      history: state.history.filter((job) => job.id !== jobId),
      removing: state.removing === jobId ? undefined : state.removing,
      inspector:
        state.inspector?.kind === "job" && state.inspector.id === jobId
          ? null
          : state.inspector,
    }));
  },
  clearCompleted: async () => {
    await appApi.clearCompleted();
    set((state) => ({
      queue: state.queue.filter((job) => job.status !== "completed"),
      history: state.history.filter((job) => job.status !== "completed"),
      inspector: null,
    }));
  },
  reorder: async (jobId, direction) => {
    const queue = await appApi.reorderJob(jobId, direction);
    set({ queue });
  },
  setPaused: async (paused) => {
    await appApi.setQueuePaused(paused);
    set({ queuePaused: paused });
  },
  saveSettings: async (settings) => {
    const previous = get().settings;
    const saved = await appApi.saveSettings(settings);
    set({ settings: saved });
    if (
      previous?.ytDlpPath !== saved.ytDlpPath ||
      previous?.ffmpegPath !== saved.ffmpegPath ||
      previous?.denoPath !== saved.denoPath
    ) {
      set({ dependencies: await appApi.refreshDependencies() });
      if (previous?.ffmpegPath !== saved.ffmpegPath) {
        set({
          hardwareAcceleration: {
            status: "checking",
            encoders: [],
            message: "Checking the installed GPU and driver for NVENC or AMF…",
          },
        });
        get().ensureHardwareAcceleration();
      }
    }
  },
  rememberDownloadDirectory: async (directory) => {
    const settings = await appApi.rememberDownloadDirectory(directory);
    set({ settings });
  },
  ensureHardwareAcceleration: () => {
    if (get().hardwareAcceleration?.status !== "checking" || hardwareRequest)
      return;
    hardwareRequest = appApi
      .refreshHardwareAcceleration(false)
      .then((hardwareAcceleration) => set({ hardwareAcceleration }))
      .catch(() => undefined)
      .finally(() => {
        hardwareRequest = undefined;
      });
  },
  refreshEngineStatus: async () => {
    const [dependencies, hardwareAcceleration] = await Promise.all([
      appApi.refreshDependencies(),
      appApi.refreshHardwareAcceleration(true),
    ]);
    set({ dependencies, hardwareAcceleration });
  },
}));
