import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Opens a Select and clicks the option whose value is `value`. */
export async function chooseOption(user: UserEvent, trigger: HTMLElement, value: string) {
  await user.click(trigger);
  const option = within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .find((candidate) => candidate.dataset.value === value);
  if (!option) throw new Error(`No option with value "${value}"`);
  await user.click(option);
}
