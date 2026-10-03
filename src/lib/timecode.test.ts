import { describe, expect, it } from "vitest";
import {
  formatTimecode,
  parseTimecode,
  validateClipDraft,
} from "./timecode";

describe("clip timecodes", () => {
  it("parses seconds and colon-delimited timecodes", () => {
    expect(parseTimecode("75.5")).toEqual({
      kind: "valid",
      seconds: 75.5,
    });
    expect(parseTimecode("01:15.5")).toEqual({
      kind: "valid",
      seconds: 75.5,
    });
    expect(parseTimecode("1:02:03")).toEqual({
      kind: "valid",
      seconds: 3723,
    });
  });

  it("rejects ambiguous or invalid timecodes", () => {
    expect(parseTimecode("").kind).toBe("invalid");
    expect(parseTimecode("1:72").kind).toBe("invalid");
    expect(parseTimecode("-5").kind).toBe("invalid");
    expect(parseTimecode("one minute").kind).toBe("invalid");
  });

  it("formats editable timecodes without unnecessary precision", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(75.5)).toBe("1:15.5");
    expect(formatTimecode(3723)).toBe("1:02:03");
  });

  it("constructs only ordered clip ranges inside the media duration", () => {
    expect(
      validateClipDraft(
        { start: "0:12.5", end: "0:30.75", precise: true },
        65,
      ),
    ).toEqual({
      kind: "valid",
      startSeconds: 12.5,
      endSeconds: 30.75,
      clip: {
        startSeconds: 12.5,
        durationSeconds: 18.25,
        precise: true,
      },
    });

    expect(
      validateClipDraft(
        { start: "0:40", end: "0:20", precise: false },
        65,
      ),
    ).toEqual({ kind: "invalid", message: "End time must be after start time." });
    expect(
      validateClipDraft(
        { start: "0:40", end: "1:20", precise: false },
        65,
      ),
    ).toEqual({ kind: "invalid", message: "End time must be within 1:05." });
  });
});
