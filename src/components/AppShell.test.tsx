import { render } from "@testing-library/react";
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
      page: "downloads",
      inspector: null,
      newDownloadOpen: false,
      draftUrl: "",
      queue: [],
      history: [],
      hardwareAcceleration: { status: "available", encoders: [], message: "" },
      analyze: vi.fn().mockResolvedValue(undefined),
    });
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
});
