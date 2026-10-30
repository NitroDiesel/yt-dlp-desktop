import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/store";
import { AppShell } from "./AppShell";

function paste(target: EventTarget, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  target.dispatchEvent(event);
  return event;
}

describe("AppShell", () => {
  beforeEach(() => {
    useAppStore.setState({
      settingsOpen: false,
      inspector: null,
      newDownloadOpen: false,
      sidebarCollapsed: false,
      draftUrl: "",
      queue: [],
      history: [],
      hardwareAcceleration: { status: "available", encoders: [], message: "" },
      analyze: vi.fn().mockResolvedValue(undefined),
    });
    localStorage.clear();
  });

  it("starts a new download when a link is pasted anywhere outside a field", () => {
    render(
      <AppShell>
        <p>Downloads</p>
      </AppShell>,
    );

    const event = paste(document.body, "https://example.com/watch?v=1");

    const state = useAppStore.getState();
    expect(event.defaultPrevented).toBe(true);
    expect(state.newDownloadOpen).toBe(true);
    expect(state.draftUrl).toBe("https://example.com/watch?v=1");
    expect(state.analyze).toHaveBeenCalledWith("https://example.com/watch?v=1");
  });

  it("leaves pasting into text fields alone", () => {
    render(
      <AppShell>
        <input aria-label="Notes" />
      </AppShell>,
    );

    paste(document.querySelector("input")!, "https://example.com/watch?v=1");

    expect(useAppStore.getState().newDownloadOpen).toBe(false);
    expect(useAppStore.getState().analyze).not.toHaveBeenCalled();
  });

  it("collapses the sidebar to an icon rail that keeps every action and count", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      queue: [
        {
          id: "job-1",
          request: {
            url: "https://example.com/watch?v=1",
            destination: "C:\\Downloads",
            filenameTemplate: "%(title)s.%(ext)s",
            isPlaylist: false,
            options: {} as never,
          },
          status: "downloading",
          progress: {},
          createdAt: "2026-10-30T00:00:00Z",
          diagnostics: [],
        },
      ],
    });
    render(
      <AppShell>
        <p>Downloads</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.querySelector(".app")).toHaveClass("app--sidebar-collapsed");
    expect(localStorage.getItem("sidebar-collapsed")).toBe("true");
    // The rail still navigates, and its icon buttons keep their names and counts.
    expect(screen.getByRole("navigation", { name: "Downloads" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Downloading, 1" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "New download" }));
    expect(useAppStore.getState().newDownloadOpen).toBe(true);

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(document.querySelector(".app")).not.toHaveClass("app--sidebar-collapsed");
    expect(localStorage.getItem("sidebar-collapsed")).toBe("false");
  });

  it("offers a found app update in the status bar and installs it on click", async () => {
    const user = userEvent.setup();
    const installAppUpdate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      appUpdate: { version: "1.2.0", installing: false },
      installAppUpdate,
    });
    render(
      <AppShell>
        <p>Downloads</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Update to 1.2.0" }));
    expect(installAppUpdate).toHaveBeenCalledOnce();
  });

  it("toggles the sidebar with Ctrl+B", () => {
    render(
      <AppShell>
        <p>Downloads</p>
      </AppShell>,
    );

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });
});
