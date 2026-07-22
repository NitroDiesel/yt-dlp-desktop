import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatEta, hostname } from "./format";

describe("display formatting", () => {
  it("formats media values for people", () => {
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatEta(95)).toBe("2 min left");
  });

  it("does not expose URL details as a host label", () => {
    expect(hostname("https://www.example.com/watch?token=secret")).toBe(
      "example.com",
    );
  });
});
