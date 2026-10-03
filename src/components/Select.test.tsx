import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

const options = [
  { value: "best", label: "Best available" },
  { value: "2160", label: "Up to 2160p", disabled: true },
  { value: "1080", label: "Up to 1080p" },
  { value: "720", label: "Up to 720p" },
] as const;

function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<string>("best");
  return (
    <>
      <Select
        label="Quality"
        value={value}
        options={options}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

describe("Select", () => {
  it("shows the choice and marks it in the open list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const select = screen.getByRole("combobox", { name: "Quality" });
    expect(select).toHaveTextContent("Best available");
    expect(select).toHaveAttribute("aria-expanded", "false");

    await user.click(select);
    expect(select).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: "Best available" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Up to 2160p" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("picks with a click and ignores disabled options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Quality" });

    await user.click(select);
    await user.click(screen.getByRole("option", { name: "Up to 2160p" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeVisible();

    await user.click(screen.getByRole("option", { name: "Up to 720p" }));
    expect(onChange).toHaveBeenCalledWith("720");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(select).toHaveTextContent("Up to 720p");
    expect(select).toHaveFocus();
  });

  it("moves with the arrow keys, skips disabled options, and picks with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("combobox", { name: "Quality" }).focus();

    await user.keyboard("{ArrowDown}");
    const select = screen.getByRole("combobox", { name: "Quality" });
    expect(select).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Best available" }).id);
    await user.keyboard("{ArrowDown}");
    expect(select).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Up to 1080p" }).id);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("1080");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape without letting the key reach the dialog around it", async () => {
    const user = userEvent.setup();
    const onOuterKey = vi.fn();
    document.addEventListener("keydown", onOuterKey);
    render(<Harness />);

    await user.click(screen.getByRole("combobox", { name: "Quality" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onOuterKey).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onOuterKey).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", onOuterKey);
  });

  it("closes when pressing outside and picks by typing while closed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Quality" });

    await user.click(select);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    select.focus();
    await user.keyboard("u");
    expect(onChange).toHaveBeenCalledWith("1080");
  });
});
