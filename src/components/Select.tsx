import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

/**
 * A select-only combobox with a styled list. Focus stays on the trigger and
 * the list floats in fixed position, so scrolling panels and the modal dialog
 * never clip it. Name it with `<label htmlFor={id}>` or the `label` prop.
 */
export function Select<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id?: string;
  /** Accessible name when no <label> points at the select. */
  label?: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const listId = `${triggerId}-list`;
  const optionId = (index: number) => `${triggerId}-option-${index}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>();
  const selectedIndex = options.findIndex((option) => option.value === value);

  const enabledFrom = (start: number, step: 1 | -1) => {
    for (let index = start; index >= 0 && index < options.length; index += step) {
      if (!options[index].disabled) return index;
    }
    return -1;
  };

  const show = () => {
    if (disabled) return;
    setActive(
      selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : enabledFrom(0, 1),
    );
    setPosition(undefined);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  /** Native-select type-to-find: moves within the open list, or picks directly when closed. */
  const search = (key: string) => {
    const now = Date.now();
    const state = typeahead.current;
    state.text = now - state.at > 700 ? key : state.text + key;
    state.at = now;
    const from = open ? active : selectedIndex;
    const offset = state.text.length === 1 ? 1 : 0;
    for (let step = 0; step < options.length; step += 1) {
      const index = (Math.max(from, 0) + offset + step) % options.length;
      const option = options[index];
      if (!option.disabled && option.label.toLowerCase().startsWith(state.text.toLowerCase())) {
        if (open) setActive(index);
        else if (option.value !== value) onChange(option.value);
        return;
      }
    }
  };

  // Right-aligned under the trigger; flips above when the window has no room below.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const height = listRef.current?.scrollHeight ?? 0;
    const below = window.innerHeight - trigger.bottom - 8;
    const above = trigger.top - 8;
    const flip = height + 4 > below && above > below;
    setPosition({
      minWidth: trigger.width,
      right: Math.max(8, window.innerWidth - trigger.right),
      maxHeight: Math.max(120, Math.min(320, (flip ? above : below) - 4)),
      ...(flip ? { bottom: window.innerHeight - trigger.top + 4 } : { top: trigger.bottom + 4 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  });

  // Close on outside presses, on scrolling anything but the list, and on resize.
  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      !triggerRef.current?.contains(target as Node) && !listRef.current?.contains(target as Node);
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (!listRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const printable = event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) show();
      else if (printable) search(event.key);
      else return;
    } else {
      const move = (index: number) => index >= 0 && setActive(index);
      switch (event.key) {
        case "ArrowDown":
          move(enabledFrom(active + 1, 1));
          break;
        case "ArrowUp":
          move(enabledFrom(active - 1, -1));
          break;
        case "Home":
          move(enabledFrom(0, 1));
          break;
        case "End":
          move(enabledFrom(options.length - 1, -1));
          break;
        case "Enter":
        case " ":
          choose(active);
          break;
        case "Escape":
          // Close only the list, not the dialog or panel around it.
          setOpen(false);
          break;
        case "Tab":
          setOpen(false);
          return;
        default:
          if (!printable) return;
          search(event.key);
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        className="select"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        data-value={value}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="select__value">{options[selectedIndex]?.label}</span>
        <ChevronDown className="select__chevron" size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="select__list"
          aria-label={label}
          aria-labelledby={label ? undefined : triggerId}
          style={position ?? { visibility: "hidden" }}
          // Keep focus on the trigger while clicking an option.
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              className="select__option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-value={option.value}
              data-active={index === active || undefined}
              onClick={() => choose(index)}
              onMouseMove={() => !option.disabled && index !== active && setActive(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
