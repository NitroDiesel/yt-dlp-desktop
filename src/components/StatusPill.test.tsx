import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("uses understandable text in addition to color", () => {
    render(<StatusPill status="failed" />);
    expect(screen.getByText("Needs attention")).toBeVisible();
  });
});
