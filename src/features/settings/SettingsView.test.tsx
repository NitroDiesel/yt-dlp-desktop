import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../app/store";
import { chooseOption } from "../../test/select";
import type { AppSettings, DependencyInfo } from "../../types/contracts";
import { SettingsView } from "./SettingsView";

const dialogMocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);

const settings: AppSettings = {
  downloadDirectory: "C:\\Downloads",
  filenameTemplate: "%(title)s.%(ext)s",
  defaultMode: "video",
  defaultQuality: "best",
  queueConcurrency: 1,
  theme: "system",
  accent: "blue",
  autoUpdateEngine: true,
  reducedMotion: false,
  retries: 10,
  fragmentRetries: 10,
};

const dependencies: DependencyInfo[] = [
  {
    kind: "yt_dlp",
    status: "available",
    source: "bundled",
    path: "C:\\Program Files\\yt-dlp Desktop\\yt-dlp.exe",
    message:
      "The bundled tool is ready. Its version response took longer than expected.",
  },
  {
    kind: "ffmpeg",
    status: "available",
    source: "bundled",
    path: "C:\\Program Files\\yt-dlp Desktop\\ffmpeg.exe",
    version: "8.0",
  },
  {
    kind: "ffprobe",
    status: "available",
    source: "bundled",
    path: "C:\\Program Files\\yt-dlp Desktop\\ffprobe.exe",
    version: "8.0",
  },
  {
    kind: "javascript_runtime",
    status: "available",
    source: "bundled",
    path: "C:\\Program Files\\yt-dlp Desktop\\deno.exe",
    version: "2.4.3",
  },
];

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      settings,
      dependencies,
      hardwareAcceleration: {
        status: "driver_or_gpu_missing",
        message: "Software downloads remain available.",
        encoders: [],
      },
      saveSettings: vi.fn(),
      refreshEngineStatus: vi.fn(),
    });
  });

  it("keeps bundled tools ready without asking the user to choose them", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    expect(
      screen.getByText(
        "The bundled tool is ready. Its version response took longer than expected.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^Choose$/ }),
    ).not.toBeInTheDocument();
    const replacementButtons = screen.getAllByRole("button", {
      name: "Select replacement",
    });
    expect(replacementButtons).toHaveLength(3);
    replacementButtons.forEach((button) => expect(button).not.toBeVisible());

    await user.click(screen.getByText("Custom tool overrides"));
    replacementButtons.forEach((button) => expect(button).toBeVisible());
  });

  it("saves edits only when asked and can discard them", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ saveSettings });
    render(<SettingsView />);

    expect(
      screen.queryByRole("region", { name: "Unsaved changes" }),
    ).not.toBeInTheDocument();
    await chooseOption(user, screen.getByLabelText("Downloads at once"), "3");
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Downloads at once")).toHaveAttribute("data-value", "1");
    expect(
      screen.queryByRole("region", { name: "Unsaved changes" }),
    ).not.toBeInTheDocument();

    await chooseOption(user, screen.getByLabelText("Theme"), "dark");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );
  });

  it("updates yt-dlp on request and reports the new version", async () => {
    const user = userEvent.setup();
    const updateEngine = vi.fn(async () => {
      useAppStore.setState({
        dependencies: [
          { ...dependencies[0], source: "managed", version: "2026.08.19", message: undefined },
          ...dependencies.slice(1),
        ],
      });
    });
    useAppStore.setState({ updateEngine });
    render(<SettingsView />);

    await user.click(screen.getByRole("button", { name: "Update now" }));

    expect(updateEngine).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Updated yt-dlp to 2026.08.19.");
    expect(screen.getByText("Updated")).toBeVisible();
  });

  it("explains a failed yt-dlp update and keeps the automatic setting editable", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const updateEngine = vi.fn().mockRejectedValue("yt-dlp could not update: no internet");
    useAppStore.setState({ saveSettings, updateEngine });
    render(<SettingsView />);

    await user.click(screen.getByRole("button", { name: "Update now" }));
    expect(screen.getByRole("alert")).toHaveTextContent("no internet");

    await user.click(screen.getByRole("switch", { name: "Keep yt-dlp up to date" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ autoUpdateEngine: false }));
  });

  it("saves the accent color picked from the swatches", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ saveSettings });
    render(<SettingsView />);

    const accents = screen.getByRole("radiogroup", { name: "Accent color" });
    expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Violet" }));
    expect(screen.getByRole("radio", { name: "Violet" })).toBeChecked();
    expect(accents).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ accent: "violet" }));
  });

  it("saves network options chosen from controls", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ saveSettings });
    render(<SettingsView />);

    await chooseOption(user, screen.getByLabelText("Browser impersonation"), "chrome");
    await chooseOption(user, screen.getByLabelText("Region bypass"), "country");
    await user.clear(screen.getByLabelText("Country code"));
    await user.type(screen.getByLabelText("Country code"), "jp");
    await chooseOption(user, screen.getByLabelText("IP version"), "ipv4");
    await user.click(screen.getByRole("switch", { name: "Date files by download time" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        impersonate: "chrome",
        geoBypass: "JP",
        ipVersion: "ipv4",
        useDownloadTime: true,
      }),
    );
  });
});
