import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/store";
import { AppShell, SidebarReveal } from "./AppShell";

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
      page: "downloads",
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

  it("hides the sidebar and brings it back from the page header", async () => {
    const user = userEvent.setup();
    render(
      <AppShell>
        <SidebarReveal />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByRole("navigation", { name: "Downloads" })).not.toBeInTheDocument();
    expect(localStorage.getItem("sidebar-collapsed")).toBe("true");
    // Kept mounted so it can slide out, but out of reach while hidden.
    expect(document.querySelector(".sidebar")).toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "New download" }));
    expect(useAppStore.getState().newDownloadOpen).toBe(true);

    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("navigation", { name: "Downloads" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show sidebar" })).not.toBeInTheDocument();
    expect(localStorage.getItem("sidebar-collapsed")).toBe("false");
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
